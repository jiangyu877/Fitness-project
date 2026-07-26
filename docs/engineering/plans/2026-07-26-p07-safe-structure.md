# P07 Safe Structure Engineering Plan

Date: 2026-07-26
Owner: Engineering
Status: Approved for implementation; real-user gates remain closed

## Facts And Boundaries

The only product facts are `docs/product/lianban-v1.0-prd.md`,
`docs/product/lianban-v1.0-identity-recovery-acceptance.md`, and
`docs/product/lianban-v1.0-p07-safe-structure-acceptance.md`.

Engineering may define APIs, persistence, provider interfaces, errors, and test
fixtures. Engineering must not define consent copy, profile fields, screening
questions, professional thresholds, retention rules, production approvals, or
real-user data. Missing, malformed, inconsistent, or unapproved providers fail
closed. Test providers are fictional and are accepted only when `nodeEnv=test`.

## Stable Technical Contract

- `GET /api/v1/onboarding/consents/current`: USER-only current approved consent
  read. Returns `consentVersion` and provider-supplied display content. Provider
  failure returns a structured 503 with no content.
- `POST /api/v1/onboarding/consents`: accepts only the pinned current version,
  with request id, scoped idempotency, one persistence row, and one audit event.
- `GET /api/v1/onboarding/screening-status`: USER-only self read of the latest
  trusted conclusion-derived state. It exposes no questions, thresholds,
  diagnosis, reviewer identity, or professional source material.
- `GET /api/v1/onboarding/profile`: USER-only self read of the approved ordered
  schema, current step, record version, completed steps, and saved drafts.
- `PUT /api/v1/onboarding/profile/steps/{step}`: body contains `schemaVersion`,
  `expectedVersion`, and `data`. Only approved steps, fields, and structural
  types are accepted. Profile values never enter audit payloads or persisted
  idempotency fingerprints.
- `GET /api/v1/identity/session`: remains the only next-action authority and is
  extended with the P07 state sequence from the product acceptance document.
- Plan creation and task-candidate reads use one onboarding-readiness guard.
  Incomplete consent, untrusted/incomplete screening, or incomplete profile
  yields a stable fail-closed result and no plan, task, idempotency, or business
  mutation.

## Provider Boundaries

Add three structural providers under `apps/api/src/identity/`:

1. Approved consent provider: immutable version plus provider-supplied display
   content. No fallback copy exists in application code.
2. Approved profile schema provider: immutable schema version, ordered steps,
   structural field names/types, and completion rules. No default fields exist.
3. Trusted screening approval provider: validates persisted source and rule
   version as approved. It does not calculate a conclusion or contain rules.

`buildApplication` pins and validates providers before application startup.
Injected providers are ignored outside tests unless a separately governed
production provider integration is introduced later. Readiness and route
authorization use the same pinned snapshot.

## Persistence

Add migration `010_p07_safe_structure.sql`; do not alter migrations 001-009.

- Add approved schema version and per-step draft storage/version metadata to
  the profile persistence model without storing schema definitions.
- Preserve existing consent and trusted conclusion records.
- Add constraints needed to prevent malformed structural state.
- Add a real 001-through-010 upgrade test and repository tests.

## TDD Execution

### Task 1: Provider startup and current consent read

Files: provider modules, `application.ts`, `app.module.ts`, controller/service,
`apps/api/test/p07-safe-structure.e2e.spec.ts`, OpenAPI tests.

RED: provider missing/error/malformed exposes no content; non-test injection is
ignored; current approved content loads only for USER; anonymous and STAFF fail.

GREEN: pin providers, extend readiness inputs, add current-consent read DTO and
structured errors. Evidence: P07-01, P07-02, P07-13, P07-14.

### Task 2: Consent accept and next-action recovery

RED: old/forged version, duplicate intent, and post-accept session recovery.

GREEN: validate against the pinned approved provider, preserve subject-scoped
idempotency, and derive `WAIT_FOR_SCREENING_RULES` when approval is unavailable.
Evidence: P07-03, P07-04, P07-05.

### Task 3: Trusted screening-derived state

RED: USER write denial; unapproved source/version; HUMAN_REVIEW; EXCLUDED; PASS
with missing schema; no diagnostic/internal fields.

GREEN: validate only persisted staff/professional conclusions against the
approval provider and extend server-side `nextAction`. Evidence: P07-06,
P07-07, P07-08.

### Task 4: Approved profile draft read/write

RED: self recovery, unknown step/field/type/schema, optimistic conflict,
completion transition, cross-role/self-scope rules, and raw-value absence from
idempotency/audit storage.

GREEN: add migration/repository operations, schema validation, ordered progress
derivation, versioned writes, minimal audits, and stable 4xx/409 responses.
Evidence: P07-09, P07-10, P07-11, P07-12, P07-13.

### Task 5: Plan and task readiness boundary

RED: table-driven plan create/publish and task-candidate calls for missing
consent, unavailable screening approval, HUMAN_REVIEW, EXCLUDED, incomplete
profile, provider failure, and route gate closure. Assert zero business and
idempotency mutation and one structured rejection audit where required.

GREEN: centralize the onboarding-readiness query and call it from production
plan/task application boundaries. Evidence: P07-06 through P07-08, P07-12,
P07-14.

### Task 6: OpenAPI, contracts, and matrix evidence

RED: OpenAPI/runtime response-schema checks and two fictional personas using
identical APIs/state semantics across recovery, review, exclusion, conflict,
and unauthorized branches.

GREEN: update `docs/engineering/contracts/phase-1-stable-contract.md` and API
schemas without adding product content. Evidence: P07-01 through P07-14.

## Verification Commands

Run the smallest failing test before each implementation increment. Final
verification:

```powershell
npm test --workspace @lianban/api -- --run p07-safe-structure
npm test --workspace @lianban/api
npm test --workspace @lianban/database
npm test --workspace @lianban/domain
npm run typecheck --workspace @lianban/api
npm run typecheck --workspace @lianban/database
npm run typecheck --workspace @lianban/domain
npm run build --workspace @lianban/api
npm run build --workspace @lianban/database
npm run build --workspace @lianban/domain
npm test
npm run typecheck
npm run build
git diff --check
git status --short
```

No staging or commit is authorized.
