import { hashPassword, type AuthSecurityPolicy } from '@lianban/domain';
import { applyMigrations, type MigrationConnection, type MigrationDatabase } from '@lianban/database';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Pool, type PoolClient } from 'pg';
import type { INestApplication } from '@nestjs/common';

import { buildApplication } from '../build-test-application.js';
import { generateActiveWindowTasks, generatedTaskId } from './p10-task-generation.js';
import {
  adjustmentOutcomes, createWeeklyFeedbackFixture, requiredWeeklyFeedbackFields, weeklyFeedbackFieldIds,
} from './p12-weekly-feedback.js';
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
  // Test fixture only, mirroring the P08 lifecycle specs: the plan mechanics (screening state,
  // creation, review) need an approved professional-rules flag to run at all. Demo content stays
  // unpublishable and every real-user gate is untouched.
  professionalRulesApproved: true, authSecurityPolicyApproved: true,
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
    runtimePlanTime = new Date();
    adjustments.clear();
    weeklySubmissionStates.clear();
    app = await buildApplication(environment, {
      authPolicy: policy,
      routeAccessSnapshot: allowProtectedRoutes(),
      recordSchemaProvider: { getApprovedRecordSchema: async () => schema },
      recordRepositoryPool: targetPool,
      recordContextPool: targetPool,
      planClock: { now: () => runtimePlanTime },
      consentProvider: {
        getCurrentConsent: async () => ({
          version: 'consent-v1',
          content: { format: 'PLAIN_TEXT' as const, text: 'FICTIONAL LOCAL RUNTIME CONSENT' },
        }),
      },
      screeningProvider: { isApprovedConclusion: async () => true },
      profileSchemaProvider: {
        getApprovedProfileSchema: async () => ({
          version: 'plan-fixture-profile-v1',
          steps: [{ id: 'fixture-ready', fields: [{ name: 'fixtureReady', type: 'BOOLEAN' as const, required: true }] }],
        }),
      },
    });
    await seedApi(app);
    const surfacePool = targetPool;
    const runtimeDatabase = app.get(DatabaseService).database as unknown as PgliteLike;
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
      if (request.method === 'GET' && request.url === '/p11-local/tasks') {
        void respondTaskSurface(surfacePool, response);
        return;
      }
      if (request.method === 'GET' && request.url === '/p11-local/weekly-feedback') {
        respondWeeklyFeedbackView(response);
        return;
      }
      if (request.method === 'POST' && request.url === '/p11-local/weekly-feedback') {
        void respondWeeklyFeedbackSubmit(request, response, { baseUrl, database: runtimeDatabase });
        return;
      }
      if (request.method === 'GET' && request.url === '/p11-local/adjustment') {
        respondAdjustmentSurface(response);
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

const staffTokens = {
  operations: 'p11-local-operations-token',
  nutrition: 'p11-local-nutrition-token',
  training: 'p11-local-training-token',
} as const;

const staffAccounts = [
  { id: 'p11-local-operations', role: 'OPERATIONS', token: staffTokens.operations },
  { id: 'p11-local-nutrition', role: 'NUTRITION_REVIEWER', token: staffTokens.nutrition },
  { id: 'p11-local-training', role: 'TRAINING_REVIEWER', token: staffTokens.training },
] as const;

let runtimePlanTime = new Date();

type AdjustmentFacts = {
  planVersionId: string;
  status: string;
  sourceType: string;
  publishBlocked: string | null;
  previousPlanVersionId: string;
  previousStatus: string;
};

const adjustments = new Map<string, AdjustmentFacts>();

type PgliteLike = {
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
};

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
    taskId: generatedTaskId(`p11-local-plan-version-${label}`, '2026-01-02'),
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

const weeklyFeedbackFixture = createWeeklyFeedbackFixture({
  sufficiencyPolicy: () => 'SUFFICIENT',
});
const weeklySubmissionStates = new Map<string, 'NONE' | 'ADJUSTMENT_PENDING'>();

function weeklyFeedbackView(fixtureId: string) {
  return {
    windowState: 'OPEN' as const,
    weekIndex: 1,
    sufficiency: 'SUFFICIENT' as const,
    painState: 'CLEAR' as const,
    submissionState: weeklySubmissionStates.get(fixtureId) ?? 'NONE',
    nextWindowAt: null,
    fields: weeklyFeedbackFieldIds.map((id) => ({
      id,
      required: (requiredWeeklyFeedbackFields as readonly string[]).includes(id),
    })),
    allowedOutcomes: [...adjustmentOutcomes],
  };
}

function respondWeeklyFeedbackView(response: ServerResponse): void {
  const body = JSON.stringify({
    testOnly: true,
    fixtures: fixtures.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      view: weeklyFeedbackView(fixture.fixtureId),
    })),
  });
  response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function respondAdjustmentSurface(response: ServerResponse): void {
  const body = JSON.stringify({
    testOnly: true,
    fixtures: fixtures.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      adjustment: adjustments.get(fixture.fixtureId) ?? null,
    })),
  });
  response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

