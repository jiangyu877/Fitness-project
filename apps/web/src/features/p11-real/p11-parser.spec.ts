import { describe, expect, it } from 'vitest';

import {
  parseRecordCommandSuccess,
  parseRecordContext,
  parseRecordError,
} from './p11-parser.js';

const fictionalContext = {
  businessStatus: 'RECORD_CONTEXT_AVAILABLE',
  taskId: 'fictional-task',
  planVersion: 'fictional-plan-version',
  businessDate: 'server-derived-date',
  accessMode: 'EDITABLE',
  schema: {
    version: 'fictional-test-schema',
    testOnly: true,
    recordKinds: [{ id: 'fictional-kind', fields: [], allowedActions: ['UPSERT_RECORD'] }],
  },
  records: [],
};

const structuredContext = {
  ...fictionalContext,
  schema: {
    ...fictionalContext.schema,
    recordKinds: [{
      id: 'fictional-kind',
      fields: [{ id: 'fictional-field', valueType: 'STRING', required: true }],
      allowedActions: ['UPSERT_RECORD'],
    }],
  },
  records: [{
    recordId: 'fictional-record',
    recordKindId: 'fictional-kind',
    recordVersion: 1,
    schemaVersion: 'fictional-test-schema',
    entries: [{ fieldId: 'fictional-field', value: 'fictional-value' }],
  }],
};

