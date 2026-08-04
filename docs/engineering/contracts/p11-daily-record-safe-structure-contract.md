# P11 Daily Record Safe Structure Machine Contract

Version: 0.2.0
Date: 2026-07-27
Owner: R&D
Status: Test-only controller fail-closed and success surface plus an independent PostgreSQL 18 repository are implemented with separate evidence; production repository registration and real-user success remain unimplemented and unauthorized

## Authority And Scope

This contract implements only the machine boundary approved by
`docs/product/lianban-v1.0-p11-safe-structure-acceptance.md` v0.3. The PRD and
that product attachment remain authoritative. This document freezes endpoints,
envelopes, stable codes, provider ports, authorization facts, transaction
ordering, and observable side-effect rules. The currently implemented slice
includes the fail-closed runtime boundary, a test-only controller/fake success
surface, and an independently evidenced PostgreSQL 18 repository. It does not
create a production repository registration or a real-user success path.

It defines no nutrition or training field, three-state machine value, unit,
count, set, intensity, deviation reason, pain threshold, backfill window,
safety copy, professional example, merge rule, prescription, or adjustment
rule. Generic schema identifiers and scalar types below are structural only.
They carry no professional meaning.

## HTTP Surface

Both endpoints require `Authorization: Bearer <complete USER session>` and a
non-empty `x-request-id`. The task identifier locates a resource; it is never
trusted as identity, ownership, plan state, business date, or write authority.

### `GET /api/v1/record-tasks/{taskId}/context`

This is a pure, self-scoped read. It returns the server-derived task, plan,
business-date, schema, open/closed, risk, and existing-record projection. It
must not create a default record, claim idempotency, activate or extend a plan,
change task state, or append a business-success audit.

An available test-only context has this envelope:

```json
{
  "businessStatus": "RECORD_CONTEXT_AVAILABLE",
  "taskId": "opaque-task-id",
  "planVersion": "opaque-plan-version",
  "businessDate": "server-derived-date",
  "accessMode": "EDITABLE",
  "schema": {
    "version": "opaque-schema-version",
    "testOnly": true,
    "recordKinds": [
      {
        "id": "opaque-kind-id",
        "fields": [],
        "allowedActions": ["UPSERT_RECORD"]
      }
    ]
  },
  "records": []
}
```

`accessMode` is `EDITABLE` or `READ_ONLY`. A returned record contains only
`recordId`, `recordKindId`, `recordVersion`, `schemaVersion`, and schema-validated
`entries`. A closed task/date may return an existing record with `READ_ONLY`
and empty `allowedActions`; it never returns a write action.

The response does not accept or echo a client user ID, role, clock, time zone,
business date, plan status, ownership flag, risk state, closed flag, provider
approval, or readiness assertion.

Both this endpoint and the command endpoint below declare their own 401, 404,
and 503 response schemas. Each 401 uses `SESSION_INVALID` and `CLEAR_ALL`.
Each 404 uses only `RECORD_TASK_NOT_FOUND` and `CLEAR_ALL`, whether the task is
absent, belongs to a different USER, or is unreadable for any other reason;
its schema contains no task ownership, plan, or record-detail property. Each
503 uses `ROUTE_ACCESS_NOT_APPROVED` and `CLEAR_ALL`. These are endpoint-local
contract requirements, not an inference from a shared protected-route rule.

### `POST /api/v1/record-tasks/{taskId}/commands`

This endpoint additionally requires a non-empty `idempotency-key`. Its body is
strict and has `additionalProperties: false`:

```json
{
  "operation": "UPSERT_RECORD",
  "recordKindId": "opaque-kind-id",
  "schemaVersion": "opaque-schema-version",
  "expectedRecordVersion": null,
  "entries": []
}
```

The only stable operation in this slice is `UPSERT_RECORD`. It is the generic
write structure for creation, modification, and record entry without defining
a professional distinction between real-time entry and backfill. It does not
define a merge rule. `expectedRecordVersion` is
`null` for an expected absence and a server-issued non-negative integer for an
expected existing record.

