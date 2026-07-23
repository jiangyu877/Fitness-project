import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApplication } from '../src/application.js';
import type { Environment } from '../src/config/environment.js';
import type { AuthSecurityPolicy } from '@lianban/domain';

const environment: Environment = {
  nodeEnv: 'test', port: 3000, databasePath: 'memory://', demoMode: false,
  professionalRulesApproved: false, authSecurityPolicyApproved: true,
  privacyReviewApproved: true, dataRightsDrillComplete: false,
  backupRestoreDrillComplete: false, operationsReadinessApproved: false,
  deploymentSecurityApproved: false,
};

const policy: AuthSecurityPolicy = {
  approved: true, passwordMinLength: 10, sessionTtlSeconds: 900,
  maxFailedAttempts: 3, mfaRequiredForStaff: false,
  scryptCost: 16_384, scryptBlockSize: 8, scryptParallelization: 1,
  scryptKeyLength: 32,
};

describe('identity and onboarding API', () => {
  let app: INestApplication | undefined;
  afterEach(async () => app?.close());

  it('runs invited user, consent, profile, and trusted screening structure', async () => {
    app = await buildApplication(environment, { authPolicy: policy });
    const agent = request(app.getHttpServer());

    const invitation = await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('invite-1', 'admin-1', 'SYSTEM_ADMIN'))
      .send({ accountId: 'user-1', loginIdentifier: 'invite-1', accountType: 'USER', roles: [], initialPassword: 'initial-pass-1' })
      .expect(201);
    expect(invitation.body).toMatchObject({ businessStatus: 'ACCOUNT_INVITED', requestId: 'invite-1' });
    expect(JSON.stringify(invitation.body)).not.toContain('initial-pass-1');

    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('password-1', 'user-1', 'USER'))
      .send({ accountId: 'user-1', currentPassword: 'initial-pass-1', newPassword: 'changed-pass-1', expectedVersion: 1 })
      .expect(200);

    const login = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('login-1', 'user-1', 'USER'))
      .send({ loginIdentifier: 'invite-1', password: 'changed-pass-1', sessionKind: 'USER', mfaVerified: false })
      .expect(201);
    const token = login.body.sessionToken as string;
    expect(token).toHaveLength(64);

    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('forged-actor', 'another-user', 'USER')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v1' }).expect(403);

    const consent = await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('consent-1', 'user-1', 'USER')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v1' }).expect(201);
    await agent.post(`/api/v1/onboarding/consents/${consent.body.consentId}/withdraw`)
      .set(writeHeaders('consent-withdraw-1', 'user-1', 'USER')).set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 1 }).expect(200);

    const profile = await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(writeHeaders('profile-1', 'user-1', 'USER')).set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 0, data: { goalType: 'FAT_LOSS' } }).expect(200);
    expect(profile.body).toMatchObject({ businessStatus: 'PROFILE_DRAFT_SAVED', version: 1 });

    const conflict = await agent.put('/api/v1/onboarding/profile/steps/basics')
      .set(writeHeaders('profile-2', 'user-1', 'USER')).set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 0, data: {} }).expect(409);
    expect(conflict.body).toMatchObject({ errorCode: 'VERSION_CONFLICT', requestId: 'profile-2' });

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('invite-reviewer', 'admin-1', 'SYSTEM_ADMIN'))
      .send({ accountId: 'reviewer-1', loginIdentifier: 'reviewer-1', accountType: 'STAFF', roles: ['NUTRITION_REVIEWER'], initialPassword: 'reviewer-pass-1' })
      .expect(201);
    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('reviewer-password', 'reviewer-1', 'NUTRITION_REVIEWER'))
      .send({ accountId: 'reviewer-1', currentPassword: 'reviewer-pass-1', newPassword: 'reviewer-pass-2', expectedVersion: 1 })
      .expect(200);
    const reviewerLogin = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('reviewer-login', 'reviewer-1', 'NUTRITION_REVIEWER'))
      .send({ loginIdentifier: 'reviewer-1', password: 'reviewer-pass-2', sessionKind: 'STAFF', mfaVerified: false })
      .expect(201);

    await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('reviewer-wrong-kind', 'reviewer-1', 'NUTRITION_REVIEWER'))
      .send({ loginIdentifier: 'reviewer-1', password: 'reviewer-pass-2', sessionKind: 'USER', mfaVerified: false })
      .expect(403);

    await agent.post('/api/v1/onboarding/screening-results')
      .set(writeHeaders('forged-role', 'reviewer-1', 'TRAINING_REVIEWER'))
      .set('Authorization', `Bearer ${reviewerLogin.body.sessionToken}`)
      .send({ userId: 'user-1', conclusion: 'HUMAN_REVIEW', source: 'MANUAL_REVIEW', ruleVersion: null })
      .expect(403);

    const screening = await agent.post('/api/v1/onboarding/screening-results')
      .set(writeHeaders('screening-1', 'reviewer-1', 'NUTRITION_REVIEWER'))
      .set('Authorization', `Bearer ${reviewerLogin.body.sessionToken}`)
      .send({ userId: 'user-1', conclusion: 'HUMAN_REVIEW', source: 'MANUAL_REVIEW', ruleVersion: null })
      .expect(201);
    expect(screening.body).toMatchObject({ businessStatus: 'SCREENING_RECORDED', conclusion: 'HUMAN_REVIEW' });
    expect(screening.body).not.toHaveProperty('diagnosis');

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('invite-admin', 'admin-1', 'SYSTEM_ADMIN'))
      .send({ accountId: 'admin-1', loginIdentifier: 'admin-1', accountType: 'STAFF', roles: ['SYSTEM_ADMIN'], initialPassword: 'admin-pass-1' })
      .expect(201);
    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('admin-password', 'admin-1', 'SYSTEM_ADMIN'))
      .send({ accountId: 'admin-1', currentPassword: 'admin-pass-1', newPassword: 'admin-pass-2', expectedVersion: 1 }).expect(200);
    const adminLogin = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('admin-login', 'admin-1', 'SYSTEM_ADMIN'))
      .send({ loginIdentifier: 'admin-1', password: 'admin-pass-2', sessionKind: 'STAFF', mfaVerified: false }).expect(201);
    await agent.post('/api/v1/identity/accounts/user-1/status')
      .set(writeHeaders('disable-user', 'admin-1', 'SYSTEM_ADMIN'))
      .set('Authorization', `Bearer ${adminLogin.body.sessionToken}`)
      .send({ status: 'DISABLED', expectedVersion: 2 }).expect(200);
    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('after-disable', 'user-1', 'USER')).set('Authorization', `Bearer ${token}`)
      .send({ consentVersion: 'consent-v2' }).expect(401);
  });

  it('blocks production identity paths without an approved auth policy', async () => {
    app = await buildApplication({ ...environment, authSecurityPolicyApproved: false });
    await request(app.getHttpServer()).post('/api/v1/identity/invitations')
      .set(writeHeaders('blocked-1', 'admin-1', 'SYSTEM_ADMIN'))
      .send({ accountId: 'user-x', loginIdentifier: 'x', accountType: 'USER', roles: [], initialPassword: 'initial-pass-1' })
      .expect(503)
      .expect(({ body }) => expect(body.errorCode).toBe('AUTH_SECURITY_POLICY_UNAPPROVED'));
  });

  it('locks an account at the configured failed-attempt threshold and revokes existing sessions', async () => {
    app = await buildApplication(environment, {
      authPolicy: { ...policy, maxFailedAttempts: 2 },
    });
    const agent = request(app.getHttpServer());

    await agent.post('/api/v1/identity/invitations')
      .set(writeHeaders('lock-invite', 'bootstrap-admin', 'SYSTEM_ADMIN'))
      .send({ accountId: 'lock-user', loginIdentifier: 'lock-user', accountType: 'USER', roles: [], initialPassword: 'initial-pass-1' })
      .expect(201);
    await agent.post('/api/v1/identity/password/change')
      .set(writeHeaders('lock-password', 'lock-user', 'USER'))
      .send({ accountId: 'lock-user', currentPassword: 'initial-pass-1', newPassword: 'changed-pass-1', expectedVersion: 1 })
      .expect(200);
    const login = await agent.post('/api/v1/identity/sessions')
      .set(writeHeaders('lock-login', 'lock-user', 'USER'))
      .send({ loginIdentifier: 'lock-user', password: 'changed-pass-1', sessionKind: 'USER', mfaVerified: false })
      .expect(201);

    for (const requestId of ['failed-login-1', 'failed-login-2']) {
      await agent.post('/api/v1/identity/sessions')
        .set(writeHeaders(requestId, 'lock-user', 'USER'))
        .send({ loginIdentifier: 'lock-user', password: 'wrong-password', sessionKind: 'USER', mfaVerified: false })
        .expect(401);
    }

    await agent.post('/api/v1/onboarding/consents')
      .set(writeHeaders('locked-session', 'lock-user', 'USER'))
      .set('Authorization', `Bearer ${login.body.sessionToken}`)
      .send({ consentVersion: 'consent-v1' })
      .expect(401);
  });
});

function writeHeaders(requestId: string, actorId: string, actorRole: string) {
  return { 'x-request-id': requestId, 'idempotency-key': requestId, 'x-actor-id': actorId, 'x-actor-role': actorRole };
}
