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
- 用户已批准上述 test-only 双数据库边界。研发现在只可开始该单场景 RED -> 最小 GREEN；QA 聚焦核对后交唯一指定 Sol Critical 复审。仍不得自动开启第二场景、注册生产依赖、进入真人路径或改变 G2/G3 门禁。
- 本单场景现已完成：研发报告 PG18 单文件 `3 passed`、六文件 P11 回归 `56 passed / 0 skipped`、API typecheck/build/diff/staged 通过；QA 返回 `QA_CLEAR`；指定 Sol Critical 返回 `GREEN / ALLOW — P11_CONTEXT_ADAPTER_REVIEW_COMPLETE`，无 Critical/Important。结论仅限 test-only API-to-PG18 adapter 接入，不授权下一场景、生产注册、真人、G2/G3 或 release。

## 0.4 2026-08-04 P11-11 单场景授权

- 产品部在上一单 test-only API-to-PG18 context adapter 场景收口后，冻结下一且仅下一场景为 P11-11：关闭日期或关闭任务的 context 读取返回本人已有记录并标记 `READ_ONLY`，读取不得改变任务、记录、计划、幂等或审计状态。
- 允许范围：仅使用现有 test-only context reader、已审查 PG18 adapter 和虚构双库 fixture；研发先观察真实 RED，再做最小 GREEN，证明可信 USER、本人任务、关闭事实、既有记录、严格 schema/版本和零副作用。
- 禁止范围：任何创建/修改/补录写入、专业字段或阈值、补录时限、安全文案、第二 HTTP 场景、生产/外部数据库、生产依赖注册、UI 施工、真人路径、部署、G2/G3 或 `readyForRealUsers=true`。
- 固定流程：产品授权 -> 研发 RED -> 最小 GREEN -> QA 只读核对 -> 唯一指定 Sol Critical（`019fb206-82b9-7ae1-9b1c-1bd9136169a2`）独立复审 -> 产品收口。未完成复审前，其余场景全部冻结。
- 停止条件：若关闭事实、记录归属、只读响应、零副作用或 schema 绑定需要新增产品规则/专业语义，或需要生产 adapter、外部数据库、UI/浏览器或第二场景，立即停止并上报。
- 本单场景已完成：研发报告 P11-11 聚焦 `1 passed`、PG18 context 文件 `4 passed`、六文件串行回归 `57 passed / 0 skipped`、API typecheck/build/diff/staged 通过；QA 返回 `QA_CLEAR`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-11_REVIEW_COMPLETE`，Critical/Important 均为 0。证据仅限 test-only 关闭日期只读读取、空动作、完整七表前后快照和隔离 PG18 fixture；不授权下一场景、生产注册、真人、G2/G3 或 release。

## 0.5 2026-08-16 P11-12 单场景授权

- 产品部冻结下一且仅下一场景为 P11-12 的一个精确分支：在 `test-only` 隔离 PG18 fixture 中，对服务端已标记 `date_state=CLOSED` 且已有本人记录的任务发起一次合法结构的 `UPSERT_RECORD`，必须稳定返回 `RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作。
- 拒绝前后必须对实际相关表的完整行和计数做相等比较，至少覆盖计划、计划版本、任务、记录、幂等、记录成功审计和通用审计；不得生成记录版本推进、完成幂等结果或成功审计。
- 允许范围仅为 test-only API-to-PG18 写 adapter/fixture、现有虚构 schema 和现有稳定错误信封；API 身份继续使用 PGlite，PG18 仅为本地隔离测试数据库。
- 禁止范围包括其他关闭分支、创建/补录语义、关闭或补录时限、专业字段/单位/阈值/文案、UI 施工、生产注册、外部/生产数据库、真人数据、部署、G2/G3、release 或 `readyForRealUsers=true`。
- 固定流程：产品授权 -> 研发真实 RED 或如实记录 direct GREEN -> 最小 GREEN -> QA 只读核对 -> 安全/专业边界核对 -> 唯一指定 Sol Critical 独立复审 -> 产品收口。任何第二场景继续冻结。
- 本单场景已完成：本地 PG18 不可用与默认超时被正确归类为基础设施问题；有效 RED 为真实 controller 返回 `503`，最小 GREEN 仅在 test builder 接入既有 PG18 repository 并转换受控异常后返回精确 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作。七表完整行与计数前后相等；P11-12 聚焦 `1 passed`、PG18 文件 `5 passed`、六文件串行 `58 passed / 0 skipped`，API typecheck/build/diff/staged 通过。QA `QA_CLEAR`，安全 `SECURITY_NO_OBJECTION`；指定 Sol Critical 在工程计划自审文本同步后返回 `GREEN / ALLOW — P11-12_REVIEW_COMPLETE`，Critical/Important 均为 0。仅收口该 test-only 分支，不授权下一场景。

## 0.6 2026-08-16 P11-12 任务关闭单场景授权

