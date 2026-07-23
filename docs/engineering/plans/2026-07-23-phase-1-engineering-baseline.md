# Phase 1 Engineering Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable, test-first backend baseline that validates its environment, persists the approved core model locally, exposes a stable OpenAPI/demo contract, and blocks unapproved professional content from real publication.

**Architecture:** Use npm workspaces with a NestJS API and a framework-independent domain package. Use PGlite for a zero-install local PostgreSQL-compatible database because Docker is unavailable, while keeping SQL portable to managed PostgreSQL. Keep professional rules behind an explicit readiness gate; only deterministic demo fixtures are exposed in development/test.

**Tech Stack:** Node.js 24, npm workspaces, TypeScript, NestJS, Zod, Swagger/OpenAPI, Vitest, PGlite, Supertest.

---

## File Map

- `package.json`, `tsconfig.base.json`, `.env.example`: workspace commands and environment contract.
- `packages/domain/src/*`: roles, consent/profile/audit types, plan state machine, and professional-readiness publication guard.
- `packages/database/migrations/001_core.sql`: portable core schema for accounts, roles, consents, profiles, audits, plans, versions, reviews, and confirmations.
- `packages/database/src/*`: PGlite connection and explicit migration runner.
- `apps/api/src/config/*`: fail-fast environment parsing.
- `apps/api/src/demo/*`: development/test-only persona endpoints.
- `apps/api/src/readiness/*`: non-sensitive readiness response proving professional publication is disabled.
- `apps/api/src/openapi.ts`: deterministic OpenAPI document generation.
- `apps/api/test/*`, `packages/*/test/*`: TDD and contract verification.

### Task 1: Workspace and Environment Validation

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/test/config.spec.ts`
- Create: `apps/api/src/config/environment.ts`

- [ ] **Step 1: Write the failing environment tests**

```ts
it('rejects demo mode outside development or test', () => {
  expect(() => parseEnvironment({ NODE_ENV: 'production', DEMO_MODE: 'true' }))
    .toThrow('DEMO_MODE');
});

