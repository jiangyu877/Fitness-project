import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import {
  P11RecordRepository,
  type P11Entry,
  type P11RecordResult,
  type P11RecordSchema,
  type P11UpsertInput,
} from '../src/record-repository.js';
import { withIsolatedPostgresTestDatabase } from './support/postgres-test-harness.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;
const activeKey = Buffer.from('fictional-p11-active-key-material');

const schema = {
  version: 'schema-v1',
  testOnly: true,
  approvedForRealUsers: false,
  recordKinds: [{
    id: 'kind-1',
    fields: [{ id: 'field-1', valueType: 'STRING' as const }],
    allowedActions: ['UPSERT_RECORD' as const],
  }],
} satisfies P11RecordSchema;

describe.runIf(Boolean(adminUrl))('P11 record repository PostgreSQL behavior', () => {
  it('creates one test-only record with completed replay and success audit atomically', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);

      const result = await repository.upsert(command());

      expect(result.recordVersion).toBe(1);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('snapshots the task ID before the first lock wait (mutation sensitivity)', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const blocker = await pool.connect();
      let pending: Promise<P11RecordResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT id FROM iam.account WHERE id='user-1' FOR UPDATE`);
        const blockerPid = await backendPid(blocker);
        const input = command();
        pending = makeRepository(pool).upsert(input);

        await waitForBlockedRepository(pool, blockerPid);
        input.taskId = 'task-2';
        await blocker.query('COMMIT');
      } finally {
        await rollbackAndRelease(blocker);
      }

      await expect(pending).resolves.toMatchObject({ recordVersion: 1 });
      const persisted = await pool.query<{ taskId: string }>(
        `SELECT task_id AS "taskId" FROM recording.record`,
      );
      expect(persisted.rows).toEqual([{ taskId: 'task-1' }]);
    });
  });

  it('snapshots fingerprint audit version schema entries and result before awaiting (mutation sensitivity)', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const blocker = await pool.connect();
      let pending: Promise<P11RecordResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT id FROM iam.account WHERE id='user-1' FOR UPDATE`);
        const blockerPid = await backendPid(blocker);
        const input = command();
        pending = makeRepository(pool).upsert(input);

        await waitForBlockedRepository(pool, blockerPid);
        input.idempotencyKey = 'mutated-key';
        input.requestId = 'mutated-request';
        input.command.expectedRecordVersion = 99;
        input.command.entries[0]!.value = 'mutated-value';
        input.schema.version = 'mutated-schema';
        input.schema.recordKinds[0]!.fields[0]!.id = 'mutated-field';
        await blocker.query('COMMIT');
      } finally {
        await rollbackAndRelease(blocker);
      }
      const result = await pending!;

      expect(result).toMatchObject({ recordVersion: 1, schemaVersion: 'schema-v1' });
      const persisted = await pool.query<{
        entries: P11Entry[]; schemaVersion: string; requestId: string; digest: Buffer;
      }>(`SELECT record.entries, record.schema_version AS "schemaVersion",
          audit.request_id AS "requestId", idem.idempotency_key_digest AS digest
        FROM recording.record record
        JOIN recording.record_success_audit audit ON audit.record_id=record.id
        JOIN recording.record_idempotency idem ON idem.record_id=record.id`);
      expect(persisted.rows[0]).toMatchObject({
        entries: [{ fieldId: 'field-1', valueType: 'STRING', value: 'fictional-value' }],
        schemaVersion: 'schema-v1',
        requestId: 'request-1',
      });
      expect(persisted.rows[0]!.digest).toEqual(createHmac('sha256', activeKey)
        .update('lianban:p11:idempotency-key:v1').update('\0').update('idempotency-1').digest());
    });
  });

  it('returns the exact completed replay without another successful side effect', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      const first = await repository.upsert(command());

      const replay = await repository.upsert(command({ requestId: 'request-replay' }));

      expect(replay).toEqual(first);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('fails closed when a stored replay result contains an unknown property', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());
      await pool.query(`UPDATE recording.record_idempotency
        SET replay_result=replay_result || '{"unknown":true}'::jsonb`);

      await expect(repository.upsert(command({ requestId: 'malformed-replay' })))
        .rejects.toMatchObject({ code: 'RECORD_REQUEST_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('rejects the same idempotency key when the typed intent changes', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());
      const changed = command();
      changed.command.entries[0]!.value = 'changed-fictional-value';

      await expect(repository.upsert(changed)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('maps the same raw key with a changed schema version to idempotency reuse', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());
      const changed = command({ requestId: 'changed-schema-request' });
      changed.schema.version = 'schema-v2';
      changed.command.schemaVersion = 'schema-v2';

      await expect(repository.upsert(changed))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it.each([
    ['record kind', (changed: P11UpsertInput) => {
      changed.schema.recordKinds.push({
        id: 'kind-2',
        fields: [{ id: 'field-1', valueType: 'STRING' }],
        allowedActions: ['UPSERT_RECORD'],
      });
      changed.command.recordKindId = 'kind-2';
    }],
    ['expected record version', (changed: P11UpsertInput) => {
      changed.command.expectedRecordVersion = 1;
    }],
    ['field ID', (changed: P11UpsertInput) => {
      changed.schema.recordKinds[0]!.fields[0]!.id = 'field-2';
      changed.command.entries[0]!.fieldId = 'field-2';
    }],
    ['scalar value type', (changed: P11UpsertInput) => {
      changed.schema.recordKinds[0]!.fields[0]!.valueType = 'BOOLEAN';
      changed.command.entries[0] = { fieldId: 'field-1', valueType: 'BOOLEAN', value: true };
    }],
    ['scalar value', (changed: P11UpsertInput) => {
      changed.command.entries[0]!.value = 'changed-scalar-value';
    }],
  ] as const)('maps the same raw key with changed %s to idempotency reuse', async (_label, mutate) => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());
      const changed = command({ requestId: `changed-${_label}` });
      mutate(changed);

      await expect(repository.upsert(changed))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('maps the same principals raw key on another owned task to idempotency reuse', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`INSERT INTO recording.record_task
        (id, user_id, plan_id, plan_version_id, business_date, schema_version,
         gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
        VALUES ('task-1b','user-1','plan-1','plan-version-1',DATE '2026-01-02','schema-v1',
          'P11_RECORD_WRITE',1,'TEST_ONLY_EXPLICIT','OPEN','OPEN','CLEAR')`);
      const repository = makeRepository(pool);
      await repository.upsert(command());

      await expect(repository.upsert(command({ taskId: 'task-1b', requestId: 'other-owned-task' })))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('does not reveal same-key state when another principal targets the original task', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());

      await expect(repository.upsert(command({
        sessionTokenHash: 'session-token-hash-2', requestId: 'other-principal-same-task',
      }))).rejects.toMatchObject({ code: 'RECORD_TASK_NOT_FOUND' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('fails closed when the test-only schema contains an unknown property', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      const invalidSchema = { ...schema, unknown: true };

      await expect(repository.upsert(command({ schema: invalidSchema } as never)))
        .rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects an unknown command property before database side effects', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const invalid = command();
      Object.assign(invalid.command, { unknown: true });

      await expect(makeRepository(pool).upsert(invalid))
        .rejects.toMatchObject({ code: 'RECORD_REQUEST_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects null entries without leaking a TypeError', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const invalid = command();
      invalid.command.entries = null as never;

      await expect(makeRepository(pool).upsert(invalid))
        .rejects.toMatchObject({ code: 'RECORD_REQUEST_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('accepts the provider-compatible optional required boolean', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const compatibleSchema = structuredClone(schema) as P11RecordSchema;
      compatibleSchema.recordKinds[0]!.fields[0]!.required = true;

      await expect(makeRepository(pool).upsert(command({ schema: compatibleSchema })))
        .resolves.toMatchObject({ recordVersion: 1 });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('rejects a zero-field kind with zero entries', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const emptySchema = structuredClone(schema) as P11RecordSchema;
      emptySchema.recordKinds[0]!.fields = [];
      const invalid = command({ schema: emptySchema });
      invalid.command.entries = [];

      await expect(makeRepository(pool).upsert(invalid))
        .rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects duplicate field IDs in a non-selected schema kind', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const invalidSchema = structuredClone(schema) as P11RecordSchema;
      invalidSchema.recordKinds.push({
        id: 'kind-2',
        fields: [
          { id: 'duplicate-field', valueType: 'STRING' },
          { id: 'duplicate-field', valueType: 'STRING' },
        ],
        allowedActions: ['UPSERT_RECORD'],
      });

      await expect(makeRepository(pool).upsert(command({ schema: invalidSchema })))
        .rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects a sparse recordKinds array', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const invalidSchema = structuredClone(schema) as P11RecordSchema;
      invalidSchema.recordKinds.length = 2;

      await expect(makeRepository(pool).upsert(command({ schema: invalidSchema })))
        .rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects a sparse fields array in a non-selected schema kind', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const invalidSchema = structuredClone(schema) as P11RecordSchema;
      const fields = [{ id: 'kind-2-field', valueType: 'STRING' as const }];
      fields.length = 2;
      invalidSchema.recordKinds.push({
        id: 'kind-2', fields, allowedActions: ['UPSERT_RECORD'],
      });

      await expect(makeRepository(pool).upsert(command({ schema: invalidSchema })))
        .rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it.each([
    ['duplicate kind ID', (invalid: P11UpsertInput) => {
      invalid.schema.recordKinds.push(structuredClone(invalid.schema.recordKinds[0]!));
    }],
    ['duplicate field ID', (invalid: P11UpsertInput) => {
      invalid.schema.recordKinds[0]!.fields.push(structuredClone(invalid.schema.recordKinds[0]!.fields[0]!));
    }],
    ['duplicate entry', (invalid: P11UpsertInput) => {
      invalid.command.entries.push(structuredClone(invalid.command.entries[0]!));
    }],
    ['an extra action', (invalid: P11UpsertInput) => {
      invalid.schema.recordKinds[0]!.allowedActions.push('DELETE_RECORD' as never);
    }],
    ['an unknown entry property', (invalid: P11UpsertInput) => {
      Object.assign(invalid.command.entries[0]!, { unknown: true });
    }],
    ['a whitespace field ID', (invalid: P11UpsertInput) => {
      invalid.command.entries[0]!.fieldId = ' field-1 ';
    }],
    ['a non-finite number', (invalid: P11UpsertInput) => {
      invalid.schema.recordKinds[0]!.fields[0]!.valueType = 'NUMBER';
      invalid.command.entries[0] = { fieldId: 'field-1', valueType: 'NUMBER', value: Number.POSITIVE_INFINITY };
    }],
    ['an unpaired Unicode surrogate', (invalid: P11UpsertInput) => {
      invalid.command.entries[0]!.value = '\ud800';
    }],
  ] as const)('rejects %s in the strict canonical input', async (_label, mutate) => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const invalid = command({ schema: structuredClone(schema) });
      mutate(invalid);

      await expect(makeRepository(pool).upsert(invalid))
        .rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects U+0000 in a string entry value before JSONB persistence', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const invalid = command();
      invalid.command.entries[0]!.value = 'fictional\0value';

      await expect(makeRepository(pool).upsert(invalid))
        .rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects U+0000 in a schema field identifier before canonicalization', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const invalid = command();
      invalid.schema.recordKinds[0]!.fields[0]!.id = 'field\0one';

      await expect(makeRepository(pool).upsert(invalid))
        .rejects.toMatchObject({ code: 'RECORD_SCHEMA_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('does not distinguish a missing task from another users task', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      for (const taskId of ['missing-task', 'task-2']) {
        await expect(repository.upsert(command({ taskId, idempotencyKey: `key-${taskId}` })))
          .rejects.toMatchObject({ code: 'RECORD_TASK_NOT_FOUND' });
      }
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects a stale version without a successful side effect', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());
      const update = command({ idempotencyKey: 'idempotency-2', requestId: 'request-2' });
      update.command.expectedRecordVersion = 1;
      update.command.entries[0]!.value = 'version-2';
      await repository.upsert(update);
      const stale = command({ idempotencyKey: 'idempotency-3', requestId: 'request-3' });
      stale.command.expectedRecordVersion = 1;

      await expect(repository.upsert(stale)).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 2, audits: 2 });
    });
  });

  it('serializes concurrent absent-record creates to one winner', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const first = makeRepository(pool).upsert(command());
      const second = makeRepository(pool).upsert(command({
        idempotencyKey: 'idempotency-2', requestId: 'request-2',
      }));

      const settled = await Promise.allSettled([first!, second!]);
      expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((item) => item.status === 'rejected')
        .map((item) => (item as PromiseRejectedResult).reason.code))
        .toEqual(['RECORD_VERSION_CONFLICT']);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('maps a globally reused raw key across principals to a stable conflict', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const blocker = await pool.connect();
      let first: Promise<P11RecordResult> | undefined;
      let second: Promise<P11RecordResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT id FROM recording.p11_write_gate
          WHERE id='P11_RECORD_WRITE' FOR UPDATE`);
        first = makeRepository(pool).upsert(command({ idempotencyKey: 'global-key' }));
        second = makeRepository(pool).upsert(command({
          sessionTokenHash: 'session-token-hash-2', taskId: 'task-2',
          idempotencyKey: 'global-key', requestId: 'request-task-2',
        }));

        await waitForRepositoryLockWaits(pool, 2);
        await blocker.query('COMMIT');
      } finally {
        await rollbackAndRelease(blocker);
      }
      const settled = await Promise.allSettled([first, second]);

      expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((item) => item.status === 'rejected')
        .map((item) => (item as PromiseRejectedResult).reason))
        .toMatchObject([{ code: 'IDEMPOTENCY_KEY_REUSED' }]);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('holds the record task lock while creating an absent record', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`CREATE FUNCTION recording.delay_success_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END; $$`);
      await pool.query(`CREATE TRIGGER tr_test_delay_success_audit BEFORE INSERT
        ON recording.record_success_audit FOR EACH ROW EXECUTE FUNCTION recording.delay_success_audit()`);
      const pending = makeRepository(pool).upsert(command());
      await waitForRepositoryQuery(pool, 'INSERT INTO recording.record_success_audit', 'Timeout');
      const contender = await pool.connect();
      await contender.query('BEGIN');
      await contender.query(`SET LOCAL lock_timeout='50ms'`);
      try {
        await expect(contender.query(`UPDATE recording.record_task SET updated_at=now() WHERE id='task-1'`))
          .rejects.toThrow();
      } finally {
        await contender.query('ROLLBACK');
        contender.release();
      }
      await expect(pending).resolves.toMatchObject({ recordVersion: 1 });
    });
  });

  it('serializes concurrent existing-record updates to one winner', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());
      const first = command({ idempotencyKey: 'update-1', requestId: 'update-request-1' });
      first.command.expectedRecordVersion = 1;
      first.command.entries[0]!.value = 'winner-a';
      const second = command({ idempotencyKey: 'update-2', requestId: 'update-request-2' });
      second.command.expectedRecordVersion = 1;
      second.command.entries[0]!.value = 'winner-b';

      const settled = await Promise.allSettled([
        makeRepository(pool).upsert(first), makeRepository(pool).upsert(second),
      ]);
      expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((item) => item.status === 'rejected')
        .map((item) => (item as PromiseRejectedResult).reason.code))
        .toEqual(['RECORD_VERSION_CONFLICT']);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 2, audits: 2 });
    });
  });

  it('holds the existing record lock before claiming idempotency', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await makeRepository(pool).upsert(command());
      await pool.query(`CREATE FUNCTION recording.delay_idempotency_claim() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END; $$`);
      await pool.query(`CREATE TRIGGER tr_test_delay_idempotency BEFORE INSERT
        ON recording.record_idempotency FOR EACH ROW EXECUTE FUNCTION recording.delay_idempotency_claim()`);
      const update = command({ idempotencyKey: 'update-lock', requestId: 'update-lock-request' });
      update.command.expectedRecordVersion = 1;
      const pending = makeRepository(pool).upsert(update);
      await waitForRepositoryQuery(pool, 'INSERT INTO recording.record_idempotency', 'Timeout');
      const contender = await pool.connect();
      await contender.query('BEGIN');
      await contender.query(`SET LOCAL lock_timeout='50ms'`);
      try {
        await expect(contender.query(`UPDATE recording.record SET updated_at=now() WHERE id IN
          (SELECT id FROM recording.record WHERE task_id='task-1')`)).rejects.toThrow();
      } finally {
        await contender.query('ROLLBACK');
        contender.release();
      }
      await expect(pending).resolves.toMatchObject({ recordVersion: 2 });
    });
  });

  it('revalidates a session revocation committed while waiting for its row lock', async () => {
    await assertFreshRaceRejected(
      async (blocker) => blocker.query(`UPDATE iam.session SET revoked_at=now() WHERE id='session-1'`),
      'SESSION_INVALID',
    );
  });

  it('revalidates the session account subject while waiting for its row lock', async () => {
    await assertFreshRaceRejected(
      async (blocker) => blocker.query(`UPDATE iam.session SET account_id='user-2' WHERE id='session-1'`),
      'SESSION_INVALID',
    );
  });

  it('revalidates account status while waiting for the account row lock', async () => {
    await assertFreshRaceRejected(
      async (blocker) => blocker.query(`UPDATE iam.account SET status='DISABLED' WHERE id='user-1'`),
      'SESSION_INVALID',
    );
  });

  it('revalidates session expiry while waiting for the session row lock', async () => {
    await assertFreshRaceRejected(
      async (blocker) => blocker.query(
        `UPDATE iam.session SET expires_at=now() - interval '1 second' WHERE id='session-1'`,
      ),
      'SESSION_INVALID',
    );
  });

  it('rejects a fresh write when the locked session expires while waiting for the gate', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`UPDATE iam.session
        SET expires_at=clock_timestamp() + interval '500 milliseconds' WHERE id='session-1'`);
      const blocker = await pool.connect();
      let pending: Promise<P11RecordResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT id FROM recording.p11_write_gate
          WHERE id='P11_RECORD_WRITE' FOR UPDATE`);
        const blockerPid = await backendPid(blocker);
        pending = makeRepository(pool).upsert(command());
        void pending.catch(() => undefined);
        await waitForBlockedRepository(pool, blockerPid);
        await waitForSessionExpiry(pool, 'session-1');
        await blocker.query('COMMIT');
      } finally {
        await rollbackAndRelease(blocker);
      }

      await expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects an exact replay when the locked session expires while waiting for the gate', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());
      await pool.query(`UPDATE iam.session
        SET expires_at=clock_timestamp() + interval '500 milliseconds' WHERE id='session-1'`);
      const blocker = await pool.connect();
      let pending: Promise<P11RecordResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT id FROM recording.p11_write_gate
          WHERE id='P11_RECORD_WRITE' FOR UPDATE`);
        const blockerPid = await backendPid(blocker);
        pending = repository.upsert(command({ requestId: 'expired-session-replay' }));
        void pending.catch(() => undefined);
        await waitForBlockedRepository(pool, blockerPid);
        await waitForSessionExpiry(pool, 'session-1');
        await blocker.query('COMMIT');
      } finally {
        await rollbackAndRelease(blocker);
      }

      await expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALID' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('revalidates the task owner while waiting for the task row lock', async () => {
    await assertFreshRaceRejected(async (blocker) => blocker.query(`UPDATE recording.record_task
      SET user_id='user-2', plan_id='plan-2', plan_version_id='plan-version-2'
      WHERE id='task-1'`), 'RECORD_TASK_NOT_FOUND');
  });

  it('revalidates a same-owner task plan binding at the bound plan-version lock', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`DROP INDEX planning.uq_plan_version_active_per_user`);
      await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ('plan-1b','user-1')`);
      await pool.query(`INSERT INTO planning.plan_version
        (id, plan_id, user_id, version_number, status, published_at,
         confirmation_deadline_at, effective_at, effective_to,
         professional_rules_approved, demo_only)
        VALUES ('plan-version-1b','plan-1b','user-1',1,'ACTIVE',
          '2025-12-31T08:00:00Z','2026-01-01T12:00:00Z',
          '2026-01-02T00:00:00Z','2026-01-03T00:00:00Z',false,true)`);
      await pool.query(`UPDATE recording.record_task
        SET plan_id='plan-1b', plan_version_id='plan-version-1b' WHERE id='task-1'`);
      const blocker = await pool.connect();
      let pending: Promise<P11RecordResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`UPDATE planning.plan_version
          SET status='SUPERSEDED' WHERE id='plan-version-1b'`);
        const blockerPid = await backendPid(blocker);
        pending = makeRepository(pool).upsert(command());
        void pending.catch(() => undefined);
        await waitForBlockedRepository(pool, blockerPid);
        await blocker.query('COMMIT');
      } finally {
        await rollbackAndRelease(blocker);
      }

      await expect(pending).rejects.toMatchObject({ code: 'RECORD_PLAN_NOT_ACTIVE' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rejects task closure with zero successful side effects', async () => {
    await assertStateRejected(`UPDATE recording.record_task SET task_state='CLOSED' WHERE id='task-1'`);
  });

  it('rejects business-date closure with zero successful side effects', async () => {
    await assertStateRejected(`UPDATE recording.record_task SET date_state='CLOSED' WHERE id='task-1'`);
  });

  it('rejects risk block with zero successful side effects', async () => {
    await assertStateRejected(`UPDATE recording.record_task SET risk_state='BLOCKED' WHERE id='task-1'`);
  });

  it('rejects a schema binding conflict with zero successful side effects', async () => {
    await assertFreshRaceRejected(
      async (blocker) => blocker.query(
        `UPDATE recording.record_task SET schema_version='schema-v2' WHERE id='task-1'`,
      ),
      'RECORD_SCHEMA_VERSION_CONFLICT',
    );
  });

  it('rejects a gate revision disabled before its lock is acquired', async () => {
    await assertFreshRaceRejected(async (blocker) => {
      await blocker.query(`INSERT INTO recording.p11_write_gate_revision
        (gate_id, revision, node_env, test_only, approved_for_real_users,
         route_access_approved, write_enabled, schema_version, hmac_key_id)
        VALUES ('P11_RECORD_WRITE',2,'TEST',true,false,false,false,'schema-v1','test-key-v1')`);
      await blocker.query(`UPDATE recording.p11_write_gate SET current_revision=2`);
    }, 'ROUTE_ACCESS_NOT_APPROVED');
  });

  it('rejects an adjacent disabled bigint gate revision without precision folding', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`INSERT INTO recording.p11_write_gate_revision
        (gate_id, revision, node_env, test_only, approved_for_real_users,
         route_access_approved, write_enabled, schema_version, hmac_key_id)
        VALUES
          ('P11_RECORD_WRITE',9007199254740992,'TEST',true,false,true,true,'schema-v1','test-key-v1'),
          ('P11_RECORD_WRITE',9007199254740993,'TEST',true,false,false,false,'schema-v1','test-key-v1')`);
      await pool.query(`UPDATE recording.record_task
        SET gate_revision=9007199254740992 WHERE id='task-1'`);
      await pool.query(`UPDATE recording.p11_write_gate
        SET current_revision=9007199254740993 WHERE id='P11_RECORD_WRITE'`);

      await expect(makeRepository(pool).upsert(command()))
        .rejects.toMatchObject({ code: 'ROUTE_ACCESS_NOT_APPROVED' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('allows an equal approved bigint gate revision without precision folding', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`INSERT INTO recording.p11_write_gate_revision
        (gate_id, revision, node_env, test_only, approved_for_real_users,
         route_access_approved, write_enabled, schema_version, hmac_key_id)
        VALUES ('P11_RECORD_WRITE',9007199254740993,'TEST',true,false,true,true,
          'schema-v1','test-key-v1')`);
      await pool.query(`UPDATE recording.record_task
        SET gate_revision=9007199254740993 WHERE id='task-1'`);
      await pool.query(`UPDATE recording.p11_write_gate
        SET current_revision=9007199254740993 WHERE id='P11_RECORD_WRITE'`);

      await expect(makeRepository(pool).upsert(command()))
        .resolves.toMatchObject({ recordVersion: 1 });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('rejects when the task-bound plan is no longer ACTIVE', async () => {
    await assertFreshRaceRejected(
      async (blocker) => blocker.query(
        `UPDATE planning.plan_version SET status='SUPERSEDED' WHERE id='plan-version-1'`,
      ),
      'RECORD_PLAN_NOT_ACTIVE',
    );
  });

  it('rejects an ACTIVE plan version expired for the task business date', async () => {
    await assertPlanWindowRejected('2025-12-30T00:00:00Z', '2026-01-01T00:00:00Z');
  });

  it('rejects an ACTIVE plan version with a task business-date gap', async () => {
    await assertPlanWindowRejected('2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z');
  });

  it('rejects a China-business-date future gap under a UTC database session', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await pool.query(`SET TIME ZONE 'UTC'`);
      await seedRepositoryFixture(pool, {
        effectiveAt: '2026-01-02T16:30:00Z',
        effectiveTo: '2026-01-03T16:00:00Z',
      });

      await expect(makeRepository(pool).upsert(command()))
        .rejects.toMatchObject({ code: 'RECORD_PLAN_NOT_ACTIVE' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it.each(['UTC', 'Asia/Shanghai'])(
    'allows the same China-business-date boundary under %s',
    async (timeZone) => {
      await assertPlanWindowForTimeZone(timeZone, {
        effectiveAt: '2026-01-01T16:00:00Z',
        effectiveTo: '2026-01-02T16:00:00Z',
      }, true);
    },
  );

  it.each(['UTC', 'Asia/Shanghai'])(
    'rejects the same China-business-date expired boundary under %s',
    async (timeZone) => {
      await assertPlanWindowForTimeZone(timeZone, {
        effectiveAt: '2025-12-31T16:00:00Z',
        effectiveTo: '2026-01-01T16:00:00Z',
      }, false);
    },
  );

  it.each(['UTC', 'Asia/Shanghai'])(
    'rejects the same China-business-date future gap under %s',
    async (timeZone) => {
      await assertPlanWindowForTimeZone(timeZone, {
        effectiveAt: '2026-01-02T16:30:00Z',
        effectiveTo: '2026-01-03T16:00:00Z',
      }, false);
    },
  );

  it('fails closed when the locked gate revision names a different HMAC key', async () => {
    await assertFreshRaceRejected(async (blocker) => {
      await blocker.query(`INSERT INTO recording.p11_write_gate_revision
        (gate_id, revision, node_env, test_only, approved_for_real_users,
         route_access_approved, write_enabled, schema_version, hmac_key_id)
        VALUES ('P11_RECORD_WRITE',2,'TEST',true,false,true,true,'schema-v1','unexpected-key')`);
      await blocker.query(`UPDATE recording.p11_write_gate SET current_revision=2`);
    }, 'HMAC_KEY_UNAVAILABLE');
  });

  it.each([
    ['session', async (blocker: import('pg').PoolClient) => {
      await blocker.query(`UPDATE iam.session SET revoked_at=now() WHERE id='session-1'`);
    }, 'SESSION_INVALID'],
    ['task', async (blocker: import('pg').PoolClient) => {
      await blocker.query(`UPDATE recording.record_task SET task_state='CLOSED' WHERE id='task-1'`);
    }, 'RECORD_STATE_BLOCKED'],
    ['business date', async (blocker: import('pg').PoolClient) => {
      await blocker.query(`UPDATE recording.record_task SET date_state='CLOSED' WHERE id='task-1'`);
    }, 'RECORD_STATE_BLOCKED'],
    ['risk', async (blocker: import('pg').PoolClient) => {
      await blocker.query(`UPDATE recording.record_task SET risk_state='BLOCKED' WHERE id='task-1'`);
    }, 'RECORD_STATE_BLOCKED'],
    ['gate', async (blocker: import('pg').PoolClient) => {
      await blocker.query(`INSERT INTO recording.p11_write_gate_revision
        (gate_id, revision, node_env, test_only, approved_for_real_users,
         route_access_approved, write_enabled, schema_version, hmac_key_id)
        VALUES ('P11_RECORD_WRITE',2,'TEST',true,false,false,false,'schema-v1','test-key-v1')`);
      await blocker.query(`UPDATE recording.p11_write_gate SET current_revision=2`);
    }, 'ROUTE_ACCESS_NOT_APPROVED'],
    ['ACTIVE plan', async (blocker: import('pg').PoolClient) => {
      await blocker.query(`UPDATE planning.plan_version SET status='SUPERSEDED' WHERE id='plan-version-1'`);
    }, 'RECORD_PLAN_NOT_ACTIVE'],
  ] as const)('revalidates %s before returning an exact replay', async (_label, mutate, expectedCode) => {
    await assertReplayRaceRejected(mutate, expectedCode);
  });

  it('revalidates a changed same-owner plan binding before returning an exact replay', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      await repository.upsert(command());
      await pool.query(`DROP INDEX planning.uq_plan_version_active_per_user`);
      await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ('plan-1b','user-1')`);
      await pool.query(`INSERT INTO planning.plan_version
        (id, plan_id, user_id, version_number, status, published_at,
         confirmation_deadline_at, effective_at, effective_to,
         professional_rules_approved, demo_only)
        VALUES ('plan-version-1b','plan-1b','user-1',1,'ACTIVE',
          '2025-12-31T08:00:00Z','2026-01-01T12:00:00Z',
          '2026-01-02T00:00:00Z','2026-01-03T00:00:00Z',false,true)`);
      await pool.query(`UPDATE recording.record_task
        SET plan_id='plan-1b', plan_version_id='plan-version-1b' WHERE id='task-1'`);
      const blocker = await pool.connect();
      let pending: Promise<P11RecordResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`UPDATE planning.plan_version
          SET status='SUPERSEDED' WHERE id='plan-version-1b'`);
        const blockerPid = await backendPid(blocker);
        pending = repository.upsert(command({ requestId: 'replay-plan-binding-race' }));
        void pending.catch(() => undefined);
        await waitForBlockedRepository(pool, blockerPid);
        await blocker.query('COMMIT');
      } finally {
        await rollbackAndRelease(blocker);
      }

      await expect(pending).rejects.toMatchObject({ code: 'RECORD_PLAN_NOT_ACTIVE' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('revalidates the gate HMAC key before returning an exact replay', async () => {
    await assertReplayRaceRejected(async (blocker) => {
      await blocker.query(`INSERT INTO recording.p11_write_gate_revision
        (gate_id, revision, node_env, test_only, approved_for_real_users,
         route_access_approved, write_enabled, schema_version, hmac_key_id)
        VALUES ('P11_RECORD_WRITE',2,'TEST',true,false,true,true,'schema-v1','unexpected-key')`);
      await blocker.query(`UPDATE recording.p11_write_gate SET current_revision=2`);
    }, 'HMAC_KEY_UNAVAILABLE');
  });

  it('revalidates a shortened ACTIVE effective_to before returning an exact replay', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool, {
        effectiveAt: '2026-01-01T00:00:00Z',
        effectiveTo: '2026-01-03T00:00:00Z',
      });
      const repository = makeRepository(pool);
      await repository.upsert(command());
      const blocker = await pool.connect();
      let pending: Promise<P11RecordResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`UPDATE planning.plan_version
          SET effective_to='2026-01-01T12:00:00Z'
          WHERE id='plan-version-1'`);
        const blockerPid = await backendPid(blocker);
        pending = repository.upsert(command({ requestId: 'replay-effective-to-race' }));
        void pending.catch(() => undefined);
        await waitForBlockedRepository(pool, blockerPid);
        await blocker.query('COMMIT');
      } finally {
        await rollbackAndRelease(blocker);
      }

      await expect(pending).rejects.toMatchObject({ code: 'RECORD_PLAN_NOT_ACTIVE' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('prevents changing the task schema scope referenced by an exact replay', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool);
      const first = await repository.upsert(command());

      await expect(pool.query(`UPDATE recording.record_task
        SET schema_version='schema-v2' WHERE id='task-1'`)).rejects.toMatchObject({ code: '23503' });
      await expect(repository.upsert(command({ requestId: 'schema-immutable-replay' }))).resolves.toEqual(first);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('preserves published effective_at through the immutable plan-version trigger', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await makeRepository(pool).upsert(command());
      const before = await pool.query<{ effectiveAt: string }>(
        `SELECT effective_at::text AS "effectiveAt"
         FROM planning.plan_version WHERE id='plan-version-1'`,
      );

      await expect(pool.query(`UPDATE planning.plan_version
        SET effective_at=effective_at + interval '1 hour'
        WHERE id='plan-version-1'`)).rejects.toThrow('published plan version is immutable');

      const after = await pool.query<{ effectiveAt: string }>(
        `SELECT effective_at::text AS "effectiveAt"
         FROM planning.plan_version WHERE id='plan-version-1'`,
      );
      expect(after.rows[0]?.effectiveAt).toBe(before.rows[0]?.effectiveAt);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('preserves the recorded task business date through the record-scope foreign key', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await makeRepository(pool).upsert(command());
      const before = await pool.query<{ businessDate: string }>(
        `SELECT business_date::text AS "businessDate"
         FROM recording.record_task WHERE id='task-1'`,
      );

      await expect(pool.query(`UPDATE recording.record_task
        SET business_date=DATE '2026-01-03' WHERE id='task-1'`))
        .rejects.toMatchObject({ code: '23503' });

      const after = await pool.query<{ businessDate: string }>(
        `SELECT business_date::text AS "businessDate"
         FROM recording.record_task WHERE id='task-1'`,
      );
      expect(after.rows[0]?.businessDate).toBe(before.rows[0]?.businessDate);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('rejects ambiguous effective ACTIVE plans with zero successful side effects', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`DROP INDEX planning.uq_plan_version_active_per_user`);
      await pool.query(`INSERT INTO planning.plan_version
        (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
         effective_at, effective_to, professional_rules_approved, demo_only)
        VALUES ('plan-version-ambiguous','plan-1','user-1',2,'ACTIVE',
          '2025-12-31T12:00:00Z','2026-01-01T12:00:00Z',
          '2026-01-02T00:00:00Z','2026-01-03T00:00:00Z',false,true)`);

      await expect(makeRepository(pool).upsert(command()))
        .rejects.toMatchObject({ code: 'RECORD_PLAN_NOT_ACTIVE' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rolls back record and idempotency when success audit insertion fails', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`CREATE FUNCTION recording.fail_success_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'EXPECTED_AUDIT_FAILURE'; END; $$`);
      await pool.query(`CREATE TRIGGER tr_test_fail_success_audit BEFORE INSERT
        ON recording.record_success_audit FOR EACH ROW EXECUTE FUNCTION recording.fail_success_audit()`);

      await expect(makeRepository(pool).upsert(command())).rejects.toThrow('EXPECTED_AUDIT_FAILURE');
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('rolls back all writes when completed replay persistence fails and can retry', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await pool.query(`CREATE FUNCTION recording.fail_completed_replay() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.status='COMPLETED' THEN RAISE EXCEPTION 'EXPECTED_REPLAY_FAILURE'; END IF;
          RETURN NEW;
        END; $$`);
      await pool.query(`CREATE TRIGGER tr_test_fail_completed_replay BEFORE UPDATE
        ON recording.record_idempotency FOR EACH ROW EXECUTE FUNCTION recording.fail_completed_replay()`);
      const repository = makeRepository(pool);

      await expect(repository.upsert(command())).rejects.toThrow('EXPECTED_REPLAY_FAILURE');
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
      await pool.query(`DROP TRIGGER tr_test_fail_completed_replay ON recording.record_idempotency`);
      await pool.query(`DROP FUNCTION recording.fail_completed_replay()`);
      await expect(repository.upsert(command())).resolves.toMatchObject({ recordVersion: 1 });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('keeps exact replay verifiable with a verify-only historical key', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const first = await makeRepository(pool).upsert(command());
      await rotateGate(pool);
      const rotated = new P11RecordRepository(pool, {
        activeKeyId: 'test-key-v2',
        keys: new Map([['test-key-v2', Buffer.from('fictional-p11-new-key')], ['test-key-v1', activeKey]]),
      });

      expect(await rotated.upsert(command({ requestId: 'rotated-replay' }))).toEqual(first);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('fails closed when the historical verify key is unavailable', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await makeRepository(pool).upsert(command());
      await rotateGate(pool);
      const rotated = new P11RecordRepository(pool, {
        activeKeyId: 'test-key-v2', keys: new Map([['test-key-v2', Buffer.from('fictional-p11-new-key')]]),
      });

      await expect(rotated.upsert(command({ requestId: 'unverifiable-replay' })))
        .rejects.toMatchObject({ code: 'HMAC_KEY_UNAVAILABLE' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('fails closed when any other scope references an unavailable historical key', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await makeRepository(pool).upsert(command());
      await rotateGate(pool);
      await pool.query(`UPDATE recording.record_task SET gate_revision=2 WHERE id='task-2'`);
      const rotated = new P11RecordRepository(pool, {
        activeKeyId: 'test-key-v2', keys: new Map([['test-key-v2', Buffer.from('fictional-p11-new-key')]]),
      });

      await expect(rotated.upsert(command({
        sessionTokenHash: 'session-token-hash-2',
        taskId: 'task-2',
        idempotencyKey: 'task-2-new-key',
        requestId: 'task-2-new-request',
      }))).rejects.toMatchObject({ code: 'HMAC_KEY_UNAVAILABLE' });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('copies signing key material at construction', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const mutable = Buffer.from(activeKey);
      const keys = new Map([['test-key-v1', mutable]]);
      const repository = makeRepository(pool, keys);
      mutable.fill(0);
      keys.clear();

      await expect(repository.upsert(command())).resolves.toMatchObject({ recordVersion: 1 });
      const digest = (await pool.query<{ digest: Buffer }>(`SELECT idempotency_key_digest AS digest
        FROM recording.record_idempotency`)).rows[0]!.digest;
      const expected = createHmac('sha256', activeKey)
        .update('lianban:p11:idempotency-key:v1').update('\0').update('idempotency-1').digest();
      expect(digest).toEqual(expected);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('rejects a non-test environment with zero successful side effects', async () => {
    await assertRouteRejected({ nodeEnv: 'production' });
  });

  it('rejects real-user schema approval with zero successful side effects', async () => {
    await assertRouteRejected({ schema: { ...schema, approvedForRealUsers: true } });
  });

  it('fails closed when active HMAC key material is missing', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const repository = makeRepository(pool, new Map());
      await expect(repository.upsert(command())).rejects.toMatchObject({ code: 'HMAC_KEY_UNAVAILABLE' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    });
  });

  it('excludes raw keys tokens values and secrets from idempotency and audit projections', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      await makeRepository(pool).upsert(command());
      const projection = (await pool.query<{ persisted: string }>(`
        SELECT concat(
          (SELECT jsonb_agg(to_jsonb(i))::text FROM recording.record_idempotency i),
          (SELECT jsonb_agg(to_jsonb(a))::text FROM recording.record_success_audit a)
        ) AS persisted
      `)).rows[0]!.persisted;

      for (const forbidden of [
        'idempotency-1', 'session-token-hash-1', 'fictional-value',
        'fictional-p11-active-key-material',
      ]) expect(projection).not.toContain(forbidden);
    });
  });

  it('normalizes entry order by field ID for exact replay', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
      await seedRepositoryFixture(pool);
      const orderedSchema = {
        ...schema,
        recordKinds: [{
          ...schema.recordKinds[0]!,
          fields: [
            { id: '字段-a', valueType: 'STRING' as const },
            { id: 'field-b', valueType: 'NUMBER' as const },
          ],
        }],
      } satisfies P11RecordSchema;
      const first = command({ schema: orderedSchema });
      first.command.entries = [
        { fieldId: 'field-b', valueType: 'NUMBER', value: 2 },
        { fieldId: '字段-a', valueType: 'STRING', value: 'a' },
      ];
      const replay = command({ schema: orderedSchema, requestId: 'ordered-replay' });
      replay.command.entries = [...first.command.entries].reverse();
      const repository = makeRepository(pool);
      const result = await repository.upsert(first);

      await expect(repository.upsert(replay)).resolves.toEqual(result);
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    });
  });

  it('cleans the isolated database after a deterministic barrier failure', async () => {
    let databaseName = '';
    await expect(withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool, databaseName: name }) => {
      databaseName = name;
      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await waitForBlockedRepositories(pool, await backendPid(blocker), 1, 50);
      } finally {
        await rollbackAndRelease(blocker);
      }
    })).rejects.toThrow('REPOSITORY_DID_NOT_REACH_EXPECTED_LOCK_WAIT');

    const maintenance = new Pool({ connectionString: adminUrl! });
    try {
      const result = await maintenance.query<{ present: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS present`,
        [databaseName],
      );
      expect(result.rows[0]?.present).toBe(false);
    } finally {
      await maintenance.end();
    }
  });
});

function makeRepository(pool: Pool, keys = new Map([['test-key-v1', activeKey]])) {
  return new P11RecordRepository(pool, { activeKeyId: 'test-key-v1', keys });
}

function command(overrides: Partial<P11UpsertInput> = {}): P11UpsertInput {
  return {
    sessionTokenHash: 'session-token-hash-1',
    taskId: 'task-1',
    idempotencyKey: 'idempotency-1',
    requestId: 'request-1',
    nodeEnv: 'test' as const,
    schema: structuredClone(schema),
    command: {
      operation: 'UPSERT_RECORD' as const,
      recordKindId: 'kind-1',
      schemaVersion: 'schema-v1',
      expectedRecordVersion: null,
      entries: [{ fieldId: 'field-1', valueType: 'STRING' as const, value: 'fictional-value' }],
    },
    ...overrides,
  } as P11UpsertInput;
}

async function successCounts(pool: Pool) {
  const result = await pool.query<{ records: number; completed: number; audits: number }>(`
    SELECT
      (SELECT count(*)::integer FROM recording.record) AS records,
      (SELECT count(*)::integer FROM recording.record_idempotency) AS completed,
      (SELECT count(*)::integer FROM recording.record_success_audit) AS audits
  `);
  return result.rows[0];
}

async function waitForBlockedRepository(pool: Pool, blockerPid: number) {
  await waitForBlockedRepositories(pool, blockerPid, 1);
}

async function waitForBlockedRepositories(
  pool: Pool,
  blockerPid: number,
  expectedCount: number,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blockedCount: number }>(`
      SELECT count(*)::integer AS "blockedCount"
        FROM pg_stat_activity activity
        WHERE activity.datname=current_database()
          AND activity.pid<>pg_backend_pid()
          AND $1=ANY(pg_blocking_pids(activity.pid))
    `, [blockerPid]);
    if ((result.rows[0]?.blockedCount ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('REPOSITORY_DID_NOT_REACH_EXPECTED_LOCK_WAIT');
}

async function waitForRepositoryLockWaits(pool: Pool, expectedCount: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blockedCount: number }>(`
      SELECT count(*)::integer AS "blockedCount"
      FROM pg_stat_activity
      WHERE datname=current_database()
        AND pid<>pg_backend_pid()
        AND wait_event_type='Lock'
    `);
    if ((result.rows[0]?.blockedCount ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('REPOSITORIES_DID_NOT_REACH_EXPECTED_LOCK_WAIT');
}

async function waitForSessionExpiry(pool: Pool, sessionId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ expired: boolean }>(`
      SELECT clock_timestamp() >= expires_at AS expired
      FROM iam.session WHERE id=$1
    `, [sessionId]);
    if (result.rows[0]?.expired) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('SESSION_DID_NOT_EXPIRE_AT_DATABASE_CLOCK');
}

async function waitForRepositoryQuery(pool: Pool, queryFragment: string, waitEventType: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ reached: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database()
          AND pid<>pg_backend_pid()
          AND query LIKE '%' || $1 || '%'
          AND wait_event_type=$2
      ) AS reached
    `, [queryFragment, waitEventType]);
    if (result.rows[0]?.reached) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('REPOSITORY_DID_NOT_REACH_EXPECTED_QUERY_BARRIER');
}

async function backendPid(client: import('pg').PoolClient) {
  return (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
}

async function assertStateRejected(mutation: string) {
  await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
    await seedRepositoryFixture(pool);
    const blocker = await pool.connect();
    let pending: Promise<P11RecordResult> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query(mutation);
      const blockerPid = await backendPid(blocker);
      pending = makeRepository(pool).upsert(command());
      void pending.catch(() => undefined);
      await waitForBlockedRepository(pool, blockerPid);
      await blocker.query('COMMIT');
    } finally {
      await rollbackAndRelease(blocker);
    }
    await expect(pending)
      .rejects.toMatchObject({ code: 'RECORD_STATE_BLOCKED' });
    expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
  });
}

async function assertFreshRaceRejected(
  mutate: (blocker: import('pg').PoolClient) => Promise<unknown>,
  expectedCode: string,
) {
  await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
    await seedRepositoryFixture(pool);
    const blocker = await pool.connect();
    let pending: Promise<P11RecordResult> | undefined;
    try {
      await blocker.query('BEGIN');
      await mutate(blocker);
      const blockerPid = await backendPid(blocker);
      pending = makeRepository(pool).upsert(command());
      void pending.catch(() => undefined);
      await waitForBlockedRepository(pool, blockerPid);
      await blocker.query('COMMIT');
    } finally {
      await rollbackAndRelease(blocker);
    }

    await expect(pending).rejects.toMatchObject({ code: expectedCode });
    expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
  });
}

async function assertPlanWindowRejected(effectiveAt: string, effectiveTo: string) {
  await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
    await seedRepositoryFixture(pool, { effectiveAt, effectiveTo });
    await expect(makeRepository(pool).upsert(command()))
      .rejects.toMatchObject({ code: 'RECORD_PLAN_NOT_ACTIVE' });
    expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
  });
}

async function assertPlanWindowForTimeZone(
  timeZone: string,
  window: { effectiveAt: string; effectiveTo: string },
  allowed: boolean,
) {
  await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
    await pool.query(`SELECT set_config('TimeZone', $1, false)`, [timeZone]);
    await seedRepositoryFixture(pool, window);
    const result = makeRepository(pool).upsert(command());
    if (allowed) {
      await expect(result).resolves.toMatchObject({ recordVersion: 1 });
      expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
    } else {
      await expect(result).rejects.toMatchObject({ code: 'RECORD_PLAN_NOT_ACTIVE' });
      expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
    }
  });
}

async function assertReplayRaceRejected(
  mutate: (blocker: import('pg').PoolClient) => Promise<unknown>,
  expectedCode: string,
) {
  await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
    await seedRepositoryFixture(pool);
    const repository = makeRepository(pool);
    await repository.upsert(command());
    const blocker = await pool.connect();
    let pending: Promise<P11RecordResult> | undefined;
    try {
      await blocker.query('BEGIN');
      await mutate(blocker);
      const blockerPid = await backendPid(blocker);
      pending = repository.upsert(command({ requestId: 'replay-after-race' }));
      void pending.catch(() => undefined);
      await waitForBlockedRepository(pool, blockerPid);
      await blocker.query('COMMIT');
    } finally {
      await rollbackAndRelease(blocker);
    }

    await expect(pending).rejects.toMatchObject({ code: expectedCode });
    expect(await successCounts(pool)).toEqual({ records: 1, completed: 1, audits: 1 });
  });
}

async function rollbackAndRelease(blocker: import('pg').PoolClient) {
  try {
    await blocker.query('ROLLBACK');
  } catch {
    // The connection may already be outside a transaction after COMMIT.
  } finally {
    blocker.release();
  }
}

async function assertRouteRejected(change: Record<string, unknown>) {
  await withIsolatedPostgresTestDatabase(adminUrl!, async ({ pool }) => {
    await seedRepositoryFixture(pool);
    await expect(makeRepository(pool).upsert(command(change as never)))
      .rejects.toMatchObject({ code: 'ROUTE_ACCESS_NOT_APPROVED' });
    expect(await successCounts(pool)).toEqual({ records: 0, completed: 0, audits: 0 });
  });
}

async function seedRepositoryFixture(pool: Pool, planWindow: {
  effectiveAt: string; effectiveTo: string;
} = { effectiveAt: '2026-01-02T00:00:00Z', effectiveTo: '2026-01-03T00:00:00Z' }) {
  await pool.query(`INSERT INTO iam.account
    (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
    VALUES ('user-1', 'user-1', 'hash', 'USER', 'ACTIVE', false),
           ('user-2', 'user-2', 'hash', 'USER', 'ACTIVE', false)`);
  await pool.query(`INSERT INTO iam.session
    (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at)
    VALUES ('session-1', 'user-1', 'USER', 'session-token-hash-1', 'USER', 'FULL', now() + interval '1 hour'),
           ('session-2', 'user-2', 'USER', 'session-token-hash-2', 'USER', 'FULL', now() + interval '1 hour')`);
  await pool.query(`INSERT INTO planning.plan (id, user_id)
    VALUES ('plan-1', 'user-1'), ('plan-2', 'user-2')`);
  await pool.query(`INSERT INTO planning.plan_version
    (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
     effective_at, effective_to, professional_rules_approved, demo_only)
    VALUES
      ('plan-version-1', 'plan-1', 'user-1', 1, 'ACTIVE',
       (date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Shanghai') - interval '28 hours')
         AT TIME ZONE 'Asia/Shanghai',
       (date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Shanghai') - interval '4 hours')
         AT TIME ZONE 'Asia/Shanghai',
       $1, $2, false, true),
      ('plan-version-2', 'plan-2', 'user-2', 1, 'ACTIVE',
       '2025-12-31T12:00:00Z', '2026-01-01T12:00:00Z',
       '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', false, true)`,
  [planWindow.effectiveAt, planWindow.effectiveTo]);
  await pool.query(`INSERT INTO recording.p11_write_gate_revision
    (gate_id, revision, node_env, test_only, approved_for_real_users,
     route_access_approved, write_enabled, schema_version, hmac_key_id)
    VALUES ('P11_RECORD_WRITE', 1, 'TEST', true, false, true, true, 'schema-v1', 'test-key-v1')`);
  await pool.query(`INSERT INTO recording.p11_write_gate (id, current_revision)
    VALUES ('P11_RECORD_WRITE', 1)`);
  await pool.query(`INSERT INTO recording.record_task
    (id, user_id, plan_id, plan_version_id, business_date, schema_version,
     gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
    VALUES
      ('task-1', 'user-1', 'plan-1', 'plan-version-1', DATE '2026-01-02', 'schema-v1',
       'P11_RECORD_WRITE', 1, 'TEST_ONLY_EXPLICIT', 'OPEN', 'OPEN', 'CLEAR'),
      ('task-2', 'user-2', 'plan-2', 'plan-version-2', DATE '2026-01-02', 'schema-v1',
       'P11_RECORD_WRITE', 1, 'TEST_ONLY_EXPLICIT', 'OPEN', 'OPEN', 'CLEAR')`);
}

async function rotateGate(pool: Pool) {
  await pool.query(`INSERT INTO recording.p11_write_gate_revision
    (gate_id, revision, node_env, test_only, approved_for_real_users,
     route_access_approved, write_enabled, schema_version, hmac_key_id)
    VALUES ('P11_RECORD_WRITE',2,'TEST',true,false,true,true,'schema-v1','test-key-v2')`);
  await pool.query(`UPDATE recording.p11_write_gate SET current_revision=2`);
  await pool.query(`UPDATE recording.record_task SET gate_revision=2 WHERE id='task-1'`);
}
