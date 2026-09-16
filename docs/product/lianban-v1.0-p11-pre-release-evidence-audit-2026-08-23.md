# 练伴 V1.0 P11 预发布证据审计

日期：2026-08-23
所有者：产品部
状态：审计完成，P11 总体仍为施工中

## 1. 审计结论

P11 的本地 test-only 安全结构场景已形成分层证据：研发实现或 direct GREEN、QA 独立复现、安全/隐私与专业边界复核、UI/运营边界复核，以及指定 Sol Critical 收口。证据只覆盖虚构数据、loopback PostgreSQL 18、test-only API/UI contract fixture 和客户端状态消费。

这不等同于 P11 全部产品能力完成，也不构成生产、真人、G2、G3 或 release 批准。

## 2. 已收口本地场景

已收口的 P11 场景包括：

- P11-03：跨用户及不存在任务防枚举；
- P11-04：非 ACTIVE 计划版本；
- P11-05：客户端伪造 authority 字段；
- P11-06：同一完整意图精确重放；
- P11-07：同一 raw key 的 entry-value changed-intent；
- P11-08：既有记录并发更新；
- P11-08：无记录并发创建；
- P11-09：旧版本乱序请求；
- P11-10：schema 版本冲突；
- P11-11：关闭上下文只读；
- P11-12：关闭日期、关闭任务及风险阻断分支；
- P11-13：保存成功后的权威重读失败；
- P11-14：未知/畸形响应 fail closed；
- P11-15：消息已读与安全深链 test-only contract/UI state；
- P11-16：导出、删除/匿名化请求状态 test-only fixture/UI state。

每个条目的精确计数、文件范围和 Sol Critical 结论以 [验收台账](D:/project/Fittness%20project/docs/product/lianban-v1.0-acceptance-ledger.md) 和 [工作日志](D:/project/Fittness%20project/docs/product/lianban-v1.0-work-log.md) 为准。

## 3. 仍缺证据

以下项目不能由当前 test-only 证据替代：

- P11 双路线完整 API/E2E 闭环；
- 真实导出包、真实删除/匿名化、留存调度和数据权利三类演练；
- 字段级隐私留存映射、告知版本和安全事件冻结记录；
- P02 仍有页面业务深度与完整交互闭环缺口；Chrome 已按用户范围调整排除；
- 生产消息/数据权利 API、生产数据库、部署、监控、备份恢复和回滚；
- 真人数据、专业真人签字、G2/G3 和 release 门禁。

页面 `.tsx` 未被当前 Vitest include 规则收集的事实，不得表述为页面、浏览器或无障碍通过。

## 4. 当前门禁

- `readyForRealUsers=false`；
- G2 未达到；
- G3 禁止；
- `PRIVACY_REVIEW_UNAPPROVED`、`DATA_RIGHTS_DRILL_INCOMPLETE`、`BACKUP_RESTORE_DRILL_INCOMPLETE`、`OPERATIONS_READINESS_INCOMPLETE` 和 `DEPLOYMENT_SECURITY_UNAPPROVED` 仍未关闭；
- 不得连接生产/外部数据库、录入真人数据、部署、发布或声明 P11 总体通过。

P11-16 的隐私与运营负责人已分别提供版本化 test-only 批准：

- `P11-16-PRIVACY-TESTONLY-CONTRACT-v1`；
- `P11-16_DELETE_REQUEST_STATUS_OPERATIONS_REVIEW-v1-2026-08-23`。

这两份批准只允许虚构 fixture/UI 状态，不关闭真实隐私合规、数据权利演练、留存调度或真人门禁。

## 5. 证据边界

API fake 仅证明 controller 输入/输出映射。真实 PostgreSQL 锁、并发、幂等、审计和事务证据仅引用已完成的隔离 PG18 跨层测试；UI focused suite 仅证明 parser/client/state 和 test-only consumer，不能替代浏览器人工验收。共享工作树保持未提交状态，未执行 reset、revert、stage、commit 或 push。

## 6. 浏览器运行时预检（非 P19 收口）

本地 Web 服务器在 loopback `127.0.0.1:5174` 启动后，对 `/h5/today` 做了只读运行时预检：

- 360、390、430、1024、1280、1440 宽度均观察到 `scrollWidth == clientWidth`，未发现水平溢出；
- 390px 视口已取得运行截图；
- 键盘 Tab 可到达“打开消息中心”链接；
- 运行时样式包含 `:focus-visible` 和 `prefers-reduced-motion` 规则；
- `/h5/messages` 在未注入 message client 时显示 `MESSAGE_TEST_ONLY` 阻断态，不回退 demo 消息数据。

