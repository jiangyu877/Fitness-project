import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApplication as buildTestApplication } from './build-test-application.js';
import { createWeeklyFeedbackFixture, deriveWeeklyWindows, requiredWeeklyFeedbackFields } from './support/p12-weekly-feedback.js';
import type { Environment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';

const approvedEnvironment: Environment = {
  nodeEnv: 'test',
  port: 3000,
  databasePath: 'memory://',
  demoMode: false,
  professionalRulesApproved: true,
  authSecurityPolicyApproved: true,
  privacyReviewApproved: true,
  dataRightsDrillComplete: true,
  backupRestoreDrillComplete: true,
  operationsReadinessApproved: true,
  deploymentSecurityApproved: true,
};

const effectiveAt = '2026-08-10T00:00:00.000Z';
const effectiveTo = '2026-08-17T00:00:00.000Z';
const publishAt = '2026-08-08T12:00:00.000Z';
const deadline = '2026-08-09T12:00:00.000Z';
const policy: AuthSecurityPolicy = {
  approved: true,
  passwordMinLength: 10,
  sessionTtlSeconds: 900,
  passwordChangeTtlSeconds: 300,
  maxFailedAttempts: 3,
  mfaRequiredForStaff: false,
  scryptCost: 16_384,
  scryptBlockSize: 8,
  scryptParallelization: 1,
  scryptKeyLength: 32,
};
const fictionalP07Providers = {
  consentProvider: {
    getCurrentConsent: async () => ({
      version: 'consent-v1',
      content: { format: 'PLAIN_TEXT' as const, text: 'FICTIONAL PLAN TEST CONSENT' },
    }),
  },
  screeningProvider: { isApprovedConclusion: async () => true },
  profileSchemaProvider: {
    getApprovedProfileSchema: async () => ({
      version: 'plan-fixture-profile-v1',
      steps: [{ id: 'fixture-ready', fields: [{ name: 'fixtureReady', type: 'BOOLEAN' as const, required: true }] }],
    }),
  },
};

function buildApplication(environment: Environment, options: Parameters<typeof buildTestApplication>[1] = {}) {
  return buildTestApplication(environment, { ...fictionalP07Providers, ...options });
}
let tokens = new Map<string, string>();
let planUsers = new Map<string, string>();

describe('plan lifecycle HTTP API', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    tokens = new Map();
    planUsers = new Map();
  });

  it('persists an accepted HTTP write and replays it without duplicate state or audit', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);

    const headers = writeHeaders('persistent-create-plan');
    const payload = {
      id: 'persistent-plan-v1', userId: 'user-1', effectiveAt, effectiveTo, contentMode: 'REVIEWED',
    };
    const first = await agent.post('/api/v1/plan-versions')
      .set(headers).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send(payload).expect(201);
    const replay = await agent.post('/api/v1/plan-versions')
      .set(headers).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send(payload).expect(201);

    expect(replay.body).toEqual(first.body);
    const database = app.get(DatabaseService).database;
    const persisted = await database.query<{ id: string; status: string; payload: unknown }>(
      `SELECT id, status, payload FROM planning.plan_version WHERE id='persistent-plan-v1'`,
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({ id: 'persistent-plan-v1', status: 'DRAFT' });
    const audit = await database.query<{ action: string; outcome: string }>(
      `SELECT action, outcome FROM audit.audit_event WHERE request_id='persistent-create-plan'`,
    );
    expect(audit.rows).toEqual([{ action: 'PLAN_VERSION_CREATED', outcome: 'SUCCEEDED' }]);
  }, 15_000);

  it('ignores backdated and future-dated lifecycle times in public transition bodies', async () => {
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    } as any);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);

    await preparePublished(agent, 'trusted-confirm-time', 'user-1');
    trustedNow = new Date(deadline);
    await agent.post('/api/v1/plan-versions/trusted-confirm-time/transitions')
      .set(writeHeaders('backdated-confirm')).set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .send({ type: 'CONFIRM_DIET', occurredAt: '2026-08-09T11:59:59.999Z' })
      .expect(409).expect(({ body }) => expect(body.errorCode).toBe('CONFIRMATION_DEADLINE_PASSED'));

    trustedNow = new Date('2026-08-08T12:00:00.001Z');
    await prepareReviewed(agent, 'trusted-publish-time', 'user-2');
    await agent.post('/api/v1/plan-versions/trusted-publish-time/transitions')
      .set(writeHeaders('backdated-publish')).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'PUBLISH', occurredAt: publishAt })
      .expect(409).expect(({ body }) => expect(body.errorCode).toBe('PUBLICATION_LEAD_TIME_INSUFFICIENT'));

    trustedNow = new Date(publishAt);
    await preparePublished(agent, 'trusted-activate-time', 'user-3');
    await transition(agent, 'trusted-activate-time', { type: 'CONFIRM_DIET', occurredAt: '2026-08-09T10:00:00.000Z' }, 'PENDING_CONFIRMATION');
    await transition(agent, 'trusted-activate-time', { type: 'CONFIRM_TRAINING', occurredAt: '2026-08-09T10:01:00.000Z' }, 'SCHEDULED');
    trustedNow = new Date('2026-08-09T23:59:59.999Z');
    await agent.post('/api/v1/plan-versions/trusted-activate-time/transitions')
      .set(writeHeaders('future-activate')).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'ACTIVATE', occurredAt: effectiveAt })
      .expect(409).expect(({ body }) => expect(body.errorCode).toBe('EFFECTIVE_TIME_NOT_REACHED'));
  });

  it('returns a pure user-scoped pending summary without draft or review details', async () => {
    const trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    // fixture window truth: the injected trusted clock must satisfy the 24h publication lead time
    expect(trustedNow.getTime()).toBeLessThanOrEqual(new Date(deadline).getTime() - 86_400_000);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);

    await agent.get('/api/v1/users/user-1/plans/pending')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200).expect({ businessStatus: 'NO_PENDING_PLAN', plan: null });
    await preparePublished(agent, 'pending-summary-v1', 'user-1');

    const first = await agent.get('/api/v1/users/user-1/plans/pending')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`).expect(200);
    expect(first.body).toEqual({
      businessStatus: 'PLAN_PENDING_CONFIRMATION',
      plan: {
        version: 'pending-summary-v1', status: 'PENDING_CONFIRMATION', effectiveAt,
        confirmationDeadlineAt: deadline, dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING',
        allowedActions: ['CONFIRM_DIET', 'REJECT_DIET', 'CONFIRM_TRAINING', 'REJECT_TRAINING'],
      },
    });
    expect(JSON.stringify(first.body)).not.toMatch(/reviewer|reviewStatus|createdBy/i);
    await agent.get('/api/v1/users/user-1/plans/pending')
      .set('Authorization', `Bearer ${tokens.get('user-2')}`).expect(403);

    await transition(agent, 'pending-summary-v1', { type: 'CONFIRM_DIET', occurredAt: '2026-08-09T10:00:00.000Z' }, 'PENDING_CONFIRMATION');
    const partial = await agent.get('/api/v1/users/user-1/plans/pending')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`).expect(200);
    expect(partial.body.plan).toMatchObject({
      dietConfirmation: 'CONFIRMED', trainingConfirmation: 'PENDING',
      allowedActions: ['CONFIRM_TRAINING', 'REJECT_TRAINING'],
    });
    await agent.post('/api/v1/plan-versions/pending-summary-v1/transitions')
      .set(writeHeaders('diet-already-decided'))
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .send({ type: 'REJECT_DIET', occurredAt: '2026-08-09T10:00:30.000Z' })
      .expect(409).expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'PLAN_TRANSITION_BLOCKED',
        errorCode: 'PLAN_PART_ALREADY_DECIDED',
        recoverableActions: ['REFRESH'],
      }));
    const auditCount = await app.get(DatabaseService).database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM audit.audit_event WHERE action LIKE 'PLAN_%'`,
    );
    await agent.get('/api/v1/users/user-1/plans/pending')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`).expect(200);
    expect((await app.get(DatabaseService).database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM audit.audit_event WHERE action LIKE 'PLAN_%'`,
    )).rows[0]).toEqual(auditCount.rows[0]);
  });

  it('fails closed for every plan write when the authentication policy is unavailable', async () => {
    app = await buildApplication(approvedEnvironment);
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/plan-versions')
      .set(writeHeaders('policy-blocked-plan'))
      .send({ id: 'policy-blocked-plan', userId: 'user-1', effectiveAt, effectiveTo })
      .expect(503)
      .expect(({ body }) => expect(body.errorCode).toBe('AUTH_SECURITY_POLICY_UNAPPROVED'));
  });

  it('rejects anonymous plan writes', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/plan-versions')
      .set(writeHeaders('anonymous-plan'))
      .send({ id: 'anonymous-plan', userId: 'user-1', effectiveAt, effectiveTo })
      .expect(401)
      .expect(({ body }) => expect(body.errorCode).toBe('SESSION_INVALID'));
  });

  it('requires the active professional reviewer role to have external qualification evidence', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent, { qualifiedReviewers: false });
    await createPlan(agent, 'unqualified-review-plan', 'user-1');
    await transition(agent, 'unqualified-review-plan', { type: 'SUBMIT_REVIEW' }, 'IN_REVIEW');

    await agent.post('/api/v1/plan-versions/unqualified-review-plan/transitions')
      .set(writeHeaders('unqualified-diet-review')).set('Authorization', `Bearer ${tokens.get('nutrition')}`)
      .send({ type: 'APPROVE_DIET' })
      .expect(403)
      .expect(({ body }) => expect(body.errorCode).toBe('PROFESSIONAL_QUALIFICATION_REQUIRED'));
    const audit = await app.get(DatabaseService).database.query<{ actor_role: string; outcome: string; error_code: string }>(
      `SELECT actor_role, outcome, error_code FROM audit.audit_event WHERE request_id='unqualified-diet-review'`,
    );
    expect(audit.rows).toEqual([{
      actor_role: 'NUTRITION_REVIEWER', outcome: 'REJECTED', error_code: 'PROFESSIONAL_QUALIFICATION_REQUIRED',
    }]);
  });

  it('requires authorized plan reads and leaves scheduled plans unchanged when a client supplies at', async () => {
    const trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    // fixture window truth: the injected trusted clock must satisfy the 24h publication lead time
    expect(trustedNow.getTime()).toBeLessThanOrEqual(new Date(deadline).getTime() - 86_400_000);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'pure-read-scheduled', 'user-1');
    await transition(agent, 'pure-read-scheduled', { type: 'CONFIRM_DIET', occurredAt: '2026-08-09T10:00:00.000Z' }, 'PENDING_CONFIRMATION');
    await transition(agent, 'pure-read-scheduled', { type: 'CONFIRM_TRAINING', occurredAt: '2026-08-09T10:01:00.000Z' }, 'SCHEDULED');

    await agent.get('/api/v1/users/user-1/plans/history').expect(401);
    await agent.get('/api/v1/plan-versions/pure-read-scheduled').expect(401);
    await agent.get('/api/v1/users/user-2/plans/history')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(403);
    await agent.get('/api/v1/users/user-1/plans/history')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200);
    await agent.get('/api/v1/users/user-1/plans/history')
      .set('Authorization', `Bearer ${tokens.get('operations')}`)
      .expect(200);

    await agent.get('/api/v1/users/user-1/plans/current')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .query({ at: effectiveAt })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ businessStatus: 'PLAN_GAP', plan: null }));
    await agent.get('/api/v1/plan-versions/pure-read-scheduled')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('SCHEDULED'));
    const unreadable = await agent.get('/api/v1/plan-versions/pure-read-scheduled')
      .set('Authorization', `Bearer ${tokens.get('user-2')}`)
      .set('x-request-id', 'cross-user-version-read')
      .expect(404);
    const missing = await agent.get('/api/v1/plan-versions/no-such-plan-version')
      .set('Authorization', `Bearer ${tokens.get('user-2')}`)
      .expect(404);
    expect(unreadable.body).toMatchObject({ errorCode: 'PLAN_VERSION_NOT_FOUND' });
    expect(missing.body).toMatchObject({ errorCode: 'PLAN_VERSION_NOT_FOUND' });
    const crossUserAudit = await app.get(DatabaseService).database.query(
      `SELECT actor_id, actor_role, outcome, error_code FROM audit.audit_event WHERE request_id='cross-user-version-read'`,
    );
    expect(crossUserAudit.rows).toEqual([{
      actor_id: 'user-2', actor_role: 'USER', outcome: 'REJECTED', error_code: 'PLAN_VERSION_NOT_FOUND',
    }]);
  });

  it('forbids a plan author from approving the corresponding part through another active role', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    const database = app.get(DatabaseService).database;
    const passwordHash = await hashPassword('seed-password-1', policy);
    await database.query(
      `INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
       VALUES ('author-reviewer', 'author-reviewer', $1, 'STAFF', 'ACTIVE', false)`,
      [passwordHash],
    );
    for (const role of ['OPERATIONS', 'NUTRITION_REVIEWER']) {
      await database.query(
        `INSERT INTO iam.account_role (account_id, role_code) VALUES ('author-reviewer', $1)`,
        [role],
      );
    }
    await database.query(
      `UPDATE iam.account_role SET qualified_at=now()
       WHERE account_id='author-reviewer' AND role_code='NUTRITION_REVIEWER'`,
    );
    const authorOperations = await login(agent, 'author-reviewer', 'STAFF', 'OPERATIONS', 'author-operations-login');
    const authorNutrition = await login(agent, 'author-reviewer', 'STAFF', 'NUTRITION_REVIEWER', 'author-nutrition-login');

    await agent.post('/api/v1/plan-versions')
      .set(writeHeaders('author-create')).set('Authorization', `Bearer ${authorOperations}`)
      .send({ id: 'author-review-plan', userId: 'user-1', effectiveAt, effectiveTo, contentMode: 'REVIEWED' })
      .expect(201);
    await agent.post('/api/v1/plan-versions/author-review-plan/transitions')
      .set(writeHeaders('author-submit')).set('Authorization', `Bearer ${authorOperations}`)
      .send({ type: 'SUBMIT_REVIEW' })
      .expect(200);
    await agent.post('/api/v1/plan-versions/author-review-plan/transitions')
      .set(writeHeaders('author-self-review')).set('Authorization', `Bearer ${authorNutrition}`)
      .send({ type: 'APPROVE_DIET', actorId: 'forged-reviewer' })
      .expect(403)
      .expect(({ body }) => expect(body.errorCode).toBe('PLAN_PART_SELF_REVIEW_FORBIDDEN'));
    const selfReviewAudit = await database.query(
      `SELECT actor_id, actor_role, outcome, error_code FROM audit.audit_event WHERE request_id='author-self-review'`,
    );
    expect(selfReviewAudit.rows).toEqual([{
      actor_id: 'author-reviewer', actor_role: 'NUTRITION_REVIEWER', outcome: 'REJECTED',
      error_code: 'PLAN_PART_SELF_REVIEW_FORBIDDEN',
    }]);
    await agent.get('/api/v1/plan-versions/author-review-plan')
      .set('Authorization', `Bearer ${authorOperations}`)
      .expect(200).expect(({ body }) => expect(body.status).toBe('IN_REVIEW'));
  });

  it('audits a service-layer transition role denial exactly once without changing the plan', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await createPlan(agent, 'service-role-denied', 'user-1');
    await agent.post('/api/v1/plan-versions/service-role-denied/transitions')
      .set(writeHeaders('service-role-denied')).set('Authorization', `Bearer ${tokens.get('nutrition')}`)
      .send({ type: 'SUBMIT_REVIEW' }).expect(403)
      .expect(({ body }) => expect(body.errorCode).toBe('ROLE_NOT_AUTHORIZED'));
    const audit = await app.get(DatabaseService).database.query(
      `SELECT actor_id, actor_role, outcome, error_code FROM audit.audit_event WHERE request_id='service-role-denied'`,
    );
    expect(audit.rows).toEqual([{
      actor_id: 'nutrition', actor_role: 'NUTRITION_REVIEWER', outcome: 'REJECTED', error_code: 'ROLE_NOT_AUTHORIZED',
    }]);
    await agent.get('/api/v1/plan-versions/service-role-denied')
      .set('Authorization', `Bearer ${tokens.get('operations')}`)
      .expect(200).expect(({ body }) => expect(body.status).toBe('DRAFT'));
  });

  it('runs draft through dual review, dual confirmation, waiting, and current', async () => {
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);

    const draft = await createPlan(agent, 'plan-v1', 'user-1');
    expect(draft.status).toBe('DRAFT');
    expect(draft.confirmationDeadlineAt).toBe(deadline);

    await transition(agent, 'plan-v1', { type: 'SUBMIT_REVIEW' }, 'IN_REVIEW');
    await transition(
      agent,
      'plan-v1',
      { type: 'APPROVE_DIET', actorId: 'nutrition-1' },
      'IN_REVIEW',
    );
    await transition(
      agent,
      'plan-v1',
      { type: 'APPROVE_TRAINING', actorId: 'training-1' },
      'READY_TO_PUBLISH',
    );
    await transition(
      agent,
      'plan-v1',
      { type: 'PUBLISH', occurredAt: publishAt },
      'PENDING_CONFIRMATION',
    );
    await transition(
      agent,
      'plan-v1',
      { type: 'CONFIRM_DIET', occurredAt: '2026-08-09T10:00:00.000Z' },
      'PENDING_CONFIRMATION',
    );
    await transition(
      agent,
      'plan-v1',
      { type: 'CONFIRM_TRAINING', occurredAt: '2026-08-09T10:01:00.000Z' },
      'SCHEDULED',
    );
    trustedNow = new Date(effectiveAt);
    await transition(
      agent,
      'plan-v1',
      { type: 'ACTIVATE', occurredAt: effectiveAt },
      'ACTIVE',
    );

    const current = await agent
      .get('/api/v1/users/user-1/plans/current')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .query({ at: '2026-08-10T01:00:00.000Z' })
      .expect(200);
    expect(current.body.businessStatus).toBe('CURRENT_PLAN');
    expect(current.body.plan.id).toBe('plan-v1');
    expect(current.body.plan).not.toHaveProperty('dietReview');
    expect(current.body.plan).not.toHaveProperty('dietReviewerId');
    expect(current.body.plan).not.toHaveProperty('userId');
  });

  it('returns structured revision, timeout, history, and gap states', async () => {
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);

    await createPlan(agent, 'plan-review-rejected', 'user-2');
    await transition(agent, 'plan-review-rejected', { type: 'SUBMIT_REVIEW' }, 'IN_REVIEW');
    await transition(
      agent,
      'plan-review-rejected',
      {
        type: 'REJECT_DIET_REVIEW',
        actorId: 'nutrition-1',
        reasonCode: 'CONTENT_REVISION_REQUIRED',
      },
      'STAFF_REVISION_REQUIRED',
    );

    await preparePublished(agent, 'plan-timeout', 'user-2');
    trustedNow = new Date(deadline);
    await transition(
      agent,
      'plan-timeout',
      { type: 'EXPIRE_CONFIRMATION', occurredAt: deadline },
      'CONFIRMATION_TIMED_OUT',
    );

    const gap = await agent
      .get('/api/v1/users/user-2/plans/current')
      .set('Authorization', `Bearer ${tokens.get('user-2')}`)
      .query({ at: '2026-08-10T01:00:00.000Z' })
      .expect(200);
    expect(gap.body).toEqual({ businessStatus: 'PLAN_GAP', plan: null });

    const history = await agent
      .get('/api/v1/users/user-2/plans/history')
      .set('Authorization', `Bearer ${tokens.get('user-2')}`)
      .expect(200);
    expect(history.body.items.map((item: { status: string }) => item.status)).toEqual([
      'CONFIRMATION_TIMED_OUT',
    ]);
  });

  it('rejects an entire published version when either user part is rejected', async () => {
    const trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    // fixture window truth: the injected trusted clock must satisfy the 24h publication lead time
    expect(trustedNow.getTime()).toBeLessThanOrEqual(new Date(deadline).getTime() - 86_400_000);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'plan-user-rejected', 'user-3');

    const rejected = await transition(
      agent,
      'plan-user-rejected',
      {
        type: 'REJECT_TRAINING',
        occurredAt: '2026-08-09T10:00:00.000Z',
      },
      'USER_REVISION_REQUIRED',
    );
    expect(rejected.rejectionReasonCode).toBe('USER_REJECTED_PLAN');
  });

  it('replays a terminal user confirmation without duplicate transition audit', async () => {
    const trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    // fixture window truth: the injected trusted clock must satisfy the 24h publication lead time
    expect(trustedNow.getTime()).toBeLessThanOrEqual(new Date(deadline).getTime() - 86_400_000);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'terminal-confirm-replay', 'user-1');
    await transition(agent, 'terminal-confirm-replay', {
      type: 'CONFIRM_DIET', occurredAt: '2026-08-09T10:00:00.000Z',
    }, 'PENDING_CONFIRMATION');
    const headers = writeHeaders('terminal-confirm-training');
    const body = { type: 'CONFIRM_TRAINING', occurredAt: '2026-08-09T10:01:00.000Z' };
    const first = await agent.post('/api/v1/plan-versions/terminal-confirm-replay/transitions')
      .set(headers).set('Authorization', `Bearer ${tokens.get('user-1')}`).send(body).expect(200);
    const replay = await agent.post('/api/v1/plan-versions/terminal-confirm-replay/transitions')
      .set(headers).set('Authorization', `Bearer ${tokens.get('user-1')}`).send(body).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.body.status).toBe('SCHEDULED');
    const audit = await app.get(DatabaseService).database.query(
      `SELECT action, outcome FROM audit.audit_event WHERE request_id='terminal-confirm-training'`,
    );
    expect(audit.rows).toEqual([{ action: 'PLAN_CONFIRM_TRAINING', outcome: 'SUCCEEDED' }]);
  });

  it('persists confirmation timeout when a user confirms at the deadline', async () => {
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'deadline-confirmation', 'user-1');
    trustedNow = new Date(deadline);

    const deadlineRequest = () => agent.post('/api/v1/plan-versions/deadline-confirmation/transitions')
      .set(writeHeaders('deadline-confirmation-attempt'))
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .send({ type: 'CONFIRM_DIET', occurredAt: deadline });
    await deadlineRequest().expect(409).expect(({ body }) => expect(body).toMatchObject({
      businessStatus: 'CONFIRMATION_CLOSED', errorCode: 'CONFIRMATION_DEADLINE_PASSED',
    }));
    await deadlineRequest().expect(409).expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'CONFIRMATION_CLOSED', errorCode: 'CONFIRMATION_DEADLINE_PASSED',
    }));
    await agent.post('/api/v1/plan-versions/deadline-confirmation/transitions')
      .set(writeHeaders('deadline-confirmation-new-key'))
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .send({ type: 'CONFIRM_DIET' })
      .expect(409)
      .expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'CONFIRMATION_CLOSED', errorCode: 'CONFIRMATION_DEADLINE_PASSED',
      }));
    await agent.get('/api/v1/plan-versions/deadline-confirmation')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200).expect(({ body }) => expect(body.status).toBe('CONFIRMATION_TIMED_OUT'));
    const audit = await app.get(DatabaseService).database.query(
      `SELECT action, outcome FROM audit.audit_event WHERE request_id='deadline-confirmation-attempt'`,
    );
    expect(audit.rows).toEqual([{ action: 'PLAN_EXPIRE_CONFIRMATION', outcome: 'SUCCEEDED' }]);
    const newKeyAudit = await app.get(DatabaseService).database.query(
      `SELECT action FROM audit.audit_event WHERE request_id='deadline-confirmation-new-key'`,
    );
    expect(newKeyAudit.rows).toEqual([]);
  });

  it('hides internal and pre-publication plan versions from user reads', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await createPlan(agent, 'private-draft', 'user-1');

    const hidden = await agent.get('/api/v1/plan-versions/private-draft')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(404);
    const missing = await agent.get('/api/v1/plan-versions/missing-version')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(404);
    expect(hidden.body).toEqual(missing.body);

    const history = await agent.get('/api/v1/users/user-1/plans/history')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200);
    expect(history.body).toEqual({ items: [] });
  });

  it('does not replay one plan response through the same idempotency key on another plan', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await createPlan(agent, 'idempotency-subject-a', 'user-1');
    await createPlan(agent, 'idempotency-subject-b', 'user-1');
    const headers = writeHeaders('shared-subject-key');

    await agent.post('/api/v1/plan-versions/idempotency-subject-a/transitions')
      .set(headers).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'SUBMIT_REVIEW' }).expect(200);
    const second = await agent.post('/api/v1/plan-versions/idempotency-subject-b/transitions')
      .set(headers).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'SUBMIT_REVIEW' }).expect(409);
    expect(second.body).toMatchObject({
      businessStatus: 'PLAN_VERSION_CONFLICT',
      errorCode: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(JSON.stringify(second.body)).not.toContain('idempotency-subject-a');
  });

  it('makes cross-user and nonexistent user transitions indistinguishable', async () => {
    const trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    // fixture window truth: the injected trusted clock must satisfy the 24h publication lead time
    expect(trustedNow.getTime()).toBeLessThanOrEqual(new Date(deadline).getTime() - 86_400_000);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'other-user-pending', 'user-1');

    const crossUser = await agent.post('/api/v1/plan-versions/other-user-pending/transitions')
      .set(writeHeaders('cross-user-transition'))
      .set('Authorization', `Bearer ${tokens.get('user-2')}`)
      .send({ type: 'CONFIRM_DIET' }).expect(404);
    const missing = await agent.post('/api/v1/plan-versions/no-such-transition/transitions')
      .set(writeHeaders('missing-user-transition'))
      .set('Authorization', `Bearer ${tokens.get('user-2')}`)
      .send({ type: 'CONFIRM_DIET' }).expect(404);
    expect(crossUser.body).toEqual(missing.body);
    const rejectedAudits = await app.get(DatabaseService).database.query(
      `SELECT actor_id, actor_role, action, outcome, error_code
       FROM audit.audit_event
       WHERE request_id IN ('cross-user-transition', 'missing-user-transition')
       ORDER BY request_id`,
    );
    expect(rejectedAudits.rows).toEqual([
      { actor_id: 'user-2', actor_role: 'USER', action: 'PLAN_TRANSITION_REJECTED', outcome: 'REJECTED', error_code: 'PLAN_VERSION_NOT_FOUND' },
      { actor_id: 'user-2', actor_role: 'USER', action: 'PLAN_TRANSITION_REJECTED', outcome: 'REJECTED', error_code: 'PLAN_VERSION_NOT_FOUND' },
    ]);
    await agent.get('/api/v1/plan-versions/other-user-pending')
      .set('Authorization', `Bearer ${tokens.get('operations')}`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('PENDING_CONFIRMATION'));
  });

  it('validates staff review rejection reason codes without changing USER rejection bodies', async () => {
    const trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    // fixture window truth: the injected trusted clock must satisfy the 24h publication lead time
    expect(trustedNow.getTime()).toBeLessThanOrEqual(new Date(deadline).getTime() - 86_400_000);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await createPlan(agent, 'review-reason-validation', 'user-1');
    await transition(agent, 'review-reason-validation', { type: 'SUBMIT_REVIEW' }, 'IN_REVIEW');

    for (const [index, body] of [
      { type: 'REJECT_DIET_REVIEW' },
      { type: 'REJECT_DIET_REVIEW', reasonCode: '' },
      { type: 'REJECT_DIET_REVIEW', reasonCode: 42 },
    ].entries()) {
      await agent.post('/api/v1/plan-versions/review-reason-validation/transitions')
        .set(writeHeaders(`invalid-review-reason-${index}`))
        .set('Authorization', `Bearer ${tokens.get('nutrition')}`)
        .send(body).expect(422)
        .expect(({ body: response }) => expect(response).toMatchObject({
          businessStatus: 'REQUEST_INVALID',
          errorCode: 'REVIEW_REASON_CODE_REQUIRED',
          recoverableActions: ['FIX_REQUEST'],
        }));
    }

    await preparePublished(agent, 'user-rejection-no-reason', 'user-2');
    await agent.post('/api/v1/plan-versions/user-rejection-no-reason/transitions')
      .set(writeHeaders('user-rejection-no-reason')).set('Authorization', `Bearer ${tokens.get('user-2')}`)
      .send({ type: 'REJECT_DIET' }).expect(200)
      .expect(({ body }) => expect(body.rejectionReasonCode).toBe('USER_REJECTED_PLAN'));
  });

  it('rejects reasonCode on transitions that do not define review rejection reasons', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await createPlan(agent, 'unexpected-reason-code', 'user-1');

    await agent.post('/api/v1/plan-versions/unexpected-reason-code/transitions')
      .set(writeHeaders('unexpected-reason-code'))
      .set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'SUBMIT_REVIEW', reasonCode: 'OPAQUE_BUT_UNDEFINED' })
      .expect(422)
      .expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'REQUEST_INVALID',
        errorCode: 'INVALID_TRANSITION_REQUEST',
        recoverableActions: ['FIX_REQUEST'],
      }));
    await agent.get('/api/v1/plan-versions/unexpected-reason-code')
      .set('Authorization', `Bearer ${tokens.get('operations')}`)
      .expect(200).expect(({ body }) => expect(body.status).toBe('DRAFT'));
  });

  it('returns a stable 4xx when required transition write headers are missing or empty', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await createPlan(agent, 'required-transition-headers', 'user-1');
    const database = app.get(DatabaseService).database;
    const before = await database.query<{ status: string; idempotency: string; audits: string }>(
      `SELECT
         (SELECT status FROM planning.plan_version WHERE id='required-transition-headers') AS status,
         (SELECT count(*)::text FROM audit.idempotency_key) AS idempotency,
         (SELECT count(*)::text FROM audit.audit_event WHERE subject_id='required-transition-headers') AS audits`,
    );

    const cases = [
      { name: 'missing-request-id', headers: { 'idempotency-key': 'missing-request-id' } },
      { name: 'empty-request-id', headers: { 'x-request-id': '', 'idempotency-key': 'empty-request-id' } },
      { name: 'missing-idempotency-key', headers: { 'x-request-id': 'missing-idempotency-key' } },
      { name: 'empty-idempotency-key', headers: { 'x-request-id': 'empty-idempotency-key', 'idempotency-key': '' } },
    ];
    for (const testCase of cases) {
      await agent.post('/api/v1/plan-versions/required-transition-headers/transitions')
        .set(testCase.headers)
        .set('Authorization', `Bearer ${tokens.get('operations')}`)
        .send({ type: 'SUBMIT_REVIEW' })
        .expect(422)
        .expect(({ body }) => expect(body).toMatchObject({
          businessStatus: 'REQUEST_INVALID',
          errorCode: 'REQUEST_HEADER_REQUIRED',
          recoverableActions: ['FIX_REQUEST'],
        }));
    }
    expect((await database.query(
      `SELECT
         (SELECT status FROM planning.plan_version WHERE id='required-transition-headers') AS status,
         (SELECT count(*)::text FROM audit.idempotency_key) AS idempotency,
         (SELECT count(*)::text FROM audit.audit_event WHERE subject_id='required-transition-headers') AS audits`,
    )).rows).toEqual(before.rows);
  });

  it('blocks plan creation before publication when professional rules remain unapproved', async () => {
    app = await buildApplication({
      ...approvedEnvironment,
      professionalRulesApproved: false,
    }, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    const response = await agent.post('/api/v1/plan-versions')
      .set(writeHeaders('create-plan-blocked')).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ id: 'plan-blocked', userId: 'user-4', effectiveAt, effectiveTo, contentMode: 'REVIEWED' })
      .expect(409);
    expect(response.body).toMatchObject({
      businessStatus: 'PLAN_CREATION_BLOCKED',
      errorCode: 'ONBOARDING_NOT_READY',
      recoverableActions: ['COMPLETE_ONBOARDING'],
    });
    expect((await app.get(DatabaseService).database.query(
      `SELECT count(*)::int AS count FROM planning.plan_version WHERE id='plan-blocked'`,
    )).rows).toEqual([{ count: 0 }]);
  });

  it('allows a draft without an end but blocks publication until the window is finite', async () => {
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => new Date(publishAt) },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await agent.post('/api/v1/plan-versions')
      .set(writeHeaders('create-open-ended')).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ id: 'open-ended-plan', userId: 'user-1', effectiveAt, contentMode: 'REVIEWED' })
      .expect(201);
    planUsers.set('open-ended-plan', 'user-1');
    await transition(agent, 'open-ended-plan', { type: 'SUBMIT_REVIEW' }, 'IN_REVIEW');
    await transition(agent, 'open-ended-plan', { type: 'APPROVE_DIET' }, 'IN_REVIEW');
    await transition(agent, 'open-ended-plan', { type: 'APPROVE_TRAINING' }, 'READY_TO_PUBLISH');
    await agent.post('/api/v1/plan-versions/open-ended-plan/transitions')
      .set(writeHeaders('publish-open-ended')).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'PUBLISH' }).expect(409)
      .expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'PLAN_VERSION_INVALID',
        errorCode: 'EFFECTIVE_TO_REQUIRED',
      }));
  });

  it('rechecks onboarding readiness before publishing after screening falls back', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy, planClock: { now: () => new Date(publishAt) } } as any);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await prepareReviewed(agent, 'screening-fallback-publish', 'user-1');
    await app.get(DatabaseService).database.query(
      `INSERT INTO care.screening_result
         (id,user_id,conclusion,source,rule_version,recorded_by,actor_role,created_at)
       VALUES ('screening-fallback','user-1','HUMAN_REVIEW','MANUAL_REVIEW','fictional-plan-rule-v2','nutrition','NUTRITION_REVIEWER',now()+interval '1 second')`,
    );
    await agent.post('/api/v1/plan-versions/screening-fallback-publish/transitions')
      .set(writeHeaders('screening-fallback-publish-request'))
      .set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'PUBLISH' }).expect(409)
      .expect(({ body }) => expect(body.errorCode).toBe('ONBOARDING_NOT_READY'));

    const state = await app.get(DatabaseService).database.query<{ status: string; idempotency: number }>(`
      SELECT status,
        (SELECT count(*)::int FROM audit.idempotency_key WHERE key='screening-fallback-publish-request') AS idempotency
      FROM planning.plan_version WHERE id='screening-fallback-publish'
    `);
    expect(state.rows[0]).toEqual({ status: 'READY_TO_PUBLISH', idempotency: 0 });
  });

  it('serializes publishing behind a winning screening fallback transaction', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy, planClock: { now: () => new Date(publishAt) } } as any);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await prepareReviewed(agent, 'screening-race-publish', 'user-1');
    const database = app.get(DatabaseService).database;
    let releaseFallback!: () => void;
    const fallbackRelease = new Promise<void>((resolve) => { releaseFallback = resolve; });
    let fallbackLocked!: () => void;
    const locked = new Promise<void>((resolve) => { fallbackLocked = resolve; });
    const fallback = database.transaction(async (tx) => {
      await tx.query(`SELECT id FROM iam.account WHERE id='user-1' FOR UPDATE`);
      await tx.query(
        `INSERT INTO care.screening_result
           (id,user_id,conclusion,source,rule_version,recorded_by,actor_role,created_at)
         VALUES ('screening-race-fallback','user-1','EXCLUDED','MANUAL_REVIEW','fictional-plan-rule-v3','screening-reviewer','NUTRITION_REVIEWER',now()+interval '1 second')`,
      );
      fallbackLocked();
      await fallbackRelease;
    });
    await locked;
    let publishSettled = false;
    const publish = agent.post('/api/v1/plan-versions/screening-race-publish/transitions')
      .set(writeHeaders('screening-race-publish-request'))
      .set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'PUBLISH' }).then((response) => { publishSettled = true; return response; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(publishSettled).toBe(false);
    releaseFallback();
    await fallback;
    const response = await publish;
    expect(response.status).toBe(409);
    expect(response.body.errorCode).toBe('ONBOARDING_NOT_READY');
    const state = await database.query<{ status: string; idempotency: number }>(`
      SELECT status,
        (SELECT count(*)::int FROM audit.idempotency_key WHERE key='screening-race-publish-request') AS idempotency
      FROM planning.plan_version WHERE id='screening-race-publish'
    `);
    expect(state.rows[0]).toEqual({ status: 'READY_TO_PUBLISH', idempotency: 0 });
  });

  it('serializes screening HTTP writes on the same user lock', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    const database = app.get(DatabaseService).database;
    let release!: () => void;
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { locked = resolve; });
    const holder = database.transaction(async (tx) => {
      await tx.query(`SELECT id FROM iam.account WHERE id='user-1' FOR UPDATE`);
      locked();
      await releaseLock;
    });
    await lockAcquired;
    let screeningSettled = false;
    const screening = agent.post('/api/v1/onboarding/screening-results')
      .set(writeHeaders('serialized-screening-write'))
      .set('Authorization', `Bearer ${tokens.get('nutrition')}`)
      .send({ userId: 'user-1', conclusion: 'HUMAN_REVIEW', source: 'MANUAL_REVIEW', ruleVersion: 'fictional-plan-rule-v4' })
      .then((response) => { screeningSettled = true; return response; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screeningSettled).toBe(false);
    release();
    await holder;
    expect((await screening).status).toBe(201);
  });

  it('blocks a second pending version for the same user', async () => {
    const trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    // fixture window truth: the injected trusted clock must satisfy the 24h publication lead time
    expect(trustedNow.getTime()).toBeLessThanOrEqual(new Date(deadline).getTime() - 86_400_000);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'plan-first', 'user-5');
    await prepareReviewed(agent, 'plan-second', 'user-5');

    const response = await agent
      .post('/api/v1/plan-versions/plan-second/transitions')
      .set(writeHeaders('publish-plan-second')).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({ type: 'PUBLISH', occurredAt: publishAt })
      .expect(409);
    expect(response.body.errorCode).toBe('SINGLE_PENDING_VERSION_REQUIRED');
  });

  it('maps concurrent publication uniqueness to the stable pending-version conflict', async () => {
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => new Date(publishAt) },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await prepareReviewed(agent, 'concurrent-publish-a', 'user-6');
    await prepareReviewed(agent, 'concurrent-publish-b', 'user-6');

    const responses = await Promise.all([
      agent.post('/api/v1/plan-versions/concurrent-publish-a/transitions')
        .set(writeHeaders('concurrent-publish-a')).set('Authorization', `Bearer ${tokens.get('operations')}`)
        .send({ type: 'PUBLISH' }),
      agent.post('/api/v1/plan-versions/concurrent-publish-b/transitions')
        .set(writeHeaders('concurrent-publish-b')).set('Authorization', `Bearer ${tokens.get('operations')}`)
        .send({ type: 'PUBLISH' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const rejected = responses.find((response) => response.status === 409)!;
    expect(rejected.body).toMatchObject({
      businessStatus: 'PUBLICATION_BLOCKED',
      errorCode: 'SINGLE_PENDING_VERSION_REQUIRED',
    });
  });

  it('serializes concurrent confirmation and activation into one persisted result', async () => {
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'concurrent-confirm-activate', 'user-1');
    trustedNow = new Date('2026-08-09T10:00:00.000Z');

    const confirmations = await Promise.all([
      agent.post('/api/v1/plan-versions/concurrent-confirm-activate/transitions')
        .set(writeHeaders('concurrent-confirm-diet')).set('Authorization', `Bearer ${tokens.get('user-1')}`)
        .send({ type: 'CONFIRM_DIET' }),
      agent.post('/api/v1/plan-versions/concurrent-confirm-activate/transitions')
        .set(writeHeaders('concurrent-confirm-training')).set('Authorization', `Bearer ${tokens.get('user-1')}`)
        .send({ type: 'CONFIRM_TRAINING' }),
    ]);
    expect(confirmations.map((response) => response.status)).toEqual([200, 200]);
    expect(confirmations.some((response) => response.body.status === 'SCHEDULED')).toBe(true);

    trustedNow = new Date(effectiveAt);
    const activations = await Promise.all([
      agent.post('/api/v1/plan-versions/concurrent-confirm-activate/transitions')
        .set(writeHeaders('concurrent-activate-a')).set('Authorization', `Bearer ${tokens.get('operations')}`)
        .send({ type: 'ACTIVATE' }),
      agent.post('/api/v1/plan-versions/concurrent-confirm-activate/transitions')
        .set(writeHeaders('concurrent-activate-b')).set('Authorization', `Bearer ${tokens.get('operations')}`)
        .send({ type: 'ACTIVATE' }),
    ]);
    expect(activations.map((response) => response.status).sort()).toEqual([200, 409]);
    const persisted = await app.get(DatabaseService).database.query(
      `SELECT status FROM planning.plan_version WHERE id='concurrent-confirm-activate'`,
    );
    expect(persisted.rows).toEqual([{ status: 'ACTIVE' }]);
  });

  it('returns one stable closed confirmation result for distinct keys racing at the deadline', async () => {
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'deadline-confirm-race', 'user-1');
    trustedNow = new Date(deadline);

    const responses = await Promise.all([
      agent.post('/api/v1/plan-versions/deadline-confirm-race/transitions')
        .set(writeHeaders('deadline-confirm-race-a')).set('Authorization', `Bearer ${tokens.get('user-1')}`)
        .send({ type: 'CONFIRM_DIET', occurredAt: '2026-08-09T11:59:59.000Z' }),
      agent.post('/api/v1/plan-versions/deadline-confirm-race/transitions')
        .set(writeHeaders('deadline-confirm-race-b')).set('Authorization', `Bearer ${tokens.get('user-1')}`)
        .send({ type: 'CONFIRM_DIET', occurredAt: '2026-08-09T11:59:59.000Z' }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        businessStatus: 'CONFIRMATION_CLOSED',
        errorCode: 'CONFIRMATION_DEADLINE_PASSED',
      });
    }
    const database = app.get(DatabaseService).database;
    expect((await database.query(
      `SELECT status FROM planning.plan_version WHERE id='deadline-confirm-race'`,
    )).rows).toEqual([{ status: 'CONFIRMATION_TIMED_OUT' }]);
    expect((await database.query(
      `SELECT action FROM audit.audit_event
       WHERE subject_id='deadline-confirm-race' AND action='PLAN_EXPIRE_CONFIRMATION'`,
    )).rows).toEqual([{ action: 'PLAN_EXPIRE_CONFIRMATION' }]);
  });

  it('does not promote a fully confirmed scheduled version from a client supplied time', async () => {
    const trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    // fixture window truth: the injected trusted clock must satisfy the 24h publication lead time
    expect(trustedNow.getTime()).toBeLessThanOrEqual(new Date(deadline).getTime() - 86_400_000);
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'plan-auto-active', 'user-6');
    await transition(
      agent,
      'plan-auto-active',
      { type: 'CONFIRM_DIET', occurredAt: '2026-08-09T10:00:00.000Z' },
      'PENDING_CONFIRMATION',
    );
    await transition(
      agent,
      'plan-auto-active',
      { type: 'CONFIRM_TRAINING', occurredAt: '2026-08-09T10:01:00.000Z' },
      'SCHEDULED',
    );

    const current = await agent
      .get('/api/v1/users/user-6/plans/current')
      .set('Authorization', `Bearer ${tokens.get('user-6')}`)
      .query({ at: effectiveAt })
      .expect(200);
    expect(current.body).toEqual({ businessStatus: 'PLAN_GAP', plan: null });
    await agent
      .get('/api/v1/plan-versions/plan-auto-active')
      .set('Authorization', `Bearer ${tokens.get('user-6')}`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('SCHEDULED'));
  });

  it('uses the trusted ACTIVE window guard at the real task-candidate boundary without writes', async () => {
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    await preparePublished(agent, 'task-candidate-plan', 'user-1');
    trustedNow = new Date('2026-08-09T10:00:00.000Z');
    await transition(agent, 'task-candidate-plan', { type: 'CONFIRM_DIET' }, 'PENDING_CONFIRMATION');
    await transition(agent, 'task-candidate-plan', { type: 'CONFIRM_TRAINING' }, 'SCHEDULED');
    trustedNow = new Date(effectiveAt);
    await transition(agent, 'task-candidate-plan', { type: 'ACTIVATE' }, 'ACTIVE');

    const database = app.get(DatabaseService).database;
    const before = await database.query<{ audits: string; idempotency: string; versions: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.audit_event) AS audits,
         (SELECT count(*)::text FROM audit.idempotency_key) AS idempotency,
         (SELECT count(*)::text FROM planning.plan_version) AS versions`,
    );
    await agent.get('/api/v1/users/user-1/task-candidates')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({
        businessStatus: 'TASK_GENERATION_ALLOWED',
        planVersion: 'task-candidate-plan',
        items: [],
      }));
    expect((await database.query(
      `SELECT
         (SELECT count(*)::text FROM audit.audit_event) AS audits,
         (SELECT count(*)::text FROM audit.idempotency_key) AS idempotency,
         (SELECT count(*)::text FROM planning.plan_version) AS versions`,
    )).rows).toEqual(before.rows);

    trustedNow = new Date(effectiveTo);
    await agent.get('/api/v1/users/user-1/task-candidates')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({
        businessStatus: 'PLAN_GAP',
        planVersion: null,
        items: [],
      }));
  });

  it.each([
    ['rejected', 'user-3', 'REJECT_DIET', 'USER_REVISION_REQUIRED'],
    ['timed-out', 'user-4', 'CONFIRM_DIET', 'CONFIRMATION_TIMED_OUT'],
  ] as const)('PL10 keeps the persisted old ACTIVE unchanged when its replacement is %s', async (
    scenario, userId, replacementAction, replacementStatus,
  ) => {
    const oldEffectiveAt = '2026-08-01T00:00:00.000Z';
    const oldEffectiveTo = '2026-08-17T00:00:00.000Z';
    let trustedNow = new Date('2026-07-30T12:00:00.000Z');
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    const oldId = `pl10-${scenario}-old`;
    const replacementId = `pl10-${scenario}-replacement`;
    await prepareReviewedWithWindow(agent, oldId, userId, oldEffectiveAt, oldEffectiveTo);
    await transition(agent, oldId, { type: 'PUBLISH' }, 'PENDING_CONFIRMATION');
    trustedNow = new Date('2026-07-31T10:00:00.000Z');
    await transition(agent, oldId, { type: 'CONFIRM_DIET' }, 'PENDING_CONFIRMATION');
    await transition(agent, oldId, { type: 'CONFIRM_TRAINING' }, 'SCHEDULED');
    trustedNow = new Date(oldEffectiveAt);
    await transition(agent, oldId, { type: 'ACTIVATE' }, 'ACTIVE');

    trustedNow = new Date(publishAt);
    await preparePublished(agent, replacementId, userId);
    trustedNow = replacementStatus === 'CONFIRMATION_TIMED_OUT'
      ? new Date(deadline)
      : new Date('2026-08-09T10:00:00.000Z');
    const replacementResponse = await agent.post(`/api/v1/plan-versions/${replacementId}/transitions`)
      .set(writeHeaders(`pl10-${scenario}-close`)).set('Authorization', `Bearer ${tokens.get(userId)}`)
      .send({ type: replacementAction });
    expect(replacementResponse.status).toBe(replacementStatus === 'CONFIRMATION_TIMED_OUT' ? 409 : 200);

    const database = app.get(DatabaseService).database;
    expect((await database.query(
      `SELECT id, status, effective_to AS "effectiveTo" FROM planning.plan_version
       WHERE id IN ($1,$2) ORDER BY id`, [oldId, replacementId],
    )).rows).toEqual([
      { id: oldId, status: 'ACTIVE', effectiveTo: new Date(oldEffectiveTo) },
      { id: replacementId, status: replacementStatus, effectiveTo: new Date(effectiveTo) },
    ].sort((left, right) => left.id.localeCompare(right.id)));

    const beforeReads = await planReadSideEffectCounts(database);
    await agent.get(`/api/v1/users/${userId}/plans/current`)
      .set('Authorization', `Bearer ${tokens.get(userId)}`)
      .expect(200).expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'CURRENT_PLAN', plan: { id: oldId },
      }));
    await agent.get(`/api/v1/users/${userId}/task-candidates`)
      .set('Authorization', `Bearer ${tokens.get(userId)}`)
      .expect(200).expect(({ body }) => expect(body).toEqual({
        businessStatus: 'TASK_GENERATION_ALLOWED', planVersion: oldId, items: [],
      }));

    trustedNow = new Date(oldEffectiveTo);
    await agent.get(`/api/v1/users/${userId}/plans/current`)
      .set('Authorization', `Bearer ${tokens.get(userId)}`)
      .expect(200).expect(({ body }) => expect(body).toEqual({ businessStatus: 'PLAN_GAP', plan: null }));
    await agent.get(`/api/v1/users/${userId}/task-candidates`)
      .set('Authorization', `Bearer ${tokens.get(userId)}`)
      .expect(200).expect(({ body }) => expect(body).toEqual({
        businessStatus: 'PLAN_GAP', planVersion: null, items: [],
      }));
    expect(await planReadSideEffectCounts(database)).toEqual(beforeReads);
  });

  it('fails current-plan reads closed when bypassed data contains multiple active versions', async () => {
    const trustedNow = new Date('2026-07-27T00:00:00.000Z');
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);
    const database = app.get(DatabaseService).database;
    await database.exec(`
      DROP INDEX planning.uq_plan_version_active_per_user;
      INSERT INTO planning.plan (id, user_id) VALUES ('bypass-active-plan', 'user-1');
      INSERT INTO planning.plan_version (
        id, plan_id, user_id, version_number, status, published_at,
        confirmation_deadline_at, effective_at, effective_to, professional_rules_approved, payload
      ) VALUES
        ('bypass-active-a', 'bypass-active-plan', 'user-1', 1, 'ACTIVE',
         '2026-07-24T12:00:00Z', '2026-07-25T12:00:00Z', '2026-07-26T00:00:00Z', '2026-07-28T00:00:00Z', true,
         '{"plan":{"id":"bypass-active-a","userId":"user-1","status":"ACTIVE","effectiveAt":"2026-07-26T00:00:00.000Z","effectiveTo":"2026-07-28T00:00:00.000Z"},"contentMode":"REVIEWED","createdBy":"operations"}'),
        ('bypass-active-b', 'bypass-active-plan', 'user-1', 2, 'ACTIVE',
         '2026-07-24T12:00:00Z', '2026-07-25T12:00:00Z', '2026-07-26T00:00:00Z', '2026-07-29T00:00:00Z', true,
         '{"plan":{"id":"bypass-active-b","userId":"user-1","status":"ACTIVE","effectiveAt":"2026-07-26T00:00:00.000Z","effectiveTo":"2026-07-29T00:00:00.000Z"},"contentMode":"REVIEWED","createdBy":"operations"}');
    `);
    // both bypassed ACTIVE windows must genuinely contain the injected trusted clock
    expect(trustedNow.getTime()).toBeGreaterThanOrEqual(new Date('2026-07-26T00:00:00.000Z').getTime());
    expect(trustedNow.getTime()).toBeLessThan(new Date('2026-07-28T00:00:00.000Z').getTime());

    await agent.get('/api/v1/users/user-1/plans/current')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(409)
      .expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'PLAN_STATE_INVALID',
        errorCode: 'MULTIPLE_ACTIVE_PLAN_VERSIONS',
      }));
    await agent.get('/api/v1/users/user-1/task-candidates')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({
        businessStatus: 'PLAN_GAP', planVersion: null, items: [],
      }));
  });

  it('rejects anonymous, STAFF, and cross-user task-candidate reads', async () => {
    app = await buildApplication(approvedEnvironment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);

    await agent.get('/api/v1/users/user-1/task-candidates')
      .set('x-request-id', 'task-candidates-anonymous')
      .expect(401).expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'WRITE_REJECTED', errorCode: 'SESSION_INVALID',
      }));
    await agent.get('/api/v1/users/user-1/task-candidates')
      .set('x-request-id', 'task-candidates-staff')
      .set('Authorization', `Bearer ${tokens.get('operations')}`)
      .expect(401).expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'WRITE_REJECTED', errorCode: 'SESSION_INVALID',
      }));
    await agent.get('/api/v1/users/user-1/task-candidates')
      .set('x-request-id', 'task-candidates-cross-user')
      .set('Authorization', `Bearer ${tokens.get('user-2')}`)
      .expect(403).expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'WRITE_REJECTED', errorCode: 'ROLE_NOT_AUTHORIZED',
      }));
  });

  it('runs fat-loss and muscle-gain fixture labels through the real lifecycle matrix', async () => {
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);

    await preparePublished(agent, 'persona-fat-loss-v1', 'persona_fat_loss');
    trustedNow = new Date('2026-08-09T10:00:00.000Z');
    const fatConfirmations = await Promise.all([
      agent.post('/api/v1/plan-versions/persona-fat-loss-v1/transitions')
        .set(writeHeaders('persona-fat-confirm-diet')).set('Authorization', `Bearer ${tokens.get('persona_fat_loss')}`)
        .send({ type: 'CONFIRM_DIET' }),
      agent.post('/api/v1/plan-versions/persona-fat-loss-v1/transitions')
        .set(writeHeaders('persona-fat-confirm-training')).set('Authorization', `Bearer ${tokens.get('persona_fat_loss')}`)
        .send({ type: 'CONFIRM_TRAINING' }),
    ]);
    expect(fatConfirmations.map((response) => response.status)).toEqual([200, 200]);
    trustedNow = new Date(effectiveAt);
    await transition(agent, 'persona-fat-loss-v1', { type: 'ACTIVATE' }, 'ACTIVE');
    await agent.get('/api/v1/users/persona_fat_loss/task-candidates')
      .set('Authorization', `Bearer ${tokens.get('persona_fat_loss')}`)
      .expect(200).expect(({ body }) => expect(body.businessStatus).toBe('TASK_GENERATION_ALLOWED'));
    trustedNow = new Date(effectiveTo);
    await agent.get('/api/v1/users/persona_fat_loss/plans/current')
      .set('Authorization', `Bearer ${tokens.get('persona_fat_loss')}`)
      .expect(200).expect(({ body }) => expect(body.businessStatus).toBe('PLAN_GAP'));

    trustedNow = new Date(publishAt);
    await preparePublished(agent, 'persona-muscle-reject-v1', 'persona_muscle_gain');
    const unauthorized = await agent.post('/api/v1/plan-versions/persona-muscle-reject-v1/transitions')
      .set(writeHeaders('persona-cross-user')).set('Authorization', `Bearer ${tokens.get('persona_fat_loss')}`)
      .send({ type: 'CONFIRM_DIET' }).expect(404);
    expect(unauthorized.body).not.toHaveProperty('id');
    await transition(agent, 'persona-muscle-reject-v1', { type: 'REJECT_TRAINING' }, 'USER_REVISION_REQUIRED');

    await preparePublished(agent, 'persona-muscle-timeout-v2', 'persona_muscle_gain');
    trustedNow = new Date(deadline);
    await agent.post('/api/v1/plan-versions/persona-muscle-timeout-v2/transitions')
      .set(writeHeaders('persona-muscle-timeout')).set('Authorization', `Bearer ${tokens.get('persona_muscle_gain')}`)
      .send({ type: 'CONFIRM_DIET' }).expect(409)
      .expect(({ body }) => expect(body.errorCode).toBe('CONFIRMATION_DEADLINE_PASSED'));
  });

  it('P12 weekly adjustment: runs the adjusted version through review, publish, dual confirmation and activation', async () => {
    const baseEffectiveAt = '2026-08-10T00:00:00.000Z';
    const baseEffectiveTo = '2026-08-17T00:00:00.000Z';
    const adjustmentEffectiveAt = '2026-08-17T00:00:00.000Z';
    const adjustmentEffectiveTo = '2026-08-23T16:00:00.000Z';
    let trustedNow = new Date(publishAt);
    app = await buildApplication(approvedEnvironment, {
      authPolicy: policy,
      planClock: { now: () => trustedNow },
    });
    const agent = request(app.getHttpServer());
    await seedPlanFixture(app, agent);

    await prepareReviewedWithWindow(agent, 'weekly-base-v1', 'user-1', baseEffectiveAt, baseEffectiveTo);
    await transition(agent, 'weekly-base-v1', { type: 'PUBLISH', occurredAt: publishAt }, 'PENDING_CONFIRMATION');
    trustedNow = new Date('2026-08-09T10:00:00.000Z');
    await transition(agent, 'weekly-base-v1', { type: 'CONFIRM_DIET' }, 'PENDING_CONFIRMATION');
    await transition(agent, 'weekly-base-v1', { type: 'CONFIRM_TRAINING' }, 'SCHEDULED');
    trustedNow = new Date(baseEffectiveAt);
    await transition(agent, 'weekly-base-v1', { type: 'ACTIVATE' }, 'ACTIVE');

    const feedback = createWeeklyFeedbackFixture({ sufficiencyPolicy: () => 'SUFFICIENT' });
    const submission = feedback.submit({
      weekIndex: 1,
      windowState: 'OPEN',
      fields: {
        execution: 'opaque-execution', trainingPerformance: 'opaque-training', sleep: 'opaque-sleep',
        energy: 'opaque-energy', hunger: 'opaque-hunger', stress: 'opaque-stress',
        recovery: 'opaque-recovery', pain: 'CLEAR',
      },
      facts: { recordedDays: 7 },
      requestedOutcome: 'CHANGE_TRAINING_CONTENT',
    });
    expect(submission.outcome).toBe('ADJUSTMENT_PENDING');
    const adoption = submission.outcome === 'ADJUSTMENT_PENDING' ? submission.adoption : undefined;
    expect(adoption).toMatchObject({ weekIndex: 1, outcome: 'CHANGE_TRAINING_CONTENT' });

    const database = app.get(DatabaseService).database;
    await agent.post('/api/v1/plan-versions')
      .set(writeHeaders('create-weekly-adjustment')).set('Authorization', `Bearer ${tokens.get('operations')}`)
      .send({
        id: 'weekly-adjustment-v2', userId: 'user-1',
        effectiveAt: adjustmentEffectiveAt, effectiveTo: adjustmentEffectiveTo, contentMode: 'REVIEWED',
      })
      .expect(201);
    planUsers.set('weekly-adjustment-v2', 'user-1');
    // the schema-frozen weekly adjustment source type is set while the version is still a draft;
    // production creation wiring is a later slice and the immutability guard only protects published versions
    await database.query(
      `UPDATE planning.plan_version SET source_type='WEEKLY_ADJUSTMENT' WHERE id='weekly-adjustment-v2' AND status='DRAFT'`,
    );
    await transition(agent, 'weekly-adjustment-v2', { type: 'SUBMIT_REVIEW' }, 'IN_REVIEW');
    await transition(agent, 'weekly-adjustment-v2', { type: 'APPROVE_DIET' }, 'IN_REVIEW');
    await transition(agent, 'weekly-adjustment-v2', { type: 'APPROVE_TRAINING' }, 'READY_TO_PUBLISH');

    trustedNow = new Date(publishAt);
    await transition(agent, 'weekly-adjustment-v2', { type: 'PUBLISH', occurredAt: publishAt }, 'PENDING_CONFIRMATION');
    trustedNow = new Date('2026-08-15T10:00:00.000Z');
    await transition(agent, 'weekly-adjustment-v2', { type: 'CONFIRM_DIET' }, 'PENDING_CONFIRMATION');
    await transition(agent, 'weekly-adjustment-v2', { type: 'CONFIRM_TRAINING' }, 'SCHEDULED');
    trustedNow = new Date(adjustmentEffectiveAt);
    await transition(agent, 'weekly-adjustment-v2', { type: 'ACTIVATE' }, 'ACTIVE');

    expect((await database.query(
      `SELECT id, status, source_type AS "sourceType", version_number AS "versionNumber",
         effective_at AS "effectiveAt", effective_to AS "effectiveTo"
       FROM planning.plan_version WHERE user_id='user-1' ORDER BY version_number`,
    )).rows).toEqual([
      {
        id: 'weekly-base-v1', status: 'SUPERSEDED', sourceType: 'INITIAL', versionNumber: 1,
        effectiveAt: new Date(baseEffectiveAt), effectiveTo: new Date(baseEffectiveTo),
      },
      {
        id: 'weekly-adjustment-v2', status: 'ACTIVE', sourceType: 'WEEKLY_ADJUSTMENT', versionNumber: 2,
        effectiveAt: new Date(adjustmentEffectiveAt), effectiveTo: new Date(adjustmentEffectiveTo),
      },
    ]);
    expect({ ...adoption, planVersionId: 'weekly-adjustment-v2', previousPlanVersionId: 'weekly-base-v1' })
      .toEqual({
        weekIndex: 1, outcome: 'CHANGE_TRAINING_CONTENT',
        submittedFieldIds: [...requiredWeeklyFeedbackFields],
        planVersionId: 'weekly-adjustment-v2', previousPlanVersionId: 'weekly-base-v1',
      });
    await agent.get('/api/v1/users/user-1/plans/current')
      .set('Authorization', `Bearer ${tokens.get('user-1')}`)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'CURRENT_PLAN', plan: { id: 'weekly-adjustment-v2' },
      }));
    expect(deriveWeeklyWindows(new Date(adjustmentEffectiveAt), new Date(adjustmentEffectiveTo)))
      .toEqual([[
        '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23',
      ]]);
  });
});