Each entry is selected by an opaque provider-issued `fieldId` and contains
exactly one scalar `value` whose JSON type matches the provider field's generic
`valueType`: `STRING`, `NUMBER`, or `BOOLEAN`. Duplicate or unknown field IDs,
wrong scalar types, missing fields, extra fields, non-finite numbers, and any
schema mismatch reject the whole request. This is not an arbitrary JSON
compatibility path.

Success returns `RECORD_WRITE_ACCEPTED`, the server-issued `recordVersion`, the
bound `schemaVersion`, `nextAction: "GET_RECORD_CONTEXT"`, and
`recoverableActions: []`. `nextAction` is a mandatory success continuation, not
a recoverable error action: the client must automatically perform the
authoritative context read. Success does not authorize local version increment
or inferred task completion.

## Provider And Schema Port

The application port is conceptually:

```ts
type RecordSchemaProvider = {
  getApprovedRecordSchema(): Promise<{
    version: string;
    testOnly: boolean;
    approvedForRealUsers: boolean;
    recordKinds: readonly {
      id: string;
      fields: readonly {
        id: string;
        valueType: 'STRING' | 'NUMBER' | 'BOOLEAN';
        required?: boolean;
      }[];
      allowedActions: readonly 'UPSERT_RECORD'[];
    }[];
  }>;
};
```

At application composition, the provider result is fully validated, copied,
and deeply frozen through every record kind, field, and action array. Empty or
whitespace versions/identifiers, duplicate identifiers, unknown value types or
actions, contradictory flags, unexpected properties, partial structures,
provider errors, and later caller mutation all fail closed.

A schema with empty fields is useful only for blocked/read tests and must never
make a real write succeed. Test schemas require `nodeEnv=test`, `testOnly=true`,
and `approvedForRealUsers=false`. Non-test composition cannot inject a test
schema. Until separately governed professional approval exists, no provider may
produce a real-user writable schema and all non-test record writes remain
blocked.

## Trusted Scope And Serialization Boundary

A write transaction, or a serialization boundary with equivalent guarantees,
must complete this order:

1. Authenticate the complete USER session and derive the principal only from
   the bearer credential.
2. Acquire the stable USER/task serialization locks before a success
   idempotency claim or record read used for authorization.
3. Re-read together: current session validity and subject; task existence and
   ownership; the task's bound plan; exactly one currently effective `ACTIVE`
   plan; server-derived task/business date; task/date closed state; risk state;
   pinned provider/schema validity, approval, and task-bound version; and the
   current route/readiness snapshot.
4. Reject if any fact is missing, unknown, contradictory, changed, or blocked.
   Transaction-external prechecks may reject early but never authorize a write.
5. Validate the complete command against the pinned schema and current record
   version.
6. Claim idempotency, mutate the record, persist the replay result, and append
   exactly one success audit as one atomic result.

Plan replacement, risk pause, task/date closure, schema withdrawal, session
subject change/revocation, or readiness change that wins the same ordering must
prevent the record write and leave no success idempotency result. There is no
client-supplied user, role, time, date, plan, task ownership, closure, risk,
schema approval, or readiness override.

## Idempotency, Concurrency, And Audit

The idempotency scope binds the trusted principal, task, server-derived business
date, record kind, schema version, and operation. The request fingerprint covers
the complete canonical write intent: operation, record kind, schema version,
`expectedRecordVersion`, and every result-affecting entry field ID, type, and
value after deterministic normalization. Object order cannot alter the digest;
omitting or changing any result-affecting field cannot replay an older result.

The persisted fingerprint is an opaque keyed digest. Bearer/session tokens,
passwords, MFA material, credentials, and correlation identifiers are excluded.
Raw entry values or any other enumerable sensitive input are never persisted in
the idempotency projection or audit. `x-request-id` is correlation only, and
audit event IDs are independent server-generated IDs.

