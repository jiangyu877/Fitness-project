type JsonObject = Record<string, unknown>;

type ValueType = 'STRING' | 'NUMBER' | 'BOOLEAN';

export type RecordContext = {
  businessStatus: 'RECORD_CONTEXT_AVAILABLE';
  taskId: string;
  planVersion: string;
  businessDate: string;
  accessMode: 'EDITABLE' | 'READ_ONLY';
  schema: {
    version: string;
    testOnly: boolean;
    recordKinds: Array<{
      id: string;
      fields: Array<{ id: string; valueType: ValueType; required?: boolean }>;
      allowedActions: Array<'UPSERT_RECORD'>;
    }>;
  };
  records: Array<{
    recordId: string;
    recordKindId: string;
    recordVersion: number;
    schemaVersion: string;
    entries: Array<{ fieldId: string; value: string | number | boolean }>;
  }>;
};

export type RecordCommandSuccess = {
  businessStatus: 'RECORD_WRITE_ACCEPTED';
  recordVersion: number;
  schemaVersion: string;
  nextAction: 'GET_RECORD_CONTEXT';
  recoverableActions: [];
};

type ClientStateDisposition =
  | 'CLEAR_ALL'
  | 'DISABLE_EDITOR'
  | 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT';

export type RecordError = {
  businessStatus: 'RECORD_CONTEXT_BLOCKED';
  errorCode: string;
  recoverableActions: string[];
  clientStateDisposition: ClientStateDisposition;
  requestId: string;
};

const valueTypes = new Set<ValueType>(['STRING', 'NUMBER', 'BOOLEAN']);

const errorRules: Record<string, {
  disposition: ClientStateDisposition;
  actions: ReadonlySet<string>;
}> = {
  SESSION_INVALID: { disposition: 'CLEAR_ALL', actions: new Set() },
  ROLE_NOT_AUTHORIZED: { disposition: 'CLEAR_ALL', actions: new Set() },
  RECORD_TASK_NOT_FOUND: { disposition: 'CLEAR_ALL', actions: new Set() },
  RECORD_PLAN_NOT_ACTIVE: { disposition: 'CLEAR_ALL', actions: new Set(['OPEN_CURRENT_PLAN', 'CONTACT_OPERATIONS']) },
  RECORD_STATE_BLOCKED: { disposition: 'DISABLE_EDITOR', actions: new Set(['OPEN_CURRENT_PLAN', 'CONTACT_OPERATIONS']) },
  RECORD_SCHEMA_UNAVAILABLE: { disposition: 'CLEAR_ALL', actions: new Set(['CONTACT_OPERATIONS']) },
  RECORD_SCHEMA_INVALID: { disposition: 'CLEAR_ALL', actions: new Set(['CONTACT_OPERATIONS']) },
  RECORD_SCHEMA_VERSION_CONFLICT: { disposition: 'CLEAR_ALL', actions: new Set(['REFRESH']) },
  RECORD_VERSION_CONFLICT: { disposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT', actions: new Set(['REFRESH']) },
  IDEMPOTENCY_KEY_REUSED: { disposition: 'CLEAR_ALL', actions: new Set(['USE_NEW_IDEMPOTENCY_KEY']) },
  ROUTE_ACCESS_NOT_APPROVED: { disposition: 'CLEAR_ALL', actions: new Set(['WAIT_FOR_SECURITY_APPROVAL']) },
  RECORD_REQUEST_INVALID: { disposition: 'CLEAR_ALL', actions: new Set(['FIX_REQUEST']) },
};

function invalid(): never {
  throw new Error('RECORD_RESPONSE_INVALID');
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as JsonObject;
}

function exactKeys(value: JsonObject, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key))) invalid();
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid();
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid();
  return value;
}

function uniqueStrings(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}

function parseField(value: unknown) {
  const field = object(value);
  exactKeys(field, ['id', 'valueType'], ['required']);
  const id = nonEmptyString(field.id);
  if (!valueTypes.has(field.valueType as ValueType)) invalid();
  if (field.required !== undefined && typeof field.required !== 'boolean') invalid();
  return {
    id,
    valueType: field.valueType as ValueType,
    ...(field.required === undefined ? {} : { required: field.required }),
  };
}

function parseRecordKind(value: unknown) {
  const kind = object(value);
  exactKeys(kind, ['id', 'fields', 'allowedActions']);
  const id = nonEmptyString(kind.id);
  if (!Array.isArray(kind.fields) || !Array.isArray(kind.allowedActions)) invalid();
  const fields = kind.fields.map(parseField);
  uniqueStrings(fields.map((field) => field.id));
  const allowedActions = kind.allowedActions.map((action) => {
    if (action !== 'UPSERT_RECORD') invalid();
    return action;
  });
  uniqueStrings(allowedActions);
  return { id, fields, allowedActions };
}

function parseEntry(value: unknown) {
  const entry = object(value);
  exactKeys(entry, ['fieldId', 'value']);
  const fieldId = nonEmptyString(entry.fieldId);
  if (
    typeof entry.value !== 'string'
    && typeof entry.value !== 'boolean'
    && (typeof entry.value !== 'number' || !Number.isFinite(entry.value))
  ) invalid();
  return { fieldId, value: entry.value as string | number | boolean };
}

