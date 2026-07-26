import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApplication } from './build-test-application.js';
import type { Environment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';

const environment: Environment = {
  nodeEnv: 'test',
  port: 3000,
  databasePath: 'memory://',
  demoMode: false,
  professionalRulesApproved: false,
  authSecurityPolicyApproved: true,
  privacyReviewApproved: true,
  dataRightsDrillComplete: false,
  backupRestoreDrillComplete: false,
  operationsReadinessApproved: false,
  deploymentSecurityApproved: false,
};

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

describe('identity recovery API', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('creates only a restricted password-change context for an invited user', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedUser(app, 'invited-user', 'INVITED', true);
    const agent = request(app.getHttpServer());

    const response = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('restricted-login'))
      .send({ loginIdentifier: 'invited-user', password: 'seed-password-1', sessionKind: 'USER' })
      .expect(201);

    expect(response.body).toMatchObject({
      businessStatus: 'PASSWORD_CHANGE_REQUIRED',
      nextAction: 'CHANGE_INITIAL_PASSWORD',
      expectedVersion: 1,
    });
    expect(response.body.passwordChangeToken).toEqual(expect.any(String));
    expect(response.body.sessionToken).toBeUndefined();
    expect(response.body.expiresAt).toEqual(expect.any(String));
    const ttlMs = Date.parse(response.body.expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(policy.passwordChangeTtlSeconds * 1000);
    expect(ttlMs).toBeLessThan(policy.sessionTtlSeconds * 1000);
  });

  it('consumes the restricted context atomically and cannot replay it as a full session', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedUser(app, 'change-user', 'INVITED', true);
    const agent = request(app.getHttpServer());
    const restricted = await loginRestricted(agent, 'change-user', 'change-login');

    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('restricted-consent')).set('Authorization', `Bearer ${restricted.token}`)
      .send({ consentVersion: 'consent-v1' })
      .expect(401)
      .expect(({ body }) => expect(body.errorCode).toBe('SESSION_INVALID'));
    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(writeHeaders('restricted-profile')).set('Authorization', `Bearer ${restricted.token}`)
      .send({ expectedVersion: 0, data: {} })
      .expect(401)
      .expect(({ body }) => expect(body.errorCode).toBe('SESSION_INVALID'));
    await agent.post('/api/v1/plan-versions')
      .set(writeHeaders('restricted-plan')).set('Authorization', `Bearer ${restricted.token}`)
      .send({ id: 'restricted-plan', userId: 'change-user', effectiveAt: '2026-08-10T00:00:00.000Z' })
      .expect(401)
      .expect(({ body }) => expect(body.errorCode).toBe('SESSION_INVALID'));

    const changed = await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('change-password')).set('Authorization', `Bearer ${restricted.token}`)
      .send({ newPassword: 'changed-password-1', expectedVersion: restricted.expectedVersion })
      .expect(200);
    expect(changed.body).toMatchObject({
      businessStatus: 'SESSION_CREATED',
      nextAction: 'ACCEPT_CURRENT_CONSENT',
    });
    expect(changed.body.sessionToken).toEqual(expect.any(String));

    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('change-replay')).set('Authorization', `Bearer ${restricted.token}`)
      .send({ newPassword: 'other-password-1', expectedVersion: restricted.expectedVersion })
      .expect(401)
      .expect(({ body }) => expect(body.errorCode).toBe('PASSWORD_CHANGE_TOKEN_INVALID'));

    const sessions = await app.get(DatabaseService).database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM iam.session
       WHERE account_id='change-user' AND session_scope='FULL' AND revoked_at IS NULL`,
    );
    expect(sessions.rows[0]?.count).toBe(1);
    const stored = await app.get(DatabaseService).database.query<{ result: string }>(
      `SELECT result FROM audit.idempotency_key WHERE key='change-password'`,
    );
    expect(JSON.stringify(stored.rows[0]?.result)).not.toContain(changed.body.sessionToken);
  });

  it('recovers only the active role and server-derived next action, then logs out idempotently', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedUser(app, 'active-user', 'ACTIVE', false);
    const agent = request(app.getHttpServer());
    const token = await loginFull(agent, 'active-user', 'active-login');

    const session = await agent.get('/api/v1/identity/session')
      .set(writeHeaders('session-recovery'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(session.body).toMatchObject({
      accountId: 'active-user',
      accountType: 'USER',
      activeRole: 'USER',
      businessStatus: 'SESSION_ACTIVE',
      nextAction: 'ACCEPT_CURRENT_CONSENT',
    });
    expect(session.body.roles).toBeUndefined();

    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('active-consent')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v1' })
      .expect(201);
    await agent.get('/api/v1/identity/session')
      .set(writeHeaders('session-after-consent')).set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => expect(body.nextAction).toBe('WAIT_FOR_SCREENING_RULES'));

    await agent.post('/api/v1/identity/session/logout')
      .set(writeHeaders('logout-first')).set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200)
      .expect(({ body }) => expect(body.businessStatus).toBe('SESSION_ENDED'));
    await agent.post('/api/v1/identity/session/logout')
      .set(writeHeaders('logout-second')).set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200)
      .expect(({ body }) => expect(body.businessStatus).toBe('SESSION_ENDED'));
    await agent.get('/api/v1/identity/session')
      .set(writeHeaders('session-after-logout'))
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a stale consent version instead of trusting the client', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedUser(app, 'consent-user', 'ACTIVE', false);
    const agent = request(app.getHttpServer());
    const token = await loginFull(agent, 'consent-user', 'consent-login');

    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('stale-consent')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v0' })
      .expect(409)
      .expect(({ body }) => expect(body.errorCode).toBe('CURRENT_CONSENT_VERSION_REQUIRED'));

    const rows = await app.get(DatabaseService).database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM care.consent_record WHERE user_id='consent-user'`,
    );
    expect(rows.rows[0]?.count).toBe(0);
  });

  it('expires password-change contexts on their independent short TTL', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedUser(app, 'expired-change-user', 'INVITED', true);
    const agent = request(app.getHttpServer());
    const restricted = await loginRestricted(agent, 'expired-change-user', 'expired-change-login');
    await app.get(DatabaseService).database.query(
      `UPDATE iam.session SET expires_at=now() - interval '1 second'
       WHERE account_id='expired-change-user' AND session_scope='PASSWORD_CHANGE'`,
    );

    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('expired-change')).set('Authorization', `Bearer ${restricted.token}`)
      .send({ newPassword: 'changed-password-1', expectedVersion: restricted.expectedVersion })
      .expect(401)
      .expect(({ body }) => expect(body.errorCode).toBe('PASSWORD_CHANGE_TOKEN_INVALID'));
  });

  it.each(['EXPIRED', 'DISABLED'] as const)('rejects %s full-session recovery without business data', async (state) => {
    app = await buildApplication(environment, { authPolicy: policy });
    const accountId = `${state.toLowerCase()}-session-user`;
    await seedUser(app, accountId, 'ACTIVE', false);
    const agent = request(app.getHttpServer());
    const token = await loginFull(agent, accountId, `${state}-login`);
    if (state === 'EXPIRED') {
      await app.get(DatabaseService).database.query(
        `UPDATE iam.session SET expires_at=now() - interval '1 second' WHERE account_id=$1`, [accountId],
      );
    } else {
      await app.get(DatabaseService).database.query(`UPDATE iam.account SET status='DISABLED' WHERE id=$1`, [accountId]);
    }
    const requestId = `${state.toLowerCase()}-recovery`;
    const response = await agent.get('/api/v1/identity/session')
      .set(writeHeaders(requestId)).set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(response.body).toMatchObject({ errorCode: 'SESSION_INVALID', requestId });
    expect(response.body.accountId).toBeUndefined();
    expect(response.body.nextAction).toBeUndefined();
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-session'],
  ])('audits %s logout token rejection', async (_label, token) => {
    app = await buildApplication(environment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    const requestId = `logout-${_label}`;
    const call = agent.post('/api/v1/identity/session/logout').set(writeHeaders(requestId)).send({});
    if (token) call.set('Authorization', `Bearer ${token}`);
    await call.expect(401).expect(({ body }) => expect(body).toMatchObject({ errorCode: 'SESSION_INVALID', requestId }));
    const audit = await app.get(DatabaseService).database.query<{ error_code: string; outcome: string }>(
      `SELECT error_code, outcome FROM audit.audit_event WHERE request_id=$1`, [requestId],
    );
    expect(audit.rows).toEqual([{ error_code: 'SESSION_INVALID', outcome: 'REJECTED' }]);
  });

  it('audits a restricted token rejected by logout', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedUser(app, 'restricted-logout-user', 'INVITED', true);
    const agent = request(app.getHttpServer());
    const restricted = await loginRestricted(agent, 'restricted-logout-user', 'restricted-login');
    await agent.post('/api/v1/identity/session/logout')
      .set(writeHeaders('restricted-logout')).set('Authorization', `Bearer ${restricted.token}`)
      .send({}).expect(401);
    const audit = await app.get(DatabaseService).database.query<{ error_code: string; outcome: string }>(
      `SELECT error_code, outcome FROM audit.audit_event WHERE request_id='restricted-logout'`,
    );
    expect(audit.rows).toEqual([{ error_code: 'SESSION_INVALID', outcome: 'REJECTED' }]);
  });
});

