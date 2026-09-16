import type { ExportRequestStatus } from './export-parser.js';

export type ExportState = { trustedSubjectId: string | null; request: ExportRequestStatus | null };
type ExportEvent =
  | { type: 'STATUS_AVAILABLE'; trustedSubjectId: string; status: ExportRequestStatus }
  | { type: 'CLEAR_ALL'; code: string };

export function emptyExportState(): ExportState { return { trustedSubjectId: null, request: null }; }

function isValidRequestStatus(value: unknown): value is ExportRequestStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  const keys = Object.keys(status);
  if (keys.length !== 3 || !keys.every((key) => ['requestId', 'requestType', 'status'].includes(key))) return false;
  if (typeof status.requestId !== 'string' || !status.requestId.trim()) return false;
  if (typeof status.requestType !== 'string' || typeof status.status !== 'string') return false;
  const requestType = status.requestType;
  const allowedStatuses = requestType === 'EXPORT'
    ? ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED']
    : requestType === 'DELETE' || requestType === 'ANONYMIZE'
      ? ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED']
      : [];
  return allowedStatuses.includes(status.status);
}

export function applyExportEvent(state: ExportState, event: ExportEvent): ExportState {
  if (!event || typeof event !== 'object' || (event as { type?: unknown }).type !== 'STATUS_AVAILABLE' && (event as { type?: unknown }).type !== 'CLEAR_ALL') return emptyExportState();
  if (event.type === 'CLEAR_ALL') return emptyExportState();
  if (typeof event.trustedSubjectId !== 'string' || !event.trustedSubjectId.trim() || (state.trustedSubjectId !== null && state.trustedSubjectId !== event.trustedSubjectId)) return emptyExportState();
  if (!isValidRequestStatus(event.status)) return emptyExportState();
  if (state.request !== null && (
    state.request.requestId !== event.status.requestId
    || state.request.requestType !== event.status.requestType
  )) return emptyExportState();
  return { trustedSubjectId: event.trustedSubjectId, request: event.status };
}
