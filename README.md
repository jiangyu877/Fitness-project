# Lianban Engineering Baseline

This repository contains the Phase 1 engineering baseline for the Lianban closed beta. The current implementation provides environment validation, a local PostgreSQL-compatible database, core plan lifecycle safeguards, a small HTTP contract, and protected demo persona metadata.

It is not ready for real users. Professional screening, risk, nutrition, training, and weekly-adjustment rules remain unsigned. The API reports `PROFESSIONAL_RULES_UNAPPROVED`, and demo content is never publishable.

## Prerequisites

- Node.js 24 or later
- npm 11 or later

## Local Setup

```powershell
npm install
Copy-Item .env.example .env
$env:NODE_ENV='development'
$env:PORT='3000'
$env:DATABASE_PATH='.local/lianban-data'
$env:DEMO_MODE='true'
$env:PROFESSIONAL_RULES_APPROVED='false'
npm run db:migrate
npm run dev
```

The Phase 1 endpoints are:

- `GET http://localhost:3000/health`
- `GET http://localhost:3000/api/v1/readiness`
- `GET http://localhost:3000/api/v1/demo/personas/persona_fat_loss`
- `GET http://localhost:3000/api/v1/demo/personas/persona_muscle_gain`
- `GET http://localhost:3000/openapi.json`
- `GET http://localhost:3000/docs`

Demo routes are not registered when `DEMO_MODE=false`. Demo responses always carry the unreviewed-demo disclaimer and cannot be published.

## P11 Local Test-Only Runtime

With a local PostgreSQL 18 administrator database listening on loopback, the
schema-driven dual-fixture record path can be exercised in the browser:

```powershell
$env:P11_LOCAL_POSTGRES_ADMIN_URL='postgresql://postgres@127.0.0.1:5433/postgres'
npm run dev:p11-local
```

Open `http://127.0.0.1:5175/h5/p11-local`. The runtime uses only fictional
`persona_fat_loss` and `persona_muscle_gain` sessions and drops its temporary
database when it shuts down. This test-only path does not enable production,
staging, real-user data, G2, G3, or `readyForRealUsers=true`.

## Verification

```powershell
npm test
npm run typecheck
npm run build
$env:DATABASE_PATH='.local/lianban-data'
npm run db:migrate
```

The stable Phase 1 response contract is documented in `docs/engineering/contracts/phase-1-stable-contract.md`.
