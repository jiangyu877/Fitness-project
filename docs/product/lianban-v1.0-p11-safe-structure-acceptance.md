# 练伴 V1.0 P11 每日记录安全结构验收附件

版本：0.3  
日期：2026-07-27  
所有者：产品部  
状态：最小双端 fail-closed 表面、test-only PostgreSQL 18 persistence 与 API pre-wiring 授权切片已形成；完整成功业务闭环仍未授权

## 1. 文档效力

本文细化 `docs/product/lianban-v1.0-prd.md` 的 P11，以及 P10 当前计划任务准入之后的每日记录安全结构。发生冲突时以 PRD 为准。

本文只定义可信作用域、状态边界、版本化结构、写入一致性、错误恢复和可观察验收结果，不定义 API 地址、数据库结构、饮食或训练专业字段、单位、次数、组次、强度、偏离原因、疼痛阈值、补录时限、安全文案、处方或调整规则。

历史 UI 规格、fixture、API 草案或工程计划中出现的任何专业字段和示例，均不得作为本批实现依据。只有具名专业责任方批准且带版本的正式证据，才能在后续附件中授权对应语义。

## 2. 本批目标

在不引入任何未批准专业内容的前提下，建立 P11 的双端安全结构：

1. 只有可信 USER 本人、唯一有效当前计划和该计划生成的可记录任务可以进入记录流程。
2. 服务端以不可变、版本化 provider/schema 描述当前允许的记录结构和动作；UI 不内置字段或业务含义。
3. 未批准、缺失、异常、畸形或版本不一致的 provider/schema 必须在业务写入前 fail closed。
4. 写入具备主体与任务作用域幂等、乐观并发、确定的乱序处理、重复提交防护和结构化审计。
5. 已关闭日期或已关闭任务只读；读取不得改变任务、记录、计划、幂等或审计状态。
6. 减脂与增肌两条虚构路线使用同一权限、状态和错误语义，不形成按目标、姓名或固定用户 ID 分叉的业务逻辑。

本批完成只代表 P11 安全结构形成，不代表饮食三态、训练逐组或事后补录的专业业务内容完成，P11 总体仍保持“施工中”。

## 3. 明确排除

本批不得定义、实现或从历史材料沿用：

- 饮食记录字段、三态的机器值、偏离原因或补充说明字段；
- 训练动作、组记录字段、单位、重量、次数、主观用力、休息、完成判定或摘要；
- 实时记录与事后补录的专业差异、允许补录时间、覆盖优先级或合并规则；
- 疼痛、红旗、恢复不良的阈值、暂停范围、恢复条件、安全文案或响应 SLA；
- 热量、食物、动作、组次、强度、频率、周期、处方或周调整语义；
- 任意 JSON 作为真人记录入口，或把 demo fixture、测试 provider 当作正式 schema；
- 客户端根据 URL、缓存、计划展示内容、persona、姓名或用户 ID 推断记录权限；
- 真人账号、真人数据、真实专业记录、外部数据库迁移、staging、生产、G2 或 G3 放行。

自动化测试可以显式注入仅供 `test` 环境使用的虚构 schema，以验证结构允许分支。虚构 schema 必须带测试用途标识，不得出现在非测试 provider、生产构建业务路径或真人就绪证据中。

## 4. 权威状态与作用域

记录入口必须同时满足以下服务端事实：

1. 请求来自有效 USER 会话，主体身份只取可信 session；
2. 目标任务属于该 USER；
3. 任务来源是可信当前时间窗口内唯一有效的 `ACTIVE` 计划；
4. 目标业务日期与任务日期由服务端事实确定；
5. 任务处于可记录状态，且日期和任务尚未关闭；
6. 当前记录 schema/provider 已获对应环境允许，且版本与任务绑定版本一致；
7. route guard、真人门禁和依赖状态没有冲突或未知值。

任一条件不满足时必须在记录、幂等成功结果和成功审计产生前拒绝。待确认、等待生效、已拒绝、已超时、已替代、未来、过期、计划空档、多个 ACTIVE、风险暂停或归属冲突均不得产生可写记录入口。

上述 USER、任务归属、唯一 ACTIVE 计划、业务日期、任务开闭、风险、schema/provider 和 route/readiness 门禁事实，必须在同一写事务或具备等效保证的序列化边界内，于成功幂等 claim 和记录写入前重新读取并共同判定。事务外预检只能用于提前拒绝，不能作为最终写入授权事实；计划替换、风险暂停、任务关闭或门禁变化不得在检查与写入之间形成可利用窗口。

客户端提交的用户 ID、角色、当前时间、计划状态、任务归属、日期开闭状态或 schema 批准状态均不得成为可信授权事实。

## 5. 版本化结构边界

1. provider 在应用启动或受控加载边界完成结构校验，并形成不可变快照；调用方后续 mutation 不得改变运行时 schema。
2. schema 只描述通用结构元数据和允许动作，不承载未经批准的专业含义。字段集合为空时仍可用于验证阻断和读取状态。
3. UI 只有在完整响应通过严格解析后才能渲染记录控件；未知字段类型、重复标识、空版本、未知动作或部分畸形均整体 fail closed。
4. 每次写入必须携带服务端返回的 schema 版本和记录版本。schema 过期或记录版本冲突不得静默合并、覆盖或自动重试写入。
5. schema 版本变化不得原地重新解释已有记录。已有记录保留其写入时绑定的 schema 版本并只读追溯。
6. 未取得正式专业批准前，非测试环境的真实记录写入始终阻断；不得用“空字段成功写入”规避门禁。

## 6. 写入一致性

### 6.1 幂等

- 幂等作用域至少绑定可信 principal、目标任务、记录类别、业务日期、schema 版本和操作类型。
- 同一作用域、同一请求指纹的重放返回原业务结果，不增加记录版本、不重复审计、不重复触发下游副作用。请求指纹必须覆盖完整、规范化的写入意图，包括预期记录版本以及所有影响业务结果的请求字段；不得遗漏字段而把变更请求误判为重放。
- 同一幂等键用于不同主体、任务、类别、日期、schema 版本、操作或请求指纹时稳定冲突，不泄露其他主体结果。
- 请求标识只用于关联追踪，不得直接充当审计事件 ID 或幂等事实。指纹材料不得包含令牌、凭据或其他与业务意图无关的秘密；持久化指纹不得保留可枚举的原始敏感值。

### 6.2 乐观并发与乱序

- 首次写入和后续更新均由服务端记录版本控制；客户端不得自行生成权威版本。
- 两个基于同一旧版本的并发写入只能有一个成功；另一个返回结构化版本冲突并允许权威刷新。
- 较晚到达的旧请求不得覆盖较新已提交版本；服务端不按客户端时间决定新旧。
- 已成功请求的网络重放按幂等结果处理；更换幂等键但携带旧记录版本仍按版本冲突处理。
- 本批不定义不同记录类别之间的专业合并规则。若一个请求需要此类规则，必须停止而非猜测。

### 6.3 原子性与副作用

- 一次成功写入的记录变更、幂等结果和成功审计必须形成单一原子结果。
- 权限、作用域、状态、schema、版本或门禁拒绝不得产生部分记录、成功幂等结果或成功审计。
- 拒绝审计不得包含记录原始值、未批准专业内容或可枚举的敏感请求指纹。
- 本批不得触发周调整、风险恢复、计划变更或专业结论；这些属于其他验收批次。

## 7. 日期关闭与只读

1. 日期和任务是否关闭只由服务端可信时间与受控状态决定，不接受客户端 `now`、时区或关闭标志。
2. 已关闭日期和任务允许按本人权限读取已存在记录，但所有创建、修改或补录尝试均稳定拒绝。
3. 读取是纯读取，不延长开放期、不激活计划、不创建默认记录、不声明幂等结果、不追加业务成功审计。
4. 本批只定义“关闭后不可写”的结构语义，不定义何时关闭或允许补录多久；具体时限等待专业及运营批准。
5. 在关闭规则未获版本化批准的非测试环境中，真实写入必须 fail closed，不能假定当天、自然日或任意固定小时数可写。

