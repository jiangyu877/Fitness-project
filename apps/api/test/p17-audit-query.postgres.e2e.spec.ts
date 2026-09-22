import { describe, expect, it } from 'vitest';

import {
  auditTableDigest, queryAuditEvents, seedAuditEvents, withAuditPostgres,
  type AuditQueryFilters,
} from './support/p17-audit-query.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

const expectedRows = [
  {
    id: 'audit-4', actorId: 'user-2', actorRole: 'USER', action: 'SESSION_INVALID',
    subjectType: 'SESSION', subjectId: 'session-2', requestId: 'req-4',
    outcome: 'REJECTED', errorCode: 'SESSION_INVALID', occurredAt: '2026-01-02T10:00:00.000Z',
  },
  {
    id: 'audit-3', actorId: 'operations', actorRole: 'OPERATIONS', action: 'PLAN_PUBLISH',
    subjectType: 'PLAN_VERSION', subjectId: 'plan-v2', requestId: 'req-3',
    outcome: 'SUCCEEDED', errorCode: null, occurredAt: '2026-01-02T09:00:00.000Z',
  },
  {
    id: 'audit-2', actorId: 'user-1', actorRole: 'USER', action: 'PLAN_TRANSITION_REJECTED',
    subjectType: 'PLAN_VERSION', subjectId: 'plan-v1', requestId: 'req-2',
    outcome: 'REJECTED', errorCode: 'PLAN_VERSION_NOT_FOUND', occurredAt: '2026-01-01T11:00:00.000Z',
  },
  {
    id: 'audit-1', actorId: 'user-1', actorRole: 'USER', action: 'PLAN_CONFIRM_DIET',
    subjectType: 'PLAN_VERSION', subjectId: 'plan-v1', requestId: 'req-1',
    outcome: 'SUCCEEDED', errorCode: null, occurredAt: '2026-01-01T10:00:00.000Z',
  },
] as const;

describe.runIf(Boolean(adminUrl)).sequential('P17 audit query read-only contract', () => {
  it('returns only matching rows with the frozen minimal-disclosure projection', async () => {
    await withAuditPostgres(adminUrl!, async (pool) => {
      await seedAuditEvents(pool);
      const combined = await queryAuditEvents(pool, { actorId: 'user-1', outcome: 'REJECTED', limit: 100 });
      expect(combined).toEqual([expectedRows[2]]);
      const all = await queryAuditEvents(pool, { limit: 100 });
      expect(all).toEqual([...expectedRows]);
      for (const row of all) {
        expect(Object.keys(row).sort()).toEqual([
          'action', 'actorId', 'actorRole', 'errorCode', 'id', 'occurredAt', 'outcome', 'requestId',
          'subjectId', 'subjectType',
        ]);
        expect(JSON.stringify(row)).not.toContain('before_version_id');
        expect(JSON.stringify(row)).not.toContain('after_version_id');
      }
    });
  });

  it('applies the stable ordering and the bounded limit', async () => {
    await withAuditPostgres(adminUrl!, async (pool) => {
      await seedAuditEvents(pool);
      expect((await queryAuditEvents(pool, { limit: 1 })).map((row) => row.id)).toEqual(['audit-4']);
      expect((await queryAuditEvents(pool, { limit: 2 })).map((row) => row.id)).toEqual(['audit-4', 'audit-3']);
      expect((await queryAuditEvents(pool, { limit: 100 })).map((row) => row.id))
        .toEqual(['audit-4', 'audit-3', 'audit-2', 'audit-1']);
    });
  });

  it('filters by subject scope and time range without cross-actor leakage', async () => {
    await withAuditPostgres(adminUrl!, async (pool) => {
      await seedAuditEvents(pool);
      expect((await queryAuditEvents(pool, { actorId: 'operations', limit: 100 })).map((row) => row.id))
        .toEqual(['audit-3']);
      expect((await queryAuditEvents(pool, { subjectType: 'SESSION', limit: 100 })).map((row) => row.id))
        .toEqual(['audit-4']);
      expect((await queryAuditEvents(pool, { requestId: 'req-2', limit: 100 })).map((row) => row.id))
        .toEqual(['audit-2']);
      expect((await queryAuditEvents(pool, {
        occurredFrom: '2026-01-02T00:00:00.000Z', limit: 100,
      })).map((row) => row.id)).toEqual(['audit-4', 'audit-3']);
      expect((await queryAuditEvents(pool, {
        occurredTo: '2026-01-02T00:00:00.000Z', limit: 100,
      })).map((row) => row.id)).toEqual(['audit-2', 'audit-1']);
    });
  });

  it('rejects malformed filters fail closed', async () => {
    await withAuditPostgres(adminUrl!, async (pool) => {
      await seedAuditEvents(pool);
      const invalid: unknown[] = [
        { limit: 100, extra: true },
        { limit: 100, outcome: 'MAYBE' },
        { limit: 100, actorId: '' },
        { limit: 100, actorId: '   ' },
        { limit: 100, occurredFrom: 'not-a-date' },
        { limit: 100, occurredTo: 42 },
        {},
        { limit: 0 },
        { limit: 101 },
        { limit: 1.5 },
        { limit: '100' },
        null,
      ];
      for (const filters of invalid) {
        await expect(queryAuditEvents(pool, filters as AuditQueryFilters))
          .rejects.toThrowError('AUDIT_QUERY_INVALID');
      }
    });
  });

  it('performs no writes across repeated queries', async () => {
    await withAuditPostgres(adminUrl!, async (pool) => {
      await seedAuditEvents(pool);
      const before = await auditTableDigest(pool);
      await queryAuditEvents(pool, { limit: 100 });
      await queryAuditEvents(pool, { actorId: 'user-1', limit: 100 });
      await queryAuditEvents(pool, { outcome: 'REJECTED', occurredFrom: '2026-01-01T00:00:00.000Z', limit: 1 });
      await expect(queryAuditEvents(pool, { limit: 0 })).rejects.toThrowError('AUDIT_QUERY_INVALID');
      expect(await auditTableDigest(pool)).toEqual(before);
      expect(before.count).toBe(4);
    });
  });
});
