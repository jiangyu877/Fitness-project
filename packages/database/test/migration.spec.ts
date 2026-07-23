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
        { table_schema: 'care', table_name: 'user_profile' },
        { table_schema: 'iam', table_name: 'account' },
        { table_schema: 'iam', table_name: 'role' },
        { table_schema: 'planning', table_name: 'plan' },
        { table_schema: 'planning', table_name: 'plan_version' },
      ]),
    );

    const professionalRows = await database.query(`
      SELECT * FROM planning.professional_rule_version
    `);
    expect(professionalRows.rows).toHaveLength(0);
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
        id, plan_id, user_id, version_number, status,
        confirmation_deadline_at, effective_at, professional_rules_approved
      ) VALUES (
        'version-1', 'plan-1', 'user-1', 1, 'PENDING_CONFIRMATION',
        '2026-07-26T12:00:00Z', '2026-07-27T00:00:00Z', false
      );
    `);

    await expect(
      database.query(`
        INSERT INTO planning.plan_version (
          id, plan_id, user_id, version_number, status,
          confirmation_deadline_at, effective_at, professional_rules_approved
        ) VALUES (
          'version-2', 'plan-1', 'user-1', 2, 'SCHEDULED',
          '2026-08-02T12:00:00Z', '2026-08-03T00:00:00Z', false
        )
      `),
    ).rejects.toThrow();
  });
});
