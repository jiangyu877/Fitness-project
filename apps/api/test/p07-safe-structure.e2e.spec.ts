import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApplication } from './build-test-application.js';
import type { Environment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';

const environment: Environment = {
  nodeEnv: 'test', port: 3000, databasePath: 'memory://', demoMode: false,
  professionalRulesApproved: true, authSecurityPolicyApproved: true,
  privacyReviewApproved: true, dataRightsDrillComplete: false,
  backupRestoreDrillComplete: false, operationsReadinessApproved: false,
  deploymentSecurityApproved: false,
};
const policy: AuthSecurityPolicy = {
  approved: true, passwordMinLength: 10, sessionTtlSeconds: 900,
  passwordChangeTtlSeconds: 300, maxFailedAttempts: 3, mfaRequiredForStaff: false,
  scryptCost: 16_384, scryptBlockSize: 8, scryptParallelization: 1, scryptKeyLength: 32,
};
const consentProvider = {
  getCurrentConsent: async () => ({ version: 'consent-approved-v1', content: { format: 'PLAIN_TEXT' as const, text: 'FICTIONAL TEST CONSENT' } }),
};
const screeningProvider = { isApprovedConclusion: async () => true };
const profileSchemaProvider = {
  getApprovedProfileSchema: async () => ({
    version: 'profile-test-v1',
    steps: [
      { id: 'basics', fields: [{ name: 'testLabel', type: 'STRING' as const, required: true }] },
      { id: 'preferences', fields: [{ name: 'testFlag', type: 'BOOLEAN' as const, required: true }] },
    ],
  }),
};

describe('P07 safe structure', () => {
  let app: INestApplication | undefined;
  afterEach(async () => app?.close());

  it('fails closed without an approved consent provider', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedUser(app, 'blocked-fixture');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'blocked-fixture');
    await agent.get('/api/v1/onboarding/consents/current')
      .set(headers('missing-consent-provider')).set('Authorization', `Bearer ${token}`)
      .expect(503).expect(({ body }) => expect(body).toMatchObject({
        errorCode: 'CURRENT_CONSENT_VERSION_UNAVAILABLE', recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
      }));
  });

  it('blocks profile, plan creation, and task candidates by default in test without providers', async () => {
    app = await buildApplication(environment, { authPolicy: policy, profileFingerprintSecret: 'blocked-profile-secret' });
    await seedUser(app, 'default-blocked-user');
    await seedOperations(app, 'default-blocked-operations');
    const agent = request(app.getHttpServer());
    const userToken = await login(agent, 'default-blocked-user');
    const staffToken = await loginStaff(agent, 'default-blocked-operations');

    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(headers('blocked-profile')).set('Authorization', `Bearer ${userToken}`)
      .send({ schemaVersion: 'forged-schema', expectedVersion: 0, data: {} })
      .expect(503);
    await agent.post('/api/v1/onboarding/consents')
      .set(headers('blocked-consent')).set('Authorization', `Bearer ${userToken}`)
      .send({ consentVersion: 'consent-v1' })
      .expect(503).expect(({ body }) => expect(body.errorCode).toBe('CURRENT_CONSENT_VERSION_UNAVAILABLE'));
    await agent.post('/api/v1/plan-versions')
      .set(headers('blocked-plan')).set('Authorization', `Bearer ${staffToken}`)
      .send({
        id: 'blocked-plan-v1', userId: 'default-blocked-user', contentMode: 'REVIEWED',
        effectiveAt: '2026-08-10T00:00:00.000Z', effectiveTo: '2026-08-17T00:00:00.000Z',
      }).expect(409).expect(({ body }) => expect(body.errorCode).toBe('ONBOARDING_NOT_READY'));
    await agent.get('/api/v1/users/default-blocked-user/task-candidates')
      .set(headers('blocked-tasks')).set('Authorization', `Bearer ${userToken}`)
      .expect(200).expect(({ body }) => expect(body).toEqual({
        businessStatus: 'PLAN_GAP', planVersion: null, items: [],
      }));

    const counts = await app.get(DatabaseService).database.query<{ consents: number; plans: number; profiles: number; idempotency: number }>(`
      SELECT
        (SELECT count(*)::int FROM care.consent_record WHERE user_id='default-blocked-user') AS consents,
        (SELECT count(*)::int FROM planning.plan_version WHERE user_id='default-blocked-user') AS plans,
        (SELECT count(*)::int FROM care.user_profile WHERE user_id='default-blocked-user') AS profiles,
        (SELECT count(*)::int FROM audit.idempotency_key WHERE key IN ('blocked-consent','blocked-profile','blocked-plan')) AS idempotency
    `);
    expect(counts.rows[0]).toEqual({ consents: 0, plans: 0, profiles: 0, idempotency: 0 });
  });

  it('reads provider-approved consent content and rejects an old version', async () => {
    app = await buildApplication(environment, { authPolicy: policy, consentProvider } as never);
    await seedUser(app, 'fat-loss-fixture');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'fat-loss-fixture');

    await agent.get('/api/v1/onboarding/consents/current')
      .set(headers('current-consent')).set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'CURRENT_CONSENT_AVAILABLE', consentVersion: 'consent-approved-v1',
        content: { format: 'PLAIN_TEXT', text: 'FICTIONAL TEST CONSENT' },
      }));
    await agent.post('/api/v1/onboarding/consents')
      .set(headers('old-consent')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v0' }).expect(409)
      .expect(({ body }) => expect(body).toMatchObject({ errorCode: 'CURRENT_CONSENT_VERSION_REQUIRED', recoverableActions: ['REFRESH'] }));

    const accept = () => agent.post('/api/v1/onboarding/consents')
      .set(headers('same-consent-intent')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-approved-v1' });
    const [first, replay] = await Promise.all([accept(), accept()]);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.body).toEqual(first.body);
    const persisted = await app.get(DatabaseService).database.query<{ consents: number; audits: number }>(`
      SELECT
        (SELECT count(*)::int FROM care.consent_record WHERE user_id='fat-loss-fixture') AS consents,
        (SELECT count(*)::int FROM audit.audit_event WHERE request_id='same-consent-intent' AND action='CONSENT_ACCEPTED') AS audits
    `);
    expect(persisted.rows[0]).toEqual({ consents: 1, audits: 1 });
    await agent.get('/api/v1/identity/session').set(headers('post-consent-session'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body.nextAction).toBe('WAIT_FOR_SCREENING_RULES'));

    await agent.post('/api/v1/onboarding/screening-results')
      .set(headers('user-screening-write')).set('Authorization', `Bearer ${token}`)
      .send({ userId: 'fat-loss-fixture', conclusion: 'PASS', source: 'MANUAL_REVIEW', ruleVersion: 'fictional-rule-v1' })
      .expect(401).expect(({ body }) => expect(body.errorCode).toBe('SESSION_INVALID'));
    const deniedWrites = await app.get(DatabaseService).database.query<{ screenings: number; plans: number }>(`
      SELECT
        (SELECT count(*)::int FROM care.screening_result WHERE user_id='fat-loss-fixture') AS screenings,
        (SELECT count(*)::int FROM planning.plan_version WHERE user_id='fat-loss-fixture') AS plans
    `);
    expect(deniedWrites.rows[0]).toEqual({ screenings: 0, plans: 0 });
  });

  it('derives HUMAN_REVIEW and EXCLUDED only from trusted persisted conclusions', async () => {
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider, screeningProvider, profileSchemaProvider,
      profileFingerprintSecret: 'fictional-profile-secret',
    } as never);
    await seedUser(app, 'muscle-gain-fixture');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'muscle-gain-fixture');
    await acceptConsent(agent, token);

    await seedScreening(app, 'muscle-gain-fixture', 'HUMAN_REVIEW');
    await agent.get('/api/v1/identity/session').set(headers('review-session'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body.nextAction).toBe('WAIT_FOR_HUMAN_REVIEW'));
    await expectBlockedUserFlow(agent, token, 'muscle-gain-fixture', 'review');
    await seedScreening(app, 'muscle-gain-fixture', 'EXCLUDED');
    await agent.get('/api/v1/identity/session').set(headers('excluded-session'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body.nextAction).toBe('STOP_SERVICE_FLOW'));
    await expectBlockedUserFlow(agent, token, 'muscle-gain-fixture', 'excluded');
    const blockedCounts = await app.get(DatabaseService).database.query<{ profiles: number; plans: number }>(`
      SELECT
        (SELECT count(*)::int FROM care.user_profile WHERE user_id='muscle-gain-fixture') AS profiles,
        (SELECT count(*)::int FROM planning.plan_version WHERE user_id='muscle-gain-fixture') AS plans
    `);
    expect(blockedCounts.rows[0]).toEqual({ profiles: 0, plans: 0 });
  });

  it('blocks PASS when the approved profile schema provider is unavailable', async () => {
    app = await buildApplication(environment, { authPolicy: policy, consentProvider, screeningProvider } as never);
    await seedUser(app, 'schema-missing-fixture');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'schema-missing-fixture');
    await acceptConsent(agent, token);
    await seedScreening(app, 'schema-missing-fixture', 'PASS');
    await agent.get('/api/v1/identity/session').set(headers('schema-missing-session'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body.nextAction).toBe('CONTACT_OPERATIONS'));
    await expectBlockedUserFlow(agent, token, 'schema-missing-fixture', 'schema-missing');
  });

  it.each([
    ['blank version', { version: ' ', steps: [{ id: 'basics', fields: [{ name: 'label', type: 'STRING' as const }] }] }],
    ['duplicate step', { version: 'v1', steps: [{ id: 'basics', fields: [{ name: 'label', type: 'STRING' as const }] }, { id: 'basics', fields: [{ name: 'flag', type: 'BOOLEAN' as const }] }] }],
    ['empty fields', { version: 'v1', steps: [{ id: 'basics', fields: [] }] }],
  ])('does not advance with malformed provider schema: %s', async (_case, schema) => {
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider, screeningProvider,
      profileSchemaProvider: { getApprovedProfileSchema: async () => schema },
    } as never);
    const userId = `malformed-${_case.replace(' ', '-')}`;
    await seedUser(app, userId);
    const agent = request(app.getHttpServer());
    const token = await login(agent, userId);
    await acceptConsent(agent, token);
    await seedScreening(app, userId, 'PASS');
    await agent.get('/api/v1/identity/session').set(headers(`malformed-session-${userId}`))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body.nextAction).toBe('CONTACT_OPERATIONS'));
    await expectBlockedUserFlow(agent, token, userId, `malformed-${userId}`);
  });

  it('restores and validates only approved profile schema fields', async () => {
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider, screeningProvider, profileSchemaProvider,
      profileFingerprintSecret: 'fictional-profile-secret',
    } as never);
    await seedUser(app, 'profile-fixture');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'profile-fixture');
    await acceptConsent(agent, token);
    await seedScreening(app, 'profile-fixture', 'PASS');

    await agent.put('/api/v1/onboarding/profile/steps/unknown')
      .set(headers('unknown-step')).set('Authorization', `Bearer ${token}`)
      .send({ schemaVersion: 'profile-test-v1', expectedVersion: 0, data: {} })
      .expect(422);
    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(headers('unknown-schema')).set('Authorization', `Bearer ${token}`)
      .send({ schemaVersion: 'unknown-schema', expectedVersion: 0, data: { testLabel: 'value' } })
      .expect(409);
    const invalid = await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(headers('unknown-field')).set('Authorization', `Bearer ${token}`)
      .send({ schemaVersion: 'profile-test-v1', expectedVersion: 0, data: { unapproved: 'value' } });
    expect(invalid.status, JSON.stringify(invalid.body)).toBe(422);
    expect(invalid.body.errorCode).toBe('PROFILE_SCHEMA_VALIDATION_FAILED');
    const invalidCounts = await app.get(DatabaseService).database.query<{ profiles: number; idempotency: number }>(`
      SELECT
        (SELECT count(*)::int FROM care.user_profile WHERE user_id='profile-fixture') AS profiles,
        (SELECT count(*)::int FROM audit.idempotency_key WHERE key IN ('unknown-step','unknown-schema','unknown-field')) AS idempotency
    `);
    expect(invalidCounts.rows[0]).toEqual({ profiles: 0, idempotency: 0 });
    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(headers('save-basics')).set('Authorization', `Bearer ${token}`)
      .send({ schemaVersion: 'profile-test-v1', expectedVersion: 0, data: { testLabel: 'fictional-profile-value' } })
      .expect(200);
    const securityRecords = await app.get(DatabaseService).database.query<{ request_fingerprint: string; audit_payload: string }>(`
      SELECT i.request_fingerprint,
        (SELECT coalesce(json_agg(a)::text, '[]') FROM audit.audit_event a WHERE a.request_id='save-basics') AS audit_payload
      FROM audit.idempotency_key i WHERE i.key='save-basics'
    `);
    expect(JSON.stringify(securityRecords.rows)).not.toContain('fictional-profile-value');
    await agent.get('/api/v1/onboarding/profile').set(headers('read-profile'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        businessStatus: 'PROFILE_DRAFT_AVAILABLE', schemaVersion: 'profile-test-v1',
        recordVersion: 1, completedSteps: ['basics'], currentStep: 'preferences',
        drafts: { basics: { testLabel: 'fictional-profile-value' } },
      }));

    await agent.put('/api/v1/onboarding/profile/steps/preferences')
      .set(headers('stale-profile')).set('Authorization', `Bearer ${token}`)
      .send({ schemaVersion: 'profile-test-v1', expectedVersion: 0, data: { testFlag: true } })
      .expect(409).expect(({ body }) => expect(body.errorCode).toBe('VERSION_CONFLICT'));
    await agent.put('/api/v1/onboarding/profile/steps/preferences')
      .set(headers('complete-profile')).set('Authorization', `Bearer ${token}`)
      .send({ schemaVersion: 'profile-test-v1', expectedVersion: 1, data: { testFlag: true } })
      .expect(200);
    await agent.get('/api/v1/identity/session').set(headers('completed-session'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body.nextAction).toBe('WAIT_FOR_PLAN'));
    await agent.get('/api/v1/users/profile-fixture/task-candidates').set(headers('completed-tasks'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect({ businessStatus: 'PLAN_GAP', planVersion: null, items: [] });
    const completedCounts = await app.get(DatabaseService).database.query<{ plans: number }>(
      `SELECT count(*)::int AS plans FROM planning.plan_version WHERE user_id='profile-fixture'`,
    );
    expect(completedCounts.rows[0]?.plans).toBe(0);
  });

  it('rejects anonymous and STAFF access to USER-scoped P07 reads', async () => {
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider, screeningProvider, profileSchemaProvider,
      profileFingerprintSecret: 'fictional-profile-secret',
    } as never);
    await seedOperations(app, 'p07-staff-fixture');
    const agent = request(app.getHttpServer());
    const staffToken = await loginStaff(agent, 'p07-staff-fixture');
    for (const path of ['/api/v1/onboarding/consents/current', '/api/v1/onboarding/screening-status', '/api/v1/onboarding/profile']) {
      await agent.get(path).set(headers(`anonymous-${path}`)).expect(401);
      await agent.get(path).set(headers(`staff-${path}`)).set('Authorization', `Bearer ${staffToken}`)
        .expect(401).expect(({ body }) => expect(body.errorCode).toBe('SESSION_INVALID'));
    }
  });

  it('returns CONTACT_OPERATIONS without a failed response after screening provider failure', async () => {
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider,
      screeningProvider: { isApprovedConclusion: async () => { throw new Error('provider unavailable'); } },
      profileSchemaProvider,
    } as never);
    await seedUser(app, 'screening-provider-error');
    await app.get(DatabaseService).database.query(
      `INSERT INTO care.consent_record (id,user_id,consent_version,accepted_at)
       VALUES ('provider-error-consent','screening-provider-error','consent-approved-v1',now())`,
    );
    await seedQualifiedReviewer(app, 'provider-error-reviewer');
    await seedScreeningBy(app, 'screening-provider-error', 'PASS', 'provider-error-reviewer');
    const agent = request(app.getHttpServer());
    await agent.post('/api/v1/identity/sessions').set(headers('provider-error-login'))
      .send({ loginIdentifier: 'screening-provider-error', password: 'seed-password-1', sessionKind: 'USER' })
      .expect(201).expect(({ body }) => expect(body.nextAction).toBe('CONTACT_OPERATIONS'));
    const writes = await app.get(DatabaseService).database.query<{ sessions: number; idempotency: number; audits: number }>(`
      SELECT
        (SELECT count(*)::int FROM iam.session WHERE account_id='screening-provider-error') AS sessions,
        (SELECT count(*)::int FROM audit.idempotency_key WHERE key='provider-error-login') AS idempotency,
        (SELECT count(*)::int FROM audit.audit_event WHERE request_id='provider-error-login' AND outcome='SUCCEEDED') AS audits
    `);
    expect(writes.rows[0]).toEqual({ sessions: 1, idempotency: 1, audits: 1 });
  });

  it('does not expose or merge legacy profile JSON without a schema version', async () => {
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider, screeningProvider, profileSchemaProvider,
      profileFingerprintSecret: 'legacy-profile-secret',
    } as never);
    await seedUser(app, 'legacy-profile-user');
    await seedQualifiedReviewer(app, 'legacy-profile-reviewer');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'legacy-profile-user');
    await acceptConsent(agent, token);
    await seedScreeningBy(app, 'legacy-profile-user', 'PASS', 'legacy-profile-reviewer');
    await app.get(DatabaseService).database.query(
      `INSERT INTO care.user_profile (id,user_id,profile_data,completed_steps,schema_version)
       VALUES ('legacy-profile','legacy-profile-user','{"basics":{"legacySecret":"must-not-leak"}}','["basics"]',NULL)`,
    );

    const get = await agent.get('/api/v1/onboarding/profile').set(headers('legacy-profile-get'))
      .set('Authorization', `Bearer ${token}`).expect(503);
    expect(JSON.stringify(get.body)).not.toContain('must-not-leak');
    await agent.put('/api/v1/onboarding/profile/steps/basics').set(headers('legacy-profile-put'))
      .set('Authorization', `Bearer ${token}`)
      .send({ schemaVersion: 'profile-test-v1', expectedVersion: 0, data: { testLabel: 'new-value' } })
      .expect(503);
    const persisted = await app.get(DatabaseService).database.query<{ schema_version: string | null; profile_data: unknown; idempotency: number }>(`
      SELECT schema_version, profile_data,
        (SELECT count(*)::int FROM audit.idempotency_key WHERE key='legacy-profile-put') AS idempotency
      FROM care.user_profile WHERE user_id='legacy-profile-user'
    `);
    expect(persisted.rows[0]).toMatchObject({ schema_version: null, idempotency: 0 });
    expect(JSON.stringify(persisted.rows[0]?.profile_data)).toContain('must-not-leak');
    expect(JSON.stringify(persisted.rows[0]?.profile_data)).not.toContain('new-value');
  });

  it('rejects a screening conclusion recorded by the USER without reviewer qualification evidence', async () => {
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider, screeningProvider, profileSchemaProvider,
    } as never);
    await seedUser(app, 'self-screened-user');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'self-screened-user');
    await acceptConsent(agent, token);
    await seedScreeningBy(app, 'self-screened-user', 'PASS', 'self-screened-user');
    await agent.get('/api/v1/identity/session').set(headers('self-screened-session'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body.nextAction).toBe('CONTACT_OPERATIONS'));
  });

  it('pins an immutable consent snapshot against caller mutation', async () => {
    const mutable = { version: 'consent-original', content: { format: 'PLAIN_TEXT' as const, text: 'ORIGINAL TEXT' } };
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider: { getCurrentConsent: async () => mutable },
    } as never);
    mutable.version = 'consent-mutated';
    mutable.content.text = 'MUTATED TEXT';
    await seedUser(app, 'consent-mutation-user');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'consent-mutation-user');
    await agent.get('/api/v1/onboarding/consents/current').set(headers('consent-mutation-get'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        consentVersion: 'consent-original', content: { format: 'PLAIN_TEXT', text: 'ORIGINAL TEXT' },
      }));
  });

  it('pins an immutable profile schema snapshot against caller mutation', async () => {
    const mutableSchema = {
      version: 'profile-original',
      steps: [{ id: 'original-step', fields: [{ name: 'originalField', type: 'STRING' as const, required: true }] }],
    };
    app = await buildApplication(environment, {
      authPolicy: policy, consentProvider, screeningProvider,
      profileSchemaProvider: { getApprovedProfileSchema: async () => mutableSchema },
    } as never);
    mutableSchema.version = 'profile-mutated';
    mutableSchema.steps[0]!.id = 'mutated-step';
    mutableSchema.steps[0]!.fields[0]!.name = 'mutatedField';
    await seedUser(app, 'profile-schema-mutation-user');
    await seedQualifiedReviewer(app, 'profile-schema-mutation-reviewer');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'profile-schema-mutation-user');
    await acceptConsent(agent, token);
    await seedScreeningBy(app, 'profile-schema-mutation-user', 'PASS', 'profile-schema-mutation-reviewer');
    await agent.get('/api/v1/onboarding/profile').set(headers('profile-schema-mutation-get'))
      .set('Authorization', `Bearer ${token}`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        schemaVersion: 'profile-original',
        steps: [{ id: 'original-step', fields: [{ name: 'originalField', type: 'STRING', required: true }] }],
      }));
  });
});

