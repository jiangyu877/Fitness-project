import { afterEach, describe, expect, it } from 'vitest';

import {
  startP11LocalOperableRuntime,
  type P11LocalOperableRuntime,
} from './support/p11-local-operable-runtime.js';
import { generatedTaskId } from './support/p10-task-generation.js';

const adminUrl = process.env.P11_LOCAL_POSTGRES_ADMIN_URL ?? process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

describe.runIf(Boolean(adminUrl))('P11 local operable runtime', () => {
  let runtime: P11LocalOperableRuntime | undefined;

  afterEach(async () => runtime?.close());

  it('publishes two strict fictional fixture sessions with isolated task locators', async () => {
    runtime = await startP11LocalOperableRuntime({ adminUrl: adminUrl!, port: 0 });
    const fixtures = await runtime.fixtureManifest();

    expect(fixtures.map(({ fixtureId, goalType }) => ({ fixtureId, goalType }))).toEqual([
      { fixtureId: 'persona_fat_loss', goalType: 'FAT_LOSS' },
      { fixtureId: 'persona_muscle_gain', goalType: 'MUSCLE_GAIN' },
    ]);
    expect(new Set(fixtures.map((fixture) => fixture.taskId)).size).toBe(2);
    expect(fixtures.every((fixture) => fixture.accountId && fixture.sessionToken && fixture.expiresAt)).toBe(true);
  });

  it('serves generated structural tasks for both personas', async () => {
    runtime = await startP11LocalOperableRuntime({ adminUrl: adminUrl!, port: 0 });
    const fixtures = await runtime.fixtureManifest();
    const response = await fetch(`${runtime.baseUrl}/p11-local/tasks`);
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.testOnly).toBe(true);
    expect(payload.fixtures).toHaveLength(2);
    for (const entry of payload.fixtures as Array<{ tasks: Array<Record<string, string>> }>) {
      expect(entry.tasks).toHaveLength(28);
      expect(entry.tasks[0]).toMatchObject({
        businessDate: '2026-01-01', taskState: 'OPEN', dateState: 'OPEN', riskState: 'CLEAR',
      });
      expect(entry.tasks.at(-1)).toMatchObject({ businessDate: '2026-01-28' });
      expect(Object.keys(entry.tasks[0]!).sort()).toEqual([
        'businessDate', 'dateState', 'riskState', 'taskId', 'taskState',
      ]);
    }
    const fatLoss = fixtures.find((fixture) => fixture.fixtureId === 'persona_fat_loss');
    expect(fatLoss?.taskId).toBe(generatedTaskId('p11-local-plan-version-fat-loss', '2026-01-02'));
    expect(new Set((payload.fixtures as Array<{ tasks: Array<{ taskId: string }> }>)
      .flatMap((entry) => entry.tasks.map((task) => task.taskId))).size).toBe(56);
  });

  it('writes independently through the local API and authoritative PG18 context', async () => {
    runtime = await startP11LocalOperableRuntime({ adminUrl: adminUrl!, port: 0 });
    const fixtureResponse = await fetch(`${runtime.baseUrl}/p11-local/fixtures`);
    const fixturePayload = await fixtureResponse.json();
    expect(fixtureResponse.status, JSON.stringify(fixturePayload)).toBe(200);
    expect(fixturePayload).toEqual({
      testOnly: true,
      fixtures: expect.arrayContaining([
        expect.objectContaining({ fixtureId: 'persona_fat_loss', goalType: 'FAT_LOSS' }),
        expect.objectContaining({ fixtureId: 'persona_muscle_gain', goalType: 'MUSCLE_GAIN' }),
      ]),
    });

    const fixtures = await runtime.fixtureManifest();
    const entries = new Map(fixtures.map((fixture) => [
      fixture.fixtureId,
      `opaque-local-${fixture.fixtureId}`,
    ]));
    for (const fixture of fixtures) {
      const before = await requestContext(runtime.baseUrl, fixture);
      expect(before).toMatchObject({
        businessStatus: 'RECORD_CONTEXT_AVAILABLE', taskId: fixture.taskId,
        accessMode: 'EDITABLE', records: [],
      });
      const entry = entries.get(fixture.fixtureId)!;
      const write = await fetch(`${runtime.baseUrl}/api/v1/record-tasks/${encodeURIComponent(fixture.taskId)}/commands`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fixture.sessionToken}`,
          'x-request-id': `runtime-request-${fixture.fixtureId}`,
          'idempotency-key': `runtime-idempotency-${fixture.fixtureId}`,
        },
        body: JSON.stringify({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: entry }],
        }),
      });
      expect(write.status).toBe(200);
      await expect(write.json()).resolves.toEqual({
        businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
        schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
      });
      const after = await requestContext(runtime.baseUrl, fixture);
      expect(after).toMatchObject({
        businessStatus: 'RECORD_CONTEXT_AVAILABLE', taskId: fixture.taskId,
        records: [{ recordKindId: 'kind-1', recordVersion: 1, entries: [{ fieldId: 'field-1', value: entry }] }],
      });
      for (const [fixtureId, otherEntry] of entries) {
        if (fixtureId !== fixture.fixtureId) {
          expect(JSON.stringify(after)).not.toContain(otherEntry);
        }
      }
    }
  });

  it('closes the loopback runtime through its test-only shutdown control', async () => {
    runtime = await startP11LocalOperableRuntime({ adminUrl: adminUrl!, port: 0 });
    const response = await fetch(`${runtime.baseUrl}/p11-local/shutdown`, { method: 'POST' });
    expect(response.status).toBe(202);
    await expect(fetch(`${runtime.baseUrl}/p11-local/fixtures`)).rejects.toThrow();
    await runtime.close();
  });

  it('maps a missing task context to the stable anti-enumeration error', async () => {
    runtime = await startP11LocalOperableRuntime({ adminUrl: adminUrl!, port: 0 });
    const [fixture] = await runtime.fixtureManifest();
    const response = await fetch(`${runtime.baseUrl}/api/v1/record-tasks/missing-opaque-task/context`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${fixture!.sessionToken}`,
        'x-request-id': 'runtime-missing-context-request',
      },
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(404);
    expect(body).toEqual({
      businessStatus: 'RECORD_CONTEXT_BLOCKED',
      errorCode: 'RECORD_TASK_NOT_FOUND',
      recoverableActions: [],
      clientStateDisposition: 'CLEAR_ALL',
      requestId: 'runtime-missing-context-request',
    });
  });

  it('maps cross-subject context access to the same anti-enumeration error', async () => {
    runtime = await startP11LocalOperableRuntime({ adminUrl: adminUrl!, port: 0 });
    const fixtures = await runtime.fixtureManifest();
    const fatLoss = fixtures.find((fixture) => fixture.fixtureId === 'persona_fat_loss')!;
    const muscleGain = fixtures.find((fixture) => fixture.fixtureId === 'persona_muscle_gain')!;
    const response = await fetch(`${runtime.baseUrl}/api/v1/record-tasks/${encodeURIComponent(muscleGain.taskId)}/context`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${fatLoss.sessionToken}`,
        'x-request-id': 'runtime-cross-subject-context-request',
      },
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(404);
    expect(body).toEqual({
      businessStatus: 'RECORD_CONTEXT_BLOCKED',
      errorCode: 'RECORD_TASK_NOT_FOUND',
      recoverableActions: [],
      clientStateDisposition: 'CLEAR_ALL',
      requestId: 'runtime-cross-subject-context-request',
    });
    expect(JSON.stringify(body)).not.toContain(muscleGain.taskId);
    expect(JSON.stringify(body)).not.toContain(muscleGain.accountId);
  });
});

async function requestContext(
  baseUrl: string,
  fixture: { taskId: string; sessionToken: string },
): Promise<unknown> {
  const response = await fetch(`${baseUrl}/api/v1/record-tasks/${encodeURIComponent(fixture.taskId)}/context`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${fixture.sessionToken}`,
      'x-request-id': `runtime-context-${fixture.taskId}`,
    },
  });
  expect(response.status).toBe(200);
  return response.json();
}
