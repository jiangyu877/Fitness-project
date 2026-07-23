# Stable Engineering Contract

Version: 0.4.0
Date: 2026-07-23
Owner: R&D
Status: Implemented testable engineering slices; not approved for real-user service

## Scope

This contract is the stable integration surface available through the current identity/onboarding slice. It does not replace `docs/product/lianban-v1.0-prd.md` and does not claim that the full V1.0 business API exists.

The implementation intentionally contains no screening questions, risk thresholds, nutrition values, training values, or weekly-adjustment rules. Those inputs remain release blockers until their professional approvals are recorded.

## HTTP Endpoints

### `GET /health`

```json
{ "status": "ok" }
```

This endpoint proves that the HTTP process is responding. It does not imply that the service is approved for real users.

### `GET /api/v1/readiness`

```json
{
  "readyForRealUsers": false,
  "blockers": ["AUTH_SECURITY_POLICY_UNAPPROVED", "PRIVACY_REVIEW_UNAPPROVED"]
}
```

Stable blockers are:

| Code | Meaning | UI behavior |
| --- | --- | --- |
| `DEMO_MODE_ACTIVE` | Demo mode is enabled | Never treat demo fixtures as real-user service |
| `PROFESSIONAL_RULES_UNAPPROVED` | Required professional inputs have not been approved | Block real-user publication |
| `AUTH_SECURITY_POLICY_UNAPPROVED` | Authentication policy lacks approval evidence | Block identity production paths |
| `PRIVACY_REVIEW_UNAPPROVED` | Privacy review lacks approval evidence | Block real-user onboarding |
| `DATA_RIGHTS_DRILL_INCOMPLETE` | Data-rights drill lacks completion evidence | Block real-user readiness |
| `BACKUP_RESTORE_DRILL_INCOMPLETE` | Backup/restore drill lacks completion evidence | Block real-user readiness |
| `OPERATIONS_READINESS_INCOMPLETE` | Operations approval evidence is absent | Block real-user readiness |
| `DEPLOYMENT_SECURITY_UNAPPROVED` | Deployment security approval evidence is absent | Block real-user readiness |

Clients must branch on codes, not free text. `readyForRealUsers` is true only when demo mode is off and all seven external evidence flags are explicitly true. Flags and injected test policies only exercise the contract; they are not approval evidence and must not be promoted into production configuration without the governed records required by the product readiness attachment.

### Identity and onboarding API

The migration-backed slice exposes:

- `POST /api/v1/identity/invitations` and `POST /api/v1/identity/password/change` for invited accounts and mandatory first password change;
- `POST /api/v1/identity/sessions` for isolated `USER` or `STAFF` sessions;
- `POST /api/v1/identity/accounts/{id}/status` for `SYSTEM_ADMIN` lock/disable with immediate session revocation;
- consent acceptance and versioned withdrawal under `/api/v1/onboarding/consents`;
- versioned step drafts at `PUT /api/v1/onboarding/profile/steps/{step}`;
- trusted conclusion-only screening writes at `POST /api/v1/onboarding/screening-results`.

Every write requires `x-request-id` for correlation and `idempotency-key`; actor headers are not accepted as authority. Authenticated writes derive the account and role from the bearer session. Audit IDs are server-generated and distinct from request IDs. Failed login audits use a null actor ID with controlled `SYSTEM` role and identify only an account matched by the submitted login identifier.

`POST /api/v1/identity/invitations` requires a valid STAFF bearer session. Staff login requires an explicit `actingRole`; the server verifies that role against `iam.account_role` and binds it to immutable `iam.session.active_role`. Every later authorization and audit decision uses that session role rather than guessing from all roles held by the natural person. An `OPERATIONS` session can create only `USER` accounts without staff roles. A `SYSTEM_ADMIN` session can create only `STAFF` accounts and assign the five database-constrained staff roles. The same multi-role account may create separate sessions for each verified acting role, but cannot switch role within a session. Initial administrators are supplied by an external deployment/identity seed; there is no anonymous bootstrap route and invitation never records professional qualification.

Passwords use policy-configured scrypt. Initial password change is allowed only for an `INVITED` account whose initial-change flag remains true; locked or disabled accounts cannot be reactivated through that route. Session tokens are random, returned only in the first successful login response, and stored only as SHA-256 digests. The login idempotency result contains a non-secret projection; exact replay returns `LOGIN_REPLAY_REQUIRES_REAUTHENTICATION` and requires a new key rather than replaying the token.

