# Phase 1 And 2 Stable Contract

Version: 0.2.0
Date: 2026-07-23
Owner: R&D
Status: Implemented testable engineering slices; not approved for real-user service

## Scope

This contract is the stable integration surface available to UI through Phase 2. It does not replace `docs/product/lianban-v1.0-prd.md` and does not claim that the full V1.0 business API exists.

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
  "blockers": ["PROFESSIONAL_RULES_UNAPPROVED"]
}
```

Stable blocker in this slice:

| Code | Meaning | UI behavior |
| --- | --- | --- |
| `PROFESSIONAL_RULES_UNAPPROVED` | Required professional inputs have not been approved | Block real-user publication and show the controlled unavailable state |

Clients must branch on codes, not free text. An empty `blockers` array is only a technical representation; product release gates and operational approvals still apply independently.

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

The machine-readable contract is served at `GET /openapi.json`; Swagger UI is at `GET /docs`. The document includes stable fixture, goal, review, readiness, plan status, transition, current/gap, and conflict enums. It contains no authentication secrets or professional placeholder values.

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
- production authentication parameters and credential lifecycle controls;
- deployment region, budget, secret management, backup target, and monitoring integration;
- CI repository policy and protected release workflow;
- the remaining PRD HTTP resources and end-to-end acceptance flows.
