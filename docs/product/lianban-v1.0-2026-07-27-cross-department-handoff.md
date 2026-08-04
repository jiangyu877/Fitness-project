# 练伴 V1.0 新会话跨部门总交接

快照日期：2026-07-27  
唯一工作目录：`D:\project\Fittness project`  
当前分支：`codex/ui-ux-spec`  
交接基线 HEAD：`6b718594ad010897979afa0df243889fc228ba09`  
所有者：产品部  
状态：P07/P08/P09/P10/P11 施工中；G2 未达到；G3 禁止

## 0. 2026-07-30 当前续接状态

本节覆盖 2026-07-27 快照中的过期施工状态，不改变 PRD、验收规则或真人门禁：

- 当前 P11 已完成 migration `011`、本地隔离 PostgreSQL 18 repository 与 API pre-wiring 的 legal-write、same-key changed-intent、same-subject/same-target `record-version-conflict` 三个授权 GREEN 切片；完整饮食/训练业务闭环仍未完成。
- P11-06 精确重放已在真实 controller 加 scripted fake 的聚焦 API 回归中通过；该切片完成时的阶段结构为 9 个非 skipped、20 个 skipped，已被后续单场景进展取代，不是当前计数。它确认相同请求得到相同严格 HTTP 响应和两次端口调用，不能证明数据库避免第二次写入。
- Sol Critical 已先后对 `record-version-conflict` 和 P11-06 给出 `ALLOW_NEXT_SINGLE_SCENARIO`，未报告阻止对应切片的 Critical/Important。P11-06 沿用已存在的通用成功映射直接 GREEN，未伪造 RED 或新增生产实现；本场景已收口，但不得自动开启任何其他场景或批量取消剩余 20 个 skipped。
- API fake 只证明真实 controller 的输入/输出映射；PostgreSQL 锁、并发、幂等、审计原子性只能引用独立 PG18 repository 证据，不能混用。
- 当前继续保持 `readyForRealUsers=false`、G2 未达到、G3 禁止；不允许真人数据、外部/生产数据库、staging、部署或生产依赖注册。
- 最后的 unexpected fake rejection 脱敏场景已 direct GREEN，无生产代码改动；当前 API pre-wiring 结构为 `29 active / 0 skipped`，结果为 `52 passed / 0 skipped`，API typecheck/build 已报告通过。唯一指定 Sol Critical 复审无 Critical/Important，结论 `API_PREWIRING_REVIEW_COMPLETE`。当前阶段已收口，但没有自动下一阶段授权。
- 经项目发起人另行批准，P11 已完成一个 test-only `GET_RECORD_CONTEXT` 成功预接线：真实 RED 为期望 200、实际 `404 RECORD_TASK_NOT_FOUND`；最小 GREEN 使用独立 context read port/token 和严格七字段/OpenAPI 信封。五文件回归 `53 passed / 0 skipped`，API typecheck/build 已报告通过；QA 与唯一指定 Sol Critical 均无 Critical/Important，结论 `GET_CONTEXT_PREWIRING_REVIEW_COMPLETE`。随后仅批准一个独立 test-only PostgreSQL context read adapter 单场景；指定 Sol Critical 初审指出 ACTIVE 窗口、provider/schema 绑定和严格 projection 缺口，研发在同一切片内修复，修复后真实 PG18 聚焦 `4 passed`，完整 database workspace 回归 `138 passed`，database typecheck/build 通过；再次复审结论为 `P11_CONTEXT_ADAPTER_REVIEW_COMPLETE`，仅限当前单场景且无 Critical/Important。该证据不等同于生产数据库读取、API 注册、锁/并发/幂等/审计或真人业务闭环；API 接入必须另行设计和授权。

## 0.1 2026-08-03 当前 UI 续接增量

本节是对上述历史快照的当前覆盖，不改变 PRD 的专业、生产、G2/G3 和真人门禁：