## 8. UI 消费与恢复

1. UI 先恢复可信 USER session，再读取服务端记录上下文；URL 只能提供资源定位标识，不能提供授权身份。
2. UI 只按服务端结构化状态、schema、记录版本、允许动作和 `recoverableActions` 呈现控件。
3. 未批准、未知、畸形、计划空档、非 ACTIVE、风险暂停或关闭状态均清除或禁用 stale editable state，不回退 demo 表单。跨用户、会话主体变化、会话失效或身份无法权威确认时必须清除记录数据、未提交输入和编辑器，不得仅禁用后继续展示前一主体内容。
4. 保存成功后必须权威重读记录上下文；客户端不自行递增版本、不推演任务完成或下一页面状态。
5. 只有结构化 `recoverableActions` 明确包含 `RETRY` 时显示重试，包含 `REFRESH` 时允许刷新服务端版本。HTTP 状态、网络异常或自由文本不得自行开放恢复动作。
6. 只有同一可信主体、同一目标记录的版本冲突可以暂存本地未提交输入供用户比较，但在权威刷新和重新确认前不得再次写入。跨主体、主体不可信或目标归属无法确认时必须清除；其他 fail-closed 路径必须清除或禁用可提交状态。
7. 本批不得显示历史材料中的专业字段、示例或安全文案；无批准 schema 时只显示不可记录状态和产品已批准的通用联系运营入口。

## 9. 稳定错误结果

本附件冻结产品错误类别，不冻结 HTTP 状态、接口地址或具体技术错误码：

| 产品错误类别 | 必须结果 | 可恢复动作边界 |
| --- | --- | --- |
| 未认证或非 USER | 拒绝且零业务写入 | 仅按服务端动作重新认证 |
| 跨用户或目标不存在 | 防枚举拒绝，结果不可区分 | 不开放目标数据刷新 |
| 无唯一有效 ACTIVE 计划 | 计划空档或安全阻断，无可写任务 | 可返回当前计划入口或联系运营 |
| 任务非当前、已关闭或风险暂停 | 只读或阻断，零写入 | 只按服务端允许动作导航 |
| schema/provider 未批准、缺失或畸形 | 整体 fail closed | 默认联系运营；不得本地 fallback |
| schema 版本过期 | 零写入 | 仅服务端明确允许时刷新 schema |
| 记录版本冲突 | 不覆盖较新记录 | `REFRESH` 后重新确认 |
| 幂等键跨作用域或变更请求复用 | 零写入且不返回他人结果 | 使用新的幂等键重新发起新意图 |
| 未知状态、动作或响应 | 保守阻断并清除可提交状态 | 默认联系运营 |

研发部在技术契约中定义稳定机器码；UI 必须按机器码和结构化动作消费，不解析自由文本。

## 10. 验收场景

| 编号 | 场景 | 必须结果 |
| --- | --- | --- |
| P11-01 | provider 缺失、异常、未批准或 schema 畸形 | 无记录控件、零记录写入、零成功幂等结果，进入保守阻断 |
| P11-02 | 有效 USER、唯一 ACTIVE 计划、本人开放任务和虚构测试 schema | 仅测试环境返回版本化记录上下文和允许动作 |
| P11-03 | 匿名、STAFF、跨用户或不存在任务访问 | 稳定防枚举拒绝，零业务副作用 |
| P11-04 | pending、scheduled、rejected、timed out、superseded、future、expired、gap 或多 ACTIVE | 不返回可写任务，不创建默认记录 |
| P11-05 | 客户端伪造用户、角色、时间、日期状态、计划状态或任务归属 | 忽略伪造事实并按服务端事实拒绝 |
| P11-06 | 同一意图重复提交 | 一份业务结果、一个记录版本推进、一条成功审计，无重复副作用 |
| P11-07 | 同一幂等键变更主体、任务、类别、日期、schema、操作或请求 | 稳定冲突，不泄露原结果，不新增记录 |
| P11-08 | 两个请求基于同一记录版本并发写入 | 恰好一个成功，另一个版本冲突，最终记录确定 |
| P11-09 | 较旧请求乱序到达 | 不覆盖较新版本；客户端时间不影响结果 |
| P11-10 | schema 版本变化后提交旧版本请求 | 零写入，要求权威刷新；历史记录仍绑定原 schema 版本 |
| P11-11 | 已关闭日期或任务读取 | 返回本人只读记录；读取零状态副作用 |
| P11-12 | 已关闭日期或任务尝试创建、修改或补录 | 稳定拒绝，原记录、版本和审计成功数不变 |
| P11-13 | 保存成功后 UI 权威重读失败 | 清除或禁用 stale editor，不展示本地推演成功态 |
| P11-14 | UI 收到未知状态、字段类型、动作或畸形响应 | 整体 fail closed，不回退 demo 或硬编码表单 |
| P11-15 | 减脂与增肌虚构路线执行同一场景 | 使用同一状态、权限、幂等和错误语义，无路线硬编码 |
| P11-16 | 任一真人门禁未关闭 | 非测试环境真实记录写入零副作用拒绝，`readyForRealUsers=false` |

本批自动化必须分别证明允许路径和每个拒绝路径的记录、幂等、审计及关联任务副作用。仅断言 HTTP 状态、页面存在或按钮不可见不足以通过验收。

## 11. 部门交付顺序与所有权

### 11.1 产品部

- 维护本文、范围、优先级、验收场景和停止决策；只修改 `docs/product/**`。
- 在研发施工前核对技术契约没有引入专业字段或扩大范围。
- 在 UI 施工前确认服务端机器契约已冻结，不允许 UI 先行发明字段或接口。
- 汇总联合验收证据，但不修改应用、API、数据库或代替专项责任人批准。

### 11.2 研发部

- 仅修改 `apps/api/**`、`packages/**`、`docs/engineering/**`。
- 先用 TDD 建立可观察 RED，再实现 route guard、可信作用域、版本化 provider/schema port、持久化一致性、幂等、并发、只读和审计安全结构。
- 负责定义与本文一致的稳定机器契约，但不得定义任何未批准专业字段、时间阈值或安全语义。
- 数据库变更只允许追加迁移并完成本地兼容验证；不得连接或迁移外部真实数据库。

### 11.3 UI 部

- 仅修改 `apps/web/**`、`docs/ui/**`。
- 在研发机器契约经产品复核后，以 TDD 实现严格解析、服务端动作消费、版本冲突恢复、关闭状态只读和 stale editor 清理。
- 不内置记录字段、单位、示例、补录时限、状态推导或本地成功回退。

### 11.4 专项部门

- 专业审核部核对实现和测试未把虚构 schema、历史字段或示例提升为正式专业规则。
- 安全与隐私部只读审查主体作用域、最小披露、幂等指纹、审计数据和真人门禁；不批准尚缺的专业或合规内容。
- 质量与无障碍部在双端实现后独立验证双虚构路线、键盘、焦点、状态播报及目标视口证据。
- 运营与发布保障部本批只核对没有引入未批准补录时限、SLA、真人数据或部署行为。

## 12. 施工与验收门禁

施工顺序固定为：

1. 用户复核并批准本文；
2. 研发部先写技术契约与 RED 证据，产品部完成一次契约边界复核；
3. 研发部实现最小服务端安全结构并提交本地验证证据；
4. UI 部基于冻结机器契约建立 RED 并实现最小消费闭环；
5. 专项部门分别完成授权范围内的只读审查或运行证据；
6. 产品部核对 P11-01 至 P11-16、双虚构路线、自动化、类型检查、构建和工作树边界。

以下任一情况必须停止对应施工并回报用户：

