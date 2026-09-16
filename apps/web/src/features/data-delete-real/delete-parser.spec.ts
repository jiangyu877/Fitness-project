import { describe, expect, it } from 'vitest';

import { parseDeleteRequestStatus } from './delete-parser.js';

const status = { requestId: 'request-opaque', requestType: 'DELETE', status: 'SUBMITTED' };

describe('delete request status parser', () => {
  it('accepts DELETE and ANONYMIZE with all five statuses', () => {
    for (const requestType of ['DELETE', 'ANONYMIZE']) {
      for (const nextStatus of ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED']) {
        expect(parseDeleteRequestStatus({ ...status, requestType, status: nextStatus })).toEqual({ requestId: status.requestId, requestType, status: nextStatus });
      }
    }
  });

  it.each([
    ['unknown status', { ...status, status: 'UNKNOWN' }],
    ['unknown request type', { ...status, requestType: 'EXPORT' }],
    ['extra property', { ...status, userId: 'forbidden' }],
    ['boxed request type', { ...status, requestType: new String('DELETE') }],
    ['boxed status', { ...status, status: new String('SUBMITTED') }],
  ])('fails closed for %s', (_case, payload) => {
    expect(() => parseDeleteRequestStatus(payload)).toThrowError('DELETE_RESPONSE_INVALID');
  });
});