function valueMatches(value: string | number | boolean, valueType: ValueType): boolean {
  return (
    (valueType === 'STRING' && typeof value === 'string')
    || (valueType === 'NUMBER' && typeof value === 'number')
    || (valueType === 'BOOLEAN' && typeof value === 'boolean')
  );
}

export function parseRecordContext(value: unknown): RecordContext {
  const context = object(value);
  exactKeys(context, [
    'businessStatus', 'taskId', 'planVersion', 'businessDate', 'accessMode', 'schema', 'records',
  ]);
  if (context.businessStatus !== 'RECORD_CONTEXT_AVAILABLE') invalid();
  if (context.accessMode !== 'EDITABLE' && context.accessMode !== 'READ_ONLY') invalid();

  const schemaValue = object(context.schema);
  exactKeys(schemaValue, ['version', 'testOnly', 'recordKinds']);
  const schemaVersion = nonEmptyString(schemaValue.version);
  if (schemaValue.testOnly !== true || !Array.isArray(schemaValue.recordKinds)) invalid();
  const recordKinds = schemaValue.recordKinds.map(parseRecordKind);
  uniqueStrings(recordKinds.map((kind) => kind.id));
  if (context.accessMode === 'READ_ONLY' && recordKinds.some((kind) => kind.allowedActions.length > 0)) invalid();

  if (!Array.isArray(context.records)) invalid();
  const records = context.records.map((value) => {
    const record = object(value);
    exactKeys(record, ['recordId', 'recordKindId', 'recordVersion', 'schemaVersion', 'entries']);
    const recordId = nonEmptyString(record.recordId);
    const recordKindId = nonEmptyString(record.recordKindId);
    const recordVersion = nonNegativeInteger(record.recordVersion);
    if (nonEmptyString(record.schemaVersion) !== schemaVersion || !Array.isArray(record.entries)) invalid();
    const kind = recordKinds.find((candidate) => candidate.id === recordKindId);
    if (!kind) invalid();
    const entries = record.entries.map(parseEntry);
    uniqueStrings(entries.map((entry) => entry.fieldId));
    for (const entry of entries) {
      const field = kind.fields.find((candidate) => candidate.id === entry.fieldId);
      if (!field || !valueMatches(entry.value, field.valueType)) invalid();
    }
    if (kind.fields.some((field) => field.required && !entries.some((entry) => entry.fieldId === field.id))) invalid();
    return { recordId, recordKindId, recordVersion, schemaVersion, entries };
  });
  uniqueStrings(records.map((record) => record.recordId));

  return {
    businessStatus: 'RECORD_CONTEXT_AVAILABLE',
    taskId: nonEmptyString(context.taskId),
    planVersion: nonEmptyString(context.planVersion),
    businessDate: nonEmptyString(context.businessDate),
    accessMode: context.accessMode,
    schema: { version: schemaVersion, testOnly: schemaValue.testOnly, recordKinds },
    records,
  };
}

export function parseRecordCommandSuccess(value: unknown): RecordCommandSuccess {
  const success = object(value);
  exactKeys(success, ['businessStatus', 'recordVersion', 'schemaVersion', 'nextAction', 'recoverableActions']);
  if (
    success.businessStatus !== 'RECORD_WRITE_ACCEPTED'
    || success.nextAction !== 'GET_RECORD_CONTEXT'
    || !Array.isArray(success.recoverableActions)
    || success.recoverableActions.length !== 0
  ) invalid();
  return {
    businessStatus: 'RECORD_WRITE_ACCEPTED',
    recordVersion: nonNegativeInteger(success.recordVersion),
    schemaVersion: nonEmptyString(success.schemaVersion),
    nextAction: 'GET_RECORD_CONTEXT',
    recoverableActions: [],
  };
}

export function parseRecordError(value: unknown): RecordError {
  const error = object(value);
  exactKeys(error, ['businessStatus', 'errorCode', 'recoverableActions', 'clientStateDisposition', 'requestId']);
  if (error.businessStatus !== 'RECORD_CONTEXT_BLOCKED') invalid();
  const errorCode = nonEmptyString(error.errorCode);
  const rule = errorRules[errorCode];
  if (!rule || error.clientStateDisposition !== rule.disposition || !Array.isArray(error.recoverableActions)) invalid();
  const recoverableActions = error.recoverableActions.map(nonEmptyString);
  uniqueStrings(recoverableActions);
  if (recoverableActions.some((action) => !rule.actions.has(action))) invalid();
  if (
    errorCode === 'RECORD_VERSION_CONFLICT'
    && (recoverableActions.length !== 1 || recoverableActions[0] !== 'REFRESH')
  ) invalid();
  return {
    businessStatus: 'RECORD_CONTEXT_BLOCKED',
    errorCode,
    recoverableActions,
    clientStateDisposition: rule.disposition,
    requestId: nonEmptyString(error.requestId),
  };
}
