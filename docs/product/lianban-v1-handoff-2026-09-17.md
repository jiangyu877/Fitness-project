# 练伴 V1.0 模型接管交接（2026-09-17）

用途：把 `D:\project\Fittness project` 交给新的模型继续工作。本文件定义接手协议、当前可核验快照和本机测试操作边界；它不替代 PRD。若本文与 Git、`AGENTS.md`、当前状态摘要、验收台账或工作日志冲突，停止施工，报告冲突，并以最新可验证证据为准。

## 0. 绝对规则

- 产品范围唯一权威：`docs/product/lianban-v1.0-prd.md`。
- 每轮只有一个活动场景。当前没有活动场景；不得从历史待办、失败测试或本文件自行推导新授权。
- `test-only`、fixture、PGlite、隔离 PG18、`API_FAKE`、`UI_STATE` 或本地 `BROWSER` 证据不证明生产、真人、G2、G3、release 或 `readyForRealUsers=true`。
- 接手模型不可以把自己的检查命名为 `QA_CLEAR`、`UI_CLEAR`、`SECURITY_NO_OBJECTION`、`PROFESSIONAL_CLEAR`、`LOCAL_SLICE_CLEAR` 或 `GREEN / ALLOW`。没有外部独立审查时，唯一允许的状态是 `SELF_REVIEW_COMPLETE` 或 `REVIEW_PENDING`。
- 禁止把管理员 URL、密码、token、原始幂等键、真实数据或其他秘密写入 Markdown、Git、聊天记录、`.env.example`、测试快照或截图。

## 1. 首次接管：只读顺序与停止条件

新模型的第一轮只能读取和报告，不能运行测试、启动数据库、写入、暂存、提交、推送或部署。

按以下顺序读取：

1. `AGENTS.md`。
2. `docs/product/lianban-v1-current-status.md`。
3. `docs/product/lianban-v1.0-acceptance-ledger.md` 的 P08-P11 与阶段门槛段落。
4. `docs/product/lianban-v1.0-work-log.md` 最后 12 行。
5. 本文件。
6. 运行只读 Git 命令：

   ```powershell
   git status --short
   git log -10 --date=iso-local --pretty=format:'%h`t%ad`t%s'
   ```

首份汇报固定为：`当前场景 / 已完成 / 本次证据 / 剩余阻断 / 下一步`。若当前状态、台账、日志、交接或 Git 有冲突，首份汇报只报告冲突；不要静默修改任何状态文档或进入下一场景。

## 2. 2026-09-17 可核验快照

| 项目 | 当前事实 | 证据或限制 |
| --- | --- | --- |
| 工作目录 | `D:\project\Fittness project` | 当前 worktree 位于 `C:\Users\jiang\.codex\worktrees\0674\Fittness project`；不要假设其他 worktree 相同。 |
| 分支 / 最新提交 | `codex/ui-ux-spec` / `c6dcb77 feat(p11): capture dual-fixture local evidence flows` | 必须由首次 `git log` 重新核对。 |
| 活动场景 | 无 | `P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE` 已收口并停止；不自动授权 lifecycle 修复。 |
| 阶段门槛 | G0 通过；G1 仅本地演示和安全结构施工；G2 未达到；G3 禁止；`readyForRealUsers=false` | 当前状态摘要和验收台账为准。 |
| 已收口 P11 局部证据 | `PG18_REPOSITORY + CROSS_LAYER_E2E` runtime `5/5`；`UI_STATE` `43/43`；launcher `7/7`；本机 `BROWSER` 双虚构 persona 写入、权威重读和隔离 | 只收口命名 test-only slice，不代表 P11 整体、生产或真人。 |
| 仓库全量历史结果 | 隔离 PG18、单 worker：`65/66 files`、`797/806 tests` | 这是此前执行记录，不是本轮复跑结果；9 项 lifecycle 失败仍为仓库级阻断。 |

本工作树当前已有且必须保留的未提交内容：

- 已修改：`docs/product/lianban-v1-current-status.md`、`docs/product/lianban-v1.0-work-log.md`。
- 未跟踪：本文件 `docs/product/lianban-v1-handoff-2026-09-17.md`。
- 无关且禁止触碰：`%SystemDrive%/`、`SHAP_学术研究方法论_可编辑公式.docx`。

