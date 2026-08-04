# P11 PostgreSQL Test Harness RED Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a test-only, disposable PostgreSQL 18 harness that turns the missing P11 persistence test into a real, observable RED without accessing an existing application database.

**Architecture:** Tests read one administrator URL from `LIANBAN_TEST_POSTGRES_ADMIN_URL`, validate it before constructing a PostgreSQL client, and generate their own `lianban_p11_test_<32 hex characters>` database name. A test-only `pg` adapter supplies the minimal `exec`/parameter-query/callback-transaction interface used by the migration runner; every target pool is closed before the maintenance connection terminates sessions and drops only the generated database.

**Tech Stack:** TypeScript 5.9, Vitest 3.2, Node.js 24, PostgreSQL 18, `pg`, existing append-only SQL migrations `001` through `010`.

**Authorization boundary:** This plan changes only `packages/database/**`, `package-lock.json`, and this engineering plan. It does not add migration `011`, a P11 repository implementation, a successful record write, an API persistence route, a professional schema, or any external environment. Do not stage, commit, push, deploy, or print a connection URL or password.

---

## File Map

- Create `packages/database/test/postgres-test-harness.spec.ts`: executable safety, migration, and cleanup contract for a real local PostgreSQL instance.
- Create `packages/database/test/support/postgres-test-harness.ts`: URL/name guards, test-only `pg` adapter, isolated database lifecycle, and cleanup.
- Create `packages/database/test/record-repository.spec.ts`: intentional P11 RED proving that the repository module is not implemented, so the requested path cannot report "No test files".
- Modify `packages/database/src/migrate.ts`: replace the concrete `PGlite` parameter type with the narrow structural migration executor used by both PGlite and the test-only adapter; preserve behavior.
- Modify `packages/database/package.json`: add test-only `pg` and `@types/pg` development dependencies.
- Modify `package-lock.json`: record the workspace dependency resolution produced by npm.

## Task 1: Establish The Harness Safety RED

**Files:**
- Create: `packages/database/test/postgres-test-harness.spec.ts`
- Test: `packages/database/test/postgres-test-harness.spec.ts`

- [ ] **Step 1: Write the failing guard contract**

Create the test with a missing test-support import so it fails for the intended reason before any PostgreSQL connection can be made:

```ts
import { describe, expect, it } from 'vitest';

import {
  assertSafePostgresAdminUrl,
  isSafePostgresTestDatabaseName,
} from './support/postgres-test-harness.js';

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
```

- [ ] **Step 2: Run the exact file and observe RED**

Run from `D:\project\Fittness project`:

```powershell
npx vitest run packages/database/test/postgres-test-harness.spec.ts
```

Expected: one test file is discovered and the run fails because `./support/postgres-test-harness.js` does not exist. A zero-test result is not acceptable evidence.

## Task 2: Add The Narrow Migration Executor Port

**Files:**
- Modify: `packages/database/src/migrate.ts`
- Test: `packages/database/test/migration.spec.ts`

- [ ] **Step 1: Generalize only the migration input type**

Replace the `PGlite` import and concrete function arguments with this structural port, leaving migration ordering and SQL unchanged:

```ts
export type MigrationConnection = {
  exec(sql: string): Promise<unknown>;
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
};

export type MigrationDatabase = MigrationConnection & {
  transaction<Result>(
    run: (connection: MigrationConnection) => Promise<Result>,
  ): Promise<Result>;
};

export async function applyMigrations(database: MigrationDatabase): Promise<void> {
  await applyMigrationsThrough(database, migrations.at(-1)!.version);
}

export async function applyMigrationsThrough(
  database: MigrationDatabase,
  targetVersion: MigrationVersion,
): Promise<void> {
  // Retain migration lookup and ordering; run each new migration in database.transaction().
}
```

Replace the explicit `BEGIN`/`COMMIT`/`ROLLBACK` block with:

```ts
await database.transaction(async (transaction) => {
  await transaction.exec(sql);
  await transaction.query(
    'INSERT INTO public.schema_migration (version) VALUES ($1)',
    [migration.version],
  );
});
```

Do not add a runtime PostgreSQL configuration path or change `PGlitePlanRepository`.

- [ ] **Step 2: Prove the PGlite path did not regress**

Run:

```powershell
npx vitest run packages/database/test/migration.spec.ts
npm run typecheck --workspace @lianban/database
```

Expected: the existing migration file reports 13 passing tests, and typecheck exits successfully. If TypeScript rejects `PGlite` structurally, narrow `params` to the smallest type accepted by both clients; do not use a whole-object cast to `PGlite`.