An exact same-key/same-scope/same-fingerprint replay returns the original result
without another version advance, audit, or downstream side effect. Reuse across
principal, task, business date, record kind, schema, operation, expected version,
or any normalized entry conflicts without disclosing the original result.

Two commands based on one record version allow exactly one version advance.
The loser returns `RECORD_VERSION_CONFLICT`. A later old request cannot overwrite
the winner, regardless of client timestamps. A new key with an old expected
version remains a version conflict. No cross-record-kind merge is defined.

Successful record mutation, replay projection, and success audit are atomic.
Every rejection leaves record state, success idempotency count, success audit
count, plan state, task state, and downstream effects unchanged. Rejection
audits are structured and contain no raw entries or enumerable request digest.
This slice never triggers risk recovery, plan changes, weekly adjustment, or a
professional conclusion.

## Stable Errors And Client State Disposition

Every error contains `businessStatus`, `errorCode`, `recoverableActions`,
`clientStateDisposition`, and `requestId`. Clients branch only on these fields.

| Error code | Meaning | Recoverable actions | Client state disposition |
| --- | --- | --- | --- |
| `SESSION_INVALID` | Session is absent, invalid, expired, revoked, or subject cannot be confirmed | `LOGIN` when server-authorized | `CLEAR_ALL` |
| `ROLE_NOT_AUTHORIZED` | Trusted session is not USER | none | `CLEAR_ALL` |
| `RECORD_TASK_NOT_FOUND` | Task is absent, cross-user, or otherwise unreadable | none | `CLEAR_ALL` |
| `RECORD_PLAN_NOT_ACTIVE` | Task is not backed by the unique current ACTIVE plan | `OPEN_CURRENT_PLAN` or `CONTACT_OPERATIONS` when server-authorized | `CLEAR_ALL` |
| `RECORD_STATE_BLOCKED` | Task/date is closed, risk-paused, or has unknown state | server-authorized navigation only | `DISABLE_EDITOR` |
| `RECORD_SCHEMA_UNAVAILABLE` | Provider is missing, throws, or is unapproved | `CONTACT_OPERATIONS` | `CLEAR_ALL` |
| `RECORD_SCHEMA_INVALID` | Provider/schema is malformed or contains unknown structure | `CONTACT_OPERATIONS` | `CLEAR_ALL` |
| `RECORD_SCHEMA_VERSION_CONFLICT` | Request schema is stale or not task-bound | `REFRESH` | `CLEAR_ALL` |
| `RECORD_VERSION_CONFLICT` | Same trusted principal and target record have a newer authoritative version | `REFRESH` | `PRESERVE_DRAFT_FOR_VERSION_CONFLICT` |
| `IDEMPOTENCY_KEY_REUSED` | Same key has a different scope or normalized intent | `USE_NEW_IDEMPOTENCY_KEY` | `CLEAR_ALL` |
| `ROUTE_ACCESS_NOT_APPROVED` | Route/readiness snapshot blocks the operation | `WAIT_FOR_SECURITY_APPROVAL` | `CLEAR_ALL` |
| `RECORD_REQUEST_INVALID` | Strict command/schema validation failed | `FIX_REQUEST` only when server-authorized | `CLEAR_ALL` |

`PRESERVE_DRAFT_FOR_VERSION_CONFLICT` is legal only after the server has
verified the same trusted principal and same target record. Cross-user access,
session subject change, session invalidity, or inability to authoritatively
confirm identity always returns `CLEAR_ALL`, requiring removal of record data,
unsaved input, and the editor. No response permits retaining a previous
principal's record data.

## P11 Acceptance Mapping

