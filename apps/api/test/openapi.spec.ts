import { afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { buildApplication } from '../src/application.js';
import { createOpenApiDocument } from '../src/openapi.js';

describe('OpenAPI contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('describes stable readiness and demo fixture contracts', async () => {
    app = await buildApplication({
      nodeEnv: 'test',
      port: 3000,
      databasePath: 'memory://',
      demoMode: true,
      professionalRulesApproved: false,
      authSecurityPolicyApproved: false,
      privacyReviewApproved: false,
      dataRightsDrillComplete: false,
      backupRestoreDrillComplete: false,
      operationsReadinessApproved: false,
      deploymentSecurityApproved: false,
    });

    const document = createOpenApiDocument(app);
    const serialized = JSON.stringify(document);

    expect(document.paths).toHaveProperty('/api/v1/readiness');
    expect(document.paths).toHaveProperty('/api/v1/demo/personas/{fixtureId}');
    expect(document.paths).toHaveProperty('/api/v1/plan-versions');
    expect(document.paths).toHaveProperty('/api/v1/plan-versions/{id}/transitions');
    expect(document.paths).toHaveProperty('/api/v1/users/{userId}/plans/current');
    expect(document.paths).toHaveProperty('/api/v1/users/{userId}/plans/history');
    for (const path of [
      '/api/v1/identity/invitations',
      '/api/v1/identity/password/change',
      '/api/v1/identity/sessions',
      '/api/v1/identity/accounts/{id}/status',
      '/api/v1/onboarding/consents',
      '/api/v1/onboarding/consents/{id}/withdraw',
      '/api/v1/onboarding/profile/steps/{step}',
      '/api/v1/onboarding/screening-results',
    ]) expect(document.paths).toHaveProperty(path);
    const invitation = document.paths['/api/v1/identity/invitations']?.post;
    expect(invitation?.requestBody).toBeDefined();
    expect(invitation?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'x-request-id', in: 'header', required: true }),
      expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }),
    ]));
    expect(invitation?.parameters).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'x-actor-id' }),
      expect.objectContaining({ name: 'x-actor-role' }),
    ]));
    expect(invitation?.security).toEqual(expect.arrayContaining([expect.objectContaining({ bearer: [] })]));
    expect(invitation?.responses).toHaveProperty('401');
    expect(document.paths['/api/v1/onboarding/screening-results']?.post?.requestBody).toBeDefined();
    expect(JSON.stringify(document.paths['/api/v1/identity/sessions'])).not.toContain('mfaVerified');
    expect(JSON.stringify(document.paths['/api/v1/identity/sessions'])).toContain('actingRole');
    for (const errorCode of [
      'IDEMPOTENCY_KEY_REUSED',
      'LOGIN_REPLAY_REQUIRES_REAUTHENTICATION',
      'MFA_VERIFIER_UNAVAILABLE',
      'PROFESSIONAL_QUALIFICATION_REQUIRED',
      'INVALID_CREDENTIALS',
      'SESSION_INVALID',
      'SESSION_KIND_MISMATCH',
      'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED',
    ]) expect(serialized).toContain(errorCode);
    for (const blocker of [
      'DEMO_MODE_ACTIVE',
      'PROFESSIONAL_RULES_UNAPPROVED',
      'AUTH_SECURITY_POLICY_UNAPPROVED',
      'PRIVACY_REVIEW_UNAPPROVED',
      'DATA_RIGHTS_DRILL_INCOMPLETE',
      'BACKUP_RESTORE_DRILL_INCOMPLETE',
      'OPERATIONS_READINESS_INCOMPLETE',
      'DEPLOYMENT_SECURITY_UNAPPROVED',
    ]) expect(serialized).toContain(blocker);
    expect(serialized).toContain('persona_fat_loss');
    expect(serialized).toContain('persona_muscle_gain');
    expect(serialized).toContain('DEMO_UNREVIEWED');
    expect(serialized).toContain('PENDING_CONFIRMATION');
    expect(serialized).toContain('CONFIRMATION_TIMED_OUT');
    expect(serialized).toContain('PLAN_GAP');
    expect(serialized).toContain('SINGLE_PENDING_VERSION_REQUIRED');
    expect(serialized).not.toContain('initial-pass-1');
    expect(serialized).not.toContain('changed-pass-1');
    expect(serialized).not.toMatch(/calorie|exercise|threshold|meal/i);
  });
});
