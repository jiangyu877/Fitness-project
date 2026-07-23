# Phase 1 Stable Contract

Version: 0.1.0
Date: 2026-07-23
Owner: R&D
Status: Implemented engineering baseline; not approved for real-user service

## Scope

This contract is the stable integration surface available to UI during Phase 1. It does not replace `docs/product/lianban-v1.0-prd.md` and does not claim that the full V1.0 business API exists.

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

## OpenAPI

The machine-readable contract is served at `GET /openapi.json`; Swagger UI is at `GET /docs`. The document includes the stable fixture, goal, review, and readiness enums. It contains no authentication secrets or professional placeholder values.

## Domain And Database Guarantees

- Five staff role codes are stable: `OPERATIONS`, `NUTRITION_REVIEWER`, `TRAINING_REVIEWER`, `SYSTEM_ADMIN`, and `AUDIT_VIEWER`.
- A plan version cannot reach pending confirmation without both professional approvals.
- Diet and training confirmations are independent; rejection returns the whole version for revision.
- Only one pending or scheduled plan version per user is permitted.
- Confirmation deadlines and explicit old-plan gaps are represented.
- Real publication is blocked when professional rules are unapproved or referenced content is demo/unreviewed.
- SQL migrations contain no professional seed data.

These guarantees are currently covered by domain and migration tests. The full profile, risk review, work queue, plan authoring, record, weekly feedback, authentication, and audit HTTP resources remain future slices.

## UI Integration Rules

- Use `fixtureId` only as demo fixture identity; do not treat it as a production user ID.
- Derive the goal route from `goalType`; do not hard-code a single route.
- Treat `demoOnly`, `reviewStatus`, and `publishable` as mandatory publication safeguards.
- Display the exact disclaimer on every screen containing this demo content.
- Use readiness and error codes for state selection; do not parse prose.
- Deep links should carry only a target identifier and fetch current state when opened; that target API is not part of this slice yet.

## Deferred Release Inputs

The following remain outside this implementation and continue to block real-user testing or production deployment as applicable:

- professional sign-off for screening, risk, nutrition, training, and weekly-adjustment rules;
- production authentication parameters and credential lifecycle controls;
- deployment region, budget, secret management, backup target, and monitoring integration;
- CI repository policy and protected release workflow;
- the remaining PRD HTTP resources and end-to-end acceptance flows.
