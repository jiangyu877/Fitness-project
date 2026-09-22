import { createHash } from 'node:crypto';
import { applyMigrations } from '@lianban/database';
import { Pool } from 'pg';

/** Creates an isolated loopback test database, applies migrations, and always drops it. */
export async function withIsolatedPostgres<Result>(
  adminUrl: string,
  run: (pool: Pool) => Promise<Result>,
): Promise<Result> {
  const admin = new URL(adminUrl);
  const databaseName = `lianban_p11_test_${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 32)}`;
  const maintenance = new Pool({ connectionString: admin.toString() });
  const targetUrl = new URL(admin);
  targetUrl.pathname = `/${databaseName}`;
  let pool: Pool | undefined;
  let created = false;
  try {
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    pool = new Pool({ connectionString: targetUrl.toString() });
    const targetPool = pool;
    await applyMigrations({
      exec: async (sql: string) => { await targetPool.query(sql); },
      query: async <Row>(sql: string, params: unknown[] = []) => ({ rows: (await targetPool.query(sql, params)).rows as Row[] }),
      transaction: async <T>(run2: (connection: any) => Promise<T>) => {
        const client = await targetPool.connect();
        try {
          await client.query('BEGIN');
          const result = await run2({
            exec: async (sql: string) => { await client.query(sql); },
            query: async <Row>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params)).rows as Row[] }),
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    } as never);
    return await run(targetPool);
  } finally {
    await pool?.end().catch(() => undefined);
    if (created) {
      await maintenance.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [databaseName]).catch(() => undefined);
      await maintenance.query(`DROP DATABASE "${databaseName}"`).catch(() => undefined);
    }
    await maintenance.end().catch(() => undefined);
  }
}
