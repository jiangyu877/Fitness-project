import type { DeleteRequestStatus } from './delete-parser.js';
export type DeleteState = { trustedSubjectId: string | null; request: DeleteRequestStatus | null };
type DeleteEvent = { type: 'STATUS_AVAILABLE'; trustedSubjectId: string; status: DeleteRequestStatus } | { type: 'CLEAR_ALL'; code: string };
export function emptyDeleteState(): DeleteState { return { trustedSubjectId: null, request: null }; }

function isValidDeleteStatus(value: unknown): value is DeleteRequestStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  const keys = Object.keys(status);
  if (keys.length !== 3 || !keys.every((key) => ['requestId', 'requestType', 'status'].includes(key))) return false;
  if (typeof status.requestId !== 'string' || !status.requestId.trim()) return false;
  if (typeof status.requestType !== 'string' || typeof status.status !== 'string') return false;
  if (status.requestType !== 'DELETE' && status.requestType !== 'ANONYMIZE') return false;
  return ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED'].includes(status.status);
}

export function applyDeleteEvent(state: DeleteState, event: DeleteEvent): DeleteState {
  if (!event || typeof event !== 'object' || (event as { type?: unknown }).type !== 'STATUS_AVAILABLE' && (event as { type?: unknown }).type !== 'CLEAR_ALL') return emptyDeleteState();
  if (event.type === 'CLEAR_ALL') return emptyDeleteState();
  if (!isValidDeleteStatus(event.status)) return emptyDeleteState();
  if (typeof event.trustedSubjectId !== 'string' || !event.trustedSubjectId.trim() || (state.trustedSubjectId !== null && state.trustedSubjectId !== event.trustedSubjectId)) return emptyDeleteState();
  if (state.request !== null && (state.request.requestId !== event.status.requestId || state.request.requestType !== event.status.requestType)) return emptyDeleteState();
  return { trustedSubjectId: event.trustedSubjectId, request: event.status };
}