- 项目发起人已明确批准下一步仅实施 P11 test-only `GET_RECORD_CONTEXT` UI consumer；UI 部新增 `P11Client`、`P11RecordPage` 和非 test route gate，复用严格 parser/client-state，不提供写入控件、不回退 demo。
- 当前 UI 交接证据为非页面 `66/66`、页面 `6/6`、Web typecheck 通过；证据仅覆盖 fake/test transport、严格解析、客户端状态和非 test gate，不证明 API persistence、PostgreSQL、浏览器/无障碍、真人、G2 或 G3。
- `SESSION_INVALID` UI 解析已与当前 API 合同统一为 `recoverableActions: []`；UI 不自行生成 `LOGIN` 动作。
- 当前 UI slice 已完成施工，QA 返回 `QA_CLEAR`，指定 Sol Critical 返回 `UI_CONTEXT_CONSUMER_REVIEW_COMPLETE`，均无 Critical/Important；本 slice 已收口，不授予下一场景授权。

## 0.2 2026-08-04 API context wiring 收口

本节仅覆盖 P11 test-only API context wiring，不改变 PRD、专业字段边界或真人门禁：

- 研发完成最小 wiring：`P11RecordContextPort.getContext(input, schema)` 将 schema 设为必填；controller 先通过 USER、test-only reader 和 provider schema gate，再把同一 `P11RecordPortSchema` 传给 reader 与响应 mapper。
- 聚焦 context 测试 `1 passed`；五文件 P11 API 回归 `53 passed / 0 skipped`；API typecheck/build 通过。指定 Sol Critical 只读复审无 Critical/Important，结论为本 wiring slice GREEN。
- fake/controller 证据仅覆盖输入输出映射、schema 传递、调用次数、脱敏和非 test 注入为 null；不覆盖 PostgreSQL、任务归属、防枚举、锁、并发、幂等、审计、生产、真人、G2/G3 或 release。
- 本 slice 已完成并停止；不自动开启下一场景。`readyForRealUsers=false`、G2 未达到、G3 继续禁止，工作树保持共享未提交且暂存区为空。

## 0.3 2026-08-04 下一候选评估停点

- 产品部已统筹研发、质量、安全、专业、UI、运营和指定 Sol Critical 部门评估“test-only API 接入已审查 PG18 context adapter”候选。
- 研发确认 API 使用 PGlite，adapter 使用 `pg.Pool` 并依赖独立 PostgreSQL session/task/plan/gate/record fixture；直接注册或强转会越过当前数据库边界。下一步若获批，必须先明确 test-only `pg` 运行时依赖、隔离 Pool 生命周期、双数据库 fixture 与关闭顺序。
- 质量已给出单场景 RED/GREEN、既有回归和证据边界；安全无异议仅限 test-only，专业确认无专业语义扩张，UI 不施工，运营对未授权依赖保持 BLOCK；Sol Critical 尚未提前放行。
- 当前停在产品授权条件，不修改代码、不连数据库、不启用 skipped。用户若批准上述 test-only 双数据库边界，研发才可开始该单场景 RED；否则保持当前 wiring 收口状态。

## 1. 唯一任务与防偏离规则

新会话的唯一任务是：在不改变产品边界、不越过安全边界、不编造专业或合规内容的前提下，继续完成《练伴 V1.0》PRD 所定义的本地工程闭环与验收证据。

任何部门或职员都不得把任务改成 V2.0、公开产品、营销站、AI 教练、医疗/康复服务或其他未批准项目。不得加入公开注册、短信/微信登录、支付、社交、媒体上传、设备接入或 AI 能力。

事实源优先级固定为：

1. `docs/product/lianban-v1.0-prd.md`；
2. `docs/product/lianban-v1.0-acceptance-ledger.md`；
3. `docs/product/lianban-v1.0-readiness-gates.md`；
4. 对应产品验收附件；
5. 当前 UI/工程受控契约；
6. 本交接与部门交接仅用于续接，不得覆盖以上文件。

若当前文件、Git 状态或测试与本快照不同，以新会话现场读取结果为准；不得凭记忆覆盖当前工作树。

## 2. 当前三部门交接入口

- 产品部：本文、PRD、验收台账、真人门禁及产品验收附件。产品部只负责范围、规则、优先级、验收和跨部门决策，仅修改 `docs/product/**`。
- 研发部：`docs/handoff/2026-07-27-engineering-department-handoff.md`。研发所有权为 `apps/api/**`、`packages/**`、`docs/engineering/**`。
- UI 部：`docs/handoff/2026-07-27-ui-department-handoff.md`。UI 所有权为 `apps/web/**`、`docs/ui/**`。

