# G2 本地闭环接线预审（M1 第一步：范围与边界冻结）

- 场景：`G2-LOCAL-LOOP-WIRING-PREFLIGHT`（只读预审，未修改任何代码）
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 确认启动 G2 大目标（"确定开始"），按其要求先冻结门禁语义范围与边界
- 基线：提交 `4e7facd7`
- 执行：ZCode（只读调查 + 边界核对）

## 1. 预审发现：记录路径的 test-only 门禁是**四层强制**，且本地演示当前被整体阻断

| 层级 | 位置 | 强制内容 |
| --- | --- | --- |
| 1 应用注入 | `apps/api/src/app.module.ts:42-47` | `recordRepository` / `recordContext` / 测试快照仅在 `nodeEnv === 'test'` 注入，其余环境为 `null` |
| 2 控制器 | `apps/api/src/records/record-safe-structure.controller.ts:185, 254, 400` | 路由在 `nodeEnv !== 'test'` 时统一 `endpointUnavailable`；`405/419` 要求 schema 必须 `testOnly && !approvedForRealUsers` |
| 3 契约 | `apps/api/src/records/p11-record-schema.provider.ts:28`；controller `:109` | `validRecordSchema` 拒绝 `testOnly=false` 的 schema；OpenAPI 将 `testOnly` 枚举钉死为 `[true]` |
| 4 数据库 | `packages/database/migrations/011_p11_record_persistence.sql:12-47` | 门禁行约束 `node_env='TEST'`、`test_only=true`、`approved_for_real_users=false`；HMAC 密钥为虚构测试材料 |

**额外发现（路由脊柱）**：`apps/api/src/readiness/route-access.ts:32-37` 规定受保护路由仅在两种情况下放行——(TEST 受众 且 `nodeEnv==='test'`) 或 (REAL_USER 受众 且**阻断码为零**)；而 `demoMode=true` 本身就是一个阻断码（`:42` `DEMO_MODE_ACTIVE`）。**因此当前本地演示模式（`nodeEnv=development` + `DEMO_MODE=true`）无法服务任何受保护路由**——这是刻意设计的安全脊柱，不是缺陷。

**本地运行时现状**：`apps/api/test/support/p11-local-operable-runtime.ts:38` 以 `nodeEnv: 'test'` + `audience:'TEST'` 零阻断快照启动真实 HTTP API + 真实 PG18 + 真实 UI（`scripts/p11-local-operable-runtime.ts`），当前仅覆盖 P11 记录路径（双 persona 写入/权威重读）。

## 2. 选项分析

| 选项 | 内容 | 代价/风险 | 能否达成 G2 |
| --- | --- | --- | --- |
| **A 本地运行时扩展（推荐）** | 不放松任何门禁；把现有本地运行时扩展到全闭环：M1 接入 P10 任务生成、M2 新增 P12 周反馈/周调整 test-only API + H5 页 + Web 视图、M3 双 persona 全链路浏览器 E2E | 低（沿用既有 test-only 模式，无迁移、无生产放松） | 可产出"本地双端联调"证据（层标注：test-gated 运行时）；是否判定为 G2 达成由产品负责人裁量 |
| **B 记录路径生产化** | 放松四层门禁 + 迁移门禁行约束 + 改 schema 契约与 OpenAPI，使 `nodeEnv=development` 的本地应用可写记录 | **高**：拆解项目刻意建立的安全脊柱；真实用户仍不可用（G3 外部门禁不变），收益仅为"非 test 环境的本地闭环" | 形式上是"真实 API 闭环"，但以放松安全门禁为代价，且不改变 G3 处境 |
| **C 混合（建议）** | 现在执行 A；B 留作 G3 外部门禁接近关闭时的独立授权程序（届时才具备真实用户意义） | 低 | A 的产出 + 明确记录 B 为后续程序 |

## 3. 建议

**采用 C**：以 A 推进（零门禁放松、零迁移），把"四周闭环本地可运行"作为当前阶段的可交付物；把"记录/任务/周反馈的生产化放松"明确列为**在 G3 外部门禁接近关闭前不做**的独立程序（届时需单独授权并单独冻结范围）。

## 4. 重定义后的 M1-M3（待授权）

| 阶段 | 内容 | 验收要点 |
| --- | --- | --- |
| M1 | 本地运行时接入 P10 任务生成：ACTIVE 窗口内生成结构任务，今日任务读取返回真实任务，既有反例保持 | 运行时内真实 HTTP 读取 + PG18 任务行；浏览器可见今日任务 |
| M2 | P12 周反馈/周调整 test-only API 契约 + H5 周反馈页接入 + Web 周调整视图 | 提交反馈 → 调整版本 → 双审核/双确认/生效在本地闭环可走通 |
| M3 | 双 persona 全链路浏览器 E2E（登录 → 建档 → 计划确认 → 今日任务 → 记录 → 周反馈 → 周调整 → 生效）+ 分层证据 + G2 判定 | `BROWSER + CROSS_LAYER_E2E + PG18_REPOSITORY + UI_STATE` 分层；G2 判定由产品负责人裁量 |

**明确不含**：四层门禁放松、门禁行迁移、schema 契约与 OpenAPI 改动、专业内容与量表、P15/P16 生产化、G3 外部门禁、staging/生产/真人/release。

## 5. 证据与边界

- 本预审为只读（grep/读取），未运行测试、未修改文件；
- 所有发现均带 `file:line` 证据；
- 选项 A 的产出证据仍为 **test-gated 本地运行时**，不得外推生产、真人、G2 自动达成或 release。
