import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApplication } from '../src/application.js';
import type { Environment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';
import type { MfaVerifier } from '../src/identity/mfa-verifier.js';

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
  maxFailedAttempts: 3,
  mfaRequiredForStaff: false,
  scryptCost: 16_384,
  scryptBlockSize: 8,
  scryptParallelization: 1,
  scryptKeyLength: 32,
};

describe('identity security hardening', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('requires a staff bearer session for invitations and leaves no anonymous side effect', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('anonymous-invite'))
      .send(userInvitation('anonymous-user'))
      .expect(401);

    expect(await accountCount(app, 'anonymous-user')).toBe(0);
  });

  it('derives invitation authority from the staff session and enforces role boundaries', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'operations-1', 'OPERATIONS');
    await seedActiveStaff(app, 'admin-1', 'SYSTEM_ADMIN');
    const agent = request(app.getHttpServer());
    const operationsToken = await login(agent, 'operations-1', 'seed-password-1', 'OPERATIONS');
    const adminToken = await login(agent, 'admin-1', 'seed-password-1', 'SYSTEM_ADMIN');

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('operations-user', { actorId: 'admin-1', actorRole: 'SYSTEM_ADMIN' }))
      .set('Authorization', `Bearer ${operationsToken}`)
      .send(userInvitation('user-by-operations'))
      .expect(201);

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('operations-staff'))
      .set('Authorization', `Bearer ${operationsToken}`)
      .send(staffInvitation('staff-by-operations', ['AUDIT_VIEWER']))
      .expect(403);

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('admin-staff'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send(staffInvitation('staff-by-admin', ['AUDIT_VIEWER']))
      .expect(201);

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('admin-user'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send(userInvitation('user-by-admin'))
      .expect(403);

    expect(await accountCount(app, 'staff-by-operations')).toBe(0);
    expect(await accountCount(app, 'user-by-admin')).toBe(0);
  });

  it('fails closed when staff MFA is required but no server verifier is configured', async () => {
    app = await buildApplication(environment, {
      authPolicy: { ...policy, mfaRequiredForStaff: true },
    });
    await seedActiveStaff(app, 'mfa-staff', 'SYSTEM_ADMIN');
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('mfa-self-report'))
      .send({
        loginIdentifier: 'mfa-staff',
        password: 'seed-password-1',
        sessionKind: 'STAFF',
        actingRole: 'SYSTEM_ADMIN',
        mfaVerified: true,
        unexpectedBypass: true,
      })
      .expect(403)
      .expect(({ body }) => expect(body.errorCode).toBe('MFA_VERIFIER_UNAVAILABLE'));

    expect(await sessionCount(app, 'mfa-staff')).toBe(0);
  });

  it('never persists or replays a raw session token', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveUser(app, 'secret-user');
    const agent = request(app.getHttpServer());
    const loginRequest = agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('secret-login'))
      .send({ loginIdentifier: 'secret-user', password: 'seed-password-1', sessionKind: 'USER' });

    const first = await loginRequest.expect(201);
    const token = first.body.sessionToken as string;
    expect(token).toHaveLength(64);

    await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('secret-login'))
      .send({ loginIdentifier: 'secret-user', password: 'seed-password-1', sessionKind: 'USER' })
      .expect(409)
      .expect(({ body }) => expect(body).toMatchObject({
        errorCode: 'LOGIN_REPLAY_REQUIRES_REAUTHENTICATION',
        recoverableActions: ['LOGIN_WITH_NEW_IDEMPOTENCY_KEY'],
      }));

    const database = app.get(DatabaseService).database;
    const leaked = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit.idempotency_key
       WHERE result::text LIKE $1`,
      [`%${token}%`],
    );
    expect(leaked.rows[0]?.count).toBe(0);
    const sessions = await database.query<{ token_hash: string }>(
      'SELECT token_hash FROM iam.session WHERE account_id = $1',
      ['secret-user'],
    );
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]?.token_hash).not.toBe(token);
  });

  it('rejects idempotency-key reuse across route, principal, and payload scopes', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveUser(app, 'scope-user-1');
    await seedActiveUser(app, 'scope-user-2');
    const agent = request(app.getHttpServer());
    const token1 = await userLogin(agent, 'scope-user-1', 'login-scope-1');
    const token2 = await userLogin(agent, 'scope-user-2', 'login-scope-2');

    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('shared-key')).set('Authorization', `Bearer ${token1}`)
      .send({ consentVersion: 'consent-v1' }).expect(201);

    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(writeHeaders('shared-key')).set('Authorization', `Bearer ${token1}`)
      .send({ expectedVersion: 0, data: {} }).expect(409);
    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('shared-key')).set('Authorization', `Bearer ${token2}`)
      .send({ consentVersion: 'consent-v1' }).expect(409);
    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('shared-key')).set('Authorization', `Bearer ${token1}`)
      .send({ consentVersion: 'consent-v2' }).expect(409);
  });

  it('creates one side effect for concurrent requests with the same scoped key', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveUser(app, 'concurrent-user');
    const agent = request(app.getHttpServer());
    const token = await userLogin(agent, 'concurrent-user', 'login-concurrent');
    const send = () => agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('concurrent-consent')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v1' });

    const responses = await Promise.all([send(), send()]);
    expect(responses.map((response) => response.status)).not.toContain(500);
    expect(responses.every((response) => response.status === 201)).toBe(true);

    const result = await app.get(DatabaseService).database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM care.consent_record
       WHERE user_id = 'concurrent-user' AND consent_version = 'consent-v1'`,
    );
    expect(result.rows[0]?.count).toBe(1);
  });

  it('uses only a server MFA verifier for staff session creation', async () => {
    const verifier: MfaVerifier = {
      verify: async ({ accountId, challengeId }) => (
        accountId === 'verified-staff' && challengeId === 'verified-challenge'
      ),
    };
    app = await buildApplication(environment, {
      authPolicy: { ...policy, mfaRequiredForStaff: true },
      mfaVerifier: verifier,
    });
    await seedActiveStaff(app, 'verified-staff', 'SYSTEM_ADMIN');

    const response = await request(app.getHttpServer()).post('/api/v1/identity/sessions')
      .set(writeHeaders('verified-mfa-login'))
      .send({
        loginIdentifier: 'verified-staff',
        password: 'seed-password-1',
        sessionKind: 'STAFF',
        actingRole: 'SYSTEM_ADMIN',
        mfaChallengeId: 'verified-challenge',
        mfaVerified: false,
      })
      .expect(201);
    expect(response.body.sessionToken).toHaveLength(64);

    const sessions = await app.get(DatabaseService).database.query<{ mfa_verified: boolean }>(
      'SELECT mfa_verified FROM iam.session WHERE account_id=$1',
      ['verified-staff'],
    );
    expect(sessions.rows).toEqual([{ mfa_verified: true }]);
  });

  it('counts every failed login attempt even when request and idempotency keys are reused', async () => {
    app = await buildApplication(environment, {
      authPolicy: { ...policy, maxFailedAttempts: 2 },
    });
    await seedActiveUser(app, 'repeat-failure-user');
    const agent = request(app.getHttpServer());
    const token = await userLogin(agent, 'repeat-failure-user', 'successful-login');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await agent.post('/api/v1/identity/sessions')
        .set(writeHeaders('same-failed-key'))
        .send({
          loginIdentifier: 'repeat-failure-user',
          password: 'wrong-password',
          sessionKind: 'USER',
        })
        .expect(401);
    }

    const account = await app.get(DatabaseService).database.query<{
      status: string;
      failed_attempts: number;
    }>('SELECT status, failed_attempts FROM iam.account WHERE id=$1', ['repeat-failure-user']);
    expect(account.rows[0]).toEqual({ status: 'LOCKED', failed_attempts: 2 });
    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('revoked-after-lock')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v1' }).expect(401);
  });

  it('never activates a locked or disabled account through initial password change', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    for (const status of ['LOCKED', 'DISABLED'] as const) {
      const accountId = `${status.toLowerCase()}-invite`;
      await seedAccount(app, accountId, 'USER', status, true);
      await request(app.getHttpServer()).post('/api/v1/identity/password/change')
        .set(writeHeaders(`change-${status}`))
        .send({
          accountId,
          currentPassword: 'seed-password-1',
          newPassword: 'changed-password-1',
          expectedVersion: 1,
        })
        .expect(409)
        .expect(({ body }) => expect(body.errorCode).toBe('INITIAL_PASSWORD_CHANGE_NOT_ALLOWED'));
    }

    const statuses = await app.get(DatabaseService).database.query<{ status: string }>(
      `SELECT status FROM iam.account
       WHERE id IN ('locked-invite', 'disabled-invite') ORDER BY status`,
    );
    expect(statuses.rows.map((row) => row.status).sort()).toEqual(['DISABLED', 'LOCKED']);
  });

  it('writes audit actors from the verified session instead of forged headers', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'audit-operations', 'OPERATIONS');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'audit-operations', 'seed-password-1', 'OPERATIONS');

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('audit-correlation', { actorId: 'forged-admin', actorRole: 'SYSTEM_ADMIN' }))
      .set('Authorization', `Bearer ${token}`)
      .send(userInvitation('audit-user'))
      .expect(201);

    const audit = await app.get(DatabaseService).database.query<{
      id: string;
      actor_id: string;
      actor_role: string;
      request_id: string;
    }>(`SELECT id, actor_id, actor_role, request_id FROM audit.audit_event
        WHERE action='ACCOUNT_INVITED' AND subject_id='audit-user'`);
    expect(audit.rows[0]).toMatchObject({
      actor_id: 'audit-operations',
      actor_role: 'OPERATIONS',
      request_id: 'audit-correlation',
    });
    expect(audit.rows[0]?.id).not.toBe('audit-correlation');
  });

  it('requires database-recorded reviewer qualification and leaves zero writes when absent', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveUser(app, 'screening-user');
    await seedActiveStaff(app, 'unqualified-reviewer', 'NUTRITION_REVIEWER');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'unqualified-reviewer', 'seed-password-1', 'NUTRITION_REVIEWER');
    const screening = {
      userId: 'screening-user',
      conclusion: 'HUMAN_REVIEW',
      source: 'MANUAL_REVIEW',
      ruleVersion: null,
    };

    await agent.post('/api/v1/onboarding/screening-results')
      .set(writeHeaders('screening-unqualified')).set('Authorization', `Bearer ${token}`)
      .send(screening).expect(403)
      .expect(({ body }) => expect(body.errorCode).toBe('PROFESSIONAL_QUALIFICATION_REQUIRED'));
    expect(await screeningCount(app, 'screening-user')).toBe(0);

    await app.get(DatabaseService).database.query(
      `UPDATE iam.account_role SET qualified_at=now()
       WHERE account_id='unqualified-reviewer' AND role_code='NUTRITION_REVIEWER'`,
    );
    await agent.post('/api/v1/onboarding/screening-results')
      .set(writeHeaders('screening-qualified')).set('Authorization', `Bearer ${token}`)
      .send(screening).expect(201);
    expect(await screeningCount(app, 'screening-user')).toBe(1);
  });

  it('binds a verified acting role to each multi-role staff session', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'multi-role-staff', 'OPERATIONS');
    await app.get(DatabaseService).database.query(
      `INSERT INTO iam.account_role (account_id, role_code)
       VALUES ('multi-role-staff', 'SYSTEM_ADMIN')`,
    );
    const agent = request(app.getHttpServer());
    await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('login-multi-invalid-role'))
      .send({
        loginIdentifier: 'multi-role-staff',
        password: 'seed-password-1',
        sessionKind: 'STAFF',
        actingRole: 'TRAINING_REVIEWER',
      }).expect(403);
    const operationsToken = await staffLogin(
      agent,
      'multi-role-staff',
      'login-multi-operations',
      'OPERATIONS',
    );
    const adminToken = await staffLogin(
      agent,
      'multi-role-staff',
      'login-multi-admin',
      'SYSTEM_ADMIN',
    );

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('multi-operations-user')).set('Authorization', `Bearer ${operationsToken}`)
      .send(userInvitation('multi-user')).expect(201);
    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('multi-operations-staff')).set('Authorization', `Bearer ${operationsToken}`)
      .send(staffInvitation('forbidden-staff', ['AUDIT_VIEWER'])).expect(403);
    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('multi-admin-staff')).set('Authorization', `Bearer ${adminToken}`)
      .send(staffInvitation('multi-staff', ['AUDIT_VIEWER'])).expect(201);
    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('multi-admin-user')).set('Authorization', `Bearer ${adminToken}`)
      .send(userInvitation('forbidden-user')).expect(403);

    const sessions = await app.get(DatabaseService).database.query<{ active_role: string }>(
      `SELECT active_role FROM iam.session WHERE account_id='multi-role-staff' ORDER BY active_role`,
    );
    expect(sessions.rows.map((row) => row.active_role)).toEqual(['OPERATIONS', 'SYSTEM_ADMIN']);
    const audits = await app.get(DatabaseService).database.query<{ actor_role: string }>(
      `SELECT actor_role FROM audit.audit_event
       WHERE subject_id IN ('multi-user', 'multi-staff') ORDER BY subject_id`,
    );
    expect(audits.rows.map((row) => row.actor_role).sort()).toEqual(['OPERATIONS', 'SYSTEM_ADMIN']);
  });
});

