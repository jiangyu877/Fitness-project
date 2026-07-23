# Identity Security And Onboarding API Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development task-by-task.

**Goal:** Deliver the P05-P07/P18 security structure without inventing authentication or professional screening policy.

**Architecture:** Environment readiness gates external approvals. A database-backed identity/onboarding repository owns invited accounts, password hashes, opaque sessions, consent history, profile drafts, screening conclusions, idempotency, optimistic versions, and audit rows. Nest controllers expose stable structured responses; authorization is enforced by server-side role guards.

### Task 1: Readiness and policy configuration

- RED/GREEN environment tests for `AUTH_SECURITY_POLICY_APPROVED` and `PRIVACY_REVIEW_APPROVED`, both default false.
- Readiness returns all three stable blockers and cannot become ready from professional approval alone.

### Task 2: Identity and authorization

- RED/GREEN repository/API tests for invited account password structure, first password change, separate user/staff sessions, five staff roles, lock/disable revocation, opaque random sessions, and standard password hashing.
- Production authentication remains blocked while policy approval is false; tests inject an explicit approved policy object.

### Task 3: Consent, profile, and trusted screening

- RED/GREEN database/API tests for append-only consent acceptance/withdrawal, stepwise profile drafts with `expectedVersion`, and trusted `PASS | HUMAN_REVIEW | EXCLUDED` screening conclusions.
- Every write requires request ID, actor role, idempotency key, audit event, and optimistic version boundary.
- Add new numbered migrations only; update OpenAPI and engineering contract; run focused/full verification and empty migration.