describe('P11 frozen response parsers', () => {
  it('accepts only the complete fictional test-only context envelope', () => {
    expect(parseRecordContext(fictionalContext)).toEqual(fictionalContext);
  });

  it.each([
    ['unknown status', { ...fictionalContext, businessStatus: 'UNKNOWN' }],
    ['unknown access mode', { ...fictionalContext, accessMode: 'OPEN' }],
    ['unknown action', { ...fictionalContext, schema: { ...fictionalContext.schema, recordKinds: [{ id: 'fictional-kind', fields: [], allowedActions: ['UNKNOWN_ACTION'] }] } }],
    ['additional root property', { ...fictionalContext, userId: 'must-not-be-consumed' }],
    ['additional schema property', { ...fictionalContext, schema: { ...fictionalContext.schema, approvedForRealUsers: true } }],
    ['duplicate kind identifier', { ...fictionalContext, schema: { ...fictionalContext.schema, recordKinds: [fictionalContext.schema.recordKinds[0], fictionalContext.schema.recordKinds[0]] } }],
    ['read-only write action', { ...fictionalContext, accessMode: 'READ_ONLY' }],
    ['non-test schema', { ...fictionalContext, schema: { ...fictionalContext.schema, testOnly: false } }],
    ['additional kind property', { ...structuredContext, schema: { ...structuredContext.schema, recordKinds: [{ ...structuredContext.schema.recordKinds[0]!, label: 'not-frozen' }] } }],
    ['additional field property', { ...structuredContext, schema: { ...structuredContext.schema, recordKinds: [{ ...structuredContext.schema.recordKinds[0]!, fields: [{ ...structuredContext.schema.recordKinds[0]!.fields[0]!, label: 'not-frozen' }] }] } }],
    ['additional record property', { ...structuredContext, records: [{ ...structuredContext.records[0]!, ownerId: 'not-frozen' }] }],
    ['additional entry property', { ...structuredContext, records: [{ ...structuredContext.records[0]!, entries: [{ ...structuredContext.records[0]!.entries[0]!, unit: 'not-frozen' }] }] }],
    ['duplicate field identifier', { ...structuredContext, schema: { ...structuredContext.schema, recordKinds: [{ ...structuredContext.schema.recordKinds[0]!, fields: [structuredContext.schema.recordKinds[0]!.fields[0], structuredContext.schema.recordKinds[0]!.fields[0]] }] } }],
    ['duplicate action', { ...structuredContext, schema: { ...structuredContext.schema, recordKinds: [{ ...structuredContext.schema.recordKinds[0]!, allowedActions: ['UPSERT_RECORD', 'UPSERT_RECORD'] }] } }],
    ['duplicate record identifier', { ...structuredContext, records: [structuredContext.records[0], structuredContext.records[0]] }],
    ['duplicate entry identifier', { ...structuredContext, records: [{ ...structuredContext.records[0]!, entries: [structuredContext.records[0]!.entries[0], structuredContext.records[0]!.entries[0]] }] }],
    ['unknown record kind', { ...structuredContext, records: [{ ...structuredContext.records[0]!, recordKindId: 'unknown-kind' }] }],
    ['unknown entry field', { ...structuredContext, records: [{ ...structuredContext.records[0]!, entries: [{ fieldId: 'unknown-field', value: 'fictional-value' }] }] }],
    ['record schema version mismatch', { ...structuredContext, records: [{ ...structuredContext.records[0]!, schemaVersion: 'older-schema' }] }],
    ['entry value type mismatch', { ...structuredContext, records: [{ ...structuredContext.records[0]!, entries: [{ fieldId: 'fictional-field', value: true }] }] }],
    ['missing required field', { ...structuredContext, records: [{ ...structuredContext.records[0]!, entries: [] }] }],
  ])('fails closed for malformed context: %s', (_case, payload) => {
    expect(() => parseRecordContext(payload)).toThrowError('RECORD_RESPONSE_INVALID');
  });

  it('accepts success only as an automatic authoritative context continuation', () => {
    expect(parseRecordCommandSuccess({
      businessStatus: 'RECORD_WRITE_ACCEPTED',
      recordVersion: 1,
      schemaVersion: 'fictional-test-schema',
      nextAction: 'GET_RECORD_CONTEXT',
      recoverableActions: [],
    })).toEqual({
      businessStatus: 'RECORD_WRITE_ACCEPTED',
      recordVersion: 1,
      schemaVersion: 'fictional-test-schema',
      nextAction: 'GET_RECORD_CONTEXT',
      recoverableActions: [],
    });
  });

  it.each([
    ['REFRESH on success', { businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1, schemaVersion: 'fictional-test-schema', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: ['REFRESH'] }],
    ['unknown next action', { businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1, schemaVersion: 'fictional-test-schema', nextAction: 'SHOW_SUCCESS', recoverableActions: [] }],
    ['additional success property', { businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1, schemaVersion: 'fictional-test-schema', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [], taskComplete: true }],
  ])('fails closed for malformed command success: %s', (_case, payload) => {
    expect(() => parseRecordCommandSuccess(payload)).toThrowError('RECORD_RESPONSE_INVALID');
  });

  it.each([
    ['SESSION_INVALID', []],
    ['ROLE_NOT_AUTHORIZED', []],
    ['RECORD_TASK_NOT_FOUND', []],
    ['ROUTE_ACCESS_NOT_APPROVED', ['WAIT_FOR_SECURITY_APPROVAL']],
  ] as const)('requires CLEAR_ALL for %s', (errorCode, recoverableActions) => {
    expect(parseRecordError({
      businessStatus: 'RECORD_CONTEXT_BLOCKED',
      errorCode,
      recoverableActions,
      clientStateDisposition: 'CLEAR_ALL',
      requestId: 'fictional-request',
    })).toMatchObject({ errorCode, recoverableActions, clientStateDisposition: 'CLEAR_ALL' });
  });

  it('accepts draft preservation only for the frozen record version conflict', () => {
    expect(parseRecordError({
      businessStatus: 'RECORD_CONTEXT_BLOCKED',
      errorCode: 'RECORD_VERSION_CONFLICT',
      recoverableActions: ['REFRESH'],
      clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
      requestId: 'fictional-request',
    })).toMatchObject({
      errorCode: 'RECORD_VERSION_CONFLICT',
      clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
    });
  });

  it.each([
    [[]],
    [['CONTACT_OPERATIONS']],
    [['REFRESH', 'REFRESH']],
  ] as const)('rejects record version conflict recovery actions other than exactly REFRESH: %j', (recoverableActions) => {
    expect(() => parseRecordError({
      businessStatus: 'RECORD_CONTEXT_BLOCKED',
      errorCode: 'RECORD_VERSION_CONFLICT',
      recoverableActions,
      clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
      requestId: 'fictional-request',
    })).toThrowError('RECORD_RESPONSE_INVALID');
  });

  it.each([
    ['unknown code', { errorCode: 'UNKNOWN', recoverableActions: [], clientStateDisposition: 'CLEAR_ALL' }],
    ['unauthorized LOGIN action', { errorCode: 'SESSION_INVALID', recoverableActions: ['LOGIN'], clientStateDisposition: 'CLEAR_ALL' }],
    ['unknown disposition', { errorCode: 'SESSION_INVALID', recoverableActions: ['LOGIN'], clientStateDisposition: 'KEEP_EDITOR' }],
    ['illegal preservation pairing', { errorCode: 'RECORD_TASK_NOT_FOUND', recoverableActions: ['REFRESH'], clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT' }],
    ['additional error property', { errorCode: 'SESSION_INVALID', recoverableActions: ['LOGIN'], clientStateDisposition: 'CLEAR_ALL', userId: 'leak' }],
  ])('fails closed for malformed error: %s', (_case, partial) => {
    expect(() => parseRecordError({
      businessStatus: 'RECORD_CONTEXT_BLOCKED',
      requestId: 'fictional-request',
      ...partial,
    })).toThrowError('RECORD_RESPONSE_INVALID');
  });
});
