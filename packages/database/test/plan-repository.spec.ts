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
      action: 'PLAN_CREATED',
      subjectId: 'version-1',
      result: { status: 'DRAFT' },
    });
    const replay = await repository.recordWrite({
      idempotencyKey: 'request-1',
      requestId: 'req-2',
      actorId: 'operator-1',
      action: 'PLAN_CREATED',
      subjectId: 'version-1',
      result: { status: 'CHANGED' },
    });

    expect(replay).toEqual({ ...first, replayed: true });
    const audit = await repository.listAudit('version-1');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ requestId: 'req-1', action: 'PLAN_CREATED' });
  });
});

async function setup() {
  database = new PGlite();
  await applyMigrations(database);
  await database.exec(`
    INSERT INTO iam.account (id, login_identifier, password_hash, account_type)
    VALUES ('user-1', 'invite-repo', 'hash', 'USER'), ('operator-1', 'operator-repo', 'hash', 'STAFF');
    INSERT INTO planning.plan (id, user_id) VALUES ('plan-1', 'user-1');
  `);
  return new PGlitePlanRepository(database);
}
