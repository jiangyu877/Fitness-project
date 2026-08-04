# 练伴 V1.0 研发部交接

快照日期：2026-07-27  
唯一工作目录：`D:\project\Fittness project`  
当前分支：`codex/ui-ux-spec`  
当前 HEAD：`6b718594ad010897979afa0df243889fc228ba09`（`Advance P07 acceptance ledger with regression evidence`）  
交接前状态：工作树与暂存区均为空；本文是本次交接唯一新增文件。

## 1. 事实源与效力

1. `docs/product/lianban-v1.0-prd.md` 是唯一产品事实源。任何交接、工程契约、测试或历史说明均不得覆盖 PRD。
2. 当前验收状态以 `docs/product/lianban-v1.0-acceptance-ledger.md` 为准；P07、P08、P09、P10 均为“施工中”，P11 为“未开始”。
3. 真人服务门禁以 `docs/product/lianban-v1.0-readiness-gates.md` 为准。当前 `readyForRealUsers=false`，G2/G3 均未批准。
4. P07 细化语义见 `docs/product/lianban-v1.0-identity-recovery-acceptance.md` 与 `docs/product/lianban-v1.0-p07-safe-structure-acceptance.md`；计划生命周期见 `docs/product/lianban-v1.0-plan-lifecycle-acceptance.md`。
5. 已实现的机器接口、安全边界和稳定错误以 `docs/engineering/contracts/phase-1-stable-contract.md` 为准。

## 2. 研发所有权

研发部仅负责：

- `apps/api/**`
- `packages/**`
- `docs/engineering/**`
- 经明确交接指令创建的本文件

不得修改：

- `apps/web/**`
- `docs/ui/**`
- `docs/product/**`

共享工作树中出现其他部门修改时必须保留并协作，不得回退、覆盖或顺手整理。本交接不授权暂存、提交、推送、迁移外部数据库或部署。

## 3. 已完成的本地工程切片

### 3.1 P07 安全结构

- 当前授权说明只从显式批准 provider 读取；provider 缺失、异常或畸形时所有环境默认 fail closed，零授权写入。
- USER 只能接受当前服务端版本；可信会话、主体作用域幂等、版本冲突和结构化审计已建立。
- USER 无筛查结论写权限。筛查状态只由持久化结论、可信 STAFF 记录者、当前角色、资格证据和批准 provider 共同验证。
- `HUMAN_REVIEW`、`EXCLUDED`、provider 异常、schema 缺失或不合法均阻断 profile、plan 和 task 路径。
- profile 是本人作用域、schema 驱动的草稿读写；未知版本、步骤、字段、类型、重复/空结构均 fail closed。迁移前 `schema_version IS NULL` 的任意 JSON 被隔离，不返回、不合并、不隐式升级。
- profile 原始值不进入审计或可枚举的幂等指纹。
- migration `010_p07_safe_structure.sql` 已加入本地 PGlite/兼容 SQL 迁移链和升级测试；没有改写 `001`-`009`。

### 3.2 P08/P09 计划生命周期

- 计划 HTTP 已接入 PGlite/Postgres 兼容持久化仓储，不再以进程内 Map 作为事实源。
- 已覆盖草案、双专业审核、发布、用户饮食/训练分别确认或拒绝、确认超时、等待生效、受信任激活、内部替代、历史只读和计划空档。
- 发布、确认、超时、激活使用数据库事务可信时间；公开请求不接受客户端生命周期时间作为授权事实，非 test 环境忽略测试时钟注入。
- 已发布版本不可原地修改；同一用户唯一 pending/scheduled，ACTIVE 重叠和异常旁路数据 fail closed。
- 幂等绑定 operation、可信 principal 和 subject plan/version；请求标识只作 correlation，审计事件使用独立 UUID。
- USER detail/history/pending 使用最小 DTO，隐藏草案、审核决定、审核者和作者；跨用户与不存在对象保持防枚举响应。
- migration `009_plan_lifecycle_persistence.sql` 已加入追加迁移链；没有改写 `001`-`008`。

### 3.3 P10 任务候选准入

- 真实 `task-candidates` HTTP/仓储边界只允许可信当前时间窗口内唯一 `ACTIVE` 版本。
- pending、scheduled、rejected、timed out、superseded、future、expired、gap 或多 ACTIVE 异常均返回 `PLAN_GAP`。
- 当前切片不生成专业任务内容，`items=[]`，读取前后计划、审计、幂等和任务写入均保持不变。
- 新版本拒绝或超时时，未到期旧 ACTIVE 的状态与原 `effectiveTo` 不变；旧计划到期后进入空档，不静默延长。

## 4. 关键安全与并发决策

### 4.1 PUBLISH 与 screening 的用户级序列化