Staff MFA is determined only by an injected server-side `MfaVerifier` and verified challenge. The login request has no `mfaVerified` field. When policy requires staff MFA and no verifier is configured, login fails closed. Staff initial password change also requires an explicit `actingRole` and validates it against the account's persisted roles before audit. The threshold, TTL, MFA requirement, and password parameters are injected approved-policy inputs, not hard-coded product decisions.

Identity/onboarding idempotency is scoped by operation, server-derived principal/role, and a request fingerprint built only from an explicit non-secret projection. Passwords, initial passwords, replacement passwords, session tokens, and MFA challenge identifiers are deliberately excluded from every persisted fingerprint. Invitation uses account identity/type/roles; login uses login identifier/session kind/validated acting role; initial password change uses account ID/expected version/validated acting role. Reusing a key across routes, principals, or different non-secret projections returns HTTP 409 with `IDEMPOTENCY_KEY_REUSED`. Reusing a key with only secret fields changed cannot create a second side effect. Concurrent exact requests create one side effect; initial password change safely replays its first non-secret result. Failed login attempts deliberately bypass idempotency so every HTTP attempt increments the configured counter. Reaching the threshold locks the account and revokes active sessions.

Every STAFF request reloads current database roles. If the role bound to `iam.session.active_role` has been revoked, the session is immediately revoked and authorization fails before business or idempotency writes. The rejection is append-only audited using the formerly verified account and session role.

Migration 007 adds structured audit `outcome` (`SUCCEEDED` or `REJECTED`) and stable `error_code`. Successful versioned identity/onboarding writes store available before/after version identifiers. Critical authentication and authorization failures store `REJECTED` with the stable error code; authenticated failures use the verified account and immutable session role, while unauthenticated failures use null actor ID plus controlled `SYSTEM`. Request IDs remain correlation values and never become audit primary keys.

Screening accepts only `PASS`, `HUMAN_REVIEW`, or `EXCLUDED`, from `PROFESSIONAL_RULE` or `MANUAL_REVIEW`. The server principal must hold `NUTRITION_REVIEWER` or `TRAINING_REVIEWER` and the corresponding `iam.account_role.qualified_at` must be non-null. Qualification is external seed/evidence data; this slice exposes no qualification approval API. Rejection creates no screening row. Screening contains no questions, client thresholds, or diagnosis.

### `GET /api/v1/demo/personas/{fixtureId}`

The endpoint exists only when `DEMO_MODE=true`, which is valid only in development or test environments. Supported fixture IDs are:

- `persona_fat_loss`, with `goalType: FAT_LOSS`
- `persona_muscle_gain`, with `goalType: MUSCLE_GAIN`

Response shape:

```json
{
  "fixtureId": "persona_fat_loss",
  "goalType": "FAT_LOSS",
  "demoOnly": true,
  "reviewStatus": "DEMO_UNREVIEWED",
  "publishable": false,
  "disclaimer": "仅用于原型演示，未经专业审核"
}
```

Unknown fixture IDs return HTTP 404 with structured fields:

```json
{
  "businessStatus": "DEMO_FIXTURE_NOT_FOUND",
  "errorCode": "DEMO_FIXTURE_NOT_FOUND",
  "recoverableActions": []
}
```

When `DEMO_MODE=false`, the entire demo route is absent and returns HTTP 404. There is no production identity-switch API.

### Plan lifecycle API

The Phase 2 testable slice exposes:

- `POST /api/v1/plan-versions` to create a draft with `id`, `userId`, `effectiveAt`, optional `effectiveTo`, and `contentMode`;
- `GET /api/v1/plan-versions/{id}` to read the latest in-memory state;
- `POST /api/v1/plan-versions/{id}/transitions` to apply a controlled lifecycle event;
- `GET /api/v1/users/{userId}/plans/current?at={instant}` to return `CURRENT_PLAN` or explicit `PLAN_GAP`;
- `GET /api/v1/users/{userId}/plans/history` to return newest-first read-only history.

Stable plan statuses are `DRAFT`, `IN_REVIEW`, `READY_TO_PUBLISH`, `PENDING_CONFIRMATION`, `SCHEDULED`, `ACTIVE`, `STAFF_REVISION_REQUIRED`, `USER_REVISION_REQUIRED`, `CONFIRMATION_TIMED_OUT`, and `SUPERSEDED`.

Transition types are `SUBMIT_REVIEW`, diet/training approval or review rejection, `PUBLISH`, diet/training confirmation or user rejection, `EXPIRE_CONFIRMATION`, `ACTIVATE`, and `SUPERSEDE`. Review rejection requires `actorId` and `reasonCode`; user rejection requires `occurredAt` and `reasonCode`; all time-driven transitions require `occurredAt`.

