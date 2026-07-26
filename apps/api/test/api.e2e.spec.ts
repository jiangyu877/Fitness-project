import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApplication } from './build-test-application.js';
import type { Environment } from '../src/config/environment.js';
import { createRouteAccessSnapshot } from '../src/readiness/route-access.js';
import { DatabaseService } from '../src/database/database.service.js';
import { buildApplication as buildProductionApplication } from '../src/application.js';
import { PLAN_LIFECYCLE_CLOCK, type PlanLifecycleClock } from '../src/plans/plan-lifecycle.service.js';

const baseEnvironment: Environment = {
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
};

describe('phase 1 HTTP API contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reports health without exposing configuration', async () => {
    app = await buildApplication(baseEnvironment);

    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('ignores an injected plan clock outside the test environment', async () => {
    app = await buildProductionApplication({ ...baseEnvironment, nodeEnv: 'production', demoMode: false }, {
      planClock: { now: () => new Date('2099-01-01T00:00:00.000Z') },
    });

    expect(app.get<PlanLifecycleClock>(PLAN_LIFECYCLE_CLOCK).now).toBeUndefined();
  });

  it('reports stable readiness blockers while professional rules are unsigned', async () => {
    app = await buildApplication(baseEnvironment);

    await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .expect(200)
      .expect({
        readyForRealUsers: false,
        blockers: [
          'DEMO_MODE_ACTIVE',
          'PROFESSIONAL_RULES_UNAPPROVED',
          'AUTH_SECURITY_POLICY_UNAPPROVED',
          'PRIVACY_REVIEW_UNAPPROVED',
          'DATA_RIGHTS_DRILL_INCOMPLETE',
          'BACKUP_RESTORE_DRILL_INCOMPLETE',
          'OPERATIONS_READINESS_INCOMPLETE',
          'DEPLOYMENT_SECURITY_UNAPPROVED',
          'APPROVED_CONSENT_PROVIDER_UNAVAILABLE',
          'SCREENING_APPROVAL_PROVIDER_UNAVAILABLE',
          'PROFILE_SCHEMA_PROVIDER_UNAVAILABLE',
        ],
      });
  });

  it('does not become ready from professional approval alone', async () => {
    app = await buildApplication({ ...baseEnvironment, professionalRulesApproved: true });
    const response = await request(app.getHttpServer()).get('/api/v1/readiness').expect(200);
    expect(response.body).toEqual({
      readyForRealUsers: false,
      blockers: [
        'DEMO_MODE_ACTIVE',
        'AUTH_SECURITY_POLICY_UNAPPROVED',
        'PRIVACY_REVIEW_UNAPPROVED',
        'DATA_RIGHTS_DRILL_INCOMPLETE',
        'BACKUP_RESTORE_DRILL_INCOMPLETE',
        'OPERATIONS_READINESS_INCOMPLETE',
        'DEPLOYMENT_SECURITY_UNAPPROVED',
        'APPROVED_CONSENT_PROVIDER_UNAVAILABLE',
        'SCREENING_APPROVAL_PROVIDER_UNAVAILABLE',
        'PROFILE_SCHEMA_PROVIDER_UNAVAILABLE',
      ],
    });
  });

  it('is ready only when demo is off and all seven evidence gates are explicit', async () => {
    const readyEnvironment = {
      ...baseEnvironment,
      demoMode: false,
      professionalRulesApproved: true,
      authSecurityPolicyApproved: true,
      privacyReviewApproved: true,
      dataRightsDrillComplete: true,
      backupRestoreDrillComplete: true,
      operationsReadinessApproved: true,
      deploymentSecurityApproved: true,
    };
    app = await buildProductionApplication(readyEnvironment, {
      authPolicy: approvedPolicy,
      mfaVerifier: approvedMfaVerifier,
      profileFingerprintSecret: 'test-profile-secret',
      currentConsentVersion: { getCurrentConsentVersion: async () => 'consent-v1' },
      ...fictionalP07Providers,
    });
    await request(app.getHttpServer()).get('/api/v1/readiness').expect(200).expect({
      readyForRealUsers: true,
      blockers: [],
    });
  });

  it('keeps real-user readiness false when any P07 provider is unavailable', async () => {
    const readyEnvironment = {
      ...baseEnvironment, demoMode: false, professionalRulesApproved: true,
      authSecurityPolicyApproved: true, privacyReviewApproved: true,
      dataRightsDrillComplete: true, backupRestoreDrillComplete: true,
      operationsReadinessApproved: true, deploymentSecurityApproved: true,
    };
    app = await buildProductionApplication(readyEnvironment, {
      authPolicy: approvedPolicy, mfaVerifier: approvedMfaVerifier,
      profileFingerprintSecret: 'test-profile-secret',
      currentConsentVersion: { getCurrentConsentVersion: async () => 'consent-v1' },
    });
    await request(app.getHttpServer()).get('/api/v1/readiness').expect(200)
      .expect(({ body }) => {
        expect(body.readyForRealUsers).toBe(false);
        expect(body.blockers).toEqual(expect.arrayContaining([
          'APPROVED_CONSENT_PROVIDER_UNAVAILABLE',
          'SCREENING_APPROVAL_PROVIDER_UNAVAILABLE',
          'PROFILE_SCHEMA_PROVIDER_UNAVAILABLE',
        ]));
      });
  });

  it.each([
    ['persona_fat_loss', 'FAT_LOSS'],
    ['persona_muscle_gain', 'MUSCLE_GAIN'],
  ] as const)('serves protected demo fixture %s', async (fixtureId, goalType) => {
    app = await buildApplication(baseEnvironment);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/demo/personas/${fixtureId}`)
      .expect(200);

    expect(response.body).toEqual({
      fixtureId,
      goalType,
      demoOnly: true,
      reviewStatus: 'DEMO_UNREVIEWED',
      publishable: false,
      disclaimer: '仅用于原型演示，未经专业审核',
    });
  });

  it('returns not found for an unknown fixture', async () => {
    app = await buildApplication(baseEnvironment);

    await request(app.getHttpServer())
      .get('/api/v1/demo/personas/unknown')
      .expect(404);
  });

  it('does not register demo routes when demo mode is disabled', async () => {
    app = await buildApplication({ ...baseEnvironment, demoMode: false });

    await request(app.getHttpServer())
      .get('/api/v1/demo/personas/persona_fat_loss')
      .expect(404);
  });

  it.each([
    ['identity', 'post', '/api/v1/identity/sessions'],
    ['onboarding', 'post', '/api/v1/onboarding/consents'],
    ['plans', 'post', '/api/v1/plan-versions'],
    ['plan-detail', 'get', '/api/v1/plan-versions/blocked-plan'],
    ['plan-transition', 'post', '/api/v1/plan-versions/blocked-plan/transitions'],
    ['current-plan', 'get', '/api/v1/users/user-1/plans/current'],
    ['plan-history', 'get', '/api/v1/users/user-1/plans/history'],
    ['pending-plan-summary', 'get', '/api/v1/users/user-1/plans/pending'],
    ['task-candidates', 'get', '/api/v1/users/user-1/task-candidates'],
  ] as const)('blocks %s routes from one immutable real-user snapshot with zero side effects', async (_kind, method, path) => {
    const snapshot = createRouteAccessSnapshot({
      environment: baseEnvironment,
      audience: 'REAL_USER',
      authPolicyAvailable: false,
      mfaVerifierAvailable: false,
      hmacKeyAvailable: false,
      currentConsentVersionAvailable: false,
    });
    app = await buildApplication(baseEnvironment, { routeAccessSnapshot: snapshot });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.blockers)).toBe(true);
    const db = app.get(DatabaseService).database;
    const before = await businessSideEffectCounts(db);
    await request(app.getHttpServer())[method](path)
      .set('x-request-id', `blocked-${_kind}`).set('idempotency-key', `blocked-${_kind}`)
      .send({}).expect(503)
      .expect(({ body }) => expect(body.errorCode).toBe('ROUTE_ACCESS_NOT_APPROVED'));
    expect(await businessSideEffectCounts(db)).toEqual(before);
    expect(await routeRejectionAudits(db, `blocked-${_kind}`)).toEqual([expect.objectContaining({
      actor_id: null, actor_role: 'SYSTEM', outcome: 'REJECTED', error_code: 'ROUTE_ACCESS_NOT_APPROVED',
    })]);
  });

  it('fails closed for an unknown protected route even when all known gates are clear', async () => {
    const readyEnvironment = {
      ...baseEnvironment, demoMode: false, professionalRulesApproved: true,
      authSecurityPolicyApproved: true, privacyReviewApproved: true,
      dataRightsDrillComplete: true, backupRestoreDrillComplete: true,
      operationsReadinessApproved: true, deploymentSecurityApproved: true,
    };
    app = await buildProductionApplication(readyEnvironment, {
      authPolicy: approvedPolicy, mfaVerifier: approvedMfaVerifier,
      profileFingerprintSecret: 'test-profile-secret',
      currentConsentVersion: { getCurrentConsentVersion: async () => 'consent-v1' },
      routeAccessSnapshot: createRouteAccessSnapshot({
        environment: readyEnvironment, audience: 'REAL_USER', authPolicyAvailable: true,
        mfaVerifierAvailable: true, hmacKeyAvailable: true, currentConsentVersionAvailable: true,
      }),
    });
    const db = app.get(DatabaseService).database;
    const before = await businessSideEffectCounts(db);
    await request(app.getHttpServer()).post('/api/v1/onboarding/future-protected-write')
      .set('x-request-id', 'unknown-route').set('idempotency-key', 'unknown-route')
      .send({}).expect(503)
      .expect(({ body }) => expect(body.errorCode).toBe('ROUTE_ACCESS_NOT_APPROVED'));
    expect(await businessSideEffectCounts(db)).toEqual(before);
    expect(await routeRejectionAudits(db, 'unknown-route')).toHaveLength(1);
  });

  it.each([
    ['post', '/api/v1/readiness'],
    ['put', '/api/v1/readiness'],
    ['delete', '/api/v1/readiness'],
    ['post', '/api/v1/demo/personas/persona_fat_loss'],
    ['post', '/api/v1/demo/future'],
  ] as const)('guards non-public %s %s with one audit and zero side effects', async (method, path) => {
    app = await buildApplication({ ...baseEnvironment, demoMode: true }, {
      routeAccessSnapshot: createRouteAccessSnapshot({
        environment: { ...baseEnvironment, demoMode: true }, audience: 'REAL_USER',
        authPolicyAvailable: false, mfaVerifierAvailable: false,
        hmacKeyAvailable: false, currentConsentVersionAvailable: false,
      }),
    });
    const db = app.get(DatabaseService).database;
    const requestId = `guard-${method}-${path.replace(/\W/g, '-')}`;
    const before = await businessSideEffectCounts(db);
    await request(app.getHttpServer())[method](path).set('x-request-id', requestId).send({}).expect(503)
      .expect(({ body }) => expect(body.errorCode).toBe('ROUTE_ACCESS_NOT_APPROVED'));
    expect(await businessSideEffectCounts(db)).toEqual(before);
    expect(await routeRejectionAudits(db, requestId)).toEqual([expect.objectContaining({
      actor_id: null, actor_role: 'SYSTEM', outcome: 'REJECTED', error_code: 'ROUTE_ACCESS_NOT_APPROVED',
    })]);
  });

  it.each(['/api/v1/data-requests', '/api/v1/risk-events', '/api/v1/work-queue'])(
    'fails closed for future real-user business route %s', async (path) => {
      const readyEnvironment = {
        ...baseEnvironment, demoMode: false, professionalRulesApproved: true,
        authSecurityPolicyApproved: true, privacyReviewApproved: true,
        dataRightsDrillComplete: true, backupRestoreDrillComplete: true,
        operationsReadinessApproved: true, deploymentSecurityApproved: true,
      };
      app = await buildApplication(readyEnvironment, {
        authPolicy: approvedPolicy, mfaVerifier: approvedMfaVerifier,
        profileFingerprintSecret: 'test-profile-secret',
        currentConsentVersion: { getCurrentConsentVersion: async () => 'consent-v1' },
        routeAccessSnapshot: createRouteAccessSnapshot({
          environment: readyEnvironment, audience: 'REAL_USER', authPolicyAvailable: true,
          mfaVerifierAvailable: true, hmacKeyAvailable: true, currentConsentVersionAvailable: true,
        }),
      });
      const requestId = `future-${path.split('/').at(-1)}`;
      const db = app.get(DatabaseService).database;
      const before = await businessSideEffectCounts(db);
      await request(app.getHttpServer()).post(path).set('x-request-id', requestId).send({}).expect(503);
      expect(await businessSideEffectCounts(db)).toEqual(before);
      expect(await routeRejectionAudits(db, requestId)).toHaveLength(1);
    },
  );

  it('ignores a forged REAL_USER snapshot when actual providers are absent', async () => {
    const readyEnvironment = {
      ...baseEnvironment, demoMode: false, professionalRulesApproved: true,
      authSecurityPolicyApproved: true, privacyReviewApproved: true,
      dataRightsDrillComplete: true, backupRestoreDrillComplete: true,
      operationsReadinessApproved: true, deploymentSecurityApproved: true,
    };
    const forged = createRouteAccessSnapshot({
      environment: readyEnvironment, audience: 'REAL_USER', authPolicyAvailable: true,
      mfaVerifierAvailable: true, hmacKeyAvailable: true, currentConsentVersionAvailable: true,
    });
    app = await buildApplication(readyEnvironment, { routeAccessSnapshot: forged });
    const agent = request(app.getHttpServer());
    await agent.get('/api/v1/readiness').expect(200)
      .expect(({ body }) => expect(body.readyForRealUsers).toBe(false));
    await agent.post('/api/v1/identity/sessions').set('x-request-id', 'forged-snapshot').send({}).expect(503);
  });

  it('pins an invalid authentication policy as a technical blocker and closes protected routes', async () => {
    const readyEnvironment = {
      ...baseEnvironment, demoMode: false, professionalRulesApproved: true,
      authSecurityPolicyApproved: true, privacyReviewApproved: true,
      dataRightsDrillComplete: true, backupRestoreDrillComplete: true,
      operationsReadinessApproved: true, deploymentSecurityApproved: true,
    };
    app = await buildProductionApplication(readyEnvironment, {
      authPolicy: { ...approvedPolicy, passwordChangeTtlSeconds: approvedPolicy.sessionTtlSeconds },
      mfaVerifier: approvedMfaVerifier, profileFingerprintSecret: 'test-profile-secret',
      currentConsentVersion: { getCurrentConsentVersion: async () => 'consent-v1' },
    });
    const agent = request(app.getHttpServer());
    await agent.get('/api/v1/readiness').expect(200).expect(({ body }) => {
      expect(body.readyForRealUsers).toBe(false);
      expect(body.blockers).toContain('AUTH_SECURITY_POLICY_INVALID');
    });
    await agent.post('/api/v1/identity/sessions')
      .set('x-request-id', 'invalid-policy-route').set('idempotency-key', 'invalid-policy-route')
      .send({}).expect(503).expect(({ body }) => expect(body.errorCode).toBe('ROUTE_ACCESS_NOT_APPROVED'));
    expect(await routeRejectionAudits(app.get(DatabaseService).database, 'invalid-policy-route')).toHaveLength(1);
  });

  it('rejects excessive scrypt CPU work before a REAL_USER business route', async () => {
    const readyEnvironment = {
      ...baseEnvironment, demoMode: false, professionalRulesApproved: true,
      authSecurityPolicyApproved: true, privacyReviewApproved: true,
      dataRightsDrillComplete: true, backupRestoreDrillComplete: true,
      operationsReadinessApproved: true, deploymentSecurityApproved: true,
    };
    app = await buildProductionApplication(readyEnvironment, {
      authPolicy: {
        ...approvedPolicy, scryptCost: 2 ** 15, scryptBlockSize: 1, scryptParallelization: 2 ** 15,
      },
      mfaVerifier: approvedMfaVerifier, profileFingerprintSecret: 'test-profile-secret',
      currentConsentVersion: { getCurrentConsentVersion: async () => 'consent-v1' },
    });
    const agent = request(app.getHttpServer());
    await agent.get('/api/v1/readiness').expect(200).expect(({ body }) => {
      expect(body.readyForRealUsers).toBe(false);
      expect(body.blockers).toContain('AUTH_SECURITY_POLICY_INVALID');
    });
    await agent.post('/api/v1/identity/sessions')
      .set('x-request-id', 'cpu-policy-route').set('idempotency-key', 'cpu-policy-route')
      .send({}).expect(503)
      .expect(({ body }) => expect(body.errorCode).toBe('ROUTE_ACCESS_NOT_APPROVED'));
  });

  it.each([
    ['throws', { getCurrentConsentVersion: async (): Promise<string> => { throw new Error('provider down'); } }],
    ['empty', { getCurrentConsentVersion: async (): Promise<string> => '   ' }],
  ] as const)('fails closed when current consent provider %s at startup', async (_case, currentConsentVersion) => {
    const readyEnvironment = {
      ...baseEnvironment, demoMode: false, professionalRulesApproved: true,
      authSecurityPolicyApproved: true, privacyReviewApproved: true, dataRightsDrillComplete: true,
      backupRestoreDrillComplete: true, operationsReadinessApproved: true, deploymentSecurityApproved: true,
    };
    app = await buildProductionApplication(readyEnvironment, {
      authPolicy: approvedPolicy, mfaVerifier: approvedMfaVerifier,
      profileFingerprintSecret: 'test-profile-secret', currentConsentVersion,
    });
    const response = await request(app.getHttpServer()).get('/api/v1/readiness').expect(200);
    expect(response.body).toMatchObject({ readyForRealUsers: false });
    expect(response.body.blockers).toContain('CURRENT_CONSENT_VERSION_UNAVAILABLE');
  });

  it('pins the current consent version once so readiness and runtime cannot drift', async () => {
    let calls = 0;
    const provider = {
      getCurrentConsent: async () => ({
        version: ++calls === 1 ? 'consent-v1' : 'consent-v2',
        content: { format: 'PLAIN_TEXT' as const, text: 'FICTIONAL PINNING TEST CONSENT' },
      }),
    };
    const readyEnvironment = {
      ...baseEnvironment, demoMode: false, professionalRulesApproved: true,
      authSecurityPolicyApproved: true, privacyReviewApproved: true, dataRightsDrillComplete: true,
      backupRestoreDrillComplete: true, operationsReadinessApproved: true, deploymentSecurityApproved: true,
    };
    app = await buildProductionApplication(readyEnvironment, {
      authPolicy: approvedPolicy, mfaVerifier: approvedMfaVerifier,
      profileFingerprintSecret: 'test-profile-secret', consentProvider: provider,
      screeningProvider: fictionalP07Providers.screeningProvider,
      profileSchemaProvider: fictionalP07Providers.profileSchemaProvider,
    });
    await request(app.getHttpServer()).get('/api/v1/readiness').expect(200)
      .expect(({ body }) => expect(body.readyForRealUsers).toBe(true));
    expect(calls).toBe(1);
  });
});

const approvedPolicy = {
  approved: true, passwordMinLength: 10, sessionTtlSeconds: 900, passwordChangeTtlSeconds: 300,
  maxFailedAttempts: 3, mfaRequiredForStaff: false, scryptCost: 16_384,
  scryptBlockSize: 8, scryptParallelization: 1, scryptKeyLength: 32,
} as const;
const approvedMfaVerifier = { verify: async () => true };
const fictionalP07Providers = {
  consentProvider: {
    getCurrentConsent: async () => ({
      version: 'consent-v1',
      content: { format: 'PLAIN_TEXT' as const, text: 'FICTIONAL READINESS TEST CONSENT' },
    }),
  },
  screeningProvider: { isApprovedConclusion: async () => true },
  profileSchemaProvider: {
    getApprovedProfileSchema: async () => ({
      version: 'profile-readiness-test-v1',
      steps: [{ id: 'readiness', fields: [{ name: 'fictionalReady', type: 'BOOLEAN' as const, required: true }] }],
    }),
  },
};

async function businessSideEffectCounts(db: DatabaseService['database']) {
  const result = await db.query<{ accounts: number; consents: number; plans: number; idempotency: number }>(`
    SELECT
      (SELECT count(*)::int FROM iam.account) AS accounts,
      (SELECT count(*)::int FROM care.consent_record) AS consents,
      (SELECT count(*)::int FROM planning.plan_version) AS plans,
      (SELECT count(*)::int FROM audit.idempotency_key) AS idempotency
  `);
  return result.rows[0];
}

async function routeRejectionAudits(db: DatabaseService['database'], requestId: string) {
  return (await db.query(
    `SELECT actor_id, actor_role, outcome, error_code FROM audit.audit_event WHERE request_id=$1`, [requestId],
  )).rows;
}
