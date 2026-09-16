# P11 Test-Only GET_RECORD_CONTEXT Pre-Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This shared dirty worktree has one authorized writer; do not use subagents, stage, commit, push, deploy, reset, checkout, or revert.

**Goal:** Establish one test-only `GET /api/v1/record-tasks/:taskId/context` success mapping from an independent context-read fake to the frozen `RECORD_CONTEXT_AVAILABLE` response.

**Architecture:** Add a pure TypeScript context-read port and token that are separate from `P11RecordRepositoryPort`. Thread the fake through the existing application/AppModule `nodeEnv === 'test'` double gate, then have the existing controller map exactly one successful fake result plus the pinned test-only schema to the frozen seven-key public envelope. Keep all existing session, role, route/readiness, and non-enumerating rejection behavior unchanged and covered only by regression tests.

**Tech Stack:** TypeScript, NestJS, Zod, Swagger/OpenAPI, Supertest, Vitest, local test-only PGlite identity fixture, and an isolated test-only PostgreSQL 18 Pool fixture for the reviewed context repository.

---

## Frozen Scope And Evidence Boundary

- The authorized test-only P11 surface now also includes the P11-12 legal `UPSERT_RECORD` rejections for the separately authorized server-derived `date_state=CLOSED`, `task_state=CLOSED`, and `risk_state=BLOCKED` branches, including the closed-date, closed-task, and blocked-risk first-write cases with no owner record and `expectedRecordVersion: null`: `409 RECORD_STATE_BLOCKED`, `DISABLE_EDITOR`, and `recoverableActions: []`, with no state mutation. The original context success and P11-11 closed-date read remain test-only.
- The separately authorized P11-03 cross-user negative test uses a complete fictional USER B account/plan/plan-version/task chain, while fictional USER A has the valid session, and asserts the existing `404 RECORD_TASK_NOT_FOUND`, `CLEAR_ALL`, and empty `recoverableActions` envelope with no observed write.
- The newly authorized P11-04 plan-state negative test keeps the fictional USER/task/session and `task_state/date_state/risk_state=OPEN/OPEN/CLEAR` unchanged, sets only the associated `planning.plan_version.status` to the existing non-`ACTIVE` `SUPERSEDED` state, and asserts the existing `409 RECORD_PLAN_NOT_ACTIVE`, `CLEAR_ALL`, and empty `recoverableActions` envelope with no observed write.
- The newly authorized P11-08 concurrency test uses one existing fictional USER record at version `1`, two valid sessions, distinct request/idempotency keys and opaque entry values, and the same task/kind/schema with `expectedRecordVersion=1`. A test-only PoolClient barrier holds the first request after a real PG18 account `FOR UPDATE`; the second request reaches the same lock and is observed in `pg_stat_activity` with `wait_event_type='Lock'` before release. This proves real overlap and database lock waiting; it does not merge fake/controller or repository-unit evidence with this cross-layer result.
- The newly authorized P11-09 ordering test uses one existing fictional USER record at version `1`; one newer request first succeeds at version `2`, then a distinct older request with `expectedRecordVersion=1` is rejected by the authoritative stored version. It adds no client timestamp or ordering field and does not authorize another ordering variant.
- The newly authorized P11-10 schema-version test keeps the approved/gate/task/record schema at `schema-v1` and sends one otherwise legal command pinned to `schema-v2`; the authoritative schema mismatch must return the existing version-conflict envelope before any write side effect.
- The newly authorized P11-06 replay test sends the same complete normalized `UPSERT_RECORD` intent twice through the real test-only API to isolated PG18, with the same raw idempotency key and different request IDs. It must compare the two full machine responses and prove only the first request creates the version/idempotency/audit side effects.
- The newly authorized P11-07 changed-intent test first completes one valid write, then reuses the same raw idempotency key with only the opaque entry value changed and a different request ID. It must return the existing idempotency conflict while preserving the first record, replay result, digest, and audit.
- The newly authorized P11-08 absent-record create race starts two valid `expectedRecordVersion=null` requests with distinct sessions, request IDs, raw keys, and opaque entries. The repository's frozen lock order obtains the same-subject `iam.account FOR UPDATE` before `record_task FOR UPDATE`, so the deterministic test barrier observes the second transaction waiting at that earliest real serialization boundary; after release, normal repository execution continues through the task lock and authoritative record re-read.
- The separately authorized P11-05 client-user-field negative test is limited to one otherwise legal trusted USER `UPSERT_RECORD` with only a forged top-level `userId`. The existing strict command schema must reject it before the repository fake with exactly `400 RECORD_REQUEST_INVALID`, `CLEAR_ALL`, and `recoverableActions: []`; the fake call count remains zero and the forged value is not reflected in the public response. All other P11-05 client-forged authority fields and variants remain frozen.
- The initial success fixture uses opaque values, `accessMode: 'EDITABLE'`, one schema kind with `allowedActions: ['UPSERT_RECORD']`, empty `fields`, and `records: []`. Do not introduce professional content, record entries, units, thresholds, dates with real semantics, risk rules, or UI behavior.
- The controller fake proves controller input mapping, public-envelope mapping, one call, nonleakage, and test-only gating only. The separately authorized PG18 adapter test proves only the reviewed repository's isolated test fixture execution; neither surface proves production behavior or real-user behavior. Do not merge fake evidence with PostgreSQL query, ownership, anti-enumeration, ACTIVE plan selection, locking, concurrency, idempotency, or audit atomicity evidence.
- Do not modify `packages/database/**`, migrations, `docs/product/**`, production repository registration, or `P11RecordRepositoryPort` / `P11_RECORD_REPOSITORY`. The only authorized UI exception already completed within P11-07 is `apps/web/src/features/p11-real/p11-client-state.ts` plus its focused spec; pages and all further `apps/web/**` changes remain prohibited. The API test builder may construct the existing `P11RecordContextRepository` or `P11RecordRepository` from an explicitly supplied local Pool only in `nodeEnv === 'test'`.
- Do not add another context or write HTTP scenario beyond the authorized P11-06 same-intent replay, P11-07 entry-value changed-intent rejection, P11-08 existing-record update and absent-record create races, P11-09 sequential newer-success/older-stale request pair, and P11-10 schema-version conflict. Missing/blank headers, fake failures, task-state variants beyond the one closed-date read and the authorized P11-12 closed-date and closed-task existing-record and no-record first-write cases, risk-state variants beyond the authorized existing-record and no-record first-write cases, cross-user variants beyond the authorized P11-03 complete USER B chain, plan-state variants beyond the authorized P11-04 non-`ACTIVE` plan version, P11-05 variants beyond the authorized forged top-level `userId` strict-schema rejection, all other concurrency/create variants, all other changed-intent dimensions, other P11-10 variants, route priority, and all other ordering/error mappings are outside this authorization. Existing GET rejection tests are regression evidence only.

## File Responsibility Map

| File | Change | Responsibility |
| --- | --- | --- |
| `apps/api/src/records/p11-record-context.port.ts` | Create | Independent pure read input/result/interface; no NestJS, database, token, or professional fields. |
| `apps/api/src/records/p11-record-context.token.ts` | Create | Nest injection token for the independent context port. |
| `apps/api/src/records/record-safe-structure.controller.ts` | Modify | Inject the context reader, map exactly one test-only successful result, and make the GET OpenAPI success schema strict. |
| `apps/api/src/application.ts` | Modify | Accept and forward a context reader only in `nodeEnv === 'test'`. |
| `apps/api/src/app.module.ts` | Modify | Null the context reader outside test and register its token separately from the write repository token. |
| `apps/api/test/build-test-application.ts` | Modify | Expose test-only local-Pool adapters for the existing context reader and P11 write repository. |
| `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts` | Create | The one authoritative RED/GREEN success scenario, fake-call/input/nonleak checks, and non-test injection structural gate. |
| `apps/api/test/p11-record-context.postgres.e2e.spec.ts` | Create | One authorized test-only dual-fixture scenario: API identity in PGlite, context data in an isolated local PG18 database, and the existing `P11RecordContextRepository` constructed by the test builder. |
| `apps/api/package.json` | Modify | Declare `pg` and `@types/pg` as API test-only dependencies; no production registration. |
| `package-lock.json` | Modify | Lock the API test-only dependency metadata without changing production runtime wiring. |
| `apps/api/test/openapi.spec.ts` | Modify | Tighten the existing GET 200 OpenAPI assertions to reject undeclared object properties and open array elements. |
| `docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md` | Modify during execution | Mark only completed implementation steps and record the observed RED/GREEN and review stop. Do not update product documentation. |

