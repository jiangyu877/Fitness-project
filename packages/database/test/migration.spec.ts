import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations, applyMigrationsThrough } from '../src/migrate.js';

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('core database migration', () => {
  it('creates the approved core model without professional seed data', async () => {
    database = new PGlite();
    await applyMigrations(database);

    const result = await database.query<{ table_schema: string; table_name: string }>(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('iam', 'care', 'planning', 'audit')
      ORDER BY table_schema, table_name
    `);

    expect(result.rows).toEqual(
      expect.arrayContaining([
        { table_schema: 'audit', table_name: 'audit_event' },
        { table_schema: 'care', table_name: 'consent_record' },
        { table_schema: 'care', table_name: 'screening_result' },
        { table_schema: 'care', table_name: 'user_profile' },
        { table_schema: 'iam', table_name: 'account' },
        { table_schema: 'iam', table_name: 'role' },
        { table_schema: 'iam', table_name: 'session' },
        { table_schema: 'planning', table_name: 'plan' },
        { table_schema: 'planning', table_name: 'plan_version' },
      ]),
    );

    const professionalRows = await database.query(`
      SELECT * FROM planning.professional_rule_version
    `);
    expect(professionalRows.rows).toHaveLength(0);
  });

  it('constrains screening to trusted conclusion-only records', async () => {
    database = new PGlite();
    await applyMigrations(database);
    await database.exec(`
      INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
      VALUES ('screen-user', 'screen-user', 'hash', 'USER'),
             ('screen-reviewer', 'screen-reviewer', 'hash', 'STAFF');
    `);

    await expect(database.query(`
      INSERT INTO care.screening_result
        (id, user_id, conclusion, source, recorded_by, actor_role)
      VALUES
        ('bad-screen', 'screen-user', 'DIAGNOSED', 'CLIENT_THRESHOLD',
         'screen-reviewer', 'OPERATIONS')
    `)).rejects.toThrow();
  });

  it('adds scoped idempotency metadata and controlled system audit actors', async () => {
    database = new PGlite();
    await applyMigrations(database);

    const columns = await database.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'audit' AND table_name = 'idempotency_key'
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'operation',
      'principal_scope',
      'request_fingerprint',
    ]));

    const sessionColumns = await database.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='iam' AND table_name='session'
    `);
    expect(sessionColumns.rows.map((row) => row.column_name)).toContain('active_role');

    await expect(database.query(`
      INSERT INTO audit.audit_event
        (id, actor_id, actor_role, action, subject_type, subject_id, request_id)
      VALUES
        ('system-audit', NULL, 'SYSTEM', 'LOGIN_FAILED', 'ACCOUNT', 'account-1', 'request-1')
    `)).resolves.toBeDefined();
  });

  it('adds structured audit outcomes without changing released migrations', async () => {
    database = new PGlite();
    await applyMigrations(database);
    const columns = await database.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='audit' AND table_name='audit_event'
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'outcome',
      'error_code',
    ]));
  });

  it('upgrades legacy sessions to FULL and constrains recovery session scope', async () => {
    database = new PGlite();
    await applyMigrationsThrough(database, '007_identity_audit_outcomes');
    await database.exec(`
      INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
      VALUES ('legacy-user', 'legacy-user', 'hash', 'USER'),
             ('legacy-staff', 'legacy-staff', 'hash', 'STAFF');
      INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, expires_at, active_role, mfa_verified)
      VALUES ('legacy-session', 'legacy-user', 'USER', 'legacy-hash', now() + interval '1 hour', 'USER', false),
             ('legacy-staff-session', 'legacy-staff', 'STAFF', 'legacy-staff-hash', now() + interval '1 hour', 'OPERATIONS', true);
    `);
    await applyMigrationsThrough(database, '008_identity_recovery_sessions');
    const legacy = await database.query<{ id: string; account_id: string; token_hash: string; mfa_verified: boolean; session_scope: string }>(
      `SELECT id, account_id, token_hash, mfa_verified, session_scope FROM iam.session ORDER BY id`,
    );
    expect(legacy.rows).toEqual([
      { id: 'legacy-session', account_id: 'legacy-user', token_hash: 'legacy-hash', mfa_verified: false, session_scope: 'FULL' },
      { id: 'legacy-staff-session', account_id: 'legacy-staff', token_hash: 'legacy-staff-hash', mfa_verified: true, session_scope: 'FULL' },
    ]);
    await expect(database.query(`
      INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, expires_at, active_role, session_scope)
      VALUES ('valid-recovery', 'legacy-user', 'USER', 'valid-hash', now() + interval '1 hour', 'USER', 'PASSWORD_CHANGE')
    `)).resolves.toBeDefined();
    await expect(database.query(`
      INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, expires_at, active_role, session_scope)
      VALUES ('bad-recovery', 'legacy-staff', 'STAFF', 'bad-hash', now() + interval '1 hour', 'OPERATIONS', 'PASSWORD_CHANGE')
    `)).rejects.toThrow();
    await expect(database.query(`
      INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, expires_at, active_role, session_scope)
      VALUES ('staff-masquerades-user', 'legacy-staff', 'USER', 'staff-user-hash', now() + interval '1 hour', 'USER', 'PASSWORD_CHANGE')
    `)).rejects.toThrow(/requires USER account/i);
    await expect(database.query(`
      INSERT INTO iam.session
        (id, account_id, session_kind, token_hash, expires_at, active_role, session_scope)
      VALUES ('bad-user-role', 'legacy-user', 'USER', 'bad-user-role-hash', now() + interval '1 hour', NULL, 'PASSWORD_CHANGE')
    `)).rejects.toThrow();
    await expect(database.query(`UPDATE iam.session SET session_scope='UNKNOWN' WHERE id='legacy-session'`)).rejects.toThrow();
    await expect(database.query(`UPDATE iam.session SET account_id='legacy-staff' WHERE id='valid-recovery'`)).rejects.toThrow(/requires USER account/i);
    await expect(database.query(`UPDATE iam.session SET session_kind='STAFF' WHERE id='valid-recovery'`)).rejects.toThrow();
    await expect(database.query(`UPDATE iam.account SET account_type='STAFF' WHERE id='legacy-user'`)).rejects.toThrow(/must remain USER/i);
    expect((await database.query(
      `SELECT account_type FROM iam.account WHERE id='legacy-user'`,
    )).rows).toEqual([{ account_type: 'USER' }]);
    expect((await database.query(
      `SELECT account_id, session_kind, active_role, session_scope FROM iam.session WHERE id='valid-recovery'`,
    )).rows).toEqual([{
      account_id: 'legacy-user', session_kind: 'USER', active_role: 'USER', session_scope: 'PASSWORD_CHANGE',
    }]);
  });

  it('upgrades 008 to 009 while preserving published content immutability and allowing lifecycle state', async () => {
    database = new PGlite();
    await applyMigrationsThrough(database, '008_identity_recovery_sessions');
    await seedPlan(database);
    await database.query(`
      INSERT INTO planning.plan_version (
        id, plan_id, user_id, version_number, status, published_at,
        confirmation_deadline_at, effective_at, professional_rules_approved, payload
      ) VALUES (
        'upgrade-version', 'plan-guard', 'user-guard', 1, 'PENDING_CONFIRMATION',
        '2026-08-08T12:00:00Z', '2026-08-09T12:00:00Z', '2026-08-10T00:00:00Z', true,
        '{"contentMode":"REVIEWED","createdBy":"operations","plan":{"id":"upgrade-version","userId":"user-guard","confirmationDeadlineAt":"2026-08-09T12:00:00.000Z","effectiveAt":"2026-08-10T00:00:00.000Z","dietConfirmed":false}}'
      )
    `);

    await applyMigrationsThrough(database, '009_plan_lifecycle_persistence');
    await expect(database.query(`
      UPDATE planning.plan_version
      SET status='SCHEDULED', payload=jsonb_set(payload, '{plan,dietConfirmed}', 'true'::jsonb)
      WHERE id='upgrade-version'
    `)).resolves.toBeDefined();
    await expect(database.query(`
      UPDATE planning.plan_version
      SET payload=jsonb_set(payload, '{contentMode}', '"DEMO_UNREVIEWED"'::jsonb)
      WHERE id='upgrade-version'
    `)).rejects.toThrow(/published plan version is immutable/i);
  });

  it('enforces unique login identifiers', async () => {
    database = new PGlite();
    await applyMigrations(database);
    await database.query(`
      INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
      VALUES ('account-1', 'invite-001', 'hash', 'USER')
    `);

    await expect(
      database.query(`
        INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
        VALUES ('account-2', 'invite-001', 'hash', 'USER')
      `),
    ).rejects.toThrow();
  });

  it('enforces one pending or scheduled version per user', async () => {
    database = new PGlite();
    await applyMigrations(database);
    await database.exec(`
      INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
      VALUES ('user-1', 'invite-001', 'hash', 'USER');
      INSERT INTO planning.plan (id, user_id) VALUES ('plan-1', 'user-1');
      INSERT INTO planning.plan_version (
        id, plan_id, user_id, version_number, status, published_at,
        confirmation_deadline_at, effective_at, professional_rules_approved
      ) VALUES (
        'version-1', 'plan-1', 'user-1', 1, 'PENDING_CONFIRMATION',
        '2026-07-25T12:00:00Z', '2026-07-26T12:00:00Z',
        '2026-07-27T00:00:00Z', false
      );
    `);

    await expect(
      database.query(`
        INSERT INTO planning.plan_version (
          id, plan_id, user_id, version_number, status, published_at,
          confirmation_deadline_at, effective_at, professional_rules_approved
        ) VALUES (
          'version-2', 'plan-1', 'user-1', 2, 'SCHEDULED',
          '2026-08-01T12:00:00Z', '2026-08-02T12:00:00Z',
          '2026-08-03T00:00:00Z', false
        )
      `),
    ).rejects.toThrow();
  });

  it('enforces at most one active version per user as database defense in depth', async () => {
    database = new PGlite();
    await applyMigrations(database);
    await seedPlan(database);
    await database.query(`
      INSERT INTO planning.plan_version (
        id, plan_id, user_id, version_number, status, published_at,
        confirmation_deadline_at, effective_at, effective_to, professional_rules_approved
      ) VALUES (
        'active-a', 'plan-guard', 'user-guard', 1, 'ACTIVE',
        '2026-08-08T12:00:00Z', '2026-08-09T12:00:00Z',
        '2026-08-10T00:00:00Z', '2026-08-17T00:00:00Z', true
      )
    `);

    await expect(database.query(`
      INSERT INTO planning.plan_version (
        id, plan_id, user_id, version_number, status, published_at,
        confirmation_deadline_at, effective_at, effective_to, professional_rules_approved
      ) VALUES (
        'active-b', 'plan-guard', 'user-guard', 2, 'ACTIVE',
        '2026-08-15T12:00:00Z', '2026-08-16T12:00:00Z',
        '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', true
      )
    `)).rejects.toThrow();
  });

  it('adds lifecycle audit fields for publication, timeout, and revision', async () => {
    database = new PGlite();
    await applyMigrations(database);

    const result = await database.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'planning' AND table_name = 'plan_version'
    `);

    expect(result.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining(['published_at', 'rejection_reason_code']),
    );
  });

  it('enforces the CST deadline and 24-hour publication lead time', async () => {
    database = new PGlite();
    await applyMigrations(database);
    await seedPlan(database);

    await expect(
      database.query(`
        INSERT INTO planning.plan_version (
          id, plan_id, user_id, version_number, status, published_at,
          confirmation_deadline_at, effective_at, professional_rules_approved
        ) VALUES (
          'version-late', 'plan-guard', 'user-guard', 1, 'PENDING_CONFIRMATION',
          '2026-08-08T12:00:00.001Z', '2026-08-09T12:00:00Z',
          '2026-08-10T00:00:00Z', false
        )
      `),
    ).rejects.toThrow();

    await expect(
      database.query(`
        INSERT INTO planning.plan_version (
          id, plan_id, user_id, version_number, status,
          confirmation_deadline_at, effective_at, professional_rules_approved
        ) VALUES (
          'version-deadline', 'plan-guard', 'user-guard', 2, 'DRAFT',
          '2026-08-09T11:59:59Z', '2026-08-10T00:00:00Z', false
        )
      `),
    ).rejects.toThrow();
  });

  it('rejects invalid effective windows and in-place edits after publication', async () => {
    database = new PGlite();
    await applyMigrations(database);
    await seedPlan(database);

    await expect(
      database.query(`
        INSERT INTO planning.plan_version (
          id, plan_id, user_id, version_number, status,
          confirmation_deadline_at, effective_at, effective_to,
          professional_rules_approved
        ) VALUES (
          'version-window', 'plan-guard', 'user-guard', 1, 'DRAFT',
          '2026-08-09T12:00:00Z', '2026-08-10T00:00:00Z',
          '2026-08-09T00:00:00Z', false
        )
      `),
    ).rejects.toThrow();

    await database.query(`
      INSERT INTO planning.plan_version (
        id, plan_id, user_id, version_number, status, published_at,
        confirmation_deadline_at, effective_at, effective_to,
        professional_rules_approved, payload
      ) VALUES (
        'version-published', 'plan-guard', 'user-guard', 2, 'PENDING_CONFIRMATION',
        '2026-08-08T12:00:00Z', '2026-08-09T12:00:00Z',
        '2026-08-10T00:00:00Z', '2026-08-17T00:00:00Z', false, '{}'
      )
    `);

    await expect(
      database.query(`
        UPDATE planning.plan_version
        SET payload = '{"changed": true}'::jsonb
        WHERE id = 'version-published'
      `),
    ).rejects.toThrow(/published plan version is immutable/i);
  });

  it('upgrades 009 to 010 without treating legacy arbitrary JSON as an approved profile schema', async () => {
    database = new PGlite();
    await applyMigrationsThrough(database, '009_plan_lifecycle_persistence');
    await database.exec(`
      INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
      VALUES ('legacy-profile-user', 'legacy-profile-user', 'hash', 'USER');
      INSERT INTO care.user_profile (id, user_id, profile_data, completed_steps)
      VALUES ('legacy-profile', 'legacy-profile-user', '{"legacy":"value"}', '["legacy"]');
    `);

    await applyMigrationsThrough(database, '010_p07_safe_structure');
    const profile = await database.query<{ schema_version: string | null }>(
      `SELECT schema_version FROM care.user_profile WHERE id='legacy-profile'`,
    );
    expect(profile.rows).toEqual([{ schema_version: null }]);
    await expect(database.query(
      `UPDATE care.user_profile SET schema_version='' WHERE id='legacy-profile'`,
    )).rejects.toThrow();
  });

  it('adds the isolated P11 record persistence model in append-only migration 011', async () => {
    database = new PGlite();
    await applyMigrationsThrough(database, '010_p07_safe_structure');

    await applyMigrationsThrough(database, '011_p11_record_persistence');

    const tables = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='recording'
      ORDER BY table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'p11_write_gate',
      'p11_write_gate_revision',
      'record',
      'record_idempotency',
      'record_success_audit',
      'record_task',
    ]);

    const taskColumns = await database.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='recording' AND table_name='record_task'
      ORDER BY column_name
    `);
    expect(taskColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining(['gate_id', 'gate_revision']),
    );

    const idempotencyColumns = await database.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='recording' AND table_name='record_idempotency'
      ORDER BY column_name
    `);
    expect(idempotencyColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'idempotency_key_digest',
        'intent_digest',
        'key_id',
        'replay_result',
      ]),
    );
    expect(idempotencyColumns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(['idempotency_key', 'canonical_intent', 'raw_entries']),
    );
  });
});

async function seedPlan(target: PGlite): Promise<void> {
  await target.exec(`
    INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
    VALUES ('user-guard', 'invite-guard', 'hash', 'USER');
    INSERT INTO planning.plan (id, user_id) VALUES ('plan-guard', 'user-guard');
  `);
}
