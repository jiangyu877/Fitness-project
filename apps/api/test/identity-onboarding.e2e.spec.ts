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
const profileFingerprintSecret = 'test-only-profile-idempotency-secret';

describe('identity and onboarding API', () => {
  let app: INestApplication | undefined;
  afterEach(async () => app?.close());

  it('runs invited user, consent, profile, and qualified screening structure', async () => {
    app = await buildApplication(environment, { authPolicy: policy, profileFingerprintSecret });
    await seedStaff(app, 'operations-1', 'OPERATIONS');
    await seedStaff(app, 'admin-1', 'SYSTEM_ADMIN');
    const agent = request(app.getHttpServer());
    const operationsToken = await login(agent, 'operations-1', 'STAFF', 'login-operations', 'seed-password-1', 'OPERATIONS');
    const adminToken = await login(agent, 'admin-1', 'STAFF', 'login-admin', 'seed-password-1', 'SYSTEM_ADMIN');

    const invitation = await agent.post('/api/v1/identity/invitations')
      .set(headers('invite-user')).set('Authorization', `Bearer ${operationsToken}`)
      .send({
        accountId: 'user-1',
        loginIdentifier: 'invite-1',
        accountType: 'USER',
        roles: [],
        initialPassword: 'initial-pass-1',
      }).expect(201);
    expect(invitation.body).toMatchObject({ businessStatus: 'ACCOUNT_INVITED', requestId: 'invite-user' });

    const restricted = await agent.post('/api/v1/identity/sessions')
      .set(headers('initial-login-user'))
      .send({ loginIdentifier: 'invite-1', password: 'initial-pass-1', sessionKind: 'USER' })
      .expect(201);
    const changed = await agent.post('/api/v1/identity/password/change')
      .set(headers('password-user'))
      .set('Authorization', `Bearer ${restricted.body.passwordChangeToken}`)
      .send({
        newPassword: 'changed-pass-1',
        expectedVersion: 1,
      }).expect(200);
    const userToken = changed.body.sessionToken as string;

    const consent = await agent.post('/api/v1/onboarding/consents')
      .set(headers('consent-user')).set('Authorization', `Bearer ${userToken}`)
      .send({ consentVersion: 'consent-v1' }).expect(201);
    await agent.post(`/api/v1/onboarding/consents/${consent.body.consentId}/withdraw`)
      .set(headers('withdraw-user')).set('Authorization', `Bearer ${userToken}`)
      .send({ expectedVersion: 1 }).expect(200);
    const profile = await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(headers('profile-user')).set('Authorization', `Bearer ${userToken}`)
      .send({ expectedVersion: 0, data: { goalType: 'FAT_LOSS' } }).expect(200);
    expect(profile.body).toMatchObject({ businessStatus: 'PROFILE_DRAFT_SAVED', version: 1 });

    await seedStaff(app, 'reviewer-1', 'NUTRITION_REVIEWER');
    await app.get(DatabaseService).database.query(
      `UPDATE iam.account_role SET qualified_at=now()
       WHERE account_id='reviewer-1' AND role_code='NUTRITION_REVIEWER'`,
    );
    const reviewerToken = await login(agent, 'reviewer-1', 'STAFF', 'login-reviewer', 'seed-password-1', 'NUTRITION_REVIEWER');
    const screening = await agent.post('/api/v1/onboarding/screening-results')
      .set(headers('screening-user')).set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        userId: 'user-1',
        conclusion: 'HUMAN_REVIEW',
        source: 'MANUAL_REVIEW',
        ruleVersion: null,
      }).expect(201);
    expect(screening.body).toMatchObject({
      businessStatus: 'SCREENING_RECORDED',
      conclusion: 'HUMAN_REVIEW',
    });

    await agent.post('/api/v1/identity/accounts/user-1/status')
      .set(headers('disable-user')).set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DISABLED', expectedVersion: 2 }).expect(200);
    await agent.post('/api/v1/onboarding/consents')
      .set(headers('disabled-session')).set('Authorization', `Bearer ${userToken}`)
      .send({ consentVersion: 'consent-v2' }).expect(401);
  }, 15_000);

  it('blocks identity paths without an approved auth policy', async () => {
    app = await buildApplication({ ...environment, authSecurityPolicyApproved: false });
    await request(app.getHttpServer()).post('/api/v1/identity/sessions')
      .set(headers('blocked-login'))
      .send({ loginIdentifier: 'blocked', password: 'password', sessionKind: 'USER' })
      .expect(503)
      .expect(({ body }) => expect(body.errorCode).toBe('AUTH_SECURITY_POLICY_UNAPPROVED'));
  });
});

function headers(requestId: string) {
  return { 'x-request-id': requestId, 'idempotency-key': requestId };
}

async function seedStaff(target: INestApplication, accountId: string, role: string) {
  const passwordHash = await hashPassword('seed-password-1', policy);
  const database = target.get(DatabaseService).database;
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

async function login(
  agent: ReturnType<typeof request>,
  loginIdentifier: string,
  sessionKind: 'USER' | 'STAFF',
  requestId: string,
  password = 'seed-password-1',
  actingRole?: string,
): Promise<string> {
  const response = await agent.post('/api/v1/identity/sessions')
    .set(headers(requestId))
    .send({ loginIdentifier, password, sessionKind, ...(actingRole ? { actingRole } : {}) })
    .expect(201);
  return response.body.sessionToken as string;
}
