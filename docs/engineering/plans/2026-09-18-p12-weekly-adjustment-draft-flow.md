# P12 周调整草案流（第二个切片，场景计划）

- 场景：`P12-WEEKLY-ADJUSTMENT-DRAFT-FLOW`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 对话中批准（"继续下一步"，对应 P12 后续候选 1）
- 基线：提交 `7b127c1f`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: P12-WEEKLY-ADJUSTMENT-DRAFT-FLOW
OBJECTIVE: 以命名测试证明周调整版本完整复用冻结生命周期流程（双审核→发布待确认→双确认→到时生效→取代旧版本），并携带 WEEKLY_ADJUSTMENT 源类型与采纳记录链接（反馈周/结果 → 新版本）。
ALLOWED: 在既有 apps/api/test/plan-lifecycle.e2e.spec.ts 内追加 P12 命名测试（不改动既有用例与共享辅助函数语义）；复用 p12-weekly-feedback fixture；场景工程计划与工作日志/状态摘要同步。
EXCLUDED: 生产 endpoint/迁移/wiring（含创建路由的 source_type 接线）、专业内容与量表、UI、风险规则、G2/G3/真人/release。
REQUIRED_EVIDENCE: focused 命名测试（允许 direct GREEN，不伪造 RED）；该文件既有用例保持通过；typecheck/build；全量单 worker。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改生产代码/迁移/UI、需定义专业内容、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计与依据

- **源类型**：`planning.plan_version.source_type` 的 schema 冻结值包含 `WEEKLY_ADJUSTMENT`（`001_core.sql` CHECK）；创建路由尚未暴露该字段（生产接线属后续切片）→ 本切片在**草稿状态**下以 test-only SQL 设置源类型，并依据 migration 002/009 的不可变触发器（仅保护已发布状态）证明其可行。
- **流程复用**：PRD §6.1-10"改变…周期的周调整，完整复用双审核、发布待确认、用户双确认和到时生效流程" → 全部通过既有真实路由驱动，无新运行时行为。
- **窗口与截止时间**：调整窗口紧接基线版本（`08-17 → 08-24`，边界相接不重叠）；截止时间由 CST 约束自动计算（`08-16T12:00Z`），PUBLISH 需 ≤ 截止 − 24h（`08-15T12:00Z`），双确认需早于截止，生效需 ≥ `08-17T00:00Z`。
- **采纳记录**：链接结构 `{weekIndex, outcome, submittedFieldIds}（切片 1 契约）+ planVersionId + previousPlanVersionId`。
- **周窗口联动**：调整版本窗口经 `deriveWeeklyWindows` 推导出第 2 周 7 个业务日期（与切片 1 契约一致）。

## 3. RED 判定

- 本切片复用既有机制、无新运行时行为：允许 **direct GREEN**；首次聚焦运行若直接通过则如实记录，不伪造 RED（与项目既有 direct-GREEN 切片惯例一致）。若失败，先判断夹具/基础设施与行为问题，不直接改生产代码。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| focused 命名测试 | `npx --no-install vitest run apps/api/test/plan-lifecycle.e2e.spec.ts --maxWorkers=1 --minWorkers=1` | 新测试通过、既有 36 项保持 | `CROSS_LAYER_E2E`（PGlite） | **已完成：`37/37 passed`（新测试 942ms）。首次运行 `1 failed \| 36 passed` 为测试预期未对齐冻结的 Shanghai 业务日期约定（UTC 午夜截止会多覆盖一个 Shanghai 日），修正窗口为 Shanghai 周边界 `08-23T16:00Z` 后通过——非产品行为缺陷，如实记录** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `68/68 files`，0 失败；临时库归零 | 混合 | **已完成：`68/68 files`、`820/820 tests`、`EXIT=0`（plan-lifecycle 37 tests ✓），临时库 `lianban_%` = 0** |
| FROZEN | 生产代码、迁移、既有用例与共享辅助函数语义、其他场景 | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

1. `P12 weekly adjustment: runs the adjusted version through review, publish, dual confirmation and activation`：周 1 基线版本（`08-10 → 08-17`）经真实流程 ACTIVE → 切片 1 反馈采纳 `CHANGE_TRAINING_CONTENT` → 真实路由创建周 2 调整版本（`08-17 → 08-24`）并在草稿期设置 `WEEKLY_ADJUSTMENT` → 双审核 → 发布 → 双确认 → 到时生效；断言：调整版本 `ACTIVE` 且源类型/版本号/窗口正确、基线版本 `SUPERSEDED` 且未被延长、采纳记录链接正确、`plans/current` 指向调整版本、`deriveWeeklyWindows` 得到周 2 的 7 个业务日期。

## 6. 收口与停止

- 收口条件：命名测试通过、既有回归保持、typecheck/build 通过、全量如实记录；同步工作日志、验收台账 P12 说明、状态摘要并提交。
- 停止条件：需改生产代码/迁移/UI、需定义专业内容、需放开 G2/G3/真人、范围扩大或基础设施异常。
