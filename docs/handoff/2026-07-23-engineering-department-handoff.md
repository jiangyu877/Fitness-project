# 练伴 V1.0 研发部交接

快照日期：2026-07-23  
工作目录：`D:\project\Fittness project`  
Git 分支/提交：`codex/ui-ux-spec` / `cfcd032`  
部门边界：研发部负责 `apps/api/**`、`packages/**` 与 `docs/engineering/**`。

## 1. 项目目标

按唯一 PRD 建立可测试、可审计、默认 fail-closed 的 V1.0 后端、数据库、鉴权和 API，支撑受邀身份建档、计划双审核/双确认/生效、每日记录、周调整和风险暂停。未经批准的专业内容与未关闭门禁绝不能进入真人服务。

## 2. 当前目录结构

```text
apps/api/src/
  config/       环境校验
  database/     数据库生命周期
  demo/         受保护的双 persona 元数据
  identity/     邀请、登录、改密、授权、建档、筛查结构
  plans/        计划生命周期 HTTP 服务
  readiness/    真人服务门禁状态
apps/api/test/  API/OpenAPI/身份/计划 E2E
packages/domain/    身份、计划、审计和发布门禁纯领域逻辑
packages/database/  PGlite/Postgres 兼容迁移、runner、计划仓储
docs/engineering/   ADR、稳定契约、实施计划、测试矩阵
```

## 3. 已完成的功能

- npm workspace、Node 24/npm 11 基线、NestJS API、Zod 环境校验、OpenAPI/Swagger。
- 健康检查、八类 readiness 阻断、demo 路由隔离及两套不可发布 persona 元数据。
- 计划领域状态机、双审核、双确认、拒绝、超时、等待生效、当前/历史/空档 HTTP API。
- PGlite/Postgres 兼容迁移 `001`-`007`，计划仓储具备乐观并发、幂等和原子审计；HTTP 计划服务尚未切换到该持久化 adapter。
- 身份/建档 API：邀请、首次改密、用户/员工登录、授权/撤回、账号状态、分步建档、受资格约束的筛查结论。
- 身份安全提交：`a8162ed`、`4df03d6`、`cfcd032`。已实现员工 bearer、服务端 MFA verifier、session active role、角色撤销即时失权、秘密安全指纹、令牌不持久化/不回放、作用域幂等、账号状态保护和结构化拒绝审计。
- 本快照重新验证：`21` 个测试文件、`104/104` 通过；`npm run typecheck`、`npm run build`、`git diff --check` 均通过，工作树在生成交接文件前干净。

## 4. 正在开发的功能

- 身份安全规格复核已通过，但最终独立代码质量/安全审查在等待结果时被本次“暂存任务”中断；该批次尚未正式关闭。
- 下一已确定研发批次是跨 identity/onboarding/plans 的生产真人路由统一 fail-closed guard，目前尚未开始。
- 当前 `main` 注入空认证策略并保持 503/fail-closed；这不是可部署的生产认证方案。

## 5. 关键技术栈

- Node.js >=24、npm workspaces、TypeScript 5.9
- NestJS 11、Express adapter、Zod 4、OpenAPI/Swagger
- PGlite 0.3 / Postgres 兼容 SQL，追加式迁移
- Vitest 3、Supertest
- scrypt 密码哈希、随机 session token + SHA-256 摘要、服务端 MFA verifier 接口

## 6. 重要文件说明

- `docs/product/lianban-v1.0-prd.md`：唯一产品权威，研发不得改写规则。
- `docs/engineering/contracts/phase-1-stable-contract.md`：当前 HTTP、状态、错误、安全和持久化保证。
- `docs/engineering/plans/2026-07-23-identity-security-hardening.md`：身份安全任务、已完成检查和剩余生产门禁。
- `apps/api/src/application.ts` / `app.module.ts` / `main.ts`：应用组合、依赖注入和默认 fail-closed 入口。
- `apps/api/src/identity/identity-onboarding.service.ts`：当前身份授权、幂等、审计和建档事务主实现。
- `apps/api/src/plans/plan-lifecycle.service.ts`：计划生命周期 HTTP 应用服务，当前使用注入式内存仓储。
- `packages/database/migrations/001_core.sql` 至 `007_identity_audit_outcomes.sql`：已发布追加迁移，不得原地改写。
- `packages/database/src/plan-repository.ts`：持久化计划仓储 adapter。
- `apps/api/test/identity-security-hardening.e2e.spec.ts`：身份安全 22 项回归测试。

## 7. 已知问题

- 不是真人服务就绪：专业、安全策略、隐私、数据权利、备份恢复、运维、部署和发布证据均未全部关闭。
- 缺少生产 MFA verifier、受治理的认证参数审批、初始管理员安全播种和密码恢复方案。
- 缺少跨模块真人路由统一门禁；身份安全最终独立质量审查未完成。
- 计划 HTTP 服务仍使用内存仓储，尚未与持久化 adapter 在授权和事务边界下集成。
- 每日任务、饮食三态、训练逐组/补录、周反馈、完整周调整、风险工单、消息、数据权利和审计查询等 API 仍未实现。
- 产品验收台账 P05/P06 仍是旧状态，不能以其“未开始”或测试通过单独判断最终完成。

## 8. 下一步要做什么

1. 恢复同等级独立审查者，对 `a8162ed..cfcd032` 做最终代码质量与安全审查。
2. 将所有 Critical/Important 问题交给单一研发实现者，按 TDD 修复；同一审查者复核至通过。
3. 主线程重新运行 `npm test`、`npm run typecheck`、`npm run build`、`git diff --check`、空库迁移 `001`-`007` 和数据库敏感值断言，再关闭身份批次。
4. 单独设计并实现 production real-user route guard，覆盖 identity/onboarding/plans，未知/缺失门禁一律 fail closed。
5. 之后按 PRD P0 顺序推进：今日任务 -> 饮食三态 -> 训练逐组/补录 -> 周反馈/新版本调整 -> 风险暂停与恢复 API。

## 9. 不能改动/需要注意的约束

- 不修改 `apps/web/**`、`docs/ui/**` 或 `docs/product/**`；产品规则冲突必须交产品部决定。
- 不原地修改迁移 `001`-`007`；结构变化新增顺序迁移并做空库/升级验证。
- 不编造筛查题、风险阈值、营养/训练数值、安全文案、SLA 或周调整算法。
- demo/mock、reviewed、published 必须严格隔离；未知状态、未知阻断码或依赖缺失必须 fail closed。
- actor、active role、MFA 结果和权限只能由服务端可信状态派生；不得信任客户端 header/boolean。
- 原始密码、MFA challenge、session token 或其他秘密不得进入日志、审计、指纹、幂等结果或数据库明文。
- 稳定错误继续使用结构字段，不以自由文本代替 `business_status`、`error_code`、`recoverable_actions`、`human_review_status`、`next_action` 和版本信息。
- 测试通过只证明当前切片，不代表真人封测、生产部署或 V1.0 完成。
