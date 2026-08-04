import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type P11ScalarType = 'STRING' | 'NUMBER' | 'BOOLEAN';
export type P11Entry = { fieldId: string; valueType: P11ScalarType; value: string | number | boolean };
export type P11RecordSchema = {
  version: string;
  testOnly: true;
  approvedForRealUsers: false;
  recordKinds: Array<{
    id: string;
    fields: Array<{ id: string; valueType: P11ScalarType; required?: boolean }>;
    allowedActions: ['UPSERT_RECORD'];
  }>;
};
export type P11UpsertInput = {
  sessionTokenHash: string;
  taskId: string;
  idempotencyKey: string;
  requestId: string;
  nodeEnv: 'test';
  schema: P11RecordSchema;
  command: {
    operation: 'UPSERT_RECORD';
    recordKindId: string;
    schemaVersion: string;
    expectedRecordVersion: number | null;
    entries: P11Entry[];
  };
};
export type P11RecordResult = { recordId: string; recordVersion: number; schemaVersion: string };
export type P11RecordRepositoryErrorCode =
  | 'SESSION_INVALID' | 'RECORD_TASK_NOT_FOUND' | 'RECORD_PLAN_NOT_ACTIVE'
  | 'RECORD_STATE_BLOCKED' | 'RECORD_SCHEMA_UNAVAILABLE' | 'RECORD_SCHEMA_INVALID'
  | 'RECORD_SCHEMA_VERSION_CONFLICT' | 'RECORD_VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED' | 'ROUTE_ACCESS_NOT_APPROVED'
  | 'RECORD_REQUEST_INVALID' | 'HMAC_KEY_UNAVAILABLE';

export class P11RecordRepositoryError extends Error {
  constructor(readonly code: P11RecordRepositoryErrorCode) {
    super(code);
  }
}

type Keyring = { activeKeyId: string; keys: Map<string, Buffer> };

export class P11RecordRepository {
  private readonly activeKeyId: string;
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(private readonly pool: Pool, keyring: Keyring) {
    this.activeKeyId = keyring.activeKeyId;
    this.keys = new Map([...keyring.keys].map(([id, key]) => [id, Buffer.from(key)]));
  }

