import { parseDeleteRequestStatus, type DeleteRequestStatus, type DeleteRequestType } from './delete-parser.js';
export type DeleteSession = { accountId: string; token: string };
export type DeleteTransport = { submit(session: DeleteSession, requestId: string, requestType: DeleteRequestType): Promise<unknown>; readStatus(session: DeleteSession, requestId: string): Promise<unknown> };
export class DeleteClientError extends Error { constructor(readonly code: string, readonly clientStateDisposition: 'CLEAR_ALL' = 'CLEAR_ALL') { super('Delete response cannot be consumed safely.'); this.name = 'DeleteClientError'; } }
function requireSession(session: DeleteSession): void { if (!session || typeof session.accountId !== 'string' || typeof session.token !== 'string' || !session.accountId.trim() || !session.token.trim()) throw new DeleteClientError('DELETE_SESSION_INVALID'); }
function requireRequestId(requestId: string): void { if (typeof requestId !== 'string' || !requestId.trim()) throw new DeleteClientError('DELETE_REQUEST_ID_INVALID'); }
function parse(value: unknown): DeleteRequestStatus { try { return parseDeleteRequestStatus(value); } catch { throw new DeleteClientError('DELETE_RESPONSE_INVALID'); } }
function matching(status: DeleteRequestStatus, requestId: string, requestType: DeleteRequestType): DeleteRequestStatus { if (status.requestId !== requestId || status.requestType !== requestType) throw new DeleteClientError('DELETE_RESPONSE_INVALID'); return status; }
export function createDeleteRequestClient(transport: DeleteTransport) {
  return {
    async submit(session: DeleteSession, requestId: string, requestType: DeleteRequestType): Promise<DeleteRequestStatus> { requireSession(session); requireRequestId(requestId); try { return matching(parse(await transport.submit(session, requestId, requestType)), requestId, requestType); } catch (error) { if (error instanceof DeleteClientError) throw error; throw new DeleteClientError('DELETE_REQUEST_FAILED'); } },
    async readStatus(session: DeleteSession, requestId: string, requestType: DeleteRequestType): Promise<DeleteRequestStatus> { requireSession(session); requireRequestId(requestId); try { return matching(parse(await transport.readStatus(session, requestId)), requestId, requestType); } catch (error) { if (error instanceof DeleteClientError) throw error; throw new DeleteClientError('DELETE_REQUEST_FAILED'); } },
  };
}
export type DeleteRequestClient = ReturnType<typeof createDeleteRequestClient>;
