import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export function resolveDatabasePath(path: string, invocationDirectory: string): string {
  if (path === 'memory://' || isAbsolute(path)) {
    return path;
  }
  return resolve(invocationDirectory, path);
}

export function prepareDatabasePath(path: string): void {
  if (path !== 'memory://') {
    mkdirSync(dirname(path), { recursive: true });
  }
}
