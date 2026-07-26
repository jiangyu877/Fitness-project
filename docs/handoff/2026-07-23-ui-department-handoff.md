# 练伴 V1.0 UI 部交接

快照日期：2026-07-23  
工作目录：`D:\project\Fittness project`  
Git 分支/提交：`codex/ui-ux-spec` / `cfcd032`  
部门边界：UI 部只负责 `apps/web/**` 与 `docs/ui/**`。

## 1. 项目目标

实现练伴 V1.0 的移动 H5 用户端与最小 Web 运营后台，优先完成 P0 双端关键闭环。页面由服务端稳定状态和允许动作驱动，覆盖减脂/增肌两条路线、正常/等待/阻断/冲突状态，并满足响应式和 WCAG 2.2 AA 目标。

## 2. 当前目录结构

```text
apps/web/
  src/app/                    应用壳、路由和通用 UI 状态
  src/features/auth-onboarding/  受邀登录与建档演示流程
  src/features/plan-demo/     计划确认与安全状态演示
  src/features/review/        饮食/训练审核演示
  src/features/phase3/        Phase 3 页面和状态模型
  src/mocks/                  32 页目录与双 persona mock
  src/api/                    demo/readiness 客户端与安全 fallback
  src/styles.css              设计 token、响应式和无障碍基础
docs/ui/specs/                UI/UX 权威实施附件
docs/ui/fixtures/             两套模拟用户及状态变体
docs/ui/plans/                前端 Phase 1/2 实施计划
```

## 3. 已完成的功能

- UI/UX 规格已到 v1.2：32 个唯一页面 ID，分组为 H5 P0/P1 `17/2`、Web P0/P1 `10/3`。
- 已建立两套完整演示 persona：减脂居家新手、增肌健身房新手，并保留统一演示警示和异常变体。
- 已完成 React/Vite 双端应用壳、全部 32 路由解析、H5 底部导航、Web 侧栏和通用状态组件。
- “今日”和“工作队列”已作为代表页面；其余初始页面具有可达状态壳。
- 已完成受邀登录/首次改密/授权/筛查/建档演示流程。
- 已完成待确认计划双确认、超时、空档、风险暂停，以及饮食/训练审核演示。
- 已完成 Phase 3 主要状态页面与 PRD 状态对齐。
- 当前仓库 `21` 个测试文件、`104/104` 通过，UI 类型检查和生产构建通过。

## 4. 正在开发的功能

- 多数冻结页面仍是状态壳或本地演示，尚未逐页成为完整业务交互。
- 身份/建档、计划和审核页面尚未完成跨模块真实 API 端到端联调。
- Phase 1 计划中的六个目标视口浏览器检查、键盘/焦点/播报、200% 缩放和无水平溢出验证尚未完成。
- UI 规格 v1.2 与 fixture 仍标注“待产品部最终复核”。

## 5. 关键技术栈

- React 19、React DOM 19、React Router 7
- TypeScript 5.9、Vite 7
- Vitest 3、Testing Library、jsdom
- Lucide React 图标、原生 CSS 设计 token
- 与 NestJS OpenAPI 契约对接；mock 与真实 API 使用同一状态语义

## 6. 重要文件说明

- `docs/ui/specs/2026-07-23-lianban-ui-ux-design.md`：页面、交互、断点、无障碍和验收标准。
- `docs/ui/fixtures/2026-07-23-demo-personas.md`：两套模拟用户和异常状态。
- `apps/web/src/mocks/page-catalog.ts`：32 页唯一目录和路由元数据。
- `apps/web/src/app/app.tsx`：H5/Web 入口与页面装配。
- `apps/web/src/features/auth-onboarding/auth-onboarding-pages.tsx`：身份建档演示。
- `apps/web/src/features/plan-demo/plan-demo-page.tsx`：计划确认、安全状态演示。
- `apps/web/src/features/review/review-detail-page.tsx`：专业审核演示。
- `apps/web/src/features/phase3/phase3-pages.tsx`：Phase 3 页面集合。
- `apps/web/src/api/demo-client.ts`：readiness/persona 读取和保守 fallback。

## 7. 已知问题

- 当前通过的组件/路由测试不等于 32 页完整业务验收，也没有覆盖全部真实 API、浏览器和视觉场景。
- 后端身份安全最终质量审查被本次交接中断；在契约稳定前不要假定真人身份流程可用。
- 演示内容未经专业审核，只能用于原型；真人环境不得出现 persona 切换器或 mock 内容。
- 专业字段、单位、安全文案和周调整规则仍受外部门禁阻断，UI 不得自行补值。

## 8. 下一步要做什么

1. 等产品部完成 UI v1.2/fixture 最终复核，按反馈只修规格差异。
2. 以 P0 为先，把状态壳逐页替换为完整表单和交互；优先身份建档，再计划主流程、每日记录、周反馈和风险处理。
3. 等研发部稳定对应 API 后，以 OpenAPI/稳定错误码联调，不在前端复制业务状态机。
4. 补齐 360/390/430px H5 和 1024/1280/1440px Web 浏览器截图、溢出和交互验证。
5. 完成键盘、焦点、错误播报、Narrator + Edge、200% 缩放和减少动态验收。

## 9. 不能改动/需要注意的约束

- 不修改 `apps/api/**`、`packages/**`、`docs/engineering/**` 或 `docs/product/**`。
- 页面必须由 `business_status`、`error_code`、`recoverable_actions`、`human_review_status`、`next_action` 等稳定结构驱动，不解析自由文本。
- 不按姓名或用户 ID 硬编码减脂/增肌路线；使用 `goalType`、计划版本和状态。
- 未审核内容必须持续展示“仅用于原型演示，未经专业审核”，并保持 `demoOnly/reviewStatus/publishable` 安全语义。
- 不在 UI 中实现权限、审核、发布、风险恢复或周调整判定；按钮可见性不能代替服务端授权。
- 不增加 PRD 排除的 AI、短信/微信、公开注册、支付、社交、媒体上传、设备、医疗或康复能力。

