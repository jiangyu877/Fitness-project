import { describe, expect, it } from 'vitest';

type DeleteRequestType = 'DELETE' | 'ANONYMIZE';
type DeleteStatus = 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FROZEN' | 'REJECTED';
type DeleteRequest = { requestId: string; requestType: DeleteRequestType; status: DeleteStatus };

type DeleteFixture = {
  submit(subjectId: string, requestId: string, requestType: DeleteRequestType): DeleteRequest | { ok: false; clientStateDisposition: 'CLEAR_ALL' };
  get(subjectId: string, requestId: string): DeleteRequest | { ok: false; clientStateDisposition: 'CLEAR_ALL' };
};

function createDeleteFixture(): DeleteFixture {
  const requests = new Map<string, { subjectId: string; value: DeleteRequest }>();
  return {
    submit: (subjectId, requestId, requestType) => {
      const existing = requests.get(requestId);
      if (existing) {
        return existing.subjectId === subjectId && existing.value.requestType === requestType
          ? { ...existing.value }
          : { ok: false, clientStateDisposition: 'CLEAR_ALL' };
      }
      const value = { requestId, requestType, status: 'SUBMITTED' as const };
      requests.set(requestId, { subjectId, value });
      return { ...value };
    },
    get: (subjectId, requestId) => {
      const existing = requests.get(requestId);
      return existing && existing.subjectId === subjectId
        ? { ...existing.value }
        : { ok: false, clientStateDisposition: 'CLEAR_ALL' };
    },
  };
}

describe('P11-16 delete request status contract fixture', () => {
  it('supports DELETE and ANONYMIZE status with subject-scoped idempotency', () => {
    const fixture = createDeleteFixture();
    const requestId = 'delete-request-opaque-1';
    const submitted = fixture.submit('subject-opaque-1', requestId, 'DELETE');

    expect(submitted).toEqual({ requestId, requestType: 'DELETE', status: 'SUBMITTED' });
    expect(fixture.submit('subject-opaque-1', requestId, 'DELETE')).toEqual(submitted);
    expect(fixture.get('subject-opaque-1', requestId)).toEqual(submitted);
    expect(fixture.get('subject-opaque-2', requestId)).toEqual({
      ok: false, clientStateDisposition: 'CLEAR_ALL',
    });
    expect(fixture.submit('subject-opaque-1', 'anonymize-request-opaque-1', 'ANONYMIZE')).toEqual({
      requestId: 'anonymize-request-opaque-1', requestType: 'ANONYMIZE', status: 'SUBMITTED',
    });
  });
});