另一次本地浏览器 smoke 逐一打开 32 个冻结路由，32/32 页面均返回非空 DOM 内容并存在页面 H1；`/h5/messages` 返回 test-only 阻断 alert。该结果证明路由可达和运行时非空，不证明各页面业务闭环、键盘完整流程、浏览器兼容或无障碍通过。

以上是 2026-08-23 的历史 smoke/preflight 记录，不代表当前 P19 状态。后续第 7、8 节已补充六视口 Edge runtime、200% 等效视口、Edge + Narrator 人工确认和独立 QA 收口。

本轮 Edge 扩展运行时补充证据属于历史预检：Edge 本地 `127.0.0.1:5174` 在 390px 视口取得截图，键盘 Tab 聚焦到“打开消息中心”链接，DOM 状态与应用内浏览器 smoke 一致。Chrome 按用户范围排除；该历史预检不覆盖后来第 8 节的人工播报确认。

用户已明确本轮不使用 Chrome，P19 浏览器范围调整为 Edge + Narrator。该历史预检观察到语义 `main`、`heading`、`link`、`region`、`navigation`，Tab 可聚焦“打开消息中心”链接；`/h5/messages` 阻断页使用 `role="alert"`。这些结构证据随后由第 8 节人工确认和独立 QA 结论补全，不单独替代听觉播报证据。

## 10. P11 双路线 G2 预备包（2026-08-31）

本节对应 `P11-DUAL-FIXTURE-EVIDENCE-ORCHESTRATOR` 的产品预备包。它只目录化已收口的 test-only 证据，不新增运行时行为；完整报告最多为 `G2_PREPARATION`，缺失或未执行证据必须保持 `INCOMPLETE`。

| 证据层 | 当前来源与状态 | 已证明范围 | 未证明/限制 |
| --- | --- | --- | --- |
| `API_FAKE` | lifecycle named test 新鲜 `1 passed / 35 skipped`；其余 API fake 按各场景历史记录 | 两 persona 的认证、计划状态、任务候选/计划空档及 controller 映射边界 | 不证明 PG18 查询、持久化、锁、幂等、审计原子性或生产 API |
| `PG18_REPOSITORY` | `P11-DUAL-FIXTURE-RECORD-WRITE` 历史已收口；本编排器运行未重新连接 PG18 | 两 persona 记录写入、主体/task 绑定、business date、幂等和审计断言（以原 named slice 为准） | 不证明完整生命周期在同一事务链中运行，不证明生产数据库或 G2 |
| `CROSS_LAYER_E2E` | record-write 的 API→隔离 PG18 历史证据；消息/data-rights 为 test-only contract fixture | 已授权的跨层 record-write named slice | 不把 fixture contract 自动外推为统一生产 API/E2E 闭环 |
| `UI_STATE` | message/data-rights parser/client/state 历史 focused 证据；本场景无 UI 代码改动 | 状态消费、主体绑定、`CLEAR_ALL` 和 malformed fail closed | 不证明页面、浏览器、transport runtime 或真人行为 |
| `BROWSER` | P19 Edge/Narrator 独立历史包；本 P11 双 persona 编排器未执行 browser | P19 冻结页面的 Edge 视口、键盘、Narrator 人工确认 | 不证明双 persona 业务流程的浏览器运行闭环 |

当前预备包结论为 `INCOMPLETE / G2_PREPARATION`：生命周期基线已新鲜复核，record-write 已通过新的双 persona runtime bridge 和真实 PG18 复核；message/data-rights 仍是独立 test-only contract，browser/staging 统一链路仍未形成。该结论不打开 G2；`readyForRealUsers=false`、G2/G3、生产、真人、release 继续禁止。下一步只能由产品另行冻结一个补齐缺口的单场景。

## 11. 双路线运行时桥接收口（2026-08-31）

`P11-DUAL-FIXTURE-RUNTIME-BRIDGE` 已完成并收口：两套虚构 persona 通过共享 test-only identity/fixture context，分别经现有 record command route 写入隔离 PG18；record、幂等 key/intent digest/replay、审计 actor/subject/task/request/version/schema 和 goal mapping 均有断言。主控 fresh named test `1 passed`，API typecheck/build、diff-check 通过，临时数据库 `0`；QA、安全、专业、UI、运营及新 Sol Critical 均无阻断，Sol 结论为 `GREEN / ALLOW — P11_DUAL_FIXTURE_RUNTIME_BRIDGE_REVIEW_COMPLETE`。

该收口仅覆盖 `CROSS_LAYER_E2E + PG18_REPOSITORY` 的 test-only bridge，不证明 P11 全部双路线统一运行时、消息/P16 runtime、浏览器或 staging；P11 预备包继续为 `INCOMPLETE / G2_PREPARATION`。