function writeHeaders(requestId: string) {
  return { 'x-request-id': requestId, 'idempotency-key': requestId };
}

async function seedUser(
  target: INestApplication,
  accountId: string,
  status: 'INVITED' | 'ACTIVE',
  initialPasswordChangeRequired: boolean,
) {
  const passwordHash = await hashPassword('seed-password-1', policy);
  await target.get(DatabaseService).database.query(
    `INSERT INTO iam.account
       (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
     VALUES ($1, $1, $2, 'USER', $3, $4)`,
    [accountId, passwordHash, status, initialPasswordChangeRequired],
  );
}

async function loginRestricted(agent: ReturnType<typeof request>, accountId: string, requestId: string) {
  const response = await agent.post('/api/v1/identity/sessions')
    .set(writeHeaders(requestId))
    .send({ loginIdentifier: accountId, password: 'seed-password-1', sessionKind: 'USER' })
    .expect(201);
  return {
    token: response.body.passwordChangeToken as string,
    expectedVersion: response.body.expectedVersion as number,
  };
}

async function loginFull(agent: ReturnType<typeof request>, accountId: string, requestId: string): Promise<string> {
  const response = await agent.post('/api/v1/identity/sessions')
    .set(writeHeaders(requestId))
    .send({ loginIdentifier: accountId, password: 'seed-password-1', sessionKind: 'USER' })
    .expect(201);
  return response.body.sessionToken as string;
}
