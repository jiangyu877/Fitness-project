import type { AuthSecurityPolicy } from '@lianban/domain';
import {
  P11RecordContextRepository,
  P11RecordRepository,
  P11RecordRepositoryError,
  type P11RecordSchema,
  type P11UpsertInput,
} from '@lianban/database';
import type { Pool } from 'pg';

import { buildApplication as buildProductionApplication } from '../src/application.js';
import type { Environment } from '../src/config/environment.js';
import type { CurrentConsentVersionProvider } from '../src/identity/current-consent-version.js';
import type { MfaVerifier } from '../src/identity/mfa-verifier.js';
import type { PlanLifecycleClock } from '../src/plans/plan-lifecycle.service.js';
import type { CurrentConsentProvider, ProfileSchemaProvider, ScreeningApprovalProvider } from '../src/identity/p07-providers.js';
import { createRouteAccessSnapshot, type RouteAccessSnapshot } from '../src/readiness/route-access.js';
import type { RecordSchemaProvider } from '../src/records/p11-record-schema.provider.js';
import { validRecordSchema } from '../src/records/p11-record-schema.provider.js';
import type { P11RecordPortSchema } from '../src/records/p11-record-repository.port.js';
import type { P11RecordRepositoryPort } from '../src/records/p11-record-repository.port.js';
import type { P11RecordContextPort } from '../src/records/p11-record-context.port.js';

type TestApplicationOptions = {
  authPolicy?: AuthSecurityPolicy;
  mfaVerifier?: MfaVerifier;
  profileFingerprintSecret?: string;
  currentConsentVersion?: CurrentConsentVersionProvider;
  routeAccessSnapshot?: RouteAccessSnapshot;
  planClock?: PlanLifecycleClock;
  consentProvider?: CurrentConsentProvider;
  screeningProvider?: ScreeningApprovalProvider;
  profileSchemaProvider?: ProfileSchemaProvider;
  recordSchemaProvider?: RecordSchemaProvider;
  recordRepository?: P11RecordRepositoryPort;
  recordRepositoryPool?: Pool;
  recordContext?: P11RecordContextPort;
  recordContextPool?: Pool;
};

export function buildApplication(environment: Environment, options: TestApplicationOptions = {}) {
  const { recordContextPool, recordRepositoryPool, ...productionOptions } = options;
  const recordRepository = options.recordRepository
    ?? (recordRepositoryPool ? createRecordRepositoryAdapter(recordRepositoryPool) : undefined);
  const recordContext = options.recordContext
    ?? (recordContextPool ? createRecordContextAdapter(recordContextPool) : undefined);
  const contextOptions = recordContext ? { recordContext } : {};
  const repositoryOptions = recordRepository ? { recordRepository } : {};
  const routeAccessSnapshot = options.routeAccessSnapshot ?? createRouteAccessSnapshot({
    environment,
    audience: 'TEST',
    authPolicyAvailable: true,
    mfaVerifierAvailable: true,
    hmacKeyAvailable: true,
    currentConsentVersionAvailable: true,
    approvedConsentProviderAvailable: Boolean(options.consentProvider),
    screeningApprovalProviderAvailable: Boolean(options.screeningProvider),
    profileSchemaProviderAvailable: Boolean(options.profileSchemaProvider),
  });
  return buildProductionApplication(environment, {
    ...productionOptions,
    ...repositoryOptions,
    ...contextOptions,
    routeAccessSnapshot,
  });
}

function createRecordRepositoryAdapter(pool: Pool): P11RecordRepositoryPort {
  const repository = new P11RecordRepository(pool, {
    activeKeyId: 'test-key-v1',
    keys: new Map([['test-key-v1', Buffer.from('fictional-p11-active-key-material')]]),
  });
  return {
    upsert: async (input) => {
      const databaseInput: P11UpsertInput = {
        sessionTokenHash: input.sessionTokenHash,
        taskId: input.taskId,
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
        nodeEnv: input.nodeEnv,
        schema: toDatabaseRecordSchema(input.schema),
        command: {
          operation: input.command.operation,
          recordKindId: input.command.recordKindId,
          schemaVersion: input.command.schemaVersion,
          expectedRecordVersion: input.command.expectedRecordVersion,
          entries: input.command.entries.map((entry) => ({
            fieldId: entry.fieldId,
            valueType: entry.valueType,
            value: entry.value,
          })),
        },
      };
      try {
        return { ok: true, value: await repository.upsert(databaseInput) };
      } catch (error) {
        if (error instanceof P11RecordRepositoryError) {
          return { ok: false, error: { code: error.code } };
        }
        throw error;
      }
    },
  };
}

function createRecordContextAdapter(pool: Pool): P11RecordContextPort {
  const repository = new P11RecordContextRepository(pool);
  return {
    getContext: (input, schema) => repository.getContext(input, toDatabaseRecordSchema(schema)),
  };
}

export function toDatabaseRecordSchema(schema: unknown): P11RecordSchema {
  if (!validRecordSchema(schema)) throw new Error('RECORD_SCHEMA_INVALID');
  return {
    version: schema.version,
    testOnly: true,
    approvedForRealUsers: false,
    recordKinds: schema.recordKinds.map((kind) => ({
      id: kind.id,
      fields: kind.fields.map((field) => ({
        id: field.id,
        valueType: field.valueType,
        ...(field.required === undefined ? {} : { required: field.required }),
      })),
      allowedActions: ['UPSERT_RECORD'] as ['UPSERT_RECORD'],
    })),
  };
}

export type PostgresCleanupSteps = {
  closeTarget: () => Promise<unknown>;
  terminateTarget: () => Promise<unknown>;
  dropTarget: () => Promise<unknown>;
  closeMaintenance: () => Promise<unknown>;
};

export async function cleanupPostgresResources(steps: PostgresCleanupSteps): Promise<void> {
  const errors: unknown[] = [];
  for (const step of [steps.closeTarget, steps.terminateTarget, steps.dropTarget, steps.closeMaintenance]) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'POSTGRES_TEST_DATABASE_CLEANUP_FAILED');
}
