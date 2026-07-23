import { afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { buildApplication } from '../src/application.js';
import { createOpenApiDocument } from '../src/openapi.js';

describe('OpenAPI contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('describes stable readiness and demo fixture contracts', async () => {
    app = await buildApplication({
      nodeEnv: 'test',
      port: 3000,
      databasePath: 'memory://',
      demoMode: true,
      professionalRulesApproved: false,
    });

    const document = createOpenApiDocument(app);
    const serialized = JSON.stringify(document);

    expect(document.paths).toHaveProperty('/api/v1/readiness');
    expect(document.paths).toHaveProperty('/api/v1/demo/personas/{fixtureId}');
    expect(document.paths).toHaveProperty('/api/v1/plan-versions');
    expect(document.paths).toHaveProperty('/api/v1/plan-versions/{id}/transitions');
    expect(document.paths).toHaveProperty('/api/v1/users/{userId}/plans/current');
    expect(document.paths).toHaveProperty('/api/v1/users/{userId}/plans/history');
    expect(serialized).toContain('PROFESSIONAL_RULES_UNAPPROVED');
    expect(serialized).toContain('persona_fat_loss');
    expect(serialized).toContain('persona_muscle_gain');
    expect(serialized).toContain('DEMO_UNREVIEWED');
    expect(serialized).toContain('PENDING_CONFIRMATION');
    expect(serialized).toContain('CONFIRMATION_TIMED_OUT');
    expect(serialized).toContain('PLAN_GAP');
    expect(serialized).toContain('SINGLE_PENDING_VERSION_REQUIRED');
    expect(serialized).not.toMatch(/password|secret|token/i);
    expect(serialized).not.toMatch(/calorie|exercise|threshold|meal/i);
  });
});