The API derives `confirmationDeadlineAt` as 20:00 China Standard Time on the day before the effective date. Publication later than 24 hours before that deadline is rejected. A fully confirmed `SCHEDULED` version is promoted through the same guarded `ACTIVATE` event when the current-plan read observes that its effective time has arrived.

Stable conflict codes include:

| Code | Meaning | Typical recovery |
| --- | --- | --- |
| `PROFESSIONAL_RULES_UNAPPROVED` | Professional inputs have not been approved | `WAIT_FOR_PROFESSIONAL_APPROVAL` |
| `DEMO_CONTENT_REFERENCED` | Demo/unreviewed content was referenced | `REPLACE_WITH_REVIEWED_CONTENT` |
| `SINGLE_PENDING_VERSION_REQUIRED` | The user already has a pending or scheduled version | `WAIT_FOR_EXISTING_VERSION`, `OPEN_PLAN_HISTORY` |
| `PUBLICATION_LEAD_TIME_INSUFFICIENT` | Publication missed the 24-hour lead time | `CREATE_NEW_VERSION` |
| `CONFIRMATION_DEADLINE_PASSED` | Confirmation was attempted at or after cutoff | `CREATE_NEW_VERSION` |
| `EFFECTIVE_TIME_NOT_REACHED` | Activation was attempted before the effective instant | `WAIT_FOR_EFFECTIVE_TIME` |
| `STATE_TRANSITION_NOT_ALLOWED` | The event is invalid from the current state | `REFRESH`, `OPEN_PLAN_HISTORY` |

The Phase 2 API repository is process-local and in-memory. It exists for deterministic UI integration and automated acceptance only; restart loses its records. It is not the production persistence implementation.

Phase 3 adds `packages/database/src/plan-repository.ts` as a tested PGlite/Postgres-compatible persistence adapter. It currently remains adapter-only: the Phase 2 HTTP service is not silently switched to persistence until transaction boundaries, authorization context, and migration-backed integration tests are completed. The adapter provides `recordVersion` optimistic concurrency, idempotency replay, and append-only audit insertion; it does not authorize actors or approve professional content.

## OpenAPI

The machine-readable contract is served at `GET /openapi.json`; Swagger UI is at `GET /docs`. The document includes bearer security for authenticated identity/onboarding paths, only the correlation/idempotency write headers, request shapes without client-asserted MFA, stable security errors, all eight readiness blockers, fixture, goal, review, plan status, transition, current/gap, and conflict enums. It contains no secret examples or professional placeholder values.

## Domain And Database Guarantees

- Five staff role codes are stable: `OPERATIONS`, `NUTRITION_REVIEWER`, `TRAINING_REVIEWER`, `SYSTEM_ADMIN`, and `AUDIT_VIEWER`.
- A plan version cannot reach pending confirmation without both professional approvals.
- Diet and training confirmations are independent; rejection returns the whole version for revision.
- Only one pending or scheduled plan version per user is permitted.
- Confirmation deadlines and explicit old-plan gaps are represented.
- Publication is at least 24 hours before the CST confirmation cutoff.
- Versions confirmed in both parts become scheduled and are activated no earlier than `effectiveAt`.
- Published payload and schedule-defining fields cannot be edited in place; a new version is required.
- Real publication is blocked when professional rules are unapproved or referenced content is demo/unreviewed.
- SQL migrations contain no professional seed data.

These guarantees are currently covered by domain and migration tests. The full profile, risk review, work queue, plan authoring, record, weekly feedback, authentication, and audit HTTP resources remain future slices.

## UI Integration Rules

- Use `fixtureId` only as demo fixture identity; do not treat it as a production user ID.
- Derive the goal route from `goalType`; do not hard-code a single route.
- Treat `demoOnly`, `reviewStatus`, and `publishable` as mandatory publication safeguards.
- Display the exact disclaimer on every screen containing this demo content.
- Use readiness and error codes for state selection; do not parse prose.
- Deep links should carry only a target identifier and fetch the latest plan version or current state when opened.

## Deferred Release Inputs

The following remain outside this implementation and continue to block real-user testing or production deployment as applicable:

- professional sign-off for screening, risk, nutrition, training, and weekly-adjustment rules;
- production approval evidence for authentication parameters, external initial-administrator seed, MFA verifier integration, and password recovery;
- data export/deletion operations and completed data-rights drill evidence;
- deployment region, budget, secret management, backup target, and monitoring integration;
- CI repository policy and protected release workflow;
- a production real-user route guard across identity/onboarding/plans; this is a separate cross-module task, and the current main composition remains fail-closed because its authentication policy is null by default;
- the remaining PRD HTTP resources and end-to-end acceptance flows.
