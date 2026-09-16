# P11 Dual Fixture Evidence Orchestrator

## Scope And Ownership

- Test-only evidence manifest/report composition for the already reviewed dual-persona slices.
- No production endpoint, repository, migration, database write, worker, scheduler, page, browser behavior, or real data-rights processing.
- The only subjects are `persona_fat_loss` and `persona_muscle_gain`; the report never infers missing evidence or substitutes one subject for the other.

## TDD Execution Record

- **RED:** The first orchestrator named test was discoverable but failed because the evidence orchestrator module/behavior was absent. This was a behavior RED, not a discovery failure, type error, database failure, or evidence-count assertion manufactured after implementation.
- **GREEN:** The test-only orchestrator now composes a strict five-layer report using `API_FAKE`, `PG18_REPOSITORY`, `CROSS_LAYER_E2E`, `UI_STATE`, and `BROWSER`. A complete manifest returns `status='COMPLETE'` and the capped `overallStatus='G2_PREPARATION'`; it always fixes `g2Authorized=false`, `g3Authorized=false`, and `readyForRealUsers=false`.
- **Coverage:** The six orchestrator tests cover complete layered composition, missing PG18/browser evidence -> `INCOMPLETE`, unknown layer/subject/cross-subject/unexecuted/conflicting evidence -> `INCOMPLETE`, secret/private field exclusion, primitive-boundary rejection, and unsafe metadata exclusion. The existing message fixture's `Map` generic annotation is recorded as a type-only compile repair; it does not alter message runtime behavior or contract.

## Layered Evidence Report Contract

Every emitted layer contains exactly two isolated fixture entries, one for each persona, and each entry carries `source`, `executionStatus` (`EXECUTED | HISTORICAL | NOT_EXECUTED`), `scope`, and `limitations`.

| Layer | Source / execution status | Scope | Limitations |
| --- | --- | --- | --- |
| `API_FAKE` | Existing API fake/controller tests; status is whatever the supplied manifest records | Controller input/output mapping and fail-closed envelope only for each persona | Does not prove PG18 queries, persistence, locks, idempotency, audit atomicity, production, or real users |
| `PG18_REPOSITORY` | Existing isolated repository evidence; status is manifest-supplied, not inferred | Reviewed local PostgreSQL 18 repository fixture only for each persona where present | Does not prove production adapter registration, external database behavior, or G2/G3 |
| `CROSS_LAYER_E2E` | Existing test-only API-to-fixture evidence; status is manifest-supplied | Previously authorized local cross-layer slice only | Does not merge fake evidence with PG18 or prove general API/runtime closure |
| `UI_STATE` | Existing parser/client-state test evidence; status is manifest-supplied | Pure state/contract consumption only for each persona | Does not prove page, browser, runtime transport, accessibility, or real-user behavior |
| `BROWSER` | Browser evidence only when explicitly supplied; otherwise missing/unexecuted | Browser evidence for the named fixture scope only | No browser evidence may be guessed from unit or fixture tests |

The implementation rejects unknown layers/fixtures, cross-subject `subject` or `subjects` metadata, duplicate layer/fixture evidence, unknown execution states, missing evidence, and `NOT_EXECUTED` entries. It accepts no unsafe source/scope/limitations text containing bearer/token/raw idempotency key/private/secret/entry material. Unknown or incomplete evidence produces `INCOMPLETE`; it never upgrades to `G2_PREPARATION`.

## Fresh Verification Record

- Main-control fresh evidence reports orchestrator `6/6` tests passed.
- Main-control fresh evidence reports the message fixture `2/2` tests passed after the type-only `Map` generic repair.
- API typecheck and build passed; target diff-check passed; staged index remained empty.
- PG18, browser, and runtime execution were **NOT_EXECUTED** for this orchestrator run. No temporary database was created. These absences remain explicit `INCOMPLETE` inputs when omitted from a manifest and are never treated as passes.
- The fresh execution evidence was supplied by the main control; this documentation-only handoff did not rerun tests, build, database, or browser checks.

## Review And Stop

- The final Sol Critical result is `GREEN / ALLOW — P11_DUAL_FIXTURE_EVIDENCE_ORCHESTRATOR_REVIEW_COMPLETE`, limited to this test-only evidence manifest/report.
- This result does not authorize G2/G3, `readyForRealUsers=true`, production,真人, release, real P16 export/delete/anonymization/retention/scheduling, or browser/runtime closure. No automatic next scenario or phase is authorized.
- Preserve the shared dirty worktree. Do not stage, commit, push, reset, checkout, or revert.
