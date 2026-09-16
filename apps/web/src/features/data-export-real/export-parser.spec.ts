import { describe, expect, it } from 'vitest';

import { parseExportRequestStatus } from './export-parser.js';

const status = { requestId: 'request-opaque', requestType: 'EXPORT', status: 'SUBMITTED' };

describe('export request status parser', () => {
  it('accepts EXPORT with four statuses and DELETE/ANONYMIZE with five statuses', () => {
    for (const requestType of ['EXPORT', 'DELETE', 'ANONYMIZE']) {
      const statuses = requestType === 'EXPORT'
        ? ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED']
        : ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED'];
      for (const nextStatus of statuses) {
        expect(parseExportRequestStatus({ ...status, requestType, status: nextStatus })).toEqual({ requestId: status.requestId, requestType, status: nextStatus });
      }
    }
  });

  it.each([
    ['unknown status', { ...status, status: 'UNKNOWN' }],
    ['wrong request type', { ...status, requestType: 'UNKNOWN' }],
    ['export frozen status', { ...status, status: 'FROZEN' }],
    ['extra property', { ...status, userId: 'forbidden' }],
    ['empty request id', { ...status, requestId: ' ' }],
    ['boxed request type', { ...status, requestType: new String('EXPORT') }],
    ['boxed status', { ...status, status: new String('SUBMITTED') }],
  ])('fails closed for %s', (_case, payload) => {
    expect(() => parseExportRequestStatus(payload)).toThrowError('EXPORT_RESPONSE_INVALID');
  });
});
