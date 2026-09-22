# P17 审计表不可覆盖强制（迁移场景计划）

- 场景：`P17-AUDIT-APPEND-ONLY-ENFORCEMENT`
- 日期：2026-09-18
- 授权：产品负责人于 2026-09-18 对话中明确授权（"1"，即候选 1：审计表不可覆盖触发器迁移）
- 基线：提交 `6b452e9b`
- 写入者：ZCode（单场景唯一写入者）；`SELF_REVIEW_COMPLETE`（ZCode 自审 + 产品负责人验收）

## 1. 授权范围（冻结）

```text
SCENE: P17-AUDIT-APPEND-ONLY-ENFORCEMENT
OBJECTIVE: 为 audit.audit_event 增加表级不可覆盖强制（BEFORE UPDATE OR DELETE 触发器，镜像既有 append-only 模式），并在 PGlite 迁移套件与隔离 PG18 上证明 UPDATE/DELETE 被拒、INSERT 仍允许、原行不变。
ALLOWED: 新增 packages/database/migrations/012_audit_append_only.sql；packages/database/src/migrate.ts 追加注册项；packages/database/test/migration.spec.ts 与 apps/api/test/p17-audit-query.postgres.e2e.spec.ts 各追加一条用例（不改动既有用例与辅助函数）；场景计划与工作日志/台账/状态摘要同步。
EXCLUDED: 其他表与其他 schema 变更、生产代码与路由、UI、既有用例语义、专业内容、G2/G3/真人/release。
REQUIRED_EVIDENCE: 真实 RED（两条新用例在无迁移时失败：UPDATE/DELETE 当前可成功）→ GREEN；两条 focused 通过；既有迁移套件与 P17 用例保持；typecheck/build；全量单 worker。
INDEPENDENT_REVIEWS: 无独立线程时 `SELF_REVIEW_COMPLETE`。
STOP: 需改动其他表/其他 schema、需生产代码或 UI、需放开 G2/G3/真人、范围扩大。
```

## 2. 冻结设计与依据

- **模式镜像（既有冻结事实）**：`recording.record_success_audit` 与 `recording.p11_write_gate_revision` 均为 `BEFORE UPDATE OR DELETE ... FOR EACH ROW` + `RAISE EXCEPTION '<table> is append-only'`（migration 011）。本切片对 `audit.audit_event` 采用同一形状。
- **迁移注册**：`packages/database/src/migrate.ts` 的 `migrations` 常量数组为唯一注册点，`applyMigrations` 应用到末项版本 → 追加 `012_audit_append_only` 即生效；不修改既有迁移文件（历史迁移不可改写）。
- **INSERT 不受影响**：触发器仅覆盖 UPDATE/DELETE；审计追加路径（各业务写入）不变。
- **预审发现闭环**：本切片闭合 2026-09-18 P17 预审记录的缺口（`audit.audit_event` 无任何不可覆盖触发器）。
- **不修改**：既有迁移文件、其他表、生产代码、UI、既有用例语义与辅助函数。

## 3. RED 判定

- 先在 `migration.spec.ts` 与 `p17-audit-query.postgres.e2e.spec.ts` 各追加一条不可覆盖用例；
- 运行两条 focused：**必须真实失败**（当前 `audit.audit_event` 可被 UPDATE/DELETE），记录原始输出为 RED；
- 再新增迁移与注册项 → GREEN。

## 4. 验证 matrix

| 层级 | 命令 | 预期 | 证据层 | 状态 |
| --- | --- | --- | --- | --- |
| RED（迁移套件） | `npx --no-install vitest run packages/database/test/migration.spec.ts --maxWorkers=1 --minWorkers=1` | 新用例失败（无触发器） | `PG18_REPOSITORY`（PGlite 迁移套件） | **已完成（2026-09-18）：`2 failed \| 19 passed`，失败原因 `promise resolved ... instead of rejecting`（UPDATE 当前可成功）** |
| RED（PG18） | `npx --no-install vitest run apps/api/test/p17-audit-query.postgres.e2e.spec.ts --maxWorkers=1 --minWorkers=1` | 新用例失败 | `PG18_REPOSITORY` | **已完成：同一真实 RED 原因** |
| GREEN | 同上两条 | 全部通过 | 混合 | **已完成：`21/21 passed`（P17 六项含新用例 + 迁移套件 15 项）；同迭代内两处机械修正如实记录：① 新增迁移需先 `npm run build` 重建 dist 才对 API 侧规格生效；② `postgres-test-harness.spec.ts` 已发布迁移清单同步追加 012** |
| 回归 | plan-lifecycle + p09 + p10 focused | 保持通过 | 混合 | **已完成：`3 files / 47 tests` 通过** |
| 类型/构建 | `npm run typecheck`；`npm run build` | 通过 | — | **已完成：两项 `EXIT=0`** |
| 全量回归 | `npm test -- --maxWorkers=1 --minWorkers=1` | `72/72 files`，0 失败；临时库归零 | 混合 | **已完成：`72/72 files`、`842/842 tests`、`EXIT=0`，临时库 `lianban_%` = 0** |
| FROZEN | 既有迁移文件、其他表、生产代码、UI、既有用例 | 不修改 | — | 冻结 |

## 5. 命名测试（冻结）

1. `migration.spec.ts` 追加：`makes the audit event table append-only`——应用全部迁移后 INSERT 允许、UPDATE/DELETE 被拒（消息 `audit_event is append-only`）、原行不变；
2. `p17-audit-query.postgres.e2e.spec.ts` 追加：在隔离 PG18 上同样证明 INSERT 允许（计数 +1）、UPDATE/DELETE 被拒、原行不变。

## 6. 收口与停止

- 收口条件：两条 focused 全绿、既有迁移套件与相关回归保持、typecheck/build 通过、全量如实记录；同步工作日志、验收台账 P17 说明（缺口闭环）、状态摘要并提交。
- 停止条件：需改动其他表/其他 schema、需生产代码或 UI、需放开 G2/G3/真人、范围扩大或基础设施异常。