## Task 1: Write and Observe the Single Context-Success RED Before Production Plumbing

**Files:**
- Create: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`
- Modify: `docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md`
- Test: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`
- Test: `apps/api/test/p11-record-context.postgres.e2e.spec.ts`

- [x] **Step 1: Create the one success test with a local temporary type bridge**

Before creating a production source port, create the test with local bridge types only. The bridge lets TypeScript compile an extra `recordContext` property that current `buildApplication` ignores; it must not alter application source, AppModule, the controller, or the test builder.

```ts
type ContextInputBridge = Readonly<{
  sessionTokenHash: string;
  taskId: string;
  requestId: string;
  nodeEnv: 'test';
}>;

type ContextResultBridge = Readonly<{
  taskId: string;
  planVersion: string;
  businessDate: string;
  accessMode: 'EDITABLE';
  records: readonly [];
}>;

type ContextPortBridge = Readonly<{
  getContext(input: ContextInputBridge): Promise<ContextResultBridge>;
}>;

class LocalContextFake implements ContextPortBridge {
  readonly inputs: ContextInputBridge[] = [];
  readonly internalDetail = 'context-reader-internal-opaque';

  async getContext(input: ContextInputBridge): Promise<ContextResultBridge> {
    this.inputs.push(structuredClone(input));
    return {
      taskId: 'resolved-task-opaque',
      planVersion: 'plan-version-opaque',
      businessDate: 'business-date-opaque',
      accessMode: 'EDITABLE',
      records: [],
    };
  }

  get callCount() { return this.inputs.length; }
}
```

Use the existing `P11RecordPortSchema` only for the pinned test schema fixture; do not import or change `P11RecordRepositoryPort`. Pass the otherwise unknown option through an explicit local cast:

```ts
const fake = new LocalContextFake();
const options = {
  authPolicy: policy,
  routeAccessSnapshot: routeSnapshot('ALLOW'),
  recordSchemaProvider: { getApprovedRecordSchema: async () => contextSchema },
  recordContext: fake,
};
app = await buildApplication(
  environment,
  options as Parameters<typeof buildApplication>[1],
);
```

Write the initial test body exactly as follows after local USER seeding. It may not assert `fake.callCount` until GREEN because current code does not receive the bridged option. The different requested and expected task IDs prevent the later GREEN from simply echoing the URL parameter.

```ts
const requestId = 'context-request-opaque';
const response = await request(app.getHttpServer())
  .get('/api/v1/record-tasks/requested-task-opaque/context')
  .set('Authorization', `Bearer ${token}`)
  .set('x-request-id', requestId);

expect(response.status).toBe(200);
expect(response.body).toEqual({
  businessStatus: 'RECORD_CONTEXT_AVAILABLE',
  taskId: 'resolved-task-opaque',
  planVersion: 'plan-version-opaque',
  businessDate: 'business-date-opaque',
  accessMode: 'EDITABLE',
  schema: {
    version: 'context-schema-opaque',
    testOnly: true,
    recordKinds: [{ id: 'context-kind-opaque', fields: [], allowedActions: ['UPSERT_RECORD'] }],
  },
  records: [],
});
expect(Object.keys(response.body).sort()).toEqual([
  'accessMode', 'businessDate', 'businessStatus', 'planVersion', 'records', 'schema', 'taskId',
]);
```

- [x] **Step 2: Run the test and accept only the real controller 404 as RED**

Run:

```powershell
npx vitest run apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts
```

Expected: one assertion failure where expected status is `200` and actual status is `404` with the current `RECORD_TASK_NOT_FOUND` envelope. The test must be discovered and compile; a TypeScript error, unknown option error, route `503`, session error, or any failure other than this controller 404 is invalid RED and requires stopping.

- [x] **Step 3: Record only the observed RED fact**

Record the actual expected/actual status and error body in this plan's execution notes. Do not update product documentation, create the formal port/token yet, activate another HTTP behavior, or change the completed POST pre-wiring plan.

## Task 2: Add the Independent Context Port and Test-Only Injection Plumbing After RED

**Files:**
- Create: `apps/api/src/records/p11-record-context.port.ts`
- Create: `apps/api/src/records/p11-record-context.token.ts`
- Modify: `apps/api/src/application.ts:26-35`
- Modify: `apps/api/src/app.module.ts:18-20, 36-41, 81-82`
- Modify: `apps/api/test/build-test-application.ts:14-25, 27-42`
- Test: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`

- [x] **Step 1: Create the complete, independent port types**

Create `apps/api/src/records/p11-record-context.port.ts` exactly as follows. The result deliberately excludes schema because the controller must expose the already pinned `RecordSchemaProvider` snapshot, rather than trusting a fake-supplied schema.

```ts
export type P11RecordContextScalar = string | number | boolean;

export type P11RecordContextInput = Readonly<{
  sessionTokenHash: string;
  taskId: string;
  requestId: string;
  nodeEnv: 'test';
}>;

