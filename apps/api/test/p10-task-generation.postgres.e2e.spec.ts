import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApplication } from './build-test-application.js';
import {
  businessDatesForWindow, generateActiveWindowTasks, generatedTaskId, p10Fixture, withP10Postgres,
} from './support/p10-task-generation.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;
const expectedDates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'] as const;

function generationInput(trustedNow: string = p10Fixture.trustedNow) {
  return { userId: p10Fixture.userId, trustedNow: new Date(trustedNow), schemaVersion: p10Fixture.schemaVersion };
}

describe.runIf(Boolean(adminUrl)).sequential('P10 active window task generation', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    const current = app;
    app = undefined;
    await current?.close();
  });

  it('generates one structural task per Shanghai business date for the unique ACTIVE window', async () => {
    await withP10Postgres(adminUrl!, async ({ pool }) => {
      const result = await generateActiveWindowTasks(pool, generationInput());
      expect(result).toEqual({
        outcome: 'GENERATED',
        planId: p10Fixture.planId,
        planVersionId: p10Fixture.planVersionId,
        businessDates: [...expectedDates],
        taskIds: expectedDates.map((date) => generatedTaskId(p10Fixture.planVersionId, date)),
      });
      const rows = await pool.query(
        `SELECT id, user_id AS "userId", plan_id AS "planId", plan_version_id AS "planVersionId",
           business_date::text AS "businessDate", schema_version AS "schemaVersion",
           gate_id AS "gateId", gate_revision::integer AS "gateRevision", close_policy AS "closePolicy",
           task_state AS "taskState", date_state AS "dateState", risk_state AS "riskState"
         FROM recording.record_task WHERE user_id=$1 ORDER BY business_date`, [p10Fixture.userId]);
      expect(rows.rows).toEqual(expectedDates.map((date) => ({
        id: generatedTaskId(p10Fixture.planVersionId, date),
        userId: p10Fixture.userId, planId: p10Fixture.planId, planVersionId: p10Fixture.planVersionId,
        businessDate: date, schemaVersion: 'schema-v1', gateId: 'P11_RECORD_WRITE', gateRevision: 1,
        closePolicy: 'TEST_ONLY_EXPLICIT', taskState: 'OPEN', dateState: 'OPEN', riskState: 'CLEAR',
      })));
    });
  });

  it('keeps generation idempotent across repeated runs', async () => {
    await withP10Postgres(adminUrl!, async ({ pool }) => {
      const first = await generateActiveWindowTasks(pool, generationInput());
      const second = await generateActiveWindowTasks(pool, generationInput());
      expect(first.outcome).toBe('GENERATED');
      expect(second).toEqual(first);
      const count = await pool.query(
        `SELECT count(*)::integer AS count FROM recording.record_task WHERE user_id=$1`, [p10Fixture.userId]);
      expect(count.rows[0]).toEqual({ count: expectedDates.length });
    });
  });

  it('binds a generated task to the real record command route', async () => {
    await withP10Postgres(adminUrl!, async ({ pool, createApplication }) => {
      app = await createApplication(buildApplication);
      const generated = await generateActiveWindowTasks(pool, generationInput());
      expect(generated.outcome).toBe('GENERATED');
      const taskId = generatedTaskId(p10Fixture.planVersionId, '2026-01-02');
      const response = await request(app.getHttpServer())
        .post(`/api/v1/record-tasks/${taskId}/commands`)
        .set('Authorization', `Bearer ${p10Fixture.sessionToken}`)
        .set('x-request-id', p10Fixture.requestId)
        .set('idempotency-key', p10Fixture.idempotencyKey)
        .send({
          operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
          expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: p10Fixture.entry }],
        });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1, schemaVersion: 'schema-v1',
        nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
      });
      const records = await pool.query(
        `SELECT task_id AS "taskId", user_id AS "userId", business_date::text AS "businessDate",
           record_version AS "recordVersion"
         FROM recording.record WHERE task_id=$1`, [taskId]);
      expect(records.rows).toEqual([{
        taskId, userId: p10Fixture.userId, businessDate: '2026-01-02', recordVersion: 1,
      }]);
    });
  });

  it('refuses generation without writes when no unique ACTIVE version covers the trusted time', async () => {
    await withP10Postgres(adminUrl!, async ({ pool }) => {
      const outside = await generateActiveWindowTasks(pool, generationInput('2026-01-10T00:00:00.000Z'));
      expect(outside).toEqual({ outcome: 'REFUSED', reason: 'PLAN_GAP' });
      await pool.query(`DROP INDEX planning.uq_plan_version_active_per_user`);
      await pool.query(
        `INSERT INTO planning.plan_version (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at, effective_at, effective_to, professional_rules_approved, demo_only, payload) VALUES ($1,$2,$3,2,'ACTIVE',TIMESTAMPTZ '2025-12-31T00:00:00Z',TIMESTAMPTZ '2026-01-01T12:00:00Z',TIMESTAMPTZ '2026-01-02T00:00:00Z',TIMESTAMPTZ '2026-01-06T00:00:00Z',false,true,$4)`,
        ['p10-plan-version-2', p10Fixture.planId, p10Fixture.userId, JSON.stringify({ fixtureId: 'p10-fixture', goalType: 'FAT_LOSS' })]);
      const multiple = await generateActiveWindowTasks(pool, generationInput());
      expect(multiple).toEqual({ outcome: 'REFUSED', reason: 'PLAN_STATE_INVALID' });
      const count = await pool.query(
        `SELECT count(*)::integer AS count FROM recording.record_task WHERE user_id=$1`, [p10Fixture.userId]);
      expect(count.rows[0]).toEqual({ count: 0 });
    });
  });

  it('maps business dates to the window with the authoritative Asia/Shanghai boundary', () => {
    expect(businessDatesForWindow(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-04T00:00:00.000Z')))
      .toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    expect(businessDatesForWindow(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-03T16:00:00.000Z')))
      .toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });
});
