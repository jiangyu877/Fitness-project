import {
  Body,
  Controller,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { RECORD_SCHEMA, type RecordSchemaProvider } from './p11-record-schema.provider.js';
import { IdentityOnboardingService } from '../identity/identity-onboarding.service.js';
import { createHash, randomUUID } from 'node:crypto';
import { ENVIRONMENT } from '../readiness/readiness.controller.js';
import type { Environment } from '../config/environment.js';
import { P11_RECORD_REPOSITORY } from './p11-record-repository.token.js';
import type {
  P11RecordPersistenceInput,
  P11RecordPortSchema,
  P11RecordRepositoryPort,
} from './p11-record-repository.port.js';
import { P11_RECORD_CONTEXT } from './p11-record-context.token.js';
import type {
  P11RecordContextInput,
  P11RecordContextPort,
  P11RecordContextResult,
} from './p11-record-context.port.js';

const errorSchema = (errorCode: string, clientStateDisposition: 'CLEAR_ALL' | 'DISABLE_EDITOR' | 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT') => ({
  type: 'object',
  required: ['businessStatus', 'errorCode', 'recoverableActions', 'clientStateDisposition', 'requestId'],
  properties: {
    businessStatus: { type: 'string' },
    errorCode: { type: 'string', enum: [errorCode] },
    recoverableActions: { type: 'array', items: { type: 'string' } },
    clientStateDisposition: { type: 'string', enum: [clientStateDisposition] },
    requestId: { type: 'string' },
  },
});

const routeAccessErrorSchema = errorSchema('ROUTE_ACCESS_NOT_APPROVED', 'CLEAR_ALL');
const sessionErrorSchema = errorSchema('SESSION_INVALID', 'CLEAR_ALL');
const taskNotFoundSchema = errorSchema('RECORD_TASK_NOT_FOUND', 'CLEAR_ALL');
const versionConflictSchema = errorSchema('RECORD_VERSION_CONFLICT', 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT');
const schemaConflictSchema = errorSchema('RECORD_SCHEMA_VERSION_CONFLICT', 'CLEAR_ALL');
const idempotencyConflictSchema = errorSchema('IDEMPOTENCY_KEY_REUSED', 'CLEAR_ALL');
const stateBlockedSchema = errorSchema('RECORD_STATE_BLOCKED', 'DISABLE_EDITOR');
const scalarSchema = { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] };
const contextEntrySchema = {
  type: 'object', additionalProperties: false,
  required: ['fieldId', 'value'],
  properties: { fieldId: { type: 'string' }, value: scalarSchema },
};
const contextRecordSchema = {
  type: 'object', additionalProperties: false,
  required: ['recordId', 'recordKindId', 'recordVersion', 'schemaVersion', 'entries'],
  properties: {
    recordId: { type: 'string' }, recordKindId: { type: 'string' },
    recordVersion: { type: 'integer', minimum: 0 }, schemaVersion: { type: 'string' },
    entries: { type: 'array', items: contextEntrySchema },
  },
};
const contextFieldSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'valueType'],
  properties: {
    id: { type: 'string' }, valueType: { type: 'string', enum: ['STRING', 'NUMBER', 'BOOLEAN'] },
    required: { type: 'boolean' },
  },
};

const contextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['businessStatus', 'taskId', 'planVersion', 'businessDate', 'accessMode', 'schema', 'records'],
  properties: {
    businessStatus: { type: 'string', enum: ['RECORD_CONTEXT_AVAILABLE'] },
    taskId: { type: 'string' },
    planVersion: { type: 'string' },
    businessDate: { type: 'string' },
    accessMode: { type: 'string', enum: ['EDITABLE', 'READ_ONLY'] },
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'testOnly', 'recordKinds'],
      properties: {
        version: { type: 'string' },
        testOnly: { type: 'boolean', enum: [true] },
        recordKinds: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'fields', 'allowedActions'],
            properties: {
              id: { type: 'string' },
              fields: { type: 'array', items: contextFieldSchema },
              allowedActions: { type: 'array', items: { type: 'string', enum: ['UPSERT_RECORD'] } },
            },
          },
        },
      },
    },
    records: { type: 'array', items: contextRecordSchema },
  },
};