- 实现需要定义任何饮食、训练、疼痛、恢复、补录或调整专业语义；
- 需要决定专业字段、单位、组次、强度、阈值、时限、文案或合并规则；
- 需要处理真人数据、外部数据库、staging、生产、部署秘密或 G2/G3 放行；
- 当前 PRD、验收台账、机器契约或部门所有权发生冲突；
- 无法证明拒绝路径零业务副作用，或需要用客户端推断绕过服务端事实。

本文获批并完成安全结构施工后，P11 只能从“未开始”更新为“施工中”。在正式专业 schema、真人环境、完整饮食三态、训练逐组/补录语义、疼痛安全路径、双路线 E2E 和全部外部门禁取得证据前，不得标记“待验收”或“通过”。`readyForRealUsers=false`，G2 未达到，G3 继续禁止。

## 13. 2026-07-27 当前收口证据

本节只同步当前本地切片证据，不改变第 1 至 12 节的产品规则和门禁：

- 研发最小 GREEN：P11 OpenAPI、受控路由、可信 session 拒绝顺序、防枚举 404、route/readiness 503 `CLEAR_ALL`、严格 test-only provider 与零成功业务读写表面已形成；独立安全复核运行 4 个聚焦测试文件、`57/57` 项通过，未发现 Critical/Important。
- UI 最小 GREEN：纯 parser 与 client-state disposition 已覆盖严格 envelope、深层额外字段/重复/引用一致性、四类 `CLEAR_ALL`、同主体同目标记录版本冲突保留、精确 `REFRESH`、`DISABLE_EDITOR` 和成功后权威读取意图；整改后 `55/55` 项与 Web typecheck 通过，安全与质量独立复核未发现 Critical/Important。
- 当前工程交接已报告 migration `011`、隔离 PostgreSQL 18 repository 与全部已授权 API pre-wiring GREEN 切片；API 结构为 `29 active / 0 skipped`。最后的 unexpected fake rejection 脱敏场景 direct GREEN，无生产代码改动；测试证明统一 503 envelope、fake 单次调用及完整异常 message/stack 和内部 canonical/session hash/secret 不回显，但不证明 HMAC、PostgreSQL、审计原子性、生产或真人行为。
- 当前新增一个 test-only `GET_RECORD_CONTEXT` 成功预接线：独立 context read port/token、双重 test-only 注入、严格七字段信封和严格 OpenAPI 已形成。真实 RED 为期望 200、实际 `404 RECORD_TASK_NOT_FOUND`；最小 GREEN 及五文件回归为 `53 passed / 0 skipped`，API typecheck/build 已报告通过。QA 与唯一指定 Sol Critical 均无 Critical/Important，结论为 `GET_CONTEXT_PREWIRING_REVIEW_COMPLETE`。
- 当前 UI 已形成 test-only `GET_RECORD_CONTEXT` consumer（`P11Client`、`P11RecordPage` 和非 test route gate），聚焦报告为非页面 `66/66`、页面 `6/6`，Web typecheck 通过；QA 结论为 `QA_CLEAR`，指定 Sol Critical 结论为 `UI_CONTEXT_CONSUMER_REVIEW_COMPLETE`，均无 Critical/Important。该 slice 只消费严格 context envelope，不提供写入控件、不回退 demo。项目发起人随后批准一个独立 test-only PostgreSQL context read adapter；指定 Sol Critical 初审指出 ACTIVE 窗口、provider/schema 绑定和严格 projection 缺口，研发在同一切片内修复并以四个聚焦测试验证：有限且当前有效的 `effectiveTo`、gate/task/provider 同版本、kind/field/required/valueType 校验和 malformed projection fail closed。修复后 adapter 聚焦为 `4 passed`，完整 database workspace 回归为 `138 passed`，database typecheck/build 通过；指定 Sol Critical 复审结论为 `P11_CONTEXT_ADAPTER_REVIEW_COMPLETE`，仅限本单场景且无 Critical/Important。证据仍不覆盖拒绝路径全矩阵、防枚举、锁、并发、幂等、审计原子性、API/生产注册、浏览器或真人业务闭环；API 接入必须另行设计授权。
- 唯一指定 Sol Critical 已完成最后的异常拒绝脱敏复审，无 Critical/Important，结论为 `API_PREWIRING_REVIEW_COMPLETE`。当前四个授权 API 文件为 `52 passed / 0 skipped`，API typecheck/build 已报告通过。该结论只收口 API pre-wiring，不自动授权任何下一阶段；数据库 adapter、生产依赖注册、真实专业 schema、UI/真人成功路径继续未授权。当前安全、数据库与 API 证据仍不构成生产、合规或真人批准。
- 当前工作树仍为共享未提交状态，暂存区为空；文件存在和测试通过不得解释为稳定交付、G2 或 G3 获批。
- 本次 GET fake 只证明 controller 映射、单次调用、脱敏和 test-only 门禁。非 test 结构断言只证明 reader 未注入、fake 零调用且没有成功响应；全局 readiness 可能先返回 503，因此不得外推为生产可信 USER 运行时 404，也不得外推为 PostgreSQL 查询、任务归属、防枚举、锁、并发、幂等或审计证据。
- 2026-08-04 API context wiring 已收口：端口签名要求 `P11RecordPortSchema`，controller 将同一 test-only、已 gate schema 传入 reader 与响应 mapper；聚焦 context `1 passed`、五文件 API 回归 `53 passed / 0 skipped`，API typecheck/build 通过。指定 Sol Critical 复审为 GREEN，无 Critical/Important，仅限本 wiring slice；不得据此授权 API 生产注册、下一场景、真人、G2 或 G3。
- 2026-08-04 test-only API-to-PG18 adapter 接入已收口：真实 RED 为旧路径 `404 RECORD_TASK_NOT_FOUND`，最小 GREEN 仅由 test builder 创建隔离 PG18 Pool/P11RecordContextRepository，并保留 API PGlite 与 PG18 双库边界；QA 提出的 cleanup 错误聚合和 schema 双重强转已修复。PG18 单文件 `3 passed`、六文件 P11 API 回归 `56 passed / 0 skipped`、API typecheck/build 通过；QA `QA_CLEAR`，指定 Sol Critical `P11_CONTEXT_ADAPTER_REVIEW_COMPLETE`，无 Critical/Important。该证据仅证明 test-only adapter 接入，不授权生产注册、真人、G2/G3 或下一场景。

- 2026-08-04 下一单场景产品授权冻结为 P11-11：仅在 test-only context reader/已审查 PG18 adapter 中验证关闭日期或关闭任务的本人既有记录以 `READ_ONLY` 返回，读取零状态副作用。必须由服务端确定关闭事实、可信 USER 与本人任务、既有记录和 schema/版本绑定；不得新增写入、补录时限、专业字段、阈值或安全文案。流程固定为研发 RED -> 最小 GREEN -> QA 只读核对 -> 指定 Sol Critical 独立复审 -> 产品收口，其余场景继续冻结。

- 2026-08-04 P11-11 已收口：研发先以真实断言暴露关闭日期响应仍带 `UPSERT_RECORD` 及部分快照，再最小修复为 `READ_ONLY` 空 `allowedActions`，并对 `planning.plan`、`planning.plan_version`、`recording.record_task`、`recording.record`、`recording.record_idempotency`、`recording.record_success_audit`、`audit.audit_event` 使用实际迁移列的完整行和计数做读取前后相等比较。聚焦 P11-11 `1 passed`、PG18 `4 passed`、六文件串行 `57 passed / 0 skipped`，API typecheck/build/diff/staged 通过；QA `QA_CLEAR`；指定 Sol Critical `GREEN / ALLOW — P11-11_REVIEW_COMPLETE`，Critical/Important 均为 0。该结论仅限 test-only 关闭日期只读读取，不授权下一场景、生产、真人、G2/G3 或 release。

