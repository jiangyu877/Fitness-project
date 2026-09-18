# 练伴 V1.0 产品验收台账

版本：0.2
日期：2026-07-25
所有者：产品部
状态：施工中动态台账

## 1. 用途与效力

本台账用于产品部按 `docs/product/lianban-v1.0-prd.md` 追踪范围、验收证据和外部门禁，不新增或修改产品规则。发生冲突时，以 PRD 为唯一权威来源。

状态定义：

- `未开始`：尚无实现证据；
- `施工中`：已有部分实现或测试，但尚未完成端到端验收；
- `待验收`：实现已提交，等待产品、规格和质量复核；
- `通过`：已有与该要求范围相匹配的自动化及运行证据；
- `外部门禁`：只能由专业、安全、隐私、运营或部署责任方批准，不得由产品、UI 或研发自行补造。

路由存在、静态页面或单个单元测试都不能单独证明一项产品要求通过。

## 2. V1.0 交付台账

| 编号 | PRD 要求 | 当前状态 | 完成证据要求 | 当前说明 |
| --- | --- | --- | --- | --- |
| P01 | 唯一 PRD、范围与明确排除项 | 通过 | 权威 PRD 已冻结；UI/研发附件声明受其约束 | 不得出现短信、微信、AI、支付、媒体上传、公开注册、社交、设备、医疗或康复能力 |
| P02 | 32 个冻结页面与双端响应式骨架 | 施工中 | 32 个唯一页面 ID；所有路由可达；6 个目标视口无溢出或遮挡 | UI 规格 v1.3 已经产品部复核；32 路由可达，但多数仍是通用状态页，六视口与完整业务交互尚未验收 |
| P03 | 两套减脂/增肌模拟用户 | 施工中 | 两条路线使用同一状态语义完成核心流程；不得按姓名或用户 ID 硬编码 | Fixture v1.1 已经产品部复核；前端 persona 事实与跨页展示已对齐并通过独立复核，双路线完整 API/E2E 流程尚未验收 |
| P04 | 演示内容与真人发布隔离 | 施工中 | API、UI、数据库和绕过测试共同证明 demo 永远不可发布；默认环境阻断真人发布 | 前端生产构建已剔除 persona 切换器及专用样式并通过独立复核；服务端、数据库、环境和绕过发布的跨层证据仍需持续闭环 |
| P05 | 受邀用户登录、首次改密、会话恢复 | 施工中 | 用户入口、首次改密、停用/锁定、会话隔离、审计和安全测试 | 研发本地安全切片已有复核证据；UI 已修复同标签页刷新后的会话恢复与计划详情深链，并以服务端会话重新取得可信身份，当前自动化证据通过；浏览器人工刷新、密码恢复、受治理的 provider 注入及认证参数决策仍未完成 |
| P06 | 员工登录、五角色和职责分离 | 施工中 | 服务端 RBAC、自审禁止、用户/员工会话隔离、越权测试 | 计划路由授权、可信 actor、专业资格、自审禁止和统一 fail-closed 路由 guard 的本地切片已独立复核通过；生产 MFA、审计查询及持久化计划 HTTP 未验收 |
| P07 | 知情授权、筛查、人工复核、建档 | 施工中 | 分步恢复、授权版本、通过/复核/排除、资料补充和无半成品计划 | 本地安全结构已覆盖服务端批准授权正文、受信任筛查状态、schema 驱动建档、本人权限、幂等、版本冲突、审计、legacy JSON 隔离、provider fail closed、筛查回退后发布阻断及 UI `recoverableActions` 消费；2026-07-26 联合回归 `30/30` 个测试文件、`347/347` 项通过，类型检查、构建、生产包和差异检查通过。正式授权内容、专业筛查规则、隐私批准 schema、真实 PostgreSQL、真人环境及外部门禁仍未取得，`readyForRealUsers=false`，G2/G3 继续禁止 |
| P08 | 计划双审核、发布、双确认、超时与生效 | 施工中 | 领域、API、数据库、UI 和 E2E 覆盖全部允许/禁止分支 | 本地持久化生命周期、事务可信时间、双确认/拒绝/超时/受控生效和 UI 真实读写已形成自动化证据；生产测试时钟注入、动作级退回原因和必需写头已收紧；专业计划内容、真实 PostgreSQL 和最终独立复核尚未完成，默认专业规则未批准时继续阻断发布 |
| P09 | 版本不可变、单一待确认、历史和计划空档 | 施工中 | 并发/重复请求、旧计划到期、空档无任务、历史只读测试 | 本地迁移、唯一 pending/scheduled/ACTIVE、不可变、并发、旧计划不延长、历史最小披露和纯读取空档证据已形成；真实 PostgreSQL 压力并发与最终联合验收尚未完成 |
| P10 | 今日任务只来自当前计划 | 施工中 | 待确认、超时、退回、等待生效、空档和风险暂停均有任务生成反例测试 | 真实本人任务候选边界只允许唯一有效 ACTIVE；旧 ACTIVE 与新版本拒绝/超时、到期空档、多 ACTIVE、匿名/STAFF/跨用户均有持久化 HTTP 反例；2026-09-18 新增 test-only 结构化任务生成切片（唯一 ACTIVE 有限窗口按 Asia/Shanghai 业务日期生成 `record_task` 行并绑定既有 P11 记录路径，focused `5/5`、全量 `67/67 files`、`SELF_REVIEW_COMPLETE`）；生产候选读取仍固定为空，专业任务内容与生产闭环尚未实现 |
| P11 | 饮食三态与训练逐组/补录 | 施工中 | 条件字段、幂等、乱序、冲突、关闭日期只读和双路线 E2E | P11 已有多个 test-only 子切片收口；其中 `P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE` 已完成双虚构 persona 的本地 schema-driven runtime/browser 结构验收。P11 整体仍缺正式饮食三态、训练逐组/补录和疼痛等专业语义的双路线 E2E、生产 UI/runtime、真实数据权利处理、真人及发布门禁，因此总体继续施工中。 |
| P12 | 周反馈与完整新版本周调整 | 施工中 | 数据事实、缺失处理、保持项、重新双审/双确认及采纳记录 | 数据充分性和变化边界属于专业门禁；2026-09-18 首个 test-only 结构切片 `P12-WEEKLY-FEEDBACK-STRUCTURE` 收口：周窗口推导、9 字段清单、注入式充分性判定、数据不足硬限制（PRD §6.4）、疼痛路由与采纳记录结构，focused `8/8`、全量 `68/68 files`、`SELF_REVIEW_COMPLETE`；周调整草案生成、重新双审/双确认接线与生产闭环仍未实现 |
| P13 | 风险暂停、人工处理和专业恢复 | 未开始 | 风险事件、关联任务暂停、对应资格恢复、运营不可恢复、审计与并发测试 | 阈值、暂停范围、安全文案和 SLA 属于专业门禁 |
| P14 | Web 工作队列与共享详情 | 施工中 | 风险/逾期/优先级排序、权限过滤、详情上下文及失败保留筛选 | 已有演示页面，尚无真实队列闭环 |
| P15 | 消息已读与安全深链 | 施工中 | 已读、重读目标状态、失效和越权处理 | test-only API contract fixture、UI consumer/state和竞态证据已通过Sol；生产消息API、真人深链、browser完整验收未完成 |
| P16 | 数据导出、删除、匿名化与留存 | 施工中 | 双端请求、身份核验、7 日处理、冻结例外、定时处理和演练证据 | P11-DUAL-FIXTURE-DATA-RIGHTS-STATE test-only EXPORT/DELETE/ANONYMIZE 状态 fixture 与 UI 消费已通过 QA、安全、专业、UI、运营及新 Sol Critical：`GREEN / ALLOW — P11_DUAL_FIXTURE_DATA_RIGHTS_STATE_REVIEW_COMPLETE`；API fixture `6 passed / 0 skipped`、reducer/UI `20 passed`、Web `28 files / 272 passed / 0 failed`。该证据仅收口双 persona 状态合同；真实导出包、删除/匿名化、留存调度、数据权利演练和隐私合规门禁未完成。 |
| P17 | 测试账号与审计查询 | 未开始 | 创建/重置/解锁/停用；审计只读、脱敏、不可覆盖 | P1 最小能力，真人测试前必须满足安全门槛 |
| P18 | 错误、幂等、版本冲突和可追溯审计 | 施工中 | 稳定错误结构、关键写操作幂等、版本冲突、requestId 和审计事件 | 身份与持久化计划 HTTP 已覆盖稳定错误、主体/目标作用域幂等、并发冲突、独立审计 ID、可信 actor、拒绝审计和 OpenAPI；缺失写头稳定返回结构化 422，UI 不再自行推导 RETRY；审计查询、其余 P0 写路径及最终独立复核仍待完成 |
| P19 | 可访问性与浏览器/视口验收 | 通过 | 360/390/430、1024/1280/1440；Edge + Narrator、键盘、焦点、播报、200% 缩放、减少动态 | Edge 本地已实测冻结 32 路由：H5 19 路由在 CSS 360/390/430、Web 13 路由在 CSS 1024/1280/1440 均非空、有 H1 且无水平溢出；Edge 200% 等效约 195px、键盘 `:focus-visible`、44px 触控和 reduced-motion 规则已有证据。项目发起人确认 Edge + Narrator 实时播报、人工键盘和无障碍确认已完成，质量与无障碍部独立复核结论为 `QA_CLEAR / P19_ACCESSIBILITY_REVIEW_COMPLETE`。经用户范围调整不使用 Chrome；该结论仅限 P19，不外推真人服务、G2/G3、release 或 `readyForRealUsers`。 |
| P20 | 运维、备份恢复、监控与回滚 | 未开始 | HTTPS、备份恢复演练、错误追踪、告警、回滚、运营手册 | 部署地域、预算、域名与值班链属于外部门禁 |
| P21 | 四周测试指标与复盘数据 | 未开始 | 指标定义、埋点、查询、运营工时、价格意愿及安全一票否决可复盘 | 真人封测前还需运营测试手册签字 |

