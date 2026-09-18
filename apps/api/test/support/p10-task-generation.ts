import { hashPassword, resolveCurrentPlan, type AuthSecurityPolicy } from '@lianban/domain';
import { createHash } from 'node:crypto';
import { applyMigrations } from '@lianban/database';
import { Pool } from 'pg';
import type { INestApplication } from '@nestjs/common';
import type { Environment } from '../../src/config/environment.js';
import { DatabaseService } from '../../src/database/database.service.js';

const environment: Environment = {
  nodeEnv: 'test', port: 3000, databasePath: 'memory://', demoMode: false,
  professionalRulesApproved: false, authSecurityPolicyApproved: true,
  privacyReviewApproved: false, dataRightsDrillComplete: false,
  backupRestoreDrillComplete: false, operationsReadinessApproved: false,
  deploymentSecurityApproved: false,
};

const policy: AuthSecurityPolicy = {
  approved: true, passwordMinLength: 10, sessionTtlSeconds: 900,
  passwordChangeTtlSeconds: 300, maxFailedAttempts: 3,
  mfaRequiredForStaff: false, scryptCost: 16_384, scryptBlockSize: 8,
  scryptParallelization: 1, scryptKeyLength: 32,
};

const schema = {
  version: 'schema-v1', testOnly: true, approvedForRealUsers: false,
  recordKinds: [{ id: 'kind-1', fields: [{ id: 'field-1', valueType: 'STRING' as const }], allowedActions: ['UPSERT_RECORD' as const] }],
} as const;

export const p10Fixture = {
  userId: 'p10-user',
  sessionId: 'p10-session',
  sessionToken: 'p10-token',
  planId: 'p10-plan',
  planVersionId: 'p10-plan-version',
  requestId: 'p10-request',
  idempotencyKey: 'p10-idempotency',
  entry: 'p10-entry',
  schemaVersion: 'schema-v1',
  effectiveAt: '2026-01-01T00:00:00.000Z',
  effectiveTo: '2026-01-04T00:00:00.000Z',
  trustedNow: '2026-01-02T12:00:00.000Z',
} as const;

export type TaskGenerationOutcome =
  | { outcome: 'GENERATED'; planId: string; planVersionId: string; businessDates: string[]; taskIds: string[] }
  | { outcome: 'REFUSED'; reason: 'PLAN_GAP' | 'PLAN_STATE_INVALID' };