function writeHeaders(
  requestId: string,
  forged?: { actorId: string; actorRole: string },
): Record<string, string> {
  return {
    'x-request-id': requestId,
    'idempotency-key': requestId,
    ...(forged ? { 'x-actor-id': forged.actorId, 'x-actor-role': forged.actorRole } : {}),
  };
}

function userInvitation(accountId: string) {
  return {
    accountId,
    loginIdentifier: accountId,
    accountType: 'USER',
    roles: [],
    initialPassword: 'initial-pass-1',
  };
}

function staffInvitation(accountId: string, roles: string[]) {
  return {
    accountId,
    loginIdentifier: accountId,
    accountType: 'STAFF',
    roles,
    initialPassword: 'initial-pass-1',
  };
}

async function seedActiveStaff(
  target: INestApplication,
  accountId: string,
  role: string,
): Promise<void> {
  const database = target.get(DatabaseService).database;
  const passwordHash = await hashPassword('seed-password-1', policy);
  await database.query(
    `INSERT INTO iam.account
       (id, login_identifier, password_hash, account_type, status,
        initial_password_change_required)
     VALUES ($1, $1, $2, 'STAFF', 'ACTIVE', false)`,
    [accountId, passwordHash],
  );
  await database.query(
    `INSERT INTO iam.account_role (account_id, role_code) VALUES ($1, $2)`,
    [accountId, role],
  );
}