`P11-08-CONCURRENT_ABSENT_RECORD_CREATE`、P11-13/14/15及P11-16导出/删除请求状态fixture均已由指定Sol Critical收口。P11 本地可操作结构也已按命名 test-only slice 经 browser 执行和最终 Sol Critical 收口；P11 总体业务双路线 E2E、真实删除/匿名化/留存实施、数据权利演练、真人和发布门禁仍未完成，P11 总体不得标记通过。

### 2026-08-24 P11 双路线首场景授权补充

P11-06 `SAME_INTENT_REPLAY` 以既有工作日志/审查证据为准，保持已收口。为推进本地 test-only 双路线目标，当前唯一新授权为 `P11-DUAL-FIXTURE-RECORD-WRITE`：仅以 `persona_fat_loss` 与 `persona_muscle_gain` 两套虚构 USER fixture，通过现有 record command route 与隔离 PG18 验证各自合法写入、主体/task 绑定、幂等和成功审计零跨主体泄露。消息 P15、数据权利 P16、生产/真人/G2/G3/release 仍需分别授权和冻结机器合同。

P11-DUAL-FIXTURE-RECORD-WRITE 已收口：named test `1 passed / 19 skipped`，QA、安全、专业、UI、运营均完成边界复核，指定新 Sol Critical 正式结论为 `GREEN / ALLOW — P11_DUAL_FIXTURE_RECORD_WRITE_REVIEW_COMPLETE`，无 Critical/Important/Minor。该结论仅限本地 test-only 双虚构 fixture record-write；P11 总体双路线闭环、消息 P15、数据权利 P16、生产/真人/G2/G3/release 仍未完成或冻结。

