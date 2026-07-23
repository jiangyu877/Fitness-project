# 练伴 UI 第二阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入 phase-1 demo/readiness 稳定接口，并交付可演示的计划状态与 Web 审核详情切片。

**Architecture:** `apps/web` 通过小型 API 适配器校验稳定安全字段，网络或格式失败时回退本地虚构数据。计划状态转换保持在纯前端演示模型中，不模拟服务端授权、专业规则或真人发布。H5 与 Web 分别消费同一只读 demo 上下文，但保留独立页面状态。

**Tech Stack:** React 19、TypeScript 5.9、React Router、Vite 7、Vitest 3、Testing Library。

---

### Task 1: Demo API 适配器

**Files:**
- Create: `apps/web/src/api/demo-client.spec.ts`
- Create: `apps/web/src/api/demo-client.ts`
- Modify: `apps/web/vite.config.ts`

- [x] **Step 1:** 测试有效 readiness/persona 响应返回 `source: api`，并保留 `demoOnly=true`、`DEMO_UNREVIEWED`、`publishable=false`。
- [x] **Step 2:** 运行测试，确认因客户端模块不存在而失败。
- [x] **Step 3:** 实现响应校验与并行请求；任一网络或格式错误回退安全本地 mock，返回 `source: fallback`。
- [x] **Step 4:** 运行测试并确认 API、网络失败、无效安全字段三类用例通过。

### Task 2: 计划状态演示模型

**Files:**
- Create: `apps/web/src/features/plan-demo/plan-state.spec.ts`
- Create: `apps/web/src/features/plan-demo/plan-state.ts`

- [x] **Step 1:** 测试饮食和训练分别确认，单侧确认不生效，双确认仅进入等待生效。
- [x] **Step 2:** 测试确认超时禁用确认、旧计划到期进入空档、风险暂停只阻断关联任务。
- [x] **Step 3:** 运行测试并确认状态模型不存在导致失败。
- [x] **Step 4:** 实现纯函数转换和五个演示场景，运行测试通过。

### Task 3: H5 计划状态页面

**Files:**
- Create: `apps/web/src/features/plan-demo/plan-demo-page.spec.ts`
- Create: `apps/web/src/features/plan-demo/plan-demo-page.tsx`
- Modify: `apps/web/src/app/app.tsx`
- Modify: `apps/web/src/styles.css`

- [x] **Step 1:** 测试待确认页显示 API/fallback 状态、固定演示警示和两个独立确认按钮。
- [x] **Step 2:** 测试双确认进入等待生效，并能切换查看超时、空档与风险暂停状态。
- [x] **Step 3:** 运行测试确认组件不存在而失败。
- [x] **Step 4:** 实现 H5 交互页面并运行组件测试通过。

### Task 4: Web 审核队列详情

**Files:**
- Create: `apps/web/src/features/review/review-detail-page.spec.ts`
- Create: `apps/web/src/features/review/review-detail-page.tsx`
- Modify: `apps/web/src/app/app.tsx`
- Modify: `apps/web/src/styles.css`

- [x] **Step 1:** 测试饮食/训练审核页显示对象、版本、事实、审核职责和 demo 发布阻断。
- [x] **Step 2:** 测试批准/退回只改变本地演示结果，警示始终存在。
- [x] **Step 3:** 运行测试确认组件不存在而失败。
- [x] **Step 4:** 实现审核详情并运行测试通过。

### Task 5: 验证与提交

- [x] **Step 1:** 运行 UI 测试、根回归、类型检查和生产构建。UI 验证通过；根回归仅研发部未提交的 `apps/api/test/plan-lifecycle.e2e.spec.ts` 5 项失败。
- [x] **Step 2:** 启动 Web，浏览器验证 fallback、H5 双确认及 Web 审核详情。
- [x] **Step 3:** 仅暂存 `apps/web` 与本计划，确认不包含产品、后端、数据库或根配置。
- [x] **Step 4:** 提交一个可运行切片并报告 URL、证据和提交哈希。
