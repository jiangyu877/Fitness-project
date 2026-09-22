# P17 审计只读查询（场景计划）

- 场景：`P17-AUDIT-QUERY-READONLY`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 对话中批准（"继续下一步"，对应候选 2；生产接线候选 1 仍待单独授权）
- 基线：提交 `62989949`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: P17-AUDIT-QUERY-READONLY
OBJECTIVE: 以 test-only 只读查询契约冻结 P17 审计查询结构：严格过滤器、有界 limit、稳定排序、最小披露投影、零写入证明与 fail-closed 校验。
ALLOWED: 新增 apps/api/test/support/p17-audit-query.ts 与命名 PG18 测试、场景工程计划、工作日志/台账/状态摘要同步。
EXCLUDED: 生产 endpoint/路由/权限接线、迁移（含审计表不可覆盖触发器）、packages/** 改动、UI、审计脱敏文案规则、G2/G3/真人/release。
REQUIRED_EVIDENCE: 真实 RED（脚手架下正例失败）→ GREEN；focused PG18 命名测试；既有回归；typecheck/build；全量单 worker。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改生产代码/迁移/packages、需定义脱敏规则或权限模型、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计与预审发现

- **投影（最小披露）**：冻结字段 `{ id, actorId, actorRole, action, subjectType, subjectId, requestId, outcome, errorCode, occurredAt }`；刻意不投影 `before_version_id` / `after_version_id`（版本 id 投影留待安全/专业确认，不自行扩大披露）。
- **过滤器（冻结）**：`actorId`、`action`、`subjectType`、`subjectId`、`requestId`、`outcome('SUCCEEDED'|'REJECTED')`、`occurredFrom`（含）、`occurredTo`（不含，ISO 字符串）、`limit`（必填，整数 1..100）。精确键集合，未知键/类型/范围错误一律 `AUDIT_QUERY_INVALID`；全部参数化查询。
- **排序**：`occurred_at DESC, id ASC`（稳定）。
- **零写入**：仅 SELECT；命名测试以全表计数 + 内容摘要（md5 聚合）前后比对证明查询零写入。
- **预审发现（不改，记录为缺口）**：全库触发器清单中 `audit.audit_event` **没有任何不可覆盖（append-only）触发器**（仅 `recording.p11_write_gate_revision`、`recording.record_success_audit`、`planning.plan_version`、密码改密相关表有触发/约束）——即 P17"审计只读、脱敏、**不可覆盖**"中的表级强制尚缺；补强制需迁移，属后续独立授权切片。
- **不修改**：`packages/**`、迁移、生产路由、既有测试文件、UI。

## 3. RED 判定

- 新增 `apps/api/test/support/p17-audit-query.ts` 先以脚手架存在（查询恒返回空数组、不做过滤/校验）；
- 运行 focused：正例与校验断言必须失败（零写入断言应保持通过——脚手架无写入），记录原始输出为 RED。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED | `npx --no-install vitest run apps/api/test/p17-audit-query.postgres.e2e.spec.ts --maxWorkers=1 --minWorkers=1` | 正例/校验失败 | `PG18_REPOSITORY` | **已完成（2026-09-18）：脚手架下 `5 failed (5)`** |
| GREEN | 同上 | 全部通过 | `PG18_REPOSITORY` | **已完成：`5/5 passed`（约 2.6s）** |
| 回归 | plan-lifecycle + p10 + p12 fixture focused | 保持通过 | 混合 | **已完成：`3 files / 50 tests` 通过** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `71/71 files`（新增 1 文件），0 失败；临时库归零 | 混合 | **已完成：`71/71 files`、`835/835 tests`、`EXIT=0`，临时库 `lianban_%` = 0** |
| FROZEN | packages/**、迁移、生产路由、既有测试文件、UI | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

1. 组合过滤（actorId + outcome + 时间范围）只返回匹配行，且投影与冻结字段集合精确相等；
2. 排序与 limit：`occurred_at DESC, id ASC`；`limit=1` 返回最新；`limit=0/101/1.5/缺省` → `AUDIT_QUERY_INVALID`；
3. 逐项 fail-closed：未知键、未知 outcome、空字符串、非 ISO 时间、时间反序（From ≥ To 允许？——**冻结为允许**，仅校验格式与类型）；
4. 主体隔离：不同 actor 的事件互不串扰；
5. 零写入：多次查询前后全表计数与内容摘要完全一致。

## 6. 收口与停止

- 收口条件：命名测试全绿、既有回归保持、typecheck/build 通过、全量如实记录；同步工作日志、验收台账 P17 说明（含"未开始→施工中"状态变更与不可覆盖缺口）、状态摘要并提交。
- 停止条件：需改生产代码/迁移/packages、需定义脱敏规则或权限模型、需放开 G2/G3/真人、范围扩大或基础设施异常。