P11-DUAL-FIXTURE-MESSAGE-STATE 已收口：named test `1 passed / 1 skipped`，两实际 persona 的 subject-scoped 消息列表、重复已读、服务端目标重读和 fail-closed `CLEAR_ALL` 均通过；QA、安全、专业、UI、运营边界复核完成，指定新 Sol Critical 正式结论为 `GREEN / ALLOW — P11_DUAL_FIXTURE_MESSAGE_STATE_REVIEW_COMPLETE`，无 Critical/Important/Minor。该结论仅限 test-only 消息 contract/UI state，不证明生产消息持久化、真人深链、P16、G2/G3 或 release。

P11-DUAL-FIXTURE-DATA-RIGHTS-STATE 已收口：双 persona 各 14 个合法状态、同主体幂等、跨主体 `CLEAR_ALL`、未知/畸形 fail closed、非法 seed/duplicate guard 及同主体同 `requestId` 跨 `requestType` seed 拒绝均通过；API fixture `6 passed / 0 skipped`，reducer/UI `20 passed`，Web `28 files / 272 passed / 0 failed`。QA `QA_CLEAR`、安全 `SECURITY_NO_OBJECTION`、专业 `PROFESSIONAL_CLEAR`、UI `UI_NO_CHANGE_CLEAR`、运营 `OPERATIONS_BLOCKED / MAINTAINED`，新 Sol Critical 正式结论为 `GREEN / ALLOW — P11_DUAL_FIXTURE_DATA_RIGHTS_STATE_REVIEW_COMPLETE`，无 Critical/Important/Minor。旧 API `5 passed` 仅为修复前历史基线；本结论仅限 test-only fixture/UI-state，不证明真实 P16 处理、留存/调度、生产、真人、P11 总体双路线闭环、G2/G3、release 或 `readyForRealUsers`。

