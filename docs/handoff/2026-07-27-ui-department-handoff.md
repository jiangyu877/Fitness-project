# 练伴 V1.0 UI 部交接（2026-07-27）

## 1. 快照与事实源

- 唯一工作目录：`D:\project\Fittness project`。
- 当前 HEAD：`6b718594ad010897979afa0df243889fc228ba09`（`Advance P07 acceptance ledger with regression evidence`）。
- PRD 是唯一产品事实源；验收状态以当前产品验收台账、真人门禁和专项验收文件为准。
- UI 实现与消费契约以当前 `apps/web/**`、`docs/ui/**` 和自动化测试为准。旧 handoff 只作历史背景。
- 当前结论：`readyForRealUsers=false`；G2、G3 均未批准，不得据此宣称可面向真人或生产发布。

## 2. 文件所有权与操作边界

- UI 部所有权：`apps/web/**`、`docs/ui/**`。
- 产品部所有权：`docs/product/**`。
- 研发部所有权：`apps/api/**`、`packages/**`、`docs/engineering/**`。
- 本文件是本次交接唯一获准新增的 `docs/handoff/**` 文件。
- 后续 UI 会话不得修改研发或产品文件，不得回退其他部门改动；本批及交接均不得暂存或提交。

## 3. 已完成的 UI 本地切片

### P07 安全结构

- 当前授权正文只消费服务端 `CURRENT_CONSENT_AVAILABLE`；接受请求体精确为 `{ consentVersion }`，UI 不内置正式授权正文。
- USER 筛查状态只读，消费服务端 `nextAction`，不写筛查结论、不展示诊断规则或阈值。
- profile 仅在服务端返回完整、通过严格解析的批准 schema 后渲染；步骤、字段、顺序、类型、必填性、完成状态和本人草稿均来自服务端。
- profile 保存体精确为 `{ schemaVersion, expectedVersion, data }`，并携带 USER bearer、非空 `x-request-id` 和稳定幂等键；不硬编码正式 profile 字段或业务含义。
- 保存成功后权威重读 profile，并重新恢复 identity session；UI 不在本地推演完成状态或 `nextAction`。
- identity 恢复消费服务端五态及其他冻结动作：`WAIT_FOR_SCREENING_RULES`、`WAIT_FOR_HUMAN_REVIEW`、`STOP_SERVICE_FLOW`、`COMPLETE_PROFILE`、`WAIT_FOR_PLAN`，以及 `ACCEPT_CURRENT_CONSENT`、`CONTACT_OPERATIONS`。

### P08/P09/P10 真实计划读写

- 真实计划流程显式使用 `GET /api/v1/identity/session` 恢复的 USER `accountId` 和 token；不从 URL、demo persona 或本地常量派生身份。
- current 仅接受 `CURRENT_PLAN + ACTIVE`，或 `PLAN_GAP + plan:null`；history/detail 阻断草案、审核中和其他 USER 不可见内部状态。
- pending 严格接受 `PLAN_PENDING_CONFIRMATION`、`PLAN_WAITING_EFFECTIVE`、`NO_PENDING_PLAN`，并校验确认状态与 `allowedActions` 的精确组合。
- 四类确认/拒绝 transition 请求体只含 `{ type }`；不发送 `occurredAt`、`reasonCode`、actor、role 或客户端时间。同一用户意图的网络重试复用幂等键。
- transition 成功后重新读取本人 pending 摘要，仅按最新服务端 `businessStatus`、状态和 `allowedActions` 呈现。
- history/detail 保持只读；详情深链只从 URL 读取版本标识，授权身份仍来自可信 USER session。
- 未知、畸形、冲突身份或越权数据均 fail closed；真实路由不回退 phase3 demo 或本地 plan-demo。

## 4. 关键实现决策

- `currentStep === null` 是服务端权威完成态。UI 不得回退到首步编辑；必须清空本地字段值、隐藏或禁用编辑/保存控件，并恢复 identity session 取得最新 `nextAction`。
- 初次 profile 读取失败，或保存后的权威 profile 重读失败，必须清除或禁用 stale editable state 并 fail closed。不得继续展示可提交的旧表单。
- 只有 409 版本冲突路径可以保留本地输入；随后是否显示 `REFRESH` 仍严格取决于服务端结构化 `recoverableActions`。
- identity、计划读取/写入和 P07 读取/保存的 `RETRY` / `REFRESH` 控件，只在服务端 `recoverableActions` 明确包含对应动作时显示。不得仅凭 HTTP 状态、`NETWORK_ERROR` 或客户端推断开放恢复动作。
- 默认 identity client 仅把 token 和 expiry 持久化到 `sessionStorage`。`accountId`、account type、active role 和 `nextAction` 每次都由 `GET /api/v1/identity/session` 权威恢复；持久化数据和 URL 均不是授权身份依据。
- 可恢复计划详情 URL 支持硬刷新/分享/消息深链；URL 只提供版本标识。session 无法权威恢复时安全失败，不读取或展示计划。

## 5. 最近自动化证据

- Web 全量：19 个测试文件，`234/234` 通过。
- Web typecheck：通过。
- Web production build：通过。
- production-bundle 检查：通过。
- identity 路由焦点同步修复后，根测试曾取得 30 个测试文件、`337/337` 通过；焦点断言使用 `waitFor(() => expect(summary).toHaveFocus())` 等待 mount effect 完成。
- 上述结果是本地自动化回归证据，不等于产品验收、真人可用性验收或发布批准。

## 6. 未完成与阻塞

- P07 仍为“施工中”。正式授权内容、专业筛查规则、隐私批准的生产 schema、真实 PostgreSQL/真实环境和外部门禁尚未形成完整真人验收证据。
- P08 仍为“施工中”。当前只实现冻结的 pending 状态摘要和真实状态交互；经专业审核的完整待确认计划内容及对应详情契约尚未完成最终验收。
- P09 仍为“施工中”。本地唯一性、不可变历史和 gap 行为已有自动化证据，但真实 PostgreSQL 并发和最终联合验收未完成。
- P10 仍为“施工中”。有效 ACTIVE 边界已有本地证据，专业任务内容和完整 Today 工作流未完成。
- P11 为“未开始”。UI 不得内置或猜测专业饮食/训练字段、单位、示例、阈值、结论或业务规则；必须等待经专业批准、带版本的机器 schema/契约。
- P19 为“未开始”。
- 尚无 360 / 390 / 430 三个 H5 视口的真人浏览器运行证据。
- 尚无 1024 / 1280 / 1440 三个 Web 视口的真人浏览器运行证据。
- 尚无 Chrome + 键盘、Edge + 键盘、Narrator + Edge 的真人运行证据。
- 尚无 200% 缩放和 reduced-motion 的完整真人验收证据。

## 7. 下一会话入口

1. 先核对当前 HEAD、工作树和产品事实源是否变化，不以本文件覆盖更新后的 PRD、台账或门禁结论。
2. 保持 `readyForRealUsers=false`，直到产品部明确完成最终联合验收并批准相应门禁。
3. 继续修改前严格遵守 UI 所有权；任何授权正文、profile 字段、筛查规则/阈值、专业计划字段/单位/结论、安全文案、隐私口径或生产门禁缺口，均停止猜测并回报产品部。
4. 所有业务状态、权限、截止、激活和恢复动作继续由服务端结构化响应驱动；未知或畸形响应统一保守阻断并联系运营。