## 7. P19 窄视口修复后独立 QA（2026-08-24）

本节更新并限定第 6 节的历史预检结论。UI 部按 TDD 修复了高缩放窄视口的全局宽度缺陷：移除 `body { min-width: 320px; }`，保留 H5 正式 360px 目标、112px 底部安全空间、44px 触控尺寸、`:focus-visible` 与 `prefers-reduced-motion`。新增 CSS contract 的 RED 在旧规则存在时失败，移除规则后的 GREEN 通过。

质量与无障碍部独立 QA 现场结论为 `QA_CLEAR`（仅限本地 P19 修复范围）：

- Web 全量 suite：34 spec / 342 passed / 0 failed；
- P19 styles contract：2 passed；Web typecheck、`git diff --check` 通过；暂存区为空；
- Edge 200% 等效窄视口：物理 390px 折算 `innerWidth=195`，`scrollWidth=187 <= clientWidth=187`；标题、两张任务卡和固定底部导航均未裁切或遮挡；滚动到底部后末尾内容与固定导航保持约 140.5px 安全间距；顶部与底部截图已采集；
- 本轮实际变更仅涉及 `apps/web/src/styles.css` 与可收集的 `apps/web/src/app/styles.spec.ts`，未修改 API、数据库或产品规则。

证据边界：以上证明本地 Edge 窄视口布局和静态回归；完整 P19 结论另由本节人工确认与独立 QA 复核收口。Chrome 按用户指示排除；该 `QA_CLEAR` 不外推为 P11 总体、真人、生产、G2/G3、release 或 `readyForRealUsers` 放行。

## 8. 六视口与辅助技术复核（2026-08-24 主控复核）

本节记录主控在 Edge 本地运行时对冻结页面矩阵的逐视口复核；它补充第 7 节的窄视口修复证据，但不替代 Narrator 人工听觉验收。

### 8.1 六视口路由结果

- 冻结页面矩阵共 32 个唯一路由：H5 19 个、Web 13 个。
- H5 在 CSS 360px、390px、430px：每个视口均为 `19/19` 路由非空 DOM、`19/19` 路由存在 `h1`，`overflow=[]`。
- Web 在 CSS 1024px、1280px、1440px：每个视口均为 `13/13` 路由非空 DOM、`13/13` 路由存在 `h1`，`overflow=[]`，`unsupported-width=0`。
- Edge 设备像素比为 2；Web 视口使用物理 2048/2560/2880 覆盖以得到 CSS 1024/1280/1440。此前物理 1024/1280/1440 覆盖实际只有 CSS 512/640/720，显示“当前宽度不支持”属于正确的低于 1024 CSS 宽度行为，不计入正式 Web 视口证据。

### 8.2 Edge 键盘、焦点、触控与减少动态

- Edge Tab 实测焦点顺序覆盖：消息入口、两张今日任务链接、今日/计划/记录/我的四个移动导航链接；每个可交互元素均出现 `:focus-visible`。
- H5 实测可交互元素的最小宽高为 44px；固定底部导航与任务内容无重叠。
- 页面语义运行时包含 `main`、标题、导航和链接；消息阻断态使用 `role="alert"`。
- `prefers-reduced-motion` CSS 规则存在，包含关闭平滑滚动、缩短 transition/animation 的规则；Edge 当前媒体查询为 `no-preference`，因此本轮没有把未切换系统设置时的 CSS 存在性表述为 reduced-motion 行为已人工通过。

### 8.3 Narrator 证据边界与人工复核

Windows 自动化接口没有暴露可读取的 Narrator 音频通道，因此 DOM 语义、焦点路径和 `role="alert"` 不单独作为听觉证据。2026-08-24 项目发起人确认已在 Edge + Narrator 下完成实时播报、人工键盘完整流程和无障碍确认；质量与无障碍部独立复核接受该人工确认作为本轮人工证据。Chrome 按用户范围排除。

本节结论：六视口 Edge 运行时、可见焦点、人工 Edge + Narrator 播报和人工键盘/无障碍确认均已形成并经独立 QA 复核，P19 结论为 `QA_CLEAR / P19_ACCESSIBILITY_REVIEW_COMPLETE`。`readyForRealUsers=false`、G2 未达到、G3/release 禁止保持不变。

质量与无障碍部随后独立确认：用户人工确认满足当前 P19 验收口径，整体结论为 `QA_CLEAR / P19_ACCESSIBILITY_REVIEW_COMPLETE`；该结论不外推 P11 总体、真人、G2/G3、release 或 `readyForRealUsers`。
