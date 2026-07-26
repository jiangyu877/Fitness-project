# P07 Safe Structure UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This batch is explicitly uncommitted: do not stage or commit.

**Goal:** Connect the real USER P07 consent, server waiting states, and approved profile-draft schema to the frozen backend contract without embedding professional or privacy content in the client.

**Architecture:** Extend the existing trusted identity-session boundary with a dedicated typed P07 client and real H5 pages. Every request uses the restored USER bearer token and server-returned `accountId`; response parsers accept only the frozen machine schema, and all unknown or malformed results fail closed to contact operations. Static phase3 demo components remain isolated from real P07 routes.

**Tech Stack:** React 19, React Router, TypeScript, Vitest, Testing Library, Vite.

---

### Task 1: Freeze the UI Consumption Boundary

**Files:**
- Create: `docs/ui/contracts/2026-07-26-p07-safe-structure-ui-consumption.md`
- Read only: `docs/product/lianban-v1.0-prd.md`
- Read only: `docs/product/lianban-v1.0-identity-recovery-acceptance.md`
- Read only: `docs/product/lianban-v1.0-p07-safe-structure-acceptance.md`
- Read only: the R&D frozen OpenAPI/controller contract under `apps/api/**` and `docs/engineering/**`

- [ ] **Step 1: Read the complete product sources and machine contract**

Record only exact endpoint paths, request bodies, response discriminators, allowed recovery actions, and schema identifiers that exist in the current tree.

- [ ] **Step 2: Write the UI consumption contract**

Document these fixed UI rules:

```markdown
- Identity and subject come only from the restored USER session.
- Consent content is rendered only from the current server response.
- The client sends only fields present in the frozen request schema.
- Screening questions, screening conclusions, profile fields, and nextAction are never invented locally.
- RETRY and REFRESH controls require the same named server recoverableAction.
- Unknown or malformed results route to CONTACT_OPERATIONS.
```

- [ ] **Step 3: Stop at a safe boundary if the machine contract is incomplete**

If any required endpoint or schema is absent, implement only typed client interfaces, failing contract tests, and an explicit blocked state. Do not derive fields from demo fixtures or URL parameters.

### Task 2: Typed P07 Client

**Files:**
- Create: `apps/web/src/features/p07-real/p07-client.ts`
- Create: `apps/web/src/features/p07-real/p07-client.spec.ts`
- Modify: `apps/web/src/features/identity/identity-client.ts`
- Test: `apps/web/src/features/identity/identity-client.spec.ts`

- [ ] **Step 1: Write failing parser and request tests**

Cover the exact frozen consent read/accept, P07 state read, profile draft read/save, and 409 response schemas. Assert bearer identity comes from the restored session and request bodies contain no account ID, actor, role, screening result, or locally generated next action.

- [ ] **Step 2: Run the focused client tests and confirm RED**

Run:

```powershell
npm test --workspace @lianban/web -- src/features/p07-real/p07-client.spec.ts src/features/identity/identity-client.spec.ts
```

Expected: failures identify missing P07 client methods or missing frozen-schema parsing.

- [ ] **Step 3: Implement the smallest strict client**

Use discriminated unions matching the machine contract. Parse known `businessStatus`, schema/version identifiers, server draft values, and `recoverableActions`; reject extra professional or identity fields where the contract requires an exact summary.

- [ ] **Step 4: Run focused client tests and confirm GREEN**

Run the same command and require zero failures.

### Task 3: Real Consent and Server State Pages

**Files:**
- Create: `apps/web/src/features/p07-real/p07-page.tsx`
- Create: `apps/web/src/features/p07-real/p07-page.spec.tsx`
- Modify: `apps/web/src/app/app.tsx`
- Modify: `apps/web/src/features/identity/identity-next-action-page.tsx`
- Test: `apps/web/src/features/identity/identity-next-action-page.spec.tsx`

- [ ] **Step 1: Write failing route and interaction tests**

Test current consent loading, explicit acceptance, success followed by `restoreSession`, and server-driven rendering for `WAIT_FOR_SCREENING_RULES`, `WAIT_FOR_HUMAN_REVIEW`, `STOP_SERVICE_FLOW`, `COMPLETE_PROFILE`, and `WAIT_FOR_PLAN`. Assert the first frame contains no phase3 demo consent, screening, or profile content.

- [ ] **Step 2: Run focused page tests and confirm RED**

```powershell
npm test --workspace @lianban/web -- src/features/p07-real/p07-page.spec.tsx src/features/identity/identity-next-action-page.spec.tsx src/app/app.spec.ts
```

- [ ] **Step 3: Implement real P07 routing and pages**

Render server text and server state only. After consent acceptance succeeds, call the existing trusted session recovery callback and route exclusively from the returned `nextAction`.

- [ ] **Step 4: Run focused page tests and confirm GREEN**

Run the same command and require zero failures.

### Task 4: Profile Draft Conflict Safety

**Files:**
- Modify: `apps/web/src/features/p07-real/p07-client.ts`
- Modify: `apps/web/src/features/p07-real/p07-client.spec.ts`
- Modify: `apps/web/src/features/p07-real/p07-page.tsx`
- Modify: `apps/web/src/features/p07-real/p07-page.spec.tsx`

- [ ] **Step 1: Write failing draft restoration and conflict tests**

Test server schema rendering, draft version propagation, save success followed by server reread, and 409 preservation of the exact local input. Assert no request occurs for fields outside the approved schema.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
npm test --workspace @lianban/web -- src/features/p07-real/p07-client.spec.ts src/features/p07-real/p07-page.spec.tsx
```

- [ ] **Step 3: Implement minimal schema-driven controls and conflict state**

Create controls only from approved server schema entries. Keep local input intact on 409, expose REFRESH only when returned by the server, and never silently overwrite with the newest draft.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the same command and require zero failures.

### Task 5: Recovery Controls and Final Verification

**Files:**
- Modify: `apps/web/src/features/p07-real/p07-page.spec.tsx`
- Modify: `docs/ui/contracts/2026-07-26-p07-safe-structure-ui-consumption.md`

- [ ] **Step 1: Write failing recovery-action tests**

Cover 401, 403, 409, 502, 503, malformed JSON, unknown business status, and conflicting state. RETRY and REFRESH must be absent unless explicitly present in the server `recoverableActions`; CONTACT_OPERATIONS remains the conservative fallback.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
npm test --workspace @lianban/web -- src/features/p07-real/p07-client.spec.ts src/features/p07-real/p07-page.spec.tsx
```

- [ ] **Step 3: Implement the minimum recovery rendering**

Drive visible actions from the parsed server action list. Do not infer recovery from HTTP status, error code, time, or local workflow state.

- [ ] **Step 4: Run all required verification**

```powershell
npm test --workspace @lianban/web
npm run typecheck --workspace @lianban/web
npm run build --workspace @lianban/web
npm run test:production-bundle --workspace @lianban/web
git diff --check -- apps/web docs/ui
git diff --name-only --cached
```

Expected: all commands exit 0, the staged-file list is empty, and no files outside `apps/web/**` or `docs/ui/**` were modified by this batch.

### Self-Review

- [ ] Every real P07 route requires a restored USER session.
- [ ] No formal consent body, screening question/result, profile field, threshold, safety wording, or privacy rule is embedded in Web code.
- [ ] The phase3 demo is not imported by real P07 pages.
- [ ] All write success paths reread server state or restore the trusted session.
- [ ] All unknown and malformed states fail closed to contact operations.
- [ ] Documentation describes implementation evidence only and does not claim product acceptance.
