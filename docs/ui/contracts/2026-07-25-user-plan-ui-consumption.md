# USER 计划 UI 消费需求

日期：2026-07-25  
状态：current/history/detail/pending/scheduled 与 USER 确认/拒绝已接入  
所有者：UI 部

本文只记录 UI 消费边界，不定义或批准 API 地址、服务端权限、生命周期规则或数据库结构。产品语义以 `docs/product/lianban-v1.0-prd.md` 和计划生命周期验收附件为准，正式技术契约由研发部维护。

## 1. 已消费的真实读取

- USER 身份恢复结果必须由服务端返回并校验非空 `accountId`、`accountType=USER`、`activeRole=USER`；UI 将同一次恢复成功使用的 token 与 `accountId` 显式传给计划客户端。
- current 返回 `businessStatus=CURRENT_PLAN` 且包含计划，或 `businessStatus=PLAN_GAP` 且 `plan=null`。
- current 的计划必须为 `ACTIVE`。history/detail 只接受用户可见的 `PENDING_CONFIRMATION`、`SCHEDULED`、`ACTIVE`、`USER_REVISION_REQUIRED`、`CONFIRMATION_TIMED_OUT`、`SUPERSEDED`；`DRAFT`、`IN_REVIEW`、`READY_TO_PUBLISH`、`STAFF_REVISION_REQUIRED` 等内部状态一律视为畸形响应。
- history 返回本人计划版本列表；每项导航到可恢复的 `/h5/plans/detail/{versionId}` 详情 URL。URL 只提供版本标识，detail 始终使用服务端恢复的可信 USER `accountId/token` 调用 API，不接受 URL userId 作为身份。
- 计划版本至少包含 `id`、`userId`、`status`、`confirmationDeadlineAt`、`effectiveAt`、`effectiveTo`、`dietConfirmed`、`trainingConfirmed`。UI 将 `id` 作为不可变版本标识；若后续增加独立展示用 `version`，不得改变 `id` 的并发与追溯语义。
- 响应中的 `userId` 必须与已恢复的本人 `accountId` 一致；未知 business status、未知 plan status、跨用户对象或畸形响应进入 `PLAN_RESPONSE_INVALID` 保守阻断。

## 2. pending/scheduled 已冻结读取

UI 使用身份恢复返回的可信 `accountId` 调用本人 pending 读取。UI 不从 history 排序、时间或多条状态中推断唯一 pending。

当前消费结果：

- `PLAN_PENDING_CONFIRMATION` + `PENDING_CONFIRMATION`：展示版本、生效时间、截止时间、饮食/训练确认状态和服务端 `allowedActions`；
- `PLAN_WAITING_EFFECTIVE` + `SCHEDULED`：明确“确认不等于立即生效”，且 `allowedActions` 必须为空；
- `NO_PENDING_PLAN` + `plan=null`：明确空态并返回当前计划入口；
- plan 只接受 `version`、`status`、`effectiveAt`、`confirmationDeadlineAt`、`dietConfirmation`、`trainingConfirmation`、`allowedActions`；出现草案、审核、审核者、作者或专业内容字段时保守阻断；
- `allowedActions` 只接受 `CONFIRM_DIET`、`REJECT_DIET`、`CONFIRM_TRAINING`、`REJECT_TRAINING`。
- `SCHEDULED` 必须双部分均为 `CONFIRMED` 且动作为空；`PENDING_CONFIRMATION` 中每个 `PENDING` 部分必须且只能包含该部分的确认与拒绝动作对，每个 `CONFIRMED` 部分不得包含动作。重复、缺失、多余或交叉动作均进入 `PLAN_RESPONSE_INVALID`。

`H5-PLN-01` 首帧只显示中性加载态，不读取 demo persona、不从 history 推断，也不展示专业计划内容。

P08 最终产品要求仍是向用户展示经专业审核的完整待确认计划并确认。当前本地切片因专业内容和相应详情 API 尚未获批，仅完成状态摘要、确认状态和冻结写交互，不代表 P08 最终内容验收完成。

## 3. 已接入的 USER 写操作

UI 仅在 pending 摘要的 `allowedActions` 明确包含同名动作时调用 `POST /api/v1/plan-versions/{version}/transitions`：

- `CONFIRM_DIET`、`CONFIRM_TRAINING`、`REJECT_DIET`、`REJECT_TRAINING` 与服务端 action/type 一一对应；
- body 仅发送 `type`，不发送 `occurredAt`、`reasonCode`、`expectedStatus` 或存储版本；
- 每次请求发送 USER bearer token、唯一非空 `x-request-id`、非空 `idempotency-key` 和 JSON Content-Type；
- 同一次用户意图的网络重试复用同一个 `idempotency-key` 和完全相同的 `{type}` body；新的用户意图才创建新键；服务端拥有可信转换时间并决定所有截止状态；
- 提交期间禁用所有当前动作，防止重复点击形成并发意图；
- HTTP 200 的完整计划版本响应不进入 UI 状态，也不展示其中的专业、审核或人员字段；UI 随即重新 GET 本人 pending 摘要，只按最新 `businessStatus`、确认状态与 `allowedActions` 呈现；
- UI 不根据本机时间判断截止、超时、冲突、退回、等待生效或激活，不本地模拟任何成功状态；
- 拒绝饮食或训练任一部分的产品含义均为拒绝整版，不提供原因选择，不展示或推断细分原因。
- 拒绝原因 taxonomy 尚未获得产品批准；未来任何细分原因或补充说明必须另行取得产品批准，不能从当前通用整版拒绝契约扩展推断。

稳定错误消费：

- `VERSION_CONFLICT`、`PLAN_PART_ALREADY_DECIDED`：刷新 pending；
- `STATE_TRANSITION_NOT_ALLOWED`：刷新 pending 或查看历史；
- `IDEMPOTENCY_KEY_REUSED`：返回 pending 后由用户重新发起新意图；
- `CONFIRMATION_DEADLINE_PASSED`：联系团队创建新版本；
- `SESSION_INVALID`：重新登录；
- `ROLE_NOT_AUTHORIZED`、503、未知或畸形响应：保守阻断并联系运营；
- 仅当服务端结构化 `recoverableActions` 明确包含 `RETRY` 时提供“重试同一操作”，并严格复用原意图；网络错误代码或 HTTP 状态本身不能推导重试。

## 4. UI 保守行为

- 缺少可信 USER 会话：不发计划请求，显示联系运营。
- 首次 current/history/pending/detail 读取仅在稳定恢复动作明确包含 `RETRY` 时提供“重试读取”，并重放同一可信读取语义；权限、跨用户、未知或畸形响应不提供该重试。
- `503`、未知/冲突响应或跨用户对象：清空当前计划内容，显示错误代码和 requestId（若有）。
- pending 缺少或包含未知 `allowedActions`：按畸形响应阻断；current/history 缺少动作时保持只读。
- pending 首帧只显示中性读取/等待状态，不能出现 persona、demo warning、mock 计划内容或本地 plan-demo 交互。
- history 和 detail 永远只读；不得通过 UI 恢复历史版本或修改已发布版本。