前三份产品文档是同一份 2026-09-17 交接快照，应作为一个文档变更一起审阅和提交；不得将无关未跟踪项加入暂存。建议提交前运行文档检查和 `git diff --check`，提交信息使用 `docs(handoff): add model continuation handoff`。只有产品负责人确认交接内容准确后才允许提交；本文件不授权自动提交。

## 3. 后续协作治理映射

旧流程中的多个“部门”由同一主模型模拟。今后使用以下不可降级的映射。

| 角色 | 谁承担 | 能做什么 | 不能做什么 |
| --- | --- | --- | --- |
| 产品负责人 | 用户 | 在对话中授权或拒绝一个命名场景；决定范围、优先级、是否接受交接/产品状态变化 | 不因历史计划自动授权后续场景。 |
| 接手模型 | 一个主工作线程 | 产品拆解、研发、UI、测试执行、运行记录、工程计划和自检；单场景内唯一写入者 | 不冒充独立 QA、安全、专业、运营、UI 验收或 Sol Critical。 |
| QA / 安全 / 专业 / UI / 运营 | 与主写入线程独立的真实审阅线程或用户指定负责人 | 对各自范围只读核对，并只在真实完成后出具本角色结论 | 不共享写入者上下文来宣称“独立”；未审时必须是 `REVIEW_PENDING`。 |
| Sol Critical | 与主写入线程独立的 Codex 审阅任务，或用户指定的等效独立审阅者 | 对冻结 diff、授权范围、测试证据和风险边界进行严格只读复审，给出 findings-first 的 `ALLOW` 或 `REJECT` | 不写代码、测试、数据库、暂存或提交；不以历史线程结论覆盖新 diff。 |

若 Codex 能创建独立任务，产品负责人应明确要求创建一个新的 `Sol Critical` 只读审阅任务，并提供：场景名、授权文本、基准提交、当前 diff、已执行命令及原始计数、未执行项和禁止范围。历史线程 ID 仅是历史审计索引，不能当作仍可用的审阅者。曾经的 `429 Too Many Requests` 只代表审阅未执行，绝不等价于通过、阻断结论或可跳过复审。

没有独立 reviewer 时，接手模型可以交付代码和实际测试结果，但场景状态必须保持 `REVIEW_PENDING`，不能关闭验收台账，也不能给自己生成任何上述 clearance 结论。

### 单场景授权格式

用户在对话中的明确授权是开工前提。授权必须至少包含下列字段；信息缺失时接手模型必须先提问，而不是猜测：

```text
SCENE: <唯一名称>
OBJECTIVE: <一个可验收目标>
ALLOWED: <可修改文件/模块和允许行为>
EXCLUDED: <明确禁止的模块、产品语义、环境和门槛>
REQUIRED_EVIDENCE: <真实 RED 或允许 direct GREEN、focused 命令、typecheck/build/browser 等>
INDEPENDENT_REVIEWS: <需要的角色审阅及 Sol Critical>
STOP: <何种结果、范围扩张或基础设施异常必须停止>
```

授权后的写入顺序固定：先在对应 `docs/engineering/plans/<date>-<scene>.md` 写入授权、冻结范围、RED/direct-GREEN 判定与验证计划；再改代码/测试；完成后追加工作日志；只有产品状态发生变化时才更新验收台账。不得用验收台账代替用户对话授权，也不得仅因授权就把台账标为通过。

## 4. 当前产品边界与未关闭项

P08、P09、P10、P11 均仍为“施工中”。P11 的已收口子切片包括 record-write、message-state、data-rights-state、evidence-orchestrator、runtime-bridge 和 local-operable structure；这些是分层、test-only 历史证据，不构成 P11 整体通过。

以下仍未关闭，且本交接不授权其施工：

- P11 正式饮食三态、训练逐组/补录、疼痛/风险等专业语义的双路线 E2E。
- P11 生产 API/UI/runtime，P15 生产消息，P16 真实导出/删除/匿名化/留存调度和数据权利演练。
- P12、P13、P14 真实队列、P17、P20、P21，以及认证 MFA、隐私合规、备份恢复、运营值班、部署安全。
- staging、生产、真人数据、G2、G3、release 与 `readyForRealUsers=true`。

