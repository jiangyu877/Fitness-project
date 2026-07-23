# 练伴封闭测试 MVP 技术契约差异与机器可读化建议

状态：研发建议，不修改现有契约
日期：2026-07-23
所有者：研发部

## 1. 所有权处理

现有契约位于 `docs/superpowers/specs/2026-07-22-closed-beta-api-contract.md`。该文件正文称由研发部维护，但产品计划同时声明 `docs/superpowers/specs/` 由产品部维护，所有权存在冲突。因此本轮不编辑原文件，只记录差异和后续迁移建议。

建议产品部确认后，将机器可读契约放在 `docs/engineering/contracts/openapi/`，研发部维护技术结构；产品部维护状态含义与验收，UI 部消费生成类型和 mock。

## 2. 当前可继承内容

- `/api/v1`、UUID、UTC、游标分页、`requestId`；
- 用户/员工会话域隔离和角色化权限；
- `expectedVersion`、`Idempotency-Key`、结构化错误；
- demo 内容发布阻断；
- 计划不可变版本、双审核、双确认和到期生效；
- 风险暂停、追加式审计、outbox 所需事件语义；
- 两套目标 fixture、状态矩阵和契约/E2E 要求。

## 3. 开工前必须修正的契约缺口

| 缺口 | 影响 | 建议 |
| --- | --- | --- |
| 文档标记“已生效”，同时保留关键待确认项 | 实现者可能把未冻结规则当事实 | 增加 `businessBaselineVersion` 和逐项依赖状态 |
| `PlanStatus`、`ReviewDecision` 等引用类型未完整定义 | 无法生成代码或校验 mock | 在 components/schemas 中穷举并链接产品状态表 |
| 多个响应只写自然语言摘要 | 前后端会各自猜字段 | 为每个 P0 路由定义 request/response schema 和样例 |
| 状态码、业务状态、页面语义混在一起 | 错误恢复不稳定 | 分离 HTTP、`error.code`、`businessStatus`、`recoverableActions` |
| 权限写成角色文本 | 无法验证对象级和字段级权限 | 定义 permission code、resource scope、field visibility 和 allowed actions |
| 状态转换缺少前置条件/副作用 | 并发和 outbox 行为不明确 | 每个 command 定义 from/to、guard、事件和幂等作用域 |
| 周调整是否复用完整计划流程未显式 | 版本模型可能分叉 | 等产品决定后统一为同一 plan version 或独立聚合 |
| 数据导出/删除仍依赖未批留存规则 | 可能产生不可逆错误 | 保留请求 API，冻结执行动作直到矩阵获批 |
| 会话、Cookie、CSRF/CORS 未机器化 | 联调和安全测试无基线 | 在 securitySchemes 和部署 profile 中定义 |
| 事件、时间和单位约束不完整 | 跨日生效和数值解释存在差异 | 定义时区、日期、质量/能量/重量单位及精度 |

## 4. OpenAPI 组织建议

```text
docs/engineering/contracts/openapi/
  openapi.yaml
  paths/
    auth.yaml
    me.yaml
    staff.yaml
  schemas/
    common.yaml
    identity.yaml
    onboarding.yaml
    risk.yaml
    plan.yaml
    execution.yaml
    adjustment.yaml
    errors.yaml
  examples/
    fat-loss/
    muscle-gain/
    errors/
```

在业务冻结前不创建这些文件，避免把建议误认为正式接口。

## 5. 契约元数据

机器可读契约应包含：

- `info.version`：技术契约版本；
- `x-business-baseline-version`：产品基线版本和提交哈希；
- `x-ui-spec-version`：UI 规格版本和提交哈希；
- `x-professional-rules-version`：专业规则版本，未批准时禁止生成真人发布能力；
- `x-data-retention-version`：留存矩阵版本；
- 每个操作的 `operationId`、权限码、幂等要求、乐观锁要求和审计动作；
- 枚举值的稳定代码、用户可见含义和是否终态；
- 成功、可重试、不可重试、无权限、版本冲突和风险阻断样例。

## 6. 生成与验证流水线

建议流水线：OpenAPI lint -> breaking-change 检查 -> 前端 TypeScript 类型生成 -> mock schema 校验 -> 后端响应契约测试 -> E2E 样例复用。

任何状态删除、字段必填化、权限扩大、错误码重定义均视为破坏性变更，必须提升主版本或提供兼容期。产品状态变化先更新产品基线，再由研发映射到契约，禁止直接在 OpenAPI 中创造业务状态。

## 7. 仍需产品决定

- v2.0 的正式版本和效力顺序；
- 完整计划/周调整的统一或独立状态模型；
- 状态边界、确认期限、旧计划到期和多待确认版本规则；
- 角色组合、双审核人员分离和风险恢复权限；
- 专业筛查、风险、调整和内容复审规则版本；
- 数据留存、导出、删除、审计与备份例外。
