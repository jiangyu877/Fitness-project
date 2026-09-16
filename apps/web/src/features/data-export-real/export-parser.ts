type JsonObject = Record<string, unknown>;

export type ExportRequestType = 'EXPORT' | 'DELETE' | 'ANONYMIZE';
export type ExportStatus = 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FROZEN' | 'REJECTED';
export type ExportRequestStatus = { requestId: string; requestType: ExportRequestType; status: ExportStatus };

function invalid(): never { throw new Error('EXPORT_RESPONSE_INVALID'); }
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as JsonObject;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

export function parseExportRequestStatus(value: unknown): ExportRequestStatus {
  const status = object(value);
  const keys = Object.keys(status);
  if (keys.length !== 3 || !keys.every((key) => ['requestId', 'requestType', 'status'].includes(key))) invalid();
  if (typeof status.requestType !== 'string' || typeof status.status !== 'string') invalid();
  const requestType = status.requestType as ExportRequestType;
  const nextStatus = status.status as ExportStatus;
  if (!['EXPORT', 'DELETE', 'ANONYMIZE'].includes(requestType)) invalid();
  const allowedStatuses = requestType === 'EXPORT'
    ? ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED']
    : ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED'];
  if (!allowedStatuses.includes(nextStatus)) invalid();
  return { requestId: text(status.requestId), requestType, status: nextStatus };
}