- 产品部冻结下一且仅下一场景为 P11-12 的任务关闭分支：在 `test-only` 隔离 PG18 fixture 中，服务端 `task_state=CLOSED`、同一 USER/task 已有记录时，一次合法结构 `UPSERT_RECORD` 必须返回 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作。
- 请求前后继续以实际相关七表 `SELECT *` 完整行和计数相等证明零状态副作用；不得新增记录、推进版本、声明完成幂等或追加成功审计。
- 复用已审查的 test-only write adapter、PGlite 身份和虚构 schema；如现有实现 direct GREEN 必须如实记录，不得伪造 RED或修改生产实现。
- 禁止其他关闭/风险/补录分支、关闭时点与时限、专业字段/单位/阈值/文案、UI 施工、生产注册、外部/生产数据库、真人、部署、G2/G3、release 或 `readyForRealUsers=true`。
- 固定流程保持产品授权 -> 研发单场景 TDD/直接 GREEN -> QA/安全/专业只读 -> 指定 Sol Critical -> 产品收口；任何后续场景继续冻结。
- 本分支 direct GREEN 并已完成：新增真实 API-to-PG18 测试仅将服务端 `task_state=CLOSED`，固定返回 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作，七表完整行与计数前后相等；未修改 controller、adapter 或生产实现。PG18 文件 `6 passed`、六文件串行 `59 passed / 0 skipped`，API typecheck/build/diff/staged 通过；QA `QA_CLEAR`，安全 `SECURITY_NO_OBJECTION`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_TASK_STATE_CLOSED_REVIEW_COMPLETE`，Critical/Important 均为 0。临时库无遗留，本地 PG18 恢复原停止状态；不授权下一场景。

## 0.7 2026-08-16 P11-12 风险阻断单场景授权

- 产品部冻结下一且仅下一场景为 P11-12 的风险阻断分支：在 `test-only` 隔离 PG18 fixture 中，服务端 `risk_state=BLOCKED`、同一可信 USER/task 已有记录时，一次合法结构 `UPSERT_RECORD` 必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作。
- 请求前后必须以实际相关七表 `SELECT *` 完整行和计数相等证明零状态副作用；不得新增记录、推进版本、声明完成幂等或追加成功审计。
- 本场景只验证既有服务端机器状态，复用已审查的 test-only write adapter、PGlite 身份、隔离 PG18 和虚构 schema；如现有实现 direct GREEN 必须如实记录，不得伪造 RED 或修改生产实现。
- 禁止定义风险阈值、触发条件、影响范围、恢复条件、安全文案或响应 SLA；禁止其他关闭/风险/补录分支、UI 施工、生产注册、外部/生产数据库、真人、部署、G2/G3、release 或 `readyForRealUsers=true`。
- 固定流程为产品授权 -> 研发单场景 TDD/direct GREEN -> QA/安全/专业只读核对 -> UI 确认既有阻断消费且不施工 -> 运营保持发布 BLOCK -> 唯一指定 Sol Critical（`019fb206-82b9-7ae1-9b1c-1bd9136169a2`）独立复审 -> 产品收口。任何后续场景继续冻结。
- 停止条件：若施工需要新增产品规则、专业风险语义、第二 HTTP 行为、生产依赖、外部数据库、UI 改动或真人路径，或无法证明七表完整零副作用，立即停止并上报。当前尚无本分支执行证据，研发部是唯一代码写入者。
- 本分支已 direct GREEN 并完成：新增真实 API-to-PG18 测试仅把服务端 `risk_state` 设为 `BLOCKED`，同时保持 `task_state/date_state=OPEN`；精确返回 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作，七表完整行与计数前后相等，未修改本轮生产逻辑。研发报告 PG18 文件 `7 passed`、六文件 `60 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 6 skipped`、PG18 文件 `7 passed`、六文件 `60 passed / 0 skipped`，API typecheck/build/diff/staged 通过，临时库计数为 0，PG18 恢复原停止状态。安全 `SECURITY_NO_OBJECTION`，专业 `PROFESSIONAL_CLEAR`，UI `UI_NO_CHANGE_CLEAR`，运营 `OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_RISK_STATE_BLOCKED_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。该结论仅收口本 test-only 分支，不授权下一场景。

## 0.8 2026-08-16 P11-12 风险阻断创建拒绝单场景授权

