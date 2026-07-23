# Phase 3 Engineering Slices Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Phase 2 process-local plan store with a testable PostgreSQL-compatible persistence port and deliver the PRD P0 structure closures without inventing professional content.

**Architecture:** Domain/application services depend on ports. The first adapter uses the existing PGlite SQL migration and can later target managed Postgres. HTTP writes return stable business status, error code, recoverable actions, request ID, idempotency outcome, and audit references. Professional rules remain configuration placeholders and publication remains blocked by default.

### Slice 1: Persistent plan repository port

- RED: repository contract tests for create, transition, reload, current/history, expected version conflict, idempotent replay, and audit event.
- GREEN: implement SQL-backed PGlite adapter and inject it into the plan service.
- Verify: focused repository/API tests, typecheck, migration.

### Slice 2: Consent and profile drafts

- RED/GREEN API tests for consent version acceptance/withdrawal and stepwise profile save with optimistic version checks.
- No screening questions or professional interpretation.

### Slice 3: Screening structure and risk pause

- RED/GREEN tests for opaque screening submission returning only `PASSED`, `MANUAL_REVIEW`, or `EXCLUDED`; risk events pause linked tasks and recovery requires a qualified role.
- No invented questions, thresholds, diagnoses, or recovery criteria.

### Slice 4: Daily records and weekly adjustment trigger

- RED/GREEN tests for idempotent diet tri-state, training group/retroactive records, weekly feedback, adjustment draft, and full new plan-version trigger.
- Numerical/professional values remain opaque payloads and cannot publish while unapproved.
