import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApplication } from './build-test-application.js';
import type { Environment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';

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

describe('P11 record safe-structure runtime authorization', () => {
  let app: INestApplication | undefined;
  afterEach(async () => app?.close());

  it.each([
    ['GET', '/api/v1/record-tasks/opaque-task/context'],
    ['POST', '/api/v1/record-tasks/opaque-task/commands'],
  ] as const)('returns clearing SESSION_INVALID for missing and invalid bearer on %s', async (method, path) => {
    app = await buildApplication(environment, { authPolicy: policy });
    const agent = request(app.getHttpServer());
    for (const authorization of [undefined, 'Bearer invalid-session-token']) {
      let call = method === 'GET' ? agent.get(path) : agent.post(path).send(validCommand());
      call = call.set('x-request-id', `p11-invalid-${authorization ? 'token' : 'missing'}`);
      if (authorization) call = call.set('Authorization', authorization);
      await call.expect(401).expect(({ body }) => expect(body).toMatchObject({
        errorCode: 'SESSION_INVALID', clientStateDisposition: 'CLEAR_ALL',
      }));
    }
  });

  it.each([
    ['GET', '/api/v1/record-tasks/opaque-task/context'],
    ['POST', '/api/v1/record-tasks/opaque-task/commands'],
  ] as const)('stably rejects a trusted non-USER session on %s', async (method, path) => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedAccount(app, 'staff-1', 'STAFF', 'OPERATIONS');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'staff-1', 'STAFF', 'OPERATIONS');
    const call = method === 'GET' ? agent.get(path) : agent.post(path).send(validCommand());
    await call.set('x-request-id', 'p11-staff').set('Authorization', `Bearer ${token}`)
      .expect(403).expect(({ body }) => expect(body).toMatchObject({
        errorCode: 'ROLE_NOT_AUTHORIZED', clientStateDisposition: 'CLEAR_ALL',
      }));
  });

  it.each([
    ['GET', '/api/v1/record-tasks/arbitrary-task/context'],
    ['POST', '/api/v1/record-tasks/arbitrary-task/commands'],
  ] as const)('returns non-enumerating 404 for any task after trusted USER authorization on %s', async (method, path) => {
    app = await buildApplication(environment, { authPolicy: policy });
    await seedAccount(app, 'user-1', 'USER');
    const agent = request(app.getHttpServer());
    const token = await login(agent, 'user-1', 'USER');
    const call = method === 'GET' ? agent.get(path) : agent.post(path).send(validCommand());
    await call.set('x-request-id', 'p11-user-not-found').set('Authorization', `Bearer ${token}`)
      .expect(404).expect(({ body }) => expect(body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED', errorCode: 'RECORD_TASK_NOT_FOUND',
        recoverableActions: [], clientStateDisposition: 'CLEAR_ALL', requestId: 'p11-user-not-found',
      }));
  });
});

function validCommand() {
  return { operation: 'UPSERT_RECORD', recordKindId: 'kind', schemaVersion: 'v1', expectedRecordVersion: null, entries: [] };
}

async function seedAccount(app: INestApplication, id: string, type: 'USER' | 'STAFF', role?: string) {
  const passwordHash = await hashPassword('seed-password-1', policy);
  const db = app.get(DatabaseService).database;
  await db.query(`INSERT INTO iam.account
    (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ($1, $1, $2, $3, 'ACTIVE', false)`, [id, passwordHash, type]);
  if (role) await db.query(`INSERT INTO iam.account_role (account_id, role_code) VALUES ($1, $2)`, [id, role]);
}

async function login(agent: ReturnType<typeof request>, id: string, kind: 'USER' | 'STAFF', actingRole?: string) {
  const response = await agent.post('/api/v1/identity/sessions')
    .set('x-request-id', `login-${id}`).set('idempotency-key', `login-${id}`)
    .send({ loginIdentifier: id, password: 'seed-password-1', sessionKind: kind, ...(actingRole ? { actingRole } : {}) })
    .expect(201);
  return response.body.sessionToken as string;
}
