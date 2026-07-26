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

The readiness contract exposes thirteen blockers: eight product/release evidence blockers in the table below, plus five technical dependencies (`AUTH_POLICY_PROVIDER_UNAVAILABLE`, `AUTH_SECURITY_POLICY_INVALID`, `MFA_VERIFIER_UNAVAILABLE`, `HMAC_KEY_UNAVAILABLE`, and `CURRENT_CONSENT_VERSION_UNAVAILABLE`). Before a REAL_USER snapshot is derived, the authentication policy is validated and pinned against all domain invariants; a present but invalid policy is distinct from a missing provider and keeps every protected route closed. Provider availability and structural validity are necessary but are not product approval evidence.

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

- `POST /api/v1/identity/invitations`, `POST /api/v1/identity/sessions`, and bearer-bound `POST /api/v1/identity/password/change` for invited-user recovery;
- `GET /api/v1/identity/session` for complete USER-session recovery and `POST /api/v1/identity/session/logout` for idempotent revocation;
- `POST /api/v1/identity/accounts/{id}/status` for `SYSTEM_ADMIN` lock/disable with immediate session revocation;
- consent acceptance and versioned withdrawal under `/api/v1/onboarding/consents`;
- versioned step drafts at `PUT /api/v1/onboarding/profile/steps/{step}`;
- trusted conclusion-only screening writes at `POST /api/v1/onboarding/screening-results`.

Every write requires `x-request-id` for correlation and `idempotency-key`; actor headers are not accepted as authority. Authenticated writes derive the account and role from the bearer session. Audit IDs are server-generated and distinct from request IDs. Failed login audits use a null actor ID with controlled `SYSTEM` role and identify only an account matched by the submitted login identifier.

`POST /api/v1/identity/invitations` requires a valid STAFF bearer session. Staff login requires an explicit `actingRole`; the server verifies that role against `iam.account_role` and binds it to immutable `iam.session.active_role`. Every later authorization and audit decision uses that session role rather than guessing from all roles held by the natural person. An `OPERATIONS` session can create only `USER` accounts without staff roles. A `SYSTEM_ADMIN` session can create only `STAFF` accounts and assign the five database-constrained staff roles. The same multi-role account may create separate sessions for each verified acting role, but cannot switch role within a session. Initial administrators are supplied by an external deployment/identity seed; there is no anonymous bootstrap route and invitation never records professional qualification.

Passwords use policy-configured scrypt. A valid `INVITED` USER login returns only `PASSWORD_CHANGE_REQUIRED`, a short-lived one-time `passwordChangeToken`, `expectedVersion`, expiry, and `CHANGE_INITIAL_PASSWORD`; it never creates a complete business session. `POST /identity/password/change` accepts only `Authorization: Bearer <passwordChangeToken>` and `{newPassword, expectedVersion}`. It never accepts account identity, old password, or acting role from the client. Its transaction first conditionally revokes the restricted context, then activates the account and creates one complete USER session. Replayed, expired, consumed, stale-version, locked, or disabled contexts fail closed without a duplicate session. Session credentials are random, returned only in the first successful response, and stored only as SHA-256 digests.

The domain validator also enforces implementation executability before a REAL_USER snapshot is derived. It uses safe-integer and BigInt arithmetic to bound Node scrypt memory and CPU work (`N*r*p`), applies an explicit parallelization ceiling, and makes hashing and verification use the same validation and 64 MiB `maxmem`. These are technical denial-of-service and runtime-safety ceilings only; they do not approve any product password, TTL, work-factor, or MFA parameter. Those values still require the governed product/security approval evidence described below.

`GET /identity/session` accepts only a complete USER bearer session and returns `accountId`, `accountType`, its single `activeRole`, expiry, `SESSION_ACTIVE`, and the server-derived `nextAction`; it never returns every account role. For this slice, an unaccepted current consent returns `ACCEPT_CURRENT_CONSENT`; accepted consent with unapproved professional screening rules returns `WAIT_FOR_SCREENING_RULES`; unknown remaining state returns `CONTACT_OPERATIONS`. Restricted password-change contexts cannot call consent, profile, plans, recovery, or other complete-session paths. `POST /identity/session/logout` revokes the matching complete session once and returns `SESSION_ENDED` on repeated requests; a later recovery is rejected.

