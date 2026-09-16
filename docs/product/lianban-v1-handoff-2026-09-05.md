# 练伴 V1.0 交接备份（2026-09-05）

用途：供当前或后续任务读取的短交接记录。本文不替代 PRD、当前状态摘要、验收台账或专项工程计划。

## 当前停点

- 权威目录：`D:\project\Fittness project`。
- 工作树存在用户未提交的 P11/API/UI/文档改动；禁止 reset、checkout、revert、清理、盲目暂存、提交或推送。
- 最近唯一活动场景 `P11-DUAL-FIXTURE-LOCAL-OPERABLE-STRUCTURE` 已完成并停止；QA `QA_CLEAR`、UI `UI_CLEAR`、本地运维 `LOCAL_SLICE_CLEAR`、安全 `SECURITY_NO_OBJECTION`、专业 `PROFESSIONAL_CLEAR`，新 Sol Critical 0/0/0 并结论 `GREEN / ALLOW — P11_DUAL_FIXTURE_LOCAL_OPERABLE_STRUCTURE_REVIEW_COMPLETE`。生产运维仍为 `OPERATIONS_BLOCKED`，当前没有自动开启的下一场景。
- 当前新鲜证据：runtime `5/5`、Web client/state/page/selector `43/43`、launcher lifecycle `7/7`；API/Web typecheck/build、生产包排除和 diff-check 通过；1280 x 720 本机浏览器完成双 fixture 各一次写入和权威重读，回看减脂未出现增肌值，双路线截图已留存在 `docs/engineering/evidence/`；生成数据库清理后为 `0`。Windows PTY 的外层 npm/PowerShell 对 Ctrl+C 返回 1，但未输出 launcher 错误，API/Web 端口和临时库均完成清理，不把该包装层退出码写成命令成功。
- 默认并行 `npm test` 因 Node/Vitest worker OOM 中止；最终在隔离 PG18 port 5433 上的单 worker 回归完整执行为 `65/66 files`、`797/806 tests`，9 项失败全部来自旧 `plan-lifecycle` 固定日期窗口与 2026-09-05 可信时间冲突。较早中断运行的 1 个残留生成库已受控删除，最终全量运行自动清理至 `lianban_%` 为 0。
- 其前置 `P11-DUAL-FIXTURE-EVIDENCE-ORCHESTRATOR` 已完成五层 evidence manifest/report 与 fail-closed 校验；其结果只形成 `G2_PREPARATION` 目录。
- 当前总体状态：`INCOMPLETE / G2_PREPARATION`；G2 未达到，G3、release、真人数据和 `readyForRealUsers=true` 禁止。

## 已有证据边界

- `API_FAKE` 只证明 controller 输入/输出映射。
- `PG18_REPOSITORY` 只引用已执行的本地隔离 PostgreSQL 18 证据。
- `CROSS_LAYER_E2E` 只覆盖已授权的 test-only API 到隔离 PG18 bridge。
- `UI_STATE` 只证明 parser/client/state 合同消费；`BROWSER` 表示实际浏览器交互。只有 P19 专项证据可声明 Edge/Narrator、键盘或无障碍覆盖；当前 P11 本地场景使用 Codex in-app browser，不外推 P19。
- 不能把任一层推导为生产、staging、真人、G2、G3、消息生产化或真实数据权利处理。

## 当前未关闭项

- 已有一条本机 test-only API -> UI -> Browser 双 persona 可操作结构链路，但没有 staging、生产、真人或专业语义证据。
- P15 生产消息 API、P16 真实导出/删除/匿名化/留存调度和数据权利演练未完成。
- 专业规则、认证安全/MFA、隐私合规、备份恢复、运营值班、部署安全等 G3 门禁未全部关闭。
- 本次暂停期间不得自动开启新的场景；任何继续施工须重新建立单一活动场景和产品授权。

## 已知项目对话职责（最近交接快照）

| 对话标识 | 部门/职责 |
| --- | --- |
| `019fb206-82ca-7531-a03e-555fc0094c1b` | 产品总协调与授权 |
| `019fb206-82d2-7400-af7f-21b26211392f` | 研发/API/数据库工程 |
| `019fb208-1a50-7783-8405-7c146454ede2` | QA 与无障碍 |
| `019fb208-1a50-7783-8405-7bf0a8e1d652` | 安全与隐私 |
| `019fb208-2512-7d90-a820-4c3679abfeb5` | 专业审核 |
| `019fb206-82d2-7400-af7f-2190069a569d` | UI |
| `019fb208-2512-7d90-a820-4c1d09b94d36` | 运营与发布保障 |
| `01a057da-a598-77b0-b55a-d6bf3e3c1846` | 新 Sol Critical 独立复审 |
| `01a0343a-9c1c-7db2-ba3d-ff9d33e9a673` | 历史 Sol Critical record-write 复审；本轮不自动重启 |

用户本轮指定的 9 个 URI 中，`019fb208-2512-7d90-a820-4c3679abfeb5` 重复出现一次，按一个专业审核对话处理。当前 Codex 应用线程服务返回 `This app tool is no longer available through dynamic tools`，因此这些 URI 的实际发送/新建未声称成功；本文件是本次暂停交接的本地备份。

## 新对话首条读取要求

新对话的首条任务必须按以下顺序读取，禁止加载完整历史：

1. `AGENTS.md`
2. `docs/product/lianban-v1-current-status.md`
3. `docs/product/lianban-v1.0-acceptance-ledger.md` 当前场景段落
4. `docs/product/lianban-v1.0-work-log.md` 最后 10 行

读取后只确认一个活动场景、已完成证据、剩余阻断和下一授权条件；未获得新的产品授权前保持暂停。
