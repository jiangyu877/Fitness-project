# 计划生命周期固定日期回归预审（PREFLIGHT）

- 场景：`PLAN-LIFECYCLE-FIXED-DATE-REGRESSION-PREFLIGHT`（只读预审，未修改任何生产代码与测试）
- 日期：2026-09-17
- 授权：用户于 2026-09-17 会话中明确批准（范围：复现、根因、边界映射、最小修复建议）
- 执行：ZCode（研发 + 各边界自审；本次复核均为 ZCode 自审，非外部独立 Sol Critical）
- 基线：提交 `c6dcb77`，分支 `codex/ui-ux-spec`

## 1. 复现证据

- 命令：`npx vitest run apps/api/test/plan-lifecycle.e2e.spec.ts`
- 结果：`9 failed / 27 passed (36)`，与 2026-09-05、2026-09-16 隔离 PG18 全量单 worker 回归记录的失败计数一致。
- 证据层：`CROSS_LAYER_E2E`（API e2e，`databasePath: 'memory://'` PGlite 内存库）。本规格不依赖 PG18，复现无需启动 PostgreSQL。
- 8 项失败报错均为 `expected 200 "OK", got 409 "Conflict"`，断言位置全部在 `preparePublished`（`apps/api/test/plan-lifecycle.e2e.spec.ts:1375`）的 PUBLISH 转换；
- 1 项失败为反向：`expected 409, got 200`（多 ACTIVE bypass 读守卫，`:1119`）。

失败清单：

1. returns a pure user-scoped pending summary without draft or review details
2. requires authorized plan reads and leaves scheduled plans unchanged when a client supplies at
3. rejects an entire published version when either user part is rejected
4. replays a terminal user confirmation without duplicate transition audit
5. makes cross-user and nonexistent user transitions indistinguishable
6. validates staff review rejection reason codes without changing USER rejection bodies
7. blocks a second pending version for the same user
8. does not promote a fully confirmed scheduled version from a client supplied time
9. fails current-plan reads closed when bypassed data contains multiple active versions

## 2. 根因

时钟链路：测试通过 `planClock` 注入时钟（`app.module.ts:42` 仅在 `nodeEnv === 'test'` 接受注入，属 P08 台账"生产测试时钟注入已收紧"的既有设计）；`plan-lifecycle.service.ts:49-52` 仅在提供时钟时传给仓储；未提供时仓储回退 `SELECT clock_timestamp()`（`plan-repository.ts:384-388`、`:488-492`），即数据库真实时间。

- 失败 1-8：这些测试构建应用时**未传 `planClock`**（如 `plan-lifecycle.e2e.spec.ts:135`，对比注入时钟的通过测试 `:101-104`）。PUBLISH 经 `withTrustedTime`（service `:296-304`）取真实时间为 `occurredAt`；领域规则 `packages/domain/src/plan.ts:129-131` 要求发布时间 ≤ 确认截止 − 24h（夹具截止 2026-08-09T12:00Z，即须 ≤ 2026-08-08T12:00Z）。真实时间已越过该阈值，故 PUBLISH 稳定返回 `409 PLAN_TRANSITION_BLOCKED / PUBLICATION_LEAD_TIME_INSUFFICIENT`。
- 失败 9：bypass 直插的两条 ACTIVE 版本窗口为 2026-07-26 → 07-28/29（`:1102-1115`）。`resolveCurrentPlan`（`plan.ts:191-210`）按 `effectiveAt <= now < effectiveTo` 过滤，两条均已整体过期（自 2026-07-29T00:00Z 起），过滤结果为空 → `PLAN_GAP` 200，而非多 ACTIVE 的 `409 PLAN_STATE_INVALID`。
- 定向验证：以注入时钟（锚定 `publishAt`）复跑同一 PUBLISH 流程的一次性探针返回 `200 PENDING_CONFIRMATION`，证明注入时钟即可恢复通过；探针脚本位于 `.local/`，验证后已删除。
- 结论：**全部 9 项为同一根因——测试夹具固定日期随真实时间自然老化，受影响测试未注入时钟。生产代码行为正确（发布 lead-time fail closed、过期窗口返回 PLAN_GAP），无需修改生产实现。**`apps/api/src/plans`、`packages/database/src/plan-repository.ts` 自 2026-07-26（`130dffe`）以来无改动。

## 3. 与既有记录的关系（对状态摘要的精确化）

状态摘要中"固定 2026-07/08 窗口与 2026-09-05 数据库可信时间冲突"的表述需精确化：不存在 2026-09-05 的时间源变更；失败是固定夹具窗口相对真实时钟老化的确定性结果——失败 9 自 2026-07-29T00:00Z 起、失败 1-8 自 2026-08-08T12:00Z 起即已注定失败，2026-09-05/2026-09-16 的全量回归只是首次观察到累积状态（期间无全量复跑）。2026-09-16 记录仅给出计数，未列用例名；本次按文件 + 计数 + 机制推断两批失败为同一批，此推断已如实标注。

## 4. 边界映射

- 失败 1-8 → **P08**（计划双审核、发布、双确认、超时与生效）：全部阻断于测试 setup 阶段的 PUBLISH lead-time 规则。
- 失败 9 → **P09/P10 边界**（单一 ACTIVE / 计划空档 / 今日任务候选）：多 ACTIVE fail-closed 读守卫与任务候选 PLAN_GAP 断言。

## 5. 最小修复建议（下一场景，test-only，不授权本轮执行）

- 推荐 A（最小 diff）：仅为 9 项失败测试的应用构建注入 `planClock`。失败 1-8 锚定 ≤ 2026-08-08T12:00Z（建议直接用既有 `publishAt`）；失败 9 锚定 bypass 窗口内（建议 2026-07-27T00:00:00Z——`canGeneratePlanTasks` 与 current 读走同一 `resolveCurrentPlan`，多 ACTIVE 时两项断言 409 与 PLAN_GAP 均应成立，须在修复场景按 RED→GREEN 验证）。不修改生产代码；`app.module` 注入守卫与 `clock_timestamp` 回退均为正确设计，保持不动。
- 备选 B：整文件默认注入时钟。可消除同类老化风险，但改变真实时钟回退路径的 e2e 覆盖且 diff 更大，本轮不推荐。
- 修复场景仍须走产品冻结范围 → RED → 最小 GREEN → focused 回归（本文件 36 项全绿）→ 边界复核流程。

## 6. 未执行 / 未关闭

- 修复未执行；仓库全量回归未运行；PG18 未启动（无需）。
- 生产代码、测试代码、迁移、UI、浏览器均未修改。
- 本报告所有复核为 ZCode 自审；如需外部独立复核，须另行安排。
- 不改变 G2 未达到、G3 禁止、`readyForRealUsers=false` 的总体门禁。
