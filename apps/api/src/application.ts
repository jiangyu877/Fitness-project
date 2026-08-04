import 'reflect-metadata';
import { BaseExceptionFilter, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { Environment } from './config/environment.js';
import { setupOpenApi } from './openapi.js';
import type { AuthSecurityPolicy } from '@lianban/domain';
import type { MfaVerifier } from './identity/mfa-verifier.js';
import type { CurrentConsentVersionProvider } from './identity/current-consent-version.js';
import { validConsent, validProfileSchema, type CurrentConsentProvider, type ProfileSchemaProvider, type ScreeningApprovalProvider } from './identity/p07-providers.js';
import type { PlanLifecycleClock } from './plans/plan-lifecycle.service.js';
import { ROUTE_ACCESS_SNAPSHOT, isClassifiedProtectedRoute, isProtectedRoute, type RouteAccessSnapshot } from './readiness/route-access.js';
import { DatabaseService } from './database/database.service.js';
import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import { freezeRecordSchema, validRecordSchema, type RecordSchemaProvider } from './records/p11-record-schema.provider.js';
import type { P11RecordRepositoryPort } from './records/p11-record-repository.port.js';
import type { P11RecordContextPort } from './records/p11-record-context.port.js';

type MiddlewareRequest = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};
type MiddlewareResponse = { status(statusCode: number): { json(body: unknown): void } };
type MiddlewareNext = () => void;

export async function buildApplication(environment: Environment, options?: { authPolicy?: AuthSecurityPolicy; mfaVerifier?: MfaVerifier; profileFingerprintSecret?: string; currentConsentVersion?: CurrentConsentVersionProvider; consentProvider?: CurrentConsentProvider; screeningProvider?: ScreeningApprovalProvider; profileSchemaProvider?: ProfileSchemaProvider; recordSchemaProvider?: RecordSchemaProvider; recordRepository?: P11RecordRepositoryPort; recordContext?: P11RecordContextPort; routeAccessSnapshot?: RouteAccessSnapshot; planClock?: PlanLifecycleClock }) {
  const consentProvider = await pinConsentProvider(environment, options?.consentProvider);
  const currentConsentVersion = consentProvider
    ? { getCurrentConsentVersion: async () => (await consentProvider.getCurrentConsent()).version }
    : await pinCurrentConsentVersion(options?.currentConsentVersion);
  const profileSchemaProvider = await pinProfileSchemaProvider(environment, options?.profileSchemaProvider);
  const recordSchemaProvider = await pinRecordSchemaProvider(environment, options?.recordSchemaProvider);
  const screeningProvider = environment.nodeEnv === 'test' ? options?.screeningProvider ?? null : null;
  const recordRepository = environment.nodeEnv === 'test' ? options?.recordRepository ?? null : null;
  const recordContext = environment.nodeEnv === 'test' ? options?.recordContext ?? null : null;
  const app = await NestFactory.create(AppModule.forEnvironment(environment, options?.authPolicy ?? null, options?.mfaVerifier ?? null, options?.profileFingerprintSecret ?? null, currentConsentVersion, options?.routeAccessSnapshot ?? null, options?.planClock, consentProvider, screeningProvider, profileSchemaProvider, recordSchemaProvider, recordRepository, recordContext), {
    logger: false,
  });
  app.useGlobalFilters(new StableSecurityErrorFilter(app.getHttpAdapter()));
  const snapshot = app.get<RouteAccessSnapshot>(ROUTE_ACCESS_SNAPSHOT);
  const database = app.get(DatabaseService).database;
  app.use(async (req: MiddlewareRequest, res: MiddlewareResponse, next: MiddlewareNext) => {
    const path = req.path as string;
    const method = req.method as string;
    if (!isProtectedRoute(method, path)) return next();
    if (snapshot.allowProtectedRoutes && isClassifiedProtectedRoute(method, path)) return next();
    const requestId = typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : randomUUID();
    await database.query(
      `INSERT INTO audit.audit_event
         (id, actor_id, actor_role, action, subject_type, subject_id, request_id, outcome, error_code)
       VALUES ($1, NULL, 'SYSTEM', 'ROUTE_ACCESS_REJECTED', 'ROUTE', $2, $3, 'REJECTED', 'ROUTE_ACCESS_NOT_APPROVED')`,
      [randomUUID(), `${method.toUpperCase()} ${path}`, requestId],
    );
    return res.status(503).json({
      businessStatus: 'IDENTITY_BLOCKED',
      errorCode: 'ROUTE_ACCESS_NOT_APPROVED',
      recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
      clientStateDisposition: 'CLEAR_ALL',
      requestId,
    });
  });
  setupOpenApi(app);
  await app.init();
  return app;
}

