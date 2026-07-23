import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '../src/config/environment.js';

describe('parseEnvironment', () => {
  it('rejects demo mode outside development or test', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'production',
        DATABASE_PATH: '.local/prod',
        DEMO_MODE: 'true',
      }),
    ).toThrow(/DEMO_MODE/);
  });

  it('requires an explicit local database path', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'test' })).toThrow(/DATABASE_PATH/);
  });

  it('parses a safe test environment', () => {
    expect(
      parseEnvironment({
        NODE_ENV: 'test',
        DATABASE_PATH: 'memory://',
        DEMO_MODE: 'true',
        PROFESSIONAL_RULES_APPROVED: 'false',
      }),
    ).toEqual({
      nodeEnv: 'test',
      port: 3000,
      databasePath: 'memory://',
      demoMode: true,
      professionalRulesApproved: false,
    });
  });
});
