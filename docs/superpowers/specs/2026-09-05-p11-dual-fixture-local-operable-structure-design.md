# P11 Dual Fixture Local Operable Structure Design

## Decision

The active product scene is `P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE`.
It builds a local, test-only browser path for the existing fictional
`persona_fat_loss` and `persona_muscle_gain` fixtures. Each fixture receives
its own trusted test session and opaque record task, reads authoritative
record context, submits one schema-driven record, and reads context again.

This is a structure-level P11 closure. It does not define diet state values,
deviation reasons, training movements, set fields, units, pain behavior, or
backfill semantics. Those rules remain blocked pending versioned professional
approval.

## Why This Scope

The existing runtime bridge already proves the record command route can reach
an isolated PostgreSQL 18 adapter for both fictional subjects. The web record
page currently consumes context only and deliberately renders no write
control. The missing evidence is a browser-operable path using that same
test-only boundary, with a fresh authoritative read after write.

Messages and data rights are P15 and P16. They are not inputs to this scene.

## Browser Flow

1. The operator starts the explicit local test-only runtime command.
2. The browser opens `/h5/p11-local`, which displays only the two approved
   fictional fixture choices and the prototype disclaimer.
3. Selecting a fixture stores its test-only session locally and opens its
   opaque record task. The browser never derives the task or authorization
   from a name, goal, route parameter, or cached record.
4. The record page requests authoritative context. It renders controls only
   from the returned test-only schema, using field identifiers and primitive
   value types without product or professional labels.
5. A successful submission sends the current schema version, task ID,
   generated request ID, and idempotency key. It then reads authoritative
   context again before reporting the result.
6. Switching to the other fixture clears the prior browser session and opens
   that fixture's distinct task. Returning to the first fixture can show only
   its own persisted record.

## Runtime Architecture

The local launcher owns two loopback processes:

- A test-only Nest application backed by ephemeral PGlite identity state and
  an isolated PostgreSQL 18 database. It seeds the two fictional identities,
  matching sessions, a writable task per subject, a test-only record schema,
  and the existing record repository/context adapters.
- The Vite web application, enabled only by `VITE_P11_LOCAL_RUNTIME=true`.
  Its proxy targets the local test-only API and exposes the fixture selector.

The test-only API exposes a narrowly scoped fixture manifest only while the
runtime launcher is active. It contains no real account, professional, or
production data. On shutdown it closes the Nest application, terminates
connections to the temporary PostgreSQL database, and drops that database.

## Client Contract

`P11Client` gains a typed record-command method. It sends only the strict
existing command envelope and converts malformed success/error bodies,
transport failures, and missing correlation values into the existing
fail-closed client error shape.

`P11RecordPage` remains schema-driven. It may render primitive editors only
when context is `EDITABLE`, the schema is test-only, and the server allows
`UPSERT_RECORD`. It must submit every schema field exactly once, disable the
editor while the write and authoritative reread are pending, and clear or
disable state using the existing disposition reducer on any failure.

## Acceptance Evidence

The scene is complete only when all of the following are observed fresh:

- Unit tests prove client command headers, strict parsing, generic editor
  submission, authoritative reread, and fail-closed malformed/error paths.
- A focused test-only API runtime test proves both fixture sessions reach only
  their own PG18 task, write one independent record, and return a context that
  excludes the other fixture's record.
- A live local browser runs the fat-loss and muscle-gain paths in turn,
  submits a record for each, returns to the first fixture, and confirms its
  browser-visible record set contains no other-subject data.
- API and web typecheck/build checks plus `git diff --check` pass.

Report browser interaction as `BROWSER` and the API-to-PG18 result as
`CROSS_LAYER_E2E + PG18_REPOSITORY`. Neither result authorizes production,
staging, real users, G2, G3, release, or `readyForRealUsers=true`.

## Explicit Exclusions

- P15 messages and P16 data-rights behavior.
- Production route registration, migrations, external databases, workers,
  schedulers, deployment, staging, or real user data.
- Diet-state values, deviation fields, training sets, backfill timing,
  thresholds, safety language, or any other professional semantics.
- Claims that the structure-level browser path completes P11's full product
  semantics.