const commandSchema = z.object({
  operation: z.literal('UPSERT_RECORD'),
  recordKindId: z.string().trim().min(1),
  schemaVersion: z.string().trim().min(1),
  expectedRecordVersion: z.number().int().nonnegative().nullable(),
  entries: z.array(z.object({ fieldId: z.string().trim().min(1), value: z.union([z.string(), z.number().finite(), z.boolean()]) }).strict()),
}).strict();

const commandBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['operation', 'recordKindId', 'schemaVersion', 'expectedRecordVersion', 'entries'],
  properties: {
    operation: { type: 'string', enum: ['UPSERT_RECORD'] },
    recordKindId: { type: 'string' },
    schemaVersion: { type: 'string' },
    expectedRecordVersion: { type: 'integer', minimum: 0, nullable: true },
    entries: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['fieldId', 'value'], properties: { fieldId: { type: 'string' }, value: {} } } },
  },
};

const commandSuccessSchema = {
  type: 'object',
  required: ['businessStatus', 'recordVersion', 'schemaVersion', 'nextAction', 'recoverableActions'],
  properties: {
    businessStatus: { type: 'string', enum: ['RECORD_WRITE_ACCEPTED'] },
    recordVersion: { type: 'integer', minimum: 0 },
    schemaVersion: { type: 'string' },
    nextAction: { type: 'string', enum: ['GET_RECORD_CONTEXT'] },
    recoverableActions: { type: 'array', maxItems: 0, items: {} },
  },
};

@ApiTags('p11-record-safe-structure')
@ApiServiceUnavailableResponse({ description: 'Unified route access gate rejected the request', schema: routeAccessErrorSchema })
@Controller('api/v1/record-tasks')
export class RecordSafeStructureController {
  constructor(
    @Inject(RECORD_SCHEMA) private readonly recordSchemaProvider: RecordSchemaProvider | null,
    @Inject(IdentityOnboardingService) private readonly identity: IdentityOnboardingService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(P11_RECORD_REPOSITORY) private readonly recordRepository: P11RecordRepositoryPort | null,
    @Inject(P11_RECORD_CONTEXT) private readonly recordContext: P11RecordContextPort | null,
  ) {}

  @Get(':taskId/context')
  @ApiBearerAuth()
  @ApiParam({ name: 'taskId', type: 'string' })
  @ApiHeader({ name: 'x-request-id', required: true })
  @ApiOkResponse({ description: 'Test-only record context surface', schema: contextSchema })
  @ApiUnauthorizedResponse({ description: 'USER session rejected', schema: sessionErrorSchema })
  @ApiForbiddenResponse({ description: 'Non-USER session rejected' })
  @ApiNotFoundResponse({ description: 'Missing, cross-user, or unreadable task', schema: taskNotFoundSchema })
  async context(@Param('taskId') taskId: string, @Headers() headers: Record<string, string>) {
    await this.requireUser(headers);
    const rawRequestId = headers['x-request-id'];
    if (this.environment.nodeEnv !== 'test' || !this.recordContext) {
      throw this.taskNotFound(rawRequestId);
    }
    const requestId = requiredText(rawRequestId);
    if (!this.recordSchemaProvider) {
      throw this.endpointUnavailable(requestId);
    }
    const schema = await this.requireContextSchema(requestId);
    const token = bearerToken(headers.authorization);
    const input: P11RecordContextInput = Object.freeze({
      sessionTokenHash: createHash('sha256').update(token!).digest('hex'),
      taskId: requiredText(taskId),
      requestId: requiredText(requestId),
      nodeEnv: 'test',
    });
    const result = await this.recordContext.getContext(input, schema);
    return contextResponse(result, schema);
  }

