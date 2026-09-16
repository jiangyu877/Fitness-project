import { describe, expect, it } from 'vitest';

import { applyDeleteEvent, emptyDeleteState } from './delete-client-state.js';

const status = { requestId: 'request-opaque', requestType: 'DELETE' as const, status: 'SUBMITTED' as const };

describe('delete request client state', () => {
  it('keeps status for same trusted subject and repeated request id', () => {
    const state = applyDeleteEvent(emptyDeleteState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyDeleteEvent(state, { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status: { ...status, status: 'FROZEN' } }).request?.status).toBe('FROZEN');
  });

  it('clears status for cross-subject or unknown event', () => {
    const state = applyDeleteEvent(emptyDeleteState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyDeleteEvent(state, { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-2', status })).toEqual(emptyDeleteState());
    expect(applyDeleteEvent(state, { type: 'CLEAR_ALL', code: 'DELETE_RESPONSE_INVALID' })).toEqual(emptyDeleteState());
  });

  it('clears status when request id or type changes', () => {
    const state = applyDeleteEvent(emptyDeleteState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyDeleteEvent(state, { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status: { ...status, requestId: 'other-request' } })).toEqual(emptyDeleteState());
    expect(applyDeleteEvent(state, { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status: { ...status, requestType: 'ANONYMIZE' } })).toEqual(emptyDeleteState());
  });

  it.each([
    ['export request type', { ...status, requestType: 'EXPORT' }],
    ['extra property', { ...status, extra: true }],
    ['boxed request id', { ...status, requestId: new String(status.requestId) }],
    ['boxed status', { ...status, status: new String(status.status) }],
  ])('clears malformed typed status for %s', (_case, invalidStatus) => {
    const state = applyDeleteEvent(emptyDeleteState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyDeleteEvent(state, { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status: invalidStatus as never })).toEqual(emptyDeleteState());
  });

  it.each([
    ['unknown type', { type: 'UNKNOWN', trustedSubjectId: 'user-1', status }],
    ['empty type', { type: '', trustedSubjectId: 'user-1', status }],
    ['object type', { type: {}, trustedSubjectId: 'user-1', status }],
    ['non-string subject', { type: 'STATUS_AVAILABLE', trustedSubjectId: 42, status }],
  ])('clears malformed runtime event for %s', (_case, event) => {
    const state = applyDeleteEvent(emptyDeleteState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyDeleteEvent(state, event as never)).toEqual(emptyDeleteState());
  });
});