| Scenario | Frozen machine evidence |
| --- | --- |
| P11-01 | Provider validation/freeze and `RECORD_SCHEMA_UNAVAILABLE` or `RECORD_SCHEMA_INVALID`; zero success side effects |
| P11-02 | Test-only approved structural schema plus trusted USER/unique ACTIVE/open owned task returns `RECORD_CONTEXT_AVAILABLE` |
| P11-03 | Session/role/task non-enumeration errors return `CLEAR_ALL`; zero business side effects |
| P11-04 | Unique current ACTIVE re-read rejects every non-current/gap/ambiguous plan state without default records |
| P11-05 | Strict requests expose no client authority fields; all authority is server-derived in the serialization boundary |
| P11-06 | Exact replay returns one result, one record version advance, one success audit |
| P11-07 | Scope or complete normalized-intent change returns `IDEMPOTENCY_KEY_REUSED` without original result disclosure |
| P11-08 | Optimistic compare-and-write permits exactly one winner and one `RECORD_VERSION_CONFLICT` |
| P11-09 | Expected server record version, never client time, prevents stale overwrite |
| P11-10 | `RECORD_SCHEMA_VERSION_CONFLICT` performs zero writes; stored records retain their original schema version |
| P11-11 | Closed context is `READ_ONLY`; reads are pure and return only the caller's existing record |
| P11-12 | Every closed create/update/backfill-equivalent intent returns `RECORD_STATE_BLOCKED` with unchanged success counts |
| P11-13 | Write success requires an automatic authoritative context GET; a failed GET or untrusted subject returns a clearing disposition |
| P11-14 | Unknown status, action, field type, extra property, or malformed response/schema fails closed without fallback |
| P11-15 | Goal/persona is absent from authorization, schema selection, idempotency, and errors; both fictional routes share this contract |
| P11-16 | Non-test writes remain blocked while any real-user gate is open; readiness remains false |

## Current Implemented Surface And Evidence

The test-only controller surface now performs these operations in fail-closed
order. Its fake/controller evidence is separate from the independently
implemented PostgreSQL 18 repository evidence:

- both record endpoints authenticate the bearer credential through the trusted
  session service before evaluating any task or exposing schema availability;
- absent, malformed, expired, revoked, or otherwise invalid sessions return
  `401 SESSION_INVALID` with `CLEAR_ALL`;
- a valid non-USER session returns stable `403 ROLE_NOT_AUTHORIZED` with
  `CLEAR_ALL`;
- without a production task repository registration, the context surface stays
  fail-closed and a verified USER receives the non-enumerating
  `404 RECORD_TASK_NOT_FOUND` with `CLEAR_ALL`; separately, the test-only
  command adapter maps an independently scripted `RECORD_TASK_NOT_FOUND` to
  the same public envelope;
- the global route/readiness middleware returns
  `503 ROUTE_ACCESS_NOT_APPROVED` with `CLEAR_ALL` for classified and unknown
  protected routes without weakening the existing route guard;
- record schema composition accepts only a strictly validated test-only schema,
  rejects unknown properties at the schema root, record-kind, and field levels,
  ignores non-test injection, and pins a deeply frozen snapshot against later
  caller mutation.

The independent PostgreSQL 18 repository is implemented and has its own
repository-level evidence. The API test-only fake/controller adapter also
implements the approved success and error mapping surface. Neither source of
evidence constitutes production repository registration, a real professional
schema, a UI success loop, a real-user write, or a G2/G3 approval.

Current verification evidence is:

- independent security review: four files, `57/57` tests passed, with no
  Critical or Important findings;
- API typecheck passed;
- OpenAPI contract suite passed `4/4`.
- PostgreSQL 18 repository evidence and API pre-wiring fake/controller evidence
  are independent: the fake proves only controller input/output mapping and
  call behavior, while the repository evidence is the only relevant source for
  repository behavior. Neither proves a production or real-user path.

## Unimplemented And Unauthorized Boundary

This closure does not implement or authorize a production task or record
repository adapter, production dependency registration, production database
writes, a real professional schema, UI success integration, a real-user
success path, G2/G3 approval, or readiness for real users. The independent
PostgreSQL 18 repository and test-only fake/controller success surface do not
change those boundaries. Production persistence, idempotency storage,
transaction or lock handling, concurrency behavior, migrations, and success
semantics remain frozen future requirements unless independently evidenced and
separately authorized. Any expansion requires a separately approved scope and
a new TDD cycle.
