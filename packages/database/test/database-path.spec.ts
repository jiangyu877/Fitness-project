import { describe, expect, it } from 'vitest';
import { resolveDatabasePath } from '../src/database-path.js';

describe('database path resolution', () => {
  it('resolves a relative path from the command invocation directory', () => {
    expect(resolveDatabasePath('.local/lianban-data', 'D:/project/lianban')).toBe(
      'D:\\project\\lianban\\.local\\lianban-data',
    );
  });

  it('preserves memory databases', () => {
    expect(resolveDatabasePath('memory://', 'D:/project/lianban')).toBe('memory://');
  });
});
