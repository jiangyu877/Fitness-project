import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrate.js';
import { PGlitePlanRepository } from '../src/plan-repository.js';

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('persistent plan repository', () => {
  it('creates and reloads a plan version with optimistic versioning', async () => {
    const repository = await setup();
    const created = await repository.create({
      id: 'version-1',
      planId: 'plan-1',
      userId: 'user-1',
      versionNumber: 1,
      status: 'DRAFT',
      confirmationDeadlineAt: new Date('2026-08-09T12:00:00Z'),
      effectiveAt: new Date('2026-08-10T00:00:00Z'),
      effectiveTo: null,
      payload: { contentMode: 'REVIEWED' },
    });

    expect(created.recordVersion).toBe(1);
    expect((await repository.get('version-1'))?.status).toBe('DRAFT');

    const saved = await repository.save('version-1', 1, { status: 'IN_REVIEW' });
    expect(saved.recordVersion).toBe(2);
    await expect(repository.save('version-1', 1, { status: 'DRAFT' })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      latestRecordVersion: 2,
    });
  });

  it('replays an idempotent write and appends an audit event', async () => {
    const repository = await setup();
    const first = await repository.recordWrite({
      idempotencyKey: 'request-1',
      requestId: 'req-1',
      actorId: 'operator-1',
      actorRole: 'OPERATIONS',
      action: 'PLAN_CREATED',
      subjectId: 'version-1',
      result: { status: 'DRAFT' },
    });
    const replay = await repository.recordWrite({
      idempotencyKey: 'request-1',
      requestId: 'req-2',
      actorId: 'operator-1',
      actorRole: 'OPERATIONS',
      action: 'PLAN_CREATED',
      subjectId: 'version-1',
      result: { status: 'CHANGED' },
    });

    expect(first).toEqual({ id: 'req-1', result: { status: 'DRAFT' }, replayed: false });
    expect(replay).toEqual({ id: 'req-1', result: { status: 'DRAFT' }, replayed: true });
    const audit = await repository.listAudit('version-1');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      requestId: 'req-1',
      action: 'PLAN_CREATED',
      actorRole: 'OPERATIONS',
    });
  });

  it('allows exactly one concurrent save for the same expected version', async () => {
    const repository = await setup();
    await createVersion(repository);

    const results = await Promise.allSettled([
      repository.save('version-1', 1, { status: 'IN_REVIEW' }),
      repository.save('version-1', 1, { status: 'STAFF_REVISION_REQUIRED' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'VERSION_CONFLICT', latestRecordVersion: 2 },
    });
  });

  it('uses independent audit ids for distinct writes sharing one request id', async () => {
    const repository = await setup();
    await repository.recordWrite({
      idempotencyKey: 'audit-key-a',
      requestId: 'shared-request-id',
      actorId: 'operator-1',
      actorRole: 'OPERATIONS',
      action: 'PLAN_CREATED',
      subjectId: 'version-1',
      result: { status: 'DRAFT' },
    });
    await repository.recordWrite({
      idempotencyKey: 'audit-key-b',
      requestId: 'shared-request-id',
      actorId: 'operator-1',
      actorRole: 'OPERATIONS',
      action: 'PLAN_UPDATED',
      subjectId: 'version-2',
      result: { status: 'IN_REVIEW' },
    });

    const audit = await database!.query<{ id: string; requestId: string }>(
      `SELECT id, request_id AS "requestId" FROM audit.audit_event WHERE request_id='shared-request-id' ORDER BY action`,
    );
    expect(audit.rows).toHaveLength(2);
    expect(new Set(audit.rows.map((row) => row.id)).size).toBe(2);
    expect(audit.rows.every((row) => row.requestId === 'shared-request-id')).toBe(true);
  });

  it('does not extend an expired active version while activating its replacement', async () => {
    const repository = await setup();
    const activationTime = new Date('2026-08-10T00:00:00Z');
    const expiredAt = new Date('2026-08-09T00:00:00Z');
    await createLifecycleVersion(repository, 'old-active', 1, 'ACTIVE', new Date('2026-08-01T00:00:00Z'), expiredAt);
    await createLifecycleVersion(repository, 'replacement', 2, 'SCHEDULED', activationTime, new Date('2026-08-20T00:00:00Z'));

    await repository.saveWithWrite('replacement', 1, {
      status: 'ACTIVE',
      payload: lifecyclePayload('replacement', 'ACTIVE', activationTime, new Date('2026-08-20T00:00:00Z')),
    }, writeMetadata('activate-replacement', 'replacement'), { userId: 'user-1', occurredAt: activationTime });

    expect((await repository.get('old-active'))?.effectiveTo).toEqual(expiredAt);
  });

  it('fails closed when activation finds multiple overlapping active versions', async () => {
    const repository = await setup();
    await database!.exec(`DROP INDEX planning.uq_plan_version_active_per_user`);
    const activationTime = new Date('2026-08-10T00:00:00Z');
    await createLifecycleVersion(repository, 'old-active-a', 1, 'ACTIVE', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-15T00:00:00Z'));
    await createLifecycleVersion(repository, 'old-active-b', 2, 'ACTIVE', new Date('2026-08-05T00:00:00Z'), new Date('2026-08-16T00:00:00Z'));
    await createLifecycleVersion(repository, 'replacement', 3, 'SCHEDULED', activationTime, new Date('2026-08-20T00:00:00Z'));
    const before = await database!.query(`SELECT id, status, effective_at, effective_to FROM planning.plan_version ORDER BY id`);
    expect(before.rows.filter((row: any) => row.status === 'ACTIVE')).toHaveLength(2);

    await expect(repository.saveWithWrite('replacement', 1, {
      status: 'ACTIVE',
      payload: lifecyclePayload('replacement', 'ACTIVE', activationTime, new Date('2026-08-20T00:00:00Z')),
    }, writeMetadata('activate-invalid', 'replacement'), { userId: 'user-1', occurredAt: activationTime }))
      .rejects.toThrow(/MULTIPLE_ACTIVE_PLAN_VERSIONS/);
    expect((await repository.get('replacement'))?.status).toBe('SCHEDULED');
  });

  it('locks, decides, writes, and audits with one trusted transaction time', async () => {
    const trustedNow = new Date('2026-08-09T12:00:00.000Z');
    const repository = await setup({ now: () => trustedNow });
    await createVersion(repository);
    let observedNow: Date | undefined;

    const result = await repository.transitionWithWrite(
      'version-1',
      writeMetadata('transaction-time', 'version-1'),
      (record, transactionNow) => {
        observedNow = transactionNow;
        return { patch: { status: 'IN_REVIEW', payload: record.payload } };
      },
    );

    expect(observedNow).toEqual(trustedNow);
    expect(result.record.status).toBe('IN_REVIEW');
    const audit = await database!.query<{ occurredAt: Date }>(
      `SELECT occurred_at AS "occurredAt" FROM audit.audit_event WHERE request_id='transaction-time'`,
    );
    expect(audit.rows).toEqual([{ occurredAt: trustedNow }]);
  });
});

