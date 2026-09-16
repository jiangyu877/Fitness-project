# P11 Dual Fixture Runtime Bridge

## Scope And Ownership

- Test-only shared fixture context/identity bridge for `persona_fat_loss` and `persona_muscle_gain`.
- The bridge maps explicit user, session, goal, plan, plan version, task, request, idempotency, and entry facts into the existing record command route and isolated PostgreSQL 18 adapter.
- API PGlite and PG18 use explicit test-only identity mapping; they are separate stores and do not represent one shared database transaction.
- No message or data-rights runtime, UI/page/browser behavior, production endpoint, repository/database package, migration, worker/scheduler, professional rule, or real-user data is in scope.

## TDD Execution Record

- **RED:** The named bridge test first reached PG18 fixture seeding and failed on `ck_plan_version_confirmation_deadline_cst`. The fixture used `2025-12-31T20:00:00Z`, which was not 20:00 CST. This was corrected to `2025-12-31T12:00:00Z` (20:00 CST), before route assertions.
- **GREEN:** The shared test-only bridge seeds both persona mappings, routes both writes through the existing API controller and PG18 adapter, awaits the callback before pool cleanup, and verifies complete record, idempotency, and success-audit bindings.
- **Fresh named test:** `1 passed` for `p11-dual-fixture-runtime-bridge.postgres.e2e.spec.ts`.

## Assertion Contract

- Record rows assert subject/user, task, business date, `record_kind_id`, schema version, record version, and exact entry `fieldId/valueType/value`.
- Idempotency rows assert `key_id`, key and intent digests, principal/session/task, business date, record kind/schema, operation/status, record ID, and exact replay result.
- Success audit rows assert actor, `P11_RECORD` subject, task, request ID, record ID, record version, and schema; the audit record ID must equal the idempotency and persisted record IDs.
- Public responses assert the strict success envelope and absence of session token, raw idempotency key, and entry value.

## Verification And Evidence

- API typecheck passed: `npm run typecheck --workspace apps/api`.
- API build passed: `npm run build --workspace apps/api`.
- `git diff --check` passed for the bridge helper/spec.
- Isolated PG18 admin/temporary database lifecycle completed through target close, backend termination, database drop, and maintenance close; temporary database count was `0` after the fresh run.
- Evidence layers are `CROSS_LAYER_E2E` and `PG18_REPOSITORY`. No `API_FAKE` evidence was added by this slice.

## Review And Stop

- Sol result: `GREEN / ALLOW — P11_DUAL_FIXTURE_RUNTIME_BRIDGE_REVIEW_COMPLETE`, limited to this test-only bridge and its named scenario.
- QA, Security, Professional, UI, and Operations results are limited to the represented test-only evidence; they do not establish production readiness.
- This record does not authorize message/data-rights runtime, UI/browser, production, 真人, G2, G3, release, or `readyForRealUsers=true`.
- Preserve the shared dirty worktree. Do not stage, commit, push, reset, checkout, or revert.