- 2026-08-16 产品仅授权 P11-12 的一个关闭日期写拒绝分支：test-only 隔离 PG18 中，服务端 `date_state=CLOSED`、同一 USER/task 已有记录时，一次合法结构 `UPSERT_RECORD` 必须返回 `RECORD_STATE_BLOCKED`、`DISABLE_EDITOR` 和空恢复动作；读取前后以实际表完整行与计数证明计划、任务、记录、幂等和审计无变化。不得据此定义关闭时点、补录时限或其他专业语义，也不得扩成第二分支、生产注册或真人路径。

- 2026-08-16 上述 P11-12 单分支已收口：有效 RED 为真实 controller 返回 `503`，最小 GREEN 仅由 test builder 构造既有 PG18 write repository adapter 并把受控异常映射为现有 API port failure；最终真实 POST 返回 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR` 和空恢复动作，七张实际迁移表完整行/计数前后相等。P11-12 聚焦 `1 passed`、PG18 文件 `5 passed`、六文件串行 `58 passed / 0 skipped`，API typecheck/build/diff/staged 通过；QA `QA_CLEAR`，安全 `SECURITY_NO_OBJECTION`；指定 Sol Critical `GREEN / ALLOW — P11-12_REVIEW_COMPLETE`，Critical/Important 均为 0。其他 P11-12 分支与下一场景继续冻结。

- 2026-08-16 产品继续仅授权 P11-12 的任务关闭单分支：test-only 隔离 PG18 中，服务端 `task_state=CLOSED`、同一 USER/task 已有记录时，一次合法 `UPSERT_RECORD` 必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR` 和空恢复动作；七表完整行与计数前后相等。必须复用现有结构并如实记录 direct GREEN 或 RED，不得引入其他关闭/风险/补录语义或生产路径。

- 2026-08-16 上述任务关闭分支已 direct GREEN 并收口：真实 API-to-PG18 测试仅设置 `task_state=CLOSED`，精确返回固定 409 信封，七表完整行/计数前后相等；未修改 controller、adapter 或生产实现。PG18 文件 `6 passed`、六文件串行 `59 passed / 0 skipped`，API typecheck/build/diff/staged 通过；QA `QA_CLEAR`，安全 `SECURITY_NO_OBJECTION`；指定 Sol Critical `GREEN / ALLOW — P11-12_TASK_STATE_CLOSED_REVIEW_COMPLETE`，Critical/Important 均为 0。其他 P11-12 分支与下一场景继续冻结。

- 2026-08-16 产品继续仅授权 P11-12 的风险阻断单分支：test-only 隔离 PG18 中，服务端 `risk_state=BLOCKED`、同一可信 USER/task 已有记录时，一次合法 `UPSERT_RECORD` 必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR` 和空恢复动作；七张实际迁移表完整行与计数前后相等。该分支只验证既有机器状态，不定义风险阈值、触发条件、影响范围、恢复条件、安全文案或 SLA。研发是唯一代码写入者；如首次聚焦 direct GREEN 必须如实记录且不得修改生产实现。QA、安全、专业、UI 和运营仅在各自边界只读核对，最终只交指定 Sol Critical 独立复审；尚无执行证据，其他 P11-12 分支与所有后续场景继续冻结。

- 2026-08-16 上述风险阻断分支已 direct GREEN 并收口：真实 API-to-PG18 测试只把服务端 `risk_state` 设为 `BLOCKED`，保持 `task_state/date_state=OPEN`，精确返回固定 409 信封并证明七表完整行/计数不变；本轮未修改 controller、adapter、repository 或生产注册。研发报告 PG18 文件 `7 passed`、六文件 `60 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 6 skipped`、PG18 文件 `7 passed`、六文件 `60 passed / 0 skipped`，typecheck/build/diff/staged 通过，临时库计数 0，PG18 恢复停止。安全、专业、UI、运营分别返回 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`UI_NO_CHANGE_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_RISK_STATE_BLOCKED_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。证据仅限本地 test-only fixture，不证明专业风险规则、生产/外部数据库、真人、通用锁/并发/幂等/审计原子性、G2/G3 或 release；其他 P11-12 分支与下一场景继续冻结。

- 2026-08-16 产品仅授权 P11-12 风险阻断的创建拒绝单分支：test-only 隔离 PG18 中，服务端 `risk_state=BLOCKED`、`task_state/date_state=OPEN`、同一可信 USER/task 且无已有本人记录时，一次合法 `UPSERT_RECORD`（`expectedRecordVersion=null`）必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR` 和空恢复动作；七张实际迁移表完整行与计数前后相等。该分支只补齐已定义的创建拒绝覆盖，不定义风险阈值、触发条件、影响范围、恢复条件、安全文案或 SLA。研发是唯一代码写入者；如首次聚焦 direct GREEN 必须如实记录且不得修改生产实现。其他风险/关闭/补录分支与所有后续场景继续冻结。

- 2026-08-16 上述风险阻断创建拒绝分支已 direct GREEN 并收口：真实 API-to-PG18 测试不插入本人 record，只把服务端 `risk_state` 设为 `BLOCKED`，保持 `task_state/date_state=OPEN`，命令显式使用 `expectedRecordVersion=null`；固定 409 信封与七表完整行/计数不变均通过。本轮未修改 controller、builder、repository、database package、UI 或生产注册。研发报告 PG18 文件 `8 passed`、六文件 `61 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 7 skipped`、PG18 文件 `8 passed`、六文件 `61 passed / 0 skipped`，typecheck/build/diff/staged 通过，临时库 0，PG18 恢复停止。安全、专业、UI、运营分别返回 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`UI_NO_CHANGE_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_RISK_STATE_BLOCKED_FIRST_WRITE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。证据仅限本地 test-only fixture，不证明专业风险规则、生产/外部数据库、真人、通用锁/并发/幂等/审计原子性、G2/G3 或 release；其他分支与下一场景继续冻结。

- 2026-08-16 产品仅授权 P11-12 关闭日期的创建拒绝单分支：test-only 隔离 PG18 中，服务端 `date_state=CLOSED`、`task_state=OPEN`、`risk_state=CLEAR`、同一可信 USER/task 且无已有本人 record 时，一次合法 `UPSERT_RECORD`（`expectedRecordVersion=null`）必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR` 和空恢复动作；七张实际迁移表完整行与计数前后相等。该分支只补齐“关闭日期后不可创建”的结构覆盖，不定义关闭时点、补录时限或任何专业语义。研发是唯一代码写入者；如首次聚焦 direct GREEN 必须如实记录且不得修改生产实现。当前尚无执行证据，其他关闭/风险/补录分支与所有后续场景继续冻结。

- 2026-08-16 上述关闭日期创建拒绝分支已 direct GREEN 并收口：真实 API-to-PG18 测试不插入本人 record，只将服务端 `date_state` 设为 `CLOSED`，保持 `task_state=OPEN`、`risk_state=CLEAR`，命令显式使用 `expectedRecordVersion=null`；固定 409 信封与七表完整行/计数不变均通过。本轮未修改 controller、builder、repository、database package、UI 或生产注册。研发报告 PG18 文件 `9 passed`、六文件 `62 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 8 skipped`、PG18 文件 `9 passed`、六文件 `62 passed / 0 skipped`，typecheck/build/diff/staged 通过，临时库 0，PG18 停止且 5432 无监听。安全、专业、UI、运营分别返回 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`UI_NO_CHANGE_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_DATE_STATE_CLOSED_FIRST_WRITE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。证据仅限本地 test-only fixture，不证明关闭时点或补录规则、生产/外部数据库、真人、通用锁/并发/幂等/审计原子性、G2/G3 或 release；其他分支与下一场景继续冻结。

