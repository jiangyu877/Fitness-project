# 练伴封闭测试 MVP 前后端技术契约

版本：1.0
日期：2026-07-23
状态：已生效
负责人：研发部（后端契约）/ UI 部（前端消费）

> 效力说明：本文以 `docs/product/lianban-v1.0-prd.md` 为唯一产品业务输入，并以已获批准的 UI 规格作为前端交互输入。此前草案中与本版本冲突的登录、AI、发布和生效状态全部作废。

## 1. 边界与所有权

产品部只负责产品经理工作并维护：

- `docs/superpowers/specs/` 中的产品规格与接口需求
- `docs/superpowers/plans/` 中的产品推进计划

UI 部拥有移动 H5、Web 运营后台、前端路由、页面状态、组件、视觉资源和前端实现。研发团队拥有后端、数据库、鉴权、API、自动化测试与部署实现。产品部不创建或修改任何前后端代码、数据库迁移、测试或部署文件。

共同事实源为 `D:\project\Fittness project\docs\`。V1.0 PRD 定义业务规则，本文定义首轮前后端可直接实现和联调的技术契约。UI 独立维护视觉与交互规格；研发部维护 API、鉴权、数据库、审计、测试与部署。

首轮明确排除 AI、短信、微信登录/绑定、支付、公开注册、媒体上传和生产环境模拟身份切换。原型中的减脂/增肌场景切换器不得调用生产 API。

## 2. 通用协议

- Base URL：`/api/v1`
- Content-Type：`application/json`
- ID：UUID 字符串
- 时间：ISO 8601 UTC，例如 `2026-07-22T10:30:00.000Z`
- 展示时区由 UI 转换为 `Asia/Shanghai`
- 分页：`cursor`、`limit`，默认 20，最大 100
- 写请求头：`Idempotency-Key`；资源更新同时提交 `expectedVersion`
- 请求追踪：响应头和响应体均返回 `requestId`
- 状态展示：业务对象返回稳定 `statusCode` 和 `statusSemantic`；语义限定为 `RISK | WARNING | IN_PROGRESS | SUCCESS | NEUTRAL`，不得要求 UI 仅凭颜色推断状态
- 响应完整性：API 不按视口宽度裁剪业务字段；H5 360–430px 和后台最低 1024px 的信息优先级由 UI 控制，后台待办核心字段必须始终返回
- 列表稳定性：动态列表项和训练组次必须返回不可变 `id` 与显式 `sortOrder`；相同业务版本内不得因刷新改变顺序
- 写操作：所有创建/提交类请求必须接受 `Idempotency-Key`；所有可变实体更新必须提交 `expectedVersion`，重复请求不得产生重复记录或重复事件

核心资源的可观察页面状态统一映射为 `LOADING | EMPTY | READY | BLOCKED | SUBMITTING | SUCCEEDED | RETRYABLE_ERROR | TERMINAL_ERROR`。`LOADING` 和 `SUBMITTING` 是客户端状态，其余状态必须能由响应数据或稳定错误码确定，不能依赖自由文本或颜色。

成功响应：

```json
{
  "data": {},
  "meta": { "requestId": "uuid", "serverTime": "2026-07-22T10:30:00.000Z" }
}
```

列表响应：

```json
{
  "data": [],
  "meta": { "requestId": "uuid", "nextCursor": null, "serverTime": "2026-07-22T10:30:00.000Z" }
}
```

错误响应：

```json
{
  "error": {
    "code": "PLAN_NOT_PUBLISHABLE",
    "message": "当前计划尚未满足发布条件",
    "fieldErrors": [],
    "details": { "blockingStates": ["DIET_REVIEW_PENDING"] },
    "businessStatus": "REVIEW_IN_PROGRESS",
    "recoverableActions": ["VIEW_TIMELINE"],
    "humanReviewStatus": "PENDING",
    "retryable": false
  },
  "meta": { "requestId": "uuid", "serverTime": "2026-07-22T10:30:00.000Z" }
}
```

`fieldErrors` 的固定结构为：

```ts
type FieldError = {
  fieldPath: string;
  code: string;
  message: string;
  rejectedValue?: unknown;
};
```

`VERSION_CONFLICT` 的 `details` 必须返回 `expectedVersion`、`currentVersion`、`conflictingFieldPaths` 和调用者有权读取的 `latestResource`。客户端必须让用户确认后重试，不得自动覆盖。

## 3. 身份与角色

身份域严格分开：`USER` 与 `STAFF` 不共用登录入口或会话权限。

| 角色 | 主要权限 |
| --- | --- |
| `USER` | 读取本人资料/计划，提交本人记录、反馈、确认和数据请求 |
| `OPERATIONS` | 创建/重置/停用测试账号，查看受邀用户与待办，整理计划草案和处理非专业运营流程 |
| `NUTRITION_REVIEWER` | 审核饮食计划，不得审核训练计划或管理账号 |
| `TRAINING_REVIEWER` | 审核训练计划，不得审核饮食计划或管理账号 |
| `ADMIN` | 员工、角色、批次和系统配置管理，不替代专业审核 |
| `AUDITOR` | 只读审计与授权数据，不得修改用户、计划或内容 |

用户与员工均使用受邀账号和密码，但登录入口、会话 Cookie 与权限域严格分离。用户首次登录必须修改初始密码后才能进入知情说明；忘记密码由运营人工核验并重置。未授权返回 `401 AUTH_REQUIRED`；身份存在但权限不足返回 `403 PERMISSION_DENIED`。

## 4. 核心领域对象

所有可变业务对象包含：

```ts
type EntityMeta = {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
```

### UserSummary

```ts
type UserSummary = EntityMeta & {
  status: UserStatus;
  goalType: "FAT_LOSS" | "MUSCLE_GAIN" | null;
  displayName: string;
  currentPlanId: string | null;
  blockingReasonCodes: string[];
};
```

### PlanSummary

```ts
type PlanSummary = EntityMeta & {
  userId: string;
  goalType: "FAT_LOSS" | "MUSCLE_GAIN";
  planVersionId: string;
  revision: number;
  status: PlanStatus;
  effectiveFrom: string;
  effectiveTo: string;
  dietReview: ReviewDecision;
  trainingReview: ReviewDecision;
  dietUserConfirmation: UserDecision;
  trainingUserConfirmation: UserDecision;
  supersedesPlanVersionId: string | null;
  publishedAt: string | null;
  effectiveAt: string | null;
};
```

### PlanPreparationTimeline

```ts
type PlanPreparationTimeline = {
  status: "SUBMITTED" | "OPERATIONS_PREPARATION" | "PROFESSIONAL_REVIEW" | "READY_TO_PUBLISH" | "PUBLISHED_PENDING_CONFIRMATION" | "BLOCKED";
  estimatedCompletionAt: string | null;
  stages: Array<{
    code: "SUBMITTED" | "OPERATIONS_PREPARATION" | "PROFESSIONAL_REVIEW" | "PUBLISHED";
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED";
    occurredAt: string | null;
  }>;
  supplementalRequirements: Array<{ code: string; label: string; required: boolean }>;
  blockingReasonCodes: string[];
  latestPublicationEventId: string | null;
};
```

计划准备接口不得返回草案、审核中内容或半成品计划。`supplementalRequirements` 和 `blockingReasonCodes` 必须使用稳定代码，展示文案由 UI 映射或服务端安全文案字段提供。

### RiskEvent

```ts
type RiskEvent = EntityMeta & {
  userId: string;
  priority: "HIGH";
  status: "UNASSIGNED" | "IN_PROGRESS" | "WAITING_FOR_USER" | "RESOLVED";
  source: "SCREENING" | "PROFILE_CONFLICT" | "PAIN" | "RECOVERY" | "OTHER";
  relatedTaskType: "ONBOARDING" | "DIET" | "TRAINING" | "WEEKLY_REVIEW";
  safeUserMessage: string;
  assigneeId: string | null;
  dueAt: string;
};
```

### ContentReference

```ts
type ContentReference = EntityMeta & {
  contentType: "DIET_ITEM" | "MEAL_TEMPLATE" | "EXERCISE" | "TRAINING_TEMPLATE" | "ADJUSTMENT_EXAMPLE";
  reviewStatus: "DEMO_UNREVIEWED" | "REVIEW_PENDING" | "APPROVED" | "RETIRED";
  demoOnly: boolean;
  professionalReviewerId: string | null;
  reviewedAt: string | null;
  sourceVersion: string | null;
};
```

问题 27 已确认选择 A：高保真原型使用真实感模拟数据，并醒目标注“仅用于原型演示，未经专业审核”。所有模拟内容均为 `reviewStatus: "DEMO_UNREVIEWED"` 且 `demoOnly: true`。真人计划发布事务必须校验其全部内容引用为 `APPROVED`、`demoOnly: false`，否则拒绝发布；不得依赖 UI 隐藏或提示来保证该约束。

审计对象额外包含 `actorType`、`actorId`、`subjectType`、`subjectId`、`action`、`requestId`、`occurredAt`、`beforeVersionId`、`afterVersionId`；审计记录只追加，不更新或删除。

### DailyRecord 与 Message

```ts
type DietExecutionState = "ON_PLAN" | "PARTIALLY_DEVIATED" | "SIGNIFICANTLY_DEVIATED";

type DailyRecord = EntityMeta & {
  userId: string;
  date: string;
  diet: {
    state: DietExecutionState | null;
    deviationReasonCodes: string[];
    note: string | null;
  };
  training: {
    entryMode: "LIVE_SETS" | "POST_WORKOUT_SUMMARY" | null;
    status: "COMPLETED" | "PARTIALLY_COMPLETED" | "NOT_COMPLETED" | null;
    setRecords: Array<{ id: string; exerciseId: string; setIndex: number; sortOrder: number; weight: number | null; reps: number | null; rpe: number | null }>;
  };
  recovery: { energy: "LOW" | "MEDIUM" | "HIGH" | null; painReported: boolean };
};

type Message = EntityMeta & {
  category: "PLAN" | "RISK" | "SUPPLEMENT_REQUIRED" | "WEEKLY_FEEDBACK" | "SYSTEM";
  title: string;
  body: string;
  readAt: string | null;
  taskDeepLink: { routeName: string; resourceType: string; resourceId: string } | null;
};
```

饮食只有选择偏离状态后才接受原因和补充说明。训练的实时逐组与事后补录写入同一 `DailyRecord` 结构，由 `entryMode` 区分。疼痛记录必须在同一事务中创建风险事件并暂停关联训练任务，不能只保存为普通备注。

## 5. 状态机

用户状态：

```text
INVITED -> INITIAL_PASSWORD_CHANGE_REQUIRED -> CONSENT_REQUIRED -> SCREENING_IN_REVIEW
SCREENING_IN_REVIEW -> PROFILE_INCOMPLETE | EXCLUDED | RISK_REVIEW_REQUIRED
PROFILE_INCOMPLETE -> PLAN_PREPARATION
PLAN_PREPARATION -> PLAN_CONFIRMATION_REQUIRED
PLAN_CONFIRMATION_REQUIRED -> PLAN_EFFECTIVE_SCHEDULED | PLAN_REVISION_IN_PROGRESS
PLAN_EFFECTIVE_SCHEDULED -> ACTIVE（到达 effectiveAt）
ACTIVE -> RISK_PAUSED | TEST_CLOSED
RISK_PAUSED -> ACTIVE | TEST_CLOSED
```

计划状态：

```text
DRAFT -> DIET_REVIEW_PENDING + TRAINING_REVIEW_PENDING
review pending -> READY_TO_PUBLISH（仅两类专业审核均 APPROVED）
READY_TO_PUBLISH -> PUBLISHED_PENDING_CONFIRMATION（发布后用户首次可见）
PUBLISHED_PENDING_CONFIRMATION -> EFFECTIVE_SCHEDULED（饮食与训练均由用户 ACCEPTED）
EFFECTIVE_SCHEDULED -> ACTIVE（到达 effectiveAt）
任一专业审核 REJECTED -> STAFF_REVISION_REQUIRED（用户不可见）
任一用户确认 REJECTED -> USER_REJECTED_REVISION_REQUIRED（不得生效）
ACTIVE -> SUPERSEDED（通过新版本替代，不原地修改）
```

`PUBLISHED_PENDING_CONFIRMATION` 及之后的版本不可原地修改。同一用户同一日期只能有一个 `ACTIVE` 计划。新版本被用户拒绝时，既有 `ACTIVE` 版本继续执行；初始版本被拒绝且无旧版本时，不产生执行任务。风险事件会暂停关联任务，但不由系统给出诊断。数据不足时只允许保持计划或降低执行阻力，不允许收紧能量目标、增加训练量或提高强度。

## 6. API 路由

问题 29 已确认选择 A。首轮范围按“双端关键闭环”排序：

- `P0 H5`：登录/会话、授权、筛查、建档、当前计划、饮食与训练分别确认、每日记录、周反馈、风险暂停状态；
- `P0 Web`：工作队列、用户复核、风险事件、饮食审核、训练审核、计划发布、新版本周调整；
- `P1 必要支撑`：审计查询、数据请求与测试关闭流程保留 API 能力，但非核心后台首轮不要求完整交互；
- `OUT 首轮不做`：内容管理、员工管理、运营指标等非核心后台的完整交互。

研发团队应先评估并实现 P0 接口；UI 部先消费 P0 mock。P1 不得阻塞双端关键闭环的原型验收，但在真人封闭测试开始前仍须满足对应安全、审计和数据权利门槛。

### 鉴权与本人数据

| 方法 | 路由 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/auth/user/login` | `{ account, password }` | `{ user, session, passwordChangeRequired }` |
| POST | `/auth/user/change-initial-password` | `{ currentPassword, newPassword }` | `{ changed: true, nextStep: "CONSENT" }` |
| POST | `/auth/staff/login` | `{ account, password }` | `{ staff, session }` |
| POST | `/auth/logout` | `{}` | `{ loggedOut: true }` |
| GET | `/auth/session` | - | `{ identity, permissions, expiresAt }` |
| GET | `/auth/draft-recovery` | - | `{ recoverableDrafts: [{ resourceType, resourceId, version, updatedAt }] }`；重新登录后用于恢复服务端草稿 |
| GET | `/me` | - | `UserSummary` |
| GET | `/me/onboarding` | - | `{ status, requiredFields, screening, profile }` |
| GET | `/me/plan-preparation` | - | `PlanPreparationTimeline`，不包含计划内容 |
| PUT | `/me/consent` | `{ consentVersion, accepted, expectedVersion }` | `{ consent, userStatus }` |
| PUT | `/me/screening` | `{ answers, expectedVersion }` | `{ screening, userStatus }` |
| PATCH | `/me/profile/steps/{stepCode}` | `{ fields, expectedVersion }` | `{ profile, completedSteps, nextStep, userStatus }`；每步独立保存 |
| GET | `/me/plans/pending-confirmation` | - | `{ plan, diet, training, confirmationStatus }` 或 `null` |
| GET | `/me/plans/current` | - | 仅返回 `ACTIVE` 计划；无生效计划时为 `null` |
| GET | `/me/plans/history` | - | 只读历史版本摘要 |
| POST | `/me/plans/{id}/confirm-diet` | `{ decision, reasonCode?, note?, expectedVersion }` | `PlanSummary` |
| POST | `/me/plans/{id}/confirm-training` | `{ decision, reasonCode?, note?, expectedVersion }` | `PlanSummary` |
| GET | `/me/daily-records?from=&to=` | - | `DailyRecord[]` |
| PUT | `/me/daily-records/{date}` | `{ diet, training, recovery, expectedVersion? }` | `DailyRecord` |
| POST | `/me/training-sessions/{sessionId}/sets` | `{ exerciseId, setIndex, weight?, reps?, rpe?, expectedVersion }` | 实时保存单组并返回训练会话摘要 |
| PUT | `/me/training-sessions/{sessionId}/summary` | `{ status, exercises, expectedVersion? }` | 事后简化补录训练结果 |
| POST | `/me/pain-reports` | `{ taskId, exerciseId?, locationCode, severity, note? }` | `{ report, riskEvent, pausedTaskIds }` |
| GET | `/me/weekly-feedback/current` | - | `WeeklyFeedback` |
| PUT | `/me/weekly-feedback/current` | `{ answers, expectedVersion? }` | `WeeklyFeedback` |
| GET | `/me/messages` | `cursor, limit, unreadOnly?` | 站内消息列表与 `nextCursor` |
| GET | `/me/messages/unread-count` | - | `{ count }` |
| POST | `/me/messages/{id}/read` | `{}` | `{ readAt }` |
| POST | `/me/data-requests` | `{ type: "EXPORT" | "DELETE", reason? }` | `DataRequest` |

### 员工后台

工作台默认排序固定为：风险等级降序、逾期优先、业务优先级降序、截止时间升序、任务 ID 升序。游标必须包含完整排序键，保证翻页期间顺序稳定。

每个待办项必须始终返回 `id`、`taskType`、`statusCode`、`statusSemantic`、`priority`、`assignee`、`dueAt`、`isOverdue`、`riskFlags`、用户摘要和 `allowedActions`。后端不得依据客户端视口省略这些核心字段。

| 方法 | 路由 | 权限 | 响应/动作 |
| --- | --- | --- | --- |
| GET | `/staff/work-queue` | staff | 支持 `taskType,status,priority,assigneeId,dueBefore,cursor,limit`；返回风险/逾期标识和可执行动作 |
| GET | `/staff/users` | operations/reviewer/admin/auditor | 分页用户摘要 |
| GET | `/staff/users/{id}` | 按字段脱敏授权 | `{ blockers, profile, screening, goal, trends, currentPlan, planHistory, fieldVisibility }` |
| GET | `/staff/risk-events` | operations/reviewer/admin/auditor | 风险事件列表 |
| POST | `/staff/risk-events/{id}/acknowledge` | operations/reviewer | 确认接单并写审计 |
| POST | `/staff/risk-events/{id}/wait-for-user` | assignee | 进入等待用户补充，必须提供结构化补充资料代码 |
| POST | `/staff/risk-events/{id}/resolve` | reviewer | 关闭事件并写结论，不提供诊断字段 |
| POST | `/staff/users/{id}/plans` | operations | 创建计划草稿 |
| GET | `/staff/plans/{id}` | relevant staff/auditor | 计划完整版本与审核历史 |
| POST | `/staff/plans/{id}/submit-review` | operations | 同时进入两类独立审核队列 |
| POST | `/staff/plans/{id}/diet-review` | nutrition reviewer | `APPROVED` 或 `REJECTED` |
| POST | `/staff/plans/{id}/training-review` | training reviewer | `APPROVED` 或 `REJECTED` |
| POST | `/staff/plans/{id}/publish` | operations | 双专业审核通过后发布为 `PUBLISHED_PENDING_CONFIRMATION`；不得等待用户确认 |
| POST | `/staff/plans/{id}/revisions` | operations | 基于历史计划创建新版本 |
| GET | `/staff/plans/{id}/workspace` | relevant staff/auditor | 返回版本、审核轨迹和按角色计算的 `allowedActions` |
| GET | `/staff/users/{id}/plan-preparation` | relevant staff/auditor | 计划准备时间线、补充资料要求与阻断原因 |
| POST | `/staff/users/{id}/supplemental-requirements` | operations/reviewer | 创建结构化补充资料要求并触发站内消息 |
| GET | `/staff/test-accounts` | operations/admin | 最小测试账号列表 |
| POST | `/staff/test-accounts` | operations/admin | 创建受邀账号并生成一次性初始密码 |
| POST | `/staff/test-accounts/{id}/reset-password` | operations/admin | 人工核验后重置初始密码 |
| POST | `/staff/test-accounts/{id}/unlock` | operations/admin | 解除登录锁定 |
| POST | `/staff/test-accounts/{id}/disable` | operations/admin | 停用测试账号并失效会话 |
| GET | `/staff/audit-events` | auditor/admin | 只读分页审计查询 |
| GET | `/staff/data-requests` | operations/admin/auditor | 数据请求列表 |
| POST | `/staff/data-requests/{id}/complete` | admin | 完成导出或经演练批准的删除/匿名化 |

路由请求体的专业模板字段、筛查问题、风险判定规则及具体热量/组次数值，均等待 v2.0 和 G1 专业签字确认；当前只使用 mock 字段和虚构内容。

共享用户详情采用服务端字段级授权。`fieldVisibility` 返回已展示和已脱敏的字段代码；客户端不得通过隐藏组件替代权限控制。运营可编辑后台草案，但不能提交专业审核结论；营养审核者只能处理饮食部分；训练审核者只能处理训练部分。管理员不能代替专业审核者通过计划。

计划工作区的所有修改请求都必须提交 `expectedVersion`。已发布、待生效、生效和历史版本只读；修改必须通过 `/revisions` 创建新版本。版本不匹配返回 `409 VERSION_CONFLICT` 并附当前版本号，服务端不得自动合并或静默覆盖。

## 7. 稳定错误码

| HTTP | code | UI 行为 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 定位字段错误，不清空已填内容 |
| 401 | `AUTH_REQUIRED` | 转到对应用户或员工登录入口 |
| 401 | `SESSION_EXPIRED` | 返回 `draftRecoverySupported`；客户端保留本地未提交输入，重新登录后与服务端草稿版本核对 |
| 403 | `PERMISSION_DENIED` | 展示无权限，不隐藏审计 requestId |
| 409 | `VERSION_CONFLICT` | 返回最新版本、冲突字段和可读取的最新资源；禁止静默覆盖 |
| 409 | `STATE_TRANSITION_NOT_ALLOWED` | 刷新当前状态和可执行动作 |
| 409 | `PLAN_NOT_PUBLISHABLE` | 返回具体 `blockers[]`，每项包含稳定代码、关联对象和可恢复动作 |
| 409 | `PLAN_NOT_CONFIRMABLE` | 刷新待确认计划和可执行确认项 |
| 409 | `PLAN_NOT_EFFECTIVE` | 今日页不得生成该版本任务 |
| 409 | `EFFECTIVE_DATE_CONFLICT` | 提示当日已有生效计划 |
| 409 | `UNAPPROVED_CONTENT_REFERENCED` | 阻止真人计划发布并列出未审核内容 ID |
| 422 | `PROFILE_INCOMPLETE` | 展示 `missingFields` |
| 422 | `SCREENING_REVIEW_REQUIRED` | 进入等待人工复核状态 |
| 422 | `SCREENING_EXCLUDED` | 阻断建档和计划流程，展示安全说明与人工联系入口 |
| 422 | `RISK_REVIEW_REQUIRED` | 停止关联任务并显示安全文案 |
| 422 | `PERSISTENT_RECOVERY_REVIEW_REQUIRED` | 暂停自动加量并进入人工复核 |
| 422 | `DATA_CONFLICT_REQUIRES_CONFIRMATION` | 返回冲突字段代码和重新确认动作 |
| 422 | `INSUFFICIENT_DATA_FOR_ADJUSTMENT` | 保持当前计划，不显示加码动作 |
| 429 | `RATE_LIMITED` | 按 `retryAfterSeconds` 稍后重试 |
| 500 | `PLAN_CALCULATION_FAILED` | 响应不含计划内容或残片，并原子创建后台异常待办，返回其追踪编号 |
| 500 | `INTERNAL_ERROR` | 通用错误，不显示半成品计划 |

关键业务错误必须同时返回 `businessStatus`、`recoverableActions`、`humanReviewStatus` 和稳定的原因代码。自由文本只能作为用户安全说明或补充描述，不能决定页面分支。

消息的 `taskDeepLink` 只能指向当前用户有权限访问且仍存在的资源。客户端打开深链前按 `routeName` 路由，服务端仍须重新鉴权；失效资源返回稳定的 `RESOURCE_NO_LONGER_AVAILABLE`，不得跳到不相关页面。

深链只携带目标标识，不携带可作为页面事实的状态快照。客户端打开目标后必须重新读取最新资源状态和 `allowedActions`。

## 8. 周调整与版本差异

周调整发布后，`GET /me/plans/pending-confirmation` 和历史详情必须提供：

- `observedFacts[]`：本周期观测事实及来源；
- `dataConfidence`：`HIGH | MEDIUM | LOW`，并返回影响可信度的原因代码；
- `changeSummary[]`：字段代码、影响范围、调整前值、调整后值；
- `adjustmentReasons[]`：结构化理由代码与安全展示文案；
- `unchangedVariables[]`：明确保持不变的关键变量及原因；
- `effectiveAt`：计划到期生效时间；
- `sourcePeriod`：所用数据周期与充分度；
- `review`：饮食/训练审核状态、审核角色和完成时间；
- `planVersionId`、`previousPlanVersionId`：不可变版本标识；
- `fullPlanRef`、`historyRef`：完整计划和历史版本资源引用。

用户端先呈现“改了什么、为什么、何时生效”，再进入完整待确认计划。后台保留规则版本、审核意见和完整审计记录。

## 9. Mock 策略

UI 部以本契约生成 MSW handlers 或等价 mock，固定 UUID 和 UTC 时间，禁止在 mock 内实现业务规则。问题 28 已确认选择 B：必须建立两套完整模拟用户数据，分别贯穿减脂 `FAT_LOSS` 与增肌 `MUSCLE_GAIN` 分支。页面分支只能由响应中的 `goalType`、`planVersionId`、`revision` 和状态字段驱动，不得按用户 ID、姓名或前端常量硬编码。

两套基础模拟用户：

| fixture | goalType | 场景 | 内容要求 |
| --- | --- | --- | --- |
| `persona_fat_loss` | `FAT_LOSS` | 健身房或居家之一，由 UI 统一选定 | 完整建档、饮食/训练计划、每日记录、周反馈、一次周调整 |
| `persona_muscle_gain` | `MUSCLE_GAIN` | 与减脂用户形成器械/训练经验差异 | 完整建档、饮食/训练计划、每日记录、周反馈、一次周调整 |

每套 fixture 必须能独立切换下列状态；不能为了展示异常而破坏目标类型和计划版本的一致性：

1. `happy_path`：建档完成、双审核、双确认、计划生效。
2. `profile_incomplete`：返回 `missingFields`。
3. `screening_review`：用户停留在人工复核等待页。
4. `diet_rejected`：训练已通过但饮食被退回，发布被阻断。
5. `training_rejected`：饮食已通过但训练被退回，发布被阻断。
6. `risk_paused`：疼痛/红旗停止关联训练并创建高优先级事件。
7. `insufficient_data`：周调整保持计划，不能收紧或加量。
8. `version_conflict`：提交旧 `expectedVersion` 返回 409。
9. `session_expired`：返回 401，验证草稿恢复。
10. `test_closed`：只读历史与数据请求入口。

饮食、热量、动作、组次和周调整示例必须标记 `demoOnly: true`、`reviewStatus: "DEMO_UNREVIEWED"`，并在原型中醒目标注“仅用于原型演示，未经专业审核”。在 G1 前不得把它们用于真实参与者，也不得用“精准”“处方”“诊断”等文字。API 集成测试必须覆盖：引用演示内容的真人计划发布返回 `409 UNAPPROVED_CONTENT_REFERENCED`。

## 10. 测试与联调验收

### 10.1 目标分支与关键流程

减脂 `FAT_LOSS` 和增肌 `MUSCLE_GAIN` 两套数据必须分别完整通过以下流程，不能只复用同一条成功路径改展示文案：

1. 受邀账号登录与首次改密；
2. 知情说明、筛查、分步建档和计划等待时间线；
3. 待确认计划的饮食/训练分别确认与任一拒绝整版退回；
4. 到期生效、今日任务、饮食三态记录、训练逐组及事后补录；
5. 疼痛上报、周反馈、结构化周调整摘要和新版本确认；
6. 后台风险接单、营养审核、训练审核、发布、退回和版本冲突处理。

### 10.2 状态与错误矩阵

每个核心流程至少验证 `LOADING`、`EMPTY`、`READY`、网络可重试错误、无权限、系统不可重试失败和人工处理中状态。安全阻断场景还必须验证用户端不出现半成品计划、后台生成相应待办且审计事件可查询。

### 10.3 视口验收

- H5：360px、390px、430px；
- Web 后台：1024px、1280px、1440px。

视口验收由 UI 测试负责，但接口夹具必须在所有视口返回相同核心业务字段。后端不得使用 User-Agent 或视口参数改变业务状态或裁剪待办内容。

### 10.4 契约一致性

Mock 与真实 API 必须共同通过同一套契约测试，包括响应 schema、状态码、错误结构、权限、状态转换、幂等和乐观锁。Mock 不得放宽真实 API 的发布、审核、风险或内容审核约束；真实 API 也不得返回契约外自由状态。

关键流程最低测试层级：

- 组件测试：字段渲染、状态语义、操作可用性和结构化错误；
- 状态测试：计划、风险、建档和任务状态机的允许/禁止转换；
- API 契约测试：Mock 与真实服务使用同一 schema 和示例；
- E2E：两套目标分支的用户闭环及后台审核发布闭环。

未通过上述矩阵不得把原型或实现标记为可供真人封闭测试。

## 11. 待确认项

- 专业筛查题、固定安全求助文案和响应时限；
- 饮食/训练模板的具体字段与单位；
- 数据充分性阈值、周调整规则和专业审核签字；
- 会话时长、锁定阈值、数据导出格式及删除例外；
- UI 部后续获批架构部分带来的新增页面字段与接口需求；
- 最终部署形态与 API 的跨域/同域策略。

上述待确认项不得由后端或 UI 自行推断为产品规则。
