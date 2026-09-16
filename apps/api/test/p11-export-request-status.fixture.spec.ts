import { describe, expect, it } from 'vitest';

type ExportStatus = 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED';
type ExportRequest = { requestId: string; requestType: 'EXPORT'; status: ExportStatus };

type ExportFixture = {
  submit(subjectId: string, requestId: string): ExportRequest | { ok: false; clientStateDisposition: 'CLEAR_ALL' };
  get(subjectId: string, requestId: string): ExportRequest | { ok: false; clientStateDisposition: 'CLEAR_ALL' };
};

function createExportFixture(): ExportFixture {
  const requests = new Map<string, { subjectId: string; value: ExportRequest }>();
  return {
    submit: (subjectId, requestId) => {
      const existing = requests.get(requestId);
      if (existing) {
        return existing.subjectId === subjectId
          ? { ...existing.value }
          : { ok: false, clientStateDisposition: 'CLEAR_ALL' };
      }
      const value = { requestId, requestType: 'EXPORT' as const, status: 'SUBMITTED' as const };
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

describe('P11-16 data export request status contract fixture', () => {
  it('submits and reads opaque export status with subject-scoped idempotency', () => {
    const fixture = createExportFixture();
    const requestId = 'export-request-opaque-1';

    const submitted = fixture.submit('subject-opaque-1', requestId);
    expect(submitted).toEqual({ requestId, requestType: 'EXPORT', status: 'SUBMITTED' });
    expect(fixture.submit('subject-opaque-1', requestId)).toEqual(submitted);
    expect(fixture.get('subject-opaque-1', requestId)).toEqual(submitted);
    expect(fixture.get('subject-opaque-2', requestId)).toEqual({
      ok: false, clientStateDisposition: 'CLEAR_ALL',
    });
  });

  it('keeps both approved persona subjects isolated across data-rights status states', () => {
    const subjects = ['persona_fat_loss', 'persona_muscle_gain'] as const;
    const statusMatrix = [
      ['EXPORT', ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED']],
      ['DELETE', ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED']],
      ['ANONYMIZE', ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED']],
    ] as const;
    const seeded = subjects.flatMap((subjectId) => statusMatrix.flatMap(([requestType, statuses]) =>
      statuses.map((status) => ({
        subjectId,
        requestId: `dual-rights-${subjectId}-${requestType.toLowerCase()}-${status.toLowerCase()}`,
        requestType,
        status,
      }))));
    const fixture = createDualDataRightsFixture(seeded);

    for (const subjectId of subjects) {
      const listed = fixture.list(subjectId);
      expect(listed).toHaveLength(14);
      for (const request of listed) {
        expect(Object.keys(request).sort()).toEqual(['requestId', 'requestType', 'status']);
        const first = fixture.submit(subjectId, request.requestId, request.requestType);
        expect(first).toEqual({
          requestId: request.requestId, requestType: request.requestType, status: request.status,
        });
        expect(fixture.submit(subjectId, request.requestId, request.requestType)).toEqual(first);
        expect(fixture.get(subjectId, request.requestId)).toEqual(first);
      }
    }

    const fatLossRequest = seeded.find((request) => request.subjectId === 'persona_fat_loss')!;
    expect(fixture.get('persona_muscle_gain', fatLossRequest.requestId)).toEqual({
      ok: false, clientStateDisposition: 'CLEAR_ALL',
    });
    expect(fixture.submit('persona_muscle_gain', fatLossRequest.requestId, fatLossRequest.requestType)).toEqual({
      ok: false, clientStateDisposition: 'CLEAR_ALL',
    });
    for (const malformed of [
      { subjectId: 'persona_fat_loss', requestId: '', requestType: 'EXPORT' },
      { subjectId: 'persona_fat_loss', requestId: 'unknown-rights-request', requestType: 'UNKNOWN' },
      { subjectId: 'persona_muscle_gain', requestId: 'malformed-rights-request', requestType: '' },
    ] as const) {
      expect(fixture.submit(malformed.subjectId, malformed.requestId, malformed.requestType as never)).toEqual({
        ok: false, clientStateDisposition: 'CLEAR_ALL',
      });
      expect(fixture.get(malformed.subjectId, malformed.requestId)).toEqual({
        ok: false, clientStateDisposition: 'CLEAR_ALL',
      });
    }
  });

  it('rejects an EXPORT seed with the DELETE-only FROZEN status', () => {
    expect(() => createDualDataRightsFixture([{
      subjectId: 'persona_fat_loss', requestId: 'invalid-export-frozen', requestType: 'EXPORT', status: 'FROZEN',
    } as never])).toThrowError('DATA_RIGHTS_FIXTURE_INVALID');
  });

  it('rejects duplicate or extra-field seeds', () => {
    const duplicate = { subjectId: 'persona_fat_loss', requestId: 'duplicate', requestType: 'EXPORT', status: 'SUBMITTED' } as const;
    expect(() => createDualDataRightsFixture([duplicate, duplicate])).toThrowError('DATA_RIGHTS_FIXTURE_INVALID');
    expect(() => createDualDataRightsFixture([{ ...duplicate, extra: true } as never])).toThrowError('DATA_RIGHTS_FIXTURE_INVALID');
    expect(() => createDualDataRightsFixture([{ ...duplicate, requestId: new String('boxed') } as never])).toThrowError('DATA_RIGHTS_FIXTURE_INVALID');
    expect(() => createDualDataRightsFixture([{ ...duplicate, status: '' } as never])).toThrowError('DATA_RIGHTS_FIXTURE_INVALID');
    expect(() => createDualDataRightsFixture([null as never])).toThrowError('DATA_RIGHTS_FIXTURE_INVALID');
  });

  it('rejects the same subject and request id across different request types', () => {
    expect(() => createDualDataRightsFixture([
      { subjectId: 'persona_fat_loss', requestId: 'same-request-id', requestType: 'EXPORT', status: 'SUBMITTED' },
      { subjectId: 'persona_fat_loss', requestId: 'same-request-id', requestType: 'DELETE', status: 'SUBMITTED' },
    ])).toThrowError('DATA_RIGHTS_FIXTURE_INVALID');
  });

  it('returns CLEAR_ALL for non-string submit and get inputs', () => {
    const fixture = createDualDataRightsFixture([{ subjectId: 'persona_fat_loss', requestId: 'request', requestType: 'EXPORT', status: 'SUBMITTED' }]);
    expect(fixture.submit('persona_fat_loss', 42 as never, 'EXPORT')).toEqual({ ok: false, clientStateDisposition: 'CLEAR_ALL' });
    expect(fixture.submit(42 as never, 'request', 'EXPORT')).toEqual({ ok: false, clientStateDisposition: 'CLEAR_ALL' });
    expect(fixture.get('persona_fat_loss', 42 as never)).toEqual({ ok: false, clientStateDisposition: 'CLEAR_ALL' });
    expect(fixture.get(42 as never, 'request')).toEqual({ ok: false, clientStateDisposition: 'CLEAR_ALL' });
  });
});

type DualDataRightsRequest = {
  subjectId: string;
  requestId: string;
  requestType: 'EXPORT' | 'DELETE' | 'ANONYMIZE';
  status: 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FROZEN' | 'REJECTED';
};

type DataRightsResult = Omit<DualDataRightsRequest, 'subjectId'>
  | { ok: false; clientStateDisposition: 'CLEAR_ALL' };

type DualDataRightsFixture = {
  list(subjectId: string): Array<Omit<DualDataRightsRequest, 'subjectId'>>;
  submit(subjectId: string, requestId: string, requestType: string): DataRightsResult;
  get(subjectId: string, requestId: string): DataRightsResult;
};

function createDualDataRightsFixture(_seed: readonly DualDataRightsRequest[]): DualDataRightsFixture {
  const scoped = new Map<string, Map<string, Omit<DualDataRightsRequest, 'subjectId'>>>();
  for (const request of _seed) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('DATA_RIGHTS_FIXTURE_INVALID');
    const keys = Object.keys(request as object);
    const allowedStatuses = request.requestType === 'EXPORT'
      ? ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED']
      : request.requestType === 'DELETE' || request.requestType === 'ANONYMIZE'
        ? ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FROZEN', 'REJECTED']
        : [];
    if (keys.length !== 4 || !keys.every((key) => ['subjectId', 'requestId', 'requestType', 'status'].includes(key))
      || typeof request.subjectId !== 'string'
      || typeof request.requestId !== 'string'
      || typeof request.requestType !== 'string'
      || typeof request.status !== 'string'
      || !request.subjectId.trim()
      || !request.requestId.trim()
      || !allowedStatuses.includes(request.status)) {
      throw new Error('DATA_RIGHTS_FIXTURE_INVALID');
    }
    const subjectRequests = scoped.get(request.subjectId) ?? new Map();
    const conflictingRequestId = [...subjectRequests.values()].some((existing) =>
      existing.requestId === request.requestId && existing.requestType !== request.requestType);
    if (conflictingRequestId) throw new Error('DATA_RIGHTS_FIXTURE_INVALID');
    const key = `${request.requestId}\0${request.requestType}`;
    if (subjectRequests.has(key)) throw new Error('DATA_RIGHTS_FIXTURE_INVALID');
    subjectRequests.set(key, {
      requestId: request.requestId,
      requestType: request.requestType,
      status: request.status,
    });
    scoped.set(request.subjectId, subjectRequests);
  }
  const clear = () => ({ ok: false as const, clientStateDisposition: 'CLEAR_ALL' as const });
  const validRequestType = (value: string): value is DualDataRightsRequest['requestType'] =>
    value === 'EXPORT' || value === 'DELETE' || value === 'ANONYMIZE';
  return {
    list: (subjectId) => [...(scoped.get(subjectId)?.values() ?? [])].map((request) => ({ ...request })),
    submit: (subjectId, requestId, requestType) => {
      if (typeof subjectId !== 'string' || typeof requestId !== 'string' || typeof requestType !== 'string'
        || !scoped.has(subjectId) || requestId.trim().length === 0 || !validRequestType(requestType)) {
        return clear();
      }
      const subjectRequests = scoped.get(subjectId)!;
      const conflictingType = [...subjectRequests.values()].some((request) =>
        request.requestId === requestId && request.requestType !== requestType);
      if (conflictingType) return clear();
      const request = subjectRequests.get(`${requestId}\0${requestType}`);
      return request ? { ...request } : clear();
    },
    get: (subjectId, requestId) => {
      if (typeof subjectId !== 'string' || typeof requestId !== 'string' || !scoped.has(subjectId) || requestId.trim().length === 0) return clear();
      const request = [...scoped.get(subjectId)!.values()].find((candidate) => candidate.requestId === requestId);
      return request ? { ...request } : clear();
    },
  };
}
