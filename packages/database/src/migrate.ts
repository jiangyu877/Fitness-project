import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

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
] as const;

export async function applyMigrations(database: PGlite): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS public.schema_migration (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of migrations) {
    const existing = await database.query<{ version: string }>(
      'SELECT version FROM public.schema_migration WHERE version = $1',
      [migration.version],
    );
    if (existing.rows.length > 0) {
      continue;
    }

    const sql = await readMigration(migration.file);
    await database.exec('BEGIN');
    try {
      await database.exec(sql);
      await database.query(
        'INSERT INTO public.schema_migration (version) VALUES ($1)',
        [migration.version],
      );
      await database.exec('COMMIT');
    } catch (error) {
      await database.exec('ROLLBACK');
      throw error;
    }
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