- 2026-08-16 产品仅授权 P11-12 任务关闭的创建拒绝单分支：test-only 隔离 PG18 中，服务端 `task_state=CLOSED`、`date_state=OPEN`、`risk_state=CLEAR`、同一可信 USER/task 且无已有本人 record 时，一次合法 `UPSERT_RECORD`（`expectedRecordVersion=null`）必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR` 和空恢复动作；七张实际迁移表完整行与计数前后相等。该分支只补齐“任务关闭后不可创建”的结构覆盖，不定义任务关闭条件、关闭时点、补录时限或任何专业语义。研发是唯一代码写入者；如首次聚焦 direct GREEN 必须如实记录且不得修改生产实现。当前尚无执行证据，其他关闭/风险/补录分支与所有后续场景继续冻结。

- 2026-08-16 上述任务关闭创建拒绝分支已 direct GREEN 并收口：真实 API-to-PG18 测试不插入本人 record，只将服务端 `task_state` 设为 `CLOSED`，保持 `date_state=OPEN`、`risk_state=CLEAR`，命令显式使用 `expectedRecordVersion=null`；固定 409 信封与七表完整行/计数不变均通过。本轮未修改 controller、builder、repository、database package、UI 或生产注册。研发报告 PG18 文件 `10 passed`、六文件 `63 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 9 skipped`、PG18 文件 `10 passed`、六文件 `63 passed / 0 skipped`，typecheck/build/diff/staged 通过，临时库 0，PG18 停止且 5432 无监听。安全、专业、UI、运营分别返回 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`UI_NO_CHANGE_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_TASK_STATE_CLOSED_FIRST_WRITE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。证据仅限本地 test-only fixture，不证明任务关闭条件、关闭时点或补录规则、生产/外部数据库、真人、通用锁/并发/幂等/审计原子性、G2/G3 或 release；其他分支与下一场景继续冻结。

- 2026-08-16 产品仅授权 P11-03 跨用户任务防枚举单分支：test-only 隔离 PG18 中，可信 USER A 以本人有效会话请求归属于虚构 USER B 的完整 account/plan/plan_version/task，一次合法 `UPSERT_RECORD` 必须返回固定 `404 RECORD_TASK_NOT_FOUND`、`CLEAR_ALL` 和空恢复动作；七张实际迁移表完整行与计数前后相等，且公开响应不得泄露目标主体、计划、任务状态或 schema 事实。本分支只补齐真实 controller + PG18 repository 的跨层归属负例，不替代 API fake 映射证据或 repository 单测，不证明生产防枚举、真人安全、锁/并发/幂等/审计原子性。研发是唯一代码写入者，当前尚无执行证据，其他场景继续冻结。

- 2026-08-16 上述 P11-03 跨用户任务防枚举分支已 direct GREEN 并收口：真实 API-to-PG18 测试保持 USER A 的有效会话，建立完整一致的虚构 USER B account、plan、ACTIVE plan_version 和 task 归属链；合法写请求返回固定 404 信封，公开响应排除 USER B、plan/version/task、schema 与状态 sentinel，七表完整行/计数前后相等。本轮未修改 controller、builder、repository、database package、UI 或生产注册。研发报告 PG18 文件 `11 passed`、六文件 `64 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 10 skipped`、PG18 文件 `11 passed`、六文件 `64 passed / 0 skipped`，typecheck/build/diff/staged 通过，临时库 0，PG18 停止且 5432 无监听。安全、专业、UI、运营分别返回 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`UI_NO_CHANGE_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-03_CROSS_USER_NON_ENUMERATION_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。API fake、repository 单测和本跨层证据继续分层；该结论不证明生产防枚举、真人安全、锁/并发/幂等/审计原子性、G2/G3 或 release，下一场景继续冻结。

## 14. 2026-08-18 P11-03-MISSING_TASK 单场景收口

- 前置事实：可信 `USER` 会话、服务端确定主体/计划/日期作用域、opaque 任务标识没有对应任务行，命令为合法 `UPSERT_RECORD`；仅使用现有 test-only schema/adapter/fixture。
- 必须结果：HTTP `404`，错误码 `RECORD_TASK_NOT_FOUND`，动作 `CLEAR_ALL`，空恢复动作；不得从响应或错误差异泄露任务、目标、计划、schema、状态、token 或幂等键。
- 零副作用：7 张 authority 表（`iam.account`、`iam.session`、`recording.p11_write_gate`、`recording.p11_write_gate_revision`、`recording.record_task`、`planning.plan`、`planning.plan_version`）与 3 张副作用表（`recording.record`、`recording.record_idempotency`、`recording.record_success_audit`）均做完整 `SELECT *` 行与计数前后相等比较。
- 证据边界：fake/controller 只证明映射；既有 repository 单测只证明仓储行为；本场景新增的真实 API→PG18 结果单独记录。不得外推为生产锁、并发、幂等、审计原子性、真人或 release 证据。
- 流程与停止：研发 direct GREEN（聚焦 `1 passed / 11 skipped`，PG18 文件 `12 passed / 0 skipped`）-> QA 独立 PG18 复现并 PASS -> 安全/专业/UI/运营只读 -> 指定 Sol Critical 复审 `GREEN / ALLOW — P11-03_MISSING_TASK_REVIEW_COMPLETE`（Critical/Important/Minor 均为 0）-> 产品收口。此前 STOP 的 4 张 authority 表快照缺口已补齐；该结论仅收口本 test-only 场景，下一场景须另行产品冻结。出现专业字段/规则、第二场景、生产/外部数据库、UI/生产 wiring 或无法证明完整 10 表零副作用，立即停止。

## 15. 2026-08-18 P11-04-PLAN_NOT_ACTIVE 单场景授权与收口

- 前置事实：可信 `USER` 会话、本人 task、服务端确定其关联 plan version 对业务日期不处于唯一 `ACTIVE`；fixture 仅使用既有计划状态语义，不新增专业字段、日期阈值或安全规则。
- 必须结果：合法 `UPSERT_RECORD`（`expectedRecordVersion=null`）返回 `409 RECORD_PLAN_NOT_ACTIVE`、`CLEAR_ALL`、空恢复动作；不得泄露 token、task、plan、schema、幂等键、输入或 fixture sentinel。
- 零副作用：7 张 authority 表与 3 张副作用表共 10 张实际迁移表均做完整 `SELECT *` rows/count 前后相等比较；不插入本人 record。
- 流程与停止：研发单场景 RED/direct GREEN -> QA 独立 PG18 复现 -> 安全/专业/UI/运营只读 -> 指定 Sol Critical 复审 -> 产品收口。不得开启 P11-04 其他状态、其他 skipped、生产/外部数据库、UI/生产 wiring、真人、G2/G3 或 release。
- 初审阻断：初次 direct GREEN 的 fixture 使用固定 `business_date=2026-01-02`，计划窗口却为相对当前时间，无法排除 ACTIVE 状态下也因日期不覆盖返回同一错误。指定 Sol Critical 因假阳性风险 BLOCK；旧 QA/四边界结果随之作废。
- 最小修复：仅把 test-only 计划窗口固定为 `2026-01-01T00:00:00Z` 至 `2099-01-01T00:00:00Z`，在状态变更前断言关联 version 为 ACTIVE 且覆盖固定业务日期，随后唯一变更为 `SUPERSEDED`。未改生产 controller、builder、repository、database package、UI 或 production wiring。
- 修复后证据：研发与 QA 均报告聚焦 `1 passed / 12 skipped`、PG18 文件 `13 passed / 0 skipped`、六文件 `66 passed / 0 skipped`，typecheck/build/diff 通过；10 张实际迁移表完整 rows/count 前后相等，固定 `409 RECORD_PLAN_NOT_ACTIVE / CLEAR_ALL / []` 无敏感回显，临时 PG18 已清理并停止、5432 无监听。安全/专业/UI/运营修复后重新复核均无范围阻断。
- 最终结论：指定 Sol Critical 返回 `GREEN / ALLOW — P11-04_PLAN_NOT_ACTIVE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。仅收口本 test-only 场景；当前无下一场景授权，不证明通用计划授权、生产/真人、锁/并发/幂等/审计原子性、G2/G3、release 或 `readyForRealUsers=true`。