export type P11RecordContextEntry = Readonly<{
  fieldId: string;
  value: P11RecordContextScalar;
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
  getContext(input: P11RecordContextInput): Promise<P11RecordContextResult>;
}
```

- [x] **Step 2: Create the independent token**

Create `apps/api/src/records/p11-record-context.token.ts`:

```ts
export const P11_RECORD_CONTEXT = Symbol('P11_RECORD_CONTEXT');
```

- [x] **Step 3: Thread the reader through application and AppModule without adding controller success behavior**

In `apps/api/src/application.ts`, import `P11RecordContextPort`, add `recordContext?: P11RecordContextPort` to the `options` type, and preserve the existing write-repository gate with a separate value:

```ts
const recordRepository = environment.nodeEnv === 'test' ? options?.recordRepository ?? null : null;
const recordContext = environment.nodeEnv === 'test' ? options?.recordContext ?? null : null;
const app = await NestFactory.create(AppModule.forEnvironment(
  environment,
  options?.authPolicy ?? null,
  options?.mfaVerifier ?? null,
  options?.profileFingerprintSecret ?? null,
  currentConsentVersion,
  options?.routeAccessSnapshot ?? null,
  options?.planClock,
  consentProvider,
  screeningProvider,
  profileSchemaProvider,
  recordSchemaProvider,
  recordRepository,
  recordContext,
), { logger: false });
```

In `apps/api/src/app.module.ts`, import the new token and port type. Add the final parameter and a separate double gate:

```ts
recordRepository: P11RecordRepositoryPort | null = null,
recordContext: P11RecordContextPort | null = null,
): DynamicModule {
  const pinnedAuthPolicy = authPolicy ? Object.freeze({ ...authPolicy }) : null;
  const injectedPlanClock = environment.nodeEnv === 'test' ? planClock : {};
  const injectedRecordRepository = environment.nodeEnv === 'test' ? recordRepository : null;
  const injectedRecordContext = environment.nodeEnv === 'test' ? recordContext : null;
```

Register it as an independent provider next to, not inside, the write repository provider:

```ts
{ provide: P11_RECORD_REPOSITORY, useValue: injectedRecordRepository },
{ provide: P11_RECORD_CONTEXT, useValue: injectedRecordContext },
```

In `apps/api/test/build-test-application.ts`, import `P11RecordContextPort`, add the optional type field, and pass it separately:

```ts
type TestApplicationOptions = {
  // existing fields unchanged
  recordRepository?: P11RecordRepositoryPort;
  recordContext?: P11RecordContextPort;
};

return buildApplication(environment, {
  // existing fields unchanged
  recordRepository: options.recordRepository,
  recordContext: options.recordContext,
});
```

Do not alter `P11RecordRepositoryPort`, `P11_RECORD_REPOSITORY`, database classes, migration files, or route middleware.

- [x] **Step 4: Perform source-only consistency inspection**

Run:

```powershell
rg -n "P11_RECORD_CONTEXT|recordContext|P11RecordContextPort" apps/api/src/application.ts apps/api/src/app.module.ts apps/api/test/build-test-application.ts apps/api/src/records
```

Expected: exactly one new pure port, one token, one application option, one AppModule test-only gate, and one test-builder option; no changes under `packages/database`, `docs/product`, or `apps/web`.

## Task 3: Replace the Temporary Bridge With the Formal Port Test and Preserve RED

**Files:**
- Modify: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`
- Modify: `docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md`
- Test: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`

- [x] **Step 1: Replace the local bridge types and fake with the formal port types and scripted fake**

After Task 2 creates the port/token and test-builder option, replace the Task 1 local bridge declarations with imports of `P11RecordContextInput`, `P11RecordContextPort`, and `P11RecordContextResult`. Keep the same `Environment`, `AuthSecurityPolicy`, local test identity seeding, and `routeSnapshot('ALLOW')` fixture style as `apps/api/test/p11-record-persistence.pre-wiring.e2e.spec.ts`. Use these fixed values and formal fake:

```ts
const contextSchema = {
  version: 'context-schema-opaque',
  testOnly: true,
  approvedForRealUsers: false,
  recordKinds: [{ id: 'context-kind-opaque', fields: [], allowedActions: ['UPSERT_RECORD'] }],
} as const satisfies P11RecordPortSchema;

const contextResult: P11RecordContextResult = Object.freeze({
  taskId: 'resolved-task-opaque',
  planVersion: 'plan-version-opaque',
  businessDate: 'business-date-opaque',
  accessMode: 'EDITABLE',
  records: Object.freeze([]),
});

class ScriptedP11RecordContextFake implements P11RecordContextPort {
  readonly inputs: P11RecordContextInput[] = [];
  readonly internalDetail = 'context-reader-internal-opaque';

  constructor(private readonly result: P11RecordContextResult) {}

  async getContext(input: P11RecordContextInput): Promise<P11RecordContextResult> {
    this.inputs.push(deepFreeze(structuredClone(input)));
    return this.result;
  }

  get callCount() { return this.inputs.length; }
}
```

Keep the test's identity helper local to this new file. It may insert only the synthetic `USER` account/session records already used by the existing API specs. It must use the local test application database only; do not call PostgreSQL or an external database.

- [x] **Step 2: Replace the temporary options cast with the formally typed test fixture**

Keep the single Task 1 `it` and replace its temporary cast with the typed `recordContext: fake` option. It must seed a synthetic USER identity, then call the real controller with a valid bearer and a non-empty safe request ID:

```ts
it('maps one test-only context fake result to the frozen GET context envelope', async () => {
  const fake = new ScriptedP11RecordContextFake(contextResult);
  app = await buildApplication(environment, {
    authPolicy: policy,
    routeAccessSnapshot: routeSnapshot('ALLOW'),
    recordSchemaProvider: { getApprovedRecordSchema: async () => contextSchema },
    recordContext: fake,
  });
  const token = await seedFixtureUser(app, 'context-success');
  const requestId = 'context-request-opaque';
  const response = await request(app.getHttpServer())
    .get('/api/v1/record-tasks/requested-task-opaque/context')
    .set('Authorization', `Bearer ${token}`)
    .set('x-request-id', requestId);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    businessStatus: 'RECORD_CONTEXT_AVAILABLE',
    taskId: 'resolved-task-opaque',
    planVersion: 'plan-version-opaque',
    businessDate: 'business-date-opaque',
    accessMode: 'EDITABLE',
    schema: {
      version: 'context-schema-opaque',
      testOnly: true,
      recordKinds: [{ id: 'context-kind-opaque', fields: [], allowedActions: ['UPSERT_RECORD'] }],
    },
    records: [],
  });
  expect(Object.keys(response.body).sort()).toEqual([
    'accessMode', 'businessDate', 'businessStatus', 'planVersion', 'records', 'schema', 'taskId',
  ]);
  expect(fake.callCount).toBe(1);
  expect(fake.inputs[0]).toEqual({
    sessionTokenHash: createHash('sha256').update(token).digest('hex'),
    taskId: 'requested-task-opaque',
    requestId,
    nodeEnv: 'test',
  });
  expect(JSON.stringify(response.body)).not.toContain(token);
  expect(JSON.stringify(response.body)).not.toContain(createHash('sha256').update(token).digest('hex'));
  expect(JSON.stringify(response.body)).not.toContain(fake.internalDetail);
  expect(app.get(P11_RECORD_REPOSITORY)).toBeNull();
});
```

Do not add another `it` for a fake failure, a missing header, an unknown task, a second closure variant, or an error mapping. The one authorized P11-11 `READ_ONLY` case may seed one closed date and one existing owner record.

- [x] **Step 3: Re-run the same focused test and preserve the behavioral RED**

Run:

```powershell
npx vitest run apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts
```

Expected: the same failure at `expect(response.status).toBe(200)` with actual `404` and the existing `RECORD_TASK_NOT_FOUND` envelope, because `RecordSafeStructureController.context()` still calls `taskNotFound()` after `requireUser()`. This confirms the formal injection compiles but the controller has not yet changed. A type error, test-discovery error, global `503`, session error, or any other failure is invalid and requires stopping.

- [x] **Step 4: Preserve the single RED record in this plan**

Retain the Task 1 observed status/body difference in this plan's execution notes. Do not create a second RED record, update product documentation, activate another HTTP scenario, or modify the completed POST pre-wiring plan.

## Task 4: Implement the Minimal GET Success Mapping and Strict OpenAPI Schema

**Files:**
- Modify: `apps/api/src/records/record-safe-structure.controller.ts:31-37, 59-148, 303-342`
- Modify: `apps/api/test/openapi.spec.ts:260-299`
- Test: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`
- Test: `apps/api/test/openapi.spec.ts`

- [x] **Step 1: Inject the independent context reader**

Add imports without changing the write repository imports:

```ts
import { P11_RECORD_CONTEXT } from './p11-record-context.token.js';
import type { P11RecordContextPort, P11RecordContextResult } from './p11-record-context.port.js';
```

Add the independent optional dependency as the final constructor parameter:

```ts
@Inject(P11_RECORD_CONTEXT) private readonly recordContext: P11RecordContextPort | null,
```

- [x] **Step 2: Replace only the GET placeholder with the minimal success mapping**

Replace the current GET method body with the following. It does not add a new error mapping; valid input is the only newly authorized HTTP behavior. Crucially, an absent reader or any non-test environment stays on the existing `taskNotFound` path, preserving the frozen trusted-USER `404 RECORD_TASK_NOT_FOUND` regression in `apps/api/test/p11-record-safe-structure.e2e.spec.ts`.

```ts
async context(@Param('taskId') taskId: string, @Headers() headers: Record<string, string>) {
  await this.requireUser(headers);
  const requestId = headers['x-request-id'];
  if (this.environment.nodeEnv !== 'test' || !this.recordContext) {
    throw this.taskNotFound(requestId);
  }
  if (!this.recordSchemaProvider) {
    throw this.endpointUnavailable(requestId);
  }
  const schema = await this.requireContextSchema(requestId);
  const token = bearerToken(headers.authorization);
  const input: P11RecordContextInput = Object.freeze({
    sessionTokenHash: createHash('sha256').update(token!).digest('hex'),
    taskId: requiredText(taskId),
    requestId: requiredText(requestId),
    nodeEnv: 'test',
  });
  const result = await this.recordContext.getContext(input);
  return contextResponse(result, schema);
}
```

Add the minimal schema gate inside the class. It is reached only after an explicit test reader exists. It only accepts the existing pinned test-only schema and does not apply write-only dense-field validation; an absent/invalid provider therefore uses the existing endpoint-unavailable envelope only inside that explicit-reader branch:

```ts
private async requireContextSchema(requestId: string) {
  if (!this.recordSchemaProvider) {
    throw this.endpointUnavailable(requestId);
  }
  try {
    const schema = await this.recordSchemaProvider.getApprovedRecordSchema();
    if (!schema.testOnly || schema.approvedForRealUsers) throw this.endpointUnavailable(requestId);
    return schema;
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    throw this.endpointUnavailable(requestId);
  }
}
```

Add this module-local mapper after `bearerToken`. It deliberately removes `approvedForRealUsers` from the public schema and serializes only frozen structural fields:

```ts
function contextResponse(result: P11RecordContextResult, schema: Awaited<ReturnType<RecordSchemaProvider['getApprovedRecordSchema']>>) {
  return {
    businessStatus: 'RECORD_CONTEXT_AVAILABLE',
    taskId: result.taskId,
    planVersion: result.planVersion,
    businessDate: result.businessDate,
    accessMode: result.accessMode,
    schema: {
      version: schema.version,
      testOnly: schema.testOnly,
      recordKinds: schema.recordKinds.map((kind) => ({
        id: kind.id,
        fields: kind.fields.map((field) => ({
          id: field.id,
          valueType: field.valueType,
          ...(field.required === undefined ? {} : { required: field.required }),
        })),
        allowedActions: kind.allowedActions,
      })),
    },
    records: result.records.map((record) => ({
      recordId: record.recordId,
      recordKindId: record.recordKindId,
      recordVersion: record.recordVersion,
      schemaVersion: record.schemaVersion,
      entries: record.entries.map((entry) => ({ fieldId: entry.fieldId, value: entry.value })),
    })),
  };
}
```

