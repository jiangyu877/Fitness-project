# P10 唯一 ACTIVE 窗口结构化任务生成（场景计划）

- 场景：`P10-ACTIVE-WINDOW-TASK-GENERATION-STRUCTURE`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 对话中批准（"按照 p10 的任务开工"，授权文本见下）
- 基线：提交 `bb703a63`
- 写入者：ZCode（单场景唯一写入者）；无外部独立审查线程，产品负责人接受 ZCode 自审验收（`SELF_REVIEW_COMPLETE`），不使用任何 clearance 名义

## 1. 授权原文（用户批准）

```text
SCENE: P10-ACTIVE-WINDOW-TASK-GENERATION-STRUCTURE
OBJECTIVE: 唯一有效 ACTIVE 计划窗口内按业务日期生成持久化结构化任务行（绑定计划版本，无专业内容），使既有 P11 记录路径可绑定真实任务；全部既有反例（非 ACTIVE/空档/多 ACTIVE 候选为空）保持不变。
ALLOWED: test-only 任务生成 runtime/仓储/命名测试、既有 P11 测试 support 最小复用、场景工程计划与工作日志；仅本地隔离 PG18 + PGlite。
EXCLUDED: 生产 endpoint/迁移/wiring、专业任务内容（动作/组次/饮食条目/阈值/文案）、UI 产品语义、P12 周反馈、风险规则、真人/G2/G3/release。
REQUIRED_EVIDENCE: 真实 RED（正例任务当前不生成）→ 最小 GREEN；focused PG18 命名测试；既有反例回归；typecheck/build；全量单 worker 回归。
INDEPENDENT_REVIEWS: 无独立线程时保持 REVIEW_PENDING（ZCode 自审）。
STOP: 需定义专业内容、需改生产代码/迁移、需放开 G2/G3/真人、范围扩大或基础设施异常。
```

## 2. 冻结设计与依据（探索结论）

- **业务日期约定（权威）**：`recording` 仓储以 `Asia/Shanghai` 将 `business_date` 映射到计划窗口（`packages/database/src/record-repository.ts` 的 `lockActivePlanVersion`：`effective_at < (D+1)::timestamp AT TIME ZONE 'Asia/Shanghai'` 且 `effective_to > D::timestamp AT TIME ZONE 'Asia/Shanghai'`）。生成器必须使用同一约定，否则生成的日期无法通过既有记录路径的窗口校验。
- **唯一 ACTIVE 判定**：复用冻结领域函数 `resolveCurrentPlan`（`@lianban/domain`）：无覆盖 `trustedNow` 的 ACTIVE → `PLAN_GAP`；多个覆盖 → `PLAN_STATE_INVALID`；唯一 → 生成。
- **任务行结构（无专业内容）**：写入 `recording.record_task`，字段与既有 test-only 桥接完全一致（`schema_version` 取自测试 schema、`gate_id='P11_RECORD_WRITE'`、`gate_revision` 取自 `recording.p11_write_gate`、`close_policy='TEST_ONLY_EXPLICIT'`、`task_state/date_state='OPEN'`、`risk_state='CLEAR'`），不含动作、组次、饮食条目等任何专业字段。
- **幂等**：任务 id 为确定性不透明值 `p10-task-<sha256(planVersionId:businessDate)[0:32]>`，写入 `ON CONFLICT (id) DO NOTHING`，重复生成不产生重复行。
- **证据层**：`PG18_REPOSITORY + CROSS_LAYER_E2E`（隔离 PG18 + 真实记录命令路由）；反例零写入以 `record_task` 计数前后相等证明。
- **不修改**：生产代码、迁移、`apps/api/test/support/p11-*`、既有任何测试文件、UI。

## 3. RED 判定

- 新增命名测试 `apps/api/test/p10-task-generation.postgres.e2e.spec.ts`，配套 support `apps/api/test/support/p10-task-generation.ts` 先以 RED 脚手架（生成器固定返回 `REFUSED / PLAN_GAP`，不写任何行）存在；
- 运行 focused：正例断言（期望 `GENERATED` 且逐业务日期任务行存在）必须失败（当前行为 = 不生成），记录原始失败输出为 RED；
- 既有反例（plan-lifecycle `36/36`、P11 桥接 `1 passed`）在 RED 阶段保持通过，证明测试只新增正例能力。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED | `npx --no-install vitest run apps/api/test/p10-task-generation.postgres.e2e.spec.ts --maxWorkers=1 --minWorkers=1` | 正例失败（不生成） | `PG18_REPOSITORY` | **已完成（2026-09-18）：脚手架下 `4 failed / 1 passed (5)`，正例断言 `expected 'REFUSED' to be 'GENERATED'`；同一迭代修正两处脚手架缺陷（第二 ACTIVE 截止时间 CST 约束值、afterEach 双关闭）** |
| GREEN | 同上 | 全部通过 | `PG18_REPOSITORY + CROSS_LAYER_E2E` | **已完成：`5/5 passed`（约 3.0s）** |
| 反例回归 | 上述命令 + `plan-lifecycle.e2e.spec.ts` 与 `p11-dual-fixture-runtime-bridge.postgres.e2e.spec.ts` focused | 既有反例保持通过 | 混合 | **已完成：`2 files / 37 tests` 通过（plan-lifecycle `36/36`、P11 桥接 `1 passed`）** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `67/67 files`（新增 1 文件），0 失败；临时库归零 | 混合 | **已完成：`67/67 files`、`811/811 tests`、`EXIT=0`（242s），临时库 `lianban_%` = 0** |
| FROZEN | 生产代码、迁移、P11 support、UI、其他场景 | 不修改 | — | 冻结 |

## 5. 命名测试清单（冻结）

1. 正例：唯一 ACTIVE 有限窗口（`2026-01-01T00:00Z → 2026-01-04T00:00Z`）生成 4 条任务（`01-01` 至 `01-04`，含 Shanghai 边界日），绑定 plan/plan_version、`OPEN/OPEN/CLEAR`、gate revision 与 schema 版本一致；
2. 幂等：重复生成 → 行数不变、id 不变；
3. 绑定：对生成的任务执行真实 `POST /api/v1/record-tasks/:taskId/commands` → `200 RECORD_WRITE_ACCEPTED`，`recording.record` 绑定该任务与业务日期；
4. 反例（零写入）：`trustedNow` 在窗口外 → `REFUSED / PLAN_GAP`；两个覆盖 ACTIVE → `REFUSED / PLAN_STATE_INVALID`；两者 `record_task` 计数前后相等；
5. Shanghai 边界：`effective_to = 2026-01-04T00:00Z` 含 `01-04`（Shanghai 当日部分覆盖），`effective_to = 2026-01-03T16:00Z`（= Shanghai 01-04 00:00）不含 `01-04`。

## 6. 收口与停止

- 收口条件：命名测试全绿、反例回归保持、typecheck/build 通过、全量单 worker 如实记录；随后同步工作日志与状态摘要并提交。
- 停止条件：需改生产代码/迁移、需定义专业内容、需放开 G2/G3/真人、范围扩大或基础设施异常。
- 审查：无外部独立线程；产品负责人接受 ZCode 自审验收（`SELF_REVIEW_COMPLETE`）。
