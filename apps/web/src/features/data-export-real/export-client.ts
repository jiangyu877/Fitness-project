import { parseExportRequestStatus, type ExportRequestStatus, type ExportRequestType } from './export-parser.js';

export type ExportSession = { accountId: string; token: string };
export type ExportTransport = { submit(session: ExportSession, requestId: string, requestType: ExportRequestType): Promise<unknown>; readStatus(session: ExportSession, requestId: string): Promise<unknown> };

export class ExportClientError extends Error {
  constructor(readonly code: string, readonly clientStateDisposition: 'CLEAR_ALL' = 'CLEAR_ALL') {
    super('Export response cannot be consumed safely.');
    this.name = 'ExportClientError';
  }
}

function requireSession(session: ExportSession): void {
  if (!session || typeof session.accountId !== 'string' || typeof session.token !== 'string' || !session.accountId.trim() || !session.token.trim()) throw new ExportClientError('EXPORT_SESSION_INVALID');
}
function requireRequestId(requestId: string): void {
  if (typeof requestId !== 'string' || !requestId.trim()) throw new ExportClientError('EXPORT_REQUEST_ID_INVALID');
}
function parse(value: unknown): ExportRequestStatus {
  try { return parseExportRequestStatus(value); } catch { throw new ExportClientError('EXPORT_RESPONSE_INVALID'); }
}
function matching(status: ExportRequestStatus, requestId: string, requestType: ExportRequestType): ExportRequestStatus {
  if (status.requestId !== requestId || status.requestType !== requestType) throw new ExportClientError('EXPORT_RESPONSE_INVALID');
  return status;
}

export function createExportRequestClient(transport: ExportTransport) {
  return {
    async submit(session: ExportSession, requestId: string, requestType: ExportRequestType = 'EXPORT'): Promise<ExportRequestStatus> {
      requireSession(session); requireRequestId(requestId);
      try { return matching(parse(await transport.submit(session, requestId, requestType)), requestId, requestType); }
      catch (error) { if (error instanceof ExportClientError) throw error; throw new ExportClientError('EXPORT_REQUEST_FAILED'); }
    },
    async readStatus(session: ExportSession, requestId: string, requestType: ExportRequestType = 'EXPORT'): Promise<ExportRequestStatus> {
      requireSession(session); requireRequestId(requestId);
      try { return matching(parse(await transport.readStatus(session, requestId)), requestId, requestType); }
      catch (error) { if (error instanceof ExportClientError) throw error; throw new ExportClientError('EXPORT_REQUEST_FAILED'); }
    },
  };
}

export type ExportRequestClient = ReturnType<typeof createExportRequestClient>;
