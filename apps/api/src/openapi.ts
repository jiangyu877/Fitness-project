import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Lianban V1.0 API')
    .setDescription('Stable engineering contract through the identity and onboarding slice')
    .setVersion('0.4.0')
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createOpenApiDocument(app), {
    jsonDocumentUrl: 'openapi.json',
  });
}
