import { openDatabase } from './database.js';
import { prepareDatabasePath, resolveDatabasePath } from './database-path.js';
import { applyMigrations } from './migrate.js';

const databasePath = process.env.DATABASE_PATH?.trim();
if (!databasePath) {
  throw new Error('DATABASE_PATH is required');
}

const resolvedPath = resolveDatabasePath(
  databasePath,
  process.env.INIT_CWD ?? process.cwd(),
);
prepareDatabasePath(resolvedPath);

const database = openDatabase(resolvedPath);
try {
  await applyMigrations(database);
  console.log(`Database migrations applied: ${resolvedPath}`);
} finally {
  await database.close();
}