推荐但尚未授权的下一步不是修复，而是单一只读预审：`PLAN-LIFECYCLE-FIXED-DATE-REGRESSION-PREFLIGHT`。它只允许确认失败的实际用例、可信时间来源、P08/P09/P10 归属和最小修复边界；不允许修改测试、时钟、业务逻辑、数据库、迁移或状态文档。

## 5. 本机 PG18 与双库操作手册

### 5.1 设计、权威位置和安全边界

- PGlite 是多数 API/lifecycle fixture 的内存数据库；`apps/api/test/plan-lifecycle.e2e.spec.ts` 使用 `databasePath: 'memory://'`。
- PG18 是 P11 repository/cross-layer 和 local runtime 的本机 loopback PostgreSQL 18 管理入口，通过测试 harness 为每次运行创建并删除一次性数据库。两者并存是为了把 PGlite 的 API/lifecycle 快速 fixture 与 PostgreSQL 的迁移、锁、幂等、审计和清理证据分开，不能互相外推。
- PG18 测试 harness 的权威代码是 `packages/database/test/support/postgres-test-harness.ts`；它只接受 `postgres:`/`postgresql:`、`localhost`/`127.0.0.1`/`::1` 和维护库 `/postgres`，并且只允许删除正则匹配 `lianban_p11_test_<32 hex>` 的库。
- P11 local runtime 的入口是 `scripts/p11-local-operable-runtime.ts`，API runtime 在 `apps/api/test/support/p11-local-operable-runtime.ts`，生命周期防护在 `apps/api/test/support/p11-local-operable-runtime-lifecycle.ts`。连接配置故意不在 `apps/api/src` 或 `packages/database/src` 的运行时生产配置中。
- 本仓库不声明或管理 Windows PostgreSQL 服务。不要猜测服务名、安装目录、当前监听状态或凭据；只有在用户明确授权运行 PG18 测试后，才从用户已配置的本机安全来源取得管理员 URL。

### 5.2 端口、凭据和清理

| 项目 | 已知事实 | 接手操作规则 |
| --- | --- | --- |
| 5432 | 历史上曾是共享本地 PG18 入口；一次中断运行留下过一个生成库 | 不是本场景的默认目标；不停止、不清理其他进程或未知数据库。 |
| 5433 | 最后一次完整单 worker 回归使用的专用 loopback 管理员 URL 端口 | 这是历史运行选择，不是硬编码要求。可用时仍须先验证 URL 是 loopback `/postgres`。 |
| 管理员 URL | `LIANBAN_TEST_POSTGRES_ADMIN_URL` 为一般 PG18 test harness 来源；`P11_LOCAL_POSTGRES_ADMIN_URL` 优先于它供 launcher 使用 | 仅在当前 PowerShell 进程设置，不写文件、不回显。local launcher 对缺失值立即报 `P11_LOCAL_POSTGRES_ADMIN_URL_REQUIRED`。 |
| 临时库 | 标准 harness 为 `lianban_p11_test_<32 hex>`；local runtime 为 `lianban_p11_local_<uuid hex>` | 运行应在 `finally` 关闭 pool、终止目标库会话并只删除自己生成的精确名称。失败或中断后先只读列出匹配 `lianban_%` 的库并报告；不得用通配删除，更不得删除非 `lianban_` 库。 |

本地 runtime 在成功启动后创建一库、迁移、seed 两个虚构 persona，并在 `/p11-local/shutdown` 或 launcher 清理时关闭服务、关闭连接池、终止该库会话并删除该库。Windows 下 API child 是 detached/hidden，以免终端 Ctrl+C 把 API 一并异常杀掉；launcher 仍必须检查 API cleanup 的真实 exit status。

### 5.3 `npm run dev:p11-local`（仅在获授权的 P11 local 场景）

前置条件：Node `>=24`、npm `>=11`、已安装 workspace 依赖、私有的 loopback PG18 管理员 URL、端口 3100 和 5175 未冲突。运行前在当前 PowerShell 会话设置 URL，不要把实际值贴入命令历史或本文件：

```powershell
$env:P11_LOCAL_POSTGRES_ADMIN_URL = '<privately supplied loopback postgresql URL ending in /postgres>'
npm run dev:p11-local
```