function headers(requestId: string) { return { 'x-request-id': requestId, 'idempotency-key': requestId }; }
async function seedUser(app: INestApplication, id: string) {
  const hash = await hashPassword('seed-password-1', policy);
  await app.get(DatabaseService).database.query(
    `INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
     VALUES ($1,$1,$2,'USER','ACTIVE',false)`, [id, hash]);
}
async function seedOperations(app: INestApplication, id: string) {
  const hash = await hashPassword('seed-password-1', policy);
  await app.get(DatabaseService).database.exec(`
    INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ('${id}','${id}','${hash}','STAFF','ACTIVE',false);
    INSERT INTO iam.account_role (account_id, role_code) VALUES ('${id}','OPERATIONS');
  `);
}
async function login(agent: ReturnType<typeof request>, id: string) {
  const response = await agent.post('/api/v1/identity/sessions').set(headers(`login-${id}`))
    .send({ loginIdentifier: id, password: 'seed-password-1', sessionKind: 'USER' }).expect(201);
  return response.body.sessionToken as string;
}
async function loginStaff(agent: ReturnType<typeof request>, id: string) {
  const response = await agent.post('/api/v1/identity/sessions').set(headers(`login-${id}`))
    .send({ loginIdentifier: id, password: 'seed-password-1', sessionKind: 'STAFF', actingRole: 'OPERATIONS' }).expect(201);
  return response.body.sessionToken as string;
}
async function acceptConsent(agent: ReturnType<typeof request>, token: string) {
  await agent.post('/api/v1/onboarding/consents').set(headers(`consent-${token.slice(0, 6)}`))
    .set('Authorization', `Bearer ${token}`).send({ consentVersion: 'consent-approved-v1' }).expect(201);
}
async function seedScreening(app: INestApplication, userId: string, conclusion: string) {
  const reviewerId = `reviewer-${userId}`;
  await seedQualifiedReviewer(app, reviewerId);
  await seedScreeningBy(app, userId, conclusion, reviewerId);
}
async function seedQualifiedReviewer(app: INestApplication, id: string) {
  const hash = await hashPassword('seed-password-1', policy);
  await app.get(DatabaseService).database.exec(`
    INSERT INTO iam.account (id,login_identifier,password_hash,account_type,status,initial_password_change_required)
    VALUES ('${id}','${id}','${hash}','STAFF','ACTIVE',false)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO iam.account_role (account_id,role_code,qualified_at)
    VALUES ('${id}','NUTRITION_REVIEWER',now())
    ON CONFLICT (account_id,role_code) DO UPDATE SET qualified_at=excluded.qualified_at;
  `);
}
async function seedScreeningBy(app: INestApplication, userId: string, conclusion: string, recordedBy: string) {
  await app.get(DatabaseService).database.query(
    `INSERT INTO care.screening_result (id,user_id,conclusion,source,rule_version,recorded_by,actor_role)
     VALUES ($1,$2,$3,'MANUAL_REVIEW','fictional-rule-v1',$4,'NUTRITION_REVIEWER')`,
    [`screening-${userId}-${conclusion}-${recordedBy}`, userId, conclusion, recordedBy],
  );
}
async function expectBlockedUserFlow(agent: ReturnType<typeof request>, token: string, userId: string, label: string) {
  await agent.get('/api/v1/onboarding/profile').set(headers(`${label}-profile`))
    .set('Authorization', `Bearer ${token}`).expect(503);
  await agent.get(`/api/v1/users/${userId}/task-candidates`).set(headers(`${label}-tasks`))
    .set('Authorization', `Bearer ${token}`).expect(200)
    .expect({ businessStatus: 'PLAN_GAP', planVersion: null, items: [] });
}
