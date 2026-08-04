# P11 Record Persistence TDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` task-by-task. The main thread is the only writer. Do not stage or commit this shared worktree.

**Goal:** Add the append-only `011` persistence schema and the smallest PostgreSQL-backed P11 record repository that proves the approved test-only write structure without API runtime wiring or professional semantics.

**Architecture:** A dedicated `recording` schema owns P11 gate, task, record, idempotency, and audit rows. Every write transaction locks the existing IAM and planning authorities in the frozen order, revalidates all facts, validates a generic test-only schema, and only then claims the independent P11 idempotency row, mutates one record, stores a replay result, and appends one success audit. The repository accepts a credential-derived session token hash and a versioned test-only schema snapshot; it does not accept a user ID, business date, clock, plan state, ownership, risk, closure, or gate assertion from the caller.

**Tech Stack:** TypeScript 5.9, Node.js 24 `node:crypto`, `pg` 8.22, PostgreSQL 18, PGlite compatibility migrations, Vitest 3.2.

**Authorization Boundary:** Allowed files are `packages/database/migrations/011_p11_record_persistence.sql`, `packages/database/src/record-repository.ts`, `packages/database/src/migrate.ts`, `packages/database/src/index.ts`, `packages/database/test/migration.spec.ts`, `packages/database/test/postgres-test-harness.spec.ts`, `packages/database/test/record-repository.spec.ts`, and this plan. No AppModule, controller, application, route middleware, P07, UI, product document, staging, commit, push, deployment, real-user schema, or real business database change is permitted.

---

## Frozen Decisions

### Lock order

Every repository write uses one PostgreSQL transaction and this exact order:

1. Preflight lookup of the session by token hash without treating it as authorization.
2. `iam.account FOR UPDATE` for the preflight account ID.
3. `iam.session FOR UPDATE`, followed by complete USER session revalidation.
4. `recording.p11_write_gate FOR UPDATE`, followed by gate revision and HMAC key revalidation.
5. `recording.record_task FOR UPDATE`; this row serializes creation when no record exists.
6. `planning.plan FOR UPDATE`.
7. The task-bound `planning.plan_version FOR UPDATE`, followed by a count of currently effective ACTIVE versions.
8. Existing `recording.record FOR UPDATE`, when present.
9. Existing or newly claimed `recording.record_idempotency` row.
10. Insert `recording.record_success_audit` last.

The preflight session read is locator-only. No success, replay, target disclosure, schema decision, or state authorization can derive from it. Every authoritative fact is re-read after its governing row is locked.

### Test-only gate and closure policy

`recording.p11_write_gate` is a singleton versioned row identified by `P11_RECORD_WRITE`. A successful write requires all of the following values in the locked row:

```text
node_env = TEST
test_only = true
approved_for_real_users = false
route_access_approved = true
write_enabled = true
hmac_key_id = the active repository key ID
```

`recording.record_task` stores independent `task_state`, `date_state`, and `risk_state`. The only writable combination is `OPEN`, `OPEN`, and `CLEAR`, with `close_policy = TEST_ONLY_EXPLICIT`. This policy is a test fixture fact, not a clock-based backfill rule. The repository never infers today, a natural day, an hour limit, or an allowed backfill window.

### Idempotency and key lifecycle

P11 uses `recording.record_idempotency`, never `audit.idempotency_key`. Both the idempotency key locator and the full request intent are HMAC-SHA-256 digests with explicit domains and a persisted key ID. No raw idempotency key, canonical intent, entry value, bearer token, session token hash, credential, or request ID is stored in the idempotency projection.

The canonical intent has fixed keys and contains:

```ts
type CanonicalIntent = {
  domain: 'lianban:p11:record-intent:v1';
  operation: 'UPSERT_RECORD';
  recordKindId: string;
  schemaVersion: string;
  expectedRecordVersion: number | null;
  entries: Array<{
    fieldId: string;
    valueType: 'STRING' | 'NUMBER' | 'BOOLEAN';
    value: string | number | boolean;
  }>;
};
```

