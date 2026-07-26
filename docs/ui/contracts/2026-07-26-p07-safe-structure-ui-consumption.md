# P07 Safe-Structure UI Consumption Contract

状态：待产品部独立复核；本文不是验收证据，不表示正式开工签字或生产门禁已通过。

## 已冻结的消费边界

- USER 主题和 bearer token 只来自恢复后的真实 identity session；UI 不从 URL、persona、fixture 或本地常量派生 accountId。
- `GET /api/v1/onboarding/consents/current` 的 `CURRENT_CONSENT_AVAILABLE` 只渲染服务端返回的 `content.format=PLAIN_TEXT` 与 `content.text`。缺失、畸形或 503 不显示同意操作。
- `POST /api/v1/onboarding/consents` 只发送 `{ consentVersion }`。成功后重新恢复 identity session，由服务端 `nextAction` 决定后续页面。
- `GET /api/v1/onboarding/screening-status` 只消费 `SCREENING_STATUS_AVAILABLE` 的 `nextAction` 与受信结论枚举；不展示筛查题、规则、阈值、诊断或专业正文。
- `WAIT_FOR_SCREENING_RULES`、`WAIT_FOR_HUMAN_REVIEW`、`STOP_SERVICE_FLOW`、`WAIT_FOR_PLAN` 的展示由服务端读取结果驱动；路由动作与读取结果冲突时进入 `CONTACT_OPERATIONS`。
- `GET /api/v1/onboarding/profile` 仅在返回有效 `schemaVersion`、有序 `steps`、每步批准的 `fields`、`recordVersion`、`completedSteps`、`currentStep` 和本人 `drafts` 时生成表单。控件只支持冻结的 `STRING | NUMBER | BOOLEAN` 结构类型，不为字段增加本地业务含义。
- `PUT /api/v1/onboarding/profile/steps/{step}` 只发送 `{schemaVersion, expectedVersion, data}`。保存成功后重新读取 profile 并恢复 identity session；409 保留本地输入，且仅在服务端 `recoverableActions` 含 `REFRESH` 时开放刷新服务端版本。
- schema、步骤、字段、draft 类型或步骤引用缺失、重复、越界、冲突时进入 `PROFILE_SCHEMA_UNAVAILABLE`，不渲染部分表单，也不回退 fixture 字段。
- `RETRY`、`REFRESH` 仅在同一次服务端结构化错误的 `recoverableActions` 明确包含时显示；HTTP 状态、网络错误或 errorCode 本身不能推断恢复动作。
- 未知或畸形响应统一进入保守联系运营态。

## 与最终产品要求的分层

PRD 对未来 P08/P07 的完整专业内容、经审核正文和用户确认要求继续有效。当前本地切片只消费批准的结构 schema，不解释字段的专业含义；它不代表专业内容验收完成，也不替代专业审核或真人批准。

当前拒绝原因 taxonomy 未获产品批准；本切片不收集细分原因，也不从客户端推导专业含义。任何未来细分都必须另行取得产品批准并更新契约。