部门之间不得交叉修改所有权文件。共享工作树已有他人修改时必须保留；不得回退、覆盖、清理或顺手重构其他部门内容。没有用户明确授权时不得暂存、提交、推送、迁移外部数据库或部署。

## 3. 当前完成事实

### 3.1 P07 安全结构

- 授权正文、版本和 profile schema 只来自服务端批准 provider；缺失、异常、畸形或非 test 注入均 fail closed。
- USER 不能写筛查结论；可信结论同时校验持久化来源、STAFF 身份、当前角色、资格证据和批准 provider。
- profile 为本人作用域、版本化、schema 驱动草稿；legacy 任意 JSON 被隔离，敏感原始值不进入审计或幂等指纹。
- PUBLISH 与 screening 使用同一用户行序列化边界；发布事务在幂等 claim 和状态推进前重新读取 onboarding readiness。
- consent/profile provider 在启动时形成结构化不可变快照；调用方后续 mutation 不影响运行时状态。
- UI 只消费服务端正文、schema、`nextAction` 和 `recoverableActions`；`currentStep=null` 关闭编辑并权威恢复 session，权威重读失败时清除 stale editor。

P07 仍只能标记为“施工中”。正式授权内容、专业筛查规则、隐私批准 schema、生产 provider、真实环境和真人门禁均未取得。

### 3.2 P08/P09/P10 本地生命周期

- 已建立持久化计划 HTTP、双审核、发布、用户双确认/拒绝、超时、等待生效、受控激活、历史只读、单一 pending/scheduled、ACTIVE 冲突和计划空档结构。
- USER 计划读取与写入使用可信恢复身份；公开请求不以客户端时间、角色、原因或用户 ID 作为授权事实。
- 当前任务候选只验证唯一有效 ACTIVE 的安全准入，`items=[]`；尚未生成专业任务内容。
- P08/P09/P10 均保持“施工中”；真实 PostgreSQL 并发、专业内容、今日任务完整闭环和最终联合验收尚未完成。

## 4. 当前验证基线

2026-07-26 产品联合验收记录：

