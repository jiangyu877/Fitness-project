import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  assertSafePostgresAdminUrl,
  isSafePostgresTestDatabaseName,
  withIsolatedPostgresTestDatabase,
} from './support/postgres-test-harness.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

describe('P11 PostgreSQL test harness safety', () => {
  it('rejects unsafe administrator URLs without echoing them', () => {
    for (const value of [
      'https://postgres:secret@127.0.0.1:5432/postgres',
      'postgresql://postgres:secret@example.com:5432/postgres',
      'postgresql://postgres:secret@127.0.0.1:5432/consumer_analysis',
      'postgresql://postgres:secret@127.0.0.1:5432/consumer_spend',
    ]) {
      expect(() => assertSafePostgresAdminUrl(value)).toThrow('UNSAFE_TEST_POSTGRES_ADMIN_URL');
      try {
        assertSafePostgresAdminUrl(value);
      } catch (error) {
        expect(String(error)).not.toContain('secret');
      }
    }
  });

  it.each([
    'consumer_analysis',
    'consumer_spend',
    'lianban_p11_test_',
    'lianban_p11_test_not-hex',
  ])('rejects an unsafe target database name: %s', (value) => {
    expect(isSafePostgresTestDatabaseName(value)).toBe(false);
  });

  it('accepts only the generated test database shape', () => {
    expect(isSafePostgresTestDatabaseName(`lianban_p11_test_${'a'.repeat(32)}`)).toBe(true);
  });
});

