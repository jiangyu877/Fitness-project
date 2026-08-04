# 练伴 V1.0 P11 Test-Only GET_RECORD_CONTEXT 预接线设计

版本：0.1  
日期：2026-07-31  
所有者：产品部  
状态：已完成；QA 与唯一指定 Sol Critical 复审通过  

## 1. 授权与目标

本设计仅授权 P11 下一阶段的一个 API 单场景：在 `test` 环境中，为
`GET /api/v1/record-tasks/{taskId}/context` 建立成功响应预接线。

目标是证明真实 Nest controller 能在可信 USER 会话、全局路由允许和
显式 test-only fake 注入条件下，将一个冻结的 context read 结果映射为
严格的 `RECORD_CONTEXT_AVAILABLE` HTTP 信封。

本切片不是数据库读取、生产依赖注册、UI runtime 接入、专业 schema、
真人成功路径、P11 总体验收、G2、G3 或 release 授权。

## 2. 部门职责

- 产品总包：冻结范围、验收口径、施工顺序和停止条件；不开发 API 代码。
- 研发部：唯一写入者，负责 API 测试、context read port/token、controller、
  test-only 注入和 OpenAPI 的最小实现。
- UI 部：本切片只读等待；后续另行设计 client、动态路由和页面编排。
- 质量与无障碍部：GREEN 后只读核对测试证据、范围和声明口径。
- 指定 Sol Critical 部门：聚焦验证后进行唯一正式只读审查。
- 专业审核、安全与隐私、运营与发布保障：本切片无新增对应决策，暂不介入；
  若出现专业语义、身份/隐私新决策或发布要求，立即停止并升级。

## 3. 冻结架构

### 3.1 独立读取边界

新增独立、纯 TypeScript 的 context read port 和注入 token。不得复用或扩展
现有 `P11RecordRepositoryPort`，因为后者属于已独立取证的写入 repository
边界。两者分离，避免把 controller fake 证据与 PostgreSQL 18 repository
证据混淆。

context read port 的输入只允许表达 controller 已获得的技术信息：

- bearer 凭证的不可逆派生表示；
- URL 中的 opaque `taskId`；
- 安全、非空的 `requestId`；
- 固定 `nodeEnv: "test"`。

输入不得接受客户端声明的 user ID、角色、日期、时区、计划状态、归属、
风险状态、provider 批准状态或 readiness 结论。

### 3.2 Test-only 双门

context fake 仅在应用环境和注入配置均明确为 `test` 时可用。非 test 环境
必须保持依赖为 `null` 并继续 fail closed，不得返回成功 context。

现有身份验证和全局 route/readiness 顺序不得降低。有效 session 不是资源归属
证明；本切片只验证注入 fake 的映射，不证明真实任务查询或本人归属。

### 3.3 冻结成功信封

成功响应只能使用当前工程合同已定义的七个顶层字段：

- `businessStatus: "RECORD_CONTEXT_AVAILABLE"`；
- `taskId`；
- `planVersion`；
- `businessDate`；
- `accessMode`；
- `schema`；
- `records`。

首个场景固定使用 `accessMode: "EDITABLE"`、`schema.testOnly: true`、一个
仅允许 `UPSERT_RECORD` 的虚构结构、空 `fields` 和空 `records`。所有标识和
版本均为不透明测试值。本设计不定义任何饮食、训练、疼痛、恢复、补录、
单位、次数、组次、强度、阈值、时限、专业文案或安全规则。

OpenAPI 必须与严格 UI parser 的机器边界一致：冻结对象层级和数组元素结构，
拒绝未声明属性；不得保留 `items: {}` 等开放成功结构。

## 4. 单场景 TDD

### RED

使用真实 Nest 应用发送：全局 `ALLOW`、可信 USER、有效 bearer、非空
`x-request-id` 和 opaque URL taskId，同时注入一个成功 context fake。

测试期望精确 `200 RECORD_CONTEXT_AVAILABLE` 信封及 fake 调用一次。当前
controller 在身份验证后固定返回 `404 RECORD_TASK_NOT_FOUND`，因此这应产生
可观察、原因正确的 RED。不得用路径错误、测试未发现或无关失败充当 RED。

本切片只新增这一个 context 成功业务场景。为证明新 port 不外溢，可在同一
任务中新增或扩展 test-only 注入的结构门禁断言；它不得形成第二种 HTTP
业务信封。session、role、route/readiness 和防枚举要求通过现有回归保持。

### 最小 GREEN

只接通 context fake 的输入映射和冻结成功信封。不得新增第二场景、错误码、
数据库 adapter、生产注册、UI client、页面或专业字段。

为避免把 URL taskId 当作已授权资源，测试应允许 fake 返回与请求值不同的
server-resolved opaque taskId，并断言响应采用 port 结果而非客户端推断。

## 5. 验收口径

GREEN 必须同时证明：

1. 响应精确匹配冻结成功信封，各层无额外字段；
2. context fake 恰好调用一次，写入 `upsert` port 不被调用；
3. fake 输入仅包含获准技术字段，不包含客户端权威声明；
4. 响应不回显 bearer、凭证派生值或 fake 内部敏感值；
5. test-only 注入结构断言证明非 test 环境不能注入 fake、不能返回成功
   context，且相关现有回归保持通过；
6. 现有 session、role、route/readiness 和防枚举拒绝路径保持不变；
7. 聚焦 API 测试、P11 API 回归、API typecheck 和 build 通过；
8. `git diff --check`、授权范围和暂存区检查通过，暂存区保持为空。

测试和评审报告必须明确：controller fake 只证明输入、输出、调用次数、脱敏和
test-only 门禁，不证明 PostgreSQL 查询、归属、防枚举、ACTIVE 计划、服务端
日期、accessMode、记录投影、锁、并发、幂等、审计原子性或生产行为。

## 6. 施工顺序

1. 产品书面设计获批；
2. 研发部编写单场景 TDD 实施计划；
3. 研发部作为唯一写入者观察真实 RED；
4. 研发部完成最小 GREEN 和聚焦验证；
5. 质量与无障碍部只读核对证据与范围；
6. 唯一指定 Sol Critical 部门完成正式只读审查；
7. 产品总包只同步本切片证据并停下，不自动开启 UI 或其他阶段。

## 7. 停止条件

出现以下任一情况立即停止并上报：

- 需要定义或推断任何专业字段、内容、阈值、单位、文案或安全规则；
- 需要连接 PostgreSQL、外部/生产数据库或新增生产依赖注册；
- 需要修改 UI、demo 路由、真人路径或部署配置；
- 需要改变现有身份、权限、隐私、route/readiness 或防枚举语义；
- RED 不是当前固定 404，或最小 GREEN 需要扩展到第二个行为场景；
- 发现当前合同、产品附件、代码或部门所有权存在无法消解的冲突；
- 无法证明非 test 环境零成功和零 fake 调用；
- 发现用户未提交改动可能被覆盖。

任何测试通过或审查通过均不改变 `readyForRealUsers=false`、G2 未达到、
G3 禁止，也不授权提交、推送、部署、真人数据或下一阶段。
