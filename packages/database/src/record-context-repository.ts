import type { Pool, PoolClient } from 'pg';

import {
  P11RecordRepositoryError,
  type P11RecordSchema,
  type P11RecordRepositoryErrorCode,
} from './record-repository.js';

export type P11RecordContextInput = Readonly<{
  sessionTokenHash: string;
  taskId: string;
  requestId: string;
  nodeEnv: 'test';
}>;

export type P11RecordContextEntry = Readonly<{
  fieldId: string;
  value: string | number | boolean;
}>;

export type P11RecordContextRecord = Readonly<{
  recordId: string;
  recordKindId: string;
  recordVersion: number;
  schemaVersion: string;
  entries: readonly P11RecordContextEntry[];
}>;

export type P11RecordContextResult = Readonly<{
  taskId: string;
  planVersion: string;
  businessDate: string;
  accessMode: 'EDITABLE' | 'READ_ONLY';
  records: readonly P11RecordContextRecord[];
}>;

export interface P11RecordContextPort {
  getContext(input: P11RecordContextInput, schema?: P11RecordSchema): Promise<P11RecordContextResult>;
}

export class P11RecordContextRepository implements P11RecordContextPort {
  constructor(private readonly pool: Pool) {}

  async getContext(input: P11RecordContextInput, schema?: P11RecordSchema): Promise<P11RecordContextResult> {
    const snapshot = validateInput(input);
    const approvedSchema = validateContextSchema(schema);
    const preflight = await this.pool.query<{ id: string; accountId: string }>(
      `SELECT id, account_id AS "accountId" FROM iam.session WHERE token_hash=$1`,
      [snapshot.sessionTokenHash],
    );
    if (preflight.rows.length !== 1) fail('SESSION_INVALID');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const principalId = preflight.rows[0]!.accountId;
      const sessionId = preflight.rows[0]!.id;
      await lockAccount(client, principalId);
      await lockSession(client, sessionId, principalId, snapshot.sessionTokenHash);
      const gate = await lockGate(client);
      if (snapshot.nodeEnv !== 'test' || gate.nodeEnv !== 'TEST' || !gate.testOnly
        || gate.approvedForRealUsers || !gate.routeAccessApproved) {
        fail('ROUTE_ACCESS_NOT_APPROVED');
      }

      const task = await lockTask(client, snapshot.taskId, principalId);
      if (task.gateId !== 'P11_RECORD_WRITE' || task.gateRevision !== gate.revision
        || task.schemaVersion.length === 0 || task.schemaVersion !== gate.schemaVersion
        || approvedSchema.version !== gate.schemaVersion) {
        fail('RECORD_SCHEMA_VERSION_CONFLICT');
      }
      if ([task.taskState, task.dateState, task.riskState].some((state) => state === 'UNKNOWN')) {
        fail('RECORD_STATE_BLOCKED');
      }

      await lockPlan(client, task.planId, principalId);
      await lockActivePlanVersion(client, task.planVersionId, task.planId, principalId, task.businessDate);
      const records = await readRecords(client, snapshot.taskId, principalId, task.businessDate,
        task.schemaVersion, approvedSchema);
      await client.query('COMMIT');

      return {
        taskId: snapshot.taskId,
        planVersion: task.planVersionId,
        businessDate: task.businessDate,
        accessMode: task.taskState === 'OPEN' && task.dateState === 'OPEN' && task.riskState === 'CLEAR'
          ? 'EDITABLE' : 'READ_ONLY',
        records,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function validateInput(input: P11RecordContextInput): P11RecordContextInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !hasExactKeys(input, ['sessionTokenHash', 'taskId', 'requestId', 'nodeEnv'])
    || !isValidIdentifier(input.sessionTokenHash)
    || !isValidIdentifier(input.taskId)
    || !isValidIdentifier(input.requestId)
    || input.nodeEnv !== 'test') {
    fail('RECORD_REQUEST_INVALID');
  }
  return Object.freeze({
    sessionTokenHash: input.sessionTokenHash,
    taskId: input.taskId,
    requestId: input.requestId,
    nodeEnv: input.nodeEnv,
  });
}

async function lockAccount(client: PoolClient, id: string): Promise<void> {
  const result = await client.query<{ accountType: string; status: string }>(
    `SELECT account_type AS "accountType", status
       FROM iam.account WHERE id=$1`, [id]);
  if (result.rows.length !== 1 || result.rows[0]!.accountType !== 'USER'
    || result.rows[0]!.status !== 'ACTIVE') {
    fail('SESSION_INVALID');
  }
}

async function lockSession(
  client: PoolClient,
  id: string,
  accountId: string,
  tokenHash: string,
): Promise<void> {
  const result = await client.query<{
    accountId: string;
    tokenHash: string;
    sessionKind: string;
    activeRole: string | null;
    sessionScope: string;
    revokedAt: Date | null;
    expired: boolean;
  }>(`SELECT account_id AS "accountId", token_hash AS "tokenHash", session_kind AS "sessionKind",
        active_role AS "activeRole", session_scope AS "sessionScope", revoked_at AS "revokedAt",
        clock_timestamp() >= expires_at AS expired
      FROM iam.session WHERE id=$1`, [id]);
  const row = result.rows[0];
  if (!row || row.accountId !== accountId || row.tokenHash !== tokenHash
    || row.sessionKind !== 'USER' || row.activeRole !== 'USER' || row.sessionScope !== 'FULL'
    || row.revokedAt || row.expired) {
    fail('SESSION_INVALID');
  }
}

async function lockGate(client: PoolClient) {
  const result = await client.query<{
    revision: string;
    nodeEnv: string;
    testOnly: boolean;
    approvedForRealUsers: boolean;
    routeAccessApproved: boolean;
    schemaVersion: string;
  }>(`SELECT revision, node_env AS "nodeEnv", test_only AS "testOnly",
        approved_for_real_users AS "approvedForRealUsers",
        route_access_approved AS "routeAccessApproved", schema_version AS "schemaVersion"
      FROM recording.p11_write_gate_revision
      WHERE gate_id='P11_RECORD_WRITE'
        AND revision=(SELECT current_revision FROM recording.p11_write_gate
                      WHERE id='P11_RECORD_WRITE')
      `);
  if (!result.rows[0]) fail('ROUTE_ACCESS_NOT_APPROVED');
  return result.rows[0];
}

async function lockTask(client: PoolClient, taskId: string, principalId: string) {
  const result = await client.query<{
    planId: string;
    planVersionId: string;
    businessDate: string;
    schemaVersion: string;
    gateId: string;
    gateRevision: string;
    taskState: string;
    dateState: string;
    riskState: string;
  }>(`SELECT plan_id AS "planId", plan_version_id AS "planVersionId",
        business_date::text AS "businessDate", schema_version AS "schemaVersion",
        gate_id AS "gateId", gate_revision AS "gateRevision", task_state AS "taskState",
        date_state AS "dateState", risk_state AS "riskState"
      FROM recording.record_task WHERE id=$1 AND user_id=$2`, [taskId, principalId]);
  if (!result.rows[0]) fail('RECORD_TASK_NOT_FOUND');
  return result.rows[0];
}

async function lockPlan(client: PoolClient, planId: string, principalId: string): Promise<void> {
  const result = await client.query(
    `SELECT id FROM planning.plan WHERE id=$1 AND user_id=$2`, [planId, principalId]);
  if (result.rows.length !== 1) fail('RECORD_PLAN_NOT_ACTIVE');
}

async function lockActivePlanVersion(
  client: PoolClient,
  versionId: string,
  planId: string,
  principalId: string,
  businessDate: string,
): Promise<void> {
  const result = await client.query(
    `SELECT id FROM planning.plan_version
      WHERE id=$1 AND plan_id=$2 AND user_id=$3 AND status='ACTIVE'
        AND effective_to IS NOT NULL
        AND effective_at <= CURRENT_TIMESTAMP
        AND CURRENT_TIMESTAMP < effective_to
      `, [versionId, planId, principalId]);
  if (result.rows.length !== 1) fail('RECORD_PLAN_NOT_ACTIVE');

  const active = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM planning.plan_version
      WHERE user_id=$1 AND status='ACTIVE'
        AND effective_to IS NOT NULL
        AND effective_at <= CURRENT_TIMESTAMP
        AND CURRENT_TIMESTAMP < effective_to`,
    [principalId],
  );
  if (active.rows[0]?.count !== 1) fail('RECORD_PLAN_NOT_ACTIVE');
}

async function readRecords(
  client: PoolClient,
  taskId: string,
  principalId: string,
  businessDate: string,
  schemaVersion: string,
  schema: P11RecordSchema,
): Promise<P11RecordContextRecord[]> {
  const result = await client.query<{
    recordId: string;
    recordKindId: string;
    recordVersion: number;
    schemaVersion: string;
    entries: unknown;
  }>(`SELECT id AS "recordId", record_kind_id AS "recordKindId", record_version AS "recordVersion",
        schema_version AS "schemaVersion", entries
      FROM recording.record
      WHERE task_id=$1 AND user_id=$2 AND business_date=$3::date AND schema_version=$4
      ORDER BY id
      `, [taskId, principalId, businessDate, schemaVersion]);
  return result.rows.map((row) => {
    if (!isValidIdentifier(row.recordId) || !isValidIdentifier(row.recordKindId)
      || row.schemaVersion !== schema.version) {
      fail('RECORD_SCHEMA_INVALID');
    }
    const kind = schema.recordKinds.find((candidate) => candidate.id === row.recordKindId);
    if (!kind) fail('RECORD_SCHEMA_INVALID');
    const fields = new Map(kind.fields.map((field) => [field.id, field]));
    const parsedEntries = parseEntries(row.entries);
    if (parsedEntries.some((entry) => fields.get(entry.fieldId)?.valueType !== entry.valueType)
      || kind.fields.some((field) => field.required
        && !parsedEntries.some((entry) => entry.fieldId === field.id))) {
      fail('RECORD_SCHEMA_INVALID');
    }
    return {
      recordId: row.recordId,
      recordKindId: row.recordKindId,
      recordVersion: validateRecordVersion(row.recordVersion),
      schemaVersion: row.schemaVersion,
      entries: parsedEntries.map(({ fieldId, value }) => ({ fieldId, value })),
    };
  });
}

type ParsedEntry = P11RecordContextEntry & { valueType: 'STRING' | 'NUMBER' | 'BOOLEAN' };

function parseEntries(value: unknown): ParsedEntry[] {
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== 'object'
    || Array.isArray(entry) || !hasExactKeys(entry, ['fieldId', 'valueType', 'value']))) {
    fail('RECORD_REQUEST_INVALID');
  }
  const fieldIds = new Set<string>();
  return value.map((entry) => {
    const candidate = entry as Record<string, unknown>;
    if (!isValidIdentifier(candidate.fieldId) || fieldIds.has(candidate.fieldId)
      || !['STRING', 'NUMBER', 'BOOLEAN'].includes(`${candidate.valueType}`)
      || (candidate.valueType === 'STRING' && typeof candidate.value !== 'string')
      || (candidate.valueType === 'NUMBER' && (typeof candidate.value !== 'number'
        || !Number.isFinite(candidate.value)))
      || (candidate.valueType === 'BOOLEAN' && typeof candidate.value !== 'boolean')) {
      fail('RECORD_REQUEST_INVALID');
    }
    fieldIds.add(candidate.fieldId);
    return {
      fieldId: candidate.fieldId as string,
      valueType: candidate.valueType as ParsedEntry['valueType'],
      value: candidate.value as string | number | boolean,
    };
  });
}

function validateContextSchema(schema: P11RecordSchema | undefined): P11RecordSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)
    || !hasExactKeys(schema, ['version', 'testOnly', 'approvedForRealUsers', 'recordKinds'])
    || !isValidIdentifier(schema.version) || schema.testOnly !== true
    || schema.approvedForRealUsers !== false || !Array.isArray(schema.recordKinds)
    || schema.recordKinds.length === 0
    || new Set(schema.recordKinds.map((kind) => kind?.id)).size !== schema.recordKinds.length) {
    fail('RECORD_SCHEMA_INVALID');
  }
  for (const kind of schema.recordKinds) {
    if (!kind || typeof kind !== 'object' || Array.isArray(kind)
      || !hasExactKeys(kind, ['id', 'fields', 'allowedActions'])
      || !isValidIdentifier(kind.id) || !Array.isArray(kind.fields)
      || !Array.isArray(kind.allowedActions) || kind.allowedActions.length !== 1
      || kind.allowedActions[0] !== 'UPSERT_RECORD'
      || new Set(kind.fields.map((field) => field?.id)).size !== kind.fields.length
      || kind.fields.some((field) => !field || typeof field !== 'object' || Array.isArray(field)
        || ((!hasExactKeys(field, ['id', 'valueType'])
          && !hasExactKeys(field, ['id', 'valueType', 'required']))
        || !isValidIdentifier(field.id)
        || (field.required !== undefined && typeof field.required !== 'boolean')
        || !['STRING', 'NUMBER', 'BOOLEAN'].includes(field.valueType)))) {
      fail('RECORD_SCHEMA_INVALID');
    }
  }
  return schema;
}

function validateRecordVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) fail('RECORD_REQUEST_INVALID');
  return value as number;
}

function fail(code: P11RecordRepositoryErrorCode): never {
  throw new P11RecordRepositoryError(code);
}

function isValidIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    && hasValidUnicode(value) && !/[\u0000-\u001f\u007f]/u.test(value);
}

function hasValidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasExactKeys(value: object, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