Staff MFA is determined only by an injected server-side `MfaVerifier` and verified challenge. The login request has no `mfaVerified` field. When policy requires staff MFA and no verifier is configured, login fails closed. Staff initial password change also requires an explicit `actingRole` and validates it against the account's persisted roles before audit. The threshold, TTL, MFA requirement, and password parameters are injected approved-policy inputs, not hard-coded product decisions.

Identity/onboarding idempotency is scoped by operation and server-derived principal/context, with a fingerprint built only from an explicit non-secret projection. Passwords, initial passwords, replacement passwords, session tokens, and MFA challenge identifiers are deliberately excluded from every persisted fingerprint. Invitation uses account identity/type/roles; complete login uses login identifier/session kind/validated acting role; restricted login uses identifier/session kind; bearer-bound password change uses only expected version and the server-held restricted-session identity. Reusing a key across routes, principals, or different non-secret projections returns HTTP 409 with `IDEMPOTENCY_KEY_REUSED`. A consumed password-change context returns `PASSWORD_CHANGE_TOKEN_INVALID` rather than replaying a session token. Failed login attempts deliberately bypass idempotency so every HTTP attempt increments the configured counter. Reaching the threshold locks the account and revokes active sessions.

Profile-step idempotency persists an opaque, keyed digest over the explicit `{step, expectedVersion, data}` request projection. It distinguishes changed drafts for the same key without retaining enumerable profile values or sensitive fields in the idempotency record. Incorrect initial-password credentials count as failed credentials for an invited account, lock at the policy threshold, revoke any sessions, and append a `REJECTED` audit with the stable error code.

Every STAFF request reloads current database roles. If the role bound to `iam.session.active_role` has been revoked, the session is immediately revoked and authorization fails before business or idempotency writes. The rejection is append-only audited using the formerly verified account and session role.

Every session-backed write first requires the approved authentication policy. Invalid, expired, revoked, locked, disabled, or session-kind-mismatched bearer credentials fail closed with `SESSION_INVALID`, preserve the request ID in the response, and append a structured rejection audit. If staff MFA changes from optional to required, an existing unverified STAFF session is revoked and rejected with `MFA_REQUIRED`. A matched but no-longer-usable session uses its verified account and bound role where available; an unknown bearer uses the controlled `SYSTEM` actor.

Migration 007 adds structured audit `outcome` (`SUCCEEDED` or `REJECTED`) and stable `error_code`; migration 008 adds `iam.session.session_scope` (`FULL` or `PASSWORD_CHANGE`) to distinguish restricted contexts from complete sessions without changing released migrations. Successful versioned identity/onboarding writes store available before/after version identifiers. Critical authentication and authorization failures store `REJECTED` with the stable error code. This currently covers anonymous or role-revoked sessions, invitation and account-status role denial, verified session-kind mismatch, missing/ungranted staff acting roles, MFA rejection, reviewer qualification rejection, failed login/lockout, and password-change context rejection. A denial from an established session uses the verified account and immutable session role. A verified credential without a valid current role uses the verified account plus controlled `SYSTEM`; it never guesses one of the account's roles. Unauthenticated failures use null actor ID plus controlled `SYSTEM`. Request IDs remain correlation values and never become audit primary keys, and each handled rejection produces at most one rejection audit.

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
- `GET /api/v1/plan-versions/{id}` to read the latest persisted state;
- `POST /api/v1/plan-versions/{id}/transitions` to apply a controlled lifecycle event;
- `GET /api/v1/users/{userId}/plans/current` to return `CURRENT_PLAN` or explicit `PLAN_GAP`;
- `GET /api/v1/users/{userId}/plans/history` to return newest-first read-only history;
- `GET /api/v1/users/{userId}/plans/pending` to return the target USER's unique pending/scheduled summary or explicit `NO_PENDING_PLAN`.
- `GET /api/v1/users/{userId}/task-candidates` to expose the trusted task-generation admission boundary. It is USER-session scoped, read-only, and returns only `businessStatus`, `planVersion`, and an always-empty `items` array until professional task content is separately approved.

