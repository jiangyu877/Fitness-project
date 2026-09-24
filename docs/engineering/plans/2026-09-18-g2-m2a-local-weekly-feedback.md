# G2-M2a 本地运行时周反馈面与页面（场景计划）

- 场景：`G2-M2A-LOCAL-WEEKLY-FEEDBACK`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 确认 G2 大目标与路径 C，并要求继续（"继续"）；本切片为 M2 的首个实现切片
- 基线：提交 `2d604027`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: G2-M2A-LOCAL-WEEKLY-FEEDBACK
OBJECTIVE: 在本地 test-gated 运行时新增周反馈面（视图信封 + 提交）与 H5 周反馈页：复用 P12 契约与 P12 UI 模块，提交后进入 ADJUSTMENT_PENDING；全部 fail closed。
ALLOWED: 修改 apps/api/test/support/p11-local-operable-runtime.ts（新增 /p11-local/weekly-feedback GET/POST，复用 p12-weekly-feedback 契约与生成任务数据）、新增 apps/web/src/features/p11-local/p11-local-weekly-feedback-page.tsx 与其规格、app.tsx 增加受 VITE_P11_LOCAL_RUNTIME 门控的 /h5/p11-local/weekly-feedback 路由分支、运行时规格追加用例、浏览器证据、场景计划与工作日志/状态摘要同步。
EXCLUDED: 四层 test-only 门禁放松、迁移、生产控制器/契约/OpenAPI、既有页面与既有规格改动、周调整版本生命周期接线（M2b）、专业内容与量表、G3/真人/release。
REQUIRED_EVIDENCE: 真实 RED → GREEN；运行时 focused（PG18）与 web focused；既有回归；typecheck/build；全量单 worker；BROWSER 层证据（运行时启动 + 窗口级截图）。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改生产控制器/契约/迁移/门禁、需专业内容、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计

- **视图信封（服务端权威）**：运行时按 persona 产出 P12 视图信封 `{ windowState:'OPEN', weekIndex:1, sufficiency, painState:'CLEAR', submissionState, fields:[{id,required}]（8 必填 + 1 选填）, allowedOutcomes }`；`windowState/weekIndex` 为 demo 输入事实（不发明计时规则），`sufficiency` 由 test-only 策略给出（沿用 P12 注入式判定），`submissionState` 初始 `NONE`、成功提交后 `ADJUSTMENT_PENDING`（运行时内存态）。
- **提交**：`POST /p11-local/weekly-feedback`（`{fixtureId, requestedOutcome, fields}`）经 `createWeeklyFeedbackFixture` 校验：允许 → 记录采纳并置 `ADJUSTMENT_PENDING`；阻断（未知结果/缺字段/判定不可用）→ 返回 `{ outcome:'BLOCKED', reason, allowedActions }`。
- **页面复用**：新本地页拉取信封后，直接以既有 P12 UI 模块（`weekly-feedback-view` 解析 + `weekly-feedback-page` 渲染）呈现，`onSubmit` 调用运行时端点并在成功后重取；不新增 UI 语义。
- **不修改**：既有页面与其规格、生产控制器/契约/迁移/门禁、其他运行时端点语义。

## 3. RED 判定

- 先在运行时规格与 web 规格各追加命名用例 → 运行必须失败（端点 404 / 模块缺失），记录原始输出为 RED。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED（API） | `npx --no-install vitest run apps/api/test/p11-local-operable-runtime.spec.ts --maxWorkers=1 --minWorkers=1` | 新用例失败 | `PG18_REPOSITORY + CROSS_LAYER_E2E` | **已完成（2026-09-18）：新用例失败（端点缺失）、既有 6 项通过** |
| RED（Web） | `npx --no-install vitest run apps/web/src/features/p11-local --maxWorkers=1 --minWorkers=1` | 新规格失败 | `UI_STATE` | **已完成：新规格 `Failed to resolve import`；既有 7 项通过** |
| GREEN | 同上两条 | 全部通过（既有保持） | 混合 | **已完成：`4 files / 16 tests passed`（运行时 7 含新用例、web 9 含新页面）** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `74/74 files`（新增 1 文件），0 失败；临时库归零 | 混合 | **已完成：`74/74 files`、`848/848 tests`、`EXIT=0`，临时库 `lianban_%` = 0** |
| 浏览器 | 启动 `dev:p11-local` + 打开 `/h5/p11-local/weekly-feedback` | 两 persona 周反馈视图可见；提交后进入调整等待 | `BROWSER` | **已完成：运行时真实启动（代理探测 200），真实 Edge 窗口渲染周反馈页（免责声明 + 减脂测试路径 + P12 结构字段表单），窗口级捕获 `docs/engineering/evidence/p11-local-weekly-feedback-2026-09-18.png`；提交动作按钮位于折叠下方（未在截图中），其渲染与提交接线由 `UI_STATE` 命名测试覆盖；一张缩放版截图信息量不足已删除** |
| FROZEN | 生产控制器/契约/迁移/门禁、既有页面与规格、其他端点 | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

1. 运行时：`serves the weekly feedback view and records a submission`——GET 返回两 persona 信封（`windowState:'OPEN'`、`weekIndex:1`、9 字段、`allowedOutcomes` 非空、`submissionState:'NONE'`）；POST 合法结果 → `ADJUSTMENT_PENDING` + 采纳记录；重取 GET 显示 `submissionState:'ADJUSTMENT_PENDING'`；POST 未知结果 → `BLOCKED`（`allowedActions` 为空或受限集）；
2. Web：`renders the weekly feedback view for both personas and submits the selected outcome`——两 persona 各自渲染 P12 状态（表单/字段/动作按钮），点击动作 → 以该 persona 与结果 POST，成功后重取并显示调整等待；畸形信封 → 失败态；
3. 既有运行时/今日页/运行时页规格保持通过。

## 6. 收口与停止

- 收口条件：两条 focused 全绿、既有回归保持、typecheck/build 通过、全量如实记录、BROWSER 证据留存（窗口级、无桌面内容）；同步工作日志、状态摘要并提交。
- 停止条件：需改生产控制器/契约/迁移/门禁、需专业内容、需放开 G2/G3/真人、范围扩大或基础设施异常。
