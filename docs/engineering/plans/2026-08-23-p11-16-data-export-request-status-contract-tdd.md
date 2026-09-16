# P11-16 Data Export Request Status Contract TDD

## Scope

- Test-only contract fixture only; no production route, database migration, export worker, scheduler, real export package, or real-user data.
- The fixture accepts a trusted subject identity supplied by the test harness, not a client authority field.
- Strict request-status object contains only opaque `requestId`, `requestType: 'EXPORT'`, and `status: 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED'`.

## TDD Record

- **RED:** The first focused run used a deliberately empty fixture implementation. Submission returned `{requestId: '', requestType: 'EXPORT', status: 'REJECTED'}` instead of the required opaque request ID and `SUBMITTED` status. This was a valid contract-fixture RED, not a typecheck failure or production-route result.
- **GREEN:** The minimal in-memory fixture stores only the trusted subject binding and strict status object. The first submission creates `EXPORT/SUBMITTED`; repeating the same opaque `requestId` for the same subject returns the identical status object; another subject receives only `{ok:false, clientStateDisposition:'CLEAR_ALL'}`. No export payload, field data, scheduler, or production persistence is created.

## Evidence And Boundaries

- Focused command: `npx --no-install vitest run apps/api/test/p11-export-request-status.fixture.spec.ts --maxWorkers=1 --minWorkers=1 --testTimeout=30000` -> `1 passed`.
- The fixture proves only strict object shape, trusted-subject binding, same-subject same-requestId idempotency, and cross-subject fail-closed disposition. It does not prove production routing, database persistence, export generation, data-rights timing/deletion, scheduling, or real-user readiness.

## Verification And Stop

- API typecheck/build and `git diff --check` are required; keep the staged index empty.
- Stop for QA, security/privacy, professional, operations and Sol Critical read-only review. P11-16 deletion/anonymization/retention branches, production/database work, scheduler, real export package, browser evidence, G2/G3 and `readyForRealUsers=true` remain prohibited.

## DELETE_REQUEST_STATUS Extension

- **RED:** The first focused DELETE fixture run returned `{requestId: '', requestType: 'DELETE', status: 'REJECTED'}` instead of the required opaque request ID and `SUBMITTED` status.
- **GREEN:** The test-only fixture now accepts `DELETE` or `ANONYMIZE`, stores only trusted subject binding plus the strict `{requestId, requestType, status}` object, returns the same object for same-subject same-requestId repetition, and returns only `CLEAR_ALL` for cross-subject access. The allowed `PROCESSING | COMPLETED | FROZEN | REJECTED` states are type-level contract values; this fixture does not transition state or implement real deletion, anonymization, security-event handling, scheduling, retention, or data processing.
- Focused command: `npx --no-install vitest run apps/api/test/p11-delete-request-status.fixture.spec.ts --maxWorkers=1 --minWorkers=1 --testTimeout=30000` -> `1 passed`.
- Evidence remains test-only contract behavior. No production route, migration, database, scheduler, export/delete package,真人数据 or release behavior is added. Stop for QA and the existing review sequence.

## Final Sol-Review Remediation Record (2026-08-31)

- **RED:** Focused web tests rejected boxed `String` request/status values, non-string session/requestId guards, illegal `EXPORT/FROZEN` typed state events, and invalid dual-fixture seeds/duplicate keys. The failures were observed before the corresponding GREEN changes.
- **GREEN:** Export/delete parsers now require primitive non-empty strings and enforce request-type-specific status sets; clients validate requestId/requestType identity and convert transport/parse failures to `ClientError` with `CLEAR_ALL`; delete state validates typed/cast events at runtime; the API test-only dual-data-rights fixture validates exact seed shape, primitive fields, legal combinations, duplicate identity, and non-string submit/get inputs fail closed.
- **Final focused evidence:** the prior `33 passed` web / `3 passed` API-fixture / `260 passed` full-Web figures are the pre-remediation baseline. The strictness remediation's fresh focused runs were web `37 passed / 0 skipped` and API fixture `5 passed / 0 skipped`; the subsequent reducer-discriminator remediation added fresh reducer focused coverage and the current full Web run is `28 test files / 272 passed / 0 failed`. Web typecheck exited `0`; target diff checks exited `0`; staged index remained empty.
- **Boundary:** This remediation remains test-only/UI-state/spec and API-fixture/spec evidence. It adds no production API, database, migration, worker, scheduler, P15 behavior, professional fields, real deletion/anonymization,真人数据, G2/G3, or release behavior.

## Dual Persona Closure Record (2026-08-31)

- **RED/GREEN scope:** The separately authorized `P11-DUAL-FIXTURE-DATA-RIGHTS-STATE` uses `persona_fat_loss` and `persona_muscle_gain`, each with 14 strict request-status states: EXPORT four states; DELETE and ANONYMIZE five states including FROZEN. Same-subject request identity is idempotent; cross-subject, unknown, empty, malformed, or duplicate/invalid seed inputs fail closed to `CLEAR_ALL` or `DATA_RIGHTS_FIXTURE_INVALID` as applicable.
- **UI strictness:** Export and delete parsers require primitive non-empty fields and type-specific states; clients correlate request ID/type and convert transport/parse failures to `ClientError/CLEAR_ALL`; reducers validate exact runtime status objects, trusted subject strings, and event discriminators, clearing invalid or cross-subject state.
- **Current evidence:** API fixture focused `6 passed / 0 skipped`; reducer/UI focused `20 passed / 0 skipped`; full Web `28 test files / 272 passed / 0 failed`; Web typecheck and diff-check passed; staged index empty. The earlier API fixture count `5 passed / 0 skipped` is retained only as the pre-repair historical baseline; current `6 passed` comes from the repaired fixture execution recorded at line 49, and this read-only review did not rerun it.
- **Boundary reviews:** QA `QA_CLEAR` (named slice only), security `SECURITY_NO_OBJECTION`, professional `PROFESSIONAL_CLEAR`, UI `UI_NO_CHANGE_CLEAR`, and operations `OPERATIONS_BLOCKED / MAINTAINED`. Sol Critical final review is the remaining closure gate; no real export, deletion, anonymization, retention, scheduling, production, P15, G2/G3, release, or `readyForRealUsers=true` is authorized.

## Seed Identity Ambiguity Repair (2026-08-31)

- **RED:** The test-only dual-data-rights fixture accepted two seeds for one subject and one `requestId` when their `requestType` values differed, leaving `get(requestId)` dependent on insertion order.
- **GREEN:** `createDualDataRightsFixture` now rejects any same-subject/same-requestId seed with a different request type as `DATA_RIGHTS_FIXTURE_INVALID`; exact duplicate identities remain rejected, and each persona retains 14 valid states (EXPORT four, DELETE/ANONYMIZE five each).
- **Focused evidence:** the repaired API fixture run passed `6 passed / 0 skipped`; no production/UI behavior changed. Existing reducer/UI and full-Web evidence remain separate and are not re-counted by this fixture-only repair.