type Agent = ReturnType<typeof request>;

async function createPlan(agent: Agent, id: string, userId: string) {
  const response = await agent
    .post('/api/v1/plan-versions')
    .set(writeHeaders(`create-${id}`)).set('Authorization', `Bearer ${tokens.get('operations')}`)
    .send({ id, userId, effectiveAt, effectiveTo, contentMode: 'REVIEWED' })
    .expect(201);
  planUsers.set(id, userId);
  return response.body;
}

async function transition(
  agent: Agent,
  id: string,
  event: Record<string, string>,
  expectedStatus: string,
) {
  const roleToken = event.type === 'APPROVE_DIET' || event.type === 'REJECT_DIET_REVIEW'
    ? tokens.get('nutrition')
    : event.type === 'APPROVE_TRAINING' || event.type === 'REJECT_TRAINING_REVIEW'
      ? tokens.get('training')
      : event.type === 'CONFIRM_DIET' || event.type === 'CONFIRM_TRAINING' || event.type === 'REJECT_DIET' || event.type === 'REJECT_TRAINING'
        ? tokens.get(planUsers.get(id) ?? '')
        : tokens.get('operations');
  const response = await agent
    .post(`/api/v1/plan-versions/${id}/transitions`)
    .set(writeHeaders(`transition-${id}-${event.type}`)).set('Authorization', `Bearer ${roleToken}`)
    .send(event)
    .expect(200);
  expect(response.body.status).toBe(expectedStatus);
  return response.body;
}