  async upsert(input: P11UpsertInput): Promise<P11RecordResult> {
    const snapshot = validateInput(input);
    const activeKey = this.keys.get(this.activeKeyId);
    if (!activeKey) fail('HMAC_KEY_UNAVAILABLE');
    const preflight = await this.pool.query<{ id: string; accountId: string }>(
      `SELECT id, account_id AS "accountId" FROM iam.session WHERE token_hash=$1`,
      [snapshot.sessionTokenHash],
    );
    if (preflight.rows.length !== 1) fail('SESSION_INVALID');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const principalId = preflight.rows[0]!.accountId;
      const sessionId = preflight.rows[0]!.id;
      await lockAccount(client, principalId);
      await lockSession(client, sessionId, principalId, snapshot.sessionTokenHash);
      const gate = await lockGate(client);
      if (gate.hmacKeyId !== this.activeKeyId || !this.keys.has(gate.hmacKeyId)) {
        fail('HMAC_KEY_UNAVAILABLE');
      }
      if (snapshot.nodeEnv !== 'test' || gate.nodeEnv !== 'TEST' || !gate.testOnly
        || gate.approvedForRealUsers || !gate.routeAccessApproved || !gate.writeEnabled) {
        fail('ROUTE_ACCESS_NOT_APPROVED');
      }
      const task = await lockTask(client, snapshot.taskId, principalId);
      if (task.gateRevision !== gate.revision) fail('ROUTE_ACCESS_NOT_APPROVED');
      if (task.taskState !== 'OPEN' || task.dateState !== 'OPEN' || task.riskState !== 'CLEAR'
        || task.closePolicy !== 'TEST_ONLY_EXPLICIT') fail('RECORD_STATE_BLOCKED');
      if (task.schemaVersion !== gate.schemaVersion) fail('RECORD_SCHEMA_VERSION_CONFLICT');
      await lockPlan(client, task.planId, principalId);
      await lockActivePlanVersion(client, task.planVersionId, task.planId, principalId, task.businessDate);

      const existingRecord = await client.query<{ id: string; recordVersion: number }>(
        `SELECT id, record_version AS "recordVersion" FROM recording.record
         WHERE task_id=$1 AND record_kind_id=$2 FOR UPDATE`,
        [snapshot.taskId, snapshot.recordKindId],
      );
      await revalidateSessionAuthority(client, sessionId, principalId, snapshot.sessionTokenHash);
      const replay = await findReplay(client, this.keys, snapshot.idempotencyKey);
      const intentDigest = digest(activeKey, 'lianban:p11:record-intent:v1', snapshot.canonicalIntent);
      if (replay) {
        const verifyKey = this.keys.get(replay.keyId);
        if (!verifyKey) fail('HMAC_KEY_UNAVAILABLE');
        const expected = digest(verifyKey, 'lianban:p11:record-intent:v1', snapshot.canonicalIntent);
        if (replay.principalId !== principalId || replay.taskId !== snapshot.taskId
          || replay.businessDate !== task.businessDate || replay.recordKindId !== snapshot.recordKindId
          || replay.schemaVersion !== snapshot.schemaVersion || replay.operation !== 'UPSERT_RECORD'
          || !timingSafeEqual(replay.intentDigest, expected)) {
          fail('IDEMPOTENCY_KEY_REUSED');
        }
        if (replay.status !== 'COMPLETED' || !replay.replayResult) fail('IDEMPOTENCY_KEY_REUSED');
        const replayResult = parseReplayResult(
          replay.replayResult, replay.persistedRecordId, replay.schemaVersion,
        );
        await client.query('COMMIT');
        return replayResult;
      }
      if (await hasUnknownHistoricalKey(client, this.keys)) {
        fail('HMAC_KEY_UNAVAILABLE');
      }
      if (task.schemaVersion !== snapshot.schemaVersion) fail('RECORD_SCHEMA_VERSION_CONFLICT');
      const current = existingRecord.rows[0];
      if ((current && snapshot.expectedRecordVersion !== current.recordVersion)
        || (!current && snapshot.expectedRecordVersion !== null)) fail('RECORD_VERSION_CONFLICT');
      const keyDigest = digest(activeKey, 'lianban:p11:idempotency-key:v1', snapshot.idempotencyKey);
      await client.query(`INSERT INTO recording.record_idempotency
        (key_id, idempotency_key_digest, intent_digest, principal_id, session_id, task_id,
         business_date, record_kind_id, schema_version, operation, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'UPSERT_RECORD','CLAIMED')`,
      [this.activeKeyId, keyDigest, intentDigest, principalId, sessionId, snapshot.taskId,
        task.businessDate, snapshot.recordKindId, snapshot.schemaVersion]);

      const recordId = current?.id ?? randomUUID();
      const recordVersion = (current?.recordVersion ?? 0) + 1;
      if (current) {
        await client.query(`UPDATE recording.record SET record_version=$2, entries=$3, updated_at=now()
          WHERE id=$1`, [recordId, recordVersion, JSON.stringify(snapshot.entries)]);
      } else {
        await client.query(`INSERT INTO recording.record
          (id, task_id, user_id, business_date, record_kind_id, schema_version, record_version, entries)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [recordId, snapshot.taskId, principalId, task.businessDate, snapshot.recordKindId,
          snapshot.schemaVersion, recordVersion, JSON.stringify(snapshot.entries)]);
      }
      const result = { recordId, recordVersion, schemaVersion: snapshot.schemaVersion };
      await client.query(`UPDATE recording.record_idempotency SET status='COMPLETED', record_id=$3,
        replay_result=$4, completed_at=now() WHERE key_id=$1 AND idempotency_key_digest=$2`,
      [this.activeKeyId, keyDigest, recordId, JSON.stringify(result)]);
      await client.query(`INSERT INTO recording.record_success_audit
        (id, actor_id, actor_role, action, subject_type, record_id, task_id,
         request_id, record_version, schema_version)
        VALUES ($1,$2,'USER','RECORD_UPSERTED','P11_RECORD',$3,$4,$5,$6,$7)`,
      [randomUUID(), principalId, recordId, snapshot.taskId, snapshot.requestId, recordVersion,
        snapshot.schemaVersion]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function validateInput(input: P11UpsertInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !hasExactKeys(input, [
      'sessionTokenHash', 'taskId', 'idempotencyKey', 'requestId', 'nodeEnv', 'schema', 'command',
    ])
    || !isValidIdentifier(input.sessionTokenHash) || !isValidIdentifier(input.taskId)
    || !isValidIdentifier(input.idempotencyKey) || !isValidIdentifier(input.requestId)
    || !input.command || typeof input.command !== 'object' || Array.isArray(input.command)
    || !hasExactKeys(input.command, [
      'operation', 'recordKindId', 'schemaVersion', 'expectedRecordVersion', 'entries',
    ]) || input.command.operation !== 'UPSERT_RECORD'
    || !isValidIdentifier(input.command.recordKindId)
    || !isValidIdentifier(input.command.schemaVersion)
    || !Array.isArray(input.command.entries)) {
    fail('RECORD_REQUEST_INVALID');
  }
  if (!input.schema || !hasExactKeys(input.schema, [
    'version', 'testOnly', 'approvedForRealUsers', 'recordKinds',
  ]) || !isValidIdentifier(input.schema.version)
    || !Array.isArray(input.schema.recordKinds)
    || !isDenseArray(input.schema.recordKinds)
    || input.schema.recordKinds.length === 0
    || input.schema.recordKinds.some((kind) => !kind || typeof kind !== 'object' || Array.isArray(kind)
      || !hasExactKeys(kind, [
      'id', 'fields', 'allowedActions',
    ]) || !isValidIdentifier(kind.id) || !Array.isArray(kind.fields)
      || !isDenseArray(kind.fields)
      || !Array.isArray(kind.allowedActions)
      || kind.allowedActions.length !== 1 || kind.allowedActions[0] !== 'UPSERT_RECORD'
      || new Set(kind.fields.map((field) => field?.id)).size !== kind.fields.length
      || kind.fields.some((field) => !field || typeof field !== 'object' || Array.isArray(field)
        || ((!hasExactKeys(field, ['id', 'valueType'])
        && !hasExactKeys(field, ['id', 'valueType', 'required']))
        || !isValidIdentifier(field.id)
        || ('required' in field && typeof field.required !== 'boolean')
        || !['STRING', 'NUMBER', 'BOOLEAN'].includes(field.valueType))))
    || new Set(input.schema.recordKinds.map((kind) => kind.id)).size !== input.schema.recordKinds.length) {
    fail('RECORD_SCHEMA_INVALID');
  }
  if (input.schema.testOnly !== true || input.schema.approvedForRealUsers !== false
    || input.nodeEnv !== 'test') fail('ROUTE_ACCESS_NOT_APPROVED');
  const kind = input.schema.recordKinds.find((candidate) => candidate.id === input.command.recordKindId);
  if (!kind) {
    fail('RECORD_SCHEMA_INVALID');
  }
  if (input.command.schemaVersion !== input.schema.version) fail('RECORD_SCHEMA_VERSION_CONFLICT');
  if (input.command.expectedRecordVersion !== null
    && (!Number.isInteger(input.command.expectedRecordVersion) || input.command.expectedRecordVersion < 1)) {
    fail('RECORD_REQUEST_INVALID');
  }
  const fields = new Map(kind.fields.map((field) => [field.id, field.valueType]));
  if (fields.size === 0 || fields.size !== kind.fields.length
    || input.command.entries.length !== fields.size) {
    fail('RECORD_SCHEMA_INVALID');
  }
  const entries = [...input.command.entries];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !hasExactKeys(entry, ['fieldId', 'valueType', 'value'])
      || !isValidIdentifier(entry.fieldId) || seen.has(entry.fieldId)
      || fields.get(entry.fieldId) !== entry.valueType
      || !valueMatches(entry.valueType, entry.value)
      || (typeof entry.value === 'string'
        && (!hasValidUnicode(entry.value) || entry.value.includes('\0')))) {
      fail('RECORD_SCHEMA_INVALID');
    }
    seen.add(entry.fieldId);
    if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) fail('RECORD_SCHEMA_INVALID');
  }
  const canonicalEntries = entries.sort(compareFieldIds).map((entry) => ({
    fieldId: entry.fieldId,
    valueType: entry.valueType,
    value: typeof entry.value === 'number' && Object.is(entry.value, -0) ? 0 : entry.value,
  }));
  const canonicalIntent = JSON.stringify({
    domain: 'lianban:p11:record-intent:v1', operation: 'UPSERT_RECORD',
    recordKindId: input.command.recordKindId, schemaVersion: input.command.schemaVersion,
    expectedRecordVersion: input.command.expectedRecordVersion, entries: canonicalEntries,
  });
  return {
    sessionTokenHash: `${input.sessionTokenHash}`,
    taskId: `${input.taskId}`,
    idempotencyKey: `${input.idempotencyKey}`,
    requestId: `${input.requestId}`,
    nodeEnv: input.nodeEnv,
    recordKindId: `${input.command.recordKindId}`,
    schemaVersion: `${input.command.schemaVersion}`,
    expectedRecordVersion: input.command.expectedRecordVersion,
    entries: canonicalEntries.map((entry) => ({ ...entry })),
    canonicalIntent,
  };
}

function compareFieldIds(left: P11Entry, right: P11Entry) {
  return left.fieldId < right.fieldId ? -1 : left.fieldId > right.fieldId ? 1 : 0;
}

function isDenseArray(value: unknown[]) {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function isValidIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    && hasValidUnicode(value) && !/[\u0000-\u001f\u007f]/u.test(value);
}

function hasValidUnicode(value: string) {
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

function hasExactKeys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function valueMatches(type: P11ScalarType, value: unknown) {
  return (type === 'STRING' && typeof value === 'string')
    || (type === 'NUMBER' && typeof value === 'number')
    || (type === 'BOOLEAN' && typeof value === 'boolean');
}

function digest(key: Buffer, domain: string, value: string) {
  return createHmac('sha256', key).update(domain).update('\0').update(value).digest();
}

async function lockAccount(client: PoolClient, id: string) {
  const result = await client.query<{ accountType: string; status: string }>(
    `SELECT account_type AS "accountType", status FROM iam.account WHERE id=$1 FOR UPDATE`, [id]);
  if (result.rows.length !== 1 || result.rows[0]!.accountType !== 'USER' || result.rows[0]!.status !== 'ACTIVE') {
    fail('SESSION_INVALID');
  }
}

async function lockSession(client: PoolClient, id: string, accountId: string, tokenHash: string) {
  const result = await client.query<{ accountId: string; tokenHash: string; sessionKind: string;
    activeRole: string | null; sessionScope: string; revokedAt: Date | null; expired: boolean }>(
    `SELECT account_id AS "accountId", token_hash AS "tokenHash", session_kind AS "sessionKind",
      active_role AS "activeRole", session_scope AS "sessionScope", revoked_at AS "revokedAt",
      clock_timestamp() >= expires_at AS expired FROM iam.session WHERE id=$1 FOR UPDATE`, [id]);
  const row = result.rows[0];
  if (!row || row.accountId !== accountId || row.tokenHash !== tokenHash || row.sessionKind !== 'USER'
    || row.activeRole !== 'USER' || row.sessionScope !== 'FULL' || row.revokedAt
    || row.expired) fail('SESSION_INVALID');
}

async function revalidateSessionAuthority(
  client: PoolClient,
  id: string,
  accountId: string,
  tokenHash: string,
) {
  const result = await client.query<{ valid: boolean }>(`
    SELECT session.account_id=$2
      AND session.token_hash=$3
      AND session.session_kind='USER'
      AND session.active_role='USER'
      AND session.session_scope='FULL'
      AND session.revoked_at IS NULL
      AND clock_timestamp() < session.expires_at
      AND account.account_type='USER'
      AND account.status='ACTIVE' AS valid
    FROM iam.session session
    JOIN iam.account account ON account.id=session.account_id
    WHERE session.id=$1
  `, [id, accountId, tokenHash]);
  if (result.rows.length !== 1 || result.rows[0]!.valid !== true) fail('SESSION_INVALID');
}

async function lockGate(client: PoolClient) {
  const gate = await client.query<{ revision: string }>(
    `SELECT current_revision AS revision FROM recording.p11_write_gate
     WHERE id='P11_RECORD_WRITE' FOR UPDATE`);
  if (!gate.rows[0]) fail('ROUTE_ACCESS_NOT_APPROVED');
  const revision = gate.rows[0].revision;
  const result = await client.query<{ revision: string; nodeEnv: string; testOnly: boolean;
    approvedForRealUsers: boolean; routeAccessApproved: boolean; writeEnabled: boolean;
    schemaVersion: string; hmacKeyId: string }>(
    `SELECT revision, node_env AS "nodeEnv", test_only AS "testOnly",
      approved_for_real_users AS "approvedForRealUsers", route_access_approved AS "routeAccessApproved",
      write_enabled AS "writeEnabled", schema_version AS "schemaVersion", hmac_key_id AS "hmacKeyId"
     FROM recording.p11_write_gate_revision WHERE gate_id='P11_RECORD_WRITE' AND revision=$1 FOR UPDATE`,
    [revision]);
  if (!result.rows[0]) fail('ROUTE_ACCESS_NOT_APPROVED');
  return { ...result.rows[0], revision };
}

async function lockTask(client: PoolClient, taskId: string, principalId: string) {
  const result = await client.query<{ planId: string; planVersionId: string; businessDate: string;
    schemaVersion: string; gateRevision: string; closePolicy: string; taskState: string;
    dateState: string; riskState: string }>(
    `SELECT plan_id AS "planId", plan_version_id AS "planVersionId", business_date::text AS "businessDate",
      schema_version AS "schemaVersion", gate_revision AS "gateRevision", close_policy AS "closePolicy",
      task_state AS "taskState", date_state AS "dateState", risk_state AS "riskState"
     FROM recording.record_task WHERE id=$1 AND user_id=$2 FOR UPDATE`, [taskId, principalId]);
  if (!result.rows[0]) fail('RECORD_TASK_NOT_FOUND');
  return result.rows[0];
}

async function lockPlan(client: PoolClient, planId: string, principalId: string) {
  const result = await client.query(`SELECT id FROM planning.plan WHERE id=$1 AND user_id=$2 FOR UPDATE`,
    [planId, principalId]);
  if (result.rows.length !== 1) fail('RECORD_PLAN_NOT_ACTIVE');
}

async function lockActivePlanVersion(client: PoolClient, versionId: string, planId: string,
  principalId: string, businessDate: string) {
  const result = await client.query(`SELECT id FROM planning.plan_version
    WHERE id=$1 AND plan_id=$2 AND user_id=$3 AND status='ACTIVE'
      AND effective_at < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
      AND (effective_to IS NULL
        OR effective_to > ($4::date::timestamp AT TIME ZONE 'Asia/Shanghai')) FOR UPDATE`,
  [versionId, planId, principalId, businessDate]);
  if (result.rows.length !== 1) fail('RECORD_PLAN_NOT_ACTIVE');
  const active = await client.query<{ count: number }>(`SELECT count(*)::integer AS count
    FROM planning.plan_version WHERE user_id=$1 AND status='ACTIVE'
      AND effective_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
      AND (effective_to IS NULL
        OR effective_to > ($2::date::timestamp AT TIME ZONE 'Asia/Shanghai'))`,
  [principalId, businessDate]);
  if (active.rows[0]?.count !== 1) fail('RECORD_PLAN_NOT_ACTIVE');
}

async function findReplay(client: PoolClient, keys: ReadonlyMap<string, Buffer>, rawKey: string) {
  for (const [keyId, key] of keys) {
    const locator = digest(key, 'lianban:p11:idempotency-key:v1', rawKey);
    const result = await client.query<{ keyId: string; intentDigest: Buffer; principalId: string;
      taskId: string; businessDate: string; recordKindId: string; schemaVersion: string;
      operation: string; status: string; persistedRecordId: string | null; replayResult: unknown }>(
      `SELECT key_id AS "keyId", intent_digest AS "intentDigest", principal_id AS "principalId",
      task_id AS "taskId", business_date::text AS "businessDate", record_kind_id AS "recordKindId",
      schema_version AS "schemaVersion", operation, status, record_id AS "persistedRecordId",
      replay_result AS "replayResult"
      FROM recording.record_idempotency
      WHERE key_id=$1 AND idempotency_key_digest=$2 FOR UPDATE`, [keyId, locator]);
    if (result.rows[0]) return result.rows[0];
  }
  return null;
}

function parseReplayResult(value: unknown, persistedRecordId: string | null,
  persistedSchemaVersion: string): P11RecordResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !hasExactKeys(value, ['recordId', 'recordVersion', 'schemaVersion'])) {
    fail('RECORD_REQUEST_INVALID');
  }
  const result = value as Record<string, unknown>;
  if (typeof result.recordId !== 'string' || !result.recordId
    || typeof result.schemaVersion !== 'string' || !result.schemaVersion
    || !Number.isInteger(result.recordVersion) || (result.recordVersion as number) < 1
    || result.recordId !== persistedRecordId || result.schemaVersion !== persistedSchemaVersion) {
    fail('RECORD_REQUEST_INVALID');
  }
  return {
    recordId: result.recordId,
    recordVersion: result.recordVersion as number,
    schemaVersion: result.schemaVersion,
  };
}

async function hasUnknownHistoricalKey(client: PoolClient, keys: ReadonlyMap<string, Buffer>) {
  const result = await client.query<{ keyId: string }>(`SELECT DISTINCT key_id AS "keyId"
    FROM recording.record_idempotency`);
  return result.rows.some((row) => !keys.has(row.keyId));
}

function fail(code: P11RecordRepositoryErrorCode): never {
  throw new P11RecordRepositoryError(code);
}
