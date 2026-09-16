# P11 Dual Fixture Local Operable Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a local test-only browser path where each fictional P11 fixture performs a schema-driven record write and authoritative reread through the existing API-to-isolated-PG18 boundary.

**Architecture:** A test-only launcher creates one isolated PostgreSQL 18 database plus a PGlite-backed Nest application, seeds two fixed fictional sessions and tasks, and publishes only a local fixture manifest. A Vite-gated selector establishes one fixture session at a time. The existing record client and page gain a strict generic command flow, with no diet or training semantics.

**Tech Stack:** TypeScript, NestJS, PGlite, `pg`, PostgreSQL 18, React, Vite, Vitest, Testing Library, and the existing P11 parser/state contracts.

---

## File Structure

- `apps/api/test/support/p11-local-operable-runtime.ts`: creates and destroys the loopback-only test runtime, isolated PG18 database, PGlite API application, fixture manifest, and matching identity/session/task rows.
- `apps/api/test/p11-local-operable-runtime-server.ts`: starts the runtime and handles process shutdown.
- `apps/api/test/p11-local-operable-runtime.spec.ts`: verifies both fixtures have independent context/write/reread paths against the temporary runtime.
- `scripts/p11-local-operable-runtime.ts`: starts the API runtime and Vite with explicit test-only environment flags and cleans up child processes.
- `apps/web/src/features/p11-local/p11-local-runtime-page.tsx`: renders the test-only fixture picker, stores the selected fixture's local session, and opens its opaque task route.
- `apps/web/src/features/p11-local/p11-local-runtime-page.spec.tsx`: verifies manifest validation, selection, session replacement, and no fallback path.
- `apps/web/src/features/p11-real/p11-client.ts`: adds the strict `upsertRecord` transport method.
- `apps/web/src/features/p11-real/p11-client.spec.ts`: covers valid command headers and malformed/error response rejection.
- `apps/web/src/features/p11-real/p11-record-page.tsx`: adds the generic primitive editor and authoritative reread behavior.
- `apps/web/src/features/p11-real/p11-record-page.spec.tsx`: covers generic render, submit, reread, and fail-closed outcomes.
- `apps/web/src/app/app.tsx` and `apps/web/src/main.tsx`: register the local selector and enable it only with the explicit Vite test-only flag.
- `package.json`: exposes `dev:p11-local` without changing normal development or production commands.

### Task 1: Define Test-Only Runtime Fixtures

**Files:**

- Create: `apps/api/test/support/p11-local-operable-runtime.ts`
- Test: `apps/api/test/p11-local-operable-runtime.spec.ts`

- [x] **Step 1: Write a failing runtime test for two fixture manifests and isolated record contexts.**

```ts
const runtime = await startP11LocalOperableRuntime({ adminUrl, port: 0 });
const fixtures = await runtime.fixtureManifest();
expect(fixtures.map((fixture) => fixture.fixtureId)).toEqual([
  'persona_fat_loss', 'persona_muscle_gain',
]);
```

- [x] **Step 2: Run the focused test and verify the missing runtime helper is the failure.**

Run: `npx --no-install vitest run apps/api/test/p11-local-operable-runtime.spec.ts --maxWorkers=1 --minWorkers=1`

- [x] **Step 3: Implement the isolated runtime helper.**

```ts
export type P11LocalFixture = Readonly<{
  fixtureId: 'persona_fat_loss' | 'persona_muscle_gain';
  goalType: 'FAT_LOSS' | 'MUSCLE_GAIN';
  taskId: string;
  sessionToken: string;
  expiresAt: string;
}>;

export async function startP11LocalOperableRuntime(options: {
  adminUrl: string;
  port: number;
}): Promise<{ baseUrl: string; close(): Promise<void> }> {
  // Create a loopback-only test application and matching temporary PG18 store.
}
```

The helper validates a loopback PostgreSQL admin URL, injects both
`recordRepositoryPool` and `recordContextPool`, and drops its database during
`close()`.

- [x] **Step 4: Rerun the focused runtime test.**

Expected: both fixtures have separate task/session/subject mappings and empty
initial record contexts.

### Task 2: Prove Runtime Write Isolation

**Files:**

- Modify: `apps/api/test/p11-local-operable-runtime.spec.ts`
- Modify: `apps/api/test/support/p11-local-operable-runtime.ts`

- [x] **Step 1: Add a failing test that writes once per fixture and rereads context.**

```ts
await write(runtime, fatLoss, 'fat-loss-opaque-entry');
await write(runtime, muscleGain, 'muscle-gain-opaque-entry');
expect((await read(runtime, fatLoss)).records).toHaveLength(1);
expect((await read(runtime, muscleGain)).records).toHaveLength(1);
expect(JSON.stringify(await read(runtime, fatLoss))).not.toContain('muscle-gain-opaque-entry');
```

