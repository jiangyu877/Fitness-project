# P12 周反馈结构契约（首个切片，场景计划）

- 场景：`P12-WEEKLY-FEEDBACK-STRUCTURE`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 对话中批准（"开始 p12"，对应此前建议的 `P12-WEEKLY-FEEDBACK-SKELETON`）
- 基线：提交 `9e078f19`
- 写入者：ZCode（单场景唯一写入者）；无外部独立审查线程，产品负责人接受 ZCode 自审验收（`SELF_REVIEW_COMPLETE`）

## 1. 授权范围（冻结）

```text
SCENE: P12-WEEKLY-FEEDBACK-STRUCTURE
OBJECTIVE: 以 test-only fixture 契约冻结周反馈的结构：周窗口推导、反馈字段清单、数据事实→充分性的注入式判定、数据不足时的调整结果硬限制（PRD §6.4）、提交状态与采纳记录结构；全部 fail closed。
ALLOWED: 新增 test-only fixture support 与命名测试、场景工程计划、工作日志/状态摘要同步。
EXCLUDED: 生产 endpoint/迁移/wiring、专业规则与量表/文案、UI 页面与产品语义、周调整草案生成与双审/双确认接线（下一 P12 切片）、风险规则、G2/G3/真人/release。
REQUIRED_EVIDENCE: 真实 RED（正例在脚手架下失败）→ GREEN；focused 命名测试；既有回归；typecheck/build；全量单 worker。
INDEPENDENT_REVIEWS: 无独立线程时保持 `SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）。
STOP: 需定义专业内容或量表、需改生产代码/迁移/UI、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结依据（PRD / 目录语义）

- **周反馈字段（PRD §6.4）**：执行、训练表现、睡眠、精力、饥饿、压力、恢复、疼痛、选填身体趋势 → 9 个结构字段 ID（无量表、无文案；身体趋势为唯一选填项）。
- **数据不足硬规则（PRD §6.4）**："数据不足时，系统和运营不得用'收紧能量、增加训练量或提高强度'作为调整结果；优先解决执行阻力，或保持核心计划。" → 结构采用 fail-closed 读法：数据不足时允许的结果仅 `KEEP_CORE_PLAN` / `RESOLVE_EXECUTION_FRICTION`；`TIGHTEN_ENERGY` / `INCREASE_TRAINING_VOLUME` / `INCREASE_TRAINING_INTENSITY` 及一切未知结果一律阻断。**数据充分性阈值与充分时的完整变化边界属专业门禁，不在本切片。**
- **页面目录语义（`page-catalog.ts` H5-REC-05）**：入口条件"反馈窗口已开放"、动作"提交执行与恢复反馈"、空态"显示下次开放时间"、阻断态"疼痛进入人工风险处理"、出口"进入调整等待状态" → 结构状态：`WINDOW_CLOSED` / `RISK_HANDOFF`（疼痛）/ `ADJUSTMENT_PENDING`（提交成功）。窗口开闭本身作为**输入事实**（不在本切片发明计时规则）。
- **疼痛路由的结构编码**：疼痛为必收集字段，其值采用结构枚举 `CLEAR | REPORTED`（与既有 `risk_state` 机器词表同形），`REPORTED` 触发 `RISK_HANDOFF`；真实量表/阈值属专业门禁，不在本切片。
- **服务周期（PRD §2.2）**：连续四周 → 周窗口推导以 4 周 × 7 天为上限，业务日期沿用 Asia/Shanghai 约定（与 P10/记录仓储一致）。
- **数据事实→充分性**：采用 P07 注入式 provider 形态——fixture 接受结构事实（如已记录天数）与注入的 test-only 判定函数；判定函数缺失、抛错或返回未知值一律 fail closed 视为 `INSUFFICIENT`。

## 3. RED 判定

- 新增命名测试 `apps/api/test/p12-weekly-feedback.fixture.spec.ts`，配套 support `apps/api/test/support/p12-weekly-feedback.ts` 先以 RED 脚手架存在（提交一律返回阻断，无采纳记录）；
- 运行 focused：正例（窗口开放 + 数据充分 + 合法结果的提交进入 `ADJUSTMENT_PENDING` 并记录采纳）必须失败；记录原始失败输出为 RED。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED | `npx --no-install vitest run apps/api/test/p12-weekly-feedback.fixture.spec.ts --maxWorkers=1 --minWorkers=1` | 正例失败 | `API_FAKE` | **已完成（2026-09-18）：脚手架下 `6 failed / 2 passed (8)`（提交路径全部失败，纯结构两项通过）** |
| GREEN | 同上 | 全部通过 | `API_FAKE` | **已完成：`8/8 passed`（4ms）** |
| 回归 | plan-lifecycle + p10 + p11 消息 fixture focused | 保持通过 | 混合 | **已完成：`3 files / 43 tests` 通过** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `68/68 files`（新增 1 文件），0 失败；临时库归零 | 混合 | **已完成：`68/68 files`、`819/819 tests`、`EXIT=0`，临时库 `lianban_%` = 0** |
| FROZEN | 生产代码、迁移、UI、P11/P10 文件、其他场景 | 不修改 | — | 冻结 |

## 5. 命名测试清单（冻结）

1. 周窗口：4 周 × 7 天自窗口首业务日期起（Shanghai）；不足 28 天取部分末周；超过 28 天截断为 4 周；
2. 字段清单：9 个 ID 冻结，`bodyTrend` 选填、其余必填；
3. 提交正常路径：窗口开放 + 必填齐全 + 判定充分 + 合法结果 → `ADJUSTMENT_PENDING` + 采纳记录 `{weekIndex, outcome, submittedFieldIds}`；
4. 窗口关闭 → 阻断 `WINDOW_CLOSED`；
5. 疼痛字段为 `REPORTED` → `RISK_HANDOFF`，不产生调整与采纳记录；
6. 数据不足 + 三个 PRD 禁止结果 → 阻断 `ADJUSTMENT_OUTCOME_BLOCKED`，`allowedActions = [KEEP_CORE_PLAN, RESOLVE_EXECUTION_FRICTION]`；
7. 数据不足 + `KEEP_CORE_PLAN` → 允许并进入 `ADJUSTMENT_PENDING`；
8. fail closed：缺必填字段、未知字段 ID、未知结果、判定函数缺失/抛错/返回未知值 → 一律阻断且无采纳记录。

## 6. 收口与停止

- 收口条件：命名测试全绿、回归保持、typecheck/build 通过、全量单 worker 如实记录；同步工作日志、验收台账 P12 说明与状态摘要并提交。
- 停止条件：需定义专业内容/量表、需改生产代码/迁移/UI、需放开 G2/G3/真人、范围扩大或基础设施异常。
- 审查：`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）。