## 16. 2026-08-18 P11-05-CLIENT_USER_FIELD_REJECTED 单场景授权

- 前置事实：可信 `USER` 会话、本人 task、现有合法 `UPSERT_RECORD` 请求；客户端额外提交一个伪造 `userId` authority 字段。服务端 authority 仍必须来自会话与路径/数据库事实，不能接受或序列化该字段。
- 必须结果：strict command schema 在 repository port 之前返回 `400 RECORD_REQUEST_INVALID`、`CLEAR_ALL`、空恢复动作；fake 调用次数为 0，响应不回显伪造 userId。
- 证据边界：本场景只验证 API fake/controller 输入拒绝和端口零调用，不接入 PG18，不证明生产权限、数据库锁/并发/幂等/审计原子性、真人或 G2/G3。
- 流程与停止：研发单场景 RED/direct GREEN -> QA 独立复现 -> 安全/专业/UI/运营只读 -> 指定 Sol Critical 复审 -> 产品收口。不得开启 P11-05 其他伪造变体、其他 skipped、生产/外部数据库、UI/生产 wiring、真人、G2/G3 或 release。
- 执行证据：研发与 QA 均确认 strict schema 在 repository port 前拒绝唯一 forged top-level `userId`，固定 `400 RECORD_REQUEST_INVALID / CLEAR_ALL / []`、fake 零调用且无伪造值回显；focused `1 passed / 29 skipped`、四文件 `53 passed / 0 skipped`、typecheck/build/diff 通过。安全/专业/UI/运营均为仅限本边界的条件性 ALLOW，未运行 PG18、未改生产代码/UI/数据库。
- 最终结论：上一轮指定 Sol Critical 的工程计划审计 Important 已由研发修复，产品工作日志行号 Minor 已校正；复审返回 `GREEN / ALLOW — P11-05_CLIENT_USER_FIELD_REJECTED_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。仅收口本 test-only 单场景；当前无下一场景授权，其他 P11-05 变体及全部生产/真人/G2/G3/release 门禁继续冻结。

## 17. 2026-08-20 P11-08-CONCURRENT_EXISTING_RECORD_UPDATE 单场景授权

- 前置事实：test-only 隔离本机 PG18、可信 `USER`、本人 task、唯一有效 `ACTIVE` plan 与日期窗口、`task_state/date_state/risk_state=OPEN/OPEN/CLEAR`、本人既有一条 record version 1；不使用任何专业字段或真人数据。
- 并发输入：两个独立合法 `UPSERT_RECORD` 请求使用不同 requestId、不同幂等键和不同虚构 opaque entry value，但相同 task、record kind、schema version 与 `expectedRecordVersion=1`。必须用受控 PG18 锁等待或测试屏障证明两事务真实重叠并竞争同一旧版本；单纯 `Promise.all`、fake 或顺序请求不是并发证据。
- 必须结果：恰好一个 `200 RECORD_WRITE_ACCEPTED` 且 recordVersion 2；另一个精确返回 `409 RECORD_VERSION_CONFLICT`、`PRESERVE_DRAFT_FOR_VERSION_CONFLICT`、`recoverableActions=['REFRESH']`。成功机器响应按现有合同不要求 `requestId`；冲突响应必须绑定失败请求的 `requestId`，成功请求必须由成功审计的 `request_id` 绑定；不得泄露 token、原始幂等键、另一请求值或内部状态。
- 持久化验收：最终 record 行数仍为 1、recordVersion 2，`entries` 深度精确等于唯一成功请求的完整值且排除失败值；相对已有 version 1 基线，恰好新增一条状态为 `COMPLETED` 的幂等行，`replay_result` 精确匹配成功 record 的 id、version 和 schema，成功审计只新增一份，失败事务不得留下成功副作用。authority 表保持业务事实不变；测试须使用实际迁移列核对必要 rows/count 和投影。
- 证据边界：本场景只补充本地 test-only API→PG18 既有记录并发更新的跨层证据；既有 repository 并发单测、API fake 和本场景必须分别记录。不得外推为生产锁策略、所有并发/幂等/审计原子性、真人、G2/G3 或 release。
- 流程与停止：产品授权 -> 研发唯一写入并执行 RED/direct GREEN、最小 GREEN和聚焦验证 -> QA 独立复现 -> 安全/专业/UI/运营只读 -> 指定 Sol Critical -> 产品收口。absent-record create、same-key replay、P11-09、第二场景、生产/外部数据库、UI/生产 wiring、真人及全部发布门禁继续冻结。

## 18. 2026-08-21 P11-08-CONCURRENT_EXISTING_RECORD_UPDATE 收口

- 研发修复了 Sol Critical 指出的两个验收 Important，且只修改 P11-08 test-only 测试与工程计划：唯一新增幂等行严格绑定获胜 `session_id` 和真实 HMAC `idempotency_key_digest`，并排除失败 key；锁屏障、锁观察和请求等待均有界，异常时 `finally` 无条件释放首事务并消费请求，确保连接池和临时库可清理。
- QA 独立结果：focused `1 passed / 13 skipped`、完整 PG18 文件 `14 passed / 0 skipped`、六文件 API 回归 `68 passed / 0 skipped`、API typecheck/build/diff 通过；暂存区为空、临时数据库为 `0`、PG18 已停止且 5432 无监听。安全/隐私返回 `SECURITY_NO_OBJECTION`。
- 指定 Sol Critical 静态复审确认 Critical/Important/Minor 均为 0，正式结论为 `GREEN / ALLOW — P11-08_CONCURRENT_EXISTING_RECORD_UPDATE_REVIEW_COMPLETE`。
- 收口范围仅限本机 loopback、虚构数据、test-only API→隔离 PG18 的既有记录并发更新；不证明生产锁策略、通用并发/幂等/审计原子性、真人、G2/G3、release 或 `readyForRealUsers=true`。当前没有下一场景授权，absent-record create、same-key replay、P11-09、其他并发/乱序、生产/外部数据库、UI/生产 wiring、真人和全部发布门禁继续冻结。

## 19. 2026-08-23 P11-09-OUT_OF_ORDER_OLD_REQUEST 单场景授权

- 前置事实：test-only 隔离本机 PG18、可信 USER、本人 task、有效 ACTIVE plan/date、OPEN/OPEN/CLEAR、本人既有 record version 1；不使用专业字段、客户端时间字段或真人数据。
- 乱序输入：较新合法 `UPSERT_RECORD` 先成功推进 record version 1 到 version 2；随后较旧合法请求使用不同幂等键、相同 task/kind/schema 和 `expectedRecordVersion=1` 到达。服务端只以权威 record version 判断，不按客户端时间判断。
- 必须结果：旧请求返回现有 `409 RECORD_VERSION_CONFLICT`、保留草稿/刷新动作信封；最终 record 的 version、schema 和完整 entries 深度保持较新成功结果。旧请求不得新增 `COMPLETED` 幂等结果或成功审计，authority 与副作用快照保持不变。
- 证据边界：只补充本地 test-only API→隔离 PG18 的顺序到达/旧版本拒绝证据；不得外推生产乱序、通用并发/幂等/审计原子性、真人、G2/G3 或 release。same-key replay、absent-record create、P11-10、其他并发/乱序分支继续冻结。
- 流程与停止：产品授权 -> 研发唯一写入并执行 RED/direct GREEN、最小 GREEN 和 focused PG18 -> QA 独立复现 -> 安全/专业/UI/运营只读 -> 指定 Sol Critical -> 产品收口；需要客户端时间字段、专业语义、生产 wiring 或外部数据库时立即停止。

## 20. 2026-08-23 P11-09-OUT_OF_ORDER_OLD_REQUEST 收口

- 研发新增的唯一顺序场景先由较新请求将既有 record 从 version 1 推进到 version 2，再由较旧 `expectedRecordVersion=1` 请求到达；服务端按存储 `record_version` 返回现有版本冲突合同，不使用客户端时间。
- QA 独立结果：focused `1 passed / 14 skipped`、完整 PG18 文件 `15 passed / 0 skipped`、六文件 API 回归 `69 passed / 0 skipped`、API typecheck/build/diff 通过；暂存区为空、临时数据库为 `0`。5432 外部 PID 监听是本轮开始前状态，未停止非本轮进程。
- 安全/隐私 `SECURITY_NO_OBJECTION`；专业 `PROFESSIONAL_CLEAR`；UI `UI_NO_CHANGE_CLEAR`；运营 `OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 正式结论 `GREEN / ALLOW — P11-09_OUT_OF_ORDER_OLD_REQUEST_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。
- 收口范围仅限本机 loopback、虚构数据、test-only API→隔离 PG18 的旧版本乱序拒绝；最终新 entries/version/schema 保持不变，旧请求无成功幂等/审计副作用。不证明生产乱序、通用并发/幂等/审计原子性、真人、G2/G3、release 或 `readyForRealUsers=true`。当前没有下一场景授权，same-key replay、absent-record create、P11-10、其他乱序、生产/外部数据库、UI/生产 wiring、真人及全部发布门禁继续冻结。

## 22. 2026-08-23 P11-10-SCHEMA_VERSION_CONFLICT 收口

- P11-10 API 场景确认既有 schema-v1 record 收到 schema-v2 请求时，在幂等 claim 和任何写入前返回 `409 RECORD_SCHEMA_VERSION_CONFLICT / CLEAR_ALL / ['REFRESH']`；十表 rows/count 完整不变，record/version/schema-v1/entries、幂等和成功审计均不变。
- UI Important 已修复并验证：`RECORD_SCHEMA_VERSION_CONFLICT` 进入 CLEAR_ALL 清除集合，record/draft/editor 等状态清空，仅保留严格服务端 `REFRESH`；UI focused `59/59`、Web typecheck 通过。
- QA 独立结果：API focused `1 passed / 15 skipped`、PG18 `16 passed / 0 skipped`、六文件 `70 passed / 0 skipped`、API typecheck/build/diff 通过；暂存区为空、临时数据库 `0`。安全/专业/UI/运营分别为 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`UI_NO_CHANGE_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`。
- 指定 Sol Critical 正式结论：`GREEN / ALLOW — P11-10_SCHEMA_VERSION_CONFLICT_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。页面 `.tsx` 未被 Vitest include 收集，不形成页面/浏览器验收证据；5432 外部 PID 监听为本轮开始前环境边界。
- 收口范围仅限 test-only、loopback PG18、虚构数据的 schema conflict；不证明生产 schema 迁移、通用兼容/并发/幂等/审计原子性、真人、G2/G3、release 或 `readyForRealUsers=true`。当前没有下一场景授权，same-key replay、absent-record create、其他 skipped、生产/外部数据库、UI/生产 wiring、真人和全部发布门禁继续冻结。