The pending summary is restricted to the target user's own trusted USER session. Its `plan` contains only `version`, `status`, `effectiveAt`, `confirmationDeadlineAt`, `dietConfirmation`, `trainingConfirmation`, and `allowedActions`; it never exposes drafts, reviewer identities, review decisions, authorship, or professional content. `businessStatus` is `PLAN_PENDING_CONFIRMATION`, `PLAN_WAITING_EFFECTIVE`, or `NO_PENDING_PLAN`. Confirmation values are `PENDING` or `CONFIRMED`; allowed actions are selected from `CONFIRM_DIET`, `REJECT_DIET`, `CONFIRM_TRAINING`, and `REJECT_TRAINING` and are empty for `SCHEDULED`.

The task-candidate boundary calls the same trusted-time, unique-`ACTIVE`, finite-window guard as current-plan resolution. An in-window `ACTIVE` version returns `TASK_GENERATION_ALLOWED` with its `planVersion`; a pending, scheduled, rejected, timed-out, superseded, future, expired, gap, or ambiguous multi-`ACTIVE` state returns `PLAN_GAP` with `planVersion: null`. Both responses contain `items: []`, perform no task or business writes, and contain no professional prescription content.

Stable plan statuses are `DRAFT`, `IN_REVIEW`, `READY_TO_PUBLISH`, `PENDING_CONFIRMATION`, `SCHEDULED`, `ACTIVE`, `STAFF_REVISION_REQUIRED`, `USER_REVISION_REQUIRED`, `CONFIRMATION_TIMED_OUT`, and `SUPERSEDED`.

Public transition types are `SUBMIT_REVIEW`, diet/training approval or review rejection, `PUBLISH`, diet/training confirmation or user rejection, `EXPIRE_CONFIRMATION`, and `ACTIVATE`. `SUPERSEDE` is internal to the atomic `ACTIVATE` transaction and is never a public command. Reviewer identity is always derived from the trusted session; review rejection requires a controlled staff-side `reasonCode`. USER confirmation and rejection never accept an actor ID, lifecycle timestamp, or a user-authored reason.

`REJECT_DIET_REVIEW` and `REJECT_TRAINING_REVIEW` require a non-empty opaque staff `reasonCode`; no product or professional taxonomy is implied. Every other transition action rejects `reasonCode` as an undefined field. Missing or blank `x-request-id` or `idempotency-key` is rejected before authentication and business execution with HTTP 422 `REQUEST_INVALID` / `REQUEST_HEADER_REQUIRED` and `['FIX_REQUEST']`.

#### USER confirmation and rejection writes

All four USER actions use `POST /api/v1/plan-versions/{id}/transitions` with `Authorization: Bearer <USER session>`, non-empty `x-request-id`, non-empty `idempotency-key`, and `Content-Type: application/json`. The bearer account must own the plan version. Bodies are exactly:

```json
{ "type": "CONFIRM_DIET" }
{ "type": "CONFIRM_TRAINING" }
{ "type": "REJECT_DIET" }
{ "type": "REJECT_TRAINING" }
```

There is no product-approved rejection-reason taxonomy. The UI therefore sends no `reasonCode`; after the user chooses to reject the whole version, the backend records only the stable generic workflow code `USER_REJECTED_PLAN`. It conveys no nutrition, training, health, schedule, or motivation semantics and must not be presented as such.

HTTP 200 is role-filtered. USER responses contain only `id`, `version`, `status`, `confirmationDeadlineAt`, `effectiveAt`, `effectiveTo`, `publishedAt`, `confirmationTimedOutAt`, the generic `rejectionReasonCode`, `dietConfirmation`, `trainingConfirmation`, and `allowedActions`. They never contain reviewer IDs, review decisions, authorship, drafts, or professional content. Authorized staff responses retain the internal plan-version fields. UI state should still be refreshed from the USER-scoped pending summary after a write.

