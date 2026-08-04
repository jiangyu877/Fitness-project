import { describe, expect, it } from 'vitest';

import { applyRecordClientDisposition } from './p11-client-state.js';

const populatedState = {
  trustedSubjectId: 'trusted-user',
  taskId: 'fictional-task',
  recordTarget: { recordId: 'fictional-record' },
  recordData: { recordId: 'fictional-record', recordVersion: 2 },
  unsavedInput: { opaqueField: 'fictional-value' },
  conflictDraft: { opaqueField: 'older-fictional-value' },
  editor: { enabled: true },
};

describe('P11 client-state disposition', () => {
  it.each([
    'SESSION_INVALID',
    'ROLE_NOT_AUTHORIZED',
    'RECORD_TASK_NOT_FOUND',
    'ROUTE_ACCESS_NOT_APPROVED',
  ])('clears all record state for %s', (errorCode) => {
    expect(applyRecordClientDisposition(populatedState, {
      errorCode,
      clientStateDisposition: 'CLEAR_ALL',
    })).toEqual({
      trustedSubjectId: null,
      taskId: null,
      recordTarget: null,
      recordData: null,
      unsavedInput: null,
      conflictDraft: null,
      editor: null,
    });
  });

  it('preserves an unsaved draft only for the same trusted subject and target record version conflict', () => {
    expect(applyRecordClientDisposition(populatedState, {
      errorCode: 'RECORD_VERSION_CONFLICT',
      clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
      trustedSubjectId: 'trusted-user',
      taskId: 'fictional-task',
      recordTarget: { recordId: 'fictional-record' },
      recoverableActions: ['REFRESH'],
    })).toEqual({
      ...populatedState,
      conflictDraft: populatedState.unsavedInput,
      editor: { enabled: false },
      visibleRecoverableActions: ['REFRESH'],
    });
  });

  it.each([
    ['changed subject', 'different-user', 'fictional-task', { recordId: 'fictional-record' }],
    ['changed task', 'trusted-user', 'different-task', { recordId: 'fictional-record' }],
    ['changed record', 'trusted-user', 'fictional-task', { recordId: 'different-record' }],
    ['unconfirmed subject', null, 'fictional-task', { recordId: 'fictional-record' }],
  ])('clears all instead of preserving for %s', (_case, trustedSubjectId, taskId, recordTarget) => {
    expect(applyRecordClientDisposition(populatedState, {
      errorCode: 'RECORD_VERSION_CONFLICT',
      clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
      trustedSubjectId,
      taskId,
      recordTarget,
      recoverableActions: ['REFRESH'],
    })).toEqual({
      trustedSubjectId: null,
      taskId: null,
      recordTarget: null,
      recordData: null,
      unsavedInput: null,
      conflictDraft: null,
      editor: null,
    });
  });

  it('matches a creation target by task, kind, and expected version when no record id exists', () => {
    const creationState = {
      ...populatedState,
      recordTarget: {
        taskId: 'fictional-task',
        recordKindId: 'fictional-kind',
        expectedRecordVersion: null,
      },
    };
    expect(applyRecordClientDisposition(creationState, {
      errorCode: 'RECORD_VERSION_CONFLICT',
      clientStateDisposition: 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT',
      trustedSubjectId: 'trusted-user',
      taskId: 'fictional-task',
      recordTarget: {
        taskId: 'fictional-task',
        recordKindId: 'fictional-kind',
        expectedRecordVersion: null,
      },
      recoverableActions: ['REFRESH'],
    })).toEqual({
      ...creationState,
      conflictDraft: creationState.unsavedInput,
      editor: { enabled: false },
      visibleRecoverableActions: ['REFRESH'],
    });
  });

  it('requests an automatic context read after a valid write success without exposing REFRESH', () => {
    expect(applyRecordClientDisposition(populatedState, {
      businessStatus: 'RECORD_WRITE_ACCEPTED',
      nextAction: 'GET_RECORD_CONTEXT',
      recoverableActions: [],
    })).toEqual({
      ...populatedState,
      editor: { enabled: false },
      pendingAuthoritativeRead: { taskId: 'fictional-task' },
      visibleRecoverableActions: [],
    });
  });

  it.each([
    ['missing trusted subject', { ...populatedState, trustedSubjectId: null }],
    ['missing task', { ...populatedState, taskId: null }],
  ])('clears all instead of continuing after success with %s', (_case, state) => {
    expect(applyRecordClientDisposition(state, {
      businessStatus: 'RECORD_WRITE_ACCEPTED',
      nextAction: 'GET_RECORD_CONTEXT',
      recoverableActions: [],
    })).toEqual({
      trustedSubjectId: null,
      taskId: null,
      recordTarget: null,
      recordData: null,
      unsavedInput: null,
      conflictDraft: null,
      editor: null,
    });
  });

  it('retains same-subject read-only data and disables the editor for RECORD_STATE_BLOCKED', () => {
    expect(applyRecordClientDisposition(populatedState, {
      errorCode: 'RECORD_STATE_BLOCKED',
      clientStateDisposition: 'DISABLE_EDITOR',
      trustedSubjectId: 'trusted-user',
      taskId: 'fictional-task',
      recoverableActions: [],
    })).toEqual({
      ...populatedState,
      editor: { enabled: false },
      visibleRecoverableActions: [],
    });
  });

  it('clears blocked record data when the subject cannot be trusted', () => {
    expect(applyRecordClientDisposition(populatedState, {
      errorCode: 'RECORD_STATE_BLOCKED',
      clientStateDisposition: 'DISABLE_EDITOR',
      trustedSubjectId: null,
      taskId: 'fictional-task',
      recoverableActions: [],
    })).toEqual({
      trustedSubjectId: null,
      taskId: null,
      recordTarget: null,
      recordData: null,
      unsavedInput: null,
      conflictDraft: null,
      editor: null,
    });
  });

  it('clears stale editable state when the authoritative read after success fails closed', () => {
    expect(applyRecordClientDisposition(populatedState, {
      errorCode: 'RECORD_RESPONSE_INVALID',
      clientStateDisposition: 'CLEAR_ALL',
    })).toEqual({
      trustedSubjectId: null,
      taskId: null,
      recordTarget: null,
      recordData: null,
      unsavedInput: null,
      conflictDraft: null,
      editor: null,
    });
  });
});