## 24. 2026-08-23 P11-06-SAME_INTENT_REPLAY 收口

- 同一完整规范化 `UPSERT_RECORD` 意图、同一主体/task/kind/schema和同一raw idempotency key连续提交两次，不同requestId；两次响应深度完全相同，record/version只推进一次。
- QA独立结果：focused `1 passed / 16 skipped`、PG18 `17 passed / 0 skipped`、六文件 `71 passed / 0 skipped`、typecheck/build/diff通过；暂存区空、临时库0。唯一COMPLETED幂等行、真实session/HMAC digest/精确replay_result和唯一成功审计均严格匹配，第二次零新增副作用。
- 安全、专业、UI、运营分别为 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`UI_NO_CHANGE_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`；指定Sol Critical `GREEN / ALLOW — P11-06_SAME_INTENT_REPLAY_REVIEW_COMPLETE`，Critical/Important/Minor均为0。
- 证据仅限test-only、loopback PG18、虚构数据，不证明生产replay atomicity、通用幂等/并发/审计原子性、真人、G2/G3或release。当前没有下一场景授权，changed-intent、absent-record create、其他skipped和全部发布门禁继续冻结。

## 25. 2026-08-23 P11-07-SAME_KEY_CHANGED_INTENT 单场景授权

- 同一可信主体/task/kind/schema和同一raw idempotency key：第一次合法请求成功，第二次仅改变一个opaque entry值，形成不同完整规范化intent。
- 第二次必须返回`409 IDEMPOTENCY_KEY_REUSED / CLEAR_ALL / ['USE_NEW_IDEMPOTENCY_KEY']`并绑定第二requestId，不得返回或泄露首次成功结果。
- 最终record/version/entries、唯一COMPLETED幂等行、真实digest/replay_result和唯一成功审计保持第一次结果；第二次零成功副作用。公开/持久化投影排除raw key/token/changed entry/internal state。
- 只补test-only API→隔离PG18证据；其他changed-intent变体、absent-record create、生产/真人/G2/G3/release冻结。流程仍为研发→QA→边界部门→指定Sol Critical→产品收口。
- UI只读复核发现现有parser合同已定义`IDEMPOTENCY_KEY_REUSED / CLEAR_ALL / USE_NEW_IDEMPOTENCY_KEY`，但client-state漏消费；产品在同一P11-07场景内授权最小UI修复，仅允许清空stale状态、严格保留单一服务端动作和新增focused测试，不授权页面、文案或新产品行为。
- 最终收口：API/PG18与UI修复经QA、安全、专业、运营和指定Sol Critical复核；正式结论`GREEN / ALLOW — P11-07_SAME_KEY_CHANGED_INTENT_REVIEW_COMPLETE`，Critical/Important/Minor均为0。仅收口entry-value分支。

## 26. P11-08-CONCURRENT_ABSENT_RECORD_CREATE授权

- test-only隔离PG18中无既有record；两个不同session/key/entry的合法请求均`expectedRecordVersion=null`，必须在repository冻结锁序的实际最早同主体account锁边界确定性重叠，随后完成task锁和权威状态重读；不得用顺序调用或普通Promise并发替代PG18 Lock等待证据。
- 收口结论：QA、安全、专业、UI、运营均无阻断；新指定Sol Critical复审确认Critical/Important/Minor均为0，正式结论`GREEN / ALLOW — P11-08_CONCURRENT_ABSENT_RECORD_CREATE_REVIEW_COMPLETE`。仅收口本absent-create分支。

## 27. P11-13-AUTHORITATIVE_READ_FAILURE_AFTER_SUCCESS授权

- 保存成功后自动权威`GET_RECORD_CONTEXT`失败或返回不可信主体时，UI必须清除或禁用stale editor，不展示本地推演成功态。
- 仅允许UI/state focused测试和既有client-state合同消费；不新增API、数据库、专业字段、客户端成功推演或页面行为。流程为UI→QA→安全/专业/运营→指定Sol→产品收口。
- 验收仅限 UI/state：测试证明权威 GET 失败或主体/task不可信时清除或禁用 stale editor，不展示本地推演成功态；不新增 API、数据库写行为或页面行为。
- 不授权生产、专业字段、真人或发布门禁；流程为 UI→QA→边界→指定Sol→产品收口。

## 28. P11-13-AUTHORITATIVE_READ_FAILURE_AFTER_SUCCESS收口

- QA UI60/60、Web typecheck；安全/专业/运营无阻断；指定Sol Critical结论`GREEN / ALLOW — P11-13_AUTHORITATIVE_READ_FAILURE_AFTER_SUCCESS_REVIEW_COMPLETE`，Critical/Important/Minor0。
- 仅收口UI/state stale清除；页面/浏览器、P11-14/15/16、生产/真人/G2/G3/release继续冻结。