The pending summary's `allowedActions` is the authoritative USER command set. Each advertised value maps directly to the same-named transition `type`. Once a part is confirmed, neither confirming nor rejecting that same part is accepted with a new idempotency key; the API returns `PLAN_PART_ALREADY_DECIDED`. A same-key, same-principal, same-body replay returns the original success response and creates no additional state change or audit event.

The API does not accept a client `expectedStatus` or storage `recordVersion`. Staleness is enforced server-side: a concurrent optimistic-write race returns HTTP 409 `PLAN_VERSION_CONFLICT` / `VERSION_CONFLICT` with `['REFRESH']`; an action against an already closed lifecycle state returns HTTP 409 `PLAN_TRANSITION_BLOCKED` / `STATE_TRANSITION_NOT_ALLOWED` with `['REFRESH','OPEN_PLAN_HISTORY']`. Reusing an idempotency key with a different action, principal, or body returns HTTP 409 `PLAN_VERSION_CONFLICT` / `IDEMPOTENCY_KEY_REUSED` with `['USE_NEW_IDEMPOTENCY_KEY']`.

At or after the confirmation deadline, confirmation returns HTTP 409 `CONFIRMATION_CLOSED` / `CONFIRMATION_DEADLINE_PASSED` with `['CREATE_NEW_VERSION']` after atomically persisting `CONFIRMATION_TIMED_OUT`; exact replay and a new idempotency key both preserve the same closed response without another state change or audit row. Authentication failures return HTTP 401 stable session errors. A USER transition targeting another user's existing version and one targeting an absent version both return the same HTTP 404 `PLAN_VERSION_NOT_FOUND` structure. The unified readiness guard returns HTTP 503 before business execution.

The API derives `confirmationDeadlineAt` as 20:00 China Standard Time on the day before the effective date. Publication later than 24 hours before that deadline is rejected. Every published or active version requires a finite `effectiveTo` and `effectiveAt < effectiveTo`; drafts may omit `effectiveTo`. Lifecycle timestamps come only from the trusted service/database transaction clock. Current-plan reads are pure and require exactly one `ACTIVE` version satisfying `effectiveAt <= trustedNow < effectiveTo`; zero matches returns `PLAN_GAP`, while multiple matches fail closed as `PLAN_STATE_INVALID` / `MULTIPLE_ACTIVE_PLAN_VERSIONS`. `ACTIVATE` atomically supersedes the previous active version and saves its end as `min(originalEffectiveTo, activationTrustedTime)`, so an expired plan is never extended.

An injected lifecycle clock is accepted only when `nodeEnv=test`. Production and other non-test application composition ignores that option, leaving publication, confirmation, timeout, activation, replacement, current-plan, and task-candidate authorization on the database clock.

Stable conflict codes include:

| Code | Meaning | Typical recovery |
| --- | --- | --- |
| `PROFESSIONAL_RULES_UNAPPROVED` | Professional inputs have not been approved | `WAIT_FOR_PROFESSIONAL_APPROVAL` |
| `DEMO_CONTENT_REFERENCED` | Demo/unreviewed content was referenced | `REPLACE_WITH_REVIEWED_CONTENT` |
| `SINGLE_PENDING_VERSION_REQUIRED` | The user already has a pending or scheduled version | `WAIT_FOR_EXISTING_VERSION`, `OPEN_PLAN_HISTORY` |
| `PUBLICATION_LEAD_TIME_INSUFFICIENT` | Publication missed the 24-hour lead time | `CREATE_NEW_VERSION` |
| `CONFIRMATION_DEADLINE_PASSED` | Confirmation was attempted at or after cutoff | `CREATE_NEW_VERSION` |
| `CONFIRMATION_DEADLINE_NOT_REACHED` | Trusted expiry was requested before cutoff | `CREATE_NEW_VERSION` |
| `EFFECTIVE_TIME_NOT_REACHED` | Activation was attempted before the effective instant | `WAIT_FOR_EFFECTIVE_TIME` |
| `EFFECTIVE_TO_REQUIRED` | Publication lacks a finite execution end | `CREATE_NEW_VERSION` |
| `INVALID_EFFECTIVE_WINDOW` | `effectiveAt` is not earlier than `effectiveTo` | `CREATE_NEW_VERSION` |
| `PLAN_VERSION_ALREADY_EXISTS` | The requested immutable version ID already exists | `REFRESH` |
| `MULTIPLE_ACTIVE_PLAN_VERSIONS` | Persisted ACTIVE state is ambiguous | `CONTACT_SUPPORT` |
| `STATE_TRANSITION_NOT_ALLOWED` | The event is invalid from the current state | `REFRESH`, `OPEN_PLAN_HISTORY` |