launcher 预期输出两个 readiness 事实：API `P11_LOCAL_RUNTIME_READY http://127.0.0.1:3100`，随后 Web `P11_LOCAL_WEB_READY http://127.0.0.1:5175/h5/p11-local`。只访问后者。它以 `VITE_P11_LOCAL_RUNTIME=true` 启动 Vite；普通 dev/production 不能暴露该路由。

在当前已收口结构中的浏览器操作顺序如下，未来仅在同一或明确授权的新场景重用：

1. 选择 `persona_fat_loss`，提交一个不含专业含义的 opaque primitive 值，等待权威 reread。
2. 选择 `persona_muscle_gain`，提交不同值，等待权威 reread。
3. 回到减脂 fixture，确认它只显示自己的记录且不显示增肌值。
4. 保存两个截图至 `docs/engineering/evidence/`，文件名包含场景、fixture、动作和日期；截图与工作日志中必须标注 `BROWSER`，并说明其不等同 P19 Edge/Narrator。
5. 两个 readiness 均已出现后，在 launcher PTY 发送 Ctrl+C；验证 3100/5175 不再监听、生成库归零。外层 npm/PowerShell 在 Windows 可返回 1；只有没有 `P11_LOCAL_WEB_EXIT_*`、API cleanup 成功、端口和临时库清理完成时，才能将其记录为成功清理。

## 6. 环境开关：含义与当前模板值

`.env.example` 是本地开发模板，不是 PG18 凭据位置，也不等同测试中手工构造的已批准环境。当前模板如下：

| 变量 | 模板值 | 代码效果 / 当前解释 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 仅允许 `development`、`test`、`production`。 |
| `PORT` | `3000` | API 正常运行端口；P11 local runtime 改用其独立的 `P11_LOCAL_API_PORT`，默认 3100。 |
| `DATABASE_PATH` | `.local/lianban-data` | 常规 PGlite 数据位置；测试可用 `memory://`，不指向 PG18。 |
| `DEMO_MODE` | `true` | 注册 demo controller，并在 readiness 中产生 `DEMO_MODE_ACTIVE`；生产环境不得为 true。 |
| `PROFESSIONAL_RULES_APPROVED` | `false` | 计划发布和 onboarding 等专业规则路径继续阻断；readiness 为 `PROFESSIONAL_RULES_UNAPPROVED`。 |
| `AUTH_SECURITY_POLICY_APPROVED` | `false` | 认证生产路径继续阻断；readiness 为 `AUTH_SECURITY_POLICY_UNAPPROVED`。 |
| `PRIVACY_REVIEW_APPROVED` | `false` | 隐私门禁继续阻断；readiness 为 `PRIVACY_REVIEW_UNAPPROVED`。 |
| `DATA_RIGHTS_DRILL_COMPLETE` | `false` | 数据权利演练门禁未完成。 |
| `BACKUP_RESTORE_DRILL_COMPLETE` | `false` | 备份恢复演练门禁未完成。 |
| `OPERATIONS_READINESS_APPROVED` | `false` | 运维 readiness 未完成。 |
| `DEPLOYMENT_SECURITY_APPROVED` | `false` | 部署安全门禁未完成。 |

不得为让测试“绿”而编辑 `.env.example` 或把这些模板值改为 true。测试可显式构造 approved environment 来覆盖某个合同分支，那只证明测试分支，不能形成真人或发布批准。

## 7. 测试运行矩阵

所有命令均须先有场景授权；以下是命令和历史基线，不是现在已经执行的结果。

| 层级 | 命令 | 历史基线 / 判读 |
| --- | --- | --- |
| P11 local runtime | `npx --no-install vitest run apps/api/test/p11-local-operable-runtime.spec.ts --maxWorkers=1 --minWorkers=1` | `1 file / 5 tests passed`；需 loopback PG18 admin URL。 |
| P11 local launcher | `npx --no-install vitest run apps/api/test/p11-local-launcher.spec.ts --maxWorkers=1 --minWorkers=1` | `1 file / 7 tests passed`；不启动实际 PG18。 |
| P11 Web focused | 使用当前场景工程计划列出的 client/state/page/selector 精确文件列表运行 Vitest，不能只按旧 `43/43` 口头比对 | 历史 `4 files / 43 tests passed`，只属 `UI_STATE`。 |
| 类型 / 构建 | `npm run typecheck`；`npm run build` | 代码变更前的必要验证，按实际输出报告。 |
| production exclusion | `npm run test:production-bundle --workspace=@lianban/web` | 仅验证 local runtime 未进入 production bundle。 |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | 默认并行 `npm test` 曾因 Node/Vitest worker OOM 中止，不能作为有效全量结果。PG18 场景先私下配置管理员 URL；最终结果必须检查临时库是否归零。 |

