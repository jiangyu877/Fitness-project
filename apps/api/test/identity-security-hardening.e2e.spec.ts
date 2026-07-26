import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { buildApplication as buildTestApplication } from './build-test-application.js';
import type { Environment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';
import type { MfaVerifier } from '../src/identity/mfa-verifier.js';
import { createOpenApiDocument } from '../src/openapi.js';

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
const profileFingerprintSecret = 'test-only-profile-idempotency-secret';
const fictionalP07Providers = {
  consentProvider: { getCurrentConsent: async () => ({ version: 'consent-v1', content: { format: 'PLAIN_TEXT' as const, text: 'FICTIONAL TEST CONSENT' } }) },
  screeningProvider: { isApprovedConclusion: async () => true },
  profileSchemaProvider: { getApprovedProfileSchema: async () => ({ version: 'profile-test-v1', steps: [{ id: 'basics', fields: [] }] }) },
};
function buildApplication(environment: Environment, options: Parameters<typeof buildTestApplication>[1] = {}) {
  return buildTestApplication(environment, { ...fictionalP07Providers, ...options });
}

describe('identity security hardening', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('validates real login and security-error responses against their OpenAPI schemas', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedAccount(app, 'schema-restricted', 'USER', 'INVITED', true);
    await seedActiveUser(app, 'schema-user');
    await seedActiveStaff(app, 'schema-staff', 'SYSTEM_ADMIN');
    const agent = request(app.getHttpServer());
    const operation = createOpenApiDocument(app).paths['/api/v1/identity/sessions']?.post;
    const successSchema = responseSchema(operation, '201') as LocalSchema;
    const branches = successSchema.oneOf ?? [];

    const restricted = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('schema-restricted')).send({
        loginIdentifier: 'schema-restricted', password: 'seed-password-1', sessionKind: 'USER',
      }).expect(201);
    const user = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('schema-user')).send({
        loginIdentifier: 'schema-user', password: 'seed-password-1', sessionKind: 'USER',
      }).expect(201);
    const staff = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('schema-staff')).send({
        loginIdentifier: 'schema-staff', password: 'seed-password-1', sessionKind: 'STAFF', actingRole: 'SYSTEM_ADMIN',
      }).expect(201);

    for (const response of [restricted.body, user.body, staff.body]) {
      expect(branches.filter((branch) => matchesLocalSchema(response, branch))).toHaveLength(1);
    }
    expect(restricted.body.sessionType).toBe('PASSWORD_CHANGE');
    expect(user.body.sessionType).toBe('USER');
    expect(staff.body.sessionType).toBe('STAFF');

    const unauthorized = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('schema-401')).send({
        loginIdentifier: 'schema-user', password: 'wrong-password', sessionKind: 'USER',
      }).expect(401);
    expect(matchesLocalSchema(unauthorized.body, responseSchema(operation, '401') as LocalSchema)).toBe(true);
    expect(unauthorized.body).toMatchObject({ errorCode: 'INVALID_CREDENTIALS', requestId: 'schema-401' });

    await app.close();
    app = undefined;
    app = await buildApplication(environment);
    const unavailable = await request(app.getHttpServer()).post('/api/v1/identity/sessions')
      .set(writeHeaders('schema-503')).send({
        loginIdentifier: 'schema-user', password: 'seed-password-1', sessionKind: 'USER',
      }).expect(503);
    const unavailableSchema = responseSchema(operation, '503') as LocalSchema;
    expect(
      matchesLocalSchema(unavailable.body, unavailableSchema),
      JSON.stringify({ body: unavailable.body, schema: unavailableSchema }),
    ).toBe(true);
    expect(unavailable.body).toMatchObject({ errorCode: 'AUTH_SECURITY_POLICY_UNAPPROVED', requestId: 'schema-503' });

    await app.close();
    app = undefined;
    app = await buildApplication(environment, {
      authPolicy: { ...policy, passwordChangeTtlSeconds: policy.sessionTtlSeconds },
    });
    await seedAccount(app, 'schema-invalid-ttl', 'USER', 'INVITED', true);
    const invalidTtl = await request(app.getHttpServer()).post('/api/v1/identity/sessions')
      .set(writeHeaders('schema-invalid-ttl')).send({
        loginIdentifier: 'schema-invalid-ttl', password: 'seed-password-1', sessionKind: 'USER',
      }).expect(503);
    expect(matchesLocalSchema(invalidTtl.body, unavailableSchema)).toBe(true);
    expect(invalidTtl.body).toMatchObject({
      errorCode: 'PASSWORD_CHANGE_TTL_POLICY_INVALID', requestId: 'schema-invalid-ttl',
    });
  }, 10_000);

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
    expect(await rejectedAuditCount(app, 'operations-staff', 'ROLE_NOT_AUTHORIZED')).toBe(1);
    expect(await rejectedAuditCount(app, 'admin-user', 'ROLE_NOT_AUTHORIZED')).toBe(1);
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
    expect(await rejectedAuditCount(app, 'mfa-self-report', 'MFA_VERIFIER_UNAVAILABLE')).toBe(1);
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
    app = await buildApplication(environment, { authPolicy: policy, profileFingerprintSecret });
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
      .send({ expectedVersion: 0, data: {} }).expect(503);
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

  it('audits locked and disabled fresh-login rejections with a stable request identifier', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedAccount(app, 'fresh-login-locked', 'USER', 'LOCKED', false);
    await seedAccount(app, 'fresh-login-disabled', 'USER', 'DISABLED', false);
    const agent = request(app.getHttpServer());

    for (const [accountId, requestId, auditCode] of [
      ['fresh-login-locked', 'fresh-login-locked-request', 'ACCOUNT_LOCKED'],
      ['fresh-login-disabled', 'fresh-login-disabled-request', 'ACCOUNT_DISABLED'],
    ] as const) {
      await agent.post('/api/v1/identity/sessions')
        .set(writeHeaders(requestId))
        .send({ loginIdentifier: accountId, password: 'seed-password-1', sessionKind: 'USER' })
        .expect(401)
        .expect(({ body }) => expect(body).toMatchObject({
          errorCode: 'INVALID_CREDENTIALS',
          requestId,
        }));
      expect(await rejectionAudit(app, requestId)).toEqual([{
        actor_id: null,
        actor_role: 'SYSTEM',
        error_code: auditCode,
      }]);
    }
  });

  it('fails closed for an established session when authentication-policy approval is withdrawn', async () => {
    const runtimeEnvironment = { ...environment };
    app = await buildApplication(runtimeEnvironment, { authPolicy: policy });
    await seedActiveUser(app, 'policy-session-user');
    const agent = request(app.getHttpServer());
    const token = await userLogin(agent, 'policy-session-user', 'policy-session-login');
    runtimeEnvironment.authSecurityPolicyApproved = false;

    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('policy-session-write')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v1' })
      .expect(503)
      .expect(({ body }) => expect(body).toMatchObject({
        errorCode: 'AUTH_SECURITY_POLICY_UNAPPROVED',
        requestId: 'policy-session-write',
      }));
  });

  it('audits invalid and locked bearer rejections with stable request identifiers', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveUser(app, 'session-audit-user');
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('invalid-bearer-write')).set('Authorization', 'Bearer invalid-session-token')
      .send({ consentVersion: 'consent-v1' })
      .expect(401)
      .expect(({ body }) => expect(body).toMatchObject({
        errorCode: 'SESSION_INVALID',
        requestId: 'invalid-bearer-write',
      }));
    expect(await rejectionAudit(app, 'invalid-bearer-write')).toEqual([{
      actor_id: null,
      actor_role: 'SYSTEM',
      error_code: 'SESSION_INVALID',
    }]);

    const token = await userLogin(agent, 'session-audit-user', 'session-audit-login');
    await app.get(DatabaseService).database.query(
      `UPDATE iam.account SET status='LOCKED' WHERE id='session-audit-user'`,
    );
    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('locked-bearer-write')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v1' })
      .expect(401)
      .expect(({ body }) => expect(body).toMatchObject({
        errorCode: 'SESSION_INVALID',
        requestId: 'locked-bearer-write',
      }));
    expect(await rejectionAudit(app, 'locked-bearer-write')).toEqual([{
      actor_id: 'session-audit-user',
      actor_role: 'USER',
      error_code: 'SESSION_INVALID',
    }]);
  });

  it('pins the validated policy so later caller mutation cannot change session authorization', async () => {
    const runtimePolicy = { ...policy, mfaRequiredForStaff: false };
    app = await buildApplication(environment, { authPolicy: runtimePolicy });
    await seedActiveStaff(app, 'mfa-upgrade-operations', 'OPERATIONS');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'mfa-upgrade-operations', 'seed-password-1', 'OPERATIONS');
    runtimePolicy.mfaRequiredForStaff = true;

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('mfa-upgrade-write')).set('Authorization', `Bearer ${token}`)
      .send(userInvitation('mfa-upgrade-target'))
      .expect(201);
    expect(await accountCount(app, 'mfa-upgrade-target')).toBe(1);
    expect(await rejectionAudit(app, 'mfa-upgrade-write')).toEqual([]);
  });

  it('never creates a restricted password-change context for locked or disabled accounts', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    for (const status of ['LOCKED', 'DISABLED'] as const) {
      const accountId = `${status.toLowerCase()}-invite`;
      await seedAccount(app, accountId, 'USER', status, true);
      await request(app.getHttpServer()).post('/api/v1/identity/sessions')
        .set(writeHeaders(`change-${status}`))
        .send({
          loginIdentifier: accountId,
          password: 'seed-password-1',
          sessionKind: 'USER',
        })
        .expect(401)
        .expect(({ body }) => expect(body.errorCode).toBe('INVALID_CREDENTIALS'));
    }

    const statuses = await app.get(DatabaseService).database.query<{ status: string }>(
      `SELECT status FROM iam.account
       WHERE id IN ('locked-invite', 'disabled-invite') ORDER BY status`,
    );
    expect(statuses.rows.map((row) => row.status).sort()).toEqual(['DISABLED', 'LOCKED']);
    expect(await rejectedAuditCount(app, 'change-LOCKED', 'ACCOUNT_LOCKED')).toBe(1);
    expect(await rejectedAuditCount(app, 'change-DISABLED', 'ACCOUNT_DISABLED')).toBe(1);
  });

  it('counts incorrect invited-login credentials, locks at the threshold, and audits every rejection', async () => {
    app = await buildApplication(environment, {
      authPolicy: { ...policy, maxFailedAttempts: 2 },
    });
    await seedAccount(app, 'initial-password-lock-user', 'USER', 'INVITED', true);
    const agent = request(app.getHttpServer());

    for (const requestId of ['initial-password-failure-1', 'initial-password-failure-2']) {
      await agent.post('/api/v1/identity/sessions')
        .set(writeHeaders(requestId))
        .send({
          loginIdentifier: 'initial-password-lock-user',
          password: 'wrong-initial-password',
          sessionKind: 'USER',
        })
        .expect(401)
        .expect(({ body }) => {
          expect(body).toMatchObject({ errorCode: 'INVALID_CREDENTIALS', requestId });
        });
    }

    const account = await app.get(DatabaseService).database.query<{
      status: string;
      failed_attempts: number;
    }>('SELECT status, failed_attempts FROM iam.account WHERE id=$1', ['initial-password-lock-user']);
    expect(account.rows[0]).toEqual({ status: 'LOCKED', failed_attempts: 2 });
    expect(await rejectionAudit(app, 'initial-password-failure-1')).toEqual([{
      actor_id: null,
      actor_role: 'SYSTEM',
      error_code: 'INVALID_CREDENTIALS',
    }]);
    expect(await rejectionAudit(app, 'initial-password-failure-2')).toEqual([{
      actor_id: null,
      actor_role: 'SYSTEM',
      error_code: 'ACCOUNT_LOCKED',
    }]);
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
    expect(await rejectedAuditCount(
      app,
      'screening-unqualified',
      'PROFESSIONAL_QUALIFICATION_REQUIRED',
    )).toBe(1);

    await app.get(DatabaseService).database.query(
      `UPDATE iam.account_role SET qualified_at=now()
       WHERE account_id='unqualified-reviewer' AND role_code='NUTRITION_REVIEWER'`,
    );
    await agent.post('/api/v1/onboarding/screening-results')
      .set(writeHeaders('screening-qualified')).set('Authorization', `Bearer ${token}`)
      .send(screening).expect(201);
    expect(await screeningCount(app, 'screening-user')).toBe(1);
  });

  it('rejects a STAFF screening target and writes a structured rejection audit', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'screening-target-staff', 'OPERATIONS');
    await seedActiveStaff(app, 'qualified-reviewer', 'NUTRITION_REVIEWER');
    await app.get(DatabaseService).database.query(
      `UPDATE iam.account_role SET qualified_at=now()
       WHERE account_id='qualified-reviewer' AND role_code='NUTRITION_REVIEWER'`,
    );
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'qualified-reviewer', 'seed-password-1', 'NUTRITION_REVIEWER');

    const rejected = await agent.post('/api/v1/onboarding/screening-results')
      .set(writeHeaders('screening-staff-target')).set('Authorization', `Bearer ${token}`)
      .send({
        userId: 'screening-target-staff',
        conclusion: 'HUMAN_REVIEW',
        source: 'MANUAL_REVIEW',
        ruleVersion: null,
      })
      .expect(403)
      .expect(({ body }) => expect(body).toMatchObject({
        errorCode: 'SCREENING_TARGET_USER_REQUIRED', requestId: 'screening-staff-target',
      }));
    const screeningOperation = createOpenApiDocument(app).paths['/api/v1/onboarding/screening-results']?.post;
    expect(matchesLocalSchema(rejected.body, responseSchema(screeningOperation, '403') as LocalSchema)).toBe(true);

    expect(await screeningCount(app, 'screening-target-staff')).toBe(0);
    expect(await rejectionAudit(app, 'screening-staff-target')).toEqual([{
      actor_id: 'qualified-reviewer',
      actor_role: 'NUTRITION_REVIEWER',
      error_code: 'SCREENING_TARGET_USER_REQUIRED',
    }]);
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

  it('invalidates a staff session immediately when its active role is revoked', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'revoked-operations', 'OPERATIONS');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'revoked-operations', 'seed-password-1', 'OPERATIONS');
    const database = app.get(DatabaseService).database;
    await database.query(
      `DELETE FROM iam.account_role
       WHERE account_id='revoked-operations' AND role_code='OPERATIONS'`,
    );

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('revoked-role-invite')).set('Authorization', `Bearer ${token}`)
      .send(userInvitation('must-not-exist')).expect(401);

    expect(await accountCount(app, 'must-not-exist')).toBe(0);
    const sideEffects = await database.query<{ keys: number; revoked: number; rejected: number }>(`
      SELECT
        (SELECT count(*)::int FROM audit.idempotency_key WHERE key='revoked-role-invite') AS keys,
        (SELECT count(*)::int FROM iam.session
          WHERE account_id='revoked-operations' AND revoked_at IS NOT NULL) AS revoked,
        (SELECT count(*)::int FROM audit.audit_event
          WHERE request_id='revoked-role-invite' AND outcome='REJECTED') AS rejected
    `);
    expect(sideEffects.rows[0]).toEqual({ keys: 0, revoked: 1, rejected: 1 });
  });

  it('persists fingerprints made only from explicit non-secret fields', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'fingerprint-operations', 'OPERATIONS');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'fingerprint-operations', 'seed-password-1', 'OPERATIONS');
    const invitation = userInvitation('fingerprint-user');
    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('fingerprint-invite')).set('Authorization', `Bearer ${token}`)
      .send(invitation).expect(201);
    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('fingerprint-invite')).set('Authorization', `Bearer ${token}`)
      .send({ ...invitation, initialPassword: 'different-secret-1' }).expect(201);

    const row = await app.get(DatabaseService).database.query<{ request_fingerprint: string }>(
      `SELECT request_fingerprint FROM audit.idempotency_key WHERE key='fingerprint-invite'`,
    );
    const safePayload = {
      accountId: invitation.accountId,
      loginIdentifier: invitation.loginIdentifier,
      accountType: invitation.accountType,
      roles: invitation.roles,
    };
    expect(row.rows[0]?.request_fingerprint).toBe(sha256(JSON.stringify(safePayload)));
    expect(row.rows[0]?.request_fingerprint).not.toBe(sha256(JSON.stringify(invitation)));
    expect(row.rows[0]?.request_fingerprint).not.toBe(sha256(invitation.initialPassword));
    expect(await accountCount(app, 'fingerprint-user')).toBe(1);
  });

  it('consumes an initial-password context once under concurrent requests', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedAccount(app, 'retry-invited', 'USER', 'INVITED', true);
    const agent = request(app.getHttpServer());
    const restricted = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('retry-login'))
      .send({ loginIdentifier: 'retry-invited', password: 'seed-password-1', sessionKind: 'USER' })
      .expect(201);
    const body = { newPassword: 'changed-password-1', expectedVersion: 1 };
    const send = () => agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('retry-password')).set('Authorization', `Bearer ${restricted.body.passwordChangeToken}`).send(body);

    const concurrent = await Promise.all([send(), send()]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 401]);
    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('retry-replay')).set('Authorization', `Bearer ${restricted.body.passwordChangeToken}`)
      .send(body)
      .expect(401)
      .expect(({ body: response }) => expect(response.errorCode).toBe('PASSWORD_CHANGE_TOKEN_INVALID'));

    const database = app.get(DatabaseService).database;
    const counts = await database.query<{ version: number; audits: number }>(`
      SELECT
        (SELECT version FROM iam.account WHERE id='retry-invited') AS version,
        (SELECT count(*)::int FROM audit.audit_event
         WHERE action='PASSWORD_CHANGED' AND subject_id='retry-invited') AS audits
    `);
    expect(counts.rows[0]).toEqual({ version: 2, audits: 1 });
  });

  it('records structured rejection audit without trusting anonymous actor headers', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await request(app.getHttpServer()).post('/api/v1/identity/invitations')
      .set(writeHeaders('anonymous-audit', { actorId: 'forged', actorRole: 'SYSTEM_ADMIN' }))
      .send(userInvitation('anonymous-audit-user')).expect(401);
    const audit = await app.get(DatabaseService).database.query<{
      actor_id: string | null;
      actor_role: string;
      outcome: string;
      error_code: string;
    }>(`SELECT actor_id, actor_role, outcome, error_code FROM audit.audit_event
        WHERE request_id='anonymous-audit'`);
    expect(audit.rows).toEqual([{
      actor_id: null,
      actor_role: 'SYSTEM',
      outcome: 'REJECTED',
      error_code: 'SESSION_INVALID',
    }]);
    expect(await accountCount(app, 'anonymous-audit-user')).toBe(0);
  });

  it('excludes login and password secrets from persisted request fingerprints', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveUser(app, 'safe-login-user');
    await seedAccount(app, 'safe-change-user', 'USER', 'INVITED', true);
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('safe-login-key'))
      .send({
        loginIdentifier: 'safe-login-user',
        password: 'seed-password-1',
        sessionKind: 'USER',
        mfaChallengeId: 'must-not-be-fingerprinted',
      })
      .expect(201);

    const restricted = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('safe-change-login'))
      .send({ loginIdentifier: 'safe-change-user', password: 'seed-password-1', sessionKind: 'USER' })
      .expect(201);
    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('safe-change-key'))
      .set('Authorization', `Bearer ${restricted.body.passwordChangeToken}`)
      .send({
        newPassword: 'changed-password-1',
        expectedVersion: 1,
      })
      .expect(200);

    const rows = await app.get(DatabaseService).database.query<{
      key: string;
      request_fingerprint: string;
    }>(
      `SELECT key, request_fingerprint FROM audit.idempotency_key
       WHERE key IN ('safe-login-key', 'safe-change-key') ORDER BY key`,
    );
    const stored = new Map(rows.rows.map((row) => [row.key, row.request_fingerprint]));
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

    expect(stored.get('safe-login-key')).toBe(digest({
      loginIdentifier: 'safe-login-user',
      sessionKind: 'USER',
      actingRole: 'USER',
    }));
    expect(stored.get('safe-change-key')).toBe(digest({
      expectedVersion: 1,
    }));
    for (const forbidden of [
      'seed-password-1',
      'changed-password-1',
      'must-not-be-fingerprinted',
    ]) {
      expect([...stored.values()]).not.toContain(digest(forbidden));
    }
  });

  it('does not create an idempotency projection for unapproved arbitrary profile values', async () => {
    app = await buildApplication(environment, { authPolicy: policy, profileFingerprintSecret });
    await seedActiveUser(app, 'profile-fingerprint-user');
    const agent = request(app.getHttpServer());
    const token = await userLogin(agent, 'profile-fingerprint-user', 'profile-fingerprint-login');
    const sensitiveValue = 'sensitive-profile-value-must-not-be-fingerprinted';

    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(writeHeaders('profile-fingerprint-save')).set('Authorization', `Bearer ${token}`)
      .send({
        expectedVersion: 0,
        data: { arbitrarySensitiveField: sensitiveValue },
      })
      .expect(503);

    const row = await app.get(DatabaseService).database.query<{ request_fingerprint: string }>(
      `SELECT request_fingerprint FROM audit.idempotency_key WHERE key='profile-fingerprint-save'`,
    );
    expect(row.rows).toEqual([]);
  });

  it('rejects unapproved profile values before idempotency persistence', async () => {
    app = await buildApplication(environment, { authPolicy: policy, profileFingerprintSecret });
    await seedActiveUser(app, 'profile-conflict-user');
    const agent = request(app.getHttpServer());
    const token = await userLogin(agent, 'profile-conflict-user', 'profile-conflict-login');
    const firstData = { healthValue: 'low-entropy-sensitive-value-a' };
    const changedData = { healthValue: 'low-entropy-sensitive-value-b' };

    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(writeHeaders('profile-conflict-save')).set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 0, data: firstData })
      .expect(503);
    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(writeHeaders('profile-conflict-save')).set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 0, data: firstData })
      .expect(503);
    await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(writeHeaders('profile-conflict-save')).set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 0, data: changedData })
      .expect(503)
      .expect(({ body }) => expect(body.errorCode).toBe('PROFILE_ACCESS_NOT_APPROVED'));

    const stored = await app.get(DatabaseService).database.query<{ request_fingerprint: string }>(
      `SELECT request_fingerprint FROM audit.idempotency_key WHERE key='profile-conflict-save'`,
    );
    expect(stored.rows).toEqual([]);
  });

  it('audits an initial password version conflict without retaining idempotency state', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedAccount(app, 'version-conflict-user', 'USER', 'INVITED', true);
    const agent = request(app.getHttpServer());
    const restricted = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('version-conflict-login'))
      .send({ loginIdentifier: 'version-conflict-user', password: 'seed-password-1', sessionKind: 'USER' })
      .expect(201);

    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('password-version-conflict'))
      .set('Authorization', `Bearer ${restricted.body.passwordChangeToken}`)
      .send({
        newPassword: 'changed-password-1',
        expectedVersion: 2,
      })
      .expect(409)
      .expect(({ body }) => expect(body.errorCode).toBe('VERSION_CONFLICT'));

    expect(await rejectedAuditCount(app, 'password-version-conflict', 'VERSION_CONFLICT')).toBe(1);
    const keys = await app.get(DatabaseService).database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit.idempotency_key
       WHERE key='password-version-conflict'`,
    );
    expect(keys.rows[0]?.count).toBe(0);
  });

  it('audits an operations account-status denial once without business side effects', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'status-operations', 'OPERATIONS');
    await seedActiveUser(app, 'status-target');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'status-operations', 'seed-password-1', 'OPERATIONS');

    await agent.post('/api/v1/identity/accounts/status-target/status')
      .set(writeHeaders('status-role-denied'))
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DISABLED', expectedVersion: 1 })
      .expect(403)
      .expect(({ body }) => expect(body.errorCode).toBe('ROLE_NOT_AUTHORIZED'));

    const database = app.get(DatabaseService).database;
    const target = await database.query<{ status: string; version: number }>(
      'SELECT status, version FROM iam.account WHERE id=$1',
      ['status-target'],
    );
    const keys = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit.idempotency_key WHERE key='status-role-denied'`,
    );
    const audits = await database.query<{
      actor_id: string;
      actor_role: string;
      action: string;
      subject_id: string;
      error_code: string;
    }>(
      `SELECT actor_id, actor_role, action, subject_id, error_code
       FROM audit.audit_event WHERE request_id='status-role-denied' AND outcome='REJECTED'`,
    );
    expect(target.rows[0]).toEqual({ status: 'ACTIVE', version: 1 });
    expect(keys.rows[0]?.count).toBe(0);
    expect(audits.rows).toEqual([{
      actor_id: 'status-operations',
      actor_role: 'OPERATIONS',
      action: 'ACCOUNT_STATUS_CHANGE_REJECTED',
      subject_id: 'status-target',
      error_code: 'ROLE_NOT_AUTHORIZED',
    }]);
  });

  it('audits a verified session-kind mismatch with a controlled system actor role', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'kind-mismatch-staff', 'OPERATIONS');
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('kind-mismatch-login', { actorId: 'forged', actorRole: 'SYSTEM_ADMIN' }))
      .send({
        loginIdentifier: 'kind-mismatch-staff',
        password: 'seed-password-1',
        sessionKind: 'USER',
      })
      .expect(403)
      .expect(({ body }) => expect(body.errorCode).toBe('SESSION_KIND_MISMATCH'));

    expect(await rejectionAudit(app, 'kind-mismatch-login')).toEqual([{
      actor_id: 'kind-mismatch-staff',
      actor_role: 'SYSTEM',
      error_code: 'SESSION_KIND_MISMATCH',
    }]);
  });

  it('audits missing or ungranted login acting roles without guessing a staff role', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedActiveStaff(app, 'acting-role-staff', 'OPERATIONS');
    const agent = request(app.getHttpServer());

    for (const [requestId, actingRole] of [
      ['missing-login-role', undefined],
      ['ungranted-login-role', 'SYSTEM_ADMIN'],
    ] as const) {
      await agent.post('/api/v1/identity/sessions')
        .set(writeHeaders(requestId))
        .send({
          loginIdentifier: 'acting-role-staff',
          password: 'seed-password-1',
          sessionKind: 'STAFF',
          ...(actingRole ? { actingRole } : {}),
        })
        .expect(403)
        .expect(({ body }) => expect(body.errorCode).toBe('ROLE_NOT_AUTHORIZED'));
      expect(await rejectionAudit(app, requestId)).toEqual([{
        actor_id: 'acting-role-staff',
        actor_role: 'SYSTEM',
        error_code: 'ROLE_NOT_AUTHORIZED',
      }]);
    }
    expect(await sessionCount(app, 'acting-role-staff')).toBe(0);
  });

  it('does not issue a user password-change context to invited staff accounts', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedAccount(app, 'change-role-staff', 'STAFF', 'INVITED', true);
    await app.get(DatabaseService).database.query(
      `INSERT INTO iam.account_role (account_id, role_code)
       VALUES ('change-role-staff', 'OPERATIONS')`,
    );
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('change-role-missing'))
      .send({
        loginIdentifier: 'change-role-staff',
        password: 'seed-password-1',
        sessionKind: 'STAFF',
      })
      .expect(401)
      .expect(({ body }) => expect(body.errorCode).toBe('INVALID_CREDENTIALS'));
    expect(await sessionCount(app, 'change-role-staff')).toBe(0);
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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