- `PUBLISH` 在读取/锁定计划版本之前先锁定目标 `iam.account` 用户行。
- 在同一数据库事务内重新读取当前授权、最新可信筛查结论和批准 schema 下的 profile 完成度。
- readiness 检查发生在幂等 claim、计划状态推进和成功审计之前。
- screening 写入使用同一用户行锁。因此先赢得序列化顺序并提交的 `HUMAN_REVIEW` 或 `EXCLUDED` 必须阻止发布；计划状态不推进，发布幂等记录为零。
- 仓储 `transitionWithWrite()` 的 `serializeOnAccountId` 必须在任何计划读取前执行；API 测试通过 `@lianban/database/dist` 消费仓储，修改数据库 workspace 后要先重建该 workspace，避免用旧 dist 得出错误结论。

### 4.2 provider 固定快照

- consent provider 在启动时校验、结构化复制并冻结版本和正文。
- profile schema provider 在启动时校验、结构化深复制并深冻结根对象、steps、fields 及其数组。
- provider 调用方在应用启动后的 mutation 不能改变运行时 `schemaVersion`、步骤或字段。
- 测试 provider 仅允许 `nodeEnv=test` 的虚构测试；非 test 环境不得通过注入获得批准状态。

### 4.3 路由与真人门禁

- readiness 与受保护路由使用同一不可变快照；未知路由、未知阻断码、provider 缺失或证据不一致均 fail closed。
- 测试中构造允许分支只证明代码路径，不是专业、安全、隐私或生产审批。
- 当前生产入口仍不得承载真人授权、筛查、profile、计划或任务业务。

## 5. 当前测试证据

当前 HEAD 所对应的产品台账记录了 2026-07-26 联合回归结果：

- 首次全仓并行执行发生超时，不能据此判定业务失败或通过。
- 随后以单 worker 模式完整重跑，结果为 `30/30` 个测试文件、`347/347` 项通过。
- 同一轮记录：类型检查、构建、生产包检查和差异检查通过。

最近研发聚焦证据还包括：

- P07 safe-structure：`15/15` 通过。
- plan lifecycle HTTP：`36/36` 通过，包含 screening 回退与 PUBLISH 可控并发、共享用户锁和零幂等写入断言。
- API、domain、database typecheck：通过。
- API、domain、database build：通过。
- `git diff --check`：通过；当时暂存区为空。

以上是本地自动化证据，不等于正式授权内容、专业规则、真实 PostgreSQL、staging、生产、G2 或 G3 获批。本次交接只读取既有证据，没有重新运行全仓测试。

## 6. 未完成与阻断项

- P07 仍缺正式授权正文、专业筛查规则、隐私批准的 profile schema、生产 provider、真人环境和全部外部门禁。
- P08 仍缺经批准的专业计划内容、真实 PostgreSQL 验证和最终完整产品验收。
- P09 仍缺真实 PostgreSQL 压力并发/约束验证和最终联合验收。
- P10 当前只有安全准入与空候选，没有专业任务内容、今日任务生成或完整执行闭环。
- P11-P17、P19-P21 仍未形成完整闭环；状态必须继续服从产品验收台账。
- 生产 MFA、认证参数、密钥管理、初始管理员播种、密码恢复、隐私留存映射、数据导出/删除演练、备份恢复、监控告警、运营值班和风险升级仍未获得完整批准或演练证据。
- migration CLI 尚未在受控真实 PostgreSQL 环境验证；不得把 PGlite 测试等同真实 PostgreSQL 升级、回滚或锁行为。
- staging、生产部署和 G3 真人封闭测试均未授权；不得录入真人账号/数据或发布真人专业计划。

## 7. P11 下一批边界

P11 是“饮食三态与训练逐组/补录”，当前状态为“未开始”。下一批若获指令，只能先做安全结构：

- 可做：可信 USER/计划/日期作用域、幂等、乐观并发、乱序/重复提交、关闭日期只读、审计、权限、route guard、纯结构 DTO/provider port、零副作用阻断和虚构 fixture 测试。
- 不可做：自行定义饮食字段、训练动作字段、单位、次数、组次、强度、偏离原因、疼痛阈值、补录时限、专业示例、安全文案或任何处方语义。
- 未取得专业字段和规则的版本化批准前，真实记录写入必须 fail closed；不得沿用任意 JSON 入口或把 demo fixture 当正式 schema。
- 减脂与增肌只能作为虚构测试标签验证同一状态/权限语义，不得形成两套硬编码业务逻辑。
- 若实现需要任何专业、隐私、安全、生产或真实数据决策，立即停止并交对应责任方，不得猜测。

## 8. 下一会话接手步骤

1. 确认唯一目录仍为 `D:\project\Fittness project`，读取当前 HEAD 和工作树；本交接只是快照，当前文件和测试优先于历史描述。
2. 重新完整读取 PRD、验收台账、readiness gates、对应验收附件和稳定工程契约。
3. 未获得明确开发指令前不要继续实现；获得指令后按 TDD 先建立可观察 RED。
4. 只修改研发所有权路径；不得修改 UI/产品文件，不得回退他人改动。
5. 不得暂存或提交；不得运行外部迁移、连接真实数据库或部署 staging/生产。
6. 完成任何后续切片时，分别报告本地工程证据、产品未验收项和外部门禁，不能用测试通过宣称真人就绪。

