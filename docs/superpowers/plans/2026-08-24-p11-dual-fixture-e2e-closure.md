# P11 Dual-Fixture E2E Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local test-only, two-fixture P11 API/E2E evidence chain while keeping record persistence, messages, and data-rights contracts separately authorized and evidence-layered.

**Architecture:** Reuse the existing `persona_fat_loss` and `persona_muscle_gain` USER fixtures from `plan-lifecycle.e2e.spec.ts` for authentication and plan lifecycle setup. Extend only after product freezes a machine contract: first a single dual-fixture record-write scenario through the existing record command route and isolated PG18 repository, then separately authorized message and data-rights contracts, and finally an evidence-only orchestrator.

**Tech Stack:** TypeScript, NestJS, Supertest, Vitest, `@lianban/database`, isolated PostgreSQL 18 harness, existing test-only `P11RecordRepositoryPort`, and existing plan lifecycle fixtures.

---

## Frozen Boundaries

- The current baseline proves only authentication -> plan confirmation/activation -> task-candidate admission/plan gap for both fictional fixtures.
- It does not prove record persistence, messages, data-rights processing, production APIs, or G2/G3.
- No implementation task may begin until product resolves the stale P11-06 authorization text in `docs/product/lianban-v1.0-2026-07-27-cross-department-handoff.md:91-99` against the current work log/ledger and explicitly authorizes one named scenario.
- `apps/api/test/p11-record-context.postgres.e2e.spec.ts` is guarded by `LIANBAN_TEST_POSTGRES_ADMIN_URL`; skipped PG18 execution must be reported as unexecuted, never as pass.
- Never modify production wiring, migrations, professional fields, units, thresholds, safety copy, real-user paths, or message/data-rights business behavior under the first record-write task.

### Task 0: Reconcile authorization before code

**Files:**
- Read: `docs/product/lianban-v1.0-2026-07-27-cross-department-handoff.md:91-99`
- Read: `docs/product/lianban-v1.0-work-log.md`
- Read: `docs/product/lianban-v1.0-acceptance-ledger.md`
- Update only after product decision: `docs/product/**`

- [ ] **Step 1:** Record the current contradiction: the handoff still identifies P11-06 exact replay as the only next scenario, while the work log records P11-06 as closed. Do not silently choose one source.
- [ ] **Step 2:** Obtain product's written decision. It must either authorize the existing P11-06 focused review or name `P11-DUAL-FIXTURE-RECORD-WRITE` with its exact response, fixture, and evidence boundary.
- [ ] **Step 3:** Stop if no decision exists. A product decision is an input gate; do not enable skipped scenarios while it is absent.

### Task 1: Establish the dual-fixture record-write RED

**Files (only after Task 0 authorization):**
- Test: `apps/api/test/p11-record-context.postgres.e2e.spec.ts`
- Reuse: `apps/api/test/plan-lifecycle.e2e.spec.ts:1156-1200`
- Reuse helpers: `apps/api/test/p11-record-context.postgres.e2e.spec.ts:1564-1610`
- Engineering evidence: `docs/engineering/plans/2026-08-24-p11-dual-fixture-e2e-closure.md`

- [ ] **Step 1:** Add one failing test for two isolated fictional USER subjects. Seed one opaque `record_task` per subject, use `persona_fat_loss` and `persona_muscle_gain` bearer sessions, and send the existing legal `UPSERT_RECORD` command through `/api/v1/record-tasks/:taskId/commands`. Assert the frozen success envelope for both subjects and assert each record is bound to its own session/task; use only existing `schema-v1`, `kind-1`, `field-1`, and opaque string values.
- [ ] **Step 2:** Run only the named test: `npx vitest run apps/api/test/p11-record-context.postgres.e2e.spec.ts -t "dual fictional"`. Expected RED must be one missing fixture/setup or missing assertion, not a discovery error or unrelated skipped-test change.
- [ ] **Step 3:** Confirm the test is discovered and fails because the dual-fixture cross-layer path is absent. If `LIANBAN_TEST_POSTGRES_ADMIN_URL` is missing, stop and report the PG18 test as unexecuted rather than fabricating RED/GREEN.

### Task 2: Minimal GREEN and focused PG18 evidence

**Files:** same as Task 1; no production source files unless the authorized RED proves a missing test-only adapter wiring defect.

- [ ] **Step 1:** Add only the minimum test-only fixture/setup needed to make Task 1 pass. Do not add a new endpoint, migration, professional schema, message contract, data-rights behavior, or production registration.
- [ ] **Step 2:** Run the focused API->PG18 test and assert both responses, two subject/task bindings, record versions, one completion idempotency row per subject, one success audit per subject, and zero cross-subject leakage.
- [ ] **Step 3:** Run focused regression; report active/skipped counts, typecheck, build, diff-check, temporary database cleanup, and external 5432 state separately.

### Task 3: Independent review gate for the record slice

- [ ] **Step 1:** QA reviews the exact test output and verifies no fake/API evidence is used for PG18 claims.
- [ ] **Step 2:** Security, professional, UI, and operations reviewers confirm no new identity, professional, UI, production, or operational semantics were introduced.
- [ ] **Step 3:** The designated Sol Critical thread independently reviews the exact diff and PG18 evidence. Only `GREEN / ALLOW` for this named slice permits the next scenario.

### Task 4: Separately authorize message and data-rights contracts

- [ ] **Step 1:** Product freezes a machine-only P15 message contract containing only `messageId`, `readState`, opaque `targetType`, and opaque `targetId`; no message content, URL authorization, or professional semantics.
- [ ] **Step 2:** Product/security/privacy freeze a machine-only P16 request-status contract for `EXPORT | DELETE | ANONYMIZE`, strict status values, subject idempotency, cross-subject `CLEAR_ALL`, and unknown-input fail closed. This does not authorize real export packages, deletion, anonymization, retention scheduling, or worker execution.
- [ ] **Step 3:** Implement each contract in its own RED -> GREEN -> focused QA -> boundary review -> Sol Critical cycle. Do not combine P15/P16 implementation with Task 1.

### Task 5: Compose the evidence-only orchestrator

- [ ] **Step 1:** Add one test that calls the already-reviewed fictional lifecycle and record slices for both subjects without creating new business behavior.
- [ ] **Step 2:** Assert the evidence report keeps API fake, PG18 repository, cross-layer E2E, UI, and browser evidence as separate sections.
- [ ] **Step 3:** Run full authorized regression and update only the product ledger/work log after every independent review has returned.

## Verification Commands

```powershell
npx vitest run apps/api/test/plan-lifecycle.e2e.spec.ts -t "runs fat-loss and muscle-gain fixture labels through the real lifecycle matrix"
npx vitest run apps/api/test/p11-record-context.postgres.e2e.spec.ts -t "dual fictional"
npm run typecheck --workspace @lianban/api
npm run build --workspace @lianban/api
git diff --check
```

The first command is the current baseline and produced `1 passed / 35 skipped`; it is not record/message/data-rights closure evidence. The remaining commands require a named implementation slice and must report guarded/skipped cases as unexecuted.
