# 练伴 V1.0 P19 浏览器与无障碍证据包

日期：2026-08-24
范围：本地 loopback Edge；虚构/demo 内容；仅 P19 浏览器与无障碍验收证据。
明确排除：Chrome、生产/外部数据库、真人数据、部署、G2/G3、release、`readyForRealUsers=true`。

## 1. 页面矩阵

冻结页面矩阵共 32 个唯一路由：H5 19 个、Web 13 个。每个结果均在 Edge 本地页面加载后读取非空 DOM、`h1`、`document.documentElement.scrollWidth/clientWidth`。

| 平台 | CSS 视口 | 路由数 | 非空 DOM | 有 `h1` | 水平溢出 | 备注 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| H5 | 360 | 19 | 19/19 | 19/19 | 0 | 通过 |
| H5 | 390 | 19 | 19/19 | 19/19 | 0 | 通过 |
| H5 | 430 | 19 | 19/19 | 19/19 | 0 | 通过 |
| Web | 1024 | 13 | 13/13 | 13/13 | 0 | 通过 |
| Web | 1280 | 13 | 13/13 | 13/13 | 0 | 通过 |
| Web | 1440 | 13 | 13/13 | 13/13 | 0 | 通过 |

Edge 设备像素比为 2。为得到 CSS Web 1024/1280/1440，本轮使用物理 2048/2560/2880 覆盖；物理 1024/1280/1440 只对应 CSS 512/640/720，会正确显示“当前宽度不支持”，不计入正式 Web 视口结果。

## 2. Edge 200% 等效窄视口

- 物理 390px 在 Edge 200% 下得到 `innerWidth=195`；
- `scrollWidth=187 <= clientWidth=187`；
- 标题、两张任务卡和固定底部导航均未裁切或遮挡；
- 滚动到底部后，末尾内容与固定导航保持约 140.5px 安全间距；
- `body` 不再强制 `min-width: 320px`，H5 底部安全空间保持 112px 规则。

## 3. 键盘、焦点和触控

Edge Tab 实测焦点顺序覆盖消息入口、两张今日任务链接以及“今日/计划/记录/我的”四个移动导航链接；每个目标均出现 `:focus-visible`。H5 实测可交互元素的最小宽高为 44px。运行时语义包含 `main`、标题、导航和链接；消息阻断态使用 `role="alert"`。

## 4. 减少动态

样式包含 `@media (prefers-reduced-motion: reduce)`，关闭平滑滚动并将 transition/animation 缩短到最小持续时间、限制迭代次数。Edge 本轮媒体查询为 `no-preference`，因此仅证明规则存在，未将系统未切换 reduced-motion 的结果表述为人工行为通过。

## 5. 自动化回归辅助证据

- Web 全量 suite：34 spec / 342 passed / 0 failed；
- P19 styles contract：2 passed；
- Web typecheck：通过；
- `git diff --check`：通过；
- 暂存区：空。

这些命令只作为辅助证据，不能替代 Edge runtime；本包第 6 节记录的人工辅助技术确认由独立 QA 复核。

## 6. Narrator 状态与验收

自动化接口不能读取 Narrator 音频通道，因此 DOM 语义和焦点路径本身不作为听觉证据。本轮由项目发起人在 Edge + Narrator 下人工确认实时播报、人工键盘完整流程和无障碍验收已完成并批准；质量与无障碍部独立复核接受该人工确认作为本轮人工证据来源。

本节人工证据已由独立 QA 复核，不再是 P19 阻断项。该结论仅限 P19 本地 Edge 与人工确认，不关闭 `readyForRealUsers=false`、G2/G3 或 release 门禁。

## 7. 独立 QA 结论

质量与无障碍部独立复核结论：`QA_CLEAR / P19_ACCESSIBILITY_REVIEW_COMPLETE`。该部门确认六视口 Edge、Edge 200% 等效窄视口、可见焦点、44px 触控、静态回归、reduced-motion 边界，以及项目发起人提供的 Edge + Narrator 实时播报和人工键盘/无障碍确认均满足当前 P19 验收口径。Chrome 不在本次范围；该结论不外推真人服务、G2/G3、release 或 `readyForRealUsers`。

## 8. 人工交接记录

以下是本轮 Edge + Narrator 人工验收的记录口径；项目发起人已确认完成，不输入账号、密码或真人数据：

1. 打开 `/h5/today`，从页面顶部开始连续按 Tab，记录 Narrator 对消息入口、两项任务和四项导航的实际播报文本与顺序。
2. 打开 `/h5/messages`，记录页面标题、`role="alert"` 阻断状态和任何状态变化的实际播报；确认焦点仍可见且没有水平滚动。
3. 在 CSS 360px、390px、430px 以及 CSS 1024px、1280px、1440px 中各抽查一次键盘路径，记录是否能到达同一组关键控件、是否出现遮挡或焦点丢失。
4. 在 Narrator 可听取的情况下，由执行人填写日期、Edge 版本、Narrator 版本、页面路径、焦点顺序、播报文本、结果（PASS/FAIL）和签名/确认人。

项目发起人已确认上述 Edge + Narrator 实时播报、人工键盘和无障碍验收完成；质量与无障碍部已独立复核并解除 P19 `QA_BLOCK`。该记录不关闭任何真人/发布门禁。

## 9. 用户人工确认（已独立复核）

2026-08-24，项目发起人明确确认“Edge + Narrator、人工键盘、实时播报已经完成，可以获批”。质量与无障碍部随后独立确认该人工确认满足当前 P19 验收口径，P19 结论更新为 `QA_CLEAR / P19_ACCESSIBILITY_REVIEW_COMPLETE`。该结论不自动关闭 P11 总体、真人服务、G2/G3 或 release 门禁。
