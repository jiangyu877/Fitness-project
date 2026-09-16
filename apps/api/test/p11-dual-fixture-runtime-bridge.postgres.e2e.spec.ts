import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApplication } from './build-test-application.js';
import { withIsolatedPostgres } from './support/p11-dual-fixture-runtime-bridge.js';

const adminUrl = process.env.LIANBAN_TEST_POSTGRES_ADMIN_URL;

describe.runIf(Boolean(adminUrl)).sequential('P11 dual fixture runtime bridge', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('maps both trusted personas through the record command route into PG18 subject, task, goal and audit rows', async () => {
    await withIsolatedPostgres(adminUrl!, async ({ pool, fixtures, createApplication }) => {
      app = await createApplication(buildApplication);
      for (const persona of fixtures) {
        const response = await request(app.getHttpServer())
          .post(`/api/v1/record-tasks/${persona.taskId}/commands`)
          .set('Authorization', `Bearer ${persona.sessionToken}`)
          .set('x-request-id', persona.requestId)
          .set('idempotency-key', persona.idempotencyKey)
          .send({ operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1', expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: persona.entry }] });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1, schemaVersion: 'schema-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [] });
        expect(JSON.stringify(response.body)).not.toContain(persona.sessionToken);
        expect(JSON.stringify(response.body)).not.toContain(persona.idempotencyKey);
        expect(JSON.stringify(response.body)).not.toContain(persona.entry);

        const rows = await pool.query(`SELECT r.user_id AS "userId", r.task_id AS "taskId", r.business_date::text AS "businessDate", r.record_kind_id AS "recordKindId", r.schema_version AS "schemaVersion", r.record_version AS "recordVersion", r.entries, i.key_id AS "keyId", i.idempotency_key_digest AS "keyDigest", i.intent_digest AS "intentDigest", i.principal_id AS "idemPrincipal", i.session_id AS "idemSession", i.task_id AS "idemTask", i.record_kind_id AS "idemRecordKind", i.schema_version AS "idemSchema", i.operation AS "idemOperation", i.status AS "idemStatus", i.record_id AS "idemRecordId", i.replay_result AS "replayResult", a.actor_id AS "auditActor", a.subject_type AS "auditSubject", a.task_id AS "auditTask", a.record_id AS "auditRecordId", a.request_id AS "auditRequestId", a.record_version AS "auditRecordVersion", a.schema_version AS "auditSchema" FROM recording.record r JOIN recording.record_idempotency i ON i.task_id=r.task_id JOIN recording.record_success_audit a ON a.task_id=r.task_id WHERE r.task_id=$1`, [persona.taskId]);
        const row = rows.rows[0] as Record<string, unknown>;
        expect(row).toMatchObject({
          userId: persona.userId, taskId: persona.taskId, businessDate: '2026-01-02',
          recordKindId: 'kind-1', schemaVersion: 'schema-v1', recordVersion: 1,
          entries: [{ fieldId: 'field-1', valueType: 'STRING', value: persona.entry }],
          keyId: 'test-key-v1', idemPrincipal: persona.userId, idemSession: persona.sessionId,
          idemTask: persona.taskId, idemRecordKind: 'kind-1', idemSchema: 'schema-v1',
          idemOperation: 'UPSERT_RECORD', idemStatus: 'COMPLETED',
          auditActor: persona.userId, auditSubject: 'P11_RECORD', auditTask: persona.taskId,
          auditRequestId: persona.requestId, auditRecordVersion: 1, auditSchema: 'schema-v1',
        });
        expect(toBuffer(row.keyDigest)).toEqual(digestBytes('lianban:p11:idempotency-key:v1', persona.idempotencyKey));
        expect(toBuffer(row.intentDigest)).toEqual(digestBytes('lianban:p11:record-intent:v1', JSON.stringify({
          domain: 'lianban:p11:record-intent:v1', operation: 'UPSERT_RECORD', recordKindId: 'kind-1',
          schemaVersion: 'schema-v1', expectedRecordVersion: null,
          entries: [{ fieldId: 'field-1', valueType: 'STRING', value: persona.entry }],
        })));
        expect(row.idemRecordId).toBe(row.auditRecordId);
        expect(row.replayResult).toEqual({ recordId: row.idemRecordId, recordVersion: 1, schemaVersion: 'schema-v1' });
        const goal = await pool.query(`SELECT goal_type AS "goalType" FROM care.user_profile WHERE user_id=$1`, [persona.userId]);
        expect(goal.rows).toEqual([{ goalType: persona.goalType }]);
      }
    });
  });
});

function digestBytes(domain: string, value: string): Buffer {
  return createHmac('sha256', Buffer.from('fictional-p11-active-key-material'))
    .update(domain).update('\0').update(value).digest();
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string' && /^\\x[0-9a-f]+$/i.test(value)) return Buffer.from(value.slice(2), 'hex');
  throw new Error('EXPECTED_PG18_BYTEA');
}
