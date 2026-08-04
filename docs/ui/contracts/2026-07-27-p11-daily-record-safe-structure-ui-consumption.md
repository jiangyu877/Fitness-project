# P11 Daily Record Safe-Structure UI Consumption Contract

Date: 2026-07-27
Status: Pure parser, client-state, and test-only GET_RECORD_CONTEXT consumer GREEN implemented; independent security and quality reviews passed
Owner: UI department

## Authority And Scope

This document records only the UI consumption boundary frozen by:

- `docs/product/lianban-v1.0-prd.md`;
- `docs/product/lianban-v1.0-p11-safe-structure-acceptance.md` v0.3;
- `docs/engineering/contracts/p11-daily-record-safe-structure-contract.md` v0.2.0;
- the current P11 OpenAPI and structured error surface.

It does not define server behavior. The UI consumer is gated to
`demoEnvironment.mode === 'test'` and consumes only the frozen test-only
reader contract. Production/development routes fail closed before any request.
There is no production record-context or record-write integration, record
repository or persistence. UI work must not expose a real-user success path
until the server runtime contract is implemented and product-reviewed.

This slice defines no nutrition or training field, unit, three-state value,
set, count, intensity, deviation reason, pain threshold, backfill window,
professional copy, merge rule, prescription, or adjustment rule. The PRD does
not authorize a daily-record delete command.

## Trusted Identity And Resource Location

- The UI restores a complete trusted USER session before any P11 request.
- Authorization identity comes only from the restored session token and
  verified USER subject. It never comes from the URL, task payload, cache,
  persona, fixture, display name, or locally stored user ID.
- The URL may provide only the opaque `taskId` resource locator.
- Both frozen endpoints use the restored bearer token and a non-empty
  `x-request-id`:
  - `GET /api/v1/record-tasks/{taskId}/context`;
  - `POST /api/v1/record-tasks/{taskId}/commands`.
- The command endpoint additionally requires a stable non-empty
  `idempotency-key` for one user intent.

## Strict Response Consumption

- Parsers accept only complete frozen envelopes and reject unknown,
  malformed, missing, duplicate, contradictory, or additional properties.
- The only context success discriminator is `RECORD_CONTEXT_AVAILABLE`.
- Context controls come only from the returned `accessMode`, versioned schema,
  record versions, and per-kind `allowedActions`.
- The only frozen write operation/action is `UPSERT_RECORD`. The UI does not
  infer creation, modification, or backfill semantics beyond the server
  command structure.
- `READ_ONLY` context cannot expose a write action. Missing or malformed schema,
  unknown field type, unknown action, empty version, duplicate identifier, or
  schema/record mismatch fails closed as a whole.
- No P11 response may fall back to phase-3 demo data or historical fixture
  fields.

The current parser tests use a pure fictional `testOnly: true` context with
opaque identifiers and empty fields/records. Such fixtures verify parser and UI
state behavior only; they do not represent runtime availability, a professional
schema, real-user approval, or a successful client integration.

## Error And Client-State Disposition

Every accepted error envelope must contain the exact frozen
`businessStatus`, `errorCode`, `recoverableActions`,
`clientStateDisposition`, and `requestId` shape. The UI branches on the stable
machine fields and never parses free text.

- `SESSION_INVALID`, `ROLE_NOT_AUTHORIZED`, `RECORD_TASK_NOT_FOUND`, and
  `ROUTE_ACCESS_NOT_APPROVED` require `CLEAR_ALL`.
- Under the current v0.2.0 API contract, `SESSION_INVALID` carries
  `recoverableActions: []`; the UI must not synthesize or render `LOGIN`.
- `CLEAR_ALL` removes record data, unsaved input, conflict draft, and the
  editor. Disabling the editor while retaining a previous subject's data is
  insufficient.
- Only `RECORD_VERSION_CONFLICT` for the same trusted principal and same target
  record may use `PRESERVE_DRAFT_FOR_VERSION_CONFLICT` with `REFRESH`.
- Any other code/disposition pairing, unknown action, unknown disposition,
  additional field, malformed envelope, or identity uncertainty fails closed
  and clears all record UI state.
- Recovery controls are shown only when the strictly parsed
  `recoverableActions` contains the exact server action. HTTP status, network
  failure, error text, or local workflow state cannot create a recovery action.

## Success Continuation

A write success is valid only when it is exactly `RECORD_WRITE_ACCEPTED`, has a
server-issued non-negative `recordVersion`, the bound non-empty
`schemaVersion`, `nextAction: GET_RECORD_CONTEXT`, and
`recoverableActions: []`.

`GET_RECORD_CONTEXT` is a mandatory success continuation, not an error recovery
action. The current pure client-state implementation produces only a pending
authoritative-read intent after a strictly parsed success and only when both a
trusted subject and task are present. It does not increment a local version,
infer task completion, expose `REFRESH`, or render a local success state as
authoritative. A fail-closed authoritative-read result clears stale state.

The test-only `GET_RECORD_CONTEXT` consumer is implemented in
`apps/web/src/features/p11-real/p11-client.ts` and
`apps/web/src/features/p11-real/p11-record-page.tsx`. It sends one read using
the restored USER session and opaque URL `taskId`, parses the complete frozen
success and error envelopes, and clears state on malformed or
structured fail-closed errors. `apps/web/src/app/app.tsx` refuses the route
outside test mode. No current UI code performs a production read, POST/write,
database operation, or real-user business integration.

## Current Completion And Stop Point

The approved pure-consumption slice now has the following evidence:

1. the consumption contract was product-reviewed before GREEN;
2. the missing-module RED was observed before implementation;
3. the test-only `P11Client` and `P11RecordPage` are implemented under
   `apps/web/src/features/p11-real/`, with the test-only route gate in
   `apps/web/src/app/app.tsx`;
4. the focused UI/P11 suite passes 4 files and 66/66 assertions; the page
   suite passes 6/6; combined focused evidence is 72/72;
5. Web typecheck passes;
6. independent security review reports no Critical or Important findings;
7. independent quality review reports no Critical or Important findings.

This evidence proves only strict parsing, in-memory client-state disposition,
and a test-only read consumer against injected/fake transport. It does not
prove API persistence, PostgreSQL locks, concurrency, persisted idempotency,
audit atomicity, production API availability, successful business integration,
browser acceptance, accessibility acceptance, G2, or G3. No runtime success
path may be simulated from the pure test fixtures.

The UI stops at this boundary pending a separately authorized next phase. The
production P11 client/page consumer, write controls, database path, and real
user entry remain absent and the runtime remains blocked.
`readyForRealUsers=false`; G2 is not reached and G3 remains prohibited.
