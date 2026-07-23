import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const migrations = [
  {
    version: '001_core',
    url: new URL('../migrations/001_core.sql', import.meta.url),
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

    const sql = await readFile(migration.url, 'utf8');
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
