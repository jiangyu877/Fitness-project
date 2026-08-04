import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { P11RecordContextRepository } from '../src/record-context-repository.js';
import type { P11RecordSchema } from '../src/record-repository.js';
import { withIsolatedPostgresTestDatabase } from './support/postgres-test-harness.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;
const schema = {
  version: 'schema-v1',
  testOnly: true,
  approvedForRealUsers: false,
  recordKinds: [{
    id: 'kind-1',
    fields: [{ id: 'field-1', valueType: 'STRING' as const, required: true }],
    allowedActions: ['UPSERT_RECORD' as const],
  }],
} satisfies P11RecordSchema;

describe.runIf(Boolean(adminUrl))('P11 record context PostgreSQL read adapter', () => {
  it('reads the owned active task context and projects persisted records', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedContextFixture(pool);
      const repository = new P11RecordContextRepository(pool);

      const context = await repository.getContext({
        sessionTokenHash: 'session-token-hash-1',
        taskId: 'task-1',
        requestId: 'context-request-1',
        nodeEnv: 'test',
      }, schema);

      expect(context).toEqual({
        taskId: 'task-1',
        planVersion: 'plan-version-1',
        businessDate: '2026-01-02',
        accessMode: 'EDITABLE',
        records: [{
          recordId: 'record-1',
          recordKindId: 'kind-1',
          recordVersion: 1,
          schemaVersion: 'schema-v1',
          entries: [{ fieldId: 'field-1', value: 'fictional-value' }],
        }],
      });
    });
  });

  it('rejects an ACTIVE plan without a finite current effective window', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedContextFixture(pool);
      await pool.query(`UPDATE planning.plan_version SET effective_to=NULL WHERE id='plan-version-1'`);

      await expect(new P11RecordContextRepository(pool).getContext({
        sessionTokenHash: 'session-token-hash-1',
        taskId: 'task-1',
        requestId: 'context-request-gap',
        nodeEnv: 'test',
      }, schema)).rejects.toMatchObject({ code: 'RECORD_PLAN_NOT_ACTIVE' });
    });
  });

  it('rejects a gate and provider schema version mismatch before projection', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedContextFixture(pool);
      const mismatched = { ...schema, version: 'schema-v2' };

      await expect(new P11RecordContextRepository(pool).getContext({
        sessionTokenHash: 'session-token-hash-1',
        taskId: 'task-1',
        requestId: 'context-request-schema-mismatch',
        nodeEnv: 'test',
      }, mismatched)).rejects.toMatchObject({ code: 'RECORD_SCHEMA_VERSION_CONFLICT' });
    });
  });

  it('fails closed when a persisted record does not match the approved generic schema', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedContextFixture(pool);
      await pool.query(`UPDATE recording.record
        SET entries='[{"fieldId":"unknown-field","valueType":"NUMBER","value":1}]'::jsonb
        WHERE id='record-1'`);

      await expect(new P11RecordContextRepository(pool).getContext({
        sessionTokenHash: 'session-token-hash-1',
        taskId: 'task-1',
        requestId: 'context-request-malformed-record',
        nodeEnv: 'test',
      }, schema)).rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
    });
  });
});

async function seedContextFixture(pool: Pool): Promise<void> {
  await pool.query(`INSERT INTO iam.account
    (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ('user-1', 'user-1', 'hash', 'USER', 'ACTIVE', false)`);
  await pool.query(`INSERT INTO iam.session
    (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at)
    VALUES ('session-1', 'user-1', 'USER', 'session-token-hash-1', 'USER', 'FULL', now() + interval '1 hour')`);
  await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ('plan-1', 'user-1')`);
  await pool.query(`WITH plan_window AS (
      SELECT now() - interval '1 day' AS effective_at,
             now() + interval '1 day' AS effective_to
    )
    INSERT INTO planning.plan_version
    (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
     effective_at, effective_to, professional_rules_approved, demo_only)
    SELECT 'plan-version-1', 'plan-1', 'user-1', 1, 'ACTIVE',
      (date_trunc('day', effective_at AT TIME ZONE 'Asia/Shanghai') - interval '28 hours')
        AT TIME ZONE 'Asia/Shanghai',
      (date_trunc('day', effective_at AT TIME ZONE 'Asia/Shanghai') - interval '4 hours')
        AT TIME ZONE 'Asia/Shanghai', effective_at, effective_to, false, true
      FROM plan_window`);
  await pool.query(`INSERT INTO recording.p11_write_gate_revision
    (gate_id, revision, node_env, test_only, approved_for_real_users,
     route_access_approved, write_enabled, schema_version, hmac_key_id)
    VALUES ('P11_RECORD_WRITE', 1, 'TEST', true, false, true, true, 'schema-v1', 'test-key-v1')`);
  await pool.query(`INSERT INTO recording.p11_write_gate (id, current_revision)
    VALUES ('P11_RECORD_WRITE', 1)`);
  await pool.query(`INSERT INTO recording.record_task
    (id, user_id, plan_id, plan_version_id, business_date, schema_version,
     gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
    VALUES ('task-1', 'user-1', 'plan-1', 'plan-version-1', DATE '2026-01-02', 'schema-v1',
      'P11_RECORD_WRITE', 1, 'TEST_ONLY_EXPLICIT', 'OPEN', 'OPEN', 'CLEAR')`);
  await pool.query(`INSERT INTO recording.record
    (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
    VALUES ('record-1', 'task-1', 'user-1', DATE '2026-01-02', 'kind-1', 'schema-v1', 1,
      '[{"fieldId":"field-1","valueType":"STRING","value":"fictional-value"}]'::jsonb)`);
}
