import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApplication } from '../src/application.js';
import type { Environment } from '../src/config/environment.js';

const baseEnvironment: Environment = {
  nodeEnv: 'test',
  port: 3000,
  databasePath: 'memory://',
  demoMode: true,
  professionalRulesApproved: false,
};

describe('phase 1 HTTP API contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reports health without exposing configuration', async () => {
    app = await buildApplication(baseEnvironment);

    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('reports stable readiness blockers while professional rules are unsigned', async () => {
    app = await buildApplication(baseEnvironment);

    await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .expect(200)
      .expect({
        readyForRealUsers: false,
        blockers: ['PROFESSIONAL_RULES_UNAPPROVED'],
      });
  });

  it.each([
    ['persona_fat_loss', 'FAT_LOSS'],
    ['persona_muscle_gain', 'MUSCLE_GAIN'],
  ] as const)('serves protected demo fixture %s', async (fixtureId, goalType) => {
    app = await buildApplication(baseEnvironment);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/demo/personas/${fixtureId}`)
      .expect(200);

    expect(response.body).toEqual({
      fixtureId,
      goalType,
      demoOnly: true,
      reviewStatus: 'DEMO_UNREVIEWED',
      publishable: false,
      disclaimer: '仅用于原型演示，未经专业审核',
    });
  });

  it('returns not found for an unknown fixture', async () => {
    app = await buildApplication(baseEnvironment);

    await request(app.getHttpServer())
      .get('/api/v1/demo/personas/unknown')
      .expect(404);
  });

  it('does not register demo routes when demo mode is disabled', async () => {
    app = await buildApplication({ ...baseEnvironment, demoMode: false });

    await request(app.getHttpServer())
      .get('/api/v1/demo/personas/persona_fat_loss')
      .expect(404);
  });
});
