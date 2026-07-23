import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApplication } from '../src/application.js';
import type { Environment } from '../src/config/environment.js';

const approvedEnvironment: Environment = {
  nodeEnv: 'test',
  port: 3000,
  databasePath: 'memory://',
  demoMode: false,
  professionalRulesApproved: true,
};

const effectiveAt = '2026-08-10T00:00:00.000Z';
const effectiveTo = '2026-08-17T00:00:00.000Z';
const publishAt = '2026-08-08T12:00:00.000Z';
const deadline = '2026-08-09T12:00:00.000Z';

describe('plan lifecycle HTTP API', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('runs draft through dual review, dual confirmation, waiting, and current', async () => {
    app = await buildApplication(approvedEnvironment);
    const agent = request(app.getHttpServer());

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
    await transition(
      agent,
      'plan-v1',
      { type: 'ACTIVATE', occurredAt: effectiveAt },
      'ACTIVE',
    );

    const current = await agent
      .get('/api/v1/users/user-1/plans/current')
      .query({ at: '2026-08-10T01:00:00.000Z' })
      .expect(200);
    expect(current.body.businessStatus).toBe('CURRENT_PLAN');
    expect(current.body.plan.id).toBe('plan-v1');
  });

  it('returns structured revision, timeout, history, and gap states', async () => {
    app = await buildApplication(approvedEnvironment);
    const agent = request(app.getHttpServer());

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
    await transition(
      agent,
      'plan-timeout',
      { type: 'EXPIRE_CONFIRMATION', occurredAt: deadline },
      'CONFIRMATION_TIMED_OUT',
    );

    const gap = await agent
      .get('/api/v1/users/user-2/plans/current')
      .query({ at: '2026-08-10T01:00:00.000Z' })
      .expect(200);
    expect(gap.body).toEqual({ businessStatus: 'PLAN_GAP', plan: null });

    const history = await agent
      .get('/api/v1/users/user-2/plans/history')
      .expect(200);
    expect(history.body.items.map((item: { status: string }) => item.status)).toEqual([
      'CONFIRMATION_TIMED_OUT',
      'STAFF_REVISION_REQUIRED',
    ]);
  });

  it('rejects an entire published version when either user part is rejected', async () => {
    app = await buildApplication(approvedEnvironment);
    const agent = request(app.getHttpServer());
    await preparePublished(agent, 'plan-user-rejected', 'user-3');

    const rejected = await transition(
      agent,
      'plan-user-rejected',
      {
        type: 'REJECT_TRAINING',
        occurredAt: '2026-08-09T10:00:00.000Z',
        reasonCode: 'SCHEDULE_CONFLICT',
      },
      'USER_REVISION_REQUIRED',
    );
    expect(rejected.rejectionReasonCode).toBe('SCHEDULE_CONFLICT');
  });

  it('blocks publication when professional rules remain unapproved', async () => {
    app = await buildApplication({
      ...approvedEnvironment,
      professionalRulesApproved: false,
    });
    const agent = request(app.getHttpServer());
    await prepareReviewed(agent, 'plan-blocked', 'user-4');

    const response = await agent
      .post('/api/v1/plan-versions/plan-blocked/transitions')
      .send({ type: 'PUBLISH', occurredAt: publishAt })
      .expect(409);
    expect(response.body).toMatchObject({
      businessStatus: 'PUBLICATION_BLOCKED',
      errorCode: 'PROFESSIONAL_RULES_UNAPPROVED',
      recoverableActions: ['WAIT_FOR_PROFESSIONAL_APPROVAL'],
    });
  });

  it('blocks a second pending version for the same user', async () => {
    app = await buildApplication(approvedEnvironment);
    const agent = request(app.getHttpServer());
    await preparePublished(agent, 'plan-first', 'user-5');
    await prepareReviewed(agent, 'plan-second', 'user-5');

    const response = await agent
      .post('/api/v1/plan-versions/plan-second/transitions')
      .send({ type: 'PUBLISH', occurredAt: publishAt })
      .expect(409);
    expect(response.body.errorCode).toBe('SINGLE_PENDING_VERSION_REQUIRED');
  });

  it('promotes a fully confirmed scheduled version when its effective time arrives', async () => {
    app = await buildApplication(approvedEnvironment);
    const agent = request(app.getHttpServer());
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
      .query({ at: effectiveAt })
      .expect(200);
    expect(current.body.businessStatus).toBe('CURRENT_PLAN');
    expect(current.body.plan).toMatchObject({ id: 'plan-auto-active', status: 'ACTIVE' });
  });
});

type Agent = ReturnType<typeof request>;

async function createPlan(agent: Agent, id: string, userId: string) {
  const response = await agent
    .post('/api/v1/plan-versions')
    .send({ id, userId, effectiveAt, effectiveTo, contentMode: 'REVIEWED' })
    .expect(201);
  return response.body;
}

async function transition(
  agent: Agent,
  id: string,
  event: Record<string, string>,
  expectedStatus: string,
) {
  const response = await agent
    .post(`/api/v1/plan-versions/${id}/transitions`)
    .send(event)
    .expect(200);
  expect(response.body.status).toBe(expectedStatus);
  return response.body;
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

async function preparePublished(agent: Agent, id: string, userId: string) {
  await prepareReviewed(agent, id, userId);
  await transition(
    agent,
    id,
    { type: 'PUBLISH', occurredAt: publishAt },
    'PENDING_CONFIRMATION',
  );
}
