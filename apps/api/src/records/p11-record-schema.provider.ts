export type RecordValueType = 'STRING' | 'NUMBER' | 'BOOLEAN';
export type RecordFieldSchema = { id: string; valueType: RecordValueType; required?: boolean };
export type RecordKindSchema = {
  id: string;
  fields: readonly RecordFieldSchema[];
  allowedActions: readonly 'UPSERT_RECORD'[];
};
export type ApprovedRecordSchema = {
  version: string;
  testOnly: boolean;
  approvedForRealUsers: boolean;
  recordKinds: readonly RecordKindSchema[];
};
export type RecordSchemaProvider = { getApprovedRecordSchema(): Promise<ApprovedRecordSchema> };
export const RECORD_SCHEMA = Symbol('RECORD_SCHEMA');

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function validRecordSchema(value: unknown): value is ApprovedRecordSchema {
  if (!value || typeof value !== 'object') return false;
  const schema = value as Record<string, unknown>;
  if (!hasExactKeys(schema, ['version', 'testOnly', 'approvedForRealUsers', 'recordKinds'])
    || typeof schema.version !== 'string' || schema.version.trim().length === 0
    || typeof schema.testOnly !== 'boolean' || typeof schema.approvedForRealUsers !== 'boolean'
    || !schema.testOnly || schema.approvedForRealUsers || !Array.isArray(schema.recordKinds)) return false;
  const kindIds = new Set<string>();
  return schema.recordKinds.every((kind) => {
    if (!kind || typeof kind !== 'object') return false;
    const candidate = kind as Record<string, unknown>;
    if (!hasExactKeys(candidate, ['id', 'fields', 'allowedActions'])
      || typeof candidate.id !== 'string' || candidate.id.trim().length === 0 || kindIds.has(candidate.id)
      || !Array.isArray(candidate.fields) || !Array.isArray(candidate.allowedActions)
      || candidate.allowedActions.length !== 1 || candidate.allowedActions[0] !== 'UPSERT_RECORD') return false;
    kindIds.add(candidate.id);
    const fieldIds = new Set<string>();
    return candidate.fields.every((field) => {
      if (!field || typeof field !== 'object') return false;
      const item = field as Record<string, unknown>;
      const fieldKeys = item.required === undefined ? ['id', 'valueType'] : ['id', 'valueType', 'required'];
      if (!hasExactKeys(item, fieldKeys)
        || typeof item.id !== 'string' || item.id.trim().length === 0 || fieldIds.has(item.id)
        || !['STRING', 'NUMBER', 'BOOLEAN'].includes(String(item.valueType))
        || ('required' in item && typeof item.required !== 'boolean')) return false;
      fieldIds.add(item.id);
      return true;
    });
  });
}

export function freezeRecordSchema(schema: ApprovedRecordSchema): ApprovedRecordSchema {
  return Object.freeze({
    version: schema.version,
    testOnly: schema.testOnly,
    approvedForRealUsers: schema.approvedForRealUsers,
    recordKinds: Object.freeze(schema.recordKinds.map((kind) => Object.freeze({
      id: kind.id,
      fields: Object.freeze(kind.fields.map((field) => Object.freeze({
        id: field.id,
        valueType: field.valueType,
        ...(field.required === undefined ? {} : { required: field.required }),
      }))),
      allowedActions: Object.freeze(['UPSERT_RECORD'] as const),
    }))),
  });
}
