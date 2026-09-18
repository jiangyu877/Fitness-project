# P08-P10 固定日期夹具时钟注入修复（场景计划）

- 场景：`PLAN-LIFECYCLE-FIXED-DATE-FIXTURE-CLOCK-INJECTION`
- 日期：2026-09-17
- 授权：产品负责人于 2026-09-17 对话中批准（下方原文）
- 基线：提交 `586540a`（含预审报告 `2026-09-17-plan-lifecycle-fixed-date-regression-preflight.md`）
- 写入者：ZCode（单场景唯一写入者）；无外部独立审查线程，本场景结论为 ZCode 自审并保持 `REVIEW_PENDING`，不使用任何 clearance 名义

## 1. 授权原文（用户批准）

```text
SCENE: PLAN-LIFECYCLE-FIXED-DATE-FIXTURE-CLOCK-INJECTION
OBJECTIVE: 仅以 test-only 时钟注入修复 plan-lifecycle.e2e.spec.ts 九项固定日期失败，该文件 36/36 全绿。
ALLOWED: 仅 apps/api/test/plan-lifecycle.e2e.spec.ts（九个 fixture 注入 planClock，并新增断言证明有效窗口本身为真）；场景工程计划与工作日志追加。
EXCLUDED: 生产代码（app.module 守卫、PlanLifecycleService、plan-repository、domain）、迁移、UI、P08/P09/P10 产品语义、接受客户端时间、删除/skip 失败用例、G2/G3/生产/真人。
REQUIRED_EVIDENCE: 修复后该文件 focused 36/36；全量单 worker 回归（需本机 PG18 管理员 URL）；typecheck/build。
INDEPENDENT_REVIEWS: 无外部独立线程时，状态保持 REVIEW_PENDING，复核标注 ZCode 自审。
STOP: 需改生产代码、需改产品语义、需 skip/删除用例、范围扩大或基础设施异常。
```

## 2. RED（预审已记录，本场景沿用）

- 命令：`npx --no-install vitest run apps/api/test/plan-lifecycle.e2e.spec.ts --maxWorkers=1 --minWorkers=1`
- 结果：`9 failed / 27 passed (36)`（`CROSS_LAYER_E2E`，memory:// PGlite）
- 8 项：`preparePublished` PUBLISH 得 `409 PUBLICATION_LEAD_TIME_INSUFFICIENT`——用例未注入 `planClock`，仓储回退 `clock_timestamp()` 真实时间；
- 1 项：bypass 多 ACTIVE 读得 200（固定窗口已过期 → `PLAN_GAP`）。
- 修复前后测试文件内容未变（仅文档提交），RED 有效。

## 3. 修复设计（test-only，最小 diff）

对九个失败用例注入显式 `planClock`：

1. 发布路径 8 项：`let trustedNow = new Date(publishAt)` + `planClock: { now: () => trustedNow }`（与文件内既有通过用例同构；8 项均无需推进时间）；
2. bypass 1 项：`trustedNow = 2026-07-27T00:00:00.000Z`（位于两条 bypass 窗口 2026-07-26 → 07-28/29 内），保持 `409 PLAN_STATE_INVALID` 与 task-candidates `PLAN_GAP` 双断言；
3. 窗口真值断言：
   - 发布路径 8 项断言 `trustedNow ≤ deadline − 24h`（证明发布 lead-time 窗口对注入时钟真实成立）；
   - bypass 项断言两条窗口均包含 `trustedNow`（证明多 ACTIVE 条件真实成立）。
4. 不改生产代码；不改既有断言语义；不 skip/删除任何用例；不接受客户端时间。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED | 该文件 focused 单 worker | `9 failed / 27 passed` | `CROSS_LAYER_E2E` | 已完成（预审，2026-09-17） |
| GREEN | 同上 | `36/36 passed` | `CROSS_LAYER_E2E` | **已完成（2026-09-18）：`1 file / 36 tests passed`，45.45s** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成（2026-09-18）：两项 EXIT=0，无错误输出** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1`（需本机 PG18 管理员 URL） | 预期 `66/66 files`、`806/806 tests` | 混合（PG18 + PGlite） | **已完成（2026-09-18）：PG18 服务启动后复跑单 worker `66/66 files`、`806/806 tests`、`EXIT=0`（239s），临时库 `lianban_%` 检查为 0；此前一次运行（PG18 停止）的 133 项 `ECONNREFUSED` 为基础设施阻断，非行为回归。** |
| FROZEN | 其余测试文件、生产代码、迁移、UI、其他场景 | 不修改 | — | 保持冻结 |

## 5. 收口与停止

- 收口条件：focused 36/36、typecheck/build 通过、全量回归结果如实记录；若 PG18 基础设施不可用，如实标注为未执行并保留 focused 证据，不以外推替代。
- 停止条件：需改生产代码、需改产品语义、需 skip/删除用例、出现第二场景范围或基础设施异常时停止并报告。
- 审查：无外部独立线程；结论为 ZCode 自审 + `REVIEW_PENDING`。