async function seedActiveUser(target: INestApplication, accountId: string): Promise<void> {
  await seedAccount(target, accountId, 'USER', 'ACTIVE', false);
}

async function seedAccount(
  target: INestApplication,
  accountId: string,
  accountType: 'USER' | 'STAFF',
  status: 'INVITED' | 'ACTIVE' | 'LOCKED' | 'DISABLED',
  initialPasswordChangeRequired: boolean,
): Promise<void> {
  const passwordHash = await hashPassword('seed-password-1', policy);
  await target.get(DatabaseService).database.query(
    `INSERT INTO iam.account
       (id, login_identifier, password_hash, account_type, status,
        initial_password_change_required)
     VALUES ($1, $1, $2, $3, $4, $5)`,
    [accountId, passwordHash, accountType, status, initialPasswordChangeRequired],
  );
}

async function login(
  agent: ReturnType<typeof request>,
  loginIdentifier: string,
  password: string,
  actingRole: string,
): Promise<string> {
  const response = await agent.post('/api/v1/identity/sessions')
    .set(writeHeaders(`login-${loginIdentifier}`, {
      actorId: loginIdentifier,
      actorRole: 'SYSTEM_ADMIN',
    }))
    .send({ loginIdentifier, password, sessionKind: 'STAFF', actingRole, mfaVerified: false })
    .expect(201);
  return response.body.sessionToken as string;
}

