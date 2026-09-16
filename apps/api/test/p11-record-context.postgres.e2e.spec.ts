import type { INestApplication } from '@nestjs/common';
import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import { applyMigrations, type MigrationConnection, type MigrationDatabase } from '@lianban/database';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import request, { type Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import type { Environment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';
import type { RouteAccessSnapshot } from '../src/readiness/route-access.js';
import type { P11RecordPortSchema } from '../src/records/p11-record-repository.port.js';
import {
  buildApplication,
  cleanupPostgresResources,
  toDatabaseRecordSchema,
} from './build-test-application.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

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

const schema = {
  version: 'schema-v1', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{ id: 'kind-1', fields: [], allowedActions: ['UPSERT_RECORD'] }],
} as const satisfies P11RecordPortSchema;

const writeSchema = {
  version: 'schema-v1', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{
    id: 'kind-1', fields: [{ id: 'field-1', valueType: 'STRING' as const }],
    allowedActions: ['UPSERT_RECORD' as const],
  }],
} satisfies P11RecordPortSchema;

describe('P11 PostgreSQL adapter safety helpers', () => {
  it('continues every cleanup step and aggregates failures', async () => {
    const calls: string[] = [];
    await expect(cleanupPostgresResources({
      closeTarget: async () => { calls.push('target'); throw new Error('TARGET_CLOSE'); },
      terminateTarget: async () => { calls.push('terminate'); throw new Error('TERMINATE'); },
      dropTarget: async () => { calls.push('drop'); throw new Error('DROP'); },
      closeMaintenance: async () => { calls.push('maintenance'); throw new Error('MAINTENANCE_CLOSE'); },
    })).rejects.toMatchObject({
      message: 'POSTGRES_TEST_DATABASE_CLEANUP_FAILED',
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'TARGET_CLOSE' }),
        expect.objectContaining({ message: 'TERMINATE' }),
        expect.objectContaining({ message: 'DROP' }),
        expect.objectContaining({ message: 'MAINTENANCE_CLOSE' }),
      ]),
    });
    expect(calls).toEqual(['target', 'terminate', 'drop', 'maintenance']);
  });

  it('converts only a validated API schema to the database schema shape', () => {
    expect(toDatabaseRecordSchema(schema)).toEqual({
      version: 'schema-v1', testOnly: true, approvedForRealUsers: false,
      recordKinds: [{ id: 'kind-1', fields: [], allowedActions: ['UPSERT_RECORD'] }],
    });
    expect(() => toDatabaseRecordSchema({ ...schema, approvedForRealUsers: true })).toThrow('RECORD_SCHEMA_INVALID');
  });
});

