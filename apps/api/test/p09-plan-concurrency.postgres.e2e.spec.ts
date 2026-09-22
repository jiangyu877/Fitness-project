import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { withIsolatedPostgres } from './support/isolated-postgres.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

const EFFECTIVE_AT = '2026-01-01T00:00:00Z';
const EFFECTIVE_TO = '2026-01-08T00:00:00Z';
const DEADLINE = '2025-12-31T12:00:00Z';
const PUBLISHED_AT = '2025-12-30T12:00:00Z';

function draftVersion(id: string, planId: string, userId: string, versionNumber: number): string {
  return `('${id}','${planId}','${userId}',${versionNumber},'DRAFT',NULL,`
    + `TIMESTAMPTZ '${DEADLINE}',TIMESTAMPTZ '${EFFECTIVE_AT}',TIMESTAMPTZ '${EFFECTIVE_TO}',false,false,'{}')`;
}

async function seedPlanFixture(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
     VALUES ('p09-user-1','p09-user-1','hash','USER','ACTIVE',false), ('p09-user-2','p09-user-2','hash','USER','ACTIVE',false)`,
  );
  await pool.query(
    `INSERT INTO planning.plan (id, user_id) VALUES ('p09-plan-1','p09-user-1'), ('p09-plan-2','p09-user-2')`,
  );
  await pool.query(
    `INSERT INTO planning.plan_version
       (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
        effective_at, effective_to, professional_rules_approved, demo_only, payload)
     VALUES
       ${draftVersion('p09-v1', 'p09-plan-1', 'p09-user-1', 1)},
       ${draftVersion('p09-v2', 'p09-plan-1', 'p09-user-1', 2)},
       ${draftVersion('p09-v3', 'p09-plan-1', 'p09-user-1', 3)},
       ${draftVersion('p09-v4', 'p09-plan-1', 'p09-user-1', 4)},
       ('p09-v5','p09-plan-2','p09-user-2',1,'ACTIVE',TIMESTAMPTZ '${PUBLISHED_AT}',
        TIMESTAMPTZ '${DEADLINE}',TIMESTAMPTZ '${EFFECTIVE_AT}',TIMESTAMPTZ '${EFFECTIVE_TO}',false,false,'{}')`,
  );
}

async function waitForLockWait(pool: Pool, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((result.rows[0]?.n ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe.runIf(Boolean(adminUrl)).sequential('P09 PG18 concurrency guards', () => {
  it('serializes concurrent activation into exactly one ACTIVE version', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      await seedPlanFixture(pool);
      const activate = `UPDATE planning.plan_version SET status='ACTIVE', `
        + `published_at=TIMESTAMPTZ '${PUBLISHED_AT}' WHERE id=`;
      const clientA = await pool.connect();
      const clientB = await pool.connect();
      try {
        await clientA.query('BEGIN');
        await clientA.query(`${activate}'p09-v1'`);
        await clientB.query('BEGIN');
        const blocked = clientB.query(`${activate}'p09-v2'`);
        expect(await waitForLockWait(pool)).toBe(true);
        await clientA.query('COMMIT');
        await expect(blocked).rejects.toMatchObject({
          code: '23505', constraint: 'uq_plan_version_active_per_user',
        });
        await clientB.query('ROLLBACK');
      } finally {
        clientA.release();
        clientB.release();
      }
      expect((await pool.query(
        `SELECT id, status FROM planning.plan_version WHERE user_id='p09-user-1' AND status='ACTIVE'`,
      )).rows).toEqual([{ id: 'p09-v1', status: 'ACTIVE' }]);
      expect((await pool.query(`SELECT status FROM planning.plan_version WHERE id='p09-v2'`)).rows)
        .toEqual([{ status: 'DRAFT' }]);
    });
  });

  it('serializes concurrent publication into exactly one pending version', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      await seedPlanFixture(pool);
      const publish = `UPDATE planning.plan_version SET status='PENDING_CONFIRMATION', `
        + `published_at=TIMESTAMPTZ '${PUBLISHED_AT}' WHERE id=`;
      const clientA = await pool.connect();
      const clientB = await pool.connect();
      try {
        await clientA.query('BEGIN');
        await clientA.query(`${publish}'p09-v3'`);
        await clientB.query('BEGIN');
        const blocked = clientB.query(`${publish}'p09-v4'`);
        expect(await waitForLockWait(pool)).toBe(true);
        await clientA.query('COMMIT');
        await expect(blocked).rejects.toMatchObject({
          code: '23505', constraint: 'uq_plan_version_pending_per_user',
        });
        await clientB.query('ROLLBACK');
      } finally {
        clientA.release();
        clientB.release();
      }
      expect((await pool.query(
        `SELECT id, status FROM planning.plan_version
         WHERE user_id='p09-user-1' AND status IN ('PENDING_CONFIRMATION','SCHEDULED')`,
      )).rows).toEqual([{ id: 'p09-v3', status: 'PENDING_CONFIRMATION' }]);
      expect((await pool.query(`SELECT status FROM planning.plan_version WHERE id='p09-v4'`)).rows)
        .toEqual([{ status: 'DRAFT' }]);
    });
  });

  it('never exposes uncommitted status changes to concurrent reads', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      await seedPlanFixture(pool);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE planning.plan_version SET status='PENDING_CONFIRMATION',
             published_at=TIMESTAMPTZ '${PUBLISHED_AT}' WHERE id='p09-v3'`,
        );
        expect((await pool.query(`SELECT status FROM planning.plan_version WHERE id='p09-v3'`)).rows)
          .toEqual([{ status: 'DRAFT' }]);
        await client.query('COMMIT');
        expect((await pool.query(`SELECT status FROM planning.plan_version WHERE id='p09-v3'`)).rows)
          .toEqual([{ status: 'PENDING_CONFIRMATION' }]);
      } finally {
        client.release();
      }
    });
  });

  it('rejects mutations of a published plan version', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      await seedPlanFixture(pool);
      await expect(pool.query(`UPDATE planning.plan_version SET payload='{"changed":true}' WHERE id='p09-v5'`))
        .rejects.toMatchObject({ message: 'published plan version is immutable' });
      await expect(pool.query(
        `UPDATE planning.plan_version SET effective_at=TIMESTAMPTZ '2026-02-01T00:00:00Z' WHERE id='p09-v5'`,
      )).rejects.toMatchObject({ message: 'published plan version is immutable' });
      expect((await pool.query(`SELECT payload, effective_at FROM planning.plan_version WHERE id='p09-v5'`)).rows)
        .toEqual([{ payload: {}, effective_at: new Date('2026-01-01T00:00:00Z') }]);
    });
  });

  it('enforces the CST confirmation deadline constraint', async () => {
    await withIsolatedPostgres(adminUrl!, async (pool) => {
      await seedPlanFixture(pool);
      await expect(pool.query(
        `INSERT INTO planning.plan_version
           (id, plan_id, user_id, version_number, status, confirmation_deadline_at,
            effective_at, effective_to, payload)
         VALUES ('p09-bad','p09-plan-1','p09-user-1',9,'DRAFT',
           TIMESTAMPTZ '2026-01-01T12:00:00Z',TIMESTAMPTZ '${EFFECTIVE_AT}',
           TIMESTAMPTZ '${EFFECTIVE_TO}','{}')`,
      )).rejects.toMatchObject({
        code: '23514', constraint: 'ck_plan_version_confirmation_deadline_cst',
      });
    });
  });
});