function writeHeaders(requestId: string) {
  return { 'x-request-id': requestId, 'idempotency-key': requestId };
}

async function seedPlanFixture(
  target: INestApplication,
  agent: Agent,
  options: { qualifiedReviewers?: boolean } = {},
): Promise<void> {
  const database = target.get(DatabaseService).database;
  const passwordHash = await hashPassword('seed-password-1', policy);
  for (const [id, accountType, role] of [
    ['operations', 'STAFF', 'OPERATIONS'],
    ['nutrition', 'STAFF', 'NUTRITION_REVIEWER'],
    ['training', 'STAFF', 'TRAINING_REVIEWER'],
    ['screening-reviewer', 'STAFF', 'NUTRITION_REVIEWER'],
    ['user-1', 'USER', null], ['user-2', 'USER', null], ['user-3', 'USER', null],
    ['user-4', 'USER', null], ['user-5', 'USER', null], ['user-6', 'USER', null],
    ['persona_fat_loss', 'USER', null], ['persona_muscle_gain', 'USER', null],
  ] as const) {
    await database.query(
      `INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
       VALUES ($1, $1, $2, $3, 'ACTIVE', false)`,
      [id, passwordHash, accountType],
    );
    if (role) {
      await database.query(`INSERT INTO iam.account_role (account_id, role_code) VALUES ($1, $2)`, [id, role]);
    }
  }
  if (options.qualifiedReviewers !== false) {
    await database.query(
      `UPDATE iam.account_role SET qualified_at=now()
       WHERE account_id IN ('nutrition', 'training')`,
    );
  }
  await database.query(
    `UPDATE iam.account_role SET qualified_at=now() WHERE account_id='screening-reviewer'`,
  );
  for (const userId of [
    'user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6',
    'persona_fat_loss', 'persona_muscle_gain',
  ]) {
    await database.query(
      `INSERT INTO care.consent_record (id, user_id, consent_version, accepted_at)
       VALUES ($1, $2, 'consent-v1', now())`,
      [`consent-${userId}`, userId],
    );
    await database.query(
      `INSERT INTO care.screening_result
         (id, user_id, conclusion, source, rule_version, recorded_by, actor_role)
       VALUES ($1, $2, 'PASS', 'MANUAL_REVIEW', 'fictional-plan-rule-v1', 'screening-reviewer', 'NUTRITION_REVIEWER')`,
      [`screening-${userId}`, userId],
    );
    await database.query(
      `INSERT INTO care.user_profile
         (id, user_id, profile_data, completed_steps, schema_version)
       VALUES ($1, $2, '{"fixture-ready":{"fixtureReady":true}}', '["fixture-ready"]', 'plan-fixture-profile-v1')`,
      [`profile-${userId}`, userId],
    );
  }
  for (const [id, kind, role] of [
    ['operations', 'STAFF', 'OPERATIONS'],
    ['nutrition', 'STAFF', 'NUTRITION_REVIEWER'],
    ['training', 'STAFF', 'TRAINING_REVIEWER'],
    ...[
      'user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6',
      'persona_fat_loss', 'persona_muscle_gain',
    ].map((id) => [id, 'USER', undefined]),
  ] as Array<[string, 'USER' | 'STAFF', string | undefined]>) {
    const response = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders(`login-${id}`))
      .send({ loginIdentifier: id, password: 'seed-password-1', sessionKind: kind, ...(role ? { actingRole: role } : {}) })
      .expect(201);
    tokens.set(id, response.body.sessionToken as string);
  }
}