async function pinConsentProvider(environment: Environment, provider?: CurrentConsentProvider): Promise<CurrentConsentProvider | null> {
  if (environment.nodeEnv !== 'test' || !provider) return null;
  try {
    const consent = await provider.getCurrentConsent();
    if (!validConsent(consent)) return null;
    const snapshot = Object.freeze({
      version: consent.version,
      content: Object.freeze({ format: consent.content.format, text: consent.content.text }),
    });
    return { getCurrentConsent: async () => snapshot };
  } catch { return null; }
}

async function pinProfileSchemaProvider(environment: Environment, provider?: ProfileSchemaProvider): Promise<ProfileSchemaProvider | null> {
  if (environment.nodeEnv !== 'test' || !provider) return null;
  try {
    const schema = await provider.getApprovedProfileSchema();
    if (!validProfileSchema(schema)) return null;
    const steps = schema.steps.map((step) => Object.freeze({
      id: step.id,
      fields: Object.freeze(step.fields.map((field) => Object.freeze({
        name: field.name,
        type: field.type,
        ...(field.required === undefined ? {} : { required: field.required }),
      }))),
    }));
    const snapshot = Object.freeze({ version: schema.version, steps: Object.freeze(steps) });
    return { getApprovedProfileSchema: async () => snapshot };
  } catch { return null; }
}

async function pinRecordSchemaProvider(environment: Environment, provider?: RecordSchemaProvider): Promise<RecordSchemaProvider | null> {
  if (environment.nodeEnv !== 'test' || !provider) return null;
  try {
    const schema = await provider.getApprovedRecordSchema();
    if (!schema.testOnly || !validRecordSchema(schema)) return null;
    const snapshot = freezeRecordSchema(schema);
    return { getApprovedRecordSchema: async () => snapshot };
  } catch { return null; }
}

@Catch(HttpException)
export class StableSecurityErrorFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const request = host.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const output = normalizeStableSecurityError(status, response, request.headers['x-request-id'] ?? randomUUID());
    if (!output) return super.catch(exception, host);
    host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>()
      .status(status).json(output);
  }
}

export function normalizeStableSecurityError(
  status: number,
  response: unknown,
  fallbackRequestId: string,
): Record<string, unknown> | null {
  if (status !== 401 && status !== 403 && status !== 503) return null;
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || Object.getPrototypeOf(response) !== Object.prototype) return null;
  const value = response as Record<string, unknown>;
  if (typeof value.businessStatus !== 'string' || typeof value.errorCode !== 'string'
    || !Array.isArray(value.recoverableActions)
    || !value.recoverableActions.every((item) => typeof item === 'string')) return null;
  return {
    businessStatus: value.businessStatus,
    errorCode: value.errorCode,
    recoverableActions: value.recoverableActions,
    ...(typeof value.clientStateDisposition === 'string' ? { clientStateDisposition: value.clientStateDisposition } : {}),
    requestId: typeof value.requestId === 'string' ? value.requestId : fallbackRequestId,
  };
}

async function pinCurrentConsentVersion(provider?: CurrentConsentVersionProvider): Promise<CurrentConsentVersionProvider | null> {
  if (!provider) return null;
  try {
    const version = (await provider.getCurrentConsentVersion()).trim();
    return version ? { getCurrentConsentVersion: async () => version } : null;
  } catch {
    return null;
  }
}