依据 P16 安全预审 `SECURITY_PREFLIGHT_CLEAR`、质量预审 `QA_CONDITIONAL_ALLOW` 和运营 `OPERATIONS_BLOCKED / MAINTAINED`，当前唯一新授权为 `P11-DUAL-FIXTURE-DATA-RIGHTS-STATE`：仅复用既有 EXPORT/DELETE/ANONYMIZE test-only request-status fixture 与 UI parser/client/state，验证两实际虚构 persona 的可信主体绑定、同主体 requestId 幂等、跨主体 `CLEAR_ALL` 和未知/畸形 fail closed；不执行真实数据权利处理。

P11 三个双路线 test-only 子切片已分别收口。当前唯一下一场景授权为 `P11-DUAL-FIXTURE-EVIDENCE-ORCHESTRATOR`：仅组合已收口的 lifecycle、record-write、message-state、data-rights-state 证据，生成证据层分离的本地预备报告。编排器不得新增 endpoint、业务状态、数据库写入、worker、scheduler、UI/browser 行为或真实数据权利处理；报告必须明确 `API_FAKE`、`PG18_REPOSITORY`、`CROSS_LAYER_E2E`、`UI_STATE`、`BROWSER` 的证据来源与是否实际执行，缺失或未执行证据必须标记 `INCOMPLETE`，不得推导为通过。该授权只用于 G2 预备包，不打开 G2/G3、生产、真人、release 或 `readyForRealUsers=true`。

本场景允许为清除 workspace 类型门禁，对既有 test-only fixture 做最小类型注解或泛型收窄；该验证性修复不得改变运行时行为、合同、测试范围或产品语义，完成后必须重新执行 typecheck 和本场景复核。

G2 预备包当前结论为 `INCOMPLETE / G2_PREPARATION`：生命周期双 persona named test 已新鲜 `1 passed / 35 skipped`，`P11-DUAL-FIXTURE-RUNTIME-BRIDGE` 已通过真实 PG18 named test `1 passed` 并完成主体/goal/task/record/幂等/审计桥接；message-state、data-rights-state、UI/browser 证据仍按层保留并标注历史或未执行。不得把编排器的合成完整 manifest 测试或局部 bridge 当作实际全链路运行证据。P11 总体双路线、G2/G3、生产、真人、release 和 `readyForRealUsers=true` 继续冻结。

为补齐上述本地 test-only 统一链路，当前唯一下一场景授权为 `P11-DUAL-FIXTURE-RUNTIME-BRIDGE`：仅建立 `persona_fat_loss` 与 `persona_muscle_gain` 的共享测试上下文，将 lifecycle 的可信主体/计划/任务事实桥接到已收口的 PG18 record adapter，并验证两主体各自通过现有 record command route 的绑定与证据分层。不得新增生产 endpoint、消息或数据权利 runtime、迁移、worker、scheduler、UI/browser 行为、真人数据或专业规则；完成后仍需 QA、边界部门和新 Sol Critical 复核。

`P11-DUAL-FIXTURE-RUNTIME-BRIDGE` 已收口：真实 PG18 named test `1 passed`、API typecheck/build、diff-check 通过、临时库 `0`；QA `QA_CLEAR`、安全 `SECURITY_NO_OBJECTION`、专业 `PROFESSIONAL_CLEAR`、UI `UI_NO_CHANGE_CLEAR`、运营 `OPERATIONS_BLOCKED / MAINTAINED`，新 Sol Critical `GREEN / ALLOW — P11_DUAL_FIXTURE_RUNTIME_BRIDGE_REVIEW_COMPLETE`。该结论仅限 test-only API→PG18 bridge，不关闭 G2 或后续 message/data-rights/browser/staging 缺口。