async function login(
  agent: Agent,
  loginIdentifier: string,
  sessionKind: 'USER' | 'STAFF',
  actingRole: string | undefined,
  requestId: string,
): Promise<string> {
  const response = await agent.post('/api/v1/identity/sessions')
    .set(writeHeaders(requestId))
    .send({ loginIdentifier, password: 'seed-password-1', sessionKind, ...(actingRole ? { actingRole } : {}) })
    .expect(201);
  return response.body.sessionToken as string;
}

async function prepareReviewed(agent: Agent, id: string, userId: string) {
  await createPlan(agent, id, userId);
  await transition(agent, id, { type: 'SUBMIT_REVIEW' }, 'IN_REVIEW');
  await transition(
    agent,
    id,
    { type: 'APPROVE_DIET', actorId: 'nutrition-1' },
    'IN_REVIEW',
  );
  await transition(
    agent,
    id,
    { type: 'APPROVE_TRAINING', actorId: 'training-1' },
    'READY_TO_PUBLISH',
  );
}

async function prepareReviewedWithWindow(
  agent: Agent,
  id: string,
  userId: string,
  planEffectiveAt: string,
  planEffectiveTo: string,
) {
  await agent.post('/api/v1/plan-versions')
    .set(writeHeaders(`create-${id}`)).set('Authorization', `Bearer ${tokens.get('operations')}`)
    .send({
      id, userId, effectiveAt: planEffectiveAt, effectiveTo: planEffectiveTo, contentMode: 'REVIEWED',
    }).expect(201);
  planUsers.set(id, userId);
  await transition(agent, id, { type: 'SUBMIT_REVIEW' }, 'IN_REVIEW');
  await transition(agent, id, { type: 'APPROVE_DIET' }, 'IN_REVIEW');
  await transition(agent, id, { type: 'APPROVE_TRAINING' }, 'READY_TO_PUBLISH');
}

async function planReadSideEffectCounts(database: DatabaseService['database']) {
  const result = await database.query<{ plans: string; audits: string; idempotency: string }>(
    `SELECT
       (SELECT count(*)::text FROM planning.plan_version) AS plans,
       (SELECT count(*)::text FROM audit.audit_event) AS audits,
       (SELECT count(*)::text FROM audit.idempotency_key) AS idempotency`,
  );
  return result.rows;
}

async function preparePublished(agent: Agent, id: string, userId: string) {
  await prepareReviewed(agent, id, userId);
  await transition(
    agent,
    id,
    { type: 'PUBLISH', occurredAt: publishAt },
    'PENDING_CONFIRMATION',
  );
}