async function driveWeeklyAdjustment(
  baseUrl: string,
  database: PgliteLike,
  fixture: RuntimeFixture,
): Promise<void> {
  const adjustmentId = `p11-local-adjustment-${fixture.fixtureId}`;
  const effectiveAt = new Date(runtimePlanTime.getTime() + 7 * 86_400_000);
  const effectiveTo = new Date(effectiveAt.getTime() + 7 * 86_400_000);
  const headers = (key: string) => ({
    'Content-Type': 'application/json', 'x-request-id': key, 'idempotency-key': key,
  });
  const call = async (label: string, path: string, init: RequestInit): Promise<unknown> => {
    const response = await fetch(`${baseUrl}${path}`, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`P11_LOCAL_ADJUSTMENT_FAILED_${label}_${response.status}_${detail.slice(0, 160)}`);
    }
    return response.json();
  };
  await call('create', '/api/v1/plan-versions', {
    method: 'POST',
    headers: {
      ...headers(`p11-local-adjustment-create-${fixture.fixtureId}`),
      Authorization: `Bearer ${staffTokens.operations}`,
    },
    body: JSON.stringify({
      id: adjustmentId,
      userId: fixture.accountId,
      effectiveAt: effectiveAt.toISOString(),
      effectiveTo: effectiveTo.toISOString(),
      contentMode: 'DEMO_UNREVIEWED',
    }),
  });
  await database.query(
    `UPDATE planning.plan_version SET source_type='WEEKLY_ADJUSTMENT' WHERE id=$1`,
    [adjustmentId],
  );
  const transition = (event: { type: string } & Record<string, string>, token: string, key: string) => call(
    event.type,
    `/api/v1/plan-versions/${adjustmentId}/transitions`,
    { method: 'POST', headers: { ...headers(key), Authorization: `Bearer ${token}` }, body: JSON.stringify(event) },
  );
  const key = (step: string) => `p11-local-adjustment-${step}-${fixture.fixtureId}`;
  await transition({ type: 'SUBMIT_REVIEW' }, staffTokens.operations, key('submit'));
  await transition({ type: 'APPROVE_DIET', actorId: 'p11-local-nutrition' }, staffTokens.nutrition, key('diet'));
  await transition({ type: 'APPROVE_TRAINING', actorId: 'p11-local-training' }, staffTokens.training, key('training'));
  // The local runtime keeps the real gates: demo content can never be published and unapproved
  // professional rules keep blocking publication, so the adjustment stops at this gate by design.
  const publish = await fetch(`${baseUrl}/api/v1/plan-versions/${adjustmentId}/transitions`, {
    method: 'POST',
    headers: { ...headers(key('publish')), Authorization: `Bearer ${staffTokens.operations}` },
    body: JSON.stringify({ type: 'PUBLISH', occurredAt: runtimePlanTime.toISOString() }),
  });
  if (publish.status !== 409) throw new Error(`P11_LOCAL_ADJUSTMENT_PUBLISH_UNEXPECTED_${publish.status}`);
  const publishBody = await publish.json() as { errorCode?: unknown };
  const publishBlocked = typeof publishBody.errorCode === 'string' ? publishBody.errorCode : 'UNKNOWN';
  const rows = await database.query<{ id: string; status: string; sourceType: string }>(
    `SELECT id, status, source_type AS "sourceType" FROM planning.plan_version WHERE id IN ($1,$2)`,
    [adjustmentId, fixture.planVersionId],
  );
  adjustments.set(fixture.fixtureId, {
    planVersionId: adjustmentId,
    status: rows.rows.find((row) => row.id === adjustmentId)?.status ?? 'UNKNOWN',
    sourceType: rows.rows.find((row) => row.id === adjustmentId)?.sourceType ?? 'UNKNOWN',
    publishBlocked,
    previousPlanVersionId: fixture.planVersionId,
    previousStatus: rows.rows.find((row) => row.id === fixture.planVersionId)?.status ?? 'UNKNOWN',
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function respondWeeklyFeedbackSubmit(
  request: IncomingMessage,
  response: ServerResponse,
  context: { baseUrl: string; database: PgliteLike },
): Promise<void> {
  try {
    const payload = await readJsonBody(request);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      response.writeHead(400, { 'content-length': '0' });
      response.end();
      return;
    }
    const { fixtureId, requestedOutcome } = payload as Record<string, unknown>;
    const fixture = fixtures.find((candidate) => candidate.fixtureId === fixtureId);
    if (!fixture) {
      response.writeHead(404, { 'content-length': '0' });
      response.end();
      return;
    }
    if (typeof requestedOutcome !== 'string') {
      response.writeHead(400, { 'content-length': '0' });
      response.end();
      return;
    }
    // The demo surface submits opaque structural placeholder values for the feedback fields.
    const fields = Object.fromEntries(weeklyFeedbackFieldIds.map((id) => [
      id, id === 'pain' ? 'CLEAR' : `local-demo-${id}`,
    ]));
    const result = weeklyFeedbackFixture.submit({
      weekIndex: 1,
      windowState: 'OPEN',
      fields,
      facts: { recordedDays: 7 },
      requestedOutcome,
    });
    if (result.outcome === 'ADJUSTMENT_PENDING') {
      weeklySubmissionStates.set(fixture.fixtureId, 'ADJUSTMENT_PENDING');
      await driveWeeklyAdjustment(context.baseUrl, context.database, fixture);
    }
    const body = JSON.stringify({ testOnly: true, ...result });
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  } catch (cause: unknown) {
    const body = JSON.stringify({
      testOnly: true,
      error: cause instanceof Error ? cause.message : 'P11_LOCAL_WEEKLY_FEEDBACK_FAILED',
    });
    response.writeHead(400, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  }
}

async function respondTaskSurface(pool: Pool, response: ServerResponse): Promise<void> {
  try {
    const rows = await pool.query<{
      userId: string; taskId: string; businessDate: string;
      taskState: string; dateState: string; riskState: string;
    }>(
      `SELECT user_id AS "userId", id AS "taskId", business_date::text AS "businessDate",
         task_state AS "taskState", date_state AS "dateState", risk_state AS "riskState"
       FROM recording.record_task
       WHERE user_id = ANY($1::text[])
       ORDER BY user_id, business_date`,
      [fixtures.map((fixture) => fixture.accountId)],
    );
    const body = JSON.stringify({
      testOnly: true,
      fixtures: fixtures.map((fixture) => ({
        fixtureId: fixture.fixtureId,
        tasks: rows.rows
          .filter((row) => row.userId === fixture.accountId)
          .map(({ taskId, businessDate, taskState, dateState, riskState }) => ({
            taskId, businessDate, taskState, dateState, riskState,
          })),
      })),
    });
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  } catch {
    response.writeHead(500, { 'content-length': '0' });
    response.end();
  }
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
    const generation = await generateActiveWindowTasks(pool, {
      userId: fixture.accountId,
      trustedNow: new Date('2026-01-02T12:00:00.000Z'),
      schemaVersion: 'schema-v1',
      maxBusinessDates: 28,
    });
    if (generation.outcome !== 'GENERATED') throw new Error('P11_LOCAL_TASK_GENERATION_REFUSED');
  }
}

async function seedApi(app: INestApplication): Promise<void> {
  const database = app.get(DatabaseService).database;
  const passwordHash = await hashPassword('p11-local-runtime-password', policy);
  for (const staff of staffAccounts) {
    await database.query(`INSERT INTO iam.account
      (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
      VALUES ($1,$2,$3,'STAFF','ACTIVE',false)`, [staff.id, staff.id, passwordHash]);
    await database.query(`INSERT INTO iam.account_role (account_id, role_code, qualified_at)
      VALUES ($1,$2,now())`, [staff.id, staff.role]);
    await database.query(`INSERT INTO iam.session
      (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
      VALUES ($1,$2,'STAFF',$3,false,TIMESTAMPTZ '2099-01-01T00:00:00Z',$4,'FULL')`, [
      `${staff.id}-session`, staff.id, tokenHash(staff.token), staff.role,
    ]);
  }
  for (const fixture of fixtures) {
    await database.query(`INSERT INTO iam.account
      (id, login_identifier, password_hash, account_type, status, initial_password_change_required)
      VALUES ($1,$2,$3,'USER','ACTIVE',false)`, [fixture.accountId, fixture.fixtureId, passwordHash]);
    await database.query(`INSERT INTO iam.session
      (id, account_id, session_kind, token_hash, mfa_verified, expires_at, active_role, session_scope)
      VALUES ($1,$2,'USER',$3,false,TIMESTAMPTZ '2099-01-01T00:00:00Z','USER','FULL')`, [
      fixture.sessionId, fixture.accountId, tokenHash(fixture.sessionToken),
    ]);
    await database.query(`INSERT INTO care.consent_record (id, user_id, consent_version, accepted_at)
      VALUES ($1,$2,'consent-v1',now())`, [`${fixture.accountId}-consent`, fixture.accountId]);
    await database.query(`INSERT INTO care.screening_result
      (id, user_id, conclusion, source, rule_version, recorded_by, actor_role)
      VALUES ($1,$2,'PASS','MANUAL_REVIEW','fictional-plan-rule-v1','p11-local-nutrition','NUTRITION_REVIEWER')`,
    [`${fixture.accountId}-screening`, fixture.accountId]);
    await database.query(`INSERT INTO care.user_profile
      (id, user_id, profile_data, completed_steps, schema_version)
      VALUES ($1,$2,'{"fixture-ready":{"fixtureReady":true}}','["fixture-ready"]','plan-fixture-profile-v1')`,
    [`${fixture.accountId}-profile`, fixture.accountId]);
    await database.query(`INSERT INTO planning.plan (id, user_id) VALUES ($1,$2)`, [
      fixture.planId, fixture.accountId,
    ]);
    await database.query(`INSERT INTO planning.plan_version
      (id, plan_id, user_id, version_number, status, published_at, confirmation_deadline_at,
       effective_at, effective_to, professional_rules_approved, demo_only, payload)
      VALUES ($1,$2,$3,1,'ACTIVE',TIMESTAMPTZ '2025-12-29T12:00:00Z',
        TIMESTAMPTZ '2025-12-31T12:00:00Z',TIMESTAMPTZ '2026-01-01T00:00:00Z',
        TIMESTAMPTZ '2099-01-01T00:00:00Z',false,true,$4)`, [
      fixture.planVersionId, fixture.planId, fixture.accountId,
      JSON.stringify({ fixtureId: fixture.fixtureId, goalType: fixture.goalType, demoOnly: true }),
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