在当前产品目标 `P11 双路线本地可操作闭环验收` 下，唯一下一场景授权为 `P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE`：仅以 `persona_fat_loss` 和 `persona_muscle_gain` 的虚构 test-only session/task，通过既有 P11 context/command contract、隔离 PG18 adapter 和本机浏览器完成 schema-driven record 读取、一次写入、权威重读与跨主体隔离验证。UI 只能从服务端 test-only schema 渲染 primitive 字段，不得按 persona、姓名、goal、URL 或缓存推断授权。不得新增或定义饮食三态机器值、偏离原因、训练动作/组次/单位、补录规则、疼痛/风险规则、P15/P16 行为、生产路由/迁移/外部数据库、staging、真人、G2/G3、release 或 `readyForRealUsers=true`。研发负责 test-only runtime、web consumer 和验证；后续 QA/安全/专业/UI/运营及新 Sol Critical 均只对本命名切片复核。

`P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE` 已按命名 test-only slice 收口：`PG18_REPOSITORY + CROSS_LAYER_E2E` runtime focused `5 passed`；`UI_STATE` client/state/page/selector `43 passed`；launcher lifecycle `7 passed`；API/Web typecheck/build、生产包排除和 diff-check 通过；`BROWSER` 在 1280 x 720 视口完成减脂、增肌各一次写入和权威重读，回看减脂时未出现增肌值，双路线截图已留存。首轮 Sol Critical `REJECT` 的五个 Important 已按同一命名 slice 完成 RED -> GREEN 纠偏，后续 liveness 检查补齐缺失 admin URL、单请求超时和 Windows 子进程隔离；最终只读边界为 QA `QA_CLEAR`、UI `UI_CLEAR`、本地运维 `LOCAL_SLICE_CLEAR`、安全 `SECURITY_NO_OBJECTION`、专业 `PROFESSIONAL_CLEAR`，scoped Sol re-review 为 Critical/Important/Minor `0/0/0` 并结论 `GREEN / ALLOW — P11_DUAL_FIXTURE_LOCAL_OPERABLE_STRUCTURE_REVIEW_COMPLETE`。默认并行 `npm test` 因 worker OOM 中止，最终隔离 PG18 单 worker 回归为 `65/66 files`、`797/806 tests`，9 项失败全部来自超出本场景的旧 `plan-lifecycle` 固定日期窗口与当前可信时间冲突；较早中断运行的残留库已受控清理，最终 port-5433 全量运行自动清理至 `lianban_%` 为 0。本条不得外推为 P11 总体通过、G2/G3、生产、真人、release 或 `readyForRealUsers=true`，生产运维继续 `OPERATIONS_BLOCKED`，也不自动授权下一场景。

### 2026-09-17 计划生命周期固定日期回归预审

经用户授权的只读预审确认：`plan-lifecycle.e2e.spec.ts` 的 9 项失败（8 项阻断于 P08 发布 lead-time 规则、1 项属 P09/P10 边界多 ACTIVE 读守卫）均为测试夹具固定日期相对真实时钟老化所致——受影响测试未注入 `planClock`，发布与读守卫按数据库真实时间 fail closed 属正确生产行为。生产代码自 2026-07-26 无改动，无需修改。修复建议为 test-only `planClock` 注入，须另行产品授权后按单场景流程执行；详见 `../engineering/plans/2026-09-17-plan-lifecycle-fixed-date-regression-preflight.md`。P08/P09/P10 台账状态不变；本预审不构成修复或回归全绿证据。

## 3. 阶段门槛

| 阶段 | 当前结论 | 尚缺证据 |
| --- | --- | --- |
| G0 技术准备 | 通过 | 无 |
| G1 核心编码 | 已获项目发起人施工授权，限本地演示与安全结构实现 | 认证安全决策、部署约束；专业规则模块只能搭字段骨架与阻断态 |
| G2 双端联调 | 未达到 | P0 技术契约、真实 API 闭环、两套 fixture、权限/时间/状态语义联合验收 |
| G3 真人封闭测试 | 禁止 | 专业四领域签字、隐私合规、数据权利、权限安全、备份恢复、值班与风险升级演练 |

## 4. 当前施工顺序

1. 完成计划生命周期 API、持久化约束与 H5/Web 关键状态交互；
2. 对 P01-P21 做规格符合性和代码质量复核；
3. 实现授权/建档、每日记录、周反馈、工作队列与周调整；
4. 实现认证安全、数据权利、审计和运维能力；
5. 执行双路线 E2E、视口、无障碍、安全、迁移和恢复验收。

每一阶段只有在相应证据落盘后才能把状态改为 `通过`。
