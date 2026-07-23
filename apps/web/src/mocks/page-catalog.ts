export type Surface = 'h5' | 'web';
export type Priority = 'P0' | 'P1';

export interface PageDefinition {
  id: string;
  surface: Surface;
  priority: Priority;
  path: string;
  title: string;
  roles: readonly string[];
  entryCondition: string;
  primaryAction: string;
  emptyState: string;
  blockedState: string;
  exitResult: string;
}

const user = ['受邀用户'] as const;
const staff = ['运营人员', '营养审核者', '训练审核者', '系统管理员', '审计查看者'] as const;

export const pageCatalog: readonly PageDefinition[] = [
  { id: 'H5-AUTH-01', surface: 'h5', priority: 'P0', path: '/h5/login', title: '受邀登录', roles: user, entryCondition: '无有效用户会话', primaryAction: '使用受邀账号和密码登录', emptyState: '不适用', blockedState: '错误、锁定或停用时联系运营', exitResult: '进入首次改密或续接页面' },
  { id: 'H5-AUTH-02', surface: 'h5', priority: 'P0', path: '/h5/change-password', title: '首次修改密码', roles: user, entryCondition: '会话要求首次改密', primaryAction: '提交新密码', emptyState: '不适用', blockedState: '字段错误定位且保留输入', exitResult: '进入知情说明' },
  { id: 'H5-ONB-01', surface: 'h5', priority: 'P0', path: '/h5/consent', title: '知情说明与授权', roles: user, entryCondition: '未接受当前说明版本', primaryAction: '明确同意或退出', emptyState: '不适用', blockedState: '说明加载失败时禁止同意', exitResult: '进入筛查或退出流程' },
  { id: 'H5-ONB-02', surface: 'h5', priority: 'P0', path: '/h5/screening', title: '健康风险筛查', roles: user, entryCondition: '已同意且筛查未完成', primaryAction: '填写已批准问卷骨架', emptyState: '显示开始说明', blockedState: '风险信号仅进入人工复核，不展示诊断', exitResult: '进入建档、复核或停止状态' },
  { id: 'H5-ONB-03', surface: 'h5', priority: 'P0', path: '/h5/profile', title: '分阶段建档', roles: user, entryCondition: '筛查允许继续', primaryAction: '保存当前步骤', emptyState: '可选项允许跳过', blockedState: '缺失或矛盾项定位，草稿可恢复', exitResult: '进入计划准备' },
  { id: 'H5-ONB-04', surface: 'h5', priority: 'P0', path: '/h5/plan-preparation', title: '计划准备时间线', roles: user, entryCondition: '档案已提交或等待复核', primaryAction: '补充资料或联系运营', emptyState: '无补充项时显示预计进度', blockedState: '失败时不展示计划残片', exitResult: '进入待确认计划' },
  { id: 'H5-TOD-01', surface: 'h5', priority: 'P0', path: '/h5/today', title: '今日', roles: user, entryCondition: '已完成基础流程', primaryAction: '打开今日可执行任务', emptyState: '区分准备、待确认和计划空档', blockedState: '只暂停风险关联任务', exitResult: '进入记录、反馈或计划页面' },
  { id: 'H5-PLN-01', surface: 'h5', priority: 'P0', path: '/h5/plans/pending', title: '待确认计划', roles: user, entryCondition: '存在唯一待确认版本', primaryAction: '分别确认或拒绝饮食与训练', emptyState: '返回当前计划入口', blockedState: '拒绝或超时后禁止继续确认', exitResult: '等待生效或等待团队处理' },
  { id: 'H5-PLN-02', surface: 'h5', priority: 'P0', path: '/h5/plans/current', title: '当前计划', roles: user, entryCondition: '存在已生效计划', primaryAction: '查看周结构与当天详情', emptyState: '显示无当前计划原因', blockedState: '风险范围明确且历史只读', exitResult: '进入今日、调整或历史' },
  { id: 'H5-PLN-03', surface: 'h5', priority: 'P0', path: '/h5/plans/adjustment', title: '周调整摘要', roles: user, entryCondition: '调整版本已双审核并发布', primaryAction: '查看变化、原因和保持项', emptyState: '返回当前计划', blockedState: '摘要不得视为已生效', exitResult: '进入待确认计划或历史' },
  { id: 'H5-PLN-04', surface: 'h5', priority: 'P0', path: '/h5/plans/history', title: '历史计划', roles: user, entryCondition: '至少存在一个历史版本', primaryAction: '查看只读版本', emptyState: '说明暂无历史版本', blockedState: '无权限时返回计划首页', exitResult: '返回当前计划或版本摘要' },
  { id: 'H5-REC-01', surface: 'h5', priority: 'P0', path: '/h5/records', title: '记录', roles: user, entryCondition: '存在可记录日期', primaryAction: '进入饮食、训练或反馈', emptyState: '无任务时保留反馈入口', blockedState: '标记风险影响范围', exitResult: '进入具体记录页' },
  { id: 'H5-REC-02', surface: 'h5', priority: 'P0', path: '/h5/records/diet', title: '饮食记录', roles: user, entryCondition: '当日饮食任务可记录', primaryAction: '选择三态并提交', emptyState: '显示三态选择', blockedState: '离线保留草稿，关闭日期只读', exitResult: '返回今日并更新进度' },
  { id: 'H5-REC-03', surface: 'h5', priority: 'P0', path: '/h5/records/training-live', title: '训练逐组记录', roles: user, entryCondition: '训练任务可执行', primaryAction: '记录组次完成情况', emptyState: '无动作时联系运营', blockedState: '疼痛立即暂停关联动作', exitResult: '生成训练摘要' },
  { id: 'H5-REC-04', surface: 'h5', priority: 'P0', path: '/h5/records/training-retro', title: '训练事后补录', roles: user, entryCondition: '任务允许补录', primaryAction: '补录动作完成情况', emptyState: '无可补录动作时返回今日', blockedState: '冲突时不静默覆盖', exitResult: '进入训练摘要' },
  { id: 'H5-REC-05', surface: 'h5', priority: 'P0', path: '/h5/records/weekly-feedback', title: '周反馈', roles: user, entryCondition: '反馈窗口已开放', primaryAction: '提交执行与恢复反馈', emptyState: '显示下次开放时间', blockedState: '疼痛进入人工风险处理', exitResult: '进入调整等待状态' },
  { id: 'H5-SAF-01', surface: 'h5', priority: 'P0', path: '/h5/safety-review', title: '安全阻断与人工复核', roles: user, entryCondition: '存在风险、矛盾或安全阻断', primaryAction: '补充资料或联系运营', emptyState: '不适用', blockedState: '不提供诊断或未批准安全阈值', exitResult: '解除后返回原任务或等待' },
  { id: 'H5-P1-MSG-01', surface: 'h5', priority: 'P1', path: '/h5/messages', title: '消息中心', roles: user, entryCondition: '从未读入口进入', primaryAction: '标记已读并打开任务深链', emptyState: '暂无新消息', blockedState: '失效深链返回列表', exitResult: '进入最新任务或原页' },
  { id: 'H5-P1-DATA-01', surface: 'h5', priority: 'P1', path: '/h5/data-requests', title: '数据导出与删除', roles: user, entryCondition: '从我的页面进入', primaryAction: '提交请求并查看状态', emptyState: '显示可提交入口', blockedState: '明确安全事件延迟与包失效', exitResult: '显示受理、处理或完成状态' },
  { id: 'WEB-AUTH-01', surface: 'web', priority: 'P0', path: '/web/login', title: '员工登录', roles: staff, entryCondition: '无有效员工会话', primaryAction: '使用员工凭据登录', emptyState: '不适用', blockedState: '错误、锁定和无权限分别提示', exitResult: '进入角色允许的入口' },
  { id: 'WEB-WQ-01', surface: 'web', priority: 'P0', path: '/web/work-queue', title: '工作队列', roles: staff.slice(0, 3), entryCondition: '员工已登录且有队列权限', primaryAction: '筛选并打开任务', emptyState: '队列已清空', blockedState: '失败保留筛选，无权限隐藏动作', exitResult: '进入任务详情' },
  { id: 'WEB-USR-01', surface: 'web', priority: 'P0', path: '/web/users/demo', title: '共享用户详情', roles: staff, entryCondition: '从队列或检索进入', primaryAction: '查看上下文和允许任务', emptyState: '无计划或记录时分区说明', blockedState: '按角色脱敏并置顶风险', exitResult: '进入计划或风险详情' },
  { id: 'WEB-PLN-01', surface: 'web', priority: 'P0', path: '/web/plans/workspace', title: '计划工作区', roles: staff.slice(0, 3), entryCondition: '可访问指定计划版本', primaryAction: '编辑、提交或进入对应审核', emptyState: '按允许动作创建草案', blockedState: '已发布只读，冲突先比较', exitResult: '保存、审核或准备发布' },
  { id: 'WEB-REV-01', surface: 'web', priority: 'P0', path: '/web/reviews/diet', title: '饮食审核', roles: ['营养审核者'], entryCondition: '饮食处于待审核', primaryAction: '批准或退回并填写意见', emptyState: '返回工作队列', blockedState: '越权或自审被禁止', exitResult: '写入结果并返回工作区' },
  { id: 'WEB-REV-02', surface: 'web', priority: 'P0', path: '/web/reviews/training', title: '训练审核', roles: ['训练审核者'], entryCondition: '训练处于待审核', primaryAction: '批准或退回并填写意见', emptyState: '返回工作队列', blockedState: '越权或自审被禁止', exitResult: '写入结果并返回工作区' },
  { id: 'WEB-PLN-02', surface: 'web', priority: 'P0', path: '/web/plans/publish', title: '发布与用户确认', roles: ['运营人员'], entryCondition: '双审核通过或已发布', primaryAction: '发布或查看确认状态', emptyState: '显示具体发布阻断项', blockedState: '时限、唯一版本和状态冲突阻止发布', exitResult: '发布待确认或创建新版本' },
  { id: 'WEB-ADJ-01', surface: 'web', priority: 'P0', path: '/web/adjustments/review', title: '周调整审核', roles: staff.slice(0, 3), entryCondition: '存在调整草案', primaryAction: '查看事实、差异和保持项', emptyState: '数据不足时建议保持', blockedState: '风险优先且不得跳过完整流程', exitResult: '进入发布或退回修改' },
  { id: 'WEB-RSK-01', surface: 'web', priority: 'P0', path: '/web/risks', title: '风险与异常队列', roles: staff.slice(0, 3), entryCondition: '具有风险队列权限', primaryAction: '筛选、接单并打开事件', emptyState: '队列已清空', blockedState: '高风险置顶，失败保留筛选', exitResult: '进入风险详情' },
  { id: 'WEB-RSK-02', surface: 'web', priority: 'P0', path: '/web/risks/demo', title: '风险与异常详情', roles: staff.slice(0, 3), entryCondition: '有权访问指定事件', primaryAction: '记录处理并等待补充', emptyState: '显示初始事件事实', blockedState: '不提供诊断，越权和冲突被禁止', exitResult: '更新状态并返回队列' },
  { id: 'WEB-P1-ACC-01', surface: 'web', priority: 'P1', path: '/web/accounts', title: '测试账号操作', roles: ['运营人员'], entryCondition: '具有测试账号操作权限', primaryAction: '创建、重置、解锁或停用', emptyState: '只显示创建入口', blockedState: '高影响动作确认且越权禁止', exitResult: '返回用户详情并显示结果' },
  { id: 'WEB-P1-DATA-01', surface: 'web', priority: 'P1', path: '/web/data-requests', title: '数据请求处理', roles: ['运营人员'], entryCondition: '存在数据请求', primaryAction: '接单并记录核验结果', emptyState: '请求队列已清空', blockedState: '仅记录最小冻结与具名例外', exitResult: '同步用户端请求状态' },
  { id: 'WEB-P1-AUD-01', surface: 'web', priority: 'P1', path: '/web/audit', title: '审计查询', roles: ['审计查看者'], entryCondition: '具有只读审计权限', primaryAction: '查询关键事件', emptyState: '无匹配记录', blockedState: '严格只读且脱敏不可恢复', exitResult: '显示结果或只读详情' },
];

export function findPageByPath(path: string): PageDefinition | undefined {
  return pageCatalog.find((page) => page.path === path);
}
