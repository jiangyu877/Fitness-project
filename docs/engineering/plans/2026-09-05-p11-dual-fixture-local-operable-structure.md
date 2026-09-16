# P11 Dual Fixture Local Operable Structure Execution Evidence

Date: 2026-09-05
Scene: `P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE`
Status: closed for the named test-only slice after independent Sol Critical review.

## Scope

This evidence covers only the local test-only path for the fictional
`persona_fat_loss` and `persona_muscle_gain` fixtures. It proves generic
schema-driven context reading, one record write per fixture, authoritative
reread, and subject isolation through an isolated PostgreSQL 18 database.

It does not define diet states, training sets, backfill, deviation, pain, or
other professional semantics. It does not authorize staging, production, real
users, G2, G3, release, or `readyForRealUsers=true`.

## Fresh Evidence

| Layer | Command or observation | Result |
| --- | --- | --- |
| `PG18_REPOSITORY + CROSS_LAYER_E2E` | `npx --no-install vitest run apps/api/test/p11-local-operable-runtime.spec.ts --maxWorkers=1 --minWorkers=1` with loopback PG18 admin URL | `1 file / 5 tests passed`; includes two fixtures, independent writes and rereads, shutdown, missing-task 404, and cross-subject 404 |
| `UI_STATE` | P11 client/state/page/selector focused files | `4 files / 43 tests passed`; includes strict response task binding, blocked-draft restoration, submitted-schema binding, and duplicate manifest locator rejection |
| Launcher lifecycle | `npx --no-install vitest run apps/api/test/p11-local-launcher.spec.ts --maxWorkers=1 --minWorkers=1` | `1 file / 7 tests passed`; covers missing admin URL rejection, readiness timeout, shutdown while awaiting readiness, operator signal classification, API cleanup failure propagation, Windows child isolation, and bounded loopback fetches |
| Workspace type/build | `npm run typecheck`; `npm run build` | both exited 0 across API, Web, database, and domain workspaces; the production Web build transformed 1614 modules |
| Production exclusion | `npm run test:production-bundle --workspace=@lianban/web` | exited 0; local runtime identifiers were absent from the production bundle |
| Diff integrity | `git diff --check` | exited 0; line-ending conversion warnings do not represent diff errors |
| `BROWSER` | Codex in-app browser, 1280 x 720, DPR 1, at the loopback Vite URL | final retained captures show muscle-gain `RECORD_CONTEXT_REFRESHED` with `artifact-muscle-entry`, then fat-loss reread with record count `1` and only `artifact-fat-entry`; this is browser interaction evidence, not Edge/Narrator or P19 accessibility evidence |
| Runtime cleanup | send Ctrl+C to the real `npm run dev:p11-local` PTY after both readiness lines | the outer npm/PowerShell wrapper returned 1 but no `P11_LOCAL_WEB_EXIT_*` was emitted; ports 3100/5175 stopped and `lianban_p11_local_*` returned to 0 because the detached API child completed cleanup |

The final browser captures are retained at
[`../evidence/p11-local-operable-fat-reread-2026-09-05.png`](../evidence/p11-local-operable-fat-reread-2026-09-05.png)
and
[`../evidence/p11-local-operable-muscle-reread-2026-09-05.png`](../evidence/p11-local-operable-muscle-reread-2026-09-05.png).
The fat-loss reread shows task `p11-local-task-fat-loss`, schema `schema-v1`,
access `EDITABLE`, record count `1`, and `artifact-fat-entry`; it contains no
`artifact-muscle-entry`. The muscle-gain submit capture shows the distinct task,
record count `1`, `artifact-muscle-entry`, and `RECORD_CONTEXT_REFRESHED`.

## Full Regression

The first `npm test` attempt stopped with a Node/Vitest worker
`Fatal process out of memory`, so it did not produce a valid suite result.
The final reduced-worker rerun used the dedicated loopback PG18 administrator
URL on port 5433 for both PostgreSQL environment variables:

`npm test -- --maxWorkers=1 --minWorkers=1`

Result: `66 files`, `65 passed / 1 failed`; `806 tests`, `797 passed / 9
failed`. All nine failures are in
`apps/api/test/plan-lifecycle.e2e.spec.ts`. That file fixes its publication,
deadline, and effective windows in July/August 2026 while the database trusted
time is 2026-09-05 for tests that do not inject a plan clock. Eight cases
therefore receive 409 during shared publication setup, and the bypassed-current
case reads two already-expired ACTIVE rows as no longer overlapping.

The nine lifecycle failures are outside this single P11 local-operable scene
and remain an explicit repository-level regression blocker. They are not
silently reclassified as passing.

An earlier interrupted run against the shared port 5432 left one strictly
named generated database, which was identified and removed. The final isolated
port-5433 full run automatically left no `lianban_%` databases; that empty query
was verified before the temporary PG18 cluster stopped.

## Review Gate

The first final-review pass returned `REJECT` with five Important findings.
The same named slice then added focused RED -> GREEN coverage and repaired all
five: blocked writes restore the authoritative draft; rereads bind task,
submitted schema, response schema, version, kind, and entries; launcher startup
has a timeout and shutdown escape; every readiness/shutdown fetch has a bounded
deadline; API cleanup exit failures propagate; Windows console delivery is
isolated from the API child; and the manifest rejects duplicate account, task,
or session locators. The client-side
taskId response binding is part of this same fail-closed correction and is
covered by the fresh client `9/9` result.

The scoped independent Sol Critical re-review found 0 Critical, 0 Important,
and 0 Minor issues and concluded:

`GREEN / ALLOW — P11_DUAL_FIXTURE_LOCAL_OPERABLE_STRUCTURE_REVIEW_COMPLETE`

Final read-only boundary reviews concluded `QA_CLEAR`, `UI_CLEAR`,
`LOCAL_SLICE_CLEAR`, `SECURITY_NO_OBJECTION`, and `PROFESSIONAL_CLEAR` for this
named local test-only slice. Operations remains `OPERATIONS_BLOCKED` for
production, staging, real users, G2/G3, and release. These reviewers did not
rerun tests or access PostgreSQL; they reviewed the fresh evidence above and
the retained browser artifacts.

This closes only the named test-only slice and does not authorize another
scene.