it('uses an explicit local database path', () => {
  expect(parseEnvironment({ NODE_ENV: 'test', DATABASE_PATH: 'memory://' }).databasePath)
    .toBe('memory://');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- apps/api/test/config.spec.ts`
Expected: FAIL because `parseEnvironment` does not exist.

- [ ] **Step 3: Implement the minimal Zod environment parser and workspace config**

The parser accepts `development | test | production`, requires `DATABASE_PATH`, defaults `PORT` to 3000, and rejects `DEMO_MODE=true` outside development/test.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- apps/api/test/config.spec.ts`
Expected: 2 passing tests.

### Task 2: Core Plan Domain and Publication Guard

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/test/plan-lifecycle.spec.ts`
- Create: `packages/domain/test/publication-guard.spec.ts`
- Create: `packages/domain/src/identity.ts`
- Create: `packages/domain/src/profile.ts`
- Create: `packages/domain/src/audit.ts`
- Create: `packages/domain/src/plan.ts`
- Create: `packages/domain/src/publication-guard.ts`
- Create: `packages/domain/src/index.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover draft -> dual review -> pending confirmation -> dual confirmation -> scheduled -> active, rejection, one-pending-version guard, confirmation deadline, and explicit plan gap. Use fixed UTC instants corresponding to China Standard Time.

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `npm test -- packages/domain/test/plan-lifecycle.spec.ts`
Expected: FAIL because domain functions are missing.

- [ ] **Step 3: Implement minimal immutable transitions**

Expose `transitionPlan`, `canCreatePendingVersion`, and `resolveCurrentPlan`. Transitions return new values and structured error codes; they do not contain screening, risk, nutrition, training, or adjustment thresholds.

- [ ] **Step 4: Run lifecycle tests and verify GREEN**

Run: `npm test -- packages/domain/test/plan-lifecycle.spec.ts`
Expected: all lifecycle tests pass.

- [ ] **Step 5: Write failing publication-guard tests**

```ts
expect(checkPublication({ professionalRulesApproved: false, content: [] }))
  .toEqual({ allowed: false, blockers: ['PROFESSIONAL_RULES_UNAPPROVED'] });

expect(checkPublication({
  professionalRulesApproved: true,
  content: [{ demoOnly: true, reviewStatus: 'DEMO_UNREVIEWED' }],
})).toEqual({ allowed: false, blockers: ['DEMO_CONTENT_REFERENCED'] });
```

- [ ] **Step 6: Verify RED, implement the guard, and verify GREEN**

Run before implementation, then after: `npm test -- packages/domain/test/publication-guard.spec.ts`
Expected before: missing export; expected after: all tests pass.

### Task 3: Portable Core Database and Migration Runner

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/migrations/001_core.sql`
- Create: `packages/database/src/database.ts`
- Create: `packages/database/src/migrate.ts`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/test/migration.spec.ts`

- [ ] **Step 1: Write a failing migration test**

Open an in-memory PGlite database, apply migrations, and assert the existence of `iam.account`, `iam.role`, `care.consent_record`, `care.user_profile`, `audit.audit_event`, `planning.plan`, and `planning.plan_version`. Assert unique constraints for login identifiers and one pending plan version per user.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `npm test -- packages/database/test/migration.spec.ts`
Expected: FAIL because migration runner/schema are absent.

- [ ] **Step 3: Implement minimal SQL and migration ledger**

The SQL stores stable codes and versions only. Professional payloads use version references and JSON containers without invented questions, thresholds, meal values, exercise values, or adjustment rules. Audit records are append-only by application permissions; the migration does not add fake professional seed data.

- [ ] **Step 4: Run the migration test and verify GREEN**

Run: `npm test -- packages/database/test/migration.spec.ts`
Expected: schema and constraints pass.

### Task 4: NestJS API, OpenAPI, and Demo Fixtures

**Files:**
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health.controller.ts`
- Create: `apps/api/src/readiness/readiness.controller.ts`
- Create: `apps/api/src/demo/demo.controller.ts`
- Create: `apps/api/src/demo/demo-fixtures.ts`
- Create: `apps/api/src/openapi.ts`
- Create: `apps/api/test/api.e2e-spec.ts`
- Create: `apps/api/test/openapi.spec.ts`

- [ ] **Step 1: Write failing API tests**

Verify `/health`, `/api/v1/readiness`, the two fixture IDs `persona_fat_loss` and `persona_muscle_gain`, 404 for unknown fixture, and 404 for all demo routes when `DEMO_MODE=false`. Assert every fixture is `demoOnly=true`, `reviewStatus=DEMO_UNREVIEWED`, and `publishable=false`.

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm test -- apps/api/test/api.e2e-spec.ts`
Expected: FAIL because the Nest application does not exist.

- [ ] **Step 3: Implement the minimal API**

Read fixture identity and goal facts from the approved UI fixture document, but do not reproduce professional meal, calorie, exercise, set, or adjustment values. Readiness returns stable blockers including `PROFESSIONAL_RULES_UNAPPROVED`.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `npm test -- apps/api/test/api.e2e-spec.ts`
Expected: all endpoint tests pass.

- [ ] **Step 5: Write and satisfy OpenAPI tests**

Assert `/api/v1/readiness` and `/api/v1/demo/personas/{fixtureId}` exist, schemas expose stable enums, and the document contains no production authentication secrets or professional placeholder values.

Run: `npm test -- apps/api/test/openapi.spec.ts`
Expected: RED before document generation, GREEN after implementation.

### Task 5: Verification and Developer Handoff

**Files:**
- Create: `README.md`
- Create: `docs/engineering/contracts/phase-1-stable-contract.md`

- [ ] **Step 1: Document exact local commands**

Document `npm install`, `npm run db:migrate`, `npm run dev`, `npm test`, `npm run build`, and the local URLs for health and OpenAPI JSON.

- [ ] **Step 2: Run fresh verification**

Run:

```powershell
npm test
npm run build
npm run db:migrate
git diff --check
```

Expected: zero failing tests, successful TypeScript build, migrations applied to the configured local PGlite path, and no whitespace errors in owned files.

- [ ] **Step 3: Confirm scope and commit**

Verify no changes under `docs/product/` or `docs/ui/`. Commit only engineering docs, application/backend/database/test files, and local development configuration.

