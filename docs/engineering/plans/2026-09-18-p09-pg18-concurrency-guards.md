# P09 真实 PG18 并发守卫（场景计划）

- 场景：`P09-PG18-CONCURRENCY-GUARDS`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 对话中批准（"继续下一步"，对应候选 3；迁移与生产接线候选继续挂起）
- 基线：提交 `4e552a8a`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: P09-PG18-CONCURRENCY-GUARDS
OBJECTIVE: 以命名 PG18 测试补齐 P09"真实 PostgreSQL 压力并发"证据：在隔离 PG18 上以真实并发事务证明 single-ACTIVE / single-pending 唯一索引守卫、无脏读快照、已发布版本不可变触发器与 CST 截止时间约束。
ALLOWED: 新增 apps/api/test/support/isolated-postgres.ts（通用隔离助手）与 apps/api/test/p09-plan-concurrency.postgres.e2e.spec.ts、场景工程计划、工作日志/台账/状态摘要同步。
EXCLUDED: 生产代码与 packages/** 改动、迁移、既有测试文件与 support 改动、UI、队列/风险等新语义、G2/G3/真人/release。
REQUIRED_EVIDENCE: focused PG18 命名测试（允许 direct GREEN：既有约束已存在，无新行为，不伪造 RED）；既有回归；typecheck/build；全量单 worker。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改生产代码/迁移/packages、需新增产品语义、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计与依据

- **既有守卫（冻结事实，来自迁移）**：`uq_plan_version_pending_per_user`（UNIQUE (user_id) WHERE status IN ('PENDING_CONFIRMATION','SCHEDULED')，001）、`uq_plan_version_active_per_user`（UNIQUE (user_id) WHERE status='ACTIVE'，009）、`UNIQUE (plan_id, version_number)`（001）、`trg_plan_version_published_immutable`（002/009 不可变触发器）、`ck_plan_version_confirmation_deadline_cst`（002 CST 截止约束）、`ck_plan_version_publication_lead_time`（002）。
- **并发证据要求**：真实两连接事务（BEGIN/UPDATE 阻塞/COMMIT）+ 观察 `pg_stat_activity.wait_event_type='Lock'`；失败方必须为 `23505` 且携带对应唯一索引名；最终态必须唯一（恰好一条 ACTIVE / 一条 pending）。
- **快照一致性**：写事务未提交时并发读不得看到脏状态（MVCC），提交后才可见。
- **夹具（冻结）**：`p09-user-1`（v1-v4）、`p09-user-2`（v5 初始 ACTIVE）；窗口 `2026-01-01T00:00Z → 2026-01-08T00:00Z`；CST 截止 `2025-12-31T12:00:00Z`；`published_at = 2025-12-30T12:00:00Z`（= 截止 − 24h，边界允许）。
- **不修改**：生产代码、`packages/**`、迁移、既有测试/support、UI。

## 3. RED 判定

- 本切片复用既有数据库守卫、无新行为：允许 **direct GREEN**；首次聚焦运行若直接通过则如实记录，不伪造 RED。若失败，先判断夹具/基础设施与守卫缺失（缺失即为发现，按缺口记录，不改迁移）。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| focused 命名测试 | `npx --no-install vitest run apps/api/test/p09-plan-concurrency.postgres.e2e.spec.ts --maxWorkers=1 --minWorkers=1` | 全部通过（direct GREEN 允许） | `PG18_REPOSITORY` | **已完成（2026-09-18）：首次 `1 failed \| 4 passed` 为夹具缺陷（置 `ACTIVE` 未同时设 `published_at`，违反 `ck_plan_version_published_state_has_timestamp`），修正后 `5/5 passed`——direct GREEN，未伪造 RED** |
| 回归 | plan-lifecycle + p17 + p12 focused | 保持通过 | 混合 | **已完成：`3 files / 50 tests` 通过** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `72/72 files`（新增 1 文件），0 失败；临时库归零 | 混合 | **已完成：`72/72 files`、`840/840 tests`、`EXIT=0`，临时库 `lianban_%` = 0** |
| FROZEN | 生产代码、packages/**、迁移、既有测试/support、UI | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

1. 并发 ACTIVATE（同用户两版本）：观察真实锁等待后，一方提交成功、另一方 `23505` 且约束名为 `uq_plan_version_active_per_user`；最终恰好一条 ACTIVE；
2. 并发 PUBLISH（同用户两版本置 `PENDING_CONFIRMATION`）：一方成功、另一方 `23505` 且约束名为 `uq_plan_version_pending_per_user`；最终恰好一条 pending；
3. 快照一致性：写事务未提交时并发读仍见旧状态，提交后见新状态（无脏读）；
4. 已发布版本不可变：对 ACTIVE 版本改 `payload` 被触发器拒绝（消息 `published plan version is immutable`）；
5. CST 截止约束：写入错误 `confirmation_deadline_at` 被 `ck_plan_version_confirmation_deadline_cst` 拒绝（`23514`）。

## 6. 收口与停止

- 收口条件：命名测试全绿、既有回归保持、typecheck/build 通过、全量如实记录；同步工作日志、验收台账 P09 说明、状态摘要并提交。
- 停止条件：需改生产代码/迁移/packages、需新增产品语义、需放开 G2/G3/真人、范围扩大或基础设施异常。