async function userLogin(
  agent: ReturnType<typeof request>,
  loginIdentifier: string,
  idempotencyKey: string,
): Promise<string> {
  const response = await agent.post('/api/v1/identity/sessions')
    .set(writeHeaders(idempotencyKey))
    .send({ loginIdentifier, password: 'seed-password-1', sessionKind: 'USER' })
    .expect(201);
  return response.body.sessionToken as string;
}

async function staffLogin(
  agent: ReturnType<typeof request>,
  loginIdentifier: string,
  idempotencyKey: string,
  actingRole: string,
): Promise<string> {
  const response = await agent.post('/api/v1/identity/sessions')
    .set(writeHeaders(idempotencyKey))
    .send({
      loginIdentifier,
      password: 'seed-password-1',
      sessionKind: 'STAFF',
      actingRole,
    })
    .expect(201);
  return response.body.sessionToken as string;
}

async function accountCount(target: INestApplication, accountId: string): Promise<number> {
  const result = await target.get(DatabaseService).database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM iam.account WHERE id = $1',
    [accountId],
  );
  return result.rows[0]?.count ?? 0;
}

async function sessionCount(target: INestApplication, accountId: string): Promise<number> {
  const result = await target.get(DatabaseService).database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM iam.session WHERE account_id = $1',
    [accountId],
  );
  return result.rows[0]?.count ?? 0;
}

async function screeningCount(target: INestApplication, userId: string): Promise<number> {
  const result = await target.get(DatabaseService).database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM care.screening_result WHERE user_id=$1',
    [userId],
  );
  return result.rows[0]?.count ?? 0;
}