  @Post(':taskId/commands')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiParam({ name: 'taskId', type: 'string' })
  @ApiHeader({ name: 'x-request-id', required: true })
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiBody({ schema: commandBodySchema })
  @ApiOkResponse({ description: 'No-persistence command success contract', schema: commandSuccessSchema })
  @ApiUnauthorizedResponse({ description: 'USER session rejected', schema: sessionErrorSchema })
  @ApiForbiddenResponse({ description: 'Non-USER session rejected' })
  @ApiNotFoundResponse({ description: 'Missing, cross-user, or unreadable task', schema: taskNotFoundSchema })
  @ApiConflictResponse({
    description: 'Version, schema, idempotency, or authoritative state conflict',
    schema: { oneOf: [versionConflictSchema, schemaConflictSchema, idempotencyConflictSchema, stateBlockedSchema] },
  })
  async command(
    @Param('taskId') taskId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string>,
  ) {
    await this.requireUser(headers);
    const rawRequestId = headers['x-request-id'];
    const requestId = rawRequestId?.trim() ? rawRequestId : randomUUID();
    if (rawRequestId === undefined || rawRequestId.trim().length === 0) throw this.requestInvalid(requestId);
    if (this.environment.nodeEnv !== 'test') throw this.endpointUnavailable(requestId);
    if (!this.recordRepository) {
      if (this.recordSchemaProvider) throw this.endpointUnavailable(requestId);
      throw this.taskNotFound(requestId);
    }
    const rawIdempotencyKey = headers['idempotency-key'];
    if (typeof rawIdempotencyKey !== 'string') throw this.requestInvalid(requestId);
    if (rawIdempotencyKey.trim().length === 0) throw this.requestInvalid(requestId);
    const idempotencyKey = requiredHeader(rawIdempotencyKey);
    const trustedTaskId = requiredText(taskId);
    const token = bearerToken(headers.authorization);
    const parsedCommand = commandSchema.safeParse(body);
    if (!parsedCommand.success) throw this.requestInvalid(requestId);
    const command = parsedCommand.data;
    const schema = await this.requireWritableSchema(requestId);
    const selectedKind = schema.recordKinds.find((kind) => kind.id === command.recordKindId);
    if (!selectedKind || !selectedKind.allowedActions.includes('UPSERT_RECORD')) {
      throw this.requestInvalid(requestId);
    }
    const selectedFields = strictSelectedFields(selectedKind.fields);
    if (!selectedFields) throw this.schemaInvalid(requestId);
    if (!hasDenseNonEmptyEntries(body)) throw this.requestInvalid(requestId);
    if (command.entries.length !== selectedFields.length) throw this.requestInvalid(requestId);
    const fieldIds = new Set<string>();
    const entries = command.entries.map((entry) => {
      const field = selectedFields.find((candidate) => candidate.id === entry.fieldId);
      if (!field || fieldIds.has(entry.fieldId) || !matchesValueType(entry.value, field.valueType)) {
        throw this.requestInvalid(requestId);
      }
      fieldIds.add(entry.fieldId);
      return Object.freeze({ fieldId: entry.fieldId, valueType: field.valueType, value: entry.value });
    });
    if (fieldIds.size !== selectedFields.length
      || selectedFields.some((field) => !fieldIds.has(field.id))) throw this.requestInvalid(requestId);
    const input: P11RecordPersistenceInput = Object.freeze({
      sessionTokenHash: createHash('sha256').update(token!).digest('hex'),
      taskId: trustedTaskId,
      idempotencyKey,
      requestId,
      nodeEnv: 'test',
      schema: schema as P11RecordPersistenceInput['schema'],
      command: Object.freeze({
        operation: command.operation,
        recordKindId: command.recordKindId,
        schemaVersion: command.schemaVersion,
        expectedRecordVersion: command.expectedRecordVersion,
        entries: Object.freeze(entries),
      }),
    });
    let outcome;
    try {
      outcome = await this.recordRepository!.upsert(input);
    } catch {
      throw this.endpointUnavailable(requestId);
    }
    if (!outcome.ok) {
      if (outcome.error.code === 'RECORD_VERSION_CONFLICT') {
        throw new ConflictException(this.error(
          'RECORD_VERSION_CONFLICT', requestId, ['REFRESH'],
          'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
        ));
      }
      if (outcome.error.code === 'RECORD_SCHEMA_VERSION_CONFLICT') {
        throw new ConflictException(this.error(
          'RECORD_SCHEMA_VERSION_CONFLICT', requestId, ['REFRESH'],
        ));
      }
      if (outcome.error.code === 'RECORD_PLAN_NOT_ACTIVE') {
        throw new ConflictException(this.error(
          'RECORD_PLAN_NOT_ACTIVE', requestId,
        ));
      }
      if (outcome.error.code === 'IDEMPOTENCY_KEY_REUSED') {
        throw new ConflictException(this.error(
          'IDEMPOTENCY_KEY_REUSED', requestId, ['USE_NEW_IDEMPOTENCY_KEY'],
        ));
      }
      if (outcome.error.code === 'RECORD_STATE_BLOCKED') {
        throw new ConflictException(this.error(
          'RECORD_STATE_BLOCKED', requestId, [], 'DISABLE_EDITOR',
        ));
      }
      if (outcome.error.code === 'RECORD_SCHEMA_UNAVAILABLE') {
        throw new ServiceUnavailableException(this.error(
          'RECORD_SCHEMA_UNAVAILABLE', requestId, ['CONTACT_OPERATIONS'],
        ));
      }
      if (outcome.error.code === 'RECORD_SCHEMA_INVALID') {
        throw new ServiceUnavailableException(this.error(
          'RECORD_SCHEMA_INVALID', requestId, ['CONTACT_OPERATIONS'],
        ));
      }
      if (outcome.error.code === 'RECORD_TASK_NOT_FOUND') {
        throw this.taskNotFound(requestId);
      }
      if (outcome.error.code === 'RECORD_REQUEST_INVALID') {
        throw new BadRequestException(this.error(
          'RECORD_REQUEST_INVALID', requestId,
        ));
      }
      throw this.endpointUnavailable(requestId);
    }
    return {
      businessStatus: 'RECORD_WRITE_ACCEPTED',
      recordVersion: outcome.value.recordVersion,
      schemaVersion: outcome.value.schemaVersion,
      nextAction: 'GET_RECORD_CONTEXT',
      recoverableActions: [],
    };
  }

