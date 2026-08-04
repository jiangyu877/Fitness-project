export type P11RecordScalarType = 'STRING' | 'NUMBER' | 'BOOLEAN';

export type P11RecordPortSchema = Readonly<{
  version: string;
  testOnly: true;
  approvedForRealUsers: false;
  recordKinds: readonly Readonly<{
    id: string;
    fields: readonly Readonly<{
      id: string;
      valueType: P11RecordScalarType;
      required?: boolean;
    }>[];
    allowedActions: readonly ['UPSERT_RECORD'];
  }>[];
}>;

export type P11RecordPersistenceInput = Readonly<{
  sessionTokenHash: string;
  taskId: string;
  idempotencyKey: string;
  requestId: string;
  nodeEnv: 'test';
  schema: P11RecordPortSchema;
  command: Readonly<{
    operation: 'UPSERT_RECORD';
    recordKindId: string;
    schemaVersion: string;
    expectedRecordVersion: number | null;
    entries: readonly Readonly<{
      fieldId: string;
      valueType: P11RecordScalarType;
      value: string | number | boolean;
    }>[];
  }>;
}>;

export type P11RecordPersistenceResult = Readonly<{
  recordId: string;
  recordVersion: number;
  schemaVersion: string;
}>;

export type P11RecordRepositoryErrorCode =
  | 'SESSION_INVALID'
  | 'RECORD_TASK_NOT_FOUND'
  | 'RECORD_PLAN_NOT_ACTIVE'
  | 'RECORD_STATE_BLOCKED'
  | 'RECORD_SCHEMA_UNAVAILABLE'
  | 'RECORD_SCHEMA_INVALID'
  | 'RECORD_SCHEMA_VERSION_CONFLICT'
  | 'RECORD_VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ROUTE_ACCESS_NOT_APPROVED'
  | 'RECORD_REQUEST_INVALID'
  | 'HMAC_KEY_UNAVAILABLE';

export type P11RecordRepositorySuccess = Readonly<{
  ok: true;
  value: P11RecordPersistenceResult;
}>;

export type P11RecordRepositoryFailure = Readonly<{
  ok: false;
  error: Readonly<{ code: P11RecordRepositoryErrorCode }>;
}>;

export type P11RecordRepositoryOutcome =
  | P11RecordRepositorySuccess
  | P11RecordRepositoryFailure;

export interface P11RecordRepositoryPort {
  upsert(input: P11RecordPersistenceInput): Promise<P11RecordRepositoryOutcome>;
}