describe.runIf(Boolean(adminUrl))('P11 API context PostgreSQL adapter wiring', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('reads one approved context through the real controller and PostgreSQL adapter', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-postgres-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);

      const options = {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => schema },
        recordContextPool: pool,
      };
      app = await buildApplication(environment, options as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .get('/api/v1/record-tasks/context-task-1/context')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-postgres-request-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_AVAILABLE',
        taskId: 'context-task-1',
        planVersion: 'context-plan-version-1',
        businessDate: '2026-01-02',
        accessMode: 'EDITABLE',
        schema: {
          version: 'schema-v1', testOnly: true,
          recordKinds: [{ id: 'kind-1', fields: [], allowedActions: ['UPSERT_RECORD'] }],
        },
        records: [],
      });
    });
  });

  it('dual fictional fat-loss and muscle-gain fixtures write independently', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const personaFixtures = [
        {
          fixtureId: 'persona_fat_loss', goalType: 'FAT_LOSS', userId: 'persona_fat_loss',
          token: 'dual-persona-fat-loss-token', sessionId: 'dual-session-fat-loss-opaque',
          planId: 'dual-plan-fat-loss-opaque', planVersionId: 'dual-plan-version-fat-loss-opaque',
          taskId: 'dual-task-fat-loss-opaque', requestId: 'dual-request-fat-loss-opaque',
          idempotencyKey: 'dual-idempotency-fat-loss-opaque', entry: 'dual-entry-fat-loss-opaque',
        },
        {
          fixtureId: 'persona_muscle_gain', goalType: 'MUSCLE_GAIN', userId: 'persona_muscle_gain',
          token: 'dual-persona-muscle-gain-token', sessionId: 'dual-session-muscle-gain-opaque',
          planId: 'dual-plan-muscle-gain-opaque', planVersionId: 'dual-plan-version-muscle-gain-opaque',
          taskId: 'dual-task-muscle-gain-opaque', requestId: 'dual-request-muscle-gain-opaque',
          idempotencyKey: 'dual-idempotency-muscle-gain-opaque', entry: 'dual-entry-muscle-gain-opaque',
        },
      ] as const;
      await pool.query(`INSERT INTO recording.p11_write_gate_revision
        (gate_id, revision, node_env, test_only, approved_for_real_users,
         route_access_approved, write_enabled, schema_version, hmac_key_id)
        VALUES ('P11_RECORD_WRITE',1,'TEST',true,false,true,true,'schema-v1','test-key-v1')`);
      await pool.query(`INSERT INTO recording.p11_write_gate (id, current_revision)
        VALUES ('P11_RECORD_WRITE',1)`);
      for (const fixture of personaFixtures) {
        await pool.query(`INSERT INTO iam.account
          (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
          VALUES ($1,$2,'hash','USER','ACTIVE',false)`, [fixture.userId, fixture.fixtureId]);
        await pool.query(`INSERT INTO iam.session
          (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at)
          VALUES ($1,$2,'USER',$3,'USER','FULL',now() + interval '1 hour')`, [
          fixture.sessionId, fixture.userId, createHash('sha256').update(fixture.token).digest('hex'),
        ]);
        await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ($1,$2)`, [fixture.planId, fixture.userId]);
        await pool.query(`INSERT INTO planning.plan_version
          (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
           effective_at, effective_to, professional_rules_approved, demo_only, payload)
          VALUES ($1,$2,$3,1,'ACTIVE',TIMESTAMPTZ '2025-12-29T12:00:00Z',
            (date_trunc('day', TIMESTAMPTZ '2026-01-01T00:00:00Z' AT TIME ZONE 'Asia/Shanghai') - interval '4 hours') AT TIME ZONE 'Asia/Shanghai',
            TIMESTAMPTZ '2026-01-01T00:00:00Z',TIMESTAMPTZ '2099-01-01T00:00:00Z',false,true,$4)`, [
          fixture.planVersionId, fixture.planId, fixture.userId,
          JSON.stringify({ fixtureId: fixture.fixtureId, goalType: fixture.goalType, demoOnly: true }),
        ]);
        await pool.query(`INSERT INTO recording.record_task
          (id, user_id, plan_id, plan_version_id, business_date, schema_version,
           gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
          VALUES ($1,$2,$3,$4,DATE '2026-01-02','schema-v1',
            'P11_RECORD_WRITE',1,'TEST_ONLY_EXPLICIT','OPEN','OPEN','CLEAR')`, [
          fixture.taskId, fixture.userId, fixture.planId, fixture.planVersionId,
        ]);
      }
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      const apiDatabase = app.get(DatabaseService).database;
      const personaPasswordHash = await hashPassword('dual-fixture-password', policy);
      for (const fixture of personaFixtures) {
        await apiDatabase.query(`INSERT INTO iam.account
          (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
          VALUES ($1,$2,$3,'USER','ACTIVE',false)`, [fixture.userId, fixture.fixtureId, personaPasswordHash]);
        await apiDatabase.query(`INSERT INTO iam.session
          (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
          VALUES ($1,$2,'USER',$3,false,now() + interval '15 minutes','USER','FULL')`, [
          fixture.sessionId, fixture.userId, createHash('sha256').update(fixture.token).digest('hex'),
        ]);
      }

      const requests = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/record-tasks/${personaFixtures[0].taskId}/commands`)
          .set('Authorization', `Bearer ${personaFixtures[0].token}`)
          .set('x-request-id', personaFixtures[0].requestId)
          .set('idempotency-key', personaFixtures[0].idempotencyKey)
          .send({
            operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
            expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: personaFixtures[0].entry }],
          }),
        request(app.getHttpServer())
          .post(`/api/v1/record-tasks/${personaFixtures[1].taskId}/commands`)
          .set('Authorization', `Bearer ${personaFixtures[1].token}`)
          .set('x-request-id', personaFixtures[1].requestId)
          .set('idempotency-key', personaFixtures[1].idempotencyKey)
          .send({
            operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
            expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: personaFixtures[1].entry }],
          }),
      ]);

      expect(requests.map((response) => response.status)).toEqual([200, 200]);
      expect(requests.map((response) => response.body)).toEqual([
        {
          businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
          schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
        },
        {
          businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
          schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
        },
      ]);
      const publicBodies = requests.map((response) => JSON.stringify(response.body)).join('\n');
      for (const forbidden of personaFixtures.flatMap((fixture) => [
        fixture.token, fixture.entry, fixture.idempotencyKey, fixture.taskId, fixture.userId,
      ])) {
        expect(publicBodies).not.toContain(forbidden);
      }
      const after = await readReadOnlyState(pool);
      for (const authority of ['accounts', 'sessions', 'writeGate', 'writeGateRevisions', 'tasks', 'plans', 'planVersions']) {
        expect(after[authority]).toEqual(before[authority]);
      }
      expect(after).not.toEqual(before);
      const recordRows = after.records as {
        rows: Array<{ id: string; task_id: string; user_id: string; business_date: string; record_kind_id: string; schema_version: string; record_version: number; entries: unknown }>;
      };
      expect(recordRows.rows).toHaveLength(2);
      expect(recordRows.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          task_id: personaFixtures[0].taskId, user_id: personaFixtures[0].userId, business_date: '2026-01-02', record_kind_id: 'kind-1', schema_version: 'schema-v1',
          record_version: 1, entries: [{ fieldId: 'field-1', valueType: 'STRING', value: personaFixtures[0].entry }],
        }),
        expect.objectContaining({
          task_id: personaFixtures[1].taskId, user_id: personaFixtures[1].userId, business_date: '2026-01-02', record_kind_id: 'kind-1', schema_version: 'schema-v1',
          record_version: 1, entries: [{ fieldId: 'field-1', valueType: 'STRING', value: personaFixtures[1].entry }],
        }),
      ]));
      const idempotencyRows = after.idempotency as {
        rows: Array<{ key_id: string; idempotency_key_digest: string; intent_digest: string; task_id: string; principal_id: string; session_id: string; business_date: string; record_kind_id: string; schema_version: string; operation: string; status: string; record_id: string; replay_result: unknown }>;
      };
      expect(idempotencyRows.rows).toHaveLength(2);
      expect(idempotencyRows.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ key_id: 'test-key-v1', task_id: personaFixtures[0].taskId, principal_id: personaFixtures[0].userId, session_id: personaFixtures[0].sessionId, business_date: '2026-01-02', record_kind_id: 'kind-1', schema_version: 'schema-v1', operation: 'UPSERT_RECORD', status: 'COMPLETED' }),
        expect.objectContaining({ key_id: 'test-key-v1', task_id: personaFixtures[1].taskId, principal_id: personaFixtures[1].userId, session_id: personaFixtures[1].sessionId, business_date: '2026-01-02', record_kind_id: 'kind-1', schema_version: 'schema-v1', operation: 'UPSERT_RECORD', status: 'COMPLETED' }),
      ]));
      for (const fixture of personaFixtures) {
        const row = idempotencyRows.rows.find((candidate) => candidate.task_id === fixture.taskId)!;
        expect(decodePgJsonBytea(row.idempotency_key_digest)).toEqual(digestP11IdempotencyKey(fixture.idempotencyKey));
        expect(decodePgJsonBytea(row.intent_digest)).toEqual(digestP11RecordIntent(fixture.entry));
        expect(row.replay_result).toEqual({ recordId: row.record_id, recordVersion: 1, schemaVersion: 'schema-v1' });
      }
      const auditRows = after.recordAudits as {
        rows: Array<{ id: string; task_id: string; actor_id: string; action: string; subject_type: string; record_id: string; request_id: string; record_version: number; schema_version: string }>;
      };
      expect(auditRows.rows).toHaveLength(2);
      expect(auditRows.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ task_id: personaFixtures[0].taskId, actor_id: personaFixtures[0].userId, action: 'RECORD_UPSERTED', subject_type: 'P11_RECORD', request_id: personaFixtures[0].requestId, record_version: 1, schema_version: 'schema-v1' }),
        expect.objectContaining({ task_id: personaFixtures[1].taskId, actor_id: personaFixtures[1].userId, action: 'RECORD_UPSERTED', subject_type: 'P11_RECORD', request_id: personaFixtures[1].requestId, record_version: 1, schema_version: 'schema-v1' }),
      ]));
      for (const fixture of personaFixtures) {
        const record = recordRows.rows.find((candidate) => candidate.task_id === fixture.taskId)!;
        const audit = auditRows.rows.find((candidate) => candidate.task_id === fixture.taskId)!;
        expect(audit.record_id).toBe(record.id);
      }
    });
  });

  it('returns the owner record as READ_ONLY when the task date is closed without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-closed-date-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`UPDATE recording.record_task SET date_state='CLOSED' WHERE id='context-task-1'`);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-record-1','context-task-1','context-user-1',DATE '2026-01-02','kind-1','schema-v1',1,'[]'::jsonb)`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => schema },
        recordContextPool: pool,
      });
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .get('/api/v1/record-tasks/context-task-1/context')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-closed-date-request-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_AVAILABLE',
        taskId: 'context-task-1',
        planVersion: 'context-plan-version-1',
        businessDate: '2026-01-02',
        accessMode: 'READ_ONLY',
        schema: {
          version: 'schema-v1', testOnly: true,
          recordKinds: [{ id: 'kind-1', fields: [], allowedActions: [] }],
        },
        records: [{
          recordId: 'context-record-1', recordKindId: 'kind-1', recordVersion: 1,
          schemaVersion: 'schema-v1', entries: [],
        }],
      });
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('rejects a legal UPSERT_RECORD for a closed date without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-closed-date-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`UPDATE recording.record_task SET date_state='CLOSED' WHERE id='context-task-1'`);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-record-1','context-task-1','context-user-1',DATE '2026-01-02','kind-1','schema-v1',1,'[]'::jsonb)`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-closed-date-write-request-1')
        .set('idempotency-key', 'context-closed-date-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: 'closed-write-attempt' }],
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_STATE_BLOCKED',
        recoverableActions: [],
        clientStateDisposition: 'DISABLE_EDITOR',
        requestId: 'context-closed-date-write-request-1',
      });
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('rejects a legal UPSERT_RECORD for a closed task without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-closed-task-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`UPDATE recording.record_task SET task_state='CLOSED' WHERE id='context-task-1'`);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-record-1','context-task-1','context-user-1',DATE '2026-01-02','kind-1','schema-v1',1,'[]'::jsonb)`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-closed-task-write-request-1')
        .set('idempotency-key', 'context-closed-task-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: 'closed-task-write-attempt' }],
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_STATE_BLOCKED',
        recoverableActions: [],
        clientStateDisposition: 'DISABLE_EDITOR',
        requestId: 'context-closed-task-write-request-1',
      });
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('rejects a legal UPSERT_RECORD for a blocked-risk task without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-blocked-risk-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`UPDATE recording.record_task SET risk_state='BLOCKED' WHERE id='context-task-1'`);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-record-1','context-task-1','context-user-1',DATE '2026-01-02','kind-1','schema-v1',1,'[]'::jsonb)`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-blocked-risk-write-request-1')
        .set('idempotency-key', 'context-blocked-risk-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: 'blocked-risk-write-attempt' }],
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_STATE_BLOCKED',
        recoverableActions: [],
        clientStateDisposition: 'DISABLE_EDITOR',
        requestId: 'context-blocked-risk-write-request-1',
      });
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('rejects a legal first UPSERT_RECORD for blocked risk without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-blocked-risk-first-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`UPDATE recording.record_task SET risk_state='BLOCKED' WHERE id='context-task-1'`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-blocked-risk-first-write-request-1')
        .set('idempotency-key', 'context-blocked-risk-first-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'blocked-risk-first-write-attempt' }],
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_STATE_BLOCKED',
        recoverableActions: [],
        clientStateDisposition: 'DISABLE_EDITOR',
        requestId: 'context-blocked-risk-first-write-request-1',
      });
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('rejects a legal first UPSERT_RECORD for a closed date without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-closed-date-first-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`UPDATE recording.record_task SET date_state='CLOSED' WHERE id='context-task-1'`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-closed-date-first-write-request-1')
        .set('idempotency-key', 'context-closed-date-first-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'closed-date-first-write-attempt' }],
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_STATE_BLOCKED',
        recoverableActions: [],
        clientStateDisposition: 'DISABLE_EDITOR',
        requestId: 'context-closed-date-first-write-request-1',
      });
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('rejects a legal first UPSERT_RECORD for a closed task without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-closed-task-first-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`UPDATE recording.record_task SET task_state='CLOSED' WHERE id='context-task-1'`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-closed-task-first-write-request-1')
        .set('idempotency-key', 'context-closed-task-first-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'closed-task-first-write-attempt' }],
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_STATE_BLOCKED',
        recoverableActions: [],
        clientStateDisposition: 'DISABLE_EDITOR',
        requestId: 'context-closed-task-first-write-request-1',
      });
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('rejects a legal first UPSERT_RECORD when the associated plan version is not active without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-plan-not-active-first-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      const activeCoverage = await pool.query<{
        businessDate: string;
        status: string;
        startsBeforeDateEnd: boolean;
        endsAfterDateStart: boolean;
      }>(`SELECT task.business_date::text AS "businessDate", version.status,
          version.effective_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
            AS "startsBeforeDateEnd",
          version.effective_to > ($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
            AS "endsAfterDateStart"
        FROM recording.record_task task
        JOIN planning.plan_version version ON version.id=task.plan_version_id
        WHERE task.id='context-task-1'`, ['2026-01-02']);
      expect(activeCoverage.rows).toEqual([{
        businessDate: '2026-01-02', status: 'ACTIVE',
        startsBeforeDateEnd: true, endsAfterDateStart: true,
      }]);
      await pool.query(`UPDATE planning.plan_version
        SET status='SUPERSEDED'
        WHERE id='context-plan-version-1'`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-plan-not-active-first-write-request-1')
        .set('idempotency-key', 'context-plan-not-active-first-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'plan-not-active-write-attempt' }],
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_PLAN_NOT_ACTIVE',
        recoverableActions: [],
        clientStateDisposition: 'CLEAR_ALL',
        requestId: 'context-plan-not-active-first-write-request-1',
      });
      const publicBody = JSON.stringify(response.body);
      for (const forbidden of [
        token, 'context-task-1', 'context-plan-1', 'context-plan-version-1', 'schema-v1',
        'context-plan-not-active-first-write-idempotency-1', 'plan-not-active-write-attempt',
        'SUPERSEDED', 'context-user-1',
      ]) {
        expect(publicBody).not.toContain(forbidden);
      }
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('serializes concurrent existing-record updates through a real PG18 lock', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const firstToken = 'context-concurrent-existing-record-first-token';
      const secondToken = 'context-concurrent-existing-record-second-token';
      const firstTokenHash = createHash('sha256').update(firstToken).digest('hex');
      await seedPostgresContext(pool, firstTokenHash);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-concurrent-record-1','context-task-1','context-user-1',DATE '2026-01-02',
          'kind-1','schema-v1',1,'[{"fieldId":"field-1","value":"baseline-existing-entry"}]'::jsonb)`);
      await pool.query(`INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at)
        VALUES ('context-session-2','context-user-1','USER',$1,'USER','FULL',now() + interval '1 hour')`, [
        createHash('sha256').update(secondToken).digest('hex'),
      ]);
      const before = await readReadOnlyState(pool);
      const lockBarrier = createAccountLockBarrierPool(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: lockBarrier.pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, firstToken);
      await app.get(DatabaseService).database.query(`INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
        VALUES ($1,'context-user-1','USER',$2,false,now() + interval '15 minutes','USER','FULL')`, [
        'context-session-2', createHash('sha256').update(secondToken).digest('hex'),
      ]);
      let firstResponsePromise: Promise<Response> | undefined;
      let secondResponsePromise: Promise<Response> | undefined;
      let firstResponse: Response | undefined;
      let secondResponse: Response | undefined;
      try {
        firstResponsePromise = request(app.getHttpServer())
          .post('/api/v1/record-tasks/context-task-1/commands')
          .set('Authorization', `Bearer ${firstToken}`)
          .set('x-request-id', 'context-concurrent-first-request')
          .set('idempotency-key', 'context-concurrent-first-idempotency')
          .send({
            operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
            expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: 'concurrent-first-entry' }],
          }).timeout({ deadline: 5000 }).then((response) => response);
        await waitForBarrierSignal(
          lockBarrier.firstAccountLocked, 'EXPECTED_FIRST_PG18_ACCOUNT_LOCK_NOT_ACQUIRED',
        );

        secondResponsePromise = request(app.getHttpServer())
          .post('/api/v1/record-tasks/context-task-1/commands')
          .set('Authorization', `Bearer ${secondToken}`)
          .set('x-request-id', 'context-concurrent-second-request')
          .set('idempotency-key', 'context-concurrent-second-idempotency')
          .send({
            operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
            expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: 'concurrent-second-entry' }],
          }).timeout({ deadline: 5000 }).then((response) => response);
        await waitForBarrierSignal(
          lockBarrier.secondAccountAttempted, 'EXPECTED_SECOND_PG18_ACCOUNT_LOCK_NOT_ATTEMPTED',
        );
        await waitForAccountLock(pool);
        expect(lockBarrier.secondAccountAcquired).toBe(false);

        lockBarrier.releaseFirst();
        [firstResponse, secondResponse] = await Promise.all([
          firstResponsePromise, secondResponsePromise,
        ]);
      } finally {
        lockBarrier.releaseFirst();
        await Promise.all([
          consumeRequestWithin(firstResponsePromise, 5000),
          consumeRequestWithin(secondResponsePromise, 5000),
        ]);
      }
      if (!firstResponse || !secondResponse) {
        throw new Error('CONCURRENT_PG18_RESPONSES_DID_NOT_SETTLE');
      }
      const responses = [firstResponse, secondResponse];
      expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(1);

      const accepted = responses.find((response) => response.status === 200)!;
      const conflict = responses.find((response) => response.status === 409)!;
      expect(accepted.body).toEqual({
        businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 2,
        schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
      });
      const acceptedRequestId = accepted === firstResponse
        ? 'context-concurrent-first-request' : 'context-concurrent-second-request';
      const conflictRequestId = conflict === firstResponse
        ? 'context-concurrent-first-request' : 'context-concurrent-second-request';
      expect(conflict.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED', errorCode: 'RECORD_VERSION_CONFLICT',
        recoverableActions: ['REFRESH'],
        clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
        requestId: conflictRequestId,
      });
      const acceptedEntry = acceptedRequestId === 'context-concurrent-first-request'
        ? 'concurrent-first-entry' : 'concurrent-second-entry';
      const rejectedEntry = acceptedEntry === 'concurrent-first-entry'
        ? 'concurrent-second-entry' : 'concurrent-first-entry';
      const acceptedSessionId = acceptedRequestId === 'context-concurrent-first-request'
        ? 'context-session-1' : 'context-session-2';
      const acceptedIdempotencyKey = acceptedRequestId === 'context-concurrent-first-request'
        ? 'context-concurrent-first-idempotency' : 'context-concurrent-second-idempotency';
      const rejectedIdempotencyKey = acceptedIdempotencyKey === 'context-concurrent-first-idempotency'
        ? 'context-concurrent-second-idempotency' : 'context-concurrent-first-idempotency';
      const publicBodies = responses.map((response) => JSON.stringify(response.body)).join('\n');
      for (const forbidden of [firstToken, secondToken, 'context-concurrent-first-idempotency',
        'context-concurrent-second-idempotency', acceptedEntry, rejectedEntry]) {
        expect(publicBodies).not.toContain(forbidden);
      }

      const after = await readReadOnlyState(pool);
      for (const authority of [
        'accounts', 'sessions', 'writeGate', 'writeGateRevisions', 'tasks', 'plans', 'planVersions',
      ]) {
        expect(after[authority]).toEqual(before[authority]);
      }
      const successfulEntries = [{
        fieldId: 'field-1', valueType: 'STRING', value: acceptedEntry,
      }];
      const requestedEntries = [{ fieldId: 'field-1', value: acceptedEntry }];
      const recordRows = after.records as {
        count: number;
        rows: Array<{ id: string; record_version: number; entries: unknown }>;
      };
      expect(recordRows.count).toBe(1);
      expect(recordRows.rows).toHaveLength(1);
      const recordRow = recordRows.rows[0]!;
      expect(recordRow).toMatchObject({ record_version: 2 });
      const persistedEntries = recordRow.entries as Array<{
        fieldId: string; valueType: string; value: unknown;
      }>;
      expect(persistedEntries).toEqual(successfulEntries);
      expect(persistedEntries.map(({ fieldId, value }) => ({ fieldId, value }))).toEqual(requestedEntries);
      expect(JSON.stringify(persistedEntries)).not.toContain(rejectedEntry);
      expect((after.idempotency as { count: number }).count).toBe(
        (before.idempotency as { count: number }).count + 1,
      );
      expect((after.recordAudits as { count: number }).count).toBe(
        (before.recordAudits as { count: number }).count + 1,
      );
      const idempotencyRows = after.idempotency as {
        rows: Array<{
          status: string; record_id: string; session_id: string; idempotency_key_digest: string;
          replay_result: { recordId: string; recordVersion: number; schemaVersion: string };
        }>;
      };
      expect(idempotencyRows.rows).toHaveLength(1);
      const idempotencyRow = idempotencyRows.rows[0]!;
      expect(idempotencyRow).toMatchObject({
        status: 'COMPLETED', record_id: recordRow.id, session_id: acceptedSessionId,
        replay_result: {
          recordId: recordRow.id, recordVersion: 2, schemaVersion: 'schema-v1',
        },
      });
      const persistedKeyDigest = decodePgJsonBytea(idempotencyRow.idempotency_key_digest);
      const acceptedKeyDigest = digestP11IdempotencyKey(acceptedIdempotencyKey);
      const rejectedKeyDigest = digestP11IdempotencyKey(rejectedIdempotencyKey);
      expect(persistedKeyDigest).toEqual(acceptedKeyDigest);
      expect(persistedKeyDigest).not.toEqual(rejectedKeyDigest);
      expect(idempotencyRow.replay_result).toEqual({
        recordId: recordRow.id, recordVersion: 2, schemaVersion: 'schema-v1',
      });
      const auditRows = after.recordAudits as { rows: Array<{ request_id: string; record_version: number }> };
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]).toMatchObject({ request_id: acceptedRequestId, record_version: 2 });
      const persisted = JSON.stringify(after);
      for (const forbidden of [firstToken, secondToken,
        'context-concurrent-first-idempotency', 'context-concurrent-second-idempotency', rejectedEntry]) {
        expect(persisted).not.toContain(forbidden);
      }
    });
  });

  it('serializes concurrent absent-record creates through a real PG18 lock', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const firstToken = 'context-concurrent-absent-record-first-token';
      const secondToken = 'context-concurrent-absent-record-second-token';
      const firstRequestId = 'context-concurrent-absent-first-request';
      const secondRequestId = 'context-concurrent-absent-second-request';
      const firstIdempotencyKey = 'context-concurrent-absent-first-idempotency';
      const secondIdempotencyKey = 'context-concurrent-absent-second-idempotency';
      const firstEntry = 'concurrent-absent-first-entry';
      const secondEntry = 'concurrent-absent-second-entry';
      await seedPostgresContext(pool, createHash('sha256').update(firstToken).digest('hex'));
      await pool.query(`INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at)
        VALUES ('context-session-2','context-user-1','USER',$1,'USER','FULL',now() + interval '1 hour')`, [
        createHash('sha256').update(secondToken).digest('hex'),
      ]);
      const before = await readReadOnlyState(pool);
      expect((before.records as { count: number }).count).toBe(0);
      const lockBarrier = createAccountLockBarrierPool(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: lockBarrier.pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, firstToken);
      await app.get(DatabaseService).database.query(`INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
        VALUES ($1,'context-user-1','USER',$2,false,now() + interval '15 minutes','USER','FULL')`, [
        'context-session-2', createHash('sha256').update(secondToken).digest('hex'),
      ]);

      let firstResponsePromise: Promise<Response> | undefined;
      let secondResponsePromise: Promise<Response> | undefined;
      let firstResponse: Response | undefined;
      let secondResponse: Response | undefined;
      try {
        firstResponsePromise = request(app.getHttpServer())
          .post('/api/v1/record-tasks/context-task-1/commands')
          .set('Authorization', `Bearer ${firstToken}`)
          .set('x-request-id', firstRequestId)
          .set('idempotency-key', firstIdempotencyKey)
          .send({
            operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
            expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: firstEntry }],
          }).timeout({ deadline: 5000 }).then((response) => response);
        await waitForBarrierSignal(
          lockBarrier.firstAccountLocked, 'EXPECTED_FIRST_PG18_ACCOUNT_LOCK_NOT_ACQUIRED',
        );

        secondResponsePromise = request(app.getHttpServer())
          .post('/api/v1/record-tasks/context-task-1/commands')
          .set('Authorization', `Bearer ${secondToken}`)
          .set('x-request-id', secondRequestId)
          .set('idempotency-key', secondIdempotencyKey)
          .send({
            operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
            expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: secondEntry }],
          }).timeout({ deadline: 5000 }).then((response) => response);
        await waitForBarrierSignal(
          lockBarrier.secondAccountAttempted, 'EXPECTED_SECOND_PG18_ACCOUNT_LOCK_NOT_ATTEMPTED',
        );
        await waitForAccountLock(pool);
        expect(lockBarrier.secondAccountAcquired).toBe(false);

        lockBarrier.releaseFirst();
        [firstResponse, secondResponse] = await Promise.all([
          firstResponsePromise, secondResponsePromise,
        ]);
      } finally {
        lockBarrier.releaseFirst();
        await Promise.all([
          consumeRequestWithin(firstResponsePromise, 5000),
          consumeRequestWithin(secondResponsePromise, 5000),
        ]);
      }
      if (!firstResponse || !secondResponse) {
        throw new Error('CONCURRENT_ABSENT_PG18_RESPONSES_DID_NOT_SETTLE');
      }

      const responses = [firstResponse, secondResponse];
      expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
      const accepted = responses.find((response) => response.status === 200)!;
      const conflict = responses.find((response) => response.status === 409)!;
      expect(accepted.body).toEqual({
        businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
        schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
      });
      const acceptedRequestId = accepted === firstResponse ? firstRequestId : secondRequestId;
      const conflictRequestId = conflict === firstResponse ? firstRequestId : secondRequestId;
      expect(conflict.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED', errorCode: 'RECORD_VERSION_CONFLICT',
        recoverableActions: ['REFRESH'],
        clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
        requestId: conflictRequestId,
      });
      const acceptedSessionId = acceptedRequestId === firstRequestId
        ? 'context-session-1' : 'context-session-2';
      const acceptedIdempotencyKey = acceptedRequestId === firstRequestId
        ? firstIdempotencyKey : secondIdempotencyKey;
      const rejectedIdempotencyKey = acceptedIdempotencyKey === firstIdempotencyKey
        ? secondIdempotencyKey : firstIdempotencyKey;
      const acceptedEntry = acceptedRequestId === firstRequestId ? firstEntry : secondEntry;
      const rejectedEntry = acceptedEntry === firstEntry ? secondEntry : firstEntry;
      const publicBodies = responses.map((response) => JSON.stringify(response.body)).join('\n');
      for (const forbidden of [firstToken, secondToken, firstIdempotencyKey, secondIdempotencyKey,
        firstEntry, secondEntry, 'context-task-1', 'context-user-1']) {
        expect(publicBodies).not.toContain(forbidden);
      }

      const after = await readReadOnlyState(pool);
      for (const authority of [
        'accounts', 'sessions', 'writeGate', 'writeGateRevisions', 'tasks', 'plans', 'planVersions',
      ]) {
        expect(after[authority]).toEqual(before[authority]);
      }
      const recordRows = after.records as {
        count: number;
        rows: Array<{ id: string; schema_version: string; record_version: number; entries: unknown }>;
      };
      expect(recordRows.count).toBe(1);
      expect(recordRows.rows).toHaveLength(1);
      const recordRow = recordRows.rows[0]!;
      expect(recordRow).toMatchObject({ schema_version: 'schema-v1', record_version: 1 });
      expect(recordRow.entries).toEqual([{
        fieldId: 'field-1', valueType: 'STRING', value: acceptedEntry,
      }]);
      expect(JSON.stringify(recordRow.entries)).not.toContain(rejectedEntry);

      expect((after.idempotency as { count: number }).count).toBe(
        (before.idempotency as { count: number }).count + 1,
      );
      const idempotencyRows = after.idempotency as {
        rows: Array<{
          status: string; record_id: string; session_id: string; idempotency_key_digest: string;
          replay_result: { recordId: string; recordVersion: number; schemaVersion: string };
        }>;
      };
      expect(idempotencyRows.rows).toHaveLength(1);
      const idempotencyRow = idempotencyRows.rows[0]!;
      expect(idempotencyRow).toMatchObject({
        status: 'COMPLETED', record_id: recordRow.id, session_id: acceptedSessionId,
        replay_result: { recordId: recordRow.id, recordVersion: 1, schemaVersion: 'schema-v1' },
      });
      const persistedKeyDigest = decodePgJsonBytea(idempotencyRow.idempotency_key_digest);
      expect(persistedKeyDigest).toEqual(digestP11IdempotencyKey(acceptedIdempotencyKey));
      expect(persistedKeyDigest).not.toEqual(digestP11IdempotencyKey(rejectedIdempotencyKey));
      expect(idempotencyRow.replay_result).toEqual({
        recordId: recordRow.id, recordVersion: 1, schemaVersion: 'schema-v1',
      });

      expect((after.recordAudits as { count: number }).count).toBe(
        (before.recordAudits as { count: number }).count + 1,
      );
      const auditRows = after.recordAudits as {
        rows: Array<{ request_id: string; record_id: string; record_version: number }>;
      };
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]).toMatchObject({
        request_id: acceptedRequestId, record_id: recordRow.id, record_version: 1,
      });
      expect(auditRows.rows[0]?.request_id).not.toBe(conflictRequestId);

      const persisted = JSON.stringify(after);
      for (const forbidden of [firstToken, secondToken, firstIdempotencyKey,
        secondIdempotencyKey, rejectedEntry]) {
        expect(persisted).not.toContain(forbidden);
      }
    });
  });

  it('rejects an out-of-order old request after a newer version succeeds', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-out-of-order-existing-record-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const newerRequestId = 'context-out-of-order-newer-request';
      const olderRequestId = 'context-out-of-order-older-request';
      const newerIdempotencyKey = 'context-out-of-order-newer-idempotency';
      const olderIdempotencyKey = 'context-out-of-order-older-idempotency';
      const newerEntry = 'out-of-order-newer-entry';
      const olderEntry = 'out-of-order-older-entry';
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-out-of-order-record-1','context-task-1','context-user-1',DATE '2026-01-02',
          'kind-1','schema-v1',1,'[{"fieldId":"field-1","value":"out-of-order-baseline-entry"}]'::jsonb)`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const newerResponse = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', newerRequestId)
        .set('idempotency-key', newerIdempotencyKey)
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: newerEntry }],
        });
      expect(newerResponse.status).toBe(200);
      expect(newerResponse.body).toEqual({
        businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 2,
        schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
      });

      const olderResponse = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', olderRequestId)
        .set('idempotency-key', olderIdempotencyKey)
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: olderEntry }],
        });
      expect(olderResponse.status).toBe(409);
      expect(olderResponse.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED', errorCode: 'RECORD_VERSION_CONFLICT',
        recoverableActions: ['REFRESH'],
        clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
        requestId: olderRequestId,
      });

      const publicBodies = `${JSON.stringify(newerResponse.body)}\n${JSON.stringify(olderResponse.body)}`;
      for (const forbidden of [token, newerIdempotencyKey, olderIdempotencyKey, newerEntry, olderEntry,
        'out-of-order-baseline-entry', 'context-task-1', 'context-user-1']) {
        expect(publicBodies).not.toContain(forbidden);
      }

      const after = await readReadOnlyState(pool);
      for (const authority of [
        'accounts', 'sessions', 'writeGate', 'writeGateRevisions', 'tasks', 'plans', 'planVersions',
      ]) {
        expect(after[authority]).toEqual(before[authority]);
      }

      const recordRows = after.records as {
        count: number;
        rows: Array<{ id: string; schema_version: string; record_version: number; entries: unknown }>;
      };
      expect(recordRows.count).toBe(1);
      expect(recordRows.rows).toHaveLength(1);
      const recordRow = recordRows.rows[0]!;
      expect(recordRow).toMatchObject({
        id: 'context-out-of-order-record-1', schema_version: 'schema-v1', record_version: 2,
      });
      expect(recordRow.entries).toEqual([{
        fieldId: 'field-1', valueType: 'STRING', value: newerEntry,
      }]);
      expect(JSON.stringify(recordRow.entries)).not.toContain(olderEntry);

      expect((after.idempotency as { count: number }).count).toBe(
        (before.idempotency as { count: number }).count + 1,
      );
      const idempotencyRows = after.idempotency as {
        rows: Array<{
          status: string; record_id: string; session_id: string; idempotency_key_digest: string;
          replay_result: { recordId: string; recordVersion: number; schemaVersion: string };
        }>;
      };
      expect(idempotencyRows.rows).toHaveLength(1);
      const idempotencyRow = idempotencyRows.rows[0]!;
      expect(idempotencyRow).toMatchObject({
        status: 'COMPLETED', record_id: recordRow.id, session_id: 'context-session-1',
        replay_result: { recordId: recordRow.id, recordVersion: 2, schemaVersion: 'schema-v1' },
      });
      expect(decodePgJsonBytea(idempotencyRow.idempotency_key_digest))
        .toEqual(digestP11IdempotencyKey(newerIdempotencyKey));
      expect(decodePgJsonBytea(idempotencyRow.idempotency_key_digest))
        .not.toEqual(digestP11IdempotencyKey(olderIdempotencyKey));
      expect(idempotencyRow.replay_result).toEqual({
        recordId: recordRow.id, recordVersion: 2, schemaVersion: 'schema-v1',
      });

      expect((after.recordAudits as { count: number }).count).toBe(
        (before.recordAudits as { count: number }).count + 1,
      );
      const auditRows = after.recordAudits as {
        rows: Array<{ request_id: string; record_id: string; record_version: number }>;
      };
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]).toMatchObject({
        request_id: newerRequestId, record_id: recordRow.id, record_version: 2,
      });
      expect(auditRows.rows[0]?.request_id).not.toBe(olderRequestId);

      const persisted = JSON.stringify(after);
      for (const forbidden of [token, newerIdempotencyKey, olderIdempotencyKey, olderEntry]) {
        expect(persisted).not.toContain(forbidden);
      }
    });
  });

  it('rejects a command pinned to a newer schema version without writing', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-schema-version-conflict-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const requestId = 'context-schema-version-conflict-request';
      const idempotencyKey = 'context-schema-version-conflict-idempotency';
      const entryValue = 'context-schema-version-conflict-entry';
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-schema-version-conflict-record-1','context-task-1','context-user-1',DATE '2026-01-02',
          'kind-1','schema-v1',1,'[{"fieldId":"field-1","value":"schema-version-conflict-baseline-entry"}]'::jsonb)`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', requestId)
        .set('idempotency-key', idempotencyKey)
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v2',
          expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: entryValue }],
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_SCHEMA_VERSION_CONFLICT',
        recoverableActions: ['REFRESH'],
        clientStateDisposition: 'CLEAR_ALL',
        requestId,
      });
      const publicBody = JSON.stringify(response.body);
      for (const forbidden of [token, idempotencyKey, entryValue, 'context-task-1',
        'context-user-1', 'schema-v2', 'schema-version-conflict-baseline-entry']) {
        expect(publicBody).not.toContain(forbidden);
      }

      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
      const recordRows = after.records as {
        count: number;
        rows: Array<{ id: string; schema_version: string; record_version: number; entries: unknown }>;
      };
      expect(recordRows.rows).toHaveLength(1);
      expect(recordRows.rows[0]).toMatchObject({
        id: 'context-schema-version-conflict-record-1', schema_version: 'schema-v1', record_version: 1,
      });
      expect(recordRows.rows[0]?.entries).toEqual([{
        fieldId: 'field-1', value: 'schema-version-conflict-baseline-entry',
      }]);
      expect((after.idempotency as { count: number }).count).toBe(
        (before.idempotency as { count: number }).count,
      );
      expect((after.recordAudits as { count: number }).count).toBe(
        (before.recordAudits as { count: number }).count,
      );
      const persisted = JSON.stringify(after);
      for (const forbidden of [token, idempotencyKey, entryValue, 'schema-v2']) {
        expect(persisted).not.toContain(forbidden);
      }
    });
  });

  it('replays the same complete intent without repeating successful side effects', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-same-intent-replay-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const firstRequestId = 'context-same-intent-replay-first-request';
      const secondRequestId = 'context-same-intent-replay-second-request';
      const idempotencyKey = 'context-same-intent-replay-idempotency';
      const entryValue = 'context-same-intent-replay-entry';
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-same-intent-replay-record-1','context-task-1','context-user-1',DATE '2026-01-02',
          'kind-1','schema-v1',1,'[{"fieldId":"field-1","value":"same-intent-replay-baseline-entry"}]'::jsonb)`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const command = {
        operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
        expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: entryValue }],
      };
      const firstResponse = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', firstRequestId)
        .set('idempotency-key', idempotencyKey)
        .send(command);
      const afterFirst = await readReadOnlyState(pool);
      const secondResponse = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', secondRequestId)
        .set('idempotency-key', idempotencyKey)
        .send(command);
      const afterSecond = await readReadOnlyState(pool);

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body).toEqual(firstResponse.body);
      expect(firstResponse.body).toEqual({
        businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 2,
        schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
      });
      expect(firstResponse.body).not.toHaveProperty('requestId');

      const publicBodies = `${JSON.stringify(firstResponse.body)}\n${JSON.stringify(secondResponse.body)}`;
      for (const forbidden of [token, idempotencyKey, entryValue, firstRequestId, secondRequestId,
        'context-task-1', 'context-user-1']) {
        expect(publicBodies).not.toContain(forbidden);
      }

      expect((afterFirst.records as { count: number }).count).toBe(
        (before.records as { count: number }).count,
      );
      expect((afterFirst.idempotency as { count: number }).count).toBe(
        (before.idempotency as { count: number }).count + 1,
      );
      expect((afterFirst.recordAudits as { count: number }).count).toBe(
        (before.recordAudits as { count: number }).count + 1,
      );
      expect((afterSecond.records as { count: number }).count).toBe(
        (afterFirst.records as { count: number }).count,
      );
      expect((afterSecond.idempotency as { count: number }).count).toBe(
        (afterFirst.idempotency as { count: number }).count,
      );
      expect((afterSecond.recordAudits as { count: number }).count).toBe(
        (afterFirst.recordAudits as { count: number }).count,
      );

      const recordRows = afterSecond.records as {
        count: number;
        rows: Array<{ id: string; schema_version: string; record_version: number; entries: unknown }>;
      };
      expect(recordRows.rows).toHaveLength(1);
      const recordRow = recordRows.rows[0]!;
      expect(recordRow).toMatchObject({
        id: 'context-same-intent-replay-record-1', schema_version: 'schema-v1', record_version: 2,
      });
      expect(recordRow.entries).toEqual([{
        fieldId: 'field-1', valueType: 'STRING', value: entryValue,
      }]);

      const idempotencyRows = afterSecond.idempotency as {
        rows: Array<{
          key_id: string; idempotency_key_digest: string; status: string; record_id: string;
          session_id: string;
          replay_result: { recordId: string; recordVersion: number; schemaVersion: string };
        }>;
      };
      expect(idempotencyRows.rows).toHaveLength(1);
      const idempotencyRow = idempotencyRows.rows[0]!;
      expect(idempotencyRow).toMatchObject({
        key_id: 'test-key-v1', status: 'COMPLETED', record_id: recordRow.id,
        session_id: 'context-session-1',
        replay_result: { recordId: recordRow.id, recordVersion: 2, schemaVersion: 'schema-v1' },
      });
      expect(decodePgJsonBytea(idempotencyRow.idempotency_key_digest))
        .toEqual(digestP11IdempotencyKey(idempotencyKey));
      expect(idempotencyRow.replay_result).toEqual({
        recordId: recordRow.id, recordVersion: 2, schemaVersion: 'schema-v1',
      });

      const auditRows = afterSecond.recordAudits as {
        rows: Array<{ request_id: string; record_id: string; record_version: number }>;
      };
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]).toMatchObject({
        request_id: firstRequestId, record_id: recordRow.id, record_version: 2,
      });
      expect(auditRows.rows[0]?.request_id).not.toBe(secondRequestId);

      const persisted = JSON.stringify(afterSecond);
      expect(persisted).not.toContain(token);
      expect(persisted).not.toContain(idempotencyKey);
    });
  });

  it('rejects the same raw key when the normalized intent changes', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-changed-intent-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const firstRequestId = 'context-changed-intent-first-request';
      const secondRequestId = 'context-changed-intent-second-request';
      const idempotencyKey = 'context-changed-intent-idempotency';
      const firstEntry = 'context-changed-intent-first-entry';
      const changedEntry = 'context-changed-intent-changed-entry';
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('context-changed-intent-record-1','context-task-1','context-user-1',DATE '2026-01-02',
          'kind-1','schema-v1',1,'[{"fieldId":"field-1","value":"changed-intent-baseline-entry"}]'::jsonb)`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const firstResponse = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', firstRequestId)
        .set('idempotency-key', idempotencyKey)
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: firstEntry }],
        });
      const afterFirst = await readReadOnlyState(pool);

      const secondResponse = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-1/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', secondRequestId)
        .set('idempotency-key', idempotencyKey)
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: 1, entries: [{ fieldId: 'field-1', value: changedEntry }],
        });
      const afterSecond = await readReadOnlyState(pool);

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body).toEqual({
        businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 2,
        schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
      });
      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'IDEMPOTENCY_KEY_REUSED',
        recoverableActions: ['USE_NEW_IDEMPOTENCY_KEY'],
        clientStateDisposition: 'CLEAR_ALL',
        requestId: secondRequestId,
      });
      const publicBody = JSON.stringify(secondResponse.body);
      for (const forbidden of [token, idempotencyKey, firstEntry, changedEntry,
        firstRequestId, 'context-task-1', 'context-user-1']) {
        expect(publicBody).not.toContain(forbidden);
      }

      expect((afterFirst.records as { count: number }).count).toBe(
        (before.records as { count: number }).count,
      );
      expect((afterFirst.idempotency as { count: number }).count).toBe(
        (before.idempotency as { count: number }).count + 1,
      );
      expect((afterFirst.recordAudits as { count: number }).count).toBe(
        (before.recordAudits as { count: number }).count + 1,
      );
      expect(afterSecond).toEqual(afterFirst);

      const recordRows = afterSecond.records as {
        rows: Array<{ id: string; schema_version: string; record_version: number; entries: unknown }>;
      };
      expect(recordRows.rows).toHaveLength(1);
      const recordRow = recordRows.rows[0]!;
      expect(recordRow).toMatchObject({
        id: 'context-changed-intent-record-1', schema_version: 'schema-v1', record_version: 2,
      });
      expect(recordRow.entries).toEqual([{
        fieldId: 'field-1', valueType: 'STRING', value: firstEntry,
      }]);
      expect(JSON.stringify(recordRow.entries)).not.toContain(changedEntry);

      const idempotencyRows = afterSecond.idempotency as {
        rows: Array<{
          key_id: string; idempotency_key_digest: string; status: string; record_id: string;
          session_id: string;
          replay_result: { recordId: string; recordVersion: number; schemaVersion: string };
        }>;
      };
      expect(idempotencyRows.rows).toHaveLength(1);
      const idempotencyRow = idempotencyRows.rows[0]!;
      expect(idempotencyRow).toMatchObject({
        key_id: 'test-key-v1', status: 'COMPLETED', record_id: recordRow.id,
        session_id: 'context-session-1',
        replay_result: { recordId: recordRow.id, recordVersion: 2, schemaVersion: 'schema-v1' },
      });
      expect(decodePgJsonBytea(idempotencyRow.idempotency_key_digest))
        .toEqual(digestP11IdempotencyKey(idempotencyKey));
      expect(idempotencyRow.replay_result).toEqual({
        recordId: recordRow.id, recordVersion: 2, schemaVersion: 'schema-v1',
      });

      const auditRows = afterSecond.recordAudits as {
        rows: Array<{ request_id: string; record_id: string; record_version: number }>;
      };
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]).toMatchObject({
        request_id: firstRequestId, record_id: recordRow.id, record_version: 2,
      });
      expect(auditRows.rows[0]?.request_id).not.toBe(secondRequestId);

      const persisted = JSON.stringify(afterSecond);
      for (const forbidden of [token, idempotencyKey, changedEntry]) {
        expect(persisted).not.toContain(forbidden);
      }
    });
  });

  it('does not enumerate a complete other-user task on a legal UPSERT_RECORD', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-user-a-cross-user-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      await pool.query(`INSERT INTO iam.account
        (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
        VALUES ('context-user-2','context-user-2','hash','USER','ACTIVE',false)`);
      await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ('context-plan-2','context-user-2')`);
      await pool.query(`WITH plan_window AS (
          SELECT now() - interval '1 day' AS effective_at, now() + interval '1 day' AS effective_to
        )
        INSERT INTO planning.plan_version
          (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
           effective_at, effective_to, professional_rules_approved, demo_only)
        SELECT 'context-plan-version-2','context-plan-2','context-user-2',1,'ACTIVE',
          (date_trunc('day', effective_at AT TIME ZONE 'Asia/Shanghai') - interval '28 hours') AT TIME ZONE 'Asia/Shanghai',
          (date_trunc('day', effective_at AT TIME ZONE 'Asia/Shanghai') - interval '4 hours') AT TIME ZONE 'Asia/Shanghai',
          effective_at,effective_to,false,true FROM plan_window`);
      await pool.query(`INSERT INTO recording.record_task
        (id, user_id, plan_id, plan_version_id, business_date, schema_version,
         gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
        VALUES ('context-task-2','context-user-2','context-plan-2','context-plan-version-2',DATE '2026-01-02','schema-v1',
          'P11_RECORD_WRITE',1,'TEST_ONLY_EXPLICIT','OPEN','OPEN','CLEAR')`);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/context-task-2/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-cross-user-write-request-1')
        .set('idempotency-key', 'context-cross-user-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'cross-user-write-attempt' }],
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_TASK_NOT_FOUND',
        recoverableActions: [],
        clientStateDisposition: 'CLEAR_ALL',
        requestId: 'context-cross-user-write-request-1',
      });
      const publicBody = JSON.stringify(response.body);
      expect(publicBody).not.toContain('context-user-2');
      expect(publicBody).not.toContain('context-plan-2');
      expect(publicBody).not.toContain('context-plan-version-2');
      expect(publicBody).not.toContain('context-task-2');
      expect(publicBody).not.toContain('schema-v1');
      expect(publicBody).not.toContain('OPEN');
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });

  it('does not enumerate a missing task on a legal UPSERT_RECORD', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      const token = 'context-user-a-missing-task-write-test-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await seedPostgresContext(pool, tokenHash);
      const before = await readReadOnlyState(pool);

      app = await buildApplication(environment, {
        authPolicy: policy,
        routeAccessSnapshot: routeSnapshot('ALLOW'),
        recordSchemaProvider: { getApprovedRecordSchema: async () => writeSchema },
        recordRepositoryPool: pool,
      } as Parameters<typeof buildApplication>[1]);
      await seedApiUser(app, token);

      const response = await request(app.getHttpServer())
        .post('/api/v1/record-tasks/missing-opaque-task/commands')
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', 'context-missing-task-write-request-1')
        .set('idempotency-key', 'context-missing-task-write-idempotency-1')
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'missing-task-write-attempt' }],
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_CONTEXT_BLOCKED',
        errorCode: 'RECORD_TASK_NOT_FOUND',
        recoverableActions: [],
        clientStateDisposition: 'CLEAR_ALL',
        requestId: 'context-missing-task-write-request-1',
      });
      const publicBody = JSON.stringify(response.body);
      for (const forbidden of [
        token, 'missing-opaque-task', 'schema-v1', 'context-missing-task-write-idempotency-1',
        'missing-task-write-attempt', 'context-task-1', 'context-user-1',
      ]) {
        expect(publicBody).not.toContain(forbidden);
      }
      const after = await readReadOnlyState(pool);
      expect(after).toEqual(before);
    });
  });
});