async function createVersion(repository: PGlitePlanRepository) {
  const created = await repository.create({
    id: 'version-1',
    planId: 'plan-1',
    userId: 'user-1',
    versionNumber: 1,
    status: 'DRAFT',
    confirmationDeadlineAt: new Date('2026-08-09T12:00:00Z'),
    effectiveAt: new Date('2026-08-10T00:00:00Z'),
    effectiveTo: null,
    payload: { contentMode: 'REVIEWED' },
  });
  return created;
}

async function setup(clock?: { now(): Date }) {
  database = new PGlite();
  await applyMigrations(database);
  await database.exec(`
    INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
    VALUES ('user-1', 'invite-repo', 'hash', 'USER'), ('operator-1', 'operator-repo', 'hash', 'STAFF');
    INSERT INTO planning.plan (id, user_id) VALUES ('plan-1', 'user-1');
  `);
  return new PGlitePlanRepository(database, clock);
}

async function createLifecycleVersion(
  repository: PGlitePlanRepository,
  id: string,
  versionNumber: number,
  status: string,
  startsAt: Date,
  endsAt: Date,
) {
  const created = await repository.create({
    id,
    planId: 'plan-1',
    userId: 'user-1',
    versionNumber,
    status: 'DRAFT',
    confirmationDeadlineAt: new Date(startsAt.getTime() - 12 * 60 * 60 * 1000),
    effectiveAt: startsAt,
    effectiveTo: endsAt,
    payload: lifecyclePayload(id, status, startsAt, endsAt),
  });
  await database!.query(
    `UPDATE planning.plan_version SET status=$1, published_at=$2, payload=$3::jsonb WHERE id=$4`,
    [status, new Date(startsAt.getTime() - 48 * 60 * 60 * 1000), JSON.stringify(lifecyclePayload(id, status, startsAt, endsAt)), id],
  );
  return created;
}

function lifecyclePayload(id: string, status: string, startsAt: Date, endsAt: Date) {
  return {
    contentMode: 'REVIEWED',
    createdBy: 'operator-1',
    plan: {
      id,
      userId: 'user-1',
      status,
      effectiveAt: startsAt,
      effectiveTo: endsAt,
      publishedAt: new Date(startsAt.getTime() - 48 * 60 * 60 * 1000),
    },
  };
}

function writeMetadata(requestId: string, subjectId: string) {
  return {
    requestId,
    idempotencyKey: requestId,
    requestFingerprint: requestId,
    actorId: 'operator-1',
    actorRole: 'OPERATIONS' as const,
    operation: 'TRANSITION_PLAN_VERSION:ACTIVATE',
    action: 'PLAN_ACTIVATE',
    subjectId,
  };
}