describe.runIf(Boolean(adminUrl)).sequential('P11 isolated PostgreSQL lifecycle', () => {
  it('upgrades a real PostgreSQL 18 database from 010 to registered 011', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool, migrateThrough }) => {
      const server = await pool.query<{ major: number }>(
        `SELECT current_setting('server_version_num')::int / 10000 AS major`,
      );
      expect(server.rows).toEqual([{ major: 18 }]);
      expect((await pool.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name='recording'`,
      )).rows).toHaveLength(0);

      await migrateThrough('011_p11_record_persistence');

      expect((await pool.query(
        `SELECT version FROM public.schema_migration WHERE version='011_p11_record_persistence'`,
      )).rows).toEqual([{ version: '011_p11_record_persistence' }]);
    }, { initialTargetVersion: '010_p07_safe_structure' });
  });

  it('installs the exact P11 tables and cross-scope constraints', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      const tables = await pool.query<{ tableName: string }>(`
        SELECT table_name AS "tableName" FROM information_schema.tables
        WHERE table_schema='recording' ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.tableName)).toEqual([
        'p11_write_gate', 'p11_write_gate_revision', 'record',
        'record_idempotency', 'record_success_audit', 'record_task',
      ]);
      const constraints = await pool.query<{ name: string }>(`
        SELECT conname AS name FROM pg_constraint
        WHERE connamespace='recording'::regnamespace ORDER BY conname
      `);
      expect(constraints.rows.map((row) => row.name)).toEqual(expect.arrayContaining([
        'fk_record_idempotency_session',
        'fk_record_idempotency_task_scope',
        'fk_record_success_audit_record_scope',
        'ck_record_idempotency_replay_object',
      ]));
      const forbiddenColumns = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='recording' AND column_name IN
          ('idempotency_key', 'canonical_intent', 'raw_entries', 'session_token_hash', 'hmac_secret')
      `);
      expect(forbiddenColumns.rows).toHaveLength(0);
    });
  });

  it('rejects non-test gates, invalid closure policy, and non-positive record versions', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await expect(pool.query(`INSERT INTO recording.p11_write_gate_revision
        (gate_id, revision, node_env, test_only, approved_for_real_users,
         route_access_approved, write_enabled, schema_version, hmac_key_id)
        VALUES ('P11_RECORD_WRITE', 1, 'PRODUCTION', false, true, true, true, 'schema-v1', 'key-v1')`))
        .rejects.toThrow();
      await seedP11DdlFixture(pool);
      await expect(pool.query(`UPDATE recording.record_task
        SET close_policy='NATURAL_DAY' WHERE id='task-1'`)).rejects.toThrow();
      await expect(pool.query(`INSERT INTO recording.record
        (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
        VALUES ('record-invalid', 'task-1', 'user-1', DATE '2026-01-01', 'kind-1', 'schema-v1', 0, '[]')`))
        .rejects.toThrow();
    });
  });

  it('rejects an idempotency row only when its session belongs to another principal', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedP11DdlFixture(pool);
      await expect(pool.query(`INSERT INTO recording.record_idempotency
        (key_id, idempotency_key_digest, intent_digest, principal_id, session_id,
         task_id, business_date, record_kind_id, schema_version, operation, status)
        VALUES ('key-v1', decode(repeat('01', 32), 'hex'), decode(repeat('02', 32), 'hex'),
          'user-1', 'session-2', 'task-1', DATE '2026-01-01', 'kind-1', 'schema-v1',
          'UPSERT_RECORD', 'CLAIMED')`)).rejects.toThrow();
    });
  });

  it('rejects an idempotency row only when its task scope belongs to another principal', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedP11DdlFixture(pool);
      await expect(pool.query(`INSERT INTO recording.record_idempotency
        (key_id, idempotency_key_digest, intent_digest, principal_id, session_id,
         task_id, business_date, record_kind_id, schema_version, operation, status)
        VALUES ('key-v1', decode(repeat('03', 32), 'hex'), decode(repeat('04', 32), 'hex'),
          'user-2', 'session-2', 'task-1', DATE '2026-01-01', 'kind-1', 'schema-v1',
          'UPSERT_RECORD', 'CLAIMED')`)).rejects.toThrow();
    });
  });

  it('rejects completed idempotency only when its record is outside the valid task scope', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedP11DdlFixture(pool);
      await insertRecord(pool, 'record-1', 'task-1', 'user-1', 'kind-1');
      await insertRecord(pool, 'record-2', 'task-2', 'user-2', 'kind-2');
      await expect(pool.query(`INSERT INTO recording.record_idempotency
        (key_id, idempotency_key_digest, intent_digest, principal_id, session_id,
         task_id, business_date, record_kind_id, schema_version, operation, status,
         record_id, replay_result, completed_at)
        VALUES ('key-v1', decode(repeat('05', 32), 'hex'), decode(repeat('06', 32), 'hex'),
          'user-1', 'session-1', 'task-1', DATE '2026-01-01', 'kind-1', 'schema-v1',
          'UPSERT_RECORD', 'COMPLETED', 'record-2', '{"recordVersion":1}', now())`))
        .rejects.toThrow();
    });
  });

  it('rejects a success audit only when its immutable record scope is mismatched', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedP11DdlFixture(pool);
      await insertRecord(pool, 'record-1', 'task-1', 'user-1', 'kind-1');

      await expect(pool.query(`INSERT INTO recording.record_success_audit
        (id, actor_id, actor_role, action, subject_type, record_id, task_id,
         request_id, record_version, schema_version)
        VALUES ('audit-invalid', 'user-2', 'USER', 'RECORD_UPSERTED', 'P11_RECORD',
          'record-1', 'task-1', 'request-1', 1, 'schema-v1')`)).rejects.toThrow();
    });
  });

  it('accepts only object replay results and rejects scalar and array values', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedP11DdlFixture(pool);
      await insertRecord(pool, 'record-1', 'task-1', 'user-1', 'kind-1');
      for (const [suffix, replayResult] of [['scalar', `'1'::jsonb`], ['array', `'[]'::jsonb`]] as const) {
        await expect(insertCompletedIdempotency(pool, suffix, replayResult)).rejects.toThrow();
      }
      await expect(insertCompletedIdempotency(pool, 'object', `'{}'::jsonb`)).resolves.toBeDefined();
    });
  });

  it('keeps audit version snapshots after the mutable record advances', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedP11DdlFixture(pool);
      await insertRecord(pool, 'record-1', 'task-1', 'user-1', 'kind-1');
      await insertSuccessAudit(pool, 'audit-v1', 1);

      await pool.query(`UPDATE recording.record SET record_version=2 WHERE id='record-1'`);
      await insertSuccessAudit(pool, 'audit-v2', 2);

      expect((await pool.query(`SELECT record_version AS "recordVersion"
        FROM recording.record WHERE id='record-1'`)).rows).toEqual([{ recordVersion: 2 }]);
      expect((await pool.query(`SELECT record_version AS "recordVersion"
        FROM recording.record_success_audit ORDER BY record_version`)).rows)
        .toEqual([{ recordVersion: 1 }, { recordVersion: 2 }]);
    });
  });

  it('preserves the original success audit when an update is attempted', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedP11DdlFixture(pool);
      await insertRecord(pool, 'record-1', 'task-1', 'user-1', 'kind-1');
      await insertSuccessAudit(pool, 'audit-v1', 1);

      await expect(pool.query(`UPDATE recording.record_success_audit
        SET request_id='mutated-request' WHERE id='audit-v1'`)).rejects.toThrow();

      expect((await pool.query(`SELECT request_id AS "requestId"
        FROM recording.record_success_audit WHERE id='audit-v1'`)).rows)
        .toEqual([{ requestId: 'audit-v1' }]);
    });
  });

  it('preserves the success audit count when a delete is attempted', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedP11DdlFixture(pool);
      await insertRecord(pool, 'record-1', 'task-1', 'user-1', 'kind-1');
      await insertSuccessAudit(pool, 'audit-v1', 1);

      await expect(pool.query(`DELETE FROM recording.record_success_audit WHERE id='audit-v1'`))
        .rejects.toThrow();

      expect((await pool.query(`SELECT count(*)::integer AS count
        FROM recording.record_success_audit`)).rows).toEqual([{ count: 1 }]);
    });
  });

  it('rolls back partial 011 DDL and migration registration when 011 fails mid-transaction', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool, migrateThrough }) => {
      await pool.query(`CREATE SCHEMA recording`);
      await pool.query(`CREATE TABLE recording.record_success_audit (sentinel text PRIMARY KEY)`);

      await expect(migrateThrough('011_p11_record_persistence')).rejects.toThrow();

      expect((await pool.query(`SELECT 1 FROM public.schema_migration
        WHERE version='011_p11_record_persistence'`)).rows).toHaveLength(0);
      expect((await pool.query(`SELECT table_name AS "tableName"
        FROM information_schema.tables WHERE table_schema='recording' ORDER BY table_name`)).rows)
        .toEqual([{ tableName: 'record_success_audit' }]);
    }, { initialTargetVersion: '010_p07_safe_structure' });
  });

  it('applies all released migrations inside a generated database', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ databaseName, pool }) => {
      expect(isSafePostgresTestDatabaseName(databaseName)).toBe(true);
      const current = await pool.query<{ databaseName: string }>(
        'SELECT current_database() AS "databaseName"',
      );
      expect(current.rows).toEqual([{ databaseName }]);
      const versions = await pool.query<{ version: string }>(
        'SELECT version FROM public.schema_migration ORDER BY version',
      );
      expect(versions.rows.map((row) => row.version)).toEqual([
        '001_core',
        '002_plan_lifecycle_guards',
        '003_plan_repository',
        '004_plan_repository_integrity',
        '005_identity_onboarding',
        '006_identity_security_hardening',
        '007_identity_audit_outcomes',
        '008_identity_recovery_sessions',
        '009_plan_lifecycle_persistence',
        '010_p07_safe_structure',
        '011_p11_record_persistence',
      ]);
    });
  });

  it('drops the generated database even when the callback fails', async () => {
    let generatedName = '';
    await expect(withIsolatedPostgresTestDatabase(adminUrl!, async ({ databaseName }) => {
      generatedName = databaseName;
      throw new Error('EXPECTED_CALLBACK_FAILURE');
    })).rejects.toThrow('EXPECTED_CALLBACK_FAILURE');

    const maintenance = new Pool({ connectionString: adminUrl! });
    try {
      const result = await maintenance.query(
        'SELECT 1 FROM pg_database WHERE datname=$1',
        [generatedName],
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      await maintenance.end();
    }
  });

  it('leaves no generated P11 test database after successful and failed callbacks', async () => {
    const maintenance = new Pool({ connectionString: adminUrl! });
    try {
      const result = await maintenance.query<{ databaseName: string }>(`
        SELECT datname AS "databaseName" FROM pg_database
        WHERE datname ~ '^lianban_p11_test_[0-9a-f]{32}$'
      `);
      expect(result.rows).toEqual([]);
    } finally {
      await maintenance.end();
    }
  });
});

async function seedP11DdlFixture(pool: Pool): Promise<void> {
  await pool.query(`INSERT INTO iam.account
    (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ('user-1', 'user-1', 'hash', 'USER', 'ACTIVE', false),
           ('user-2', 'user-2', 'hash', 'USER', 'ACTIVE', false)`);
  await pool.query(`INSERT INTO iam.session
    (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at)
    VALUES ('session-1', 'user-1', 'USER', 'token-hash-1', 'USER', 'FULL', now() + interval '1 hour'),
           ('session-2', 'user-2', 'USER', 'token-hash-2', 'USER', 'FULL', now() + interval '1 hour')`);
  await pool.query(`INSERT INTO planning.plan (id, user_id)
    VALUES ('plan-1', 'user-1'), ('plan-2', 'user-2')`);
  await pool.query(`INSERT INTO planning.plan_version
    (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
     effective_at, effective_to, professional_rules_approved, demo_only)
    VALUES
      ('plan-version-1', 'plan-1', 'user-1', 1, 'ACTIVE',
       '2025-12-31T12:00:00Z', '2026-01-01T12:00:00Z',
       '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', false, true),
      ('plan-version-2', 'plan-2', 'user-2', 1, 'ACTIVE',
       '2025-12-31T12:00:00Z', '2026-01-01T12:00:00Z',
       '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', false, true)`);
  await pool.query(`INSERT INTO recording.p11_write_gate_revision
    (gate_id, revision, node_env, test_only, approved_for_real_users,
     route_access_approved, write_enabled, schema_version, hmac_key_id)
    VALUES ('P11_RECORD_WRITE', 1, 'TEST', true, false, true, true, 'schema-v1', 'key-v1')`);
  await pool.query(`INSERT INTO recording.p11_write_gate (id, current_revision)
    VALUES ('P11_RECORD_WRITE', 1)`);
  await pool.query(`INSERT INTO recording.record_task
    (id, user_id, plan_id, plan_version_id, business_date, schema_version,
     gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
    VALUES
      ('task-1', 'user-1', 'plan-1', 'plan-version-1', DATE '2026-01-01', 'schema-v1',
       'P11_RECORD_WRITE', 1, 'TEST_ONLY_EXPLICIT', 'OPEN', 'OPEN', 'CLEAR'),
      ('task-2', 'user-2', 'plan-2', 'plan-version-2', DATE '2026-01-01', 'schema-v1',
       'P11_RECORD_WRITE', 1, 'TEST_ONLY_EXPLICIT', 'OPEN', 'OPEN', 'CLEAR')`);
}

async function insertRecord(pool: Pool, id: string, taskId: string, userId: string, kindId: string) {
  return pool.query(`INSERT INTO recording.record
    (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
    VALUES ($1, $2, $3, DATE '2026-01-01', $4, 'schema-v1', 1, '[]')`,
  [id, taskId, userId, kindId]);
}

async function insertCompletedIdempotency(pool: Pool, suffix: string, replayResult: string) {
  return pool.query(`INSERT INTO recording.record_idempotency
    (key_id, idempotency_key_digest, intent_digest, principal_id, session_id,
     task_id, business_date, record_kind_id, schema_version, operation, status,
     record_id, replay_result, completed_at)
    VALUES ('key-v1', decode(repeat(substr(md5($1), 1, 2), 32), 'hex'),
      decode(repeat(substr(md5($2), 1, 2), 32), 'hex'),
      'user-1', 'session-1', 'task-1', DATE '2026-01-01', 'kind-1', 'schema-v1',
      'UPSERT_RECORD', 'COMPLETED', 'record-1', ${replayResult}, now())`,
  [`key-${suffix}`, `intent-${suffix}`]);
}

async function insertSuccessAudit(pool: Pool, id: string, recordVersion: number) {
  return pool.query(`INSERT INTO recording.record_success_audit
    (id, actor_id, actor_role, action, subject_type, record_id, task_id,
     request_id, record_version, schema_version)
    VALUES ($1, 'user-1', 'USER', 'RECORD_UPSERTED', 'P11_RECORD',
      'record-1', 'task-1', $1, $2, 'schema-v1')`, [id, recordVersion]);
}