  private async requireUser(headers: Record<string, string>): Promise<void> {
    void this.recordSchemaProvider;
    const requestId = headers['x-request-id'] || 'record-authorization';
    try {
      const principal = await this.identity.authorizeAnySession(bearerToken(headers.authorization), {
        requestId, idempotencyKey: 'record-authorization',
      });
      if (principal.accountType !== 'USER') {
        throw new ForbiddenException(this.error('ROLE_NOT_AUTHORIZED', requestId));
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException(this.error('SESSION_INVALID', requestId));
      }
      throw error;
    }
  }

  private taskNotFound(requestId?: string): NotFoundException {
    return new NotFoundException(this.error('RECORD_TASK_NOT_FOUND', requestId || 'record-task-read'));
  }

  private error(
    errorCode: string,
    requestId: string,
    recoverableActions: string[] = [],
    clientStateDisposition: 'CLEAR_ALL' | 'DISABLE_EDITOR' | 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT' = 'CLEAR_ALL',
  ) {
    return {
      businessStatus: 'RECORD_CONTEXT_BLOCKED', errorCode, recoverableActions,
      clientStateDisposition, requestId,
    };
  }

  private async requireWritableSchema(requestId: string) {
    if (this.environment.nodeEnv !== 'test' || !this.recordRepository || !this.recordSchemaProvider) {
      throw this.endpointUnavailable(requestId);
    }
    try {
      const schema = await this.recordSchemaProvider.getApprovedRecordSchema();
      if (!schema.testOnly || schema.approvedForRealUsers) throw this.endpointUnavailable(requestId);
      return schema;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw this.endpointUnavailable(requestId);
    }
  }

  private async requireContextSchema(requestId: string) {
    if (!this.recordSchemaProvider) {
      throw this.endpointUnavailable(requestId);
    }
    try {
      const schema = await this.recordSchemaProvider.getApprovedRecordSchema();
      if (!schema.testOnly || schema.approvedForRealUsers) throw this.endpointUnavailable(requestId);
      return schema as P11RecordPortSchema;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw this.endpointUnavailable(requestId);
    }
  }

