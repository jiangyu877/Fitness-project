type JsonObject = Record<string, unknown>;
export type DeleteRequestType = 'DELETE' | 'ANONYMIZE';
export type DeleteStatus = 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FROZEN' | 'REJECTED';
export type DeleteRequestStatus = { requestId: string; requestType: DeleteRequestType; status: DeleteStatus };
function invalid(): never { throw new Error('DELETE_RESPONSE_INVALID'); }
function object(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as JsonObject; }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) invalid(); return value; }
export function parseDeleteRequestStatus(value: unknown): DeleteRequestStatus {
  const status = object(value); const keys = Object.keys(status);
  if (keys.length !== 3 || !keys.every((key) => ['requestId', 'requestType', 'status'].includes(key))) invalid();
  if (typeof status.requestType !== 'string' || typeof status.status !== 'string') invalid();
  if (!['DELETE', 'ANONYMIZE'].includes(status.requestType)) invalid();
  if (!['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED'].includes(status.status)) invalid();
  return { requestId: text(status.requestId), requestType: status.requestType as DeleteRequestType, status: status.status as DeleteStatus };
}