function createAccountLockBarrierPool(pool: Pool): {
  pool: Pool;
  firstAccountLocked: Promise<void>;
  secondAccountAttempted: Promise<void>;
  secondAccountAcquired: boolean;
  releaseFirst: () => void;
} {
  let firstAccountLockedResolve!: () => void;
  let secondAccountAttemptedResolve!: () => void;
  let releaseFirstResolve!: () => void;
  let firstAccountLockSeen = false;
  let secondAccountLockSeen = false;
  let secondAccountAcquired = false;
  const firstAccountLocked = new Promise<void>((resolve) => { firstAccountLockedResolve = resolve; });
  const secondAccountAttempted = new Promise<void>((resolve) => { secondAccountAttemptedResolve = resolve; });
  const releaseFirstPromise = new Promise<void>((resolve) => { releaseFirstResolve = resolve; });
  const barrierPool = new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'connect') {
        return async () => {
          const client = await target.connect();
          const originalQuery = client.query.bind(client);
          const runQuery = (...args: any[]) => (originalQuery as (...queryArgs: any[]) => Promise<unknown>)(...args);
          const barrierClient = new Proxy(client, {
            get(clientTarget, clientProperty, clientReceiver) {
              if (clientProperty === 'query') {
                return async (...args: any[]) => {
      const sql = typeof args[0] === 'string' ? args[0] : '';
      const isAccountLock = /FROM\s+iam\.account\s+WHERE\s+id=\$1\s+FOR\s+UPDATE/i.test(sql);
                  if (!isAccountLock) return runQuery(...args);
      if (!firstAccountLockSeen) {
        firstAccountLockSeen = true;
        const result = await runQuery(...args);
        firstAccountLockedResolve();
        await releaseFirstPromise;
        return result;
      }
      if (!secondAccountLockSeen) {
        secondAccountLockSeen = true;
        secondAccountAttemptedResolve();
        const result = await runQuery(...args);
        secondAccountAcquired = true;
        return result;
      }
      return runQuery(...args);
                };
              }
              if (clientProperty === 'release') return clientTarget.release.bind(clientTarget);
              return Reflect.get(clientTarget, clientProperty, clientReceiver);
            },
          });
          return barrierClient;
        };
      }
      if (property === 'query') return target.query.bind(target);
      return Reflect.get(target, property, receiver);
    },
  });
  return {
    pool: barrierPool,
    firstAccountLocked,
    secondAccountAttempted,
    get secondAccountAcquired() { return secondAccountAcquired; },
    releaseFirst: releaseFirstResolve,
  };
}

