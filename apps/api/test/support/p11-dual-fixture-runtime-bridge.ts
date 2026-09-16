import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
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

export const dualFixturePersonas = [
  fixture('fat-loss', 'persona_fat_loss', 'FAT_LOSS'),
  fixture('muscle-gain', 'persona_muscle_gain', 'MUSCLE_GAIN'),
] as const;

export type DualFixturePersona = (typeof dualFixturePersonas)[number];

export async function withIsolatedPostgres<Result>(
  adminUrl: string,
  run: (context: {
    pool: Pool;
    fixtures: readonly DualFixturePersona[];
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
      transaction: async <T>(run: (connection: any) => Promise<T>) => {
        const client = await targetPool.connect();
        try {
          await client.query('BEGIN');
          const result = await run({
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
      fixtures: dualFixturePersonas,
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

function fixture(label: string, fixtureId: 'persona_fat_loss' | 'persona_muscle_gain', goalType: 'FAT_LOSS' | 'MUSCLE_GAIN') {
  return {
    fixtureId, goalType,
    userId: `bridge-user-${label}`,
    sessionId: `bridge-session-${label}`,
    sessionToken: `bridge-token-${label}`,
    planId: `bridge-plan-${label}`,
    planVersionId: `bridge-plan-version-${label}`,
    taskId: `bridge-task-${label}`,
    requestId: `bridge-request-${label}`,
    idempotencyKey: `bridge-idempotency-${label}`,
    entry: `bridge-entry-${label}`,
    businessDate: '2026-01-02',
  } as const;
}

async function seedPostgres(pool: Pool): Promise<void> {
  await pool.query(`INSERT INTO recording.p11_write_gate_revision
    (gate_id, revision, node_env, test_only, approved_for_real_users, route_access_approved, write_enabled, schema_version, hmac_key_id)
    VALUES ('P11_RECORD_WRITE', 1, 'TEST', true, false, true, true, 'schema-v1', 'test-key-v1')`);
  await pool.query(`INSERT INTO recording.p11_write_gate (id, current_revision) VALUES ('P11_RECORD_WRITE', 1)`);
  for (const persona of dualFixturePersonas) {
    await pool.query(`INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required) VALUES ($1,$2,'hash','USER','ACTIVE',false)`, [persona.userId, persona.fixtureId]);
    await pool.query(`INSERT INTO iam.session (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at) VALUES ($1,$2,'USER',$3,'USER','FULL',now() + interval '1 hour')`, [persona.sessionId, persona.userId, requireHash(persona.sessionToken)]);
    await pool.query(`INSERT INTO care.user_profile (id, user_id, goal_type) VALUES ($1,$2,$3)`, [`${persona.userId}-profile`, persona.userId, persona.goalType]);
    await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ($1,$2)`, [persona.planId, persona.userId]);
    await pool.query(`INSERT INTO planning.plan_version (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at, effective_at, effective_to, professional_rules_approved, demo_only, payload) VALUES ($1,$2,$3,1,'ACTIVE',TIMESTAMPTZ '2025-12-29T12:00:00Z',TIMESTAMPTZ '2025-12-31T12:00:00Z',TIMESTAMPTZ '2026-01-01T00:00:00Z',TIMESTAMPTZ '2099-01-01T00:00:00Z',false,true,$4)`, [persona.planVersionId, persona.planId, persona.userId, JSON.stringify({ fixtureId: persona.fixtureId, goalType: persona.goalType })]);
    await pool.query(`INSERT INTO recording.record_task (id, user_id, plan_id, plan_version_id, business_date, schema_version, gate_id, gate_revision, close_policy, task_state, date_state, risk_state) VALUES ($1,$2,$3,$4,DATE '2026-01-02','schema-v1','P11_RECORD_WRITE',1,'TEST_ONLY_EXPLICIT','OPEN','OPEN','CLEAR')`, [persona.taskId, persona.userId, persona.planId, persona.planVersionId]);
  }
}

async function seedApi(app: INestApplication): Promise<void> {
  const database = app.get(DatabaseService).database;
  const passwordHash = await hashPassword('bridge-password', policy);
  for (const persona of dualFixturePersonas) {
    await database.query(`INSERT INTO iam.account (id, login_identifier, password_hash, account_type, status, initial_password_change_required) VALUES ($1,$2,$3,'USER','ACTIVE',false)`, [persona.userId, persona.fixtureId, passwordHash]);
    await database.query(`INSERT INTO iam.session (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope) VALUES ($1,$2,'USER',$3,false,now() + interval '15 minutes','USER','FULL')`, [persona.sessionId, persona.userId, requireHash(persona.sessionToken)]);
  }
}

function requireHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cryptoRandomId(): string {
  return createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 32);
}
