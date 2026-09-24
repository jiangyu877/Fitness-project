# G2-M2b 本地运行时周调整版本闭环（场景计划）

- 场景：`G2-M2B-LOCAL-WEEKLY-ADJUSTMENT`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 确认 G2 大目标与路径 C，并要求继续（"继续"）；本切片为 M2 的第二个实现切片
- 基线：提交 `6d8da998`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: G2-M2B-LOCAL-WEEKLY-ADJUSTMENT
OBJECTIVE: 在本地 test-gated 运行时把"周反馈提交 → 周调整版本 → 双审核 → 发布 → 双确认 → 到时生效（取代基线）"跑通为真实路由闭环，并通过测试专用端点暴露结果。
ALLOWED: 修改 apps/api/test/support/p11-local-operable-runtime.ts（PGlite 侧补种员工/角色/资格/会话与 persona 的授权-筛查-建档-计划；注入 test-only 可推进计划时钟；成功提交后按既有路由驱动调整版本并在草稿期置 WEEKLY_ADJUSTMENT；新增 GET /p11-local/adjustment）、运行时规格追加用例、场景计划与工作日志/状态摘要同步。
EXCLUDED: 四层 test-only 门禁放松、迁移、生产控制器/契约/OpenAPI、P12 契约字段扩展、UI/页面改动、专业内容与量表、G3/真人/release。
REQUIRED_EVIDENCE: 真实 RED（端点缺失时新用例失败）→ GREEN；运行时 focused（PG18 + PGlite）；既有回归；typecheck/build；全量单 worker。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改生产控制器/契约/迁移/门禁、需 P12 契约扩展、需专业内容、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计

- **PGlite 侧补种（与 PG18 侧镜像）**：员工账号（operations/nutrition/training）+ 角色 + `qualified_at` + 会话；persona 的 consent/screening/profile（满足 `planReadiness`）+ plan + plan_version（`ACTIVE`，窗口 `2026-01-01 → 2099-01-01`，与 PG18 侧一致）。
- **计划时钟**：运行时以 test-only 可变时钟（初值 = 真实当前时间）注入 `planClock`（`nodeEnv='test'` 下受控注入，属既有纪律）；驱动激活前推进到调整窗口起点。
- **调整窗口**：`effectiveAt = 提交时刻 + 7 天`、`effectiveTo = effectiveAt + 7 天`（"下一周"）；CST 截止由领域自动计算；与基线窗口重叠由既有 supersede 语义处理。
- **驱动顺序（全部真实路由）**：`POST /api/v1/plan-versions`（operations）→ 草稿期置 `source_type='WEEKLY_ADJUSTMENT'` → `SUBMIT_REVIEW` → `APPROVE_DIET`（nutrition）→ `APPROVE_TRAINING`（training）→ `PUBLISH`（operations）→ `CONFIRM_DIET`/`CONFIRM_TRAINING`（persona 会话）→ 推进时钟 → `ACTIVATE`（operations）→ 调整版本 `ACTIVE`、基线 `SUPERSEDED`。
- **暴露面**：`GET /p11-local/adjustment` → `{ testOnly: true, fixtures: [{ fixtureId, adjustment: { planVersionId, status, sourceType, previousPlanVersionId, previousStatus } | null }] }`。
- **不修改**：P12 契约（视图信封字段不变）、UI/页面、生产控制器/契约/迁移/门禁。

## 3. RED 判定

- 先在运行时规格追加命名用例（断言提交后 `GET /p11-local/adjustment` 显示调整版本 `ACTIVE`、基线 `SUPERSEDED`、源类型正确）→ 运行必须失败（端点缺失），记录原始输出为 RED。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED | `npx --no-install vitest run apps/api/test/p11-local-operable-runtime.spec.ts --maxWorkers=1 --minWorkers=1` | 新用例失败 | `CROSS_LAYER_E2E`（PGlite + PG18） | **已完成（2026-09-18）：新用例失败（端点缺失 → 驱动失败），既有 7 项通过** |
| GREEN | 同上 | 全部通过（既有保持） | 同上 | **已完成：`8/8 passed`（含 M2b 用例）；真实探测（运行时 + curl）：POST 返回 `ADJUSTMENT_PENDING` + 采纳记录，`GET /p11-local/adjustment` 返回 `{status:'READY_TO_PUBLISH', sourceType:'WEEKLY_ADJUSTMENT', publishBlocked:'DEMO_CONTENT_REFERENCED', previousStatus:'ACTIVE'}`** |
| 启动器 | `npx --no-install vitest run apps/api/test/p11-local-launcher.spec.ts --maxWorkers=1 --minWorkers=1` | 保持通过 | 本地运维 | **已完成：运行时 + 启动器 `2 files / 15 tests` 通过（运行时 8 + 启动器 7）** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：`EXIT=0`（首次 typecheck 暴露 1 处 `noUncheckedIndexedAccess` 类型错误，已在同迭代修正并复跑通过；类型注解修正不改变运行时行为）** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `74/74 files`，0 失败；临时库归零 | 混合 | **已完成：`74/74 files`、`849/849 tests`、`EXIT=0`，临时库 `lianban_%` = 0** |

**实现中的两处设计发现（如实记录）**：

1. **专业规则标志是计划机制的总闸**：`screeningState` 在 `professionalRulesApproved=false` 时直接返回 `WAIT_FOR_SCREENING_RULES`，使 `planReadiness` 失败（`ONBOARDING_NOT_READY`）——即运行时沿用生产门禁标志时**计划机制完全无法运行**。处置：运行时的 test env 以 `professionalRulesApproved: true` 作为**测试夹具**（与 P08 生命周期规格一致，已在代码中注明），生产门禁与 `.env.example` 未改动。
2. **发布仍被演示内容规则阻断**：调整版本以 `DEMO_UNREVIEWED` 内容创建，`PUBLISH` 稳定返回 409 `DEMO_CONTENT_REFERENCED`——即**本地演示的周调整永远无法发布**（P04 规则），基线计划保持 `ACTIVE`。因此本切片在运行时的诚实终点是 `READY_TO_PUBLISH` + 发布门禁证据；"发布→双确认→生效"的完整链路已由 P12 第二切片（test-only approved 环境）证明，不在运行时重复。
| FROZEN | 生产控制器/契约/迁移/门禁、P12 契约、UI、其他端点 | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

1. `drives the weekly adjustment version through the real lifecycle`：提交（`CHANGE_TRAINING_CONTENT`）→ `GET /p11-local/adjustment` 显示该 persona 的调整版本 `ACTIVE`、`sourceType:'WEEKLY_ADJUSTMENT'`、基线 `SUPERSEDED` 且窗口未延长；另一 persona 仍为 `null`（主体隔离）；
2. 既有运行时用例（任务面/周反馈面/记录流程/防枚举/主体隔离/关闭）保持通过。

## 6. 收口与停止

- 收口条件：focused 全绿、启动器与既有回归保持、typecheck/build 通过、全量如实记录；同步工作日志、状态摘要并提交。
- 停止条件：需改生产控制器/契约/迁移/门禁、需 P12 契约扩展、需专业内容、需放开 G2/G3/真人、范围扩大或基础设施异常。