export type TaskGenerationInput = {
  userId: string;
  trustedNow: Date;
  schemaVersion: string;
};

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Business dates follow the authoritative Asia/Shanghai mapping used by the record repository. */
export function shanghaiBusinessDate(value: Date): string {
  return new Date(value.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function businessDatesForWindow(effectiveAt: Date, effectiveTo: Date): string[] {
  const first = Date.parse(`${shanghaiBusinessDate(effectiveAt)}T00:00:00.000Z`);
  const last = Date.parse(`${shanghaiBusinessDate(new Date(effectiveTo.getTime() - 1))}T00:00:00.000Z`);
  const dates: string[] = [];
  for (let cursor = first; cursor <= last; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

export function generatedTaskId(planVersionId: string, businessDate: string): string {
  return `p10-task-${createHash('sha256').update(`${planVersionId}:${businessDate}`).digest('hex').slice(0, 32)}`;
}

export async function generateActiveWindowTasks(
  pool: Pool,
  input: TaskGenerationInput,
): Promise<TaskGenerationOutcome> {
  const versions = await pool.query<{
    id: string; planId: string; userId: string; status: string;
    effectiveAt: Date; effectiveTo: Date | null;
  }>(
    `SELECT id, plan_id AS "planId", user_id AS "userId", status,
       effective_at AS "effectiveAt", effective_to AS "effectiveTo"
     FROM planning.plan_version WHERE user_id=$1`, [input.userId]);
  const active = versions.rows
    .filter((row): row is typeof row & { status: 'ACTIVE'; effectiveTo: Date } =>
      row.status === 'ACTIVE' && row.effectiveTo !== null)
    .map((row) => ({
      id: row.id, planId: row.planId, userId: row.userId, status: 'ACTIVE' as const,
      effectiveAt: new Date(row.effectiveAt), effectiveTo: new Date(row.effectiveTo),
    }));
  const resolved = resolveCurrentPlan(active, input.userId, input.trustedNow);
  if (resolved.status === 'PLAN_STATE_INVALID') return { outcome: 'REFUSED', reason: 'PLAN_STATE_INVALID' };
  if (resolved.status !== 'ACTIVE') return { outcome: 'REFUSED', reason: 'PLAN_GAP' };

  const plan = resolved.plan;
  const businessDates = businessDatesForWindow(plan.effectiveAt, plan.effectiveTo);
  const gate = await pool.query<{ revision: number }>(
    `SELECT current_revision::integer AS revision FROM recording.p11_write_gate WHERE id='P11_RECORD_WRITE'`);
  const revision = gate.rows[0]?.revision;
  if (revision === undefined) throw new Error('P10_WRITE_GATE_UNAVAILABLE');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskIds: string[] = [];
    for (const businessDate of businessDates) {
      const id = generatedTaskId(plan.id, businessDate);
      await client.query(
        `INSERT INTO recording.record_task
           (id, user_id, plan_id, plan_version_id, business_date, schema_version, gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
         VALUES ($1,$2,$3,$4,$5::date,$6,'P11_RECORD_WRITE',$7,'TEST_ONLY_EXPLICIT','OPEN','OPEN','CLEAR')
         ON CONFLICT (id) DO NOTHING`,
        [id, input.userId, plan.planId, plan.id, businessDate, input.schemaVersion, revision]);
      taskIds.push(id);
    }
    await client.query('COMMIT');
    return {
      outcome: 'GENERATED', planId: plan.planId, planVersionId: plan.id, businessDates, taskIds,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withP10Postgres<Result>(
  adminUrl: string,
  run: (context: {
    pool: Pool;
    createApplication(build: typeof import('../build-test-application.js').buildApplication): Promise<INestApplication>;
  }) => Promise<Result>,
): Promise<Result> {
  const admin = new URL(adminUrl);
  const databaseName = `lianban_p11_test_${cryptoRandomId()}`;
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
    await seedPostgres(targetPool);
    return await run({
      pool: targetPool,
      createApplication: async (build) => {
        const app = await build(environment, {
          authPolicy: policy,
          routeAccessSnapshot: { audience: 'TEST', blockers: [], allowProtectedRoutes: true },
          recordSchemaProvider: { getApprovedRecordSchema: async () => schema },
          recordRepositoryPool: targetPool,
        });
        await seedApi(app);
        return app;
      },
    });
  } finally {
    await pool?.end().catch(() => undefined);
    if (created) {
      await maintenance.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [databaseName]).catch(() => undefined);
      await maintenance.query(`DROP DATABASE "${databaseName}"`).catch(() => undefined);
    }
    await maintenance.end().catch(() => undefined);
  }
}

async function seedPostgres(pool: Pool): Promise<void> {
  await pool.query(`INSERT INTO recording.p11_write_gate_revision
    (gate_id, revision, node_env, test_only, approved_for_real_users, route_access_approved, write_enabled, schema_version, hmac_key_id)
    VALUES ('P11_RECORD_WRITE', 1, 'TEST', true, false, true, true, 'schema-v1', 'test-key-v1')`);
  await pool.query(`INSERT INTO recording.p11_write_gate (id, current_revision) VALUES ('P11_RECORD_WRITE', 1)`);
  await pool.query(`INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required) VALUES ($1,$2,'hash','USER','ACTIVE',false)`, [p10Fixture.userId, 'p10-fixture']);
  await pool.query(`INSERT INTO iam.session (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at) VALUES ($1,$2,'USER',$3,'USER','FULL',now() + interval '1 hour')`, [p10Fixture.sessionId, p10Fixture.userId, requireHash(p10Fixture.sessionToken)]);
  await pool.query(`INSERT INTO care.user_profile (id, user_id, goal_type) VALUES ($1,$2,$3)`, [`${p10Fixture.userId}-profile`, p10Fixture.userId, 'FAT_LOSS']);
  await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ($1,$2)`, [p10Fixture.planId, p10Fixture.userId]);
  await pool.query(`INSERT INTO planning.plan_version (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at, effective_at, effective_to, professional_rules_approved, demo_only, payload) VALUES ($1,$2,$3,1,'ACTIVE',TIMESTAMPTZ '2025-12-30T12:00:00Z',TIMESTAMPTZ '2025-12-31T12:00:00Z',TIMESTAMPTZ '2026-01-01T00:00:00Z',TIMESTAMPTZ '2026-01-04T00:00:00Z',false,true,$4)`, [p10Fixture.planVersionId, p10Fixture.planId, p10Fixture.userId, JSON.stringify({ fixtureId: 'p10-fixture', goalType: 'FAT_LOSS' })]);
}

async function seedApi(app: INestApplication): Promise<void> {
  const database = app.get(DatabaseService).database;
  const passwordHash = await hashPassword('p10-password', policy);
  await database.query(`INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required) VALUES ($1,$2,$3,'USER','ACTIVE',false)`, [p10Fixture.userId, 'p10-fixture', passwordHash]);
  await database.query(`INSERT INTO iam.session (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope) VALUES ($1,$2,'USER',$3,false,now() + interval '15 minutes','USER','FULL')`, [p10Fixture.sessionId, p10Fixture.userId, requireHash(p10Fixture.sessionToken)]);
}

function requireHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cryptoRandomId(): string {
  return createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 32);
}
