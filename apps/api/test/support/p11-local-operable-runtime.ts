import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import { applyMigrations, type MigrationConnection, type MigrationDatabase } from '@lianban/database';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Pool, type PoolClient } from 'pg';
import type { INestApplication } from '@nestjs/common';

import { buildApplication } from '../build-test-application.js';
import type { Environment } from '../../src/config/environment.js';
import { DatabaseService } from '../../src/database/database.service.js';
import type { P11RecordPortSchema } from '../../src/records/p11-record-repository.port.js';
import type { RouteAccessSnapshot } from '../../src/readiness/route-access.js';

export type P11LocalFixture = Readonly<{
  fixtureId: 'persona_fat_loss' | 'persona_muscle_gain';
  goalType: 'FAT_LOSS' | 'MUSCLE_GAIN';
  accountId: string;
  taskId: string;
  sessionToken: string;
  expiresAt: string;
}>;

export type P11LocalOperableRuntime = Readonly<{
  baseUrl: string;
  fixtureManifest(): Promise<readonly P11LocalFixture[]>;
  close(): Promise<void>;
}>;

type RuntimeFixture = P11LocalFixture & Readonly<{
  sessionId: string;
  planId: string;
  planVersionId: string;
  requestId: string;
  idempotencyKey: string;
}>;

const environment: Environment = {
  nodeEnv: 'test', port: 0, databasePath: `memory://p11-local-${randomUUID()}`, demoMode: false,
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
  recordKinds: [{
    id: 'kind-1', fields: [{ id: 'field-1', valueType: 'STRING' as const }],
    allowedActions: ['UPSERT_RECORD' as const],
  }],
} as const satisfies P11RecordPortSchema;

const fixtures: readonly RuntimeFixture[] = [
  runtimeFixture('fat-loss', 'persona_fat_loss', 'FAT_LOSS', '减脂'),
  runtimeFixture('muscle-gain', 'persona_muscle_gain', 'MUSCLE_GAIN', '增肌'),
];

