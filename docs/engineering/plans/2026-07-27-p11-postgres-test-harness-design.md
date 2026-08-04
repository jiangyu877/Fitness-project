# P11 PostgreSQL Test Harness Design

Date: 2026-07-27
Owner: R&D
Status: Approved design; implementation remains RED-first

## Goal

Add a disposable, local PostgreSQL 18 test harness for the P11 persistence
RED suite. It must validate PostgreSQL migration, lock, transaction, and
constraint behaviour without accessing any existing application database.

## Scope

The harness may create and drop only databases named
`lianban_p11_test_<random_suffix>`. It will use only fictional test rows.
It does not add P11 persistence, a successful record endpoint, a real schema,
external PostgreSQL access, staging, production, or real-user data.

## Connection Guard

The harness reads `LIANBAN_TEST_POSTGRES_ADMIN_URL` only at test execution.
The URL is never logged. It must use `postgresql:` or `postgres:`, a loopback
host (`localhost`, `127.0.0.1`, or `::1`), and the maintenance database
`postgres`. Any other host or maintenance database throws before a connection
or SQL statement is issued.

The harness generates the target database name itself and checks the same
strict prefix before every create, connect, terminate, or drop operation. It
must never construct an identifier from user input. In particular, it never
reads, writes, locks, migrates, terminates connections to, or drops
`consumer_analysis`, `consumer_spend`, or any other existing database.

## Architecture

`packages/database` gains a test-only PostgreSQL adapter backed by `pg` and a
small common migration execution port. Existing PGlite production and API
paths retain their current implementation. The common port supports parameter
queries, SQL execution, and callback transactions; it does not add a general
runtime connection configuration.

The test harness creates one random database from the guarded maintenance
connection, applies the existing append-only migrations, gives each test an
isolated connection pool, closes every pool, terminates only sessions connected
to that generated database, and then drops it. Cleanup failures surface as test
failures rather than silently leaving state behind.

## RED Evidence

Before any P11 repository or migration implementation, the PostgreSQL suite
must demonstrate the missing record repository as an expected failure and then
lock these observable behaviours into tests:

1. All existing migrations apply to an empty isolated PostgreSQL database.
2. An unsafe admin URL or unsafe target database name fails before SQL runs.
3. P11 persistence tests require the still-unimplemented repository rather
   than reporting an empty Vitest filter as success.
4. The future repository contract covers transaction revalidation, exact
   idempotent replay, changed-intent conflict, record-version concurrency,
   closed-write rejection, and atomic record/idempotency/audit rollback.

## Required Follow-up Gate

The P11 PostgreSQL harness does not resolve the prior Critical design issues.
Before GREEN, R&D must freeze a shared P07/plan/P11 lock order, a
transaction-scoped session/readiness/task/risk revalidation port, and the
keyed fingerprint canonicalization/key-lifecycle contract. A subsequent
high-risk review decides whether an append-only `011` migration and minimal
test-only repository are authorized.
