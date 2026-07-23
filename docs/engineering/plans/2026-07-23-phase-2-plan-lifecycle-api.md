# Phase 2 Plan Lifecycle API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the non-professional plan-version lifecycle and a testable HTTP API that follows PRD section 6 while preserving all professional-content publication blockers.

**Architecture:** Keep lifecycle rules in the framework-independent domain package. Add an API-scoped in-memory repository and application service so HTTP behavior is deterministic without introducing production persistence claims; database migrations add matching structural constraints. Use stable status and error codes, and derive CST deadlines in the domain rather than accepting client-calculated values.

**Tech Stack:** Node.js 24, TypeScript 5.9, NestJS 11, Vitest 3.2, Supertest, PGlite/PostgreSQL-compatible SQL.

---

### Task 1: Complete The Pure Lifecycle

**Files:**
- Modify: `packages/domain/src/plan.ts`
- Modify: `packages/domain/test/plan-lifecycle.spec.ts`

- [x] Write failing tests for the CST confirmation deadline, the 24-hour publication lead time, professional-review rejection, user rejection, activation at the effective instant, timeout immutability, history, and plan gaps.
- [x] Run `npm test -- packages/domain/test/plan-lifecycle.spec.ts` and verify failures name the missing events or guards.
- [x] Add only the required events and pure functions; do not add screening, risk, nutrition, training, or adjustment calculations.
- [x] Re-run the focused test and `npm run typecheck --workspace @lianban/domain` until both pass.
- [x] Commit the domain slice.

### Task 2: Add A Testable Lifecycle API

**Files:**
- Create: `apps/api/src/plans/plan-lifecycle.service.ts`
- Create: `apps/api/src/plans/plan-lifecycle.controller.ts`
- Create: `apps/api/src/plans/plan-lifecycle.errors.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/openapi.ts`
- Create: `apps/api/test/plan-lifecycle.e2e.spec.ts`

- [x] Write failing HTTP tests for draft creation, dual review, publication, two confirmations, scheduled activation, reviewer/user rejection, expiration, current/history/gap reads, single pending version, and stable blocker/error responses.
- [x] Verify RED with `npm test -- apps/api/test/plan-lifecycle.e2e.spec.ts`.
- [x] Implement an injected in-memory repository and lifecycle service with stable IDs, versions, and ISO timestamps. Enforce `PROFESSIONAL_RULES_UNAPPROVED` before publication and keep demo content non-publishable.
- [x] Register the controller and describe stable request/response codes in OpenAPI.
- [x] Re-run focused API and OpenAPI tests plus API typecheck.
- [x] Commit the API slice.

### Task 3: Align Persistence And Handoff

**Files:**
- Create: `packages/database/migrations/002_plan_lifecycle_guards.sql`
- Modify: `packages/database/src/migrate.ts`
- Modify: `packages/database/test/migration.spec.ts`
- Modify: `docs/engineering/contracts/phase-1-stable-contract.md`

- [x] Write a failing migration test proving lifecycle timestamps and immutable/history-supporting fields are present and invalid scheduling windows are rejected.
- [x] Verify RED with `npm test -- packages/database/test/migration.spec.ts`.
- [x] Add the portable SQL migration and register it without professional seed data.
- [x] Update the engineering contract with the Phase 2 endpoints, statuses, errors, and remaining blockers.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, and a fresh `npm run db:migrate` against an empty local path.
- [x] Check owned-file whitespace and scope, then commit the persistence and contract slice.
