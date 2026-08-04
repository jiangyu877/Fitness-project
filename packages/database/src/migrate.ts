import { readFile } from 'node:fs/promises';

export type MigrationConnection = {
  exec(sql: string): Promise<unknown>;
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
};

export type MigrationDatabase = MigrationConnection & {
  transaction<Result>(
    run: (connection: MigrationConnection) => Promise<Result>,
  ): Promise<Result>;
};

const migrations = [
  {
    version: '001_core',
    file: '001_core.sql',
  },
  {
    version: '002_plan_lifecycle_guards',
    file: '002_plan_lifecycle_guards.sql',
  },
  {
    version: '003_plan_repository',
    file: '003_plan_repository.sql',
  },
  {
    version: '004_plan_repository_integrity',
    file: '004_plan_repository_integrity.sql',
  },
  {
    version: '005_identity_onboarding',
    file: '005_identity_onboarding.sql',
  },
  {
    version: '006_identity_security_hardening',
    file: '006_identity_security_hardening.sql',
  },
  {
    version: '007_identity_audit_outcomes',
    file: '007_identity_audit_outcomes.sql',
  },
  {
    version: '008_identity_recovery_sessions',
    file: '008_identity_recovery_sessions.sql',
  },
  {
    version: '009_plan_lifecycle_persistence',
    file: '009_plan_lifecycle_persistence.sql',
  },
  {
    version: '010_p07_safe_structure',
    file: '010_p07_safe_structure.sql',
  },
  {
    version: '011_p11_record_persistence',
    file: '011_p11_record_persistence.sql',
  },
] as const;

export type MigrationVersion = (typeof migrations)[number]['version'];

export async function applyMigrations(database: MigrationDatabase): Promise<void> {
  await applyMigrationsThrough(database, migrations.at(-1)!.version);
}

export async function applyMigrationsThrough(
  database: MigrationDatabase,
  targetVersion: MigrationVersion,
): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS public.schema_migration (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const targetIndex = migrations.findIndex((migration) => migration.version === targetVersion);
  if (targetIndex < 0) throw new Error(`UNKNOWN_MIGRATION_VERSION:${targetVersion}`);

  for (const migration of migrations.slice(0, targetIndex + 1)) {
    const existing = await database.query<{ version: string }>(
      'SELECT version FROM public.schema_migration WHERE version = $1',
      [migration.version],
    );
    if (existing.rows.length > 0) {
      continue;
    }

    const sql = await readMigration(migration.file);
    await database.transaction(async (transaction) => {
      await transaction.exec(sql);
      await transaction.query(
        'INSERT INTO public.schema_migration (version) VALUES ($1)',
        [migration.version],
      );
    });
  }
}

async function readMigration(file: string): Promise<string> {
  try {
    return await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
  }
}
