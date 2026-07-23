import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from '../src/migrate.js';

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
});

async function seedPlan(target: PGlite): Promise<void> {
  await target.exec(`
    INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
    VALUES ('user-guard', 'invite-guard', 'hash', 'USER');
    INSERT INTO planning.plan (id, user_id) VALUES ('plan-guard', 'user-guard');
  `);
}
