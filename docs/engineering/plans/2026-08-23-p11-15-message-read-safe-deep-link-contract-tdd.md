# P11-15 Message Read Safe Deep Link Contract TDD

## Scope

- Test-only API contract fixture; no Nest production route, database migration, production repository, professional field, or real-user behavior.
- Frozen endpoints: `GET /api/v1/messages`, `POST /api/v1/messages/:messageId/read`, and `GET /api/v1/message-targets/:targetType/:targetId`.
- Frozen message shape: exactly `messageId`, `readState: UNREAD | READ`, opaque `targetType`, and opaque `targetId`.
- Target payload remains `unknown`; the fixture proves server-reader invocation and fail-closed handling without inventing target business fields.

## TDD Record

- **RED:** The first focused run used the new contract test with a deliberately empty list fixture. It failed at the strict message-list assertion: expected one `{messageId, readState, targetType, targetId}` object but received `{messages: []}`. This was a valid fixture RED, not a type error or production-route failure.
- **GREEN:** The test-only fixture now exposes the three approved endpoint paths, returns the exact message list shape, marks a known message `READ` idempotently on repetition, delegates deep-link opening to a server-reader callback with opaque target and subject identifiers, and maps reader failure/unknown target inputs to `{ok:false, clientStateDisposition:'CLEAR_ALL'}`. Successful target payload remains opaque `unknown`.

## Evidence And Boundaries

- Focused contract fixture: `npx --no-install vitest run apps/api/test/p11-message-contract.fixture.spec.ts --maxWorkers=1 --minWorkers=1 --testTimeout=30000` -> `1 passed`.
- This fixture proves only endpoint path/shape, repeated-read idempotency at the fixture boundary, server-reader delegation, and fail-closed client disposition. It does not prove production routing, authentication middleware, message persistence, database idempotency, target authorization, browser deep links, or real-user readiness.
- Unknown/invalid/expired/subject-changed target outcomes are represented only by the existing `CLEAR_ALL` disposition; no new error code, message text, target status, or professional semantic is introduced.

## Verification And Stop

- Run API typecheck/build and `git diff --check`; keep the staged index empty.
- Stop for QA read-only reproduction, then security/professional/operations checks and the specified Sol Critical review. P11-16, browser evidence, production route registration, migrations, deployment, G2/G3, and `readyForRealUsers=true` remain prohibited.