## Task 3: Add Test-Only PostgreSQL Dependencies

**Files:**
- Modify: `packages/database/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the client only in the database workspace development scope**

Run:

```powershell
npm install --save-dev --workspace @lianban/database pg @types/pg
```

Expected: `packages/database/package.json` gains `devDependencies` entries for `pg` and `@types/pg`; the root lockfile changes. No credentials are needed or read by this command.

- [ ] **Step 2: Inspect dependency scope**

Run:

```powershell
npm ls pg @types/pg --workspace @lianban/database
git diff -- packages/database/package.json package-lock.json
```

Expected: both packages resolve under `@lianban/database`; no application workspace manifest changes.

## Task 4: Implement The Disposable Harness

**Files:**
- Create: `packages/database/test/support/postgres-test-harness.ts`
- Modify: `packages/database/test/postgres-test-harness.spec.ts`
- Test: `packages/database/test/postgres-test-harness.spec.ts`

- [ ] **Step 1: Implement URL and database-name guards before connection construction**

The support module must expose these contracts:

```ts
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import {
  applyMigrations,
  type MigrationConnection,
  type MigrationDatabase,
} from '../../src/migrate.js';

const TEST_DATABASE_NAME = /^lianban_p11_test_[0-9a-f]{32}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

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

function generateDatabaseName(): string {
  return `lianban_p11_test_${randomUUID().replaceAll('-', '')}`;
}
```

Every create, target URL construction, termination, and drop call must repeat `isSafePostgresTestDatabaseName(name)` immediately before using the name. SQL identifiers cannot be parameters, so quote only the internally generated, regex-validated identifier.

- [ ] **Step 2: Implement a same-client migration adapter**

Implement a connection wrapper and a pool-backed callback transaction. The transaction must check out exactly one client, issue `BEGIN`, run the callback through that client, commit on success, roll back on failure, and always release the client:

```ts
class PgMigrationConnection implements MigrationConnection {
  constructor(private readonly client: PoolClient) {}

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async query<Row>(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    const result = await this.client.query<QueryResultRow>(sql, params);
    return { rows: result.rows as Row[] };
  }
}

class PgMigrationDatabase implements MigrationDatabase {
  constructor(private readonly pool: Pool) {}

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async query<Row>(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    const result = await this.pool.query<QueryResultRow>(sql, params);
    return { rows: result.rows as Row[] };
  }