- 产品部冻结下一且仅下一场景为同一 P11-12 `risk_state=BLOCKED` 机器状态的创建拒绝分支：在 `test-only` 隔离 PG18 fixture 中，服务端 `task_state/date_state=OPEN`、同一可信 USER/task、无已有本人记录时，一次合法结构 `UPSERT_RECORD`（`expectedRecordVersion=null`）必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作。
- 请求前后必须以实际相关七表 `SELECT *` 完整行和计数相等证明零状态副作用；不得创建记录、幂等结果或成功审计。
- 本场景只补齐 P11-12 已定义的“创建拒绝”覆盖，复用既有 test-only write adapter、PGlite 身份、隔离 PG18 和虚构 schema；如现有实现 direct GREEN 必须如实记录，不得伪造 RED 或修改生产实现。
- 禁止定义风险阈值、触发条件、影响范围、恢复条件、安全文案或响应 SLA；禁止其他风险/关闭/补录分支、UI 施工、生产注册、外部/生产数据库、真人、部署、G2/G3、release 或 `readyForRealUsers=true`。
- 固定流程为产品授权 -> 研发单场景 TDD/direct GREEN -> QA/安全/专业只读核对 -> UI 确认既有阻断消费且不施工 -> 运营保持发布 BLOCK -> 唯一指定 Sol Critical 独立复审 -> 产品收口。任何后续场景继续冻结。
- 停止条件：若施工需要新增产品规则、专业风险语义、第二 HTTP 行为、生产依赖、外部数据库、UI 改动或真人路径，或无法证明七表完整零副作用，立即停止并上报。当前尚无本分支执行证据，研发部是唯一代码写入者。
- 本分支已 direct GREEN 并完成：新增真实 API-to-PG18 测试不插入本人记录，仅把服务端 `risk_state` 设为 `BLOCKED` 并保持 `task_state/date_state=OPEN`；合法命令显式使用 `expectedRecordVersion=null`，精确返回 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作，七表完整行与计数前后相等。本轮未修改 controller、builder、repository 或生产逻辑。研发报告 PG18 文件 `8 passed`、六文件 `61 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 7 skipped`、PG18 文件 `8 passed`、六文件 `61 passed / 0 skipped`，API typecheck/build/diff/staged 通过，临时库 0，PG18 恢复停止。安全 `SECURITY_NO_OBJECTION`，专业 `PROFESSIONAL_CLEAR`，UI `UI_NO_CHANGE_CLEAR`，运营 `OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_RISK_STATE_BLOCKED_FIRST_WRITE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。该结论仅收口本 test-only 分支，不授权下一场景。

## 0.9 2026-08-16 P11-12 关闭日期创建拒绝单场景授权

- 产品部冻结下一且仅下一场景为 P11-12 的关闭日期创建拒绝分支：在 `test-only` 隔离 PG18 fixture 中，服务端 `date_state=CLOSED`、`task_state=OPEN`、`risk_state=CLEAR`、同一可信 USER/task 且无已有本人记录时，一次合法结构 `UPSERT_RECORD`（`expectedRecordVersion=null`）必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作。
- 请求前后必须以实际相关七表 `SELECT *` 完整行和计数相等证明零状态副作用；不得创建记录、幂等结果、记录成功审计或通用成功审计。
- 本场景只补齐 P11-12 明确定义的关闭日期创建拒绝覆盖；不定义关闭时点、补录时限、专业字段、单位、阈值、文案或补录业务语义。如首次聚焦 direct GREEN 必须如实记录，不得伪造 RED 或顺带修改生产实现。
- 研发部是唯一代码写入者，只可在现有 test-only API-to-PG18 fixture 中新增一个场景并同步 `docs/engineering/**`；QA、安全、专业、UI 和运营仅在各自边界独立核对，最终只交指定 Sol Critical（`019fb206-82b9-7ae1-9b1c-1bd9136169a2`）复审。
- 禁止第二场景、生产注册、外部/生产数据库、真人数据、部署、V2、AI、医疗/康复、G2/G3、release 或 `readyForRealUsers=true`。若需要新增机器契约、专业规则、UI 改动或无法证明七表完整零副作用，立即停止并上报。
- 本分支首次聚焦 direct GREEN 并已完成：新增真实 API-to-PG18 测试不插入本人 record，只将服务端 `date_state` 设为 `CLOSED`，保持 `task_state=OPEN`、`risk_state=CLEAR`，合法命令显式使用 `expectedRecordVersion=null`；精确返回 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作，七表完整行与计数前后相等。本轮未修改 controller、builder、repository、database package、UI 或生产逻辑。研发报告 PG18 文件 `9 passed`、六文件 `62 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 8 skipped`、PG18 文件 `9 passed`、六文件 `62 passed / 0 skipped`，API typecheck/build/diff/staged 通过，临时库 0，PG18 停止且 5432 无监听。安全 `SECURITY_NO_OBJECTION`，专业 `PROFESSIONAL_CLEAR`，UI `UI_NO_CHANGE_CLEAR`，运营 `OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_DATE_STATE_CLOSED_FIRST_WRITE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。该结论仅收口本 test-only 分支，不授权下一场景。

## 0.10 2026-08-16 P11-12 任务关闭创建拒绝单场景授权

- 产品部冻结下一且仅下一场景为 P11-12 的任务关闭创建拒绝分支：在 `test-only` 隔离 PG18 fixture 中，服务端 `task_state=CLOSED`、`date_state=OPEN`、`risk_state=CLEAR`、同一可信 USER/task 且无已有本人 record 时，一次合法结构 `UPSERT_RECORD`（`expectedRecordVersion=null`）必须返回固定 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作。
- 请求前后必须以实际相关七表 `SELECT *` 完整行和计数相等证明零状态副作用；不得创建记录、幂等结果、记录成功审计或通用成功审计。
- 本场景只补齐 P11-12 明确定义的任务关闭创建拒绝覆盖；不定义任务关闭条件、关闭时点、补录时限、专业字段、单位、阈值、文案或补录业务语义。如首次聚焦 direct GREEN 必须如实记录，不得伪造 RED 或顺带修改生产实现。
- 研发部是唯一代码写入者，只可在现有 test-only API-to-PG18 fixture 中新增一个场景并同步 `docs/engineering/**`；QA、安全、专业、UI 和运营仅在各自边界独立核对，最终只交指定 Sol Critical（`019fb206-82b9-7ae1-9b1c-1bd9136169a2`）复审。
- 禁止第二场景、生产注册、外部/生产数据库、真人数据、部署、V2、AI、医疗/康复、G2/G3、release 或 `readyForRealUsers=true`。若需要新增机器契约、专业规则、UI 改动或无法证明七表完整零副作用，立即停止并上报。
- 本分支首次聚焦 direct GREEN 并已完成：新增真实 API-to-PG18 测试不插入本人 record，只将服务端 `task_state` 设为 `CLOSED`，保持 `date_state=OPEN`、`risk_state=CLEAR`，合法命令显式使用 `expectedRecordVersion=null`；精确返回 `409 RECORD_STATE_BLOCKED`、`DISABLE_EDITOR`、空恢复动作，七表完整行与计数前后相等。本轮未修改 controller、builder、repository、database package、UI 或生产逻辑。研发报告 PG18 文件 `10 passed`、六文件 `63 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 9 skipped`、PG18 文件 `10 passed`、六文件 `63 passed / 0 skipped`，API typecheck/build/diff/staged 通过，临时库 0，PG18 停止且 5432 无监听。安全 `SECURITY_NO_OBJECTION`，专业 `PROFESSIONAL_CLEAR`，UI `UI_NO_CHANGE_CLEAR`，运营 `OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-12_TASK_STATE_CLOSED_FIRST_WRITE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。该结论仅收口本 test-only 分支，不授权下一场景。

## 0.11 2026-08-16 P11-03 跨用户任务防枚举单场景授权

- 产品部冻结下一且仅下一场景为 P11-03 的真实 API-to-PG18 跨用户任务负例：在 `test-only` 隔离 PG18 fixture 中，可信 USER A 使用本人有效会话请求归属于虚构 USER B 的完整 task/plan；一次合法结构 `UPSERT_RECORD` 必须返回固定 `404 RECORD_TASK_NOT_FOUND`、`CLEAR_ALL`、空恢复动作，不得区分目标不存在与目标属于其他主体。
- fixture 必须保持 USER B 的 account、plan、plan_version 和 record_task 归属一致；USER A 与 USER B 均为纯虚构标识。请求前后以实际相关七表 `SELECT *` 完整行和计数相等证明零业务副作用，不得创建记录、幂等结果、成功审计或泄露目标主体、计划、任务状态及 schema 事实。
- 本场景只补齐真实 controller + test-only PG18 repository 的跨层任务归属与最小披露证据。既有 API fake 仍只证明 controller 映射，既有 PG18 repository 单测仍只证明仓储行为；不得把三类证据混为生产防枚举、通用锁/并发/幂等/审计原子性或真人安全批准。
- 研发部是唯一代码写入者，只可在现有 PG18 测试中新增一个场景并同步 `docs/engineering/**`；如首次聚焦 direct GREEN 必须如实记录，不得伪造 RED。QA 独立复现，安全重点核对归属、防枚举和最小披露，专业/UI/运营仅核对边界，最终只交指定 Sol Critical（`019fb206-82b9-7ae1-9b1c-1bd9136169a2`）复审。
- 禁止第二 HTTP 场景、生产注册、外部/生产数据库、真人数据、部署、V2、AI、医疗/康复、专业字段或规则、G2/G3、release 或 `readyForRealUsers=true`。若需要修改 controller、builder、repository、database package、UI 或生产逻辑，或无法建立一致的虚构 USER B 归属与七表零副作用，立即停止并上报。
- 本分支首次聚焦 direct GREEN 并已完成：新增真实 API-to-PG18 测试保持 USER A 的有效会话，并建立完整一致的虚构 USER B account、plan、ACTIVE plan_version 和 record_task 归属链；USER A 对 USER B task 的合法 `UPSERT_RECORD` 返回精确 `404 RECORD_TASK_NOT_FOUND`、`CLEAR_ALL`、空恢复动作。公开响应不含 USER B、plan/version/task、schema 或状态 sentinel，七表完整行与计数前后相等。本轮未修改 controller、builder、repository、database package、UI 或生产逻辑。研发报告 PG18 文件 `11 passed`、六文件 `64 passed / 0 skipped`；QA 独立复现聚焦 `1 passed / 10 skipped`、PG18 文件 `11 passed`、六文件 `64 passed / 0 skipped`，API typecheck/build/diff/staged 通过，临时库 0，PG18 停止且 5432 无监听。安全 `SECURITY_NO_OBJECTION`，专业 `PROFESSIONAL_CLEAR`，UI `UI_NO_CHANGE_CLEAR`，运营 `OPERATIONS_BLOCK_MAINTAINED`；指定 Sol Critical 返回 `GREEN / ALLOW — P11-03_CROSS_USER_NON_ENUMERATION_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。该结论仅收口本地 test-only 跨层分支，不授权下一场景。

## 0.12 2026-08-18 P11-03 不存在任务单场景收口

- 产品部冻结下一且仅下一场景为 `P11-03-MISSING_TASK`：在现有 test-only 隔离 PG18 API adapter 中，可信 USER 使用本人有效会话请求一个没有 `recording.record_task` 行的 opaque 任务标识，并提交一次合法 `UPSERT_RECORD`。
- 必须返回固定 `404 RECORD_TASK_NOT_FOUND`、`CLEAR_ALL`、空恢复动作；响应不得区分任务不存在与其他不可读任务，不得泄露任务、目标、计划、schema、状态、token 或幂等键。
- 请求前后必须对 7 张 authority 表（`iam.account`、`iam.session`、`recording.p11_write_gate`、`recording.p11_write_gate_revision`、`recording.record_task`、`planning.plan`、`planning.plan_version`）与 3 张副作用表（`recording.record`、`recording.record_idempotency`、`recording.record_success_audit`）做完整 `SELECT *` 行和计数相等比较。API fake、repository 单测和真实 API→PG18 证据必须分别记录。
- 仅允许复用现有 test-only builder/adapter/fixture，研发不得修改 controller、builder、repository、database package、UI 或生产 wiring；若首次聚焦 direct GREEN，必须如实记录，不得伪造 RED。
- 研发已 direct GREEN，QA 已独立复现：聚焦 `1 passed / 11 skipped`，PG18 文件 `12 passed / 0 skipped`，typecheck/diff 通过；完整 10 表快照前后相等，临时 PG18 已清理并停止。此前指定 Sol Critical（`019fb206-82b9-7ae1-9b1c-1bd9136169a2`）指出的 4 张 authority 表快照缺口已补齐；重新复审结论为 `GREEN / ALLOW — P11-03_MISSING_TASK_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。该结论仅收口本地 test-only 场景；下一场景须另行产品冻结，生产/外部数据库、真人、部署、G2/G3、release 和 `readyForRealUsers=true` 继续禁止。

## 0.13 2026-08-18 P11-04-PLAN_NOT_ACTIVE 单场景授权

- 产品部冻结下一且仅下一场景为 `P11-04-PLAN_NOT_ACTIVE`：在现有 test-only 隔离 PG18 fixture 中，可信 USER 使用本人有效会话请求归属一致的虚构 task；服务端仅将关联 plan version 置为非 `ACTIVE`，保持 `task_state/date_state/risk_state=OPEN/OPEN/CLEAR`，不插入本人 record，并提交一次合法 `UPSERT_RECORD`（`expectedRecordVersion=null`）。
- 必须返回既有 `409 RECORD_PLAN_NOT_ACTIVE`、`CLEAR_ALL`、空恢复动作；响应不得泄露 token、task、plan、schema、幂等键、输入或 fixture sentinel。
- 请求前后必须对 7 张 authority 表（`iam.account`、`iam.session`、`recording.p11_write_gate`、`recording.p11_write_gate_revision`、`recording.record_task`、`planning.plan`、`planning.plan_version`）与 3 张副作用表（`recording.record`、`recording.record_idempotency`、`recording.record_success_audit`）做完整 `SELECT *` rows/count 相等比较。
- 仅允许研发新增一个 test-only PG18 场景并同步 `docs/engineering/**`；不得修改 controller、builder、repository、database package、UI 或生产 wiring，不得开启 P11-04 其他状态或其他 skipped。流程固定为研发 RED/direct GREEN -> QA 独立复现 -> 安全/专业/UI/运营只读 -> 指定 Sol Critical 复审 -> 产品收口。

## 0.14 2026-08-18 P11-04-PLAN_NOT_ACTIVE 修复后收口

- 初次研发 direct GREEN 和 QA/边界复核未通过指定 Sol Critical：fixture 的 `business_date=2026-01-02` 未被相对当前时间的计划有效窗口覆盖，因此即使状态为 ACTIVE 也可能返回 `RECORD_PLAN_NOT_ACTIVE`，旧结果存在假阳性。旧 QA 与四边界结论明确作废。
- 研发最小修复仅作用于 test-only fixture/断言：计划窗口固定为 `2026-01-01T00:00:00Z` 至 `2099-01-01T00:00:00Z`；状态变更前断言关联 version 为 ACTIVE 且覆盖固定业务日期，随后唯一业务变更为 `ACTIVE -> SUPERSEDED`。未修改生产 controller、builder、repository、database package、UI 或 production wiring。
- 修复后研发与 QA 分别报告聚焦 `1 passed / 12 skipped`、PG18 文件 `13 passed / 0 skipped`、六文件 `66 passed / 0 skipped`，API typecheck/build 和 diff 检查通过；7 张 authority 表与 3 张副作用表完整 rows/count 前后相等，固定 `409 RECORD_PLAN_NOT_ACTIVE / CLEAR_ALL / []` 无敏感回显，临时 PG18 已清理并停止、5432 无监听。
- 安全/隐私、专业、UI、运营/发布均在修复后重新只读复核并条件性 ALLOW；固定窗口仅用于 test fixture 因果隔离，不构成日期阈值、补录时限、专业字段、单位、文案或安全规则，也未引入 UI、外部/生产数据库、部署或真人路径。
- 指定 Sol Critical 复审结论为 `GREEN / ALLOW — P11-04_PLAN_NOT_ACTIVE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。该结论仅关闭本地 test-only P11-04 单场景；当前无下一场景授权，其他 skipped、生产/外部数据库、真人、部署、G2/G3、release 与 `readyForRealUsers=true` 继续冻结。

## 0.15 2026-08-18 P11-05-CLIENT_USER_FIELD_REJECTED 单场景授权

- 产品部将“继续”限定为 P11-05 的一个最小客户端 authority 字段拒绝场景：可信 USER、本人有效会话、现有合法 `UPSERT_RECORD` body 仅额外加入伪造 `userId` 字段。
- 现有 strict command schema 必须在 repository port 之前拒绝该请求，返回 `400 RECORD_REQUEST_INVALID`、`CLEAR_ALL`、空恢复动作；fake 必须零调用，公开响应不得回显伪造 userId。该场景只证明 API 输入边界，不证明 PG18、锁、并发、幂等、审计、生产或真人行为。
- 仅允许研发新增一个 test-only API fake/controller 测试并同步工程记录；不得修改 production wiring、PG18 adapter、repository、database package 或 UI，不得开启 P11-05 其他伪造变体、其他 skipped、生产/外部数据库、部署、真人、G2/G3、release 或 `readyForRealUsers=true`。
- 流程固定为研发 RED/direct GREEN -> QA 独立只读复现 -> 安全/专业/UI/运营边界复核 -> 指定 Sol Critical 复审 -> 产品收口；发现需要新 authority 规则、专业语义或运行时生产改动立即停止。
- 本场景已完成并收口：研发 direct GREEN、QA 独立复现及安全/专业/UI/运营条件性 ALLOW 均保持在同一 test-only API 输入边界；focused `1 passed / 29 skipped`、四文件 `53 passed / 0 skipped`、API typecheck/build/diff 通过。上一轮 Sol Critical 提出的工程计划范围、自审清单和工作日志行号问题已由责任部门修复；唯一指定 Sol Critical 复审返回 `GREEN / ALLOW — P11-05_CLIENT_USER_FIELD_REJECTED_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。当前无下一场景授权；该结论不证明 PG18、生产权限、锁、并发、持久化幂等、审计原子性、真人、G2/G3、release 或 `readyForRealUsers=true`。

## 0.16 2026-08-20 P11-08-CONCURRENT_EXISTING_RECORD_UPDATE 单场景授权

- 产品冻结下一且仅下一场景为 P11-08 的既有记录并发更新：test-only 隔离本机 PG18 中，可信 USER、本人 task、有效 ACTIVE plan/date、`OPEN/OPEN/CLEAR`、本人既有 record version 1；两个不同幂等键、不同 requestId、不同虚构 opaque entry value 的合法 `UPSERT_RECORD` 均提交 `expectedRecordVersion=1`。
- 必须用受控 PostgreSQL 锁等待或测试屏障证明两条请求真实重叠并在同一旧版本上竞争，不能用 fake、顺序调用或单纯 `Promise.all` 冒充并发。精确结果必须恰好一个 `200 RECORD_WRITE_ACCEPTED`、recordVersion 2，另一个 `409 RECORD_VERSION_CONFLICT`、`PRESERVE_DRAFT_FOR_VERSION_CONFLICT`、`['REFRESH']`；成功机器响应按现有合同不要求 `requestId`，冲突响应必须绑定失败请求的 `requestId`，成功请求由成功审计的 `request_id` 绑定。
- 成功响应不返回 entries；最终 PG18 record 必须仍为一行、recordVersion 2，`entries` 深度精确等于唯一成功请求的完整值且不包含失败请求值。相对既有 version 1 基线恰好新增一条状态为 `COMPLETED` 的幂等行，`replay_result` 精确匹配成功 record 的 id、version 和 schema；成功审计只新增一份。authority 事实不变，公开响应及持久化投影不得泄露 token、原始幂等键或内部状态。
- 研发部是唯一代码与 `docs/engineering/**` 写入者，只允许在现有 test-only PG18 API fixture 中实现这一场景及必要的确定性测试屏障；不得修改生产 wiring、业务规则、专业字段、UI 或迁移。QA 独立复现，安全/专业/UI/运营分别只读核对，最终只交指定 Sol Critical `019fb206-82b9-7ae1-9b1c-1bd9136169a2`。
- absent-record create、same-key replay、P11-09、其他并发/乱序分支、生产/外部数据库、真人、部署、V2、AI、医疗/康复、G2/G3、release 和 `readyForRealUsers=true` 全部冻结。若无法形成确定性竞争证据、需要新增产品/专业语义或生产改动，立即停止并上报。

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
- 缺六目标视口、Edge 键盘、Narrator、200% 缩放和 reduced-motion 人工证据；经用户范围调整，本轮不使用 Chrome。
- 缺备份恢复、监控告警、回滚、运营值班、风险升级和部署安全证据。
- `readyForRealUsers=false`；不得录入真人账号或数据，不得发布真人专业计划，不得宣布 G2/G3 或生产就绪。

## 6. 下一批唯一优先级

全部已授权POST API pre-wiring、test-only GET/context adapter与已列P11跨层场景均按各自范围收口；产品现已授权唯一下一场景P11-07-SAME_KEY_CHANGED_INTENT，只验证同raw key改变一个opaque entry后的真实API→PG18冲突。其他changed-intent、absent-record create、其他skipped、生产/真人/G2/G3/release继续冻结。

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

## 0.16 收口记录（2026-08-21）

- P11-08 已完成研发、QA、安全/隐私和指定 Sol Critical 门禁。研发与 QA 的实际结果为 focused `1 passed / 13 skipped`、PG18 `14 passed / 0 skipped`、六文件 API 回归 `68 passed / 0 skipped`，typecheck/build/diff 通过，暂存区为空，临时库为 `0`，PG18 已停止且 5432 无监听。
- Sol Critical 复审确认两个 Important 已关闭：唯一 `COMPLETED` 幂等行绑定获胜 session/HMAC digest 并排除失败 key；锁屏障、请求等待和异常清理均有界且在 `finally` 释放。最终结论为 `GREEN / ALLOW — P11-08_CONCURRENT_EXISTING_RECORD_UPDATE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。
- 本次只收口 test-only、loopback PG18、虚构数据的既有记录并发更新；不得外推生产锁策略、通用并发/幂等/审计原子性、真人、G2/G3 或 release。当前没有下一场景授权；absent-record create、same-key replay、P11-09、生产/外部数据库、UI/生产 wiring、真人及全部发布门禁继续冻结。

## 0.17 2026-08-23 P11-09-OUT_OF_ORDER_OLD_REQUEST 单场景授权

- 产品二次授权唯一下一场景：test-only 隔离本机 PG18 中，可信 USER 的既有 record 先由较新合法请求从 version 1 推进到 version 2，再让携带旧 `expectedRecordVersion=1` 的较旧请求乱序到达。
- 必须结果：旧请求返回现有 `409 RECORD_VERSION_CONFLICT` 信封；最终 record 的 version、schema 和完整 entries 保持较新成功结果；旧请求不得新增 `COMPLETED` 幂等结果或成功审计。客户端时间不参与权威判断，场景不新增时间字段、专业字段或规则。
- 研发唯一修改 test-only 测试与 `docs/engineering/**`；QA、 安全/隐私、专业、UI、运营只读核对；最终交指定 Sol Critical。same-key replay、absent-record create、P11-10、生产/外部数据库、真人、G2/G3、release 和 `readyForRealUsers=true` 继续冻结。

## 0.17 收口记录（2026-08-23）

- P11-09 已完成研发、QA、安全/隐私、专业、UI、运营和指定 Sol Critical 门禁。研发与 QA 实际结果为 focused `1 passed / 14 skipped`、PG18 `15 passed / 0 skipped`、六文件 API 回归 `69 passed / 0 skipped`，typecheck/build/diff 通过，暂存区为空，临时库为 `0`。
- 指定 Sol Critical 复审确认 Critical/Important/Minor 均为 0，结论为 `GREEN / ALLOW — P11-09_OUT_OF_ORDER_OLD_REQUEST_REVIEW_COMPLETE`。安全、专业、UI、运营分别返回 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`UI_NO_CHANGE_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`。
- 本次仅收口 test-only、loopback PG18、虚构数据的服务端版本乱序拒绝；5432 外部 PID 监听属于本轮开始前环境状态，未停止非本轮进程。不得外推生产乱序、通用并发/幂等/审计原子性、真人、G2/G3 或 release。当前没有下一场景授权；same-key replay、absent-record create、P11-10、生产/外部数据库、UI/生产 wiring、真人和全部发布门禁继续冻结。

## 0.18 2026-08-23 P11-10-SCHEMA_VERSION_CONFLICT 单场景授权

- 产品二次授权唯一下一场景：test-only 隔离本机 PG18 中，可信 USER/本人 task/ACTIVE plan/date/OPEN-OPEN-CLEAR、既有 schema-v1 record 收到 schema-v2 合法 `UPSERT_RECORD`。
- 必须结果：现有 `409 RECORD_SCHEMA_VERSION_CONFLICT / CLEAR_ALL / ['REFRESH']`；十张实际迁移表 rows/count 前后一致，原 record/version/schema-v1、幂等和成功审计均不变；不增加专业字段、客户端时间或新错误语义。
- 研发唯一修改 test-only 测试与 `docs/engineering/**`，QA/安全/专业/UI/运营只读，最终交指定 Sol Critical。same-key replay、absent-record create、其他 skipped、生产/外部数据库、真人、G2/G3、release 和 `readyForRealUsers=true` 继续冻结。

## 0.18 收口记录（2026-08-23）

- P11-10 已完成研发、UI、QA、安全/隐私、专业、运营和指定 Sol Critical 门禁。API/PG18 实际结果为 focused `1 passed / 15 skipped`、PG18 `16 passed / 0 skipped`、六文件 `70 passed / 0 skipped`，API typecheck/build/diff 通过；UI focused `59/59`、Web typecheck 通过；临时库为 `0`、暂存区为空。
- UI Important 已通过 RED→GREEN 修复：`RECORD_SCHEMA_VERSION_CONFLICT` 现在进入既有 CLEAR_ALL 清除集合，仅在服务端动作严格为 `REFRESH` 时保留该动作。页面 `.tsx` 未被 Vitest include 规则收集，不形成页面/浏览器验收证据。
- 指定 Sol Critical 正式结论为 `GREEN / ALLOW — P11-10_SCHEMA_VERSION_CONFLICT_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0；安全、专业、运营结论分别为 `SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`OPERATIONS_BLOCK_MAINTAINED`。
- 本次仅收口 test-only、loopback PG18、虚构数据的 schema 版本拒绝；5432 外部 PID 监听属于本轮开始前环境状态，未停止非本轮进程。不得外推生产 schema 迁移、通用兼容/并发/幂等/审计原子性、真人、G2/G3 或 release。当前没有下一场景授权，same-key replay、absent-record create、其他 skipped、生产/外部数据库、UI/生产 wiring、真人及全部发布门禁继续冻结。

## 0.19 2026-08-23 P11-06-SAME_INTENT_REPLAY 单场景授权

- 产品二次授权唯一下一场景：test-only 隔离本机 PG18 中，可信 USER/本人 task/ACTIVE plan/date/OPEN-OPEN-CLEAR、合法既有记录或合法首次写入 fixture，使用同一完整规范化写入意图和同一 raw idempotency key 提交两次请求。
- 必须结果：两次业务响应完全相同；record/version 只推进一次；仅一条 `COMPLETED` 幂等行和一条成功审计；第二次不增加任何成功副作用。不得把 fake/controller 或 repository 单测替代真实 API→PG18 重放证据。
- 研发唯一修改 test-only 测试与 `docs/engineering/**`；QA/安全/专业/UI/运营只读，最终交指定 Sol Critical。changed-intent、absent-record create、其他 skipped、生产/外部数据库、真人、G2/G3、release 和 `readyForRealUsers=true` 继续冻结。

## 0.19 收口记录（2026-08-23）

- P11-06 已完成研发、QA、安全/隐私、专业、UI、运营和指定Sol Critical门禁。实际结果：focused `1 passed / 16 skipped`、PG18 `17 passed / 0 skipped`、六文件 `71 passed / 0 skipped`，typecheck/build/diff通过，暂存区空，临时库0。
- 同一完整意图/raw key两次请求响应深度相同，record/version只推进一次；唯一COMPLETED幂等行和成功审计不重复。指定Sol Critical结论 `GREEN / ALLOW — P11-06_SAME_INTENT_REPLAY_REVIEW_COMPLETE`，Critical/Important/Minor均为0。
- 证据仅限test-only loopback PG18；一次错误过滤的全skip未计证据，5432外部进程未停止。当前没有下一场景授权；changed-intent、absent-record create、其他skipped、生产/真人/G2/G3/release继续冻结。

## 0.20 2026-08-23 P11-07-SAME_KEY_CHANGED_INTENT 单场景授权

- 第一次合法请求成功后，第二次复用同一raw idempotency key但只改变一个opaque entry值；必须返回`409 IDEMPOTENCY_KEY_REUSED / CLEAR_ALL / ['USE_NEW_IDEMPOTENCY_KEY']`且不泄露首次结果。
- 最终record/version/entries、唯一COMPLETED幂等行和唯一成功审计保持第一次成功结果；第二次零成功副作用。真实API→PG18证据不得由fake或repository单测替代。
- 初始研发仅改test-only测试/工程计划；UI只读复核发现`IDEMPOTENCY_KEY_REUSED`未被client-state完整消费后，产品在同一场景内授权UI最小RED→GREEN修复，仅允许纳入既有CLEAR_ALL并严格保留`USE_NEW_IDEMPOTENCY_KEY`及focused测试。其余场景和全部发布门禁冻结，最终仍交指定Sol Critical。
- P11-07 entry-value分支已最终收口：API`1/17`、PG18`18`、六文件`72/0`、UI`60/60`，QA/安全/专业/运营无阻断；指定Sol Critical`GREEN / ALLOW — P11-07_SAME_KEY_CHANGED_INTENT_REVIEW_COMPLETE`，Critical/Important/Minor均为0。其他changed-intent与absent-record create继续冻结。

## 0.21 P11-08-CONCURRENT_ABSENT_RECORD_CREATE授权

- 无既有record；两个合法请求使用不同session/requestId/raw key/opaque entry，同task/kind/schema且`expectedRecordVersion=null`。必须按repository冻结锁序在实际最早同主体account `FOR UPDATE`边界暂停第一事务，并由`pg_stat_activity` Lock等待证明第二事务真实重叠；释放后继续task锁和权威状态重读。
- 恰好一个200/version1，一个409`RECORD_VERSION_CONFLICT / PRESERVE_DRAFT_FOR_VERSION_CONFLICT / ['REFRESH']`；最终仅胜者record/COMPLETED idem/audit各一份，失败零副作用，authority不变。
- 仅test-only API→隔离PG18测试/工程计划；生产、专业、其他场景与发布门禁冻结。
## 0.22 P11-15-MESSAGE_READ_SAFE_DEEP_LINK 最小合同授权

- messageId、readState UNREAD/READ、opaque targetType/targetId；已读幂等；深链打开必须服务端重读；失效/越权/主体变化统一CLEAR_ALL并清除stale目标。
- 仅UI/state/API contract fixture；不新增专业字段、生产行为或真人路径。P11-16、双路线E2E、browser和发布门禁继续冻结。
- 已批准端点：`GET /api/v1/messages`、`POST /api/v1/messages/:messageId/read`、`GET /api/v1/message-targets/:targetType/:targetId`；严格envelope、可信USER session、opaque定位和test-only fixture形状按P11附件第31节执行，禁止生产注册/迁移。
## 0.23 P11-16-DATA_EXPORT_REQUEST_STATUS 最小合同授权

- test-only fixture只验证可信USER提交/查询导出请求状态，严格字段opaque requestId、requestType=EXPORT、status四态；主体来自session，不由客户端提交。
- 同主体同requestId重复幂等；跨主体统一CLEAR_ALL，不泄露状态/数据。无真实导出包、真人字段、生产数据库或定时任务。
- 删除、匿名化、留存实施、7天处理和真人数据权利演练仍属冻结门禁；研发/UI单场景施工后再交QA、安全/隐私、专业、运营和Sol Critical。
## 0.24 P11-16-DATA_EXPORT_REQUEST_STATUS收口与DELETE_REQUEST_STATUS授权

- 导出状态最小fixture已通过QA、安全、专业、运营和Sol Critical：`GREEN / ALLOW — P11-16_DATA_EXPORT_REQUEST_STATUS_REVIEW_COMPLETE`，仅收口opaque request status，不代表真实导出。
- 下一单仅验证可信USER提交DELETE/ANONYMIZE状态fixture，同主体幂等、跨主体CLEAR_ALL；真实删除、匿名化、留存和演练继续冻结。
## 0.25 P11-16 DELETE_REQUEST_STATUS收口

- API/UI统一合同通过QA、安全、专业、运营和Sol Critical：`GREEN / ALLOW — P11-16_DELETE_REQUEST_STATUS_REVIEW_COMPLETE`，Critical/Important/Minor均为0；仅收口test-only请求状态fixture。
- 真实删除、匿名化、留存调度、数据权利演练、生产、真人、G2/G3和release继续冻结。

## 0.26 2026-08-24 P11 双路线闭环首场景授权

本节优先于本交接文档早于 2026-08-24 的“唯一下一场景”停点描述，用于解决 P11-06 已收口记录与旧冻结文字的时间差：P11-06 `SAME_INTENT_REPLAY` 已由工作日志和验收台账记录为 `GREEN / ALLOW` 并保持已收口；本轮唯一新授权为 `P11-DUAL-FIXTURE-RECORD-WRITE`。

- 仅使用既有虚构 USER fixture：`persona_fat_loss`（`FAT_LOSS`）和 `persona_muscle_gain`（`MUSCLE_GAIN`）；两条路线共享同一机器状态、权限、schema、错误和 fail-closed 语义，不按姓名或固定用户 ID 推导授权。
- 仅验证现有 `POST /api/v1/record-tasks/:taskId/commands` 的合法 `UPSERT_RECORD`，每个主体一个独立 opaque task、session、requestId、raw idempotency key 和 opaque `field-1` 字符串值；请求使用既有 `schema-v1`/`kind-1`，不得引入专业字段、单位、阈值、风险或恢复语义。
- 证据必须来自真实 API→隔离 PG18 repository：两主体各自成功响应、record version、主体/task 绑定、各一条完成幂等和成功审计，且无跨主体泄露；API fake 不能替代 PG18 证据。
- 本场景不新增 endpoint、migration、生产 wiring、UI、消息、数据权利、worker/scheduler 或真人行为；P15 消息和 P16 数据权利必须另行产品机器合同和单场景授权。
- 流程固定为产品授权 -> 研发 RED/最小 GREEN -> focused PG18 -> QA -> 安全/专业/UI/运营边界复核 -> 指定 Sol Critical `019fb206-82ca-7531-a03e-555fc0094c1b` -> 产品收口。任一范围扩大、PG18 管理 URL 缺失、无法证明零跨主体泄露或需要新增业务规则，立即停止。

## 0.27 2026-08-24 P11 双路线消息状态下一场景授权

P11-DUAL-FIXTURE-RECORD-WRITE 已正式收口。依据 QA `QA_CONDITIONAL_ALLOW`、安全预审无阻断和运营 `OPERATIONS_BLOCKED / MAINTAINED`，下一且仅下一场景冻结为 `P11-DUAL-FIXTURE-MESSAGE-STATE`。

- 仅复用既有 P15 test-only message contract fixture 与 UI parser/client/state；两套虚构 USER 使用实际 persona 映射和可信主体输入，不能按 persona 名称或固定 user ID 分支。
- 消息对象严格四字段：`messageId`、`readState: UNREAD | READ`、opaque `targetType`、opaque `targetId`；每个主体分别验证列表、已读幂等、服务端目标重读、主体变化/失效/未知/畸形输入统一 `CLEAR_ALL`。
- 允许新增或扩展 test-only fixture、UI state/client focused 测试和工程记录；不证明消息持久化、生产 API、真人深链或数据库幂等。
- 禁止新增生产消息 endpoint、数据库表/迁移、通知发送、worker/scheduler、消息正文、目标 URL 授权、P16 数据权利行为、真人、部署、G2/G3、release 或 `readyForRealUsers=true`。
- 流程固定为产品授权 -> 研发 RED/最小 GREEN -> focused fixture/UI -> QA -> 安全/专业/UI/运营边界复核 -> 新 Sol Critical -> 产品收口；不得把 record-write 或既有单 persona message fixture 直接外推为双路线消息闭环。

## 0.28 2026-08-24 P11 双路线数据权利状态下一场景授权

P11-DUAL-FIXTURE-MESSAGE-STATE 已正式收口。依据安全 `SECURITY_PREFLIGHT_CLEAR`、质量预审 `QA_CONDITIONAL_ALLOW` 和运营 `OPERATIONS_BLOCKED / MAINTAINED`，下一且仅下一场景冻结为 `P11-DUAL-FIXTURE-DATA-RIGHTS-STATE`，用于补齐前置的双 persona test-only 状态消费机器合同。

- 仅复用既有 P16 test-only EXPORT/DELETE/ANONYMIZE request-status fixture 与 UI parser/client/state；两实际虚构 USER `persona_fat_loss`、`persona_muscle_gain` 使用可信主体输入，各自独立 requestId 和状态。
- 状态对象只允许 opaque `requestId`、`requestType`、`status`；EXPORT 使用既有四态，DELETE/ANONYMIZE 使用既有五态含 `FROZEN`。同主体同 requestId 幂等，跨主体读取或提交统一 `CLEAR_ALL`，未知/空/畸形输入 fail closed。
- 允许新增或扩展 test-only fixture、UI focused 测试和工程记录；禁止生成真实导出包、读取真人字段、执行删除/匿名化/留存/调度/worker、添加生产 API/迁移、消息/P15行为、专业字段或真人路径。
- 本场景只证明双 persona 的最小状态机器一致性，不证明真实隐私合规、数据权利演练、生产持久化或 G2/G3/release。流程固定为产品冻结 -> 研发 RED/最小 GREEN -> focused fixture/UI -> QA -> 安全/隐私/专业/UI/运营边界复核 -> 新 Sol Critical -> 产品收口。

本场景已完成并收口：API fixture focused `6 passed / 0 skipped`；reducer/UI focused `20 passed`；Web 全量 `28 test files / 272 passed / 0 failed`；旧 API `5 passed` 仅为修复前历史基线。QA `QA_CLEAR`、安全 `SECURITY_NO_OBJECTION`、专业 `PROFESSIONAL_CLEAR`、UI `UI_NO_CHANGE_CLEAR`、运营 `OPERATIONS_BLOCKED / MAINTAINED` 均已在计数同步后重新确认；新 Sol Critical 正式结论为 `GREEN / ALLOW — P11_DUAL_FIXTURE_DATA_RIGHTS_STATE_REVIEW_COMPLETE`，Critical/Important/Minor 均为 0。仅收口本地 test-only 双 persona 状态 fixture/UI-state；真实导出、删除、匿名化、留存/调度、生产、真人、P11 总体双路线、P15、G2/G3、release 和 `readyForRealUsers=true` 继续冻结，下一场景须另行产品授权。

## 0.29 P11 双路线证据编排器下一场景授权

P11-DUAL-FIXTURE-RECORD-WRITE、P11-DUAL-FIXTURE-MESSAGE-STATE 和 P11-DUAL-FIXTURE-DATA-RIGHTS-STATE 均已按各自机器合同收口。下一且仅下一场景冻结为 `P11-DUAL-FIXTURE-EVIDENCE-ORCHESTRATOR`，目标是生成 G2 预备包所需的证据目录，不重新实现或放宽任何业务合同。

- 编排器只能读取或组合已收口的双 persona lifecycle、record-write、message-state、data-rights-state 证据记录；不得新增 endpoint、迁移、生产 adapter、数据库写入、worker、scheduler、页面、浏览器行为或真实数据权利处理。
- 输出必须按证据层分栏：`API_FAKE`、`PG18_REPOSITORY`、`CROSS_LAYER_E2E`、`UI_STATE`、`BROWSER`，同时标明每层来源、实际执行状态、范围和未覆盖项；不得把 API fake 当作 PG18 或持久化证据，不得把历史报告当作本轮执行。
- 两个虚构主体 `persona_fat_loss` 与 `persona_muscle_gain` 必须在可适用的每一层保持主体隔离；缺失、冲突、未执行或越权证据统一生成 `INCOMPLETE`，不得猜测补全。
- 本场景的结果只能是本地 `G2_PREPARATION` 证据包，不是 G2 通过。`readyForRealUsers=false`、G2/G3、生产、真人、release 和真实 P16 处理继续禁止。
- 固定流程：产品冻结 -> 研发先写单场景 RED -> 最小 GREEN -> 聚焦验证 -> QA -> 安全/专业/UI/运营只读复核 -> 新 Sol Critical -> 产品收口；其他 skipped 场景继续冻结。

本场景可为清除 workspace 类型门禁对既有 test-only fixture 做最小类型注解/泛型收窄；不得改变其运行时行为、合同或产品语义，完成后须重新执行 typecheck 与本场景复核。

本场景复核后，产品建立 G2 预备包目录：生命周期双 persona named test 新鲜 `1 passed / 35 skipped`；record-write 的 PG18/CROSS_LAYER_E2E、message/data-rights 的 UI_STATE 和 P19 的 BROWSER 均按独立证据层引用，未执行的 PG18/browser 在编排器运行中保持 `NOT_EXECUTED`，总体标记 `INCOMPLETE / G2_PREPARATION`。该包不构成 G2 通过，不授权生产、真人、真实 P16、G2/G3、release 或 `readyForRealUsers=true`；下一补齐项须另行产品冻结。

## 0.30 P11 双路线运行时桥接下一场景授权

G2 预备包已明确：当前缺口是 lifecycle 的 PGlite API 上下文与 record-write 的隔离 PG18 adapter 尚未在同一 test-only 双 persona 场景中桥接。下一且仅下一场景冻结为 `P11-DUAL-FIXTURE-RUNTIME-BRIDGE`。

- 仅允许建立共享 test-only fixture context/identity bridge，使用 `persona_fat_loss`、`persona_muscle_gain` 的可信主体、goal、plan、task、session 映射，并让两套事实分别被现有 record command route 与 PG18 adapter 消费。
- 结果必须分别证明两 persona 的主体/task 绑定、goal 映射和 record-write 来源层；API fake、PG18 repository、CROSS_LAYER_E2E 证据继续分栏，不能用桥接测试替代 message/data-rights/UI/browser 证据。
- 允许修改 test-only builder/helper 和新增一个 named test；禁止修改生产 endpoint、repository/database package、migration、消息/P16 runtime、UI/browser、worker/scheduler、专业字段、真人路径或外部/生产数据库。
- 固定流程：产品冻结 -> 研发 RED -> 最小 GREEN -> focused PG18 -> QA -> 安全/专业/UI/运营 -> 新 Sol Critical -> 产品收口；任一主体映射或证据来源不明确即停止并报告 `INCOMPLETE`。

本场景已完成并收口：两 persona shared test-only identity/fixture bridge 通过现有 record command route 进入隔离 PG18；named test `1 passed`，完整 record/幂等/审计/goal 断言、typecheck/build/diff-check 通过，临时库 `0`。QA、安全、专业、UI、运营均无阻断，新 Sol Critical 正式结论为 `GREEN / ALLOW — P11_DUAL_FIXTURE_RUNTIME_BRIDGE_REVIEW_COMPLETE`。该结论仅收口本地 `CROSS_LAYER_E2E + PG18_REPOSITORY` bridge，不证明消息/P16 runtime、browser/staging、P11 总体或 G2。
