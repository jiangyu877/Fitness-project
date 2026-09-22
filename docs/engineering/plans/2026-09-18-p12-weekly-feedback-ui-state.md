# P12 周反馈 UI 状态（第三个切片，场景计划）

- 场景：`P12-WEEKLY-FEEDBACK-UI-STATE`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 对话中批准（"继续后续任务"，对应 P12 后续候选 1）
- 基线：提交 `e0e1b6bd`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: P12-WEEKLY-FEEDBACK-UI-STATE
OBJECTIVE: 以 test-only UI 状态切片冻结 H5-REC-05 周反馈页面的渲染契约：严格解析服务端视图信封、由冻结事实派生显示状态、动作完全由服务端 allowedOutcomes 驱动、全部 fail closed。
ALLOWED: 新增 apps/web/src/features/weekly-feedback-real/**（视图解析/状态派生/页面与命名测试）、场景工程计划、工作日志/状态摘要同步。
EXCLUDED: 生产路由与 client/transport、专业量表与文案、风险规则、周调整 source_type 生产接线、phase3 占位页与其他既有 UI、G2/G3/真人/release。
REQUIRED_EVIDENCE: 真实 RED（脚手架下失败）→ GREEN；focused 命名测试；既有 Web 测试回归；typecheck/build；全量单 worker。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改生产路由/迁移/既有 UI、需新增专业文案或量表、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计与依据

- **服务端权威（P11 既有纪律）**：动作（`allowedOutcomes`）与字段清单（`fields`）全部来自服务端信封，UI 不自行推导；解析严格（精确键、枚举、类型、唯一性），未知或畸形一律 fail closed（`WEEKLY_FEEDBACK_VIEW_INVALID`），不回退占位状态。
- **视图信封（冻结字段）**：`windowState('OPEN'|'CLOSED')`、`weekIndex`（正整数）、`sufficiency('SUFFICIENT'|'INSUFFICIENT')`、`painState('CLEAR'|'REPORTED')`、`submissionState('NONE'|'ADJUSTMENT_PENDING')`、`nextWindowAt`（`CLOSED` 时必须为非空字符串、`OPEN` 时必须为 `null`）、`fields[{id, required}]`（非空、id 唯一）、`allowedOutcomes`（非空字符串数组、可空、id 唯一）。
- **显示状态优先级（冻结）**：`RISK_HANDOFF`（疼痛）> `ADJUSTMENT_PENDING`（调整等待）> `WINDOW_CLOSED`（下次开放时间）> `INSUFFICIENT_DATA`（数据不足保持当前方案）> `FORM_OPEN`。前三者强制 `allowedOutcomes = []`（矛盾信封 fail closed）。
- **文案来源**：仅使用冻结的页面目录语义与既有占位页文本（"显示下次开放时间""疼痛进入人工风险处理""进入调整等待状态""数据不足时保持当前方案""周反馈"），不新增专业文案。
- **不修改**：`phase3-pages.tsx` 占位页、页面目录、既有 `*-real` 功能目录、生产路由、迁移。

## 3. RED 判定

- 新增 `weekly-feedback-view.ts` 与 `weekly-feedback-page.tsx` 先以脚手架存在（解析一律抛错、派生返回固定 `WINDOW_CLOSED`、页面恒渲染阻断态）；
- 运行 focused：状态派生、表单渲染、动作与文案断言必须失败，记录原始输出为 RED。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED | `npx --no-install vitest run apps/web/src/features/weekly-feedback-real --maxWorkers=1 --minWorkers=1` | 正例失败 | `UI_STATE` | **已完成（2026-09-18）：脚手架下 `8 failed / 2 passed (10)`** |
| GREEN | 同上 | 全部通过 | `UI_STATE` | **已完成：`2 files / 10 tests passed`（view 4 + page 6）** |
| Web 回归 | 既有 messages-real / p11-real focused | 保持通过 | `UI_STATE` | **已完成：`8 files / 99 tests` 通过** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `70/70 files`（新增 2 文件），0 失败；临时库归零 | 混合 | **已完成：`70/70 files`、`830/830 tests`、`EXIT=0`，临时库 `lianban_%` = 0** |
| FROZEN | 生产路由/迁移/占位页/既有功能目录 | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

视图（`weekly-feedback-view.spec.ts`）：
1. 合法信封解析通过并保留服务端字段与动作顺序；
2. 严格拒绝：缺键/多键、未知枚举、`weekIndex` 非正整数、`nextWindowAt` 规则违反、`fields` 空或重复 id、`allowedOutcomes` 非字符串/重复；
3. 状态优先级：疼痛 > 调整等待 > 窗口关闭 > 数据不足 > 表单开放；
4. 前三态强制 `allowedOutcomes = []`；`INSUFFICIENT_DATA`/`FORM_OPEN` 透传服务端动作。

页面（`weekly-feedback-page.spec.tsx`）：
5. 畸形信封 → 阻断页（`weekly-feedback-blocked` + `WEEKLY_FEEDBACK_VIEW_INVALID`）；
6. 各状态渲染对应 testid 与冻结文案（下次开放时间、疼痛处理、调整等待、数据不足提示）；
7. 表单按 `fields` 渲染（必填字段带 `required`），按钮仅来自 `allowedOutcomes`，点击调用 `onSubmit(outcome)`；
8. 非可提交状态不渲染任何按钮。

## 6. 收口与停止

- 收口条件：命名测试全绿、Web 既有回归保持、typecheck/build 通过、全量单 worker 如实记录；同步工作日志、验收台账 P12 说明、状态摘要并提交。
- 停止条件：需改生产路由/迁移/既有 UI、需新增专业文案、需放开 G2/G3/真人、范围扩大或基础设施异常。
