import { PGlite } from '@electric-sql/pglite';

export function openDatabase(path: string): PGlite {
  return path === 'memory://' ? new PGlite() : new PGlite(path);
}