### 九项 lifecycle 失败：精确复现与最小预审边界

授权只读预审后，用下列命令复现并保存实际失败名和堆栈；不要先改测试日期或时钟：

```powershell
npx --no-install vitest run apps/api/test/plan-lifecycle.e2e.spec.ts --maxWorkers=1 --minWorkers=1
```

当前历史结论是：此文件把 publication、deadline、effective window 固定在 2026-07/08，而没有注入 `planClock` 的用例使用 2026-09-05 数据库可信时间。八项在共享 publish setup 得到 409；一项 bypassed-current 读取两条已经过期的 ACTIVE 行，不再视为重叠。对应的九个历史失败用例是：

1. `returns a pure user-scoped pending summary without draft or review details`
2. `requires authorized plan reads and leaves scheduled plans unchanged when a client supplies at`
3. `rejects an entire published version when either user part is rejected`
4. `replays a terminal user confirmation without duplicate transition audit`
5. `makes cross-user and nonexistent user transitions indistinguishable`
6. `validates staff review rejection reason codes without changing USER rejection bodies`
7. `blocks a second pending version for the same user`
8. `does not promote a fully confirmed scheduled version from a client supplied time`
9. `fails current-plan reads closed when bypassed data contains multiple active versions`

建议的最小修复边界尚未获授权：仅在 `apps/api/test/plan-lifecycle.e2e.spec.ts` 的这九个 fixture 中将可信时间显式注入，或将 fixture 窗口迁移为相对/覆盖可信时间的可控事实，并新增断言证明有效窗口本身为真。预审必须先决定具体方式，且不得改变生产 `PlanLifecycleService` 规则、接受客户端时间、改变 P08/P09/P10 产品语义、修改迁移或把失败删掉/skip 掉。修复后需要重新跑该文件、全量单 worker、typecheck/build，并重新走独立审阅。

## 8. 测试账本与工程计划

不存在“整个仓库当前 `N active / M skipped`”的单一权威数字。计数是某份计划、某次 checkout、某个命令的历史结果，必须带来源和执行日期。

| 账本 / 计划 | 可引用的历史计数 | 正确使用方式 |
| --- | --- | --- |
| `docs/engineering/plans/2026-07-28-p11-api-pre-wiring-tdd.md` | `29 active / 0 skipped`；四文件 `52 passed / 0 skipped` | 只属于已关闭的 P11 API pre-wiring matrix，不能作为当前 P11 或全仓库计数。 |
| `docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md` | P11 named slices 各有 `1 passed / N skipped` 的演进记录，如 dual fictional `1 passed / 19 skipped` | 历史 named-test 证据；必须写明是哪一个 named test，不能将 skip 数加总为现状。 |
| `docs/engineering/plans/2026-08-31-p11-dual-fixture-evidence-orchestrator.md` | orchestrator `6 passed / 0 skipped` | 仅为 evidence-only manifest；缺失执行层仍是 `INCOMPLETE / G2_PREPARATION`。 |
| `docs/engineering/plans/2026-08-31-p11-dual-fixture-runtime-bridge.md` | real PG18 named test `1 passed` | 只覆盖 test-only API-to-PG18 bridge。 |
| `docs/engineering/plans/2026-09-05-p11-dual-fixture-local-operable-structure.md` | runtime `5/5`、Web `43/43`、launcher `7/7`、全量 `797/806` | 当前最后一个已收口场景和最后一次仓库全量历史记录。 |

新的场景必须在自己的工程计划里写一个显式 matrix：`ACTIVE`、`FROZEN/SKIPPED`、命令、期待 RED/direct GREEN、证据层和收口条件。没有该 matrix 时，不得说“所有 skipped 已冻结”或“计数不变”。

