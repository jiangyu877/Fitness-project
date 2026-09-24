# G2-M1b 本地运行时今日任务视图（场景计划）

- 场景：`G2-M1B-LOCAL-TASK-VIEW`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 确认 G2 大目标与路径 C，并要求继续推进（"继续"）；本切片为 M1 的第二个实现切片
- 基线：提交 `f02c6325`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: G2-M1B-LOCAL-TASK-VIEW
OBJECTIVE: 在本地 test-gated 运行时新增"今日任务"视图（H5）：严格解析 /p11-local/fixtures 与 /p11-local/tasks，按 persona 渲染结构化任务列表，点击任务以该任务打开既有记录页；全部 fail closed。
ALLOWED: 新增 apps/web/src/features/p11-local/p11-local-today-page.tsx 与其命名规格；导出既有 runtime-page 的清单解析器（仅加 export，不改行为）；在 apps/web/src/app/app.tsx 增加受 VITE_P11_LOCAL_RUNTIME 门控的 /h5/p11-local/today 路由分支；浏览器证据；场景计划与工作日志/状态摘要同步。
EXCLUDED: 四层 test-only 门禁放松、迁移、生产控制器/契约/OpenAPI、既有页面与既有规格改动（除解析器导出）、专业内容与量表、G3/真人/release。
REQUIRED_EVIDENCE: 真实 RED（新页面缺失时新规格失败）→ GREEN；web focused；运行时/启动器回归；typecheck/build；全量单 worker；BROWSER 层证据（运行时实际启动 + 截图）。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改生产控制器/契约/迁移/门禁、需专业内容、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计

- **新页面**（`/h5/p11-local/today`，仅 `VITE_P11_LOCAL_RUNTIME=true` 时可达，与既有 `/h5/p11-local` 同门控）：并行读取 `/p11-local/fixtures` 与 `/p11-local/tasks`；严格解析（精确键、状态枚举 `OPEN|CLOSED|UNKNOWN` / `CLEAR|BLOCKED|UNKNOWN`、`YYYY-MM-DD` 业务日期、id 唯一、条目与两 persona 一一对应且非空、**清单 taskId 必须存在于该 persona 的任务列表中**）；任一畸形 → 错误页（`P11_LOCAL_TASK_SURFACE_INVALID`；请求失败 → `P11_LOCAL_RUNTIME_UNAVAILABLE`）。
- **点击行为**：`onOpen({ ...fixture, taskId: 所选任务 })` —— 复用既有接线（写入可信会话 + 导航 `/h5/records?taskId=...`），不改变 `P11LocalFixture` 契约。
- **文案**：仅使用冻结目录语义（`H5-TOD-01 今日`："打开今日可执行任务"）与既有演示免责声明；不新增专业文案。
- **不修改**：既有 `p11-local-runtime-page.tsx` 的行为（仅导出解析器）、既有规格、生产控制器/契约/迁移/门禁。

## 3. RED 判定

- 先写新页面规格（页面模块尚不存在）→ 运行必须失败（模块解析失败/断言失败），记录原始输出为 RED。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED | `npx --no-install vitest run apps/web/src/features/p11-local --maxWorkers=1 --minWorkers=1` | 新规格失败 | `UI_STATE` | **已完成（2026-09-18）：新规格无法解析模块（`Failed to resolve import`）、既有 5 项通过** |
| GREEN | 同上 | 全部通过（既有规格保持） | `UI_STATE` | **已完成：`7/7 passed`（新今日页 2 + 既有运行时页 5）** |
| 运行时回归 | `npx --no-install vitest run apps/api/test/p11-local-operable-runtime.spec.ts apps/api/test/p11-local-launcher.spec.ts --maxWorkers=1 --minWorkers=1` | 保持通过 | 混合 | **已完成：`13/13 passed`** |
| 浏览器 | 启动 `dev:p11-local`（私设管理员 URL）+ 打开 `/h5/p11-local/today` | 两 persona 任务列表可见；点击任务进入记录页 | `BROWSER` | **未执行（阻断）：本机 PG18 服务已停止（`ECONNREFUSED 127.0.0.1:5432`），启动需管理员权限；运行时依赖 PG18 才能启动。首次截图误捕到连接失败页，已删除，不记为证据** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `73/73 files`（新增 1 文件），0 失败；临时库归零 | 混合 | **未执行（阻断）：同上，PG18 停止导致 PG18 依赖规格必然基础设施失败，不得记为回归结果** |
| FROZEN | 生产控制器/契约/迁移/门禁、既有页面行为与规格、其他场景 | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

1. `renders both personas' generated tasks and opens the selected task`：两 persona 各渲染其任务按钮（日期 + 状态），点击后 `onOpen` 收到该 persona 与该任务的组合；
2. `fails closed on malformed task surfaces`：未知状态、重复 id、日期格式错误、条目缺失/多余、清单 taskId 不在任务列表内 → 错误页与错误码；
3. 既有 `p11-local-runtime-page.spec.tsx` 全部保持通过。

## 6. 收口与停止

- 收口条件：web focused 全绿、运行时/启动器回归保持、typecheck/build 通过、全量如实记录、BROWSER 证据留存（截图 + 说明其层级）；同步工作日志、状态摘要并提交。
- 停止条件：需改生产控制器/契约/迁移/门禁、需专业内容、需放开 G2/G3/真人、范围扩大或基础设施异常。