- [x] **Step 3: Replace the open GET 200 OpenAPI elements with frozen strict schemas**

Keep `contextSchema`'s seven top-level required fields, but set `additionalProperties: false` at every object level. Use the following nested schema blocks rather than `items: {}`:

```ts
const scalarSchema = { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] };
const contextEntrySchema = {
  type: 'object', additionalProperties: false,
  required: ['fieldId', 'value'],
  properties: { fieldId: { type: 'string' }, value: scalarSchema },
};
const contextRecordSchema = {
  type: 'object', additionalProperties: false,
  required: ['recordId', 'recordKindId', 'recordVersion', 'schemaVersion', 'entries'],
  properties: {
    recordId: { type: 'string' }, recordKindId: { type: 'string' },
    recordVersion: { type: 'integer', minimum: 0 }, schemaVersion: { type: 'string' },
    entries: { type: 'array', items: contextEntrySchema },
  },
};
const contextFieldSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'valueType'],
  properties: {
    id: { type: 'string' }, valueType: { type: 'string', enum: ['STRING', 'NUMBER', 'BOOLEAN'] },
    required: { type: 'boolean' },
  },
};
```

Then make `contextSchema`, its `schema`, and each `recordKinds` object strict. The public schema must require `version`, `testOnly`, `recordKinds`; `testOnly` is `enum: [true]`; each record kind requires `id`, `fields`, and `allowedActions`; `allowedActions` item enum remains `['UPSERT_RECORD']`; and `records.items` is `contextRecordSchema`.

- [x] **Step 4: Tighten the existing OpenAPI contract test without adding an HTTP scenario**

Extend only the existing `publishes the P11 self-scoped record context contract` test:

```ts
expect(response?.additionalProperties).toBe(false);
expect(response?.properties?.schema?.additionalProperties).toBe(false);
expect(response?.properties?.schema?.properties?.testOnly?.enum).toEqual([true]);
expect(response?.properties?.schema?.properties?.recordKinds?.items?.additionalProperties).toBe(false);
expect(response?.properties?.schema?.properties?.recordKinds?.items?.properties?.fields?.items?.additionalProperties).toBe(false);
expect(response?.properties?.records?.items?.additionalProperties).toBe(false);
expect(response?.properties?.records?.items?.properties?.entries?.items?.additionalProperties).toBe(false);
expect(JSON.stringify(response)).not.toContain('approvedForRealUsers');
expect(JSON.stringify(response)).not.toMatch(/userId|role|clientNow|timeZone|risk|threshold|meal|exercise/i);
```

- [x] **Step 5: Run focused GREEN checks**

Run:

```powershell
npx vitest run apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts
npx vitest run apps/api/test/openapi.spec.ts
```

Expected: the context spec reports `1 passed`; the OpenAPI spec reports `4 passed`. The first spec must prove exact seven-key 200 envelope, fake call count `1`, exact hashed-token input, write repository provider null, fake internal nonleakage, and the fake-returned task ID differing from the requested URL value.

## Task 5: Verify the Non-Test Injection Gate Without Adding a Second Business Scenario

**Files:**
- Modify: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`
- Test: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`

- [x] **Step 1: Add the structural non-test gate in the existing success test**

After the asserted test success, close the test app and construct a `nodeEnv: 'production'` app using the same fake option. Assert only the injection boundary and absence of success; do not treat this as a new context business scenario:

```ts
await app?.close();
const productionFake = new ScriptedP11RecordContextFake(contextResult);
app = await buildApplication({ ...environment, nodeEnv: 'production' }, {
  authPolicy: policy,
  recordSchemaProvider: { getApprovedRecordSchema: async () => contextSchema },
  recordContext: productionFake,
  routeAccessSnapshot: routeSnapshot('ALLOW'),
});
expect(app.get(P11_RECORD_CONTEXT)).toBeNull();
const productionResponse = await request(app.getHttpServer())
  .get('/api/v1/record-tasks/requested-task-opaque/context')
  .set('Authorization', 'Bearer production-context-token')
  .set('x-request-id', 'production-context-request');
expect(productionResponse.status).not.toBe(200);
expect(productionFake.callCount).toBe(0);
```

The production environment may be stopped by the existing global readiness middleware before controller authentication. Do not assert a new local production context envelope or infer production authorization from this structural gate.

- [x] **Step 2: Re-run the focused context spec**

Run:

```powershell
npx vitest run apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts
```

Expected: `1 passed`; the same test proves both the one allowed test-only success mapping and the non-test zero-success/zero-fake structural gate.

## Task 6: Focused Regression, Typecheck, Build, and Scope Verification

