import { parseRecordContext, parseRecordError, type RecordContext, type RecordError } from './p11-parser.js';

export type P11Session = { accountId: string; token: string };

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

function requireSession(session: P11Session): void {
  if (!session.accountId.trim() || !session.token.trim()) {
    throw new P11ClientError('P11 session is not trusted.', 401, 'P11_SESSION_REQUIRED');
  }
}

function requireTaskId(taskId: string): void {
  if (!taskId.trim()) {
    throw new P11ClientError('P11 task locator is missing.', 400, 'P11_TASK_ID_REQUIRED');
  }
}

function responseInvalid(status: number, requestId: string): P11ClientError {
  return new P11ClientError('P11 response cannot be consumed safely.', status, 'RECORD_RESPONSE_INVALID', [], requestId);
}

export function createP11Client(options: { fetcher?: Fetcher; requestId?: () => string } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const requestId = options.requestId ?? newKey;

  return {
    async getContext(session: P11Session, taskId: string): Promise<RecordContext> {
      requireSession(session);
      requireTaskId(taskId);

      const correlationId = requestId();
      if (!correlationId.trim()) {
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
          return parseRecordContext(payload);
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
  };
}

export type P11Client = ReturnType<typeof createP11Client>;