Entries are sorted by `fieldId`; duplicate IDs reject before hashing. JSON object keys use a fixed deterministic order, strings use their submitted scalar value, numbers must be finite and normalize `-0` to `0`, and types are included so values of different JSON scalar types cannot collide semantically.

The locked gate pins the active key ID. Missing active material fails closed. Replay lookup computes the idempotency-key locator under every available key, then verifies the stored request digest with the row's persisted key ID. A historical key referenced by a replay row must remain available for verification; missing historical material fails closed. This plan defines no time-based key retention or deletion.

### Error surface

The repository throws stable errors with a `code` property. This layer implements only:

```ts
type P11RecordRepositoryErrorCode =
  | 'SESSION_INVALID'
  | 'RECORD_TASK_NOT_FOUND'
  | 'RECORD_PLAN_NOT_ACTIVE'
  | 'RECORD_STATE_BLOCKED'
  | 'RECORD_SCHEMA_UNAVAILABLE'
  | 'RECORD_SCHEMA_INVALID'
  | 'RECORD_SCHEMA_VERSION_CONFLICT'
  | 'RECORD_VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ROUTE_ACCESS_NOT_APPROVED'
  | 'RECORD_REQUEST_INVALID'
  | 'HMAC_KEY_UNAVAILABLE';
```

Absent and cross-user tasks both produce `RECORD_TASK_NOT_FOUND`; no row or result belonging to another principal is returned. The API mapping is explicitly outside this round.

---

## Task 1: Append-Only 011 Migration

**Files:**
- Create: `packages/database/migrations/011_p11_record_persistence.sql`
- Modify: `packages/database/src/migrate.ts`
- Modify: `packages/database/test/migration.spec.ts`
- Modify: `packages/database/test/postgres-test-harness.spec.ts`

- [ ] Add a compatibility migration test that calls `applyMigrationsThrough(database, '011_p11_record_persistence')` and asserts the five `recording` tables, foreign keys, unique record scope, positive record version, gate checks, test-only closure policy checks, and idempotency/audit digest-only columns.
- [ ] Run `npx --no-install vitest run packages/database/test/migration.spec.ts` and observe a target RED because migration version `011_p11_record_persistence` is unknown.
- [ ] Register only `011_p11_record_persistence.sql` in the append-only migration list.
- [ ] Add the minimal DDL for:

```text
recording.p11_write_gate
recording.record_task
recording.record
recording.record_idempotency
recording.record_success_audit
```

- [ ] Keep all IDs opaque `text`; use foreign keys to `iam.account`, `iam.session`, `planning.plan`, `planning.plan_version`, `recording.record_task`, and `recording.record` where applicable. Use `bytea` for HMAC digests and `jsonb` only for the record entries and non-sensitive replay result.
- [ ] Run the focused migration test to GREEN.
- [ ] With `LIANBAN_TEST_POSTGRES_ADMIN_URL` present only in the invoking PowerShell process, run `npx --no-install vitest run packages/database/test/postgres-test-harness.spec.ts` and prove `001` through `011` apply in a random disposable PostgreSQL 18 database.
- [ ] Add direct PostgreSQL assertions that a legacy `010` database upgrades to `011`, valid rows insert, and invalid gate flags, invalid closure policy, duplicate record scope, non-positive versions, bad references, raw-canonical columns, and released-migration mutation are rejected or absent.

## Task 2: Repository Types, Validation, and Fingerprints

**Files:**
- Create: `packages/database/src/record-repository.ts`
- Modify: `packages/database/src/index.ts`
- Replace: `packages/database/test/record-repository.spec.ts`

The public constructor and command boundary are:

```ts
new P11RecordRepository(pool, {
  activeKeyId: 'test-key-v1',
  keys: new Map([['test-key-v1', Buffer.from('test-only-secret')]]),
});

repository.upsert({
  sessionTokenHash,
  taskId,
  idempotencyKey,
  requestId,
  nodeEnv: 'test',
  schema: {
    version,
    testOnly: true,
    approvedForRealUsers: false,
    recordKinds: [{ id, fields, allowedActions: ['UPSERT_RECORD'] }],
  },
  command: {
    operation: 'UPSERT_RECORD',
    recordKindId,
    schemaVersion,
    expectedRecordVersion,
    entries,
  },
});
```

- [ ] First write a pure fingerprint RED proving property order and entry order normalize to one digest, while changed operation, kind, schema, expected version, field ID, scalar type, or scalar value changes the digest.
- [ ] Implement strict schema/command validation and domain-separated canonical HMAC without persistence.
- [ ] Prove duplicate/unknown/missing/extra/wrong-type entries reject, missing active key rejects, raw intent is not returned by the digest helper, and historical verification uses only the referenced key ID.
- [ ] Export the repository and its types from `packages/database/src/index.ts` only. Do not add an API port unless compilation later proves it necessary.

## Task 3: Allowed Create and Exact Replay

**Files:**
- Modify: `packages/database/test/record-repository.spec.ts`
- Modify: `packages/database/src/record-repository.ts`

- [ ] Seed only fictional TEST rows: one ACTIVE USER account, one FULL USER session, one enabled P11 gate, one plan, one currently effective ACTIVE plan version, and one owned OPEN/CLEAR record task bound to the test schema.
- [ ] Write a real PostgreSQL RED expecting the first `UPSERT_RECORD` with `expectedRecordVersion=null` to return version `1`, one record, one completed idempotency row, and one success audit.
- [ ] Run only that test and observe its target assertion fail before implementing the transaction.
- [ ] Implement the frozen lock sequence, complete fact revalidation, record insert, replay result update, and success audit in one transaction.
- [ ] Write and run exact replay RED, then return the stored result without a second record mutation or audit only after revalidating every authoritative fact.
- [ ] Query PostgreSQL after both requests and assert exactly one record at version `1`, one completed idempotency row, and one success audit.

## Task 4: Scope, Intent, and Non-Enumeration Rejections

**Files:**
- Modify: `packages/database/test/record-repository.spec.ts`
- Modify: `packages/database/src/record-repository.ts`

- [ ] Add one target RED at a time for missing task, another user's task, same key with changed principal, task, business date, kind, schema, operation, expected version, or any typed entry.
- [ ] Implement stable `RECORD_TASK_NOT_FOUND` and `IDEMPOTENCY_KEY_REUSED` handling without returning existing scope or replay data.
- [ ] After every rejection assert record rows, completed idempotency rows, success audits, task state, and plan state are unchanged.
- [ ] Assert persisted idempotency and audit columns contain no raw idempotency key, request canonical JSON, session token hash, entry field value, bearer credential, or request ID outside the audit correlation column.

## Task 5: Optimistic Concurrency and Ordering

**Files:**
- Modify: `packages/database/test/record-repository.spec.ts`
- Modify: `packages/database/src/record-repository.ts`

- [ ] RED then GREEN: two concurrent absent-record requests with different keys serialize on `record_task`; exactly one creates version `1`, the other receives `RECORD_VERSION_CONFLICT`.
- [ ] RED then GREEN: two concurrent updates from version `1` serialize on the existing record; exactly one returns version `2`, the other receives `RECORD_VERSION_CONFLICT`.
- [ ] RED then GREEN: a later request with a new key and stale version cannot overwrite version `2`.
- [ ] Assert final entries are one winner's complete value set and that only successful advances have idempotency results and success audits.

## Task 6: Transaction-Time Authority Races

**Files:**
- Modify: `packages/database/test/record-repository.spec.ts`
- Modify: `packages/database/src/record-repository.ts`

Use two real PostgreSQL clients and deterministic advisory test barriers that pause the repository after a named lock boundary without adding test-only production methods. Each case changes authority in a competing committed transaction, releases the blocked request, and asserts the winner of the frozen lock order determines the result.