- 首次并行全仓执行只有 `identity-recovery.e2e.spec.ts` 首项发生 5 秒超时，不能据此判定业务失败；该文件随后单 worker `10/10` 通过。
- 全仓单 worker 完整重跑：`30/30` 个测试文件、`347/347` 项通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm run test:production-bundle --workspace @lianban/web`：通过。
- `git diff --check`：通过。
- UI 部最近独立证据：Web `19/19` 个文件、`234/234` 项通过，typecheck、production build、production bundle 通过。
- 研发部最近聚焦证据：P07 `15/15`、plan lifecycle `36/36`，API/domain/database typecheck 与 build 通过。

这些结果只证明当前本地代码切片，不证明正式内容、真实 PostgreSQL、浏览器人工验收、staging、生产或真人封测通过。

## 5. 未完成与外部门禁

- P11 已形成 test-only persistence 与 API pre-wiring 安全结构切片，但尚未形成完整业务闭环；P12-P13 尚未形成安全结构或完整业务闭环。
- P15-P17、P19-P21 尚未形成完整验收证据。
- 缺正式授权正文、筛查/风险/饮食/训练/周调整规则和具名专业签字。
- 缺认证安全决策、隐私字段与留存映射、数据权利演练、真实 PostgreSQL 迁移/恢复证据。
- 缺六目标视口、Chrome/Edge 键盘、Narrator、200% 缩放和 reduced-motion 人工证据。
- 缺备份恢复、监控告警、回滚、运营值班、风险升级和部署安全证据。
- `readyForRealUsers=false`；不得录入真人账号或数据，不得发布真人专业计划，不得宣布 G2/G3 或生产就绪。

## 6. 下一批唯一优先级

全部已授权 POST API pre-wiring 场景、一个 test-only GET context 成功预接线、一个 test-only PostgreSQL context read adapter 单场景及其 API context wiring 均已完成；UI test-only consumer 已通过 QA `QA_CLEAR` 与指定 Sol Critical `UI_CONTEXT_CONSUMER_REVIEW_COMPLETE`。当前仍没有生产 read adapter/API 依赖注册、真实专业 schema、真实用户成功路径、G2/G3 或 release 授权；任何后续工作必须重新由产品冻结范围并取得用户授权。

可定义和实现：可信 USER/计划/日期作用域、幂等、版本冲突、乱序/重复提交、关闭日期只读、权限、审计、route guard、版本化 provider/schema port、零副作用阻断和双虚构路线测试。

不得定义和实现：饮食字段、训练动作字段、单位、次数、组次、强度、偏离原因、疼痛阈值、补录时限、专业示例、安全文案、处方或调整规则。未取得专业批准前，真实记录写入必须 fail closed，demo fixture 不得成为正式 schema。

如果下一场景需要上述未批准内容，产品部必须停止并向用户说明所需真实责任人和证据，不得自行补齐。

## 7. 新增部门与职员边界

为完成 V1.0 而增设以下工作流；这些 Codex 部门只能准备材料、核对证据和提出问题，不能冒充具备执业资格或组织授权的真人签字人。

当前协作任务索引：

- 研发部（当前第二续接）：`019fa1fd-f84f-73b3-b3cd-2efd1348f118`
- UI 部（当前续接）：`019fa197-1ee5-74b1-aa52-da9ee304bd89`
- 研发部（第一续接，历史任务，只作交接来源）：`019fa197-1977-7f40-acf4-568587d4b237`
- 研发部（历史任务，只作交接来源）：`019f8f30-c635-7cd0-b78f-a91048f01467`
- UI 部（历史任务，只作交接来源）：`019f8f30-ad9c-7b81-b1ae-2c79c9f13f45`
- 专业审核部：`019fa18e-a4ec-7550-82dd-0aef8b8e293c`
- 安全与隐私部：`019fa18e-aa88-7812-90a1-c00e589d1754`
- 质量与无障碍部：`019fa18e-b038-7ad2-8501-64b8cc34275c`
- 运营与发布保障部：`019fa18e-b5d2-7163-8db6-76d40352da9e`

### 7.1 专业审核部

岗位：专业审核负责人、营养审核联络员、训练审核联络员、筛查/风险安全审核联络员。

职责：维护待真人专业审核的问题清单、版本映射和签字证据要求；核对实现是否越过已批准内容。不得生成或批准专业阈值、处方、动作、单位、安全结论或响应 SLA。

### 7.2 安全与隐私部

岗位：认证安全负责人、隐私负责人、数据权利审计员。

职责：审查认证策略、权限、会话、MFA、密码/锁定/重置、最小数据、留存、导出、删除/匿名化和审计证据。默认只读；不得修改应用或数据库，不得批准生产秘密、真实数据或合规结论。

### 7.3 质量与无障碍部

岗位：QA 负责人、跨浏览器测试员、无障碍验收员。

职责：建立独立运行证据，覆盖双路线、权限/状态/并发、六视口、键盘、焦点、Narrator、200% 缩放和 reduced-motion。只报告缺陷和证据，不修改产品规则或代替 UI/研发实现。

### 7.4 运营与发布保障部

岗位：运营负责人、发布与恢复协调员、风险升级演练协调员。

职责：准备值班、SLA、异常接单、风险升级、备份恢复、监控告警、回滚和发布清单。不得部署、连接生产、录入真人数据或关闭 G3 门禁；技术实现仍归研发，门禁结论归对应真人责任方与产品部。

## 8. 新产品部会话启动协议

新会话必须按顺序执行：

1. 完整读取本文、PRD、验收台账、真人门禁、研发交接和 UI 交接。
2. 读取当前 HEAD、`git status --short` 和暂存区；明确交接后新增文件，不把未提交状态误写为稳定交付。
3. 只确认接手、当前停点、下一批 P11 安全结构和部门边界；未收到用户“继续开发”指令前不修改文件。
4. 施工时由产品部先冻结 P11 验收规则；研发和 UI 各自唯一写入本部门文件；高风险认证、数据库、隐私或生产事项增加独立专项审查。
5. 每个批次完成后由产品部核对 PRD、台账、自动化、运行证据和外部门禁；测试通过不得自动把事项标记为“通过”。
6. 发现专业、安全、隐私、运营、真实数据或生产权限缺口时立即停止对应工作并询问用户。

任何与本文“唯一任务、事实源、部门边界、P11 下一批和 G2/G3 禁止”冲突的后续指令，必须先由用户明确确认范围变化；部门不得自行解释为已授权。
