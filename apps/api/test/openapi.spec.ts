import { afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { buildApplication } from './build-test-application.js';
import { createOpenApiDocument } from '../src/openapi.js';
import { isClassifiedProtectedRoute } from '../src/readiness/route-access.js';

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
    for (const [path, pathItem] of Object.entries(document.paths)) {
      if (!path.startsWith('/api/v1/') || path === '/api/v1/readiness' || path.startsWith('/api/v1/demo/')) continue;
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        if (pathItem?.[method]) {
          const runtimePath = path.replace(/\{[^}]+\}/g, 'known-id');
          expect(isClassifiedProtectedRoute(method, runtimePath), `${method.toUpperCase()} ${path}`).toBe(true);
          const unavailable = pathItem[method]?.responses?.['503'] as { content?: Record<string, { schema?: unknown }> } | undefined;
          expect(unavailable?.content?.['application/json']?.schema, `503 ${method.toUpperCase()} ${path}`).toBeDefined();
        }
      }
    }

    expect(document.paths).toHaveProperty('/api/v1/readiness');
    expect(document.paths).toHaveProperty('/api/v1/demo/personas/{fixtureId}');
    expect(document.paths).toHaveProperty('/api/v1/plan-versions');
    expect(document.paths).toHaveProperty('/api/v1/plan-versions/{id}/transitions');
    expect(document.paths).toHaveProperty('/api/v1/users/{userId}/plans/current');
    expect(document.paths).toHaveProperty('/api/v1/users/{userId}/plans/history');
    expect(document.paths).toHaveProperty('/api/v1/users/{userId}/plans/pending');
    expect(document.paths).toHaveProperty('/api/v1/users/{userId}/task-candidates');
    expect(document.paths['/api/v1/users/{userId}/plans/current']?.get?.parameters).toEqual([
      expect.objectContaining({ name: 'userId', in: 'path', required: true }),
    ]);
    for (const path of [
      '/api/v1/identity/invitations',
      '/api/v1/identity/password/change',
      '/api/v1/identity/sessions',
      '/api/v1/identity/session',
      '/api/v1/identity/session/logout',
      '/api/v1/identity/accounts/{id}/status',
      '/api/v1/onboarding/consents',
      '/api/v1/onboarding/consents/current',
      '/api/v1/onboarding/consents/{id}/withdraw',
      '/api/v1/onboarding/profile',
      '/api/v1/onboarding/profile/steps/{step}',
      '/api/v1/onboarding/screening-status',
      '/api/v1/onboarding/screening-results',
    ]) expect(document.paths).toHaveProperty(path);
    for (const [path, method, status] of [
      ['/api/v1/identity/invitations', 'post', '201'],
      ['/api/v1/identity/password/change', 'post', '200'],
      ['/api/v1/identity/sessions', 'post', '201'],
      ['/api/v1/identity/session', 'get', '200'],
      ['/api/v1/identity/session/logout', 'post', '200'],
      ['/api/v1/identity/accounts/{id}/status', 'post', '200'],
      ['/api/v1/onboarding/consents', 'post', '201'],
      ['/api/v1/onboarding/consents/current', 'get', '200'],
      ['/api/v1/onboarding/consents/{id}/withdraw', 'post', '200'],
      ['/api/v1/onboarding/profile', 'get', '200'],
      ['/api/v1/onboarding/profile/steps/{step}', 'put', '200'],
      ['/api/v1/onboarding/screening-status', 'get', '200'],
      ['/api/v1/onboarding/screening-results', 'post', '201'],
    ] as const) {
      const operation = document.paths[path]?.[method];
      const response = operation?.responses?.[status] as { content?: Record<string, { schema?: unknown }> } | undefined;
      expect(response?.content?.['application/json']?.schema, `${method.toUpperCase()} ${path}`).toBeDefined();
    }
    const sessionHeaders = document.paths['/api/v1/identity/session']?.get?.parameters;
    expect(sessionHeaders).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'x-request-id', required: true }),
    ]));
    expect(sessionHeaders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'idempotency-key', required: true }),
    ]));
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
    for (const operation of [
      document.paths['/api/v1/plan-versions']?.post,
      document.paths['/api/v1/plan-versions/{id}/transitions']?.post,
    ]) {
      expect(operation?.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'x-request-id', in: 'header', required: true }),
        expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }),
      ]));
      expect(operation?.security).toEqual(expect.arrayContaining([expect.objectContaining({ bearer: [] })]));
      expect(operation?.responses).toHaveProperty('401');
      expect(operation?.responses).toHaveProperty('403');
    }
    const transitionOperation = document.paths['/api/v1/plan-versions/{id}/transitions']?.post;
    const transitionSchema = (transitionOperation?.requestBody as any)?.content?.['application/json']?.schema;
    expect(transitionSchema?.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({
        required: ['type'],
        properties: expect.objectContaining({ type: expect.objectContaining({ enum: ['CONFIRM_DIET'] }) }),
      }),
      expect.objectContaining({
        required: ['type'],
        properties: expect.objectContaining({ type: expect.objectContaining({ enum: ['REJECT_DIET'] }) }),
      }),
    ]));
    const userWriteSchemas = transitionSchema.oneOf.filter((schema: any) =>
      ['CONFIRM_DIET', 'CONFIRM_TRAINING', 'REJECT_DIET', 'REJECT_TRAINING'].includes(schema.properties.type.enum[0]),
    );
    expect(JSON.stringify(userWriteSchemas)).not.toContain('reasonCode');
    const staffActionSchema = transitionSchema.oneOf.find((schema: any) =>
      schema.properties.type.enum.includes('SUBMIT_REVIEW'),
    );
    expect(staffActionSchema.additionalProperties).toBe(false);
    expect(staffActionSchema.properties).not.toHaveProperty('reasonCode');
    for (const reviewRejection of ['REJECT_DIET_REVIEW', 'REJECT_TRAINING_REVIEW']) {
      const schema = transitionSchema.oneOf.find((candidate: any) =>
        candidate.properties.type.enum.includes(reviewRejection),
      );
      expect(schema.required).toEqual(['type', 'reasonCode']);
      expect(schema.additionalProperties).toBe(false);
    }
    expect(JSON.stringify(transitionSchema)).not.toContain('occurredAt');
    expect(JSON.stringify(transitionSchema)).not.toContain('SUPERSEDE');
    const transitionConflict = (transitionOperation?.responses?.['409'] as any)?.content?.['application/json']?.schema;
    expect(JSON.stringify(transitionConflict)).toContain('VERSION_CONFLICT');
    expect(JSON.stringify(transitionConflict)).toContain('IDEMPOTENCY_KEY_REUSED');
    expect(JSON.stringify(transitionConflict)).toContain('PLAN_VERSION_CONFLICT');
    for (const errorCode of [
      'INVALID_EFFECTIVE_WINDOW', 'EFFECTIVE_TO_REQUIRED', 'PLAN_VERSION_ALREADY_EXISTS',
      'CONFIRMATION_DEADLINE_NOT_REACHED', 'MULTIPLE_ACTIVE_PLAN_VERSIONS',
    ]) expect(JSON.stringify(transitionConflict)).toContain(errorCode);
    const createConflict = (document.paths['/api/v1/plan-versions']?.post?.responses?.['409'] as any)
      ?.content?.['application/json']?.schema;
    expect(JSON.stringify(createConflict)).toContain('INVALID_EFFECTIVE_WINDOW');
    expect(JSON.stringify(createConflict)).toContain('PLAN_VERSION_ALREADY_EXISTS');
    const transitionUnauthorized = (transitionOperation?.responses?.['401'] as any)?.content?.['application/json']?.schema;
    const transitionForbidden = (transitionOperation?.responses?.['403'] as any)?.content?.['application/json']?.schema;
    const transitionNotFound = (transitionOperation?.responses?.['404'] as any)?.content?.['application/json']?.schema;
    const transitionInvalid = (transitionOperation?.responses?.['422'] as any)?.content?.['application/json']?.schema;
    expect(JSON.stringify(transitionUnauthorized)).toContain('SESSION_INVALID');
    expect(JSON.stringify(transitionForbidden)).toContain('ROLE_NOT_AUTHORIZED');
    expect(JSON.stringify(transitionNotFound)).toContain('PLAN_VERSION_NOT_FOUND');
    expect(JSON.stringify(transitionInvalid)).toContain('REVIEW_REASON_CODE_REQUIRED');
    expect(JSON.stringify(transitionInvalid)).toContain('REQUEST_HEADER_REQUIRED');
    for (const operation of [
      document.paths['/api/v1/plan-versions/{id}']?.get,
      document.paths['/api/v1/users/{userId}/plans/current']?.get,
      document.paths['/api/v1/users/{userId}/plans/history']?.get,
      document.paths['/api/v1/users/{userId}/plans/pending']?.get,
      document.paths['/api/v1/users/{userId}/task-candidates']?.get,
    ]) {
      expect(operation?.security).toEqual(expect.arrayContaining([expect.objectContaining({ bearer: [] })]));
      expect(operation?.responses).toHaveProperty('401');
      expect(operation?.responses).toHaveProperty('403');
    }
    const pendingSchema = (document.paths['/api/v1/users/{userId}/plans/pending']?.get?.responses?.['200'] as any)
      ?.content?.['application/json']?.schema;
    expect(pendingSchema?.required).toEqual(expect.arrayContaining(['businessStatus', 'plan']));
    expect(JSON.stringify(pendingSchema)).toContain('allowedActions');
    expect(JSON.stringify(pendingSchema)).not.toMatch(/reviewer|createdBy/i);
    const taskCandidatesSchema = (document.paths['/api/v1/users/{userId}/task-candidates']?.get?.responses?.['200'] as any)
      ?.content?.['application/json']?.schema;
    expect(JSON.stringify(taskCandidatesSchema)).toContain('TASK_GENERATION_ALLOWED');
    expect(JSON.stringify(taskCandidatesSchema)).toContain('PLAN_GAP');
    expect(taskCandidatesSchema?.properties?.items?.maxItems).toBe(0);
    const detailSchema = (document.paths['/api/v1/plan-versions/{id}']?.get?.responses?.['200'] as any)
      ?.content?.['application/json']?.schema;
    expect(JSON.stringify(detailSchema)).toContain('allowedActions');
    expect(document.paths['/api/v1/onboarding/screening-results']?.post?.requestBody).toBeDefined();
    expect(JSON.stringify(document.paths['/api/v1/identity/sessions'])).not.toContain('mfaVerified');
    expect(JSON.stringify(document.paths['/api/v1/identity/sessions'])).toContain('actingRole');
    const loginSchema = (document.paths['/api/v1/identity/sessions']?.post?.responses?.['201'] as any)
      ?.content?.['application/json']?.schema;
    expect(loginSchema?.oneOf).toHaveLength(3);
    expect(loginSchema.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ required: expect.arrayContaining(['passwordChangeToken', 'expectedVersion']) }),
      expect.objectContaining({ required: expect.arrayContaining(['sessionId', 'sessionToken', 'nextAction']) }),
      expect.objectContaining({ required: expect.arrayContaining(['sessionId', 'sessionToken']) }),
    ]));
    const nextActions = [
      'ACCEPT_CURRENT_CONSENT', 'WAIT_FOR_SCREENING_RULES', 'WAIT_FOR_HUMAN_REVIEW',
      'STOP_SERVICE_FLOW', 'COMPLETE_PROFILE', 'WAIT_FOR_PLAN', 'CONTACT_OPERATIONS',
    ];
    const userLoginSchema = loginSchema.oneOf.find((schema: any) => schema.properties?.sessionType?.enum?.includes('USER'));
    expect(userLoginSchema.properties.nextAction.enum).toEqual(nextActions);
    const recoverySchema = (document.paths['/api/v1/identity/session']?.get?.responses?.['200'] as any)
      ?.content?.['application/json']?.schema;
    expect(recoverySchema.properties.nextAction.enum).toEqual(nextActions);
    for (const errorCode of [
      'IDEMPOTENCY_KEY_REUSED',
      'LOGIN_REPLAY_REQUIRES_REAUTHENTICATION',
      'MFA_VERIFIER_UNAVAILABLE',
      'PROFESSIONAL_QUALIFICATION_REQUIRED',
      'INVALID_CREDENTIALS',
      'SESSION_INVALID',
      'SESSION_KIND_MISMATCH',
      'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED',
      'PASSWORD_CHANGE_TOKEN_INVALID',
      'ACCOUNT_LOCKED',
      'ACCOUNT_DISABLED',
      'MFA_REQUIRED',
      'ROLE_NOT_AUTHORIZED',
      'VERSION_CONFLICT',
      'CURRENT_CONSENT_VERSION_REQUIRED',
      'CURRENT_CONSENT_VERSION_UNAVAILABLE',
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
      'AUTH_POLICY_PROVIDER_UNAVAILABLE',
      'AUTH_SECURITY_POLICY_INVALID',
      'MFA_VERIFIER_UNAVAILABLE',
      'HMAC_KEY_UNAVAILABLE',
      'CURRENT_CONSENT_VERSION_UNAVAILABLE',
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