  async transaction<Result>(
    run: (connection: MigrationConnection) => Promise<Result>,
  ): Promise<Result> {
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
```

- [ ] **Step 3: Implement lifecycle and guaranteed cleanup**

Expose a callback API so callers cannot forget normal cleanup:

```ts
export type IsolatedPostgresTestDatabase = {
  databaseName: string;
  pool: Pool;
};

export async function withIsolatedPostgresTestDatabase<Result>(
  rawAdminUrl: string,
  run: (database: IsolatedPostgresTestDatabase) => Promise<Result>,
): Promise<Result>;
```

Implementation order must be:

1. Validate `rawAdminUrl` and generate plus validate the target name.
2. Construct the maintenance pool only after validation.
3. Issue `CREATE DATABASE` for the validated identifier.
4. Derive a target URL by changing only `pathname` to the generated database.
5. Construct a target pool and apply migrations through `PgMigrationDatabase`; its callback transaction binds each migration to one checked-out client.
6. Invoke the test callback with the target pool and generated name.
7. In `finally`, end the target pool, parameter-query `pg_stat_activity` to terminate only sessions whose `datname` equals the generated name, issue `DROP DATABASE` for the revalidated quoted identifier, and end the maintenance pool.

Track whether creation succeeded so setup failures do not attempt to drop a database that was never created. Never include `rawAdminUrl`, `url.href`, username, or password in errors or logs. Let cleanup errors fail the test.

Implement the lifecycle with this structure; the name assertion immediately precedes every identifier-bearing statement:

```ts
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

export async function withIsolatedPostgresTestDatabase<Result>(
  rawAdminUrl: string,
  run: (database: IsolatedPostgresTestDatabase) => Promise<Result>,
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
    requireSafeDatabaseName(databaseName);
    targetPool = new Pool({ connectionString: targetUrl(adminUrl, databaseName) });
    await applyMigrations(new PgMigrationDatabase(targetPool));
    return await run({ databaseName, pool: targetPool });
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
```

- [ ] **Step 4: Extend the test with real PostgreSQL migration and cleanup cases**

Append environment-gated tests:

```ts
const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

describe.runIf(Boolean(adminUrl))('P11 isolated PostgreSQL lifecycle', () => {
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
});
```

- [ ] **Step 5: Verify unit safety without any database environment variable**

Run in a PowerShell session where the harness variable is absent:

```powershell
Remove-Item Env:LIANBAN_TEST_POSTGRES_ADMIN_URL -ErrorAction SilentlyContinue
npx vitest run packages/database/test/postgres-test-harness.spec.ts
```

Expected: guard tests pass and integration tests are explicitly skipped. No database is created.

- [ ] **Step 6: Verify against the authorized local server**

The user sets the value privately in the same PowerShell session; do not paste it into chat, a file, shell history generated by the agent, or test output:

```powershell
$env:LIANBAN_TEST_POSTGRES_ADMIN_URL = 'postgresql://<local-test-admin>:<password>@127.0.0.1:5432/postgres'
npx vitest run packages/database/test/postgres-test-harness.spec.ts
```

Expected: all guard and integration tests pass. Test output contains no connection URL or password. The database exists only during each callback and is absent afterward.

## Task 5: Create The Intentional P11 Repository RED

**Files:**
- Create: `packages/database/test/record-repository.spec.ts`
- Test: `packages/database/test/record-repository.spec.ts`

- [ ] **Step 1: Add a dynamic missing-module RED without breaking package typecheck**

Use a computed module path so TypeScript can typecheck the current authorized tree while Vitest proves the implementation is absent at runtime:

```ts
import { describe, expect, it } from 'vitest';

import { withIsolatedPostgresTestDatabase } from './support/postgres-test-harness.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

describe.runIf(Boolean(adminUrl))('P11 record repository PostgreSQL RED', () => {
  it('requires the still-unimplemented record repository after real migrations apply', async () => {
    await withIsolatedPostgresTestDatabase(adminUrl!, async () => {
      const repositoryModulePath = ['../src', 'record-repository.js'].join('/');
      const repositoryModule = await import(repositoryModulePath) as Record<string, unknown>;
      expect(repositoryModule.P11RecordRepository).toBeTypeOf('function');
    });
  });
});
```

This is a sentinel RED only. Do not add `record-repository.ts`, migration `011`, tables, successful write assertions, or API wiring in this task.

- [ ] **Step 2: Run the exact requested path and observe the correct RED**

With `LIANBAN_TEST_POSTGRES_ADMIN_URL` still set, run:

```powershell
npx vitest run packages/database/test/record-repository.spec.ts
```

Expected: Vitest discovers one file and one test; released migrations first apply in a disposable database, then the test fails because `packages/database/src/record-repository.js` is absent. Cleanup still drops the generated database. "No test files" or a connection/configuration error is not acceptable RED evidence.

## Task 6: Verify Scope And Preserve Baselines

**Files:**
- Verify: `packages/database/src/migrate.ts`
- Verify: `packages/database/test/support/postgres-test-harness.ts`
- Verify: `packages/database/test/postgres-test-harness.spec.ts`
- Verify: `packages/database/test/record-repository.spec.ts`
- Verify: `packages/database/package.json`
- Verify: `package-lock.json`

- [ ] **Step 1: Run build and unchanged released-migration baseline**

```powershell
npm run build --workspace @lianban/database
npm run typecheck --workspace @lianban/database
npx vitest run packages/database/test/migration.spec.ts
```

Expected: build and typecheck pass; migration baseline remains 13 passing tests.

- [ ] **Step 2: Re-run the authorized harness and expected RED separately**

```powershell
npx vitest run packages/database/test/postgres-test-harness.spec.ts
npx vitest run packages/database/test/record-repository.spec.ts
```

Expected: harness suite passes; repository suite fails only on the missing P11 repository and cleans up its database.

- [ ] **Step 3: Audit the diff and prohibited surface**

Run the absence checks separately because an `rg` no-match exits with code 1:

```powershell
git diff --check
git status --short
rg -n "consumer_analysis|consumer_spend" packages/database/src packages/database/test
rg --files packages/database/migrations | Select-String '011'
git diff --name-only -- packages/database package-lock.json docs/engineering/plans/2026-07-27-p11-postgres-test-harness-red-plan.md
```

Expected: `git diff --check` is clean; any database-name hits occur only in rejection tests; no `011` migration exists; the task-owned diff is limited to the file map above. Existing unrelated dirty-worktree entries remain untouched.

- [ ] **Step 4: Stop at RED**

Report the harness pass, the exact expected missing-module RED, cleanup evidence, and any skipped checks. Do not convert the repository test to GREEN until a later high-risk review authorizes the lock order, transaction revalidation contract, keyed fingerprint contract, migration `011`, and minimal repository scope.
