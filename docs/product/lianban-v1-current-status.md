# 练伴当前工作状态摘要

更新时间：2026-09-05<br>
用途：新任务的短上下文入口，不替代 PRD、验收台账或专项计划。

## 当前快照

- 工作目录：`D:\project\Fittness project`
- 分支：`codex/ui-ux-spec`
- 最新提交：`c657891 docs: refine token-efficient work rules`
- 工作树：有未提交的 P11/API/UI/文档改动；不得 reset、checkout、清理或盲目暂存。
- 当前产品状态：G0 通过；G1 仅允许本地演示和安全结构施工；G2 未达到；G3 禁止；`readyForRealUsers=false`。

## 最近证据

- P07 本地安全结构：联合回归曾记录 `30/30` 个测试文件、`347/347` 项通过，类型检查、构建、生产包和差异检查通过；正式专业规则、真实 PostgreSQL、真人环境和外部门禁仍未取得。
- P11 双路线记录写入：test-only `CROSS_LAYER_E2E + PG18_REPOSITORY` named test 曾记录 `1 passed / 19 skipped`，仅证明虚构 persona 的主体、任务、幂等和成功审计绑定。
- P11 消息状态：test-only `UI_STATE + API_FAKE` named test 曾记录 `1 passed / 1 skipped`，不证明生产消息持久化、真人深链或浏览器闭环。
- P11 数据权利状态：test-only API fixture `6 passed / 0 skipped`、reducer/UI `20 passed`、Web `28 files / 272 passed / 0 failed`；不证明真实导出、删除、匿名化、留存调度或隐私演练。
- P11 evidence orchestrator：曾记录 `6 passed / 0 skipped`，但本轮 PG18、browser 和运行时完整证据未执行，预备包结论保持 `INCOMPLETE / G2_PREPARATION`。
- P11 runtime bridge：工程计划记录真实 PG18 named test `1 passed`、API typecheck/build/diff-check 通过、临时库为 `0`，并有 Sol `GREEN / ALLOW`；证据仅限 test-only bridge。
- P11 本地可操作结构：test-only runtime、schema-driven P11 record client/page、双 fixture selector 与 loopback launcher已按命名切片收口；API runtime focused `5 passed`，Web focused `43 passed`，launcher lifecycle `7 passed`，API/Web typecheck/build 和 production-bundle exclusion 通过；本机 in-app browser 实际完成减脂与增肌各一次写入、权威重读及回看隔离，双路线截图留存在 `docs/engineering/evidence/`；最终只读边界为 QA `QA_CLEAR`、UI `UI_CLEAR`、本地运维 `LOCAL_SLICE_CLEAR`、安全 `SECURITY_NO_OBJECTION`、专业 `PROFESSIONAL_CLEAR`，新 Sol Critical 为 0/0/0 并结论 `GREEN / ALLOW — P11_DUAL_FIXTURE_LOCAL_OPERABLE_STRUCTURE_REVIEW_COMPLETE`。证据层仅为 `BROWSER`、`CROSS_LAYER_E2E`、`PG18_REPOSITORY`、`UI_STATE`；本场景 `BROWSER` 不代表 Edge/Narrator 或 P19 无障碍复验，生产运维仍为 `OPERATIONS_BLOCKED`。
- 当前隔离 PG18 全量单 worker 回归为 `65/66 files`、`797/806 tests`；9 项失败全部位于旧 `apps/api/test/plan-lifecycle.e2e.spec.ts`，其固定 2026-07/08 窗口与 2026-09-05 数据库可信时间冲突。较早的共享数据库中断运行曾需受控清理 1 个生成库；最终 port-5433 全量运行自动清理至 `lianban_%` 为 0。上述仓库级阻断不改写为通过，也不属于已收口的 P11 本地可操作切片。
- P19 浏览器与无障碍：验收台账标记通过，范围限 Edge、Narrator、键盘、六视口、200% 缩放和 reduced-motion 证据；不外推真人服务或 G2/G3。

## 当前活动边界

- 最近唯一活动场景 `P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE` 已按 test-only 边界收口并停止；当前没有自动开启的下一场景。
- 同日验收台账与工作日志已覆盖此前“其后没有新的场景授权”的旧交接表述；该文档差异已在本轮同步，不得据此开启第二个场景。
- 不得同时推进 P11 消息生产化、P16 真实数据权利、其他浏览器/部署/staging、生产、真人、G2 或 G3。

## 未关闭阻断

- P11 总体双路线业务闭环、正式记录 API/数据库接入、生产消息 API、真实数据权利处理和真人门禁未完成。
- P12 周反馈/周调整、P13 风险暂停/恢复、P14 真实工作队列、P17 审计查询、P20 运维恢复、P21 四周指标未完成。
- 专业规则、认证安全/MFA、隐私合规、数据权利演练、备份恢复、运营值班和部署安全证据未全部关闭。
- 当前工作树未形成新的稳定提交；任何旧测试数字都只能作为历史证据，不能替代当前复跑。
- 仓库全量回归仍有 9 项旧 plan-lifecycle 日期相关失败，当前场景不得据此宣称仓库全绿。

## 新任务最小读取集

1. `AGENTS.md`
2. 本文件
3. 验收台账中当前场景段落
4. 工作日志最后 10–15 行
5. 一个当前场景计划和一个当前场景测试文件

## 上下文预算和请求恢复

- 单次任务目标控制在约 `20k–40k` token；超过约 `60k–80k` 时保存增量状态并新开任务。
- 一个任务只做一个阶段：读取、修改、验证、汇报不得全部携带完整历史。
- 测试输出只传测试文件、通过/失败计数和失败名称；完整日志保存在本地，只有失败堆栈需要定向读取。
- `524` 先缩小上下文并拆分请求，不原样重试；`502` 在缩小请求后最多重试一次，重复失败记为请求链路阻断。
- 每次汇报只写：当前场景、已完成、本次证据、剩余阻断、下一步。