## 9. 已知陷阱与决策理由索引

- **基础设施失败不是行为 RED**：PG18 不可用、缺少管理员 URL、超时或 OOM 是基础设施阻断；先修复环境或缩小命令，不能当作业务 RED。
- **P11-04 日期夹具假阳性**：旧 seed 的 `now() +/- 1 day` 不覆盖固定 `record_task.business_date=2026-01-02`，会把日期窗口问题误写成 `RECORD_PLAN_NOT_ACTIVE`。参见 `docs/engineering/plans/2026-07-31-p11-get-record-context-test-only-prewiring-tdd.md` 的 `P11-04 fixture correction`。
- **2026-09-05 可信时间漂移**：lifecycle fixture 仍固定在 2026-07/08，而 database trusted time 为 2026-09-05；这正是九项仓库回归失败的当前根因，不是 P11 local-operable failure。
- **双库动机**：PGlite 服务于快速 API/lifecycle fixture；PG18 服务于隔离 migration/locking/idempotency/audit/cross-layer 证据。任何一层通过都不替代另一层。
- **P19 仅 Edge，不含 Chrome**：冻结 P19 范围是本地 loopback Edge + Narrator；Chrome 按当时用户指示排除，不是“Chrome 已通过”或“无需浏览器证据”。权威包：`docs/product/lianban-v1.0-p19-browser-accessibility-evidence-2026-08-24.md`。
- **Windows Ctrl+C**：outer npm/PowerShell exit 1 不是自动失败，也不是自动成功；看 launcher 错误码、API cleanup、端口和临时库。
- **历史独立审查 429**：`docs/product/lianban-v1.0-work-log.md` 记录过指定 Sol Critical 两次 429；它只表示审查未执行，不能改写为任何 clearance。
- **已知文档漂移**：`docs/engineering/STARTUP_DEPENDENCIES.md` 仍写“当前处于 G0”，与当前状态摘要/验收台账的“G0 通过、G1 仅本地安全结构、G2 未达、G3 禁止”冲突。该文件只能作旧工程依赖参考，不能作当前阶段门槛权威；接手模型首先报告该漂移，不要修改它来掩盖冲突。

## 10. 只读接管自检清单

第一轮只运行前两组。第三组仅在用户授权场景后执行，并把实际结果与历史基线分开记录。

```powershell
# A. Git 与当前快照
git status --short
git log -10 --date=iso-local --pretty=format:'%h`t%ad`t%s'
git diff --check
git diff -- docs/product/lianban-v1-current-status.md docs/product/lianban-v1.0-work-log.md

# B. 关键文件存在性与漂移定位
Test-Path AGENTS.md
Test-Path docs/product/lianban-v1-current-status.md
Test-Path docs/product/lianban-v1.0-acceptance-ledger.md
Test-Path docs/product/lianban-v1.0-work-log.md
Test-Path docs/engineering/plans/2026-09-05-p11-dual-fixture-local-operable-structure.md
Test-Path apps/api/test/plan-lifecycle.e2e.spec.ts
Test-Path packages/database/test/support/postgres-test-harness.ts
rg -n "P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE|65/66 files|797/806 tests|当前没有自动开启" docs/product
rg -n '当前处于 `G0`' docs/engineering/STARTUP_DEPENDENCIES.md

# C. 仅在授权场景后的 focused 比对示例
npx --no-install vitest run apps/api/test/p11-local-launcher.spec.ts --maxWorkers=1 --minWorkers=1
npm run typecheck
npm run build
```

若 A/B 的提交、dirty files、文件存在性、门槛或历史计数与本文不同，立即停止，报告差异和原始命令输出。若 C 的实际计数不同，也不得说“回归”；先判断是预期代码变更、基础设施问题、测试夹具漂移还是行为问题，再取得相应授权。

## 11. 接手后的第一句工作指令

在用户尚未给出新的 `SCENE` 授权时，接手模型应回答：

> 当前没有活动场景。我已完成只读接管并发现/未发现与交接快照的差异；下一步需要产品负责人按单场景授权格式决定是否仅做 `PLAN-LIFECYCLE-FIXED-DATE-REGRESSION-PREFLIGHT` 预审。

不得把这句话后的“下一步”理解为默认施工授权。
