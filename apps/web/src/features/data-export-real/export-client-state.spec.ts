import { describe, expect, it } from 'vitest';

import { applyExportEvent, emptyExportState } from './export-client-state.js';

const status = { requestId: 'request-opaque', requestType: 'EXPORT' as const, status: 'SUBMITTED' as const };

describe('export request client state', () => {
  it('stores server status for the same trusted subject and preserves repeated status', () => {
    const state = applyExportEvent(emptyExportState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(state.request).toEqual(status);
    expect(applyExportEvent(state, { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status: { ...status, status: 'PROCESSING' } }).request?.status).toBe('PROCESSING');
  });

  it.each([
    ['cross subject', { type: 'STATUS_AVAILABLE' as const, trustedSubjectId: 'user-2', status }],
    ['unknown response', { type: 'CLEAR_ALL' as const, code: 'EXPORT_RESPONSE_INVALID' }],
  ])('clears state for %s', (_case, event) => {
    const state = applyExportEvent(emptyExportState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyExportEvent(state, event as never)).toEqual(emptyExportState());
  });

  it('clears when a response changes request identity', () => {
    const state = applyExportEvent(emptyExportState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyExportEvent(state, { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status: { ...status, requestId: 'other-request' } })).toEqual(emptyExportState());
    expect(applyExportEvent(state, { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status: { ...status, requestType: 'DELETE' } })).toEqual(emptyExportState());
  });

  it('clears a typed event that illegally uses FROZEN for EXPORT', () => {
    const state = applyExportEvent(emptyExportState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyExportEvent(state, {
      type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1',
      status: { ...status, status: 'FROZEN' } as never,
    })).toEqual(emptyExportState());
  });

  it.each([
    ['unknown type', { type: 'UNKNOWN', trustedSubjectId: 'user-1', status }],
    ['empty type', { type: '', trustedSubjectId: 'user-1', status }],
    ['object type', { type: {}, trustedSubjectId: 'user-1', status }],
    ['non-string subject', { type: 'STATUS_AVAILABLE', trustedSubjectId: 42, status }],
  ])('clears malformed runtime event for %s', (_case, event) => {
    const state = applyExportEvent(emptyExportState(), { type: 'STATUS_AVAILABLE', trustedSubjectId: 'user-1', status });
    expect(applyExportEvent(state, event as never)).toEqual(emptyExportState());
  });
});
