import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { Environment } from './config/environment.js';
import { setupOpenApi } from './openapi.js';
import type { AuthSecurityPolicy } from '@lianban/domain';
import type { MfaVerifier } from './identity/mfa-verifier.js';

export async function buildApplication(environment: Environment, options?: { authPolicy?: AuthSecurityPolicy; mfaVerifier?: MfaVerifier }) {
  const app = await NestFactory.create(AppModule.forEnvironment(environment, options?.authPolicy ?? null, options?.mfaVerifier ?? null), {
    logger: false,
  });
  setupOpenApi(app);
  await app.init();
  return app;
}