**Files:**
- Modify: `docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md`
- Test: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`
- Test: `apps/api/test/p11-record-persistence.pre-wiring.e2e.spec.ts`
- Test: `apps/api/test/p11-record-safe-structure.e2e.spec.ts`
- Test: `apps/api/test/p11-record-schema-provider.spec.ts`
- Test: `apps/api/test/openapi.spec.ts`

- [x] **Step 1: Run the complete focused P11 regression**

Run:

```powershell
npx vitest run apps/api/test/p11-record-context.postgres.e2e.spec.ts apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts apps/api/test/p11-record-persistence.pre-wiring.e2e.spec.ts apps/api/test/p11-record-safe-structure.e2e.spec.ts apps/api/test/p11-record-schema-provider.spec.ts apps/api/test/openapi.spec.ts
```

After the authorized P11-08 absent-create slice, the focused test passed `1 passed / 18 skipped`, the complete PG18 adapter file passed `19 passed`, and all six specified files passed `73 passed / 0 skipped`. This includes the prior isolated PG18 scenarios and the single absent-record concurrent-create race. The existing session/role/global-route/non-enumeration tests remain regression evidence; no further HTTP, create, concurrency, replay, changed-intent, schema, or ordering variant is authorized.

- [x] **Step 2: Run API typecheck and build**

Run:

```powershell
npm run typecheck --workspace @lianban/api
npm run build --workspace @lianban/api
```

Expected: both commands exit `0`; only the authorized API test-only `pg`/`@types/pg` dependency metadata may be present in `apps/api/package.json` and `package-lock.json`; no production registration, migration outside the isolated fixture, external/production database, or deployment action occurs.

- [x] **Step 3: Run required non-mutating scope checks instead of committing**

Run:

```powershell
git diff --check -- docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md apps/api/src/records/p11-record-context.port.ts apps/api/src/records/p11-record-context.token.ts apps/api/src/records/record-safe-structure.controller.ts apps/api/src/application.ts apps/api/src/app.module.ts apps/api/test/build-test-application.ts apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts apps/api/test/openapi.spec.ts
git status --short
git diff --cached --quiet
```

Expected: `git diff --check` exits `0`; status contains only the authorized context files plus pre-existing user changes; `git diff --cached --quiet` exits `0`. Do not stage, commit, push, deploy, reset, checkout, or revert.

- [x] **Step 4: Stop for the required review sequence**

Record that implementation evidence is ready, then stop. The fixed sequence is: R&D self-check -> QA read-only evidence/range check -> one specified Sol Critical formal read-only review -> product stop. No UI work, database adapter, production registration, real-user path, G2/G3 action, or next scenario is authorized by GREEN.

## Execution Record (2026-07-31 Asia/Shanghai)

- **RED:** The initial local-bridge test was discovered and compiled. It expected HTTP `200` and received HTTP `404` at the success-status assertion; the current controller path is the frozen `RECORD_TASK_NOT_FOUND` response. After adding the formal port/token/test-only injection plumbing but before implementing the GET branch, the same test again expected `200` and received `404`. No type error, route `503`, or session failure was accepted as RED.
- **GREEN:** The controller now invokes the independent test-only context reader exactly once after trusted USER authorization, returning the frozen seven-key `RECORD_CONTEXT_AVAILABLE` envelope from the fake result and pinned schema. The test proves the SHA-256 bearer-token input, requested opaque task ID, request ID, `nodeEnv: 'test'`, write-repository token nullness, response nonleakage, and the fake-returned opaque task ID. The same test proves the non-test injection token is null, fake calls remain zero, and no production success response is observed.
- **Strict OpenAPI:** The existing GET `200` schema is strict at every response object level; it no longer uses open array element shapes and does not expose `approvedForRealUsers` or unapproved fields.
- **PG18 adapter RED:** The newly authorized isolated-PG test first expected HTTP `200 RECORD_CONTEXT_AVAILABLE` while the current test builder ignored its temporary `recordContextPool`; the real controller returned the frozen `404 RECORD_TASK_NOT_FOUND`. This was the valid behavioral RED; no type error, external database, or production path was used.
- **PG18 adapter GREEN:** After the RED, only `apps/api/test/build-test-application.ts` constructed the existing `P11RecordContextRepository` from the supplied `pg.Pool` and passed it through the existing test-only context port. The temporary Pool option is stripped before calling production `buildApplication`; API identity/session remains PGlite while context identity/session, gate, plan, task, and records are seeded in an isolated local PG18 database whose lifecycle is created and dropped inside the test.
- **QA fixes:** The PG18 test now verifies every cleanup step is attempted independently and all cleanup failures are aggregated; when the business operation also fails, the original operation error is retained alongside cleanup errors. The API/database schema bridge now validates the incoming schema with the existing runtime validator and creates a fresh database-side structure without a double type assertion.
- **P11-11 direct GREEN:** The authorized closed-date scenario was added to the existing PG18 adapter test. It expected HTTP `200 RECORD_CONTEXT_AVAILABLE`, `accessMode: 'READ_ONLY'`, an empty `allowedActions` array, and the owner's existing record with no write. The QA correction first produced a real RED because `contextResponse` still exposed the schema's `['UPSERT_RECORD']`; the minimal GREEN now emits empty actions only for `READ_ONLY` while preserving `EDITABLE` write actions. Before/after PG18 snapshots now compare complete rows (`SELECT *`) and counts for `planning.plan`, `planning.plan_version`, `recording.record_task`, `recording.record`, `recording.record_idempotency`, `recording.record_success_audit`, and `audit.audit_event`, including timestamp, digest, payload, and other migration-defined columns.
- **P11-12 RED:** The authorized closed-date legal `UPSERT_RECORD` test first reached the real controller with the supplied PG18 pool ignored by the test builder and returned `503` endpoint fallback instead of the expected `409 RECORD_STATE_BLOCKED`; a transient local PG18 service refusal and default 5-second timeout were infrastructure failures, not RED evidence. After the local test-only PG18 service was available, the expected 503 behavioral RED was observed.
- **P11-12 GREEN:** Only `apps/api/test/build-test-application.ts` now constructs the reviewed `P11RecordRepository` from an explicitly supplied local PG18 Pool, converts its typed repository errors into the existing API port outcome, and keeps API identity in PGlite. The real controller returned `409 RECORD_STATE_BLOCKED`, `DISABLE_EDITOR`, and `recoverableActions: []`; the complete-row and count snapshots for all seven related tables remained equal before and after.
- **P11-12 task-state direct GREEN:** The newly authorized `task_state=CLOSED` legal `UPSERT_RECORD` test reached the existing real controller and test-only `recordRepositoryPool` adapter. Its first focused run passed directly with the required `409 RECORD_STATE_BLOCKED`, `DISABLE_EDITOR`, and empty `recoverableActions`; no RED was observed and no controller, adapter, or production implementation was changed. Before/after snapshots compare ordered complete `SELECT *` rows and counts for all seven related tables and were equal.
- **P11-12 risk-state direct GREEN:** The newly authorized `risk_state=BLOCKED` legal `UPSERT_RECORD` test reached the existing real controller and test-only `recordRepositoryPool` adapter while `task_state/date_state` remained `OPEN`. Its first focused run passed directly with the required `409 RECORD_STATE_BLOCKED`, `DISABLE_EDITOR`, and empty `recoverableActions`; no RED was observed and no controller, adapter, or production implementation was changed. Before/after snapshots compare ordered complete `SELECT *` rows and counts for all seven related tables and were equal. This is only existing machine-state coverage; no risk threshold, trigger, scope, recovery, safety wording, or SLA was defined.
- **P11-12 risk-state first-write direct GREEN:** The newly authorized `risk_state=BLOCKED` first legal `UPSERT_RECORD` test used the existing real controller and test-only `recordRepositoryPool` adapter with `task_state/date_state=OPEN`, no owner record, and `expectedRecordVersion: null`. Its first focused run passed directly with the required `409 RECORD_STATE_BLOCKED`, `DISABLE_EDITOR`, and empty `recoverableActions`; no RED was observed and no controller, adapter, or production implementation was changed. Before/after snapshots compare ordered complete `SELECT *` rows and counts for all seven related tables and were equal. This is only existing machine-state coverage; no risk threshold, trigger, scope, recovery, safety wording, or SLA was defined.
- **P11-12 date-state first-write direct GREEN:** The newly authorized `date_state=CLOSED` first legal `UPSERT_RECORD` test used the existing real controller and test-only `recordRepositoryPool` adapter with `task_state=OPEN`, `risk_state=CLEAR`, no owner record, and `expectedRecordVersion: null`. Its first focused run passed directly with the required `409 RECORD_STATE_BLOCKED`, `DISABLE_EDITOR`, and empty `recoverableActions`; no RED was observed and no controller, adapter, or production implementation was changed. Before/after snapshots compare ordered complete `SELECT *` rows and counts for all seven related tables and were equal. No closing-time, backfill, professional, or other date semantics were defined.
- **P11-12 task-state first-write direct GREEN:** The newly authorized `task_state=CLOSED` first legal `UPSERT_RECORD` test used the existing real controller and test-only `recordRepositoryPool` adapter with `date_state=OPEN`, `risk_state=CLEAR`, no owner record, and `expectedRecordVersion: null`. Its first focused run passed directly with the required `409 RECORD_STATE_BLOCKED`, `DISABLE_EDITOR`, and empty `recoverableActions`; no RED was observed and no controller, adapter, or production implementation was changed. Before/after snapshots compare ordered complete `SELECT *` rows and counts for all seven related tables and were equal. No closing-time, backfill, professional, or other task semantics were defined.
- **P11-03 cross-user direct GREEN:** The newly authorized fictional USER A request for the complete fictional USER B account/plan/plan-version/task chain reached the existing real controller and test-only `recordRepositoryPool` adapter. Its first focused run passed directly with `404 RECORD_TASK_NOT_FOUND`, `CLEAR_ALL`, and empty `recoverableActions`; the exact public envelope excludes the USER B, plan, task, schema, and state sentinels. Before/after snapshots compare ordered complete `SELECT *` rows and counts for all seven related tables and were equal. This cross-layer fixture establishes only the observed local API-to-PG18 outcome; API fake evidence and repository unit evidence remain separate, and it does not prove production anti-enumeration, locking, concurrency, idempotency, or audit atomicity.
- **P11-03 missing-task direct GREEN:** The newly authorized trusted USER request submitted a legal `UPSERT_RECORD` for opaque `missing-opaque-task`, which has no matching task row in the isolated PG18 fixture. The existing real controller and test-only `recordRepositoryPool` adapter returned `404 RECORD_TASK_NOT_FOUND`, `CLEAR_ALL`, and empty `recoverableActions` on the first focused run; no RED was observed because the controller mapping was already GREEN. The exact public envelope excludes the bearer, missing task identifier, schema version, idempotency key, entry value, and known fixture sentinels. Before/after snapshots compare ordered complete rows and counts from the expanded ten-table `readReadOnlyState` helper: `iam.account`, `iam.session`, `recording.p11_write_gate`, `recording.p11_write_gate_revision`, `recording.record_task`, `planning.plan`, `planning.plan_version`, `recording.record`, `recording.record_idempotency`, and `recording.record_success_audit`; all remained equal. This proves only the observed test-only API-to-PG18 outcome; fake/controller and repository-unit evidence remain separate, and it does not prove production behavior, locking, concurrency, idempotency, audit atomicity, or real-user readiness.
- **Verification:** The prior P11-03 command and counts remain historical; the current P11-04 focused, PG18, six-file, typecheck, and build evidence is recorded in the bullet above. No runtime implementation changed in this slice.
- **P11-03 missing-task verification:** The focused command `npx --no-install vitest run apps/api/test/p11-record-context.postgres.e2e.spec.ts -t "does not enumerate a missing task"` passed `1 passed / 11 skipped`. The complete existing adapter file then passed `12 passed / 0 skipped` in `14.09 s` after the ten-table snapshot expansion. No production source, builder, repository, package metadata, UI, or other skipped scenario changed. PostgreSQL used only the configured loopback admin URL; the isolated generated database was cleaned by the existing harness. This direct GREEN remains pending QA independent reproduction and the specified Sol Critical review.
- **P11-04 plan-not-active direct GREEN:** The authorized fictional USER request submitted a legal first `UPSERT_RECORD` with `expectedRecordVersion: null` after only the associated `planning.plan_version` row was changed from `ACTIVE` to the existing migration-allowed `SUPERSEDED` status; `recording.record_task` remained `OPEN/OPEN/CLEAR` and no owner record was inserted. The existing real controller and test-only `recordRepositoryPool` adapter returned `409 RECORD_PLAN_NOT_ACTIVE`, `CLEAR_ALL`, and empty `recoverableActions` on the first focused run; no RED was observed, so no controller, builder, repository, database package, or production implementation changed. The public envelope excludes the bearer, task, plan, plan-version, schema, idempotency key, entry value, user, and fixture status sentinels. The focused command passed `1 passed / 12 skipped` in `3.93 s` (test body `2.32 s`); the complete PG18 adapter file passed `13 passed` in `15.68 s`; all ten-table snapshots (`iam.account`, `iam.session`, `recording.p11_write_gate`, `recording.p11_write_gate_revision`, `recording.record_task`, `planning.plan`, `planning.plan_version`, `recording.record`, `recording.record_idempotency`, and `recording.record_success_audit`) were equal before and after. The six-file P11 regression passed `66 passed / 0 skipped` in `45.80 s`; API typecheck and build both exited `0`. This proves only the observed local test-only API-to-PG18 mapping and zero-write fixture outcome; it does not prove general plan authorization, PostgreSQL locking/concurrency/idempotency/audit atomicity, production behavior, real-user readiness, G2, or G3.
- **P11-08 concurrent existing-record direct GREEN:** The authorized isolated PG18 test seeded one owner record at version `1`, then sent two real API requests with distinct valid sessions, request IDs, idempotency keys, and opaque entries against the same task/kind/schema and `expectedRecordVersion=1`. The test-only PoolClient barrier held the first transaction after it acquired the account `FOR UPDATE`; the second transaction attempted the same PostgreSQL lock and `pg_stat_activity` observed `wait_event_type='Lock'` before release. After release, exactly one response was `200 RECORD_WRITE_ACCEPTED` with `recordVersion: 2`, and exactly one was `409 RECORD_VERSION_CONFLICT` with `PRESERVE_DRAFT_FOR_VERSION_CONFLICT` and `recoverableActions: ['REFRESH']`; the conflict request ID matched its request and the audit request ID matched the successful request. The final record remained one row at version `2` with only the successful entry; idempotency and success-audit counts each increased by exactly one, the failed request produced no success audit/idempotency row, and all seven authority table projections remained unchanged. Public responses excluded both tokens, raw idempotency keys, and both entry values; persisted projections excluded tokens, raw keys, and the rejected entry while retaining the required successful entry. The first focused run was direct GREEN with no production change; the final focused command passed `1 passed / 13 skipped` in `2.66 s` (test body `1.58 s`), the complete PG18 adapter file passed `14 passed` in `15.54 s`, and the final six-file regression passed `68 passed / 0 skipped` in `50.62 s`. API typecheck/build exited `0`. This proves only the observed local PG18 lock-wait, controller-to-adapter outcome, and fixture projections; fake/controller and repository-unit evidence remain separate, and it does not prove general production concurrency, external database behavior, real-user readiness, G2, or G3.
- **P11-08 assertion repair:** The P11-08 test now treats the existing success envelope as having no `requestId`; the 409 envelope must carry the losing request's exact request ID, while the successful request's correlation is verified through `record_success_audit.request_id`. It reads `recordRows.rows[0].entries` directly and requires deep equality with the one successful persisted entry, including the actual `valueType` column and the `fieldId/value` projection, with no rejected or extra value. It reads the actual migration columns from the sole new `record_idempotency` row and requires `status='COMPLETED'`, `record_id` equal to the final record, and exact `replay_result={recordId, recordVersion: 2, schemaVersion: 'schema-v1'}`. The repair changed tests and this plan only; no RED was fabricated and no production behavior changed. Focused verification passed `1 passed / 13 skipped` in `4.03 s`; the complete PG18 file passed `14 passed` in `20.66 s`; the six-file regression passed `68 passed / 0 skipped` in `55.45 s`; API typecheck/build both exited `0`. The local isolated PG18 databases were cleaned and the server was restored to its pre-run stopped state.
- **P11-08 Sol Critical Important closure:** The test-only evidence now binds the sole new `record_idempotency` row to the winning request's `session_id` (`context-session-1` or `context-session-2`) and computes both request digests with the repository's actual active key material, domain, NUL separator, and HMAC-SHA256 rule. The persisted `bytea` digest must equal the winner's digest and differ from the losing request's digest; `status='COMPLETED'`, `record_id`, and exact `replay_result={recordId, recordVersion: 2, schemaVersion: 'schema-v1'}` remain required. The lock-barrier request section now has bounded barrier waits, a 5-second Supertest deadline, unconditional `releaseFirst()` in `finally`, and bounded rejection consumption for both response promises, so assertion failures cannot strand the first transaction or prevent isolated-pool cleanup. This was a test/plan-only evidence repair: no controller, repository, database package, migration, production wiring, or product behavior changed; fake/controller and PG18 lock/idempotency/audit evidence remain separate. The repair was direct GREEN with no fabricated RED. Focused verification passed `1 passed / 13 skipped` in `2.96 s`; the complete PG18 file passed `14 passed` in `15.99 s`; the six-file regression passed `68 passed / 0 skipped` in `43.68 s`; API typecheck and build both exited `0`. Post-run inspection found zero `lianban_p11_test_*` databases, and the local user-mode PG18 server was restored to its pre-run stopped state with `pg_ctl stop -m fast -w`.
- **P11-09 out-of-order old request direct GREEN:** The authorized test-only PG18 scenario seeds one owner record at version `1`, sends a newer legal `UPSERT_RECORD` with `expectedRecordVersion=1` and a new request/idempotency key, then sends a distinct older legal request with the same task/kind/schema and the same stale expected version. The existing real controller and test-only `P11RecordRepository` adapter return `200 RECORD_WRITE_ACCEPTED` with version `2` for the newer request and `409 RECORD_VERSION_CONFLICT / PRESERVE_DRAFT_FOR_VERSION_CONFLICT / ['REFRESH']` bound to the older request ID. The final record remains one row with `schema-v1`, version `2`, and deep-equal entries from only the newer request. The sole new idempotency row is `COMPLETED`, bound to `context-session-1` and the newer request's actual HMAC digest, with exact replay result; the older digest is absent and the only success audit belongs to the newer request. Authority and side-effect snapshots use the existing ten-table `SELECT *` helper; the old raw key/token/entry do not appear in public responses or persisted projections. No client timestamp or ordering field was added; the repository's authoritative record version alone decides the stale rejection. The first run had a test-only assertion error because the new nonleak list incorrectly prohibited the contract-required public `schema-v1`; this was corrected without production changes and is not behavioral RED. The corrected focused command passed `1 passed / 14 skipped` in `2.72 s`; the complete PG18 file passed `15 passed` in `17.51 s`; the six-file regression passed `69 passed / 0 skipped` in `43.72 s`; API typecheck and build both exited `0`. Cleanup found zero temporary `lianban_p11_test_*` databases. PG18 was already running before this slice under another process; the attempted `pg_ctl stop -m fast -w` returned `Operation not permitted` and did not change that pre-run state, so no stop-state claim is made.
- **P11-10 schema-version conflict direct GREEN:** The authorized test-only PG18 scenario seeds the existing owner record at `schema-v1`, version `1`, with the approved gate/task/schema still `schema-v1`, then submits one otherwise legal `UPSERT_RECORD` whose command alone requests `schema-v2`. The existing real controller and test-only `P11RecordRepository` adapter return `409 RECORD_SCHEMA_VERSION_CONFLICT / CLEAR_ALL / ['REFRESH']` bound to the request ID before creating any idempotency or success-audit row. The ten-table `SELECT *` snapshot remains exactly equal; the record stays one row at version `1` with `schema-v1` and its baseline entries, and no raw token, idempotency key, attempted entry, `schema-v2`, or internal state appears in public or persisted projections. The first focused run failed only because the new test incorrectly expected a `valueType` field in the pre-existing baseline JSON entry; this was a fixture assertion error, not behavioral RED, and was corrected without production changes. The corrected focused command passed `1 passed / 15 skipped` in `2.69 s`; the complete PG18 file passed `16 passed` in `17.68 s`; the six-file regression passed `70 passed / 0 skipped` in `44.87 s`; API typecheck and build both exited `0`. The local temporary-database check found no `lianban_p11_test_*` databases. PG18 was an existing process and remains accepting connections; stopping it was not attempted in this record because the prior `pg_ctl stop -m fast -w` returned `Operation not permitted`.
- **P11-06 same-intent replay direct GREEN:** The authorized test-only PG18 scenario seeds an existing owner record at version `1`, then submits one complete valid `UPSERT_RECORD` and repeats the identical normalized command with the same raw idempotency key but a different request ID through the real controller and isolated `P11RecordRepository`. Both responses are deep-equal `200 RECORD_WRITE_ACCEPTED` results with version `2`; the successful response contains no `requestId`. After the first request, the record advances once and exactly one `COMPLETED` idempotency row and one success audit exist. After the replay, record rows/version/entries, idempotency count and row, replay result, session/key digest, audit count and request binding remain unchanged. Public and persisted projections exclude raw token/key/request IDs and internal state. This is real API-to-PG18 replay evidence; controller fake and repository-unit evidence remain separate. The first focused run passed directly with no RED and no production change. Focused passed `1 passed / 16 skipped` in `2.83 s`; complete PG18 passed `17 passed` in `19.07 s`; six-file regression passed `71 passed / 0 skipped` in `46.92 s`; API typecheck and build both exited `0`. Temporary database count was zero after the run; the existing PG18 process was not stopped.
- **P11-07 same-key changed-intent direct GREEN:** The authorized test-only PG18 scenario seeds an existing owner record at version `1`; the first legal `UPSERT_RECORD` succeeds with one opaque entry, then the second request keeps subject/task/kind/schema/expected version/raw key unchanged and changes only that entry value. The existing repository compares the persisted intent digest and returns `409 IDEMPOTENCY_KEY_REUSED / CLEAR_ALL / ['USE_NEW_IDEMPOTENCY_KEY']` bound to the second request ID. The post-second ten-table snapshot is deep-equal to the post-first snapshot: the record remains version `2` with only the first entry; exactly one `COMPLETED` idempotency row remains bound to the real key digest/session and exact replay result; exactly one success audit remains bound to the first request. The second response excludes the first result and both opaque values; persisted projections exclude the raw key/token and rejected entry. This is real API-to-PG18 changed-intent evidence, separate from fake/controller and repository-unit tests. The first focused run was direct GREEN with no RED and no production change. Focused passed `1 passed / 17 skipped` in `2.84 s`; complete PG18 passed `18 passed` in `20.49 s`; six-file regression passed `72 passed / 0 skipped` in `47.45 s`; API typecheck and build both exited `0`.
- **P11-07 UI Important closure:** The read-only UI review found that the parser already accepted the frozen `IDEMPOTENCY_KEY_REUSED / CLEAR_ALL / ['USE_NEW_IDEMPOTENCY_KEY']` envelope, but the prior client-state reducer did not include `IDEMPOTENCY_KEY_REUSED` in its controlled clearing set. The real focused RED cleared the stale record/draft/editor state through the generic fail-closed fallback but dropped the contract-required sole visible action, so the result did not equal the expected cleared state with `visibleRecoverableActions: ['USE_NEW_IDEMPOTENCY_KEY']`. Under the product's same-scenario authorization, the minimal GREEN changed only `apps/web/src/features/p11-real/p11-client-state.ts` and `apps/web/src/features/p11-real/p11-client-state.spec.ts`: `IDEMPOTENCY_KEY_REUSED` now enters `CLEAR_ALL`, clears trusted subject/task/target/record/unsaved input/conflict draft/editor, and retains only an exact one-element `['USE_NEW_IDEMPOTENCY_KEY']`; malformed, missing, or extra actions remain fail-closed. UI focused verification passed `60/60`, Web typecheck and diff checks passed. The `.tsx` page file is outside the Vitest include set and was not collected, so it is not counted as passing page evidence. QA independently reran the repaired UI suite at `60/60` and Web typecheck and returned `QA_CLEAR`. The API evidence remains focused `1 passed / 17 skipped`, PG18 `18 passed`, and six-file API regression `72 passed / 0 skipped`; the UI repair does not enlarge that API/database evidence. No controller, repository, database package, migration, page, product semantics, production wiring, or release gate changed.

### 2026-08-24 P11-DUAL-FIXTURE-RECORD-WRITE execution evidence

- The named test `dual fictional fat-loss and muscle-gain fixtures write independently` uses actual fictional mappings `persona_fat_loss -> FAT_LOSS` and `persona_muscle_gain -> MUSCLE_GAIN`, with separate account/session/plan/ACTIVE plan_version/task chains in isolated PG18.
- Both record projections assert `record_kind_id`, `business_date='2026-01-02'`, schema/version, subject/task binding, and the corresponding opaque entry. The authority projections are compared before and after the writes.
- Each idempotency projection asserts business date, complete normalized `intent_digest` (operation, kind, schema, expected version, field/type/value, active HMAC key and NUL separators), key id, raw-key digest, task/principal/session scope, record kind/schema/operation/status, record id, and exact replay result. Each success audit asserts record id, schema version, RECORD_UPSERTED action, P11_RECORD subject type, actor, request id, task, and version.
- Focused execution reported `1 passed / 19 skipped`; temporary PG18 database count was `0`; diff-check passed; no production implementation, migration, UI, message, or data-rights behavior changed. Boundary reviews recorded `QA_CLEAR`, `SECURITY_NO_OBJECTION`, `PROFESSIONAL_CLEAR`, `UI_NO_CHANGE_CLEAR`, and `OPERATIONS_BLOCKED / MAINTAINED`. This evidence remains limited to the named test-only slice pending Sol Critical review.
- **P11-08 concurrent absent-record create direct GREEN:** The authorized test-only PG18 scenario starts with zero record rows and two valid sessions. Both requests target the same task/kind/schema with `expectedRecordVersion=null` but use distinct request IDs, raw keys, and opaque entries. The reused bounded P11-08 barrier holds the first transaction immediately after it acquires the repository's earliest same-subject `iam.account FOR UPDATE`; because the frozen repository lock order takes this lock before `record_task FOR UPDATE`, the second transaction is observed in `pg_stat_activity` with `wait_event_type='Lock'` before it can reach the task lock. Releasing the barrier lets the first transaction continue through task locking and create version `1`; the second then continues through the same task lock and authoritative record re-read, observes the new record, and returns `409 RECORD_VERSION_CONFLICT / PRESERVE_DRAFT_FOR_VERSION_CONFLICT / ['REFRESH']` bound to its request ID. No additional task-level hook was added because it would duplicate or bypass the real earlier serialization boundary. All barrier signals and requests remain bounded, and `finally` unconditionally releases the first transaction and consumes both requests.
- **P11-08 absent-create persistence evidence:** Exactly one response is `200 RECORD_WRITE_ACCEPTED` version `1` and one is the frozen 409 conflict. The final database has one version-1 record whose schema and complete entries equal only the winner; exactly one `COMPLETED` idempotency row is bound to the winner's session, actual HMAC digest, record, and exact replay result; exactly one success audit is bound to the winner's request. The loser key digest, entry, completed idempotency result, and success audit are absent, while all seven authority projections remain unchanged. Public and persisted projections exclude both tokens, raw keys, and rejected entry. The focused run was direct GREEN with no RED and no production change. Focused passed `1 passed / 18 skipped` in `2.70 s`; complete PG18 passed `19 passed` in `21.63 s`; six-file regression passed `73 passed / 0 skipped` in `48.82 s`; API typecheck and build both exited `0`. Post-run inspection found zero `lianban_p11_test_*` databases; the pre-existing external PG18 process remained accepting loopback connections and was not stopped. This proves only the observed local test-only lock wait and resulting API-to-PG18 create race, not production lock policy or general concurrency/idempotency/audit atomicity.
- **P11-04 fixture correction:** Review found the prior seed's `now() +/- 1 day` plan window did not cover the fixed `record_task.business_date = 2026-01-02`, so `RECORD_PLAN_NOT_ACTIVE` could have been a date-window false positive. The test-only seed now uses `effective_at = 2026-01-01T00:00:00Z` and `effective_to = 2099-01-01T00:00:00Z`, covering both the task business date and the repository's current-time check. Before changing the only business state, the test asserts the associated row is `ACTIVE` and both date-window predicates are true; it then changes only that row to `SUPERSEDED` and retains `OPEN/OPEN/CLEAR`, with no owner record. The focused rerun passed `1 passed / 12 skipped`; the complete PG18 adapter file passed `13 passed / 0 skipped`; the six-file regression passed `66 passed / 0 skipped` in `23.85 s`; API typecheck and build exited `0`. No production/runtime wiring changed.
- **P11-05 client-user-field direct GREEN:** The authorized fake/controller test sends an otherwise legal trusted USER `UPSERT_RECORD` with only the extra client-supplied `userId` authority field. The existing strict command schema rejects it before the repository port with `400 RECORD_REQUEST_INVALID`, `CLEAR_ALL`, and empty `recoverableActions`; the scripted fake call count remains zero and the forged value is absent from the public response. The first focused run passed directly with `1 passed / 29 skipped`; no RED was fabricated because the strict behavior already existed. The required non-PG P11 API regression (persistence pre-wiring, safe-structure, schema-provider, and OpenAPI files) passed `53 passed / 0 skipped`; API typecheck/build and diff checks passed. No controller, repository, database, PG18, UI, production wiring, package metadata, or other skipped scenario changed.
- **Evidence boundary:** The PG18 test proves only that the existing repository can be invoked through the test-only API builder against its isolated fixture and that its test cleanup/schema bridge fail closed. The controller fake proves only controller input/output mapping, call count, nonleakage, strict OpenAPI structure, and test-only injection. Neither proves production adapter registration, external/production database behavior, real-user task ownership approval, release readiness, G2, or G3.
- **Stop:** R&D self-check is complete. Stop for QA read-only evidence/range checking, then the single specified Sol Critical formal read-only review, then the product stop. There is no automatic next scene or next phase authorization; `readyForRealUsers=false`, G2 is not reached, and G3 remains prohibited.

## P11-DUAL-FIXTURE-RECORD-WRITE Execution Record (2026-08-24)

- **RED:** The first named-test run used the existing context fixture for the fat-loss subject and only a hand-seeded muscle account/session; the real API returned `[200, 404]` rather than the required `[200, 200]` because the second subject had no complete plan/task ownership chain. This was a valid cross-layer fixture RED. Subsequent fixture setup corrections were limited to test SQL ordering and migration-approved confirmation/published timestamps; no production behavior changed.
- **GREEN:** The test now uses the actual existing persona identities `persona_fat_loss` and `persona_muscle_gain`, with explicit approved fixture mapping `persona_fat_loss -> FAT_LOSS` and `persona_muscle_gain -> MUSCLE_GAIN` in the test-only plan payload. Each persona has its own account/session plus independent opaque task, plan, plan-version, request, idempotency key, and `field-1` value. Both requests use the existing record command route, `schema-v1`, `kind-1`, and `expectedRecordVersion=null`.
- **Assertions:** The named test proves both `200 RECORD_WRITE_ACCEPTED` version-1 responses; final records contain `record_kind_id='kind-1'`, correct persona user/task binding, schema/version, and only that persona's entry. Each `record_idempotency` row is checked for actual `key_id`, task/principal/session, record kind, schema, operation, `COMPLETED`, record ID, HMAC digest, and exact `{recordId, recordVersion: 1, schemaVersion: 'schema-v1'}` replay result. Each success audit is checked for task, actor, action `RECORD_UPSERTED`, subject type `P11_RECORD`, record ID, request ID, version, and schema. Authority projections (`accounts`, `sessions`, gate, gate revisions, tasks, plans, plan versions) are unchanged before/after; public responses exclude both tokens, raw keys, entries, and the other persona's fixture identifiers.
- **Focused evidence:** `npx --no-install vitest run apps/api/test/p11-record-context.postgres.e2e.spec.ts -t "dual fictional" --maxWorkers=1 --minWorkers=1 --testTimeout=30000` -> `1 passed / 19 skipped`, exit code `0`, `5.65s`. This is test-only API-to-isolated-PG18 evidence; it does not prove production persona routing, messages, data-rights, professional semantics, G2/G3, or release readiness. The test file remains untracked in the shared dirty worktree; no normal tracked-diff-only claim is made.

## Plan Self-Review Checklist

- [x] **Spec coverage:** Verified the plan covers the approved design's independent context port/token, test-only double gate, one 404-to-200 success TDD path, the separately authorized P11-12 test-only 409 closed-date, closed-task, and blocked-risk existing-record and first-write rejections, the P11-03 complete cross-user 404 rejection, the P11-04 non-`ACTIVE` plan-version 409 rejection, the P11-05 forged top-level `userId` strict-schema `400 RECORD_REQUEST_INVALID / CLEAR_ALL / []` rejection with zero fake calls and no forged-value reflection, the P11-08 existing-record and absent-record PG18 lock-wait races with one success and one preserved-draft version conflict, the P11-09 sequential newer-success/older-stale rejection with one version-2 record and no old-request success side effects, the P11-10 schema-version conflict with unchanged version-1 record and zero write side effects, the P11-06 same-intent replay with equal responses and exactly one persisted success result, and the P11-07 same-key entry-value changed-intent rejection with the first persisted success unchanged plus its authorized UI `CLEAR_ALL` consumption retaining only `USE_NEW_IDEMPOTENCY_KEY`; it also covers strict OpenAPI, fake/nonleak evidence, non-test no-success gate, existing rejection regressions, evidence separation, and post-GREEN review order.
- [x] **Placeholder scan:** Verified there are no implementation placeholders; the literal `TODO` and `TBD` words appear only in this completed scan criterion.
- [x] **Type consistency:** Verified `P11RecordContextPort.getContext`, `P11RecordContextInput`, `P11RecordContextResult`, `P11_RECORD_CONTEXT`, `recordContext`, and `contextResponse` use the same spellings and fields in every task.
- [x] **Scope check:** Verified the only new HTTP business results are the valid test-only 200 context success, the authorized P11-12 test-only 409 `RECORD_STATE_BLOCKED` closed-date, closed-task, and blocked-risk existing-record and first-write rejections, the authorized P11-03 test-only 404 `RECORD_TASK_NOT_FOUND` complete cross-user rejection, the authorized P11-04 test-only 409 `RECORD_PLAN_NOT_ACTIVE` non-`ACTIVE` plan-version rejection, the authorized P11-05 top-level forged `userId` pre-repository `400 RECORD_REQUEST_INVALID / CLEAR_ALL / []` rejection, the authorized P11-08 existing-record and absent-record races' 200/409 pairs, the authorized P11-09 sequential newer-success/older-stale 200/409 pair, the authorized P11-10 `RECORD_SCHEMA_VERSION_CONFLICT` 409, the authorized P11-06 same-intent replay's repeated 200 result, and the authorized P11-07 entry-value changed-intent 409. The P11-07 UI repair consumes that existing envelope only: it adds no HTTP result, page, text, or product behavior. All other P11-05 variants, changed-intent dimensions, concurrency/create/ordering variants, production/real-user/release paths, and error behavior remain frozen, existing regression, or structural test-only gate evidence.

## Execution Stop Conditions

Stop and report immediately if an authorized scenario does not produce its recorded RED/direct-GREEN evidence, if either P11-08 race cannot observe the second real PG18 transaction waiting at the repository's earliest same-subject account lock before release and then continue through task locking/authoritative re-read, if P11-09 requires a client timestamp/order field or any rule beyond authoritative record-version comparison, if P11-10 requires schema migration/new schema semantics or any rule beyond the existing version-conflict mapping, if P11-06 requires a replay rule beyond the existing key/intent digest and persisted replay result, if P11-07 requires another changed-intent dimension, new idempotency semantics, a page, or any UI work beyond the completed client-state/spec correction, or if completing GREEN requires another HTTP behavior, production adapter registration, an external/production database, professional semantics, a real-user path, or changing existing identity/route/readiness/non-enumeration rules; or if the shared worktree changes make authorized scope ambiguous. `readyForRealUsers` remains false, G2 is not reached, and G3 remains prohibited regardless of any focused GREEN or review outcome.