export async function startP11LocalOperableRuntime(options: {
  adminUrl: string;
  port: number;
}): Promise<P11LocalOperableRuntime> {
  const adminUrl = assertSafeAdminUrl(options.adminUrl);
  assertPort(options.port);
  const databaseName = `lianban_p11_local_${randomUUID().replaceAll('-', '')}`;
  const maintenance = new Pool({ connectionString: adminUrl.toString() });
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${databaseName}`;
  let targetPool: Pool | undefined;
  let app: INestApplication | undefined;
  let server: Server | undefined;
  let closeRuntime: () => Promise<void> = async () => undefined;
  let closingPromise: Promise<void> | undefined;
  let created = false;
  let closed = false;

  try {
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    targetPool = new Pool({ connectionString: targetUrl.toString() });
    await applyMigrations(new PgMigrationDatabase(targetPool));
    await seedPostgres(targetPool);
    app = await buildApplication(environment, {
      authPolicy: policy,
      routeAccessSnapshot: allowProtectedRoutes(),
      recordSchemaProvider: { getApprovedRecordSchema: async () => schema },
      recordRepositoryPool: targetPool,
      recordContextPool: targetPool,
    });
    await seedApi(app);
    const nestHandler = app.getHttpAdapter().getInstance() as (
      request: IncomingMessage,
      response: ServerResponse,
    ) => void;
    server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/p11-local/fixtures') {
        const body = JSON.stringify({ testOnly: true, fixtures: fixtures.map(publicFixture) });
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        response.end(body);
        return;
      }
      if (request.method === 'POST' && request.url === '/p11-local/shutdown') {
        response.writeHead(202, { 'content-length': '0' });
        response.end();
        void closeRuntime().catch((error: unknown) => {
          process.stderr.write(`${error instanceof Error ? error.message : 'P11_LOCAL_RUNTIME_CLEANUP_FAILED'}\n`);
        });
        return;
      }
      nestHandler(request, response);
    });
    await listen(server, options.port);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('P11_LOCAL_SERVER_ADDRESS_INVALID');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const target = targetPool;
    closeRuntime = async () => {
      closingPromise ??= (async () => {
        if (closed) return;
        closed = true;
        await cleanupRuntimeResources({ server, app, targetPool: target, maintenance, databaseName, created });
      })();
      await closingPromise;
    };
    return {
      baseUrl,
      fixtureManifest: async () => fixtures.map(publicFixture),
      close: closeRuntime,
    };
  } catch (error) {
    let cleanupError: unknown;
    try {
      await cleanupRuntimeResources({ server, app, targetPool, maintenance, databaseName, created });
    } catch (errorDuringCleanup) {
      cleanupError = errorDuringCleanup;
    }
    if (cleanupError) {
      throw new AggregateError([error, ...aggregateErrors(cleanupError)], 'P11_LOCAL_RUNTIME_OPERATION_AND_CLEANUP_FAILED');
    }
    throw error;
  }
}

function runtimeFixture(
  label: string,
  fixtureId: RuntimeFixture['fixtureId'],
  goalType: RuntimeFixture['goalType'],
  tokenLabel: string,
): RuntimeFixture {
  return {
    fixtureId,
    goalType,
    accountId: `p11-local-user-${label}`,
    taskId: `p11-local-task-${label}`,
    sessionToken: `p11-local-session-token-${label}`,
    expiresAt: '2099-01-01T00:00:00.000Z',
    sessionId: `p11-local-session-${label}`,
    planId: `p11-local-plan-${label}`,
    planVersionId: `p11-local-plan-version-${label}`,
    requestId: `p11-local-request-${label}`,
    idempotencyKey: `p11-local-idempotency-${tokenLabel.toLowerCase()}`,
  };
}

function publicFixture(fixture: RuntimeFixture): P11LocalFixture {
  return {
    fixtureId: fixture.fixtureId,
    goalType: fixture.goalType,
    accountId: fixture.accountId,
    taskId: fixture.taskId,
    sessionToken: fixture.sessionToken,
    expiresAt: fixture.expiresAt,
  };
}

function allowProtectedRoutes(): RouteAccessSnapshot {
  return Object.freeze({ audience: 'TEST', blockers: Object.freeze([]), allowProtectedRoutes: true });
}

async function seedPostgres(pool: Pool): Promise<void> {
  await pool.query(`INSERT INTO recording.p11_write_gate_revision
    (gate_id, revision, node_env, test_only, approved_for_real_users,
     route_access_approved, write_enabled, schema_version, hmac_key_id)
    VALUES ('P11_RECORD_WRITE',1,'TEST',true,false,true,true,'schema-v1','test-key-v1')`);
  await pool.query(`INSERT INTO recording.p11_write_gate (id, current_revision)
    VALUES ('P11_RECORD_WRITE',1)`);
  for (const fixture of fixtures) {
    await pool.query(`INSERT INTO iam.account
      (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
      VALUES ($1,$2,'local-runtime-hash','USER','ACTIVE',false)`, [fixture.accountId, fixture.fixtureId]);
    await pool.query(`INSERT INTO iam.session
      (id, account_id, session_kind, token_hash, active_role, session_scope, expires_at)
      VALUES ($1,$2,'USER',$3,'USER','FULL',TIMESTAMPTZ '2099-01-01T00:00:00Z')`, [
      fixture.sessionId, fixture.accountId, tokenHash(fixture.sessionToken),
    ]);
    await pool.query(`INSERT INTO care.user_profile (id, user_id, goal_type) VALUES ($1,$2,$3)`, [
      `${fixture.accountId}-profile`, fixture.accountId, fixture.goalType,
    ]);
    await pool.query(`INSERT INTO planning.plan (id, user_id) VALUES ($1,$2)`, [fixture.planId, fixture.accountId]);
    await pool.query(`INSERT INTO planning.plan_version
      (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
       effective_at, effective_to, professional_rules_approved, demo_only, payload)
      VALUES ($1,$2,$3,1,'ACTIVE',TIMESTAMPTZ '2025-12-29T12:00:00Z',
        TIMESTAMPTZ '2025-12-31T12:00:00Z',TIMESTAMPTZ '2026-01-01T00:00:00Z',
        TIMESTAMPTZ '2099-01-01T00:00:00Z',false,true,$4)`, [
      fixture.planVersionId, fixture.planId, fixture.accountId,
      JSON.stringify({ fixtureId: fixture.fixtureId, goalType: fixture.goalType, demoOnly: true }),
    ]);
    await pool.query(`INSERT INTO recording.record_task
      (id, user_id, plan_id, plan_version_id, business_date, schema_version,
       gate_id, gate_revision, close_policy, task_state, date_state, risk_state)
      VALUES ($1,$2,$3,$4,DATE '2026-01-02','schema-v1',
        'P11_RECORD_WRITE',1,'TEST_ONLY_EXPLICIT','OPEN','OPEN','CLEAR')`, [
      fixture.taskId, fixture.accountId, fixture.planId, fixture.planVersionId,
    ]);
  }
}

async function seedApi(app: INestApplication): Promise<void> {
  const database = app.get(DatabaseService).database;
  const passwordHash = await hashPassword('p11-local-runtime-password', policy);
  for (const fixture of fixtures) {
    await database.query(`INSERT INTO iam.account
      (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
      VALUES ($1,$2,$3,'USER','ACTIVE',false)`, [fixture.accountId, fixture.fixtureId, passwordHash]);
    await database.query(`INSERT INTO iam.session
      (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
      VALUES ($1,$2,'USER',$3,false,TIMESTAMPTZ '2099-01-01T00:00:00Z','USER','FULL')`, [
      fixture.sessionId, fixture.accountId, tokenHash(fixture.sessionToken),
    ]);
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function assertPort(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) throw new Error('P11_LOCAL_PORT_INVALID');
}

function assertSafeAdminUrl(value: string): URL {
  if (typeof value !== 'string' || !value.trim()) throw new Error('P11_LOCAL_POSTGRES_ADMIN_URL_REQUIRED');
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !new Set(['localhost', '127.0.0.1', '::1']).has(hostname)
    || url.pathname !== '/postgres') {
    throw new Error('UNSAFE_P11_LOCAL_POSTGRES_ADMIN_URL');
  }
  return url;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function cleanupRuntimeResources(options: {
  server: Server | undefined;
  app: INestApplication | undefined;
  targetPool: Pool | undefined;
  maintenance: Pool;
  databaseName: string;
  created: boolean;
}): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  await attempt(() => closeServer(options.server));
  await attempt(() => options.app ? options.app.close() : Promise.resolve());
  await attempt(() => options.targetPool ? options.targetPool.end() : Promise.resolve());
  if (options.created) {
    await attempt(() => options.maintenance.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
      [options.databaseName],
    ));
    await attempt(() => options.maintenance.query(`DROP DATABASE "${options.databaseName}"`));
  }
  await attempt(() => options.maintenance.end());
  if (errors.length > 0) throw new AggregateError(errors, 'P11_LOCAL_RUNTIME_CLEANUP_FAILED');
}

function aggregateErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? [...error.errors] : [error];
}

class PgMigrationDatabase implements MigrationDatabase {
  constructor(private readonly pool: Pool) {}
  async exec(sql: string): Promise<void> { await this.pool.query(sql); }
  async query<Row>(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as Row[] };
  }
  async transaction<Result>(run: (connection: MigrationConnection) => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(new PgMigrationConnection(client));
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

class PgMigrationConnection implements MigrationConnection {
  constructor(private readonly client: PoolClient) {}
  async exec(sql: string): Promise<void> { await this.client.query(sql); }
  async query<Row>(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    const result = await this.client.query(sql, params);
    return { rows: result.rows as Row[] };
  }
}