  private endpointUnavailable(requestId: string) {
    return new ServiceUnavailableException(this.error(
      'ROUTE_ACCESS_NOT_APPROVED', requestId, ['WAIT_FOR_SECURITY_APPROVAL'],
    ));
  }

  private requestInvalid(requestId: string) {
    return new BadRequestException(this.error('RECORD_REQUEST_INVALID', requestId));
  }

  private schemaInvalid(requestId: string) {
    return new ServiceUnavailableException(this.error(
      'RECORD_SCHEMA_INVALID', requestId, ['CONTACT_OPERATIONS'],
    ));
  }

}

function requiredHeader(value?: string): string {
  return requiredText(value);
}

function requiredText(value?: string): string {
  const parsed = z.string().trim().min(1).safeParse(value);
  if (!parsed.success) throw new BadRequestException();
  return parsed.data;
}

function matchesValueType(value: string | number | boolean, valueType: 'STRING' | 'NUMBER' | 'BOOLEAN') {
  return (valueType === 'STRING' && typeof value === 'string')
    || (valueType === 'NUMBER' && typeof value === 'number' && Number.isFinite(value))
    || (valueType === 'BOOLEAN' && typeof value === 'boolean');
}

function hasDenseNonEmptyEntries(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const entries = (value as { entries?: unknown }).entries;
  return Array.isArray(entries) && entries.length > 0
    && entries.every((_entry, index) => Object.prototype.hasOwnProperty.call(entries, index));
}

function strictSelectedFields(fields: unknown): ReadonlyArray<{
  id: string;
  valueType: 'STRING' | 'NUMBER' | 'BOOLEAN';
  required?: boolean;
}> | null {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const ids = new Set<string>();
  for (let index = 0; index < fields.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(fields, index)) return null;
    const field = fields[index];
    if (!field || typeof field !== 'object' || Array.isArray(field)) return null;
    const candidate = field as Record<string, unknown>;
    const expectedKeys = candidate.required === undefined
      ? ['id', 'valueType']
      : ['id', 'valueType', 'required'];
    const keys = Object.keys(candidate);
    if (keys.length !== expectedKeys.length || !keys.every((key) => expectedKeys.includes(key))
      || typeof candidate.id !== 'string' || candidate.id.trim().length === 0
      || ids.has(candidate.id)
      || !['STRING', 'NUMBER', 'BOOLEAN'].includes(String(candidate.valueType))
      || (candidate.required !== undefined && typeof candidate.required !== 'boolean')) return null;
    ids.add(candidate.id);
  }
  return fields as ReturnType<typeof strictSelectedFields>;
}

function bearerToken(authorization?: string): string | null {
  const parsed = z.string().regex(/^Bearer \S+$/).safeParse(authorization);
  return parsed.success ? parsed.data.slice(7) : null;
}

function contextResponse(
  result: P11RecordContextResult,
  schema: Awaited<ReturnType<RecordSchemaProvider['getApprovedRecordSchema']>>,
) {
  return {
    businessStatus: 'RECORD_CONTEXT_AVAILABLE',
    taskId: result.taskId,
    planVersion: result.planVersion,
    businessDate: result.businessDate,
    accessMode: result.accessMode,
    schema: {
      version: schema.version,
      testOnly: schema.testOnly,
      recordKinds: schema.recordKinds.map((kind) => ({
        id: kind.id,
        fields: kind.fields.map((field) => ({
          id: field.id,
          valueType: field.valueType,
          ...(field.required === undefined ? {} : { required: field.required }),
        })),
        allowedActions: kind.allowedActions,
      })),
    },
    records: result.records.map((record) => ({
      recordId: record.recordId,
      recordKindId: record.recordKindId,
      recordVersion: record.recordVersion,
      schemaVersion: record.schemaVersion,
      entries: record.entries.map((entry) => ({ fieldId: entry.fieldId, value: entry.value })),
    })),
  };
}
