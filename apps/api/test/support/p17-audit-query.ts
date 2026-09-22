import { createHash } from 'node:crypto';
import { applyMigrations } from '@lianban/database';
import { Pool } from 'pg';

export type AuditOutcome = 'SUCCEEDED' | 'REJECTED';

export type AuditQueryFilters = {
  actorId?: string;
  action?: string;
  subjectType?: string;
  subjectId?: string;
  requestId?: string;
  outcome?: AuditOutcome;
  occurredFrom?: string;
  occurredTo?: string;
  limit: number;
};

/** Minimal-disclosure projection: version ids are deliberately not disclosed. */
export type AuditEventRow = {
  id: string;
  actorId: string | null;
  actorRole: string;
  action: string;
  subjectType: string;
  subjectId: string;
  requestId: string;
  outcome: AuditOutcome;
  errorCode: string | null;
  occurredAt: string;
};

const FILTER_KEYS = [
  'actorId', 'action', 'subjectType', 'subjectId', 'requestId', 'outcome', 'occurredFrom', 'occurredTo', 'limit',
] as const;

function invalid(): never {
  throw new Error('AUDIT_QUERY_INVALID');
}

function textFilter(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid();
  return value;
}

export async function queryAuditEvents(pool: Pool, filters: AuditQueryFilters): Promise<AuditEventRow[]> {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) invalid();
  const record = filters as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !(FILTER_KEYS as readonly string[]).includes(key))) invalid();
  const limit = record.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) invalid();

  const conditions: string[] = [];
  const params: unknown[] = [];
  const addText = (column: string, value: unknown) => {
    params.push(textFilter(value));
    conditions.push(`${column} = $${params.length}`);
  };
  if (record.actorId !== undefined) addText('actor_id', record.actorId);
  if (record.action !== undefined) addText('action', record.action);
  if (record.subjectType !== undefined) addText('subject_type', record.subjectType);
  if (record.subjectId !== undefined) addText('subject_id', record.subjectId);
  if (record.requestId !== undefined) addText('request_id', record.requestId);
  if (record.outcome !== undefined) {
    if (record.outcome !== 'SUCCEEDED' && record.outcome !== 'REJECTED') invalid();
    params.push(record.outcome);
    conditions.push(`outcome = $${params.length}`);
  }
  if (record.occurredFrom !== undefined) {
    params.push(isoTimestamp(record.occurredFrom));
    conditions.push(`occurred_at >= $${params.length}`);
  }
  if (record.occurredTo !== undefined) {
    params.push(isoTimestamp(record.occurredTo));
    conditions.push(`occurred_at < $${params.length}`);
  }
  params.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query<{
    id: string; actorId: string | null; actorRole: string; action: string; subjectType: string;
    subjectId: string; requestId: string; outcome: AuditOutcome; errorCode: string | null; occurredAt: Date;
  }>(
    `SELECT id, actor_id AS "actorId", actor_role AS "actorRole", action,
       subject_type AS "subjectType", subject_id AS "subjectId", request_id AS "requestId",
       outcome, error_code AS "errorCode", occurred_at AS "occurredAt"
     FROM audit.audit_event ${where}
     ORDER BY occurred_at DESC, id ASC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    requestId: row.requestId,
    outcome: row.outcome,
    errorCode: row.errorCode,
    occurredAt: new Date(row.occurredAt).toISOString(),
  }));
}

export async function withAuditPostgres<Result>(
  adminUrl: string,
  run: (pool: Pool) => Promise<Result>,
): Promise<Result> {
  const admin = new URL(adminUrl);
  const databaseName = `lianban_p11_test_${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 32)}`;
  const maintenance = new Pool({ connectionString: admin.toString() });
  const targetUrl = new URL(admin);
  targetUrl.pathname = `/${databaseName}`;
  let pool: Pool | undefined;
  let created = false;
  try {
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    pool = new Pool({ connectionString: targetUrl.toString() });
    const targetPool = pool;
    await applyMigrations({
      exec: async (sql: string) => { await targetPool.query(sql); },
      query: async <Row>(sql: string, params: unknown[] = []) => ({ rows: (await targetPool.query(sql, params)).rows as Row[] }),
      transaction: async <T>(run2: (connection: any) => Promise<T>) => {
        const client = await targetPool.connect();
        try {
          await client.query('BEGIN');
          const result = await run2({
            exec: async (sql: string) => { await client.query(sql); },
            query: async <Row>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params)).rows as Row[] }),
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    } as never);
    return await run(targetPool);
  } finally {
    await pool?.end().catch(() => undefined);
    if (created) {
      await maintenance.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [databaseName]).catch(() => undefined);
      await maintenance.query(`DROP DATABASE "${databaseName}"`).catch(() => undefined);
    }
    await maintenance.end().catch(() => undefined);
  }
}

export async function seedAuditEvents(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO audit.audit_event
       (id, actor_id, actor_role, action, subject_type, subject_id, request_id, outcome, error_code, occurred_at)
     VALUES
       ('audit-1', 'user-1', 'USER', 'PLAN_CONFIRM_DIET', 'PLAN_VERSION', 'plan-v1', 'req-1', 'SUCCEEDED', NULL, TIMESTAMPTZ '2026-01-01T10:00:00Z'),
       ('audit-2', 'user-1', 'USER', 'PLAN_TRANSITION_REJECTED', 'PLAN_VERSION', 'plan-v1', 'req-2', 'REJECTED', 'PLAN_VERSION_NOT_FOUND', TIMESTAMPTZ '2026-01-01T11:00:00Z'),
       ('audit-3', 'operations', 'OPERATIONS', 'PLAN_PUBLISH', 'PLAN_VERSION', 'plan-v2', 'req-3', 'SUCCEEDED', NULL, TIMESTAMPTZ '2026-01-02T09:00:00Z'),
       ('audit-4', 'user-2', 'USER', 'SESSION_INVALID', 'SESSION', 'session-2', 'req-4', 'REJECTED', 'SESSION_INVALID', TIMESTAMPTZ '2026-01-02T10:00:00Z')`,
  );
}

export async function auditTableDigest(pool: Pool): Promise<{ count: number; digest: string }> {
  const result = await pool.query<{ count: number; digest: string }>(
    `SELECT count(*)::integer AS count,
       coalesce(md5(string_agg(
         id || '|' || coalesce(actor_id, '') || '|' || action || '|' || outcome || '|'
         || coalesce(error_code, '') || '|' || occurred_at::text, ',' ORDER BY id)), md5('')) AS digest
     FROM audit.audit_event`,
  );
  return result.rows[0]!;
}
