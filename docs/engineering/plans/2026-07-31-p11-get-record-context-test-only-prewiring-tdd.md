# P11 Test-Only GET_RECORD_CONTEXT Pre-Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This shared dirty worktree has one authorized writer; do not use subagents, stage, commit, push, deploy, reset, checkout, or revert.

**Goal:** Establish one test-only `GET /api/v1/record-tasks/:taskId/context` success mapping from an independent context-read fake to the frozen `RECORD_CONTEXT_AVAILABLE` response.

**Architecture:** Add a pure TypeScript context-read port and token that are separate from `P11RecordRepositoryPort`. Thread the fake through the existing application/AppModule `nodeEnv === 'test'` double gate, then have the existing controller map exactly one successful fake result plus the pinned test-only schema to the frozen seven-key public envelope. Keep all existing session, role, route/readiness, and non-enumerating rejection behavior unchanged and covered only by regression tests.

**Tech Stack:** TypeScript, NestJS, Zod, Swagger/OpenAPI, Supertest, Vitest, local test-only PGlite identity fixture.

---

## Frozen Scope And Evidence Boundary

- The only new HTTP business behavior is valid `USER` + global `ALLOW` + non-empty `x-request-id` + explicit test-only context fake returning HTTP `200 RECORD_CONTEXT_AVAILABLE`.
- The initial success fixture uses opaque values, `accessMode: 'EDITABLE'`, one schema kind with `allowedActions: ['UPSERT_RECORD']`, empty `fields`, and `records: []`. Do not introduce professional content, record entries, units, thresholds, dates with real semantics, risk rules, or UI behavior.
- The fake proves controller input mapping, public-envelope mapping, one call, nonleakage, and test-only gating only. It does not prove PostgreSQL queries, task ownership, anti-enumeration, ACTIVE plan selection, server-derived date, access mode, record projection, locks, concurrency, idempotency, audit atomicity, production behavior, or real-user behavior.
- Do not modify `packages/database/**`, migrations, `docs/product/**`, `apps/web/**`, production repository registration, or `P11RecordRepositoryPort` / `P11_RECORD_REPOSITORY`.
- Do not add another context HTTP scenario. Missing/blank headers, fake failures, `READ_ONLY`, non-empty records, task ownership, route priority, and error mappings are outside this authorization. Existing GET rejection tests are regression evidence only.

## File Responsibility Map

| File | Change | Responsibility |
| --- | --- | --- |
| `apps/api/src/records/p11-record-context.port.ts` | Create | Independent pure read input/result/interface; no NestJS, database, token, or professional fields. |
| `apps/api/src/records/p11-record-context.token.ts` | Create | Nest injection token for the independent context port. |
| `apps/api/src/records/record-safe-structure.controller.ts` | Modify | Inject the context reader, map exactly one test-only successful result, and make the GET OpenAPI success schema strict. |
| `apps/api/src/application.ts` | Modify | Accept and forward a context reader only in `nodeEnv === 'test'`. |
| `apps/api/src/app.module.ts` | Modify | Null the context reader outside test and register its token separately from the write repository token. |
| `apps/api/test/build-test-application.ts` | Modify | Expose the test-only context-reader option used by the new focused spec. |
| `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts` | Create | The one authoritative RED/GREEN success scenario, fake-call/input/nonleak checks, and non-test injection structural gate. |
| `apps/api/test/openapi.spec.ts` | Modify | Tighten the existing GET 200 OpenAPI assertions to reject undeclared object properties and open array elements. |
| `docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md` | Modify during execution | Mark only completed implementation steps and record the observed RED/GREEN and review stop. Do not update product documentation. |

## Task 1: Write and Observe the Single Context-Success RED Before Production Plumbing

**Files:**
- Create: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`
- Modify: `docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md`
- Test: `apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts`

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

Do not add a second `it` for a fake failure, a missing header, an unknown task, a closed task, `READ_ONLY`, or non-empty records.

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
npx vitest run apps/api/test/p11-record-context.pre-wiring.e2e.spec.ts apps/api/test/p11-record-persistence.pre-wiring.e2e.spec.ts apps/api/test/p11-record-safe-structure.e2e.spec.ts apps/api/test/p11-record-schema-provider.spec.ts apps/api/test/openapi.spec.ts
```

Expected: all five specified files pass with `53 passed / 0 skipped`. The existing session/role/global-route/non-enumeration tests must remain green without adding new variants. Record the exact test count, duration, and zero-failure result in this plan's execution notes.

- [x] **Step 2: Run API typecheck and build**

Run:

```powershell
npm run typecheck --workspace @lianban/api
npm run build --workspace @lianban/api
```

Expected: both commands exit `0`; no package installation, lockfile change, database migration, external database access, or deployment action occurs.

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
- **Verification:** Context test `1 passed`; OpenAPI test `4 passed`; final five-file P11 command `53 passed / 0 skipped` in 19.48 s. `npm run typecheck --workspace @lianban/api` and `npm run build --workspace @lianban/api` both exited `0`.
- **Evidence boundary:** The controller fake proves only controller input/output mapping, call count, nonleakage, strict OpenAPI structure, and test-only injection. It does not prove PostgreSQL queries, task ownership or anti-enumeration queries, ACTIVE plan selection, dates, access mode, record projection, locking, concurrency, idempotency, audit atomicity, production behavior, or real-user behavior. No external/PostgreSQL database, production adapter/registration, product/UI file, real-user path, G2, or G3 work was performed.
- **Stop:** R&D self-check is complete. Stop for QA read-only evidence/range checking, then the single specified Sol Critical formal read-only review, then the product stop. There is no automatic next scene or next phase authorization; `readyForRealUsers=false`, G2 is not reached, and G3 remains prohibited.

## Plan Self-Review Checklist

- [x] **Spec coverage:** Verified the plan covers the approved design's independent context port/token, test-only double gate, one 404-to-200 success TDD path, strict OpenAPI, fake/nonleak evidence, non-test no-success gate, existing rejection regressions, evidence separation, and post-GREEN review order.
- [x] **Placeholder scan:** Verified there are no implementation placeholders; the literal `TODO` and `TBD` words appear only in this completed scan criterion.
- [x] **Type consistency:** Verified `P11RecordContextPort.getContext`, `P11RecordContextInput`, `P11RecordContextResult`, `P11_RECORD_CONTEXT`, `recordContext`, and `contextResponse` use the same spellings and fields in every task.
- [x] **Scope check:** Verified the only new context HTTP business result is the valid test-only 200 success; all other behavior remains existing regression or structural test-only gate evidence.

## Execution Stop Conditions

Stop and report immediately if the observed RED is not the controller's current `404 RECORD_TASK_NOT_FOUND`; if completing GREEN requires a second HTTP behavior, production registration, a database adapter/query, professional semantics, UI work, a real-user path, or changing existing identity/route/readiness/non-enumeration rules; or if the shared worktree changes make authorized scope ambiguous. `readyForRealUsers` remains false, G2 is not reached, and G3 remains prohibited regardless of any focused GREEN or review outcome.