- [x] **Step 2: Run the focused test and confirm the missing test-only bridge is the failure.**

Run: `npx --no-install vitest run apps/api/test/p11-local-operable-runtime.spec.ts -t "writes independently" --maxWorkers=1 --minWorkers=1`

- [x] **Step 3: Add only test-only manifest and adapter wiring.**

The fixture-manifest route is registered directly on the test app's loopback
adapter. It must never be added to `apps/api/src` or a production module.

- [x] **Step 4: Rerun the runtime test.**

Expected: each fixture gets `200 RECORD_WRITE_ACCEPTED`, then an authoritative
context with only its own record, and temporary database cleanup completes.

### Task 3: Add the Strict Browser Client Command

**Files:**

- Modify: `apps/web/src/features/p11-real/p11-client.ts`
- Modify: `apps/web/src/features/p11-real/p11-client.spec.ts`
- Reuse: `apps/web/src/features/p11-real/p11-parser.ts`

- [x] **Step 1: Add a failing client test for a valid command request.**

```ts
await client.upsertRecord(session, 'task-opaque', {
  operation: 'UPSERT_RECORD', recordKindId: 'kind-1', schemaVersion: 'schema-v1',
  expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'opaque' }],
});
expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/commands'), expect.objectContaining({
  method: 'POST', headers: expect.any(Headers),
}));
```

- [x] **Step 2: Run the focused client test and verify `upsertRecord` is absent.**

Run: `npx --no-install vitest run apps/web/src/features/p11-real/p11-client.spec.ts --maxWorkers=1 --minWorkers=1`

- [x] **Step 3: Implement a strict command method.**

```ts
async upsertRecord(session: P11Session, taskId: string, command: RecordCommand) {
  const correlationId = requestId();
  const idempotency = idempotencyKey();
  const response = await fetcher(`/api/v1/record-tasks/${encodeURIComponent(taskId)}/commands`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`, 'x-request-id': correlationId,
      'idempotency-key': idempotency },
    body: JSON.stringify(command),
  });
  // Accept only the existing strict command-success or error parsers.
}
```

- [x] **Step 4: Add malformed success/error and transport-failure tests, then rerun the file.**

Expected: every malformed or transport outcome fails closed without exposing a
raw token or idempotency key.

### Task 4: Build the Schema-Driven Record Editor

**Files:**

- Modify: `apps/web/src/features/p11-real/p11-record-page.tsx`
- Modify: `apps/web/src/features/p11-real/p11-record-page.spec.tsx`
- Reuse: `apps/web/src/features/p11-real/p11-client-state.ts`

- [x] **Step 1: Add a failing page test for an editable one-field schema.**

```tsx
render(<P11RecordPage taskId="task-opaque" session={session} client={client} />);
fireEvent.change(await screen.findByLabelText('field-1'), { target: { value: 'opaque' } });
fireEvent.click(screen.getByRole('button', { name: '提交测试记录' }));
await waitFor(() => expect(upsertRecord).toHaveBeenCalled());
```

- [x] **Step 2: Run the focused page test and verify no editor is rendered.**

Run: `npx --no-install vitest run apps/web/src/features/p11-real/p11-record-page.spec.tsx --maxWorkers=1 --minWorkers=1`

- [x] **Step 3: Render only generic primitive controls and do an authoritative reread.**

```tsx
const recordKind = context.schema.recordKinds.find((kind) =>
  kind.allowedActions.includes('UPSERT_RECORD'));
