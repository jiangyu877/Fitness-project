# Persistent Plan Lifecycle HTTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the authenticated plan lifecycle HTTP API to PGlite/Postgres persistence while preserving PL01-PL15 state, authorization, time, idempotency, concurrency, audit, and fail-closed guarantees.

**Architecture:** `PlanLifecycleService` remains the application/domain boundary and delegates storage to `PGlitePlanRepository`, injected from the existing `DatabaseService`. Repository write methods claim the scoped idempotency key, mutate the plan row with optimistic version checks, and append exactly one structured audit event in one database transaction; read methods hydrate immutable domain snapshots without transitions. Existing route-access and identity session authorization remain ahead of business execution.

**Tech Stack:** NestJS 11, TypeScript 5.9, PGlite/Postgres SQL, Zod, Vitest, Supertest, OpenAPI.

---

### Task 1: Establish persistent HTTP RED

**Files:**
- Modify: `apps/api/test/plan-lifecycle.e2e.spec.ts`

- [ ] Add an E2E case that creates and transitions a version through the real HTTP controller, queries `planning.plan_version`, and proves the response and persisted domain payload agree.
- [ ] Repeat the same request with the same principal-scoped idempotency key and assert the original response is replayed.
- [ ] Query `audit.audit_event` and assert exactly one successful event exists for the accepted business write.
- [ ] Run `npm test -- apps/api/test/plan-lifecycle.e2e.spec.ts` and verify failure because the current in-memory service writes no plan row.

### Task 2: Add atomic repository lifecycle writes

**Files:**
- Modify: `packages/database/src/plan-repository.ts`
- Modify: `packages/database/test/plan-repository.spec.ts`

- [ ] Add failing repository tests for atomic create/write audit, idempotent replay, optimistic conflict, user history, single pending enforcement, activation replacement, and rollback on audit failure.
- [ ] Implement transaction-scoped idempotency lookup/claim using operation, principal scope, and request fingerprint.
- [ ] Insert or update the plan version and append one `outcome='ACCEPTED'` audit row in the same transaction.
- [ ] Hydrate timestamps and JSON payload into stable repository records; expose pure `get`, `listByUser`, and active/pending reads.
- [ ] Run `npm test -- packages/database/test/plan-repository.spec.ts` after each RED/GREEN cycle.

### Task 3: Replace the in-memory application adapter

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/plans/plan-lifecycle.service.ts`
- Modify: `apps/api/src/plans/plan-lifecycle.controller.ts`
- Modify: `apps/api/test/plan-lifecycle.e2e.spec.ts`

- [ ] Inject `DatabaseService` and construct the database repository once per application.
- [ ] Convert create, get, transition, current, and history paths to asynchronous persistence calls.
- [ ] Serialize the complete immutable `PlanVersion`, `contentMode`, and trusted creator into the repository payload.
- [ ] Pass trusted request ID, idempotency key, actor ID, active role, operation, and request fingerprint from the controller; never accept actor identity from the body.
- [ ] Keep publishability, reviewer qualification, self-review, user ownership, trusted activation, and domain state transition checks before the atomic repository write.
- [ ] Map uniqueness and optimistic conflicts to stable structured HTTP conflicts.

### Task 4: Prove PL01-PL15 persistence behavior

**Files:**
- Modify: `apps/api/test/plan-lifecycle.e2e.spec.ts`
- Modify: `apps/api/test/openapi.spec.ts`

- [ ] Cover dual review, publish, partial/double confirmation, rejection, timeout, trusted activation, replacement, gap, immutable history, cross-user non-enumeration, concurrent publish/confirm, and pure reads against database state.
- [ ] Prove the unified route guard rejects before plan mutation and records one structured rejection audit.
- [ ] Validate the served `/openapi.json` schemas against actual success, conflict, authorization, and route-gate responses.

### Task 5: Migration and release verification

**Files:**
- Modify only if required: `packages/database/migrations/009_*.sql`
- Modify only if required: `packages/database/src/migrate.ts`
- Modify: `packages/database/test/migration.spec.ts`
- Modify: `docs/engineering/contracts/phase-1-stable-contract.md`

- [ ] Do not edit migrations `001`-`008`; if schema changes are necessary, add `009` and test both empty-database and `008 -> 009` upgrades.
- [ ] Document stable UI response fields and the distinction between publication, confirmation, activation, history, and plan gap.
- [ ] Run focused tests, root `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- [ ] Review PL01-PL15 line by line and report any product decision still required without inventing professional content.
