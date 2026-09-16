import { parseRecordCommandSuccess, parseRecordContext, parseRecordError, type RecordContext, type RecordError } from './p11-parser.js';

export type P11Session = { accountId: string; token: string };

export type RecordCommand = {
  operation: 'UPSERT_RECORD';
  recordKindId: string;
  schemaVersion: string;
  expectedRecordVersion: number | null;
  entries: Array<{ fieldId: string; value: string | number | boolean }>;
};

export class P11ClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly recoverableActions: string[] = [],
    readonly requestId?: string,
    readonly clientStateDisposition: RecordError['clientStateDisposition'] = 'CLEAR_ALL',
  ) {
    super(message);
    this.name = 'P11ClientError';
  }
}

type Fetcher = typeof fetch;

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requireSession(session: unknown): asserts session is P11Session {
  if (!session || typeof session !== 'object' || Array.isArray(session)
    || typeof (session as P11Session).accountId !== 'string'
    || typeof (session as P11Session).token !== 'string'
    || !(session as P11Session).accountId.trim()
    || !(session as P11Session).token.trim()) {
    throw new P11ClientError('P11 session is not trusted.', 401, 'P11_SESSION_REQUIRED');
  }
}

function requireTaskId(taskId: unknown): asserts taskId is string {
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new P11ClientError('P11 task locator is missing.', 400, 'P11_TASK_ID_REQUIRED');
  }
}

function responseInvalid(status: number, requestId: string): P11ClientError {
  return new P11ClientError('P11 response cannot be consumed safely.', status, 'RECORD_RESPONSE_INVALID', [], requestId);
}

function commandInvalid(): P11ClientError {
  return new P11ClientError('P11 command cannot be submitted safely.', 400, 'RECORD_REQUEST_INVALID');
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean';
}

function validateCommand(value: unknown): asserts value is RecordCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw commandInvalid();
  const command = value as Record<string, unknown>;
  const keys = Object.keys(command);
  const expectedKeys = ['operation', 'recordKindId', 'schemaVersion', 'expectedRecordVersion', 'entries'];
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) throw commandInvalid();
  if (command.operation !== 'UPSERT_RECORD'
    || typeof command.recordKindId !== 'string' || !command.recordKindId.trim()
    || typeof command.schemaVersion !== 'string' || !command.schemaVersion.trim()
    || (command.expectedRecordVersion !== null
      && (typeof command.expectedRecordVersion !== 'number'
        || !Number.isInteger(command.expectedRecordVersion)
        || command.expectedRecordVersion < 0))
    || !Array.isArray(command.entries) || command.entries.length === 0) throw commandInvalid();
  const fieldIds = new Set<string>();
  for (const entry of command.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw commandInvalid();
    const candidate = entry as Record<string, unknown>;
    const entryKeys = Object.keys(candidate);
    if (entryKeys.length !== 2 || !entryKeys.includes('fieldId') || !entryKeys.includes('value')
      || typeof candidate.fieldId !== 'string' || !candidate.fieldId.trim()
      || fieldIds.has(candidate.fieldId) || !isScalar(candidate.value)) throw commandInvalid();
    fieldIds.add(candidate.fieldId);
  }
}

export function createP11Client(options: { fetcher?: Fetcher; requestId?: () => string; idempotencyKey?: () => string } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const requestId = options.requestId ?? newKey;
  const idempotencyKey = options.idempotencyKey ?? newKey;

  return {
    async getContext(session: P11Session, taskId: string): Promise<RecordContext> {
      requireSession(session);
      requireTaskId(taskId);

      const correlationId = requestId();
      if (typeof correlationId !== 'string' || !correlationId.trim()) {
        throw new P11ClientError('P11 request correlation is missing.', 400, 'P11_REQUEST_ID_REQUIRED');
      }

      let response: Response;
      try {
        response = await fetcher(`/api/v1/record-tasks/${encodeURIComponent(taskId)}/context`, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${session.token}`,
            'x-request-id': correlationId,
          },
        });
      } catch {
        throw new P11ClientError('P11 network request did not complete.', 0, 'NETWORK_ERROR');
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw responseInvalid(response.status, correlationId);
      }

      if (response.ok) {
        try {
          const context = parseRecordContext(payload);
          if (context.taskId !== taskId) throw new Error('P11_RECORD_TASK_MISMATCH');
          return context;
        } catch {
          throw responseInvalid(response.status, correlationId);
        }
      }

      try {
        const error = parseRecordError(payload);
        throw new P11ClientError(
          'P11 record context is blocked.',
          response.status,
          error.errorCode,
          [...error.recoverableActions],
          error.requestId,
          error.clientStateDisposition,
        );
      } catch (error) {
        if (error instanceof P11ClientError) throw error;
        throw responseInvalid(response.status, correlationId);
      }
    },

    async upsertRecord(session: P11Session, taskId: string, command: RecordCommand) {
      requireSession(session);
      requireTaskId(taskId);
      validateCommand(command);

      const correlationId = requestId();
      if (typeof correlationId !== 'string' || !correlationId.trim()) {
        throw new P11ClientError('P11 request correlation is missing.', 400, 'P11_REQUEST_ID_REQUIRED');
      }
      const key = idempotencyKey();
      if (typeof key !== 'string' || !key.trim()) {
        throw new P11ClientError('P11 idempotency key is missing.', 400, 'P11_IDEMPOTENCY_KEY_REQUIRED');
      }

      let response: Response;
      try {
        response = await fetcher(`/api/v1/record-tasks/${encodeURIComponent(taskId)}/commands`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
            'x-request-id': correlationId,
            'idempotency-key': key,
          },
          body: JSON.stringify(command),
        });
      } catch {
        throw new P11ClientError('P11 network request did not complete.', 0, 'NETWORK_ERROR');
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw responseInvalid(response.status, correlationId);
      }

      if (response.ok) {
        try {
          return parseRecordCommandSuccess(payload);
        } catch {
          throw responseInvalid(response.status, correlationId);
        }
      }

      try {
        const error = parseRecordError(payload);
        throw new P11ClientError(
          'P11 record write is blocked.',
          response.status,
          error.errorCode,
          [...error.recoverableActions],
          error.requestId,
          error.clientStateDisposition,
        );
      } catch (error) {
        if (error instanceof P11ClientError) throw error;
        throw responseInvalid(response.status, correlationId);
      }
    },
  };
}

export type P11Client = ReturnType<typeof createP11Client>;