## 29. P11-14-UI_MALFORMED_RESPONSE_FAIL_CLOSED授权

- UI/parser/state仅验证未知状态、字段、动作、额外属性或畸形响应整体fail closed，清除stale状态，不回退demo。
- 不新增API、数据库、专业字段、页面或生产行为；流程为UI→QA→边界→指定Sol→产品收口。

## 23. 2026-08-23 P11-06-SAME_INTENT_REPLAY 单场景授权

- 前置事实：test-only 隔离本机 PG18、可信 USER、本人 task、有效 ACTIVE plan/date、OPEN/OPEN/CLEAR、通用 schema/fixture；不使用专业字段、客户端时间字段或真人数据。
- 输入：同一完整规范化 `UPSERT_RECORD` 写入意图、同一主体/task/kind/schema、同一 raw idempotency key，连续提交两次请求；允许 requestId 不同，但业务意图必须完全一致。
- 必须结果：两次响应深度完全相同；record/version 只推进一次；唯一一条 `COMPLETED` 幂等行和一条成功审计；第二次不得增加 record、幂等完成、审计或其他成功副作用。公开/持久化投影不得泄露 raw key/token/entry/internal state。
- 证据边界：只补充本地 test-only API→隔离 PG18 的精确重放证据；fake/controller 与 repository 单测必须分层记录，不外推生产 replay atomicity、通用幂等、真人、G2/G3 或 release。changed-intent、absent-record create、其他 skipped 继续冻结。
- 流程与停止：产品授权 -> 研发唯一写入并执行 RED/direct GREEN、最小 GREEN 和 focused PG18 -> QA 独立复现 -> 安全/专业/UI/运营只读 -> 指定 Sol Critical -> 产品收口；需要生产 wiring、专业语义、外部数据库或第二行为时立即停止。

## 21. 2026-08-23 P11-10-SCHEMA_VERSION_CONFLICT 单场景授权

- 前置事实：test-only 隔离本机 PG18、可信 USER、本人 task、有效 ACTIVE plan/date、OPEN/OPEN/CLEAR、既有 schema-v1 record；不使用专业字段、客户端时间字段或真人数据。
- 输入：一次合法 `UPSERT_RECORD` 使用 schema-v2，其他主体/task/kind/version 状态保持既有 fixture 事实；服务端 gate/task/approved schema 仍为 schema-v1。
- 必须结果：现有 `409 RECORD_SCHEMA_VERSION_CONFLICT`、`CLEAR_ALL`、`recoverableActions=['REFRESH']`；十张实际迁移表完整 rows/count 前后一致，record/version/schema-v1、幂等和成功审计均不变。
- 证据边界：只补充本地 test-only API→隔离 PG18 的 schema 版本拒绝证据；不外推生产 schema 迁移、通用版本兼容、真人、G2/G3 或 release。same-key replay、absent-record create、P11-09 之后其他场景继续冻结。
- 流程与停止：产品授权 -> 研发唯一写入并执行 RED/direct GREEN、最小 GREEN 和 focused PG18 -> QA 独立复现 -> 安全/专业/UI/运营只读 -> 指定 Sol Critical -> 产品收口；需要生产 wiring、专业 schema、外部数据库或新增错误语义时立即停止。
## 30. P11-13/P11-14收口与P11-15授权

- P11-13 Sol结论`GREEN / ALLOW — P11-13_AUTHORITATIVE_READ_FAILURE_AFTER_SUCCESS_REVIEW_COMPLETE`；P11-14 Sol结论`GREEN / ALLOW — P11-14_UI_MALFORMED_RESPONSE_FAIL_CLOSED_REVIEW_COMPLETE`，Critical/Important/Minor均为0。
- 产品现授权唯一下一UI目标P11-15消息已读/安全深链：验证已读、重读目标状态、失效和越权处理，未知/失效/越权深链fail closed；不新增API/database/专业字段/生产行为。P11-16、browser完整验收和发布门禁冻结。

## 31. P11-15-MESSAGE_READ_SAFE_DEEP_LINK 最小合同

- 消息对象只使用 `messageId`、`readState: UNREAD | READ`、opaque `targetType` 和 opaque `targetId`；不引入专业字段、自由文案或客户端授权身份。
- 标记已读允许重复执行且不产生重复副作用；打开深链必须重新读取服务端目标状态，客户端不把URL当作授权事实。
- 目标失效、越权、主体变化或状态不可信时统一 `CLEAR_ALL`，清除消息目标与 stale 状态，不展示本地推演成功态；未知消息/目标结构 fail closed。
- 仅允许 test-only UI/state/API contract fixture；不进入生产、真人、G2/G3 或 release。流程为产品合同 -> UI/研发 -> QA -> 安全/专业/运营 -> Sol Critical -> 产品收口。
- 可执行API合同已批准：`GET /api/v1/messages` 返回严格 `{ messages: [{ messageId, readState, targetType, targetId }] }`；`POST /api/v1/messages/:messageId/read` 返回严格 `{ messageId, readState: 'READ' }`；`GET /api/v1/message-targets/:targetType/:targetId` 返回服务端重读的目标状态。三者均要求可信USER session，messageId/targetId仅作opaque定位符；已读重复请求幂等；失效/越权/主体变化统一既有`CLEAR_ALL`错误合同；未知结构fail closed。所有API只在test-only fixture验证，不注册生产路由或迁移。

## 32. P11-16-DATA_EXPORT_REQUEST_STATUS 最小合同

- 仅验证可信 USER 提交一次数据导出请求并查询其状态；test-only fixture 不生成真实导出包、不读取真人字段、不连接生产/外部数据库。
- 严格对象仅含 opaque `requestId`、`requestType: EXPORT`、`status: SUBMITTED | PROCESSING | COMPLETED | REJECTED`；主体从可信 session 得出，不能由客户端提交。
- 同一可信主体重复提交同一 requestId 幂等返回同一状态；不同主体访问该 requestId 统一 `CLEAR_ALL`，不泄露状态或数据。
- PRD 的导出包 7 天失效/删除规则只作为已批准产品约束记录；本地场景不实现真实定时删除或字段导出。
- 不新增专业字段、客户端时间、真人数据、生产路由/数据库或部署行为；P11-16 其他删除、匿名化、留存和演练分支继续冻结。

## 33. P11-16-DELETE_REQUEST_STATUS 单场景授权

- 仅验证可信 USER 提交一次删除/匿名化请求并查询状态；test-only fixture 不执行真实删除、不读取真人字段、不连接生产/外部数据库。
- 严格对象仅含 opaque `requestId`、`requestType: DELETE | ANONYMIZE`、`status: SUBMITTED | PROCESSING | COMPLETED | FROZEN | REJECTED`；主体来自可信 session。
- 同一主体同 requestId 重复提交幂等；跨主体统一 `CLEAR_ALL`；`FROZEN` 仅表示既有安全事件例外状态，不定义新阈值、时限或专业规则。
- PRD 的 7 日处理、30 日删除/匿名化与安全事件最小冻结规则只作为产品约束记录；本地场景不实现调度器、真实数据处理或演练。
- QA API/UI复核、安全、专业、运营均无阻断；指定Sol Critical正式结论`GREEN / ALLOW — P11-16_DELETE_REQUEST_STATUS_REVIEW_COMPLETE`，Critical/Important/Minor均为0。仅收口最小DELETE/ANONYMIZE状态fixture。
- QA/API fixture/UI修复与安全、专业、运营复核均无阻断；指定Sol Critical正式结论`GREEN / ALLOW — P11-16_DELETE_REQUEST_STATUS_REVIEW_COMPLETE`，Critical/Important/Minor均为0。仅收口最小请求状态fixture，不代表真实数据权利演练。
