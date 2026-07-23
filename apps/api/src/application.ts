import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { Environment } from './config/environment.js';
import { setupOpenApi } from './openapi.js';

export async function buildApplication(environment: Environment) {
  const app = await NestFactory.create(AppModule.forEnvironment(environment), {
    logger: false,
  });
  setupOpenApi(app);
  await app.init();
  return app;
}
