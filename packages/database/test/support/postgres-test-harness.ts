import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

import {
  applyMigrations,
  applyMigrationsThrough,
  type MigrationConnection,
  type MigrationDatabase,
  type MigrationVersion,
} from '../../src/migrate.js';

const TEST_DATABASE_NAME = /^lianban_p11_test_[0-9a-f]{32}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type IsolatedPostgresTestDatabase = {
  databaseName: string;
  pool: Pool;
  migrateThrough(targetVersion: MigrationVersion): Promise<void>;
};

type IsolatedPostgresTestOptions = { initialTargetVersion?: MigrationVersion };

export function assertSafePostgresAdminUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('UNSAFE_TEST_POSTGRES_ADMIN_URL');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !LOOPBACK_HOSTS.has(hostname)
    || url.pathname !== '/postgres') {
    throw new Error('UNSAFE_TEST_POSTGRES_ADMIN_URL');
  }

  return url;
}

export function isSafePostgresTestDatabaseName(value: string): boolean {
  return TEST_DATABASE_NAME.test(value);
}

export async function withIsolatedPostgresTestDatabase<Result>(
  rawAdminUrl: string,
  run: (database: IsolatedPostgresTestDatabase) => Promise<Result>,
  options: IsolatedPostgresTestOptions = {},
): Promise<Result> {
  const adminUrl = assertSafePostgresAdminUrl(rawAdminUrl);
  const databaseName = generateDatabaseName();
  requireSafeDatabaseName(databaseName);

  const maintenancePool = new Pool({ connectionString: adminUrl.toString() });
  let targetPool: Pool | undefined;
  let created = false;
  const cleanupErrors: unknown[] = [];

  try {
    requireSafeDatabaseName(databaseName);
    await maintenancePool.query(`CREATE DATABASE ${quotedDatabaseName(databaseName)}`);
    created = true;

    targetPool = new Pool({ connectionString: targetUrl(adminUrl, databaseName) });
    const migrationDatabase = new PgMigrationDatabase(targetPool);
    if (options.initialTargetVersion) {
      await applyMigrationsThrough(migrationDatabase, options.initialTargetVersion);
    } else {
      await applyMigrations(migrationDatabase);
    }
    return await run({
      databaseName,
      pool: targetPool,
      migrateThrough: (targetVersion) => applyMigrationsThrough(migrationDatabase, targetVersion),
    });
  } finally {
    if (targetPool) {
      try {
        await targetPool.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (created) {
      try {
        requireSafeDatabaseName(databaseName);
        await maintenancePool.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname=$1 AND pid<>pg_backend_pid()`,
          [databaseName],
        );
        requireSafeDatabaseName(databaseName);
        await maintenancePool.query(`DROP DATABASE ${quotedDatabaseName(databaseName)}`);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    try {
      await maintenancePool.end();
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'POSTGRES_TEST_DATABASE_CLEANUP_FAILED');
    }
  }
}

class PgMigrationConnection implements MigrationConnection {
  constructor(private readonly client: PoolClient) {}

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async query<Row>(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    const result = await this.client.query(sql, params);
    return { rows: result.rows as Row[] };
  }
}

class PgMigrationDatabase implements MigrationDatabase {
  constructor(private readonly pool: Pool) {}

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async query<Row>(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as Row[] };
  }

  async transaction<Result>(
    run: (connection: MigrationConnection) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const result = await run(new PgMigrationConnection(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (began) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'POSTGRES_MIGRATION_TRANSACTION_FAILED');
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function generateDatabaseName(): string {
  return `lianban_p11_test_${randomUUID().replaceAll('-', '')}`;
}

function requireSafeDatabaseName(value: string): void {
  if (!isSafePostgresTestDatabaseName(value)) {
    throw new Error('UNSAFE_TEST_POSTGRES_DATABASE_NAME');
  }
}

function quotedDatabaseName(value: string): string {
  requireSafeDatabaseName(value);
  return `"${value}"`;
}

function targetUrl(adminUrl: URL, databaseName: string): string {
  requireSafeDatabaseName(databaseName);
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
