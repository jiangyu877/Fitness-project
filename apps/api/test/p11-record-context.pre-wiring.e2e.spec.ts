import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import type { Environment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';
import type { RouteAccessSnapshot } from '../src/readiness/route-access.js';
import type { P11RecordPortSchema } from '../src/records/p11-record-repository.port.js';
import { P11_RECORD_REPOSITORY } from '../src/records/p11-record-repository.token.js';
import type {
  P11RecordContextInput,
  P11RecordContextPort,
  P11RecordContextResult,
} from '../src/records/p11-record-context.port.js';
import { P11_RECORD_CONTEXT } from '../src/records/p11-record-context.token.js';
import { buildApplication } from './build-test-application.js';

const environment: Environment = {
  nodeEnv: 'test', port: 3000, databasePath: 'memory://', demoMode: false,
  professionalRulesApproved: false, authSecurityPolicyApproved: true,
  privacyReviewApproved: false, dataRightsDrillComplete: false,
  backupRestoreDrillComplete: false, operationsReadinessApproved: false,
  deploymentSecurityApproved: false,
};

const policy: AuthSecurityPolicy = {
  approved: true, passwordMinLength: 10, sessionTtlSeconds: 900,
  passwordChangeTtlSeconds: 300, maxFailedAttempts: 3,
  mfaRequiredForStaff: false, scryptCost: 16_384, scryptBlockSize: 8,
  scryptParallelization: 1, scryptKeyLength: 32,
};

const contextSchema = {
  version: 'context-schema-opaque', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{ id: 'context-kind-opaque', fields: [], allowedActions: ['UPSERT_RECORD'] }],
} as const satisfies P11RecordPortSchema;

class LocalContextFake implements P11RecordContextPort {
  readonly inputs: P11RecordContextInput[] = [];
  readonly schemas: Array<P11RecordPortSchema | undefined> = [];
  readonly internalDetail = 'context-reader-internal-opaque';

  async getContext(
    input: P11RecordContextInput,
    schema?: P11RecordPortSchema,
  ): Promise<P11RecordContextResult> {
    this.inputs.push(structuredClone(input));
    this.schemas.push(schema && structuredClone(schema));
    return {
      taskId: 'resolved-task-opaque',
      planVersion: 'plan-version-opaque',
      businessDate: 'business-date-opaque',
      accessMode: 'EDITABLE',
      records: [],
    };
  }

  get callCount() { return this.inputs.length; }
}

describe('P11 record context API test-only pre-wiring', () => {
  let app: INestApplication | undefined;
  afterEach(async () => app?.close());

  it('maps a test-only context fake to the frozen success envelope', async () => {
    const fake = new LocalContextFake();
    const options = {
      authPolicy: policy,
      routeAccessSnapshot: routeSnapshot('ALLOW'),
      recordSchemaProvider: { getApprovedRecordSchema: async () => contextSchema },
      recordContext: fake,
    };
    app = await buildApplication(
      environment,
      options,
    );
    const token = 'context-test-issued-token';
    await seedUser(app, token);

    const requestId = 'context-request-opaque';
    const response = await request(app.getHttpServer())
      .get('/api/v1/record-tasks/requested-task-opaque/context')
      .set('Authorization', `Bearer ${token}`)
      .set('x-request-id', requestId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      businessStatus: 'RECORD_CONTEXT_AVAILABLE',
      taskId: 'resolved-task-opaque',
      planVersion: 'plan-version-opaque',
      businessDate: 'business-date-opaque',
      accessMode: 'EDITABLE',
      schema: {
        version: 'context-schema-opaque',
        testOnly: true,
        recordKinds: [{ id: 'context-kind-opaque', fields: [], allowedActions: ['UPSERT_RECORD'] }],
      },
      records: [],
    });
    expect(Object.keys(response.body).sort()).toEqual([
      'accessMode', 'businessDate', 'businessStatus', 'planVersion', 'records', 'schema', 'taskId',
    ]);
    expect(fake.callCount).toBe(1);
    expect(fake.inputs).toEqual([{
      sessionTokenHash: createHash('sha256').update(token).digest('hex'),
      taskId: 'requested-task-opaque',
      requestId,
      nodeEnv: 'test',
    }]);
    expect(fake.schemas).toEqual([contextSchema]);
    expect(app.get(P11_RECORD_REPOSITORY)).toBeNull();
    const serialized = JSON.stringify(response.body);
    for (const internal of [token, fake.inputs[0]?.sessionTokenHash ?? '', fake.internalDetail]) {
      expect(serialized).not.toContain(internal);
    }

    await app.close();
    const productionFake = new LocalContextFake();
    app = await buildApplication({ ...environment, nodeEnv: 'production' }, {
      authPolicy: policy,
      recordSchemaProvider: { getApprovedRecordSchema: async () => contextSchema },
      recordContext: productionFake,
      routeAccessSnapshot: routeSnapshot('ALLOW'),
    });
    expect(app.get(P11_RECORD_CONTEXT)).toBeNull();
    const productionResponse = await request(app.getHttpServer())
      .get('/api/v1/record-tasks/requested-task-opaque/context')
      .set('Authorization', 'Bearer production-context-token')
      .set('x-request-id', 'production-context-request');
    expect(productionResponse.status).not.toBe(200);
    expect(productionFake.callCount).toBe(0);
  });
});

function routeSnapshot(route: 'ALLOW' | 'BLOCK'): RouteAccessSnapshot {
  return Object.freeze({
    audience: 'TEST',
    blockers: Object.freeze(route === 'BLOCK' ? ['TEST_FIXTURE_ROUTE_BLOCKED'] : []),
    allowProtectedRoutes: route === 'ALLOW',
  });
}

async function seedUser(app: INestApplication, token: string) {
  const accountId = 'context-test-user';
  const passwordHash = await hashPassword('seed-password-1', policy);
  const database = app.get(DatabaseService).database;
  await database.query(`INSERT INTO iam.account
    (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ($1,$1,$2,'USER','ACTIVE',false)`, [accountId, passwordHash]);
  await database.query(`INSERT INTO iam.session
    (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
    VALUES ($1,$2,'USER',$3,false,now() + interval '15 minutes','USER','FULL')`, [
    'context-test-session', accountId, createHash('sha256').update(token).digest('hex'),
  ]);
}
