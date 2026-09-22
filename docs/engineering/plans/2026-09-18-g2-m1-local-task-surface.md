# G2-M1 本地运行时任务面（场景计划）

- 场景：`G2-M1-LOCAL-TASK-SURFACE`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 确认 G2 大目标并选定路径 C（本地运行时扩展，零门禁放松）；本切片为 M1 首个实现切片
- 基线：提交 `24c0768d`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: G2-M1-LOCAL-TASK-SURFACE
OBJECTIVE: 在本地 test-gated 运行时中接入 P10 结构化任务生成：两 persona 的有限 ACTIVE 窗口经生成器产出任务行，运行时的测试专用面暴露结构化任务清单（不透明 id/业务日期/状态），既有记录流程继续可用。
ALLOWED: 修改 apps/api/test/support/p11-local-operable-runtime.ts（夹具窗口有限化、任务改由生成器产出、新增 /p11-local/tasks 测试专用端点）与其命名测试追加、复用 p10 生成器；场景计划与工作日志/状态摘要同步。
EXCLUDED: 四层 test-only 门禁放松、迁移、生产控制器/契约/OpenAPI 改动、专业内容与量表、H5/Web 页面（M1b）、G3/真人/release。
REQUIRED_EVIDENCE: 真实 RED（任务面端点缺失时新用例失败）→ GREEN；运行时 focused（PG18）与启动器 focused；既有运行时用例保持；typecheck/build；全量单 worker。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改生产控制器/契约/迁移/门禁、需专业内容、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计

- **窗口有限化**：两 persona 的 ACTIVE 计划窗口由 `2026-01-01T00:00Z → 2099-01-01T00:00Z` 改为 `2026-01-01T00:00Z → 2026-01-29T00:00Z`（4 周；CST 截止与发布时间约束不变，2026-01-02 仍在窗口内，记录路径校验不受影响）。
- **任务由生成器产出**：删除手工 `record_task` 插入，改调 `generateActiveWindowTasks`（P10 生成器，`trustedNow = 2026-01-02T12:00:00Z`、`schemaVersion='schema-v1'`）；夹具 `taskId` = 生成器对 `2026-01-02` 的确定性不透明 id（`generatedTaskId(planVersionId,'2026-01-02')`）。
- **测试专用任务面**：运行时自有命名空间新增 `GET /p11-local/tasks` → `{ testOnly: true, fixtures: [{ fixtureId, tasks: [{ taskId, businessDate, taskState, dateState, riskState }] }] }`；只暴露结构字段（不透明 id、业务日期、状态），与 `/p11-local/fixtures` 同风格。
- **窗口业务日期**：沿用 Asia/Shanghai 约定（与记录仓储一致）→ `2026-01-01` 至 `2026-01-29` 共 29 个业务日期。
- **不修改**：生产控制器/契约/OpenAPI、迁移、门禁四层、H5/Web 页面。

## 3. RED 判定

- 先在运行时规格追加命名用例（断言 `/p11-local/tasks` 存在且内容正确、夹具 taskId 为生成 id）；
- 运行 focused：**必须真实失败**（端点当前 404；夹具 taskId 当前为手工值），记录原始输出为 RED。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED | `npx --no-install vitest run apps/api/test/p11-local-operable-runtime.spec.ts --maxWorkers=1 --minWorkers=1` | 新用例失败 | `PG18_REPOSITORY + CROSS_LAYER_E2E` | **已完成（2026-09-18）：新用例失败（`/p11-local/tasks` 404）、既有 5 项通过** |
| GREEN | 同上 | 全部通过（既有记录流程用例保持） | 同上 | **已完成：`6/6 passed`（含既有记录流程用例在生成任务上保持）** |
| 启动器 | `npx --no-install vitest run apps/api/test/p11-local-launcher.spec.ts --maxWorkers=1 --minWorkers=1` | 保持通过 | 本地运维 | **已完成：启动器 `7/7`、P10 `5/5`** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `72/72 files`，0 失败；临时库归零 | 混合 | **已完成：`72/72 files`、`843/843 tests`、`EXIT=0`，临时库 `lianban_%` = 0** |

**同迭代发现（如实记录，设计修正）**：上下文读取要求计划在**真实当前时间**处于 ACTIVE（P11-04 冻结的适配器行为），因此运行时窗口必须继续跨越真实时钟（保持 `2099-01-01`），不能用 4 周有限窗口；改为"窗口不变 + 生成器可选 `maxBusinessDates=28` 上限"。生成器参数为加法式扩展，P10 既有契约与用例不受影响。
| FROZEN | 生产控制器/契约/OpenAPI、迁移、门禁四层、H5/Web | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

1. 运行时规格追加：`serves generated structural tasks for both personas`——`/p11-local/tasks` 返回两 persona 各 29 条结构任务（`2026-01-01`…`2026-01-29`），id 为生成器确定性 id，跨 persona 隔离，`testOnly=true`；夹具清单的 `taskId` 等于 `2026-01-02` 的生成 id；
2. 既有运行时用例（记录上下文/写入/防枚举/主体隔离）在生成任务上保持通过。

## 6. 收口与停止

- 收口条件：focused 全绿、启动器与全量回归如实记录、typecheck/build 通过；同步工作日志、状态摘要并提交。
- 停止条件：需改生产控制器/契约/迁移/门禁、需专业内容、需放开 G2/G3/真人、范围扩大或基础设施异常。