// Render STRING, NUMBER, and BOOLEAN inputs from field.id and valueType.
// After RECORD_WRITE_ACCEPTED, call getContext(session, taskId) before success UI.
```

The editor appears only for `EDITABLE` test-only contexts and must derive the
expected version only from the authoritative record of the selected kind.

- [x] **Step 4: Test read-only, write error, malformed reread, and session change.**

Expected: the editor disables while pending and applies the existing reducer
disposition on each failed path.

### Task 5: Add the Local Fixture Selector and Explicit Runtime Gate

**Files:**

- Create: `apps/web/src/features/p11-local/p11-local-runtime-page.tsx`
- Create: `apps/web/src/features/p11-local/p11-local-runtime-page.spec.tsx`
- Modify: `apps/web/src/app/app.tsx`
- Modify: `apps/web/src/main.tsx`

- [x] **Step 1: Write a failing selector test for a strict two-fixture manifest.**

```tsx
render(<P11LocalRuntimePage fetcher={fetcher} onOpen={onOpen} />);
fireEvent.click(await screen.findByRole('button', { name: '打开减脂测试路径' }));
expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
  fixtureId: 'persona_fat_loss', taskId: expect.any(String),
}));
```

- [x] **Step 2: Run the selector test and verify the component is absent.**

Run: `npx --no-install vitest run apps/web/src/features/p11-local/p11-local-runtime-page.spec.tsx --maxWorkers=1 --minWorkers=1`

- [x] **Step 3: Implement strict manifest parsing, session replacement, and route handoff.**

```ts
sessionStorage.setItem('lianban.user-session', JSON.stringify({
  token: fixture.sessionToken, expiresAt: fixture.expiresAt,
}));
navigate(`/h5/records?taskId=${encodeURIComponent(fixture.taskId)}`);
```

Reject extra fields, unknown fixture/goal pairings, blank token/task IDs,
duplicates, and non-test manifests. The page displays the prototype disclaimer.

- [x] **Step 4: Register `/h5/p11-local` before generic route fallback and enable it only when `VITE_P11_LOCAL_RUNTIME=true`.**

- [x] **Step 5: Rerun selector and existing P11 page tests.**

Expected: selection replaces the prior local session, opens only the chosen
task, and normal development retains its blocked P11 route.

### Task 6: Add the Local Launcher and Production Exclusion Check

**Files:**

- Create: `apps/api/test/p11-local-operable-runtime-server.ts`
- Create: `scripts/p11-local-operable-runtime.ts`
- Modify: `package.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/scripts/verify-production-bundle.mjs`

- [x] **Step 1: Write a bounded configuration test for absent PostgreSQL admin URL.**

```ts
expect(() => requireLocalAdminUrl(undefined)).toThrow('P11_LOCAL_POSTGRES_ADMIN_URL_REQUIRED');
```

- [x] **Step 2: Implement a loopback-only launcher.**

```ts
const api = spawn(process.execPath, [tsxCli, 'apps/api/test/p11-local-operable-runtime-server.ts'], {
  env: { ...process.env, P11_LOCAL_API_PORT: '3100' },
});
const web = spawn(process.execPath, [viteCli, '--config', 'vite.config.ts', '--port', '5175'], {
  cwd: webDirectory,
  env: { ...process.env, VITE_P11_LOCAL_RUNTIME: 'true', P11_LOCAL_API_PORT: '3100' },
});
```

The launcher refuses missing/non-loopback database URLs, forwards shutdown
signals, and waits for API cleanup. Normal `npm run dev` remains unchanged.

- [x] **Step 3: Extend production-bundle verification to reject local runtime identifiers.**

- [x] **Step 4: Run focused tests, API/Web typechecks/builds, production bundle verification, and `git diff --check`.**

### Task 7: Run Browser Acceptance and Record Evidence

**Files:**

- Modify: `docs/engineering/plans/2026-09-05-p11-dual-fixture-local-operable-structure.md`
- Modify: `docs/product/lianban-v1.0-acceptance-ledger.md`
- Modify: `docs/product/lianban-v1.0-work-log.md`

- [x] **Step 1: Start `npm run dev:p11-local` and wait for both loopback URLs.**
- [x] **Step 2: In the local browser, select fat-loss, submit one opaque record, and verify the authoritative reread.**
- [x] **Step 3: Select muscle-gain, submit a distinct opaque record, return to fat-loss, and verify no muscle-gain record appears.**
- [x] **Step 4: Capture screenshots and document actual viewport, interaction, and evidence layer.**
- [x] **Step 5: Update product documents only with fresh observed counts and limitations.**

Do not report local browser success as production, semantic diet/training,
staging, G2, G3, release, or real-user evidence.

## Execution Record - 2026-09-05

Tasks 1-7 were executed for the named test-only scene. Fresh evidence is
recorded in
`docs/engineering/plans/2026-09-05-p11-dual-fixture-local-operable-structure.md`.

- API runtime focused: `1 file / 5 tests passed`.
- Web P11 client/state/page/selector focused: `4 files / 43 tests passed`.
- Launcher lifecycle focused: `1 file / 7 tests passed`.
- API/Web typecheck and build: passed.
- Production bundle exclusion and `git diff --check`: passed.
- Browser: both fictional fixtures wrote and reread one isolated record;
  returning to fat-loss did not expose the muscle-gain value.
- Cleanup: local runtime ports stopped; generated P11 local/test database count
  returned to zero after cleanup.
- Default parallel `npm test` stopped on a Node/Vitest worker OOM. The final
  single-worker rerun passed `65/66` files and `797/806` tests. All nine
  failures remain in the out-of-scope fixed-date plan lifecycle suite.

Final independent Sol Critical review found no Critical, Important, or Minor
issues and concluded `GREEN / ALLOW —
P11_DUAL_FIXTURE_LOCAL_OPERABLE_STRUCTURE_REVIEW_COMPLETE`. This closes only
the named test-only scene. None of this evidence changes G2/G3, production,
real-user, release, or `readyForRealUsers` status.