The HTTP lifecycle uses the PGlite/Postgres-compatible repository as its source of truth. Accepted writes claim an idempotency record scoped by principal plus subject plan/version ID, mutate the version under optimistic concurrency, and append exactly one structured success audit in one transaction. Target existence and authorization are checked before replay. Same-scope same-fingerprint replay returns the original response without another state change or audit; changed operation, principal, subject, or fingerprint is rejected without returning another subject's response. Audit event IDs are independent UUIDs; `x-request-id` is correlation only.

All plan write routes require an approved authentication policy plus a trusted bearer session and correlation/idempotency headers. Draft creation, submission, publication, timeout, and activation require the bound `OPERATIONS` role; supersession has no independent public route. Diet review requires `NUTRITION_REVIEWER`; training review requires `TRAINING_REVIEWER`; user confirmations and rejections require the target user's own `USER` session. Review actor IDs are derived from the session and request-body `actorId` is not accepted. The persisted lifecycle records the server-derived draft author and rejects diet or training review by that same natural person, including when they select a separate active role in another session.

All plan reads authenticate before a version is looked up. A user requesting another user's plan detail receives the same `PLAN_VERSION_NOT_FOUND` response as for an absent version; it cannot distinguish an unreadable version from an absent one. Current and history reads authorize the requested user scope before resolving plan state.

`packages/database/src/plan-repository.ts` is the HTTP service's persistence adapter. Authorization and professional publication checks remain in trusted application/domain layers before the transaction; the adapter enforces record versions, database uniqueness, scoped idempotency, atomic state/audit writes, and pure reads.

## OpenAPI

The machine-readable contract is served at `GET /openapi.json`; Swagger UI is at `GET /docs`. The document includes bearer security for authenticated identity/onboarding paths, only the correlation/idempotency write headers, request shapes without client-asserted MFA, stable security errors, all thirteen readiness blockers (eight product/release evidence blockers plus five technical dependencies), fixture, goal, review, plan status, transition, current/gap, and conflict enums. It contains no secret examples or professional placeholder values.

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
- Restore `GET /api/v1/identity/session` first and use its trusted `accountId`; then request `GET /api/v1/users/{accountId}/plans/pending`. Never derive or hard-code a user ID in the client.

## Deferred Release Inputs

The following remain outside this implementation and continue to block real-user testing or production deployment as applicable:

- professional sign-off for screening, risk, nutrition, training, and weekly-adjustment rules;
- production approval evidence for authentication parameters, external initial-administrator seed, MFA verifier integration, and password recovery;
- data export/deletion operations and completed data-rights drill evidence;
- deployment region, budget, secret management, backup target, and monitoring integration;
- CI repository policy and protected release workflow;
- a unified immutable route-access snapshot guards every non-public `/api/v1` route. Only health, readiness, and the separately controlled demo surface are public; unknown business routes fail closed, record a structured rejection audit, and cannot perform business writes. A REAL_USER snapshot is derived at startup from the environment and actual approved policy, MFA, HMAC, and pinned non-empty current-consent providers; only `nodeEnv=test` may inject a TEST-audience branch fixture, which is not approval evidence;
- the remaining PRD HTTP resources and end-to-end acceptance flows.
