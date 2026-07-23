# Identity Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the frozen invitation, MFA, idempotency, secret-storage, audit-principal, password-change, and lockout security gaps without creating a production bootstrap or professional policy.

**Architecture:** Authentication produces server-derived principals. Authenticated commands pass a principal plus request correlation/idempotency metadata into a transaction boundary that validates operation, principal scope, and a non-secret request fingerprint. Login uses a dedicated secret-safe transaction. Migrations 006 and 007 extend idempotency, active-role session, and structured audit storage without changing released migrations.

**Tech Stack:** NestJS, TypeScript, Zod, PGlite/Postgres-compatible SQL, Vitest, Supertest, Swagger/OpenAPI.

---

### Task 1: Invitation authorization and server principals

**Files:** `apps/api/test/identity-security-hardening.e2e.spec.ts`, `apps/api/src/identity/identity-onboarding.controller.ts`, `apps/api/src/identity/identity-onboarding.service.ts`

- [x] Write tests proving anonymous invitation has no account side effect; forged actor headers do not authorize; OPERATIONS creates only USER without staff roles; SYSTEM_ADMIN creates only STAFF and assigns validated staff roles.
- [x] Run the focused test and confirm authorization failures are RED.
- [x] Require a STAFF bearer principal for invitations and derive actor identity/role from its persisted roles.
- [x] Run the focused test and confirm GREEN.

### Task 2: Server-side staff MFA

**Files:** `apps/api/test/identity-security-hardening.e2e.spec.ts`, `apps/api/src/identity/mfa-verifier.ts`, `apps/api/src/app.module.ts`, `apps/api/src/application.ts`, identity controller/service

- [x] Write tests proving client `mfaVerified` or unknown fields cannot bypass MFA and missing verifier creates no session.
- [x] Run the focused test and confirm MFA failures are RED.
- [x] Remove `mfaVerified` from login input; inject `MfaVerifier`; fail closed when staff MFA is required and no verified challenge exists.
- [x] Run the focused test and confirm GREEN.

### Task 3: Scoped idempotency and secret-safe login

**Files:** `packages/database/migrations/006_identity_security_hardening.sql`, `packages/database/src/migrate.ts`, migration tests, identity E2E tests, identity service

- [x] Write migration/API tests for operation, principal scope, non-secret fingerprint, unique audit IDs, nullable failed-login actor, cross-route/principal/body reuse conflict, concurrent same-key single side effect, and no raw token anywhere in stored table values.
- [x] Run focused tests and confirm RED due to absent migration columns and unsafe replay.
- [x] Add migration 006/007 and transaction helpers using a claimed idempotency row; return stable `IDEMPOTENCY_KEY_REUSED` conflicts on scope mismatch.
- [x] Implement dedicated login idempotency that stores only a non-secret projection and returns `LOGIN_REPLAY_REQUIRES_REAUTHENTICATION` instead of replaying a token.
- [x] Run focused tests and confirm GREEN; rerun plan repository tests unchanged.

### Task 4: Password and lockout invariants

**Files:** identity E2E tests and identity service

- [x] Write tests proving LOCKED/DISABLED accounts cannot change initial password, audit actor is credential-derived, and repeated failed HTTP attempts count even with reused request/idempotency keys.
- [x] Run focused tests and confirm RED.
- [x] Restrict first change to INVITED accounts with `initial_password_change_required=true`; never reactivate locked/disabled accounts; audit the matched account.
- [x] Make every failed HTTP login increment independently, lock at the configured threshold, revoke sessions, and audit with nullable actor plus SYSTEM role.
- [x] Run focused tests and confirm GREEN.

### Task 5: Qualified screening authorization

**Files:** identity E2E tests and identity service

- [x] Write tests proving an unqualified reviewer receives 403 and creates zero screening rows.
- [x] Seed `iam.account_role.qualified_at` directly as external qualification evidence for the positive reviewer case; never set it through invitation.
- [x] Require the active reviewer role and its non-null qualification timestamp in the server-derived principal.
- [x] Run the focused test and confirm GREEN.

### Task 6: Session-bound acting role

**Files:** migration 006, identity controller/service, identity security E2E, OpenAPI, engineering contract

- [x] Write RED for multi-role staff sessions selecting `OPERATIONS` and `SYSTEM_ADMIN` independently.
- [x] Add `iam.session.active_role`, require and validate staff `actingRole`, and derive later authorization/audit exclusively from the bound role.
- [x] Verify mutually exclusive invitation permissions and audit roles for both sessions.
- [x] Revalidate the bound role on every STAFF request and revoke the session immediately when that role grant is removed.

### Task 7: Refactor and contract

**Files:** identity controller/service and optional focused identity helper/repository files, `apps/api/test/openapi.spec.ts`, `docs/engineering/contracts/phase-1-stable-contract.md`

- [x] Add OpenAPI assertions that actor headers and `mfaVerified` are absent while bearer auth, 401 responses, and stable errors are documented; confirm RED.
- [x] Format authorization, SQL, audit, fingerprint, and error responsibilities into reviewable methods while preserving focused tests.
- [x] Update OpenAPI and the engineering contract; remove bootstrap/header-trust language and state external seed/MFA/readiness boundaries.
- [x] Run focused identity, OpenAPI, migration, and plan repository tests.

### Task 8: Completion gates and commit

- [x] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- [x] Apply migrations 001-007 to a fresh `memory://` PGlite database and verify the migration ledger.
- [x] Inspect the staged whitelist to ensure no `apps/web`, `docs/ui`, or `docs/product` path is included.
- [x] Commit the security hardening and report RED/GREEN evidence, counts, SHA, files, and remaining production risks.

Production gates intentionally still open after this slice:

- [ ] Implement and verify a production real-user route guard across identity, onboarding, and plans.
- [ ] Supply governed authentication policy approval evidence and a production MFA verifier; main continues to inject a null policy and fail closed.
- [ ] Complete privacy, data-rights, backup/restore, operations, deployment-security, and professional-rule readiness evidence.