async function waitForAccountLock(pool: Pool): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waitEventType: string | null; query: string }>(
      `SELECT wait_event_type AS "waitEventType", query
       FROM pg_stat_activity
       WHERE datname=current_database()
         AND wait_event_type='Lock'
         AND query ILIKE '%FROM iam.account%'`,
    );
    if (result.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('EXPECTED_PG18_ACCOUNT_LOCK_WAIT_NOT_OBSERVED');
}

async function waitForBarrierSignal(signal: Promise<void>, failureCode: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(failureCode)), 3000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function consumeRequestWithin(
  pending: Promise<Response> | undefined,
  timeoutMs: number,
): Promise<void> {
  if (!pending) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const consumed = pending.then(() => undefined, () => undefined);
  try {
    await Promise.race([
      consumed,
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function digestP11IdempotencyKey(rawKey: string): Buffer {
  return createHmac('sha256', Buffer.from('fictional-p11-active-key-material'))
    .update('lianban:p11:idempotency-key:v1')
    .update('\0')
    .update(rawKey)
    .digest();
}

function digestP11RecordIntent(entryValue: string): Buffer {
  const canonicalIntent = JSON.stringify({
    domain: 'lianban:p11:record-intent:v1', operation: 'UPSERT_RECORD',
    recordKindId: 'kind-1', schemaVersion: 'schema-v1', expectedRecordVersion: null,
    entries: [{ fieldId: 'field-1', valueType: 'STRING', value: entryValue }],
  });
  return createHmac('sha256', Buffer.from('fictional-p11-active-key-material'))
    .update('lianban:p11:record-intent:v1')
    .update('\0')
    .update(canonicalIntent)
    .digest();
}

function decodePgJsonBytea(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^\\x[0-9a-f]{64}$/i.test(value)) {
    throw new Error('EXPECTED_PG18_BYTEA_JSON_HEX');
  }
  return Buffer.from(value.slice(2), 'hex');
}

async function readReadOnlyState(pool: Pool): Promise<Record<string, unknown>> {
  const [accounts, sessions, writeGate, writeGateRevisions, tasks, plans, planVersions,
    records, idempotency, recordAudits] = await Promise.all([
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM iam.account) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM iam.session) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM recording.p11_write_gate) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.gate_id, row_data.revision), '[]'::jsonb) AS rows
      FROM (SELECT * FROM recording.p11_write_gate_revision) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM recording.record_task) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM planning.plan) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM planning.plan_version) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM recording.record) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.key_id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM recording.record_idempotency) row_data`),
    pool.query(`SELECT count(*)::integer AS count,
        COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) AS rows
      FROM (SELECT * FROM recording.record_success_audit) row_data`),
  ]);
  return {
    accounts: accounts.rows[0],
    sessions: sessions.rows[0],
    writeGate: writeGate.rows[0],
    writeGateRevisions: writeGateRevisions.rows[0],
    tasks: tasks.rows[0],
    plans: plans.rows[0],
    planVersions: planVersions.rows[0],
    records: records.rows[0],
    idempotency: idempotency.rows[0],
    recordAudits: recordAudits.rows[0],
  };
}

function routeSnapshot(route: 'ALLOW' | 'BLOCK'): RouteAccessSnapshot {
  return Object.freeze({
    audience: 'TEST', blockers: Object.freeze(route === 'BLOCK' ? ['TEST_FIXTURE_ROUTE_BLOCKED'] : []),
    allowProtectedRoutes: route === 'ALLOW',
  });
}

async function seedApiUser(app: INestApplication, token: string): Promise<void> {
  const accountId = 'context-user-1';
  const passwordHash = await hashPassword('seed-password-1', policy);
  const database = app.get(DatabaseService).database;
  await database.query(`INSERT INTO iam.account
    (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ($1,$1,$2,'USER','ACTIVE',false)`, [accountId, passwordHash]);
  await database.query(`INSERT INTO iam.session
    (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
    VALUES ($1,$2,'USER',$3,false,now() + interval '15 minutes','USER','FULL')`, [
    'context-session-1', accountId, createHash('sha256').update(token).digest('hex'),
  ]);
}

async function seedPostgresContext(pool: Pool, tokenHash: string): Promise<void> {
  await pool.query(`INSERT INTO iam.account
    (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ('context-user-1','context-user-1','hash','USER','ACTIVE',false)`);
  await pool.query(`INSERT INTO iam.session
    (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at)
    VALUES ('context-session-1','context-user-1','USER',$1,'USER','FULL',now() + interval '1 hour')`, [tokenHash]);
  await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ('context-plan-1','context-user-1')`);
  await pool.query(`WITH plan_window AS (
      SELECT TIMESTAMPTZ '2026-01-01T00:00:00Z' AS effective_at,
        TIMESTAMPTZ '2099-01-01T00:00:00Z' AS effective_to
    )
    INSERT INTO planning.plan_version
      (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
       effective_at, effective_to, professional_rules_approved, demo_only)
    SELECT 'context-plan-version-1','context-plan-1','context-user-1',1,'ACTIVE',
      (date_trunc('day', effective_at AT TIME ZONE 'Asia/Shanghai') - interval '28 hours') AT TIME ZONE 'Asia/Shanghai',
      (date_trunc('day', effective_at AT TIME ZONE 'Asia/Shanghai') - interval '4 hours') AT TIME ZONE 'Asia/Shanghai',
      effective_at,effective_to,false,true FROM plan_window`);
  await pool.query(`INSERT INTO recording.p11_write_gate_revision
    (gate_id, revision, node_env, test_only, approved_for_real_users,
     route_access_approved, write_enabled, schema_version, hmac_key_id)
    VALUES ('P11_RECORD_WRITE',1,'TEST',true,false,true,true,'schema-v1','test-key-v1')`);
  await pool.query(`INSERT INTO recording.p11_write_gate (id, current_revision)
    VALUES ('P11_RECORD_WRITE',1)`);
  await pool.query(`INSERT INTO recording.record_task
    (id, user_id, plan_id, plan_version_id, business_date, schema_version,
     gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
    VALUES ('context-task-1','context-user-1','context-plan-1','context-plan-version-1',DATE '2026-01-02','schema-v1',
      'P11_RECORD_WRITE',1,'TEST_ONLY_EXPLICIT','OPEN','OPEN','CLEAR')`);
}

async function withIsolatedPostgres<Result>(rawAdminUrl: string, run: (pool: Pool) => Promise<Result>): Promise<Result> {
  const admin = assertSafeAdminUrl(rawAdminUrl);
  const databaseName = `lianban_p11_test_${randomUUID().replaceAll('-', '')}`;
  const maintenance = new Pool({ connectionString: admin.toString() });
  let pool: Pool | undefined;
  let created = false;
  let operationError: unknown;
  try {
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const target = new URL(admin);
    target.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: target.toString() });
    await applyMigrations(new PgMigrationDatabase(pool));
    return await run(pool);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await cleanupPostgresResources({
        closeTarget: async () => pool?.end(),
        terminateTarget: async () => {
          if (!created) return;
          await maintenance.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
            [databaseName],
          );
        },
        dropTarget: async () => {
          if (created) await maintenance.query(`DROP DATABASE "${databaseName}"`);
        },
        closeMaintenance: async () => maintenance.end(),
      });
    } catch (cleanupError) {
      if (operationError !== undefined) {
        throw new AggregateError([operationError, ...aggregateErrors(cleanupError)],
          'POSTGRES_TEST_DATABASE_OPERATION_AND_CLEANUP_FAILED');
      }
      throw cleanupError;
    }
  }
}

function aggregateErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? [...error.errors] : [error];
}

function assertSafeAdminUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !new Set(['localhost', '127.0.0.1', '::1']).has(hostname)
    || url.pathname !== '/postgres') {
    throw new Error('UNSAFE_TEST_POSTGRES_ADMIN_URL');
  }
  return url;
}

class PgMigrationDatabase implements MigrationDatabase {
  constructor(private readonly pool: Pool) {}
  async exec(sql: string) { await this.pool.query(sql); }
  async query<Row>(sql: string, params: unknown[] = []) {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as Row[] };
  }
  async transaction<Result>(run: (connection: MigrationConnection) => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(new PgMigrationConnection(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

class PgMigrationConnection implements MigrationConnection {
  constructor(private readonly client: PoolClient) {}
  async exec(sql: string) { await this.client.query(sql); }
  async query<Row>(sql: string, params: unknown[] = []) {
    const result = await this.client.query(sql, params);
    return { rows: result.rows as Row[] };
  }
}