- [ ] Session revoked or subject changed before its lock wins: `SESSION_INVALID`.
- [ ] Gate revision disabled, key ID changed, or route approval withdrawn before its lock wins: `ROUTE_ACCESS_NOT_APPROVED` or `HMAC_KEY_UNAVAILABLE`.
- [ ] Task closed, date closed, or risk blocked before the task lock wins: `RECORD_STATE_BLOCKED`.
- [ ] Task owner or bound plan/schema changed before the task lock wins: non-enumerating task rejection or `RECORD_SCHEMA_VERSION_CONFLICT`.
- [ ] ACTIVE plan superseded/expired, plan gap introduced, or ambiguity forced by dropping only the test database defense index: `RECORD_PLAN_NOT_ACTIVE`.
- [ ] Replay every race using an existing exact idempotency row and prove revalidation still rejects without exposing the old result.
- [ ] After every rejection assert zero new record versions, completed idempotency results, or success audits.

## Task 7: Atomic Rollback

**Files:**
- Modify: `packages/database/test/record-repository.spec.ts`
- Modify: `packages/database/src/record-repository.ts`

- [ ] RED then GREEN: force a success-audit constraint failure after record mutation and idempotency claim; assert all three changes roll back.
- [ ] RED then GREEN: force replay-result persistence failure and assert neither record nor audit commits.
- [ ] Restore valid fixture constraints within the disposable database and prove the next valid request succeeds once.
- [ ] Do not add production fault-injection switches; use transaction-local test data or database constraints to induce failure.

## Task 8: Key Rotation and Real-User Isolation

**Files:**
- Modify: `packages/database/test/record-repository.spec.ts`
- Modify: `packages/database/src/record-repository.ts`

- [ ] RED then GREEN: exact replay created under `test-key-v1` remains verifiable after `test-key-v2` becomes active while v1 remains in the verification map.
- [ ] RED then GREEN: missing referenced v1 fails closed and does not create a second row.
- [ ] RED then GREEN: non-test `nodeEnv`, `testOnly=false`, `approvedForRealUsers=true`, startup-only approval, missing/unknown gate revision, or schema/gate key mismatch always rejects with zero success side effects.
- [ ] Assert the repository never accepts or produces `readyForRealUsers=true` and never contains professional record-kind or field constants.

## Task 9: Full Verification and Review Stop

**Files:**
- Verify only the authorized file list above.

- [ ] Run `npx --no-install vitest run packages/database/test/migration.spec.ts`.
- [ ] Run `npx --no-install vitest run packages/database/test/postgres-test-harness.spec.ts` with the private local PostgreSQL admin URL set only for that process.
- [ ] Run `npx --no-install vitest run packages/database/test/record-repository.spec.ts` with the same isolated-database guard.
- [ ] Run `npm run typecheck --workspace @lianban/database` and `npm run build --workspace @lianban/database`.
- [ ] Run `git diff --check`, inspect `git status --short`, and verify no changed file is outside the authorized scope due to this round.
- [ ] Search the migration, repository, and tests for `consumer_analysis`, `consumer_spend`, staging/production URLs, professional fields, raw secrets, P07 imports, API runtime imports, and `readyForRealUsers=true`.
- [ ] Stop before any API wiring and submit the 011 DDL plus full real PostgreSQL evidence for a new Sol Critical read-only review.

## Self-Review Result

- Product scope: all required migration, lock, replay, changed-intent, concurrency, ordering, race, rollback, zero-side-effect, and test-only isolation scenarios have explicit tasks.
- Forbidden scope: no controller, AppModule, P07, UI, product, real-user, external database, commit, push, or deployment step exists.
- Placeholder scan: no implementation placeholder is used; all boundaries, table responsibilities, API inputs, lock order, and commands are explicit.
- Type consistency: `expectedRecordVersion` is consistently `number | null`; only `UPSERT_RECORD` is accepted; record versions start at `1`; schema flags remain `testOnly=true` and `approvedForRealUsers=false`.