async function rejectedAuditCount(
  target: INestApplication,
  requestId: string,
  errorCode: string,
): Promise<number> {
  const result = await target.get(DatabaseService).database.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit.audit_event
     WHERE request_id=$1 AND outcome='REJECTED' AND error_code=$2`,
    [requestId, errorCode],
  );
  return result.rows[0]?.count ?? 0;
}

type LocalSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, LocalSchema>;
  enum?: unknown[];
  const?: unknown;
  items?: LocalSchema;
  additionalProperties?: boolean;
  oneOf?: LocalSchema[];
};

function responseSchema(operation: any, status: string): unknown {
  return operation?.responses?.[status]?.content?.['application/json']?.schema;
}

function matchesLocalSchema(value: unknown, schema: LocalSchema): boolean {
  if (schema.oneOf && schema.oneOf.filter((branch) => matchesLocalSchema(value, branch)).length !== 1) return false;
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.some((item) => item === value)) return false;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (schema.type === 'array') {
    return Array.isArray(value) && (!schema.items || value.every((item) => matchesLocalSchema(item, schema.items!)));
  }
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (schema.required?.some((key) => !(key in record))) return false;
    if (schema.additionalProperties === false && Object.keys(record).some((key) => !(key in (schema.properties ?? {})))) return false;
    return Object.entries(schema.properties ?? {}).every(([key, child]) => !(key in record) || matchesLocalSchema(record[key], child));
  }
  return true;
}

async function rejectionAudit(target: INestApplication, requestId: string) {
  const result = await target.get(DatabaseService).database.query<{
    actor_id: string | null;
    actor_role: string;
    error_code: string;
  }>(
    `SELECT actor_id, actor_role, error_code FROM audit.audit_event
     WHERE request_id=$1 AND outcome='REJECTED' ORDER BY occurred_at`,
    [requestId],
  );
  return result.rows;
}
