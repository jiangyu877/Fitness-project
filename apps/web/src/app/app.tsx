import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Dumbbell,
  FileText,
  Home,
  ListChecks,
  MessageSquareText,
  MoreHorizontal,
  ShieldAlert,
  Sparkles,
  UserRound,
  Utensils,
} from 'lucide-react';
import React, { Suspense, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import {
  demoPersonas,
  isDemoPersonaSwitcherEnabled,
  prototypeDisclaimer,
  type DemoPersona,
  type DemoRuntimeEnvironment,
} from '../mocks/personas.js';
import { pageCatalog, type PageDefinition } from '../mocks/page-catalog.js';
import { ReviewDetailPage } from '../features/review/review-detail-page.js';
import { Phase3Page, type Phase3PageKind } from '../features/phase3/phase3-pages.js';
import { AuthOnboardingPage, defaultIdentityClient, pathForNextAction, type AuthOnboardingKind } from '../features/auth-onboarding/auth-onboarding-pages.js';
import { IdentityError, type IdentityClient, type RestoredUserSession } from '../features/identity/identity-client.js';
import { IdentityNextActionPage, IdentityRecoveryIssue, nextActionForIdentityPath } from '../features/identity/identity-next-action-page.js';
import { createPlanClient, type PlanClient, type PlanSession } from '../features/plans-real/plan-client.js';
import { RealPlanPage, type RealPlanPageKind } from '../features/plans-real/real-plan-page.js';
import { resolveRoute } from './routing.js';

function getDefaultPersona(): DemoPersona {
  const persona = demoPersonas[0];
  if (!persona) {
    throw new Error('At least one demo persona is required');
  }
  return persona;
}

const defaultPersona = getDefaultPersona();
const runtimeDemoEnvironment: DemoRuntimeEnvironment = {
  mode: import.meta.env.MODE,
  dev: import.meta.env.DEV,
  demoPersonaSwitcher: import.meta.env.VITE_DEMO_PERSONA_SWITCHER,
};
const defaultPlanClient = createPlanClient();
const DevelopmentPersonaSwitcher = import.meta.env.DEV
  ? React.lazy(() => import('./development-persona-switcher.js'))
  : null;

export type { DemoRuntimeEnvironment } from '../mocks/personas.js';

function DemoNotice() {
  return (
    <div className="demo-notice" role="note">
      <Sparkles aria-hidden="true" size={16} />
      <span>{prototypeDisclaimer}</span>
    </div>
  );
}

function DemoPersonaSwitcher({
  compact = false,
  enabled,
  persona,
  onChange,
}: {
  compact?: boolean;
  enabled: boolean;
  persona: DemoPersona;
  onChange: (personaId: DemoPersona['id']) => void;
}) {
  if (!enabled || !DevelopmentPersonaSwitcher) return null;

  return (
    <Suspense fallback={null}>
      <DevelopmentPersonaSwitcher compact={compact} persona={persona} onChange={onChange} />
    </Suspense>
  );
}

function H5Today({ persona, showPersonaSwitcher, onPersonaChange }: {
  persona: DemoPersona;
  showPersonaSwitcher: boolean;
  onPersonaChange: (personaId: DemoPersona['id']) => void;
}) {
  return (
    <div className="today-page">
      <header className="mobile-header">
        <div>
          <span className="eyebrow">{persona.today.dateLabel}</span>
          <h1>今天，先完成最重要的事</h1>
        </div>
        <Link className="icon-button" aria-label="打开消息中心" to="/h5/messages"><Bell size={20} /></Link>
      </header>

      <DemoNotice />
      <DemoPersonaSwitcher enabled={showPersonaSwitcher} persona={persona} onChange={onPersonaChange} />

      <section className="progress-band" aria-labelledby="weekly-progress">
        <div>
          <span className="eyebrow eyebrow--dark">本周进度</span>
          <h2 id="weekly-progress">稳定完成，比一次完美更重要</h2>
        </div>
        <div className="progress-ring" aria-label={`本周完成度 ${persona.completion}%`}><span>{persona.completion}%</span></div>
      </section>

      <section className="section-block" aria-labelledby="today-tasks">
        <div className="section-heading">
          <div><span className="eyebrow">今日任务</span><h2 id="today-tasks">{persona.today.tasks.length} 项待完成</h2></div>
          {persona.today.estimatedMinutes && <span className="quiet">{persona.today.estimatedMinutes}</span>}
        </div>
        {persona.today.tasks.map((task) => <TaskRow
          key={task.label}
          icon={task.kind === 'meal' ? <Utensils /> : task.kind === 'training' ? <Dumbbell /> : <ClipboardCheck />}
          tone={task.kind === 'meal' ? 'lime' : task.kind === 'training' ? 'blue' : 'amber'}
          label={task.label}
          meta={task.meta}
          action={task.action}
          to={task.to}
        />)}
        {!showPersonaSwitcher && <span className="status status--success">{persona.selectedPlanState === 'EFFECTIVE' ? '当前计划已生效' : '当前计划不可执行'}</span>}
      </section>

      <section className="insight-strip">
        <Clock3 aria-hidden="true" />
        <div><strong>下一次周反馈</strong><span>周日 20:00 开放，届时回顾本周执行</span></div>
        <ChevronRight aria-hidden="true" />
      </section>
    </div>
  );
}

function TaskRow({ icon, tone, label, meta, action, to }: { icon: React.ReactNode; tone: string; label: string; meta: string; action: string; to: string }) {
  return (
    <Link className="task-row" to={to}>
      <span className={`task-icon task-icon--${tone}`} aria-hidden="true">{icon}</span>
      <span className="task-copy"><strong>{label}</strong><span>{meta}</span></span>
      <span className="task-action">{action}<ChevronRight size={17} aria-hidden="true" /></span>
    </Link>
  );
}

function H5Shell({ page, showPersonaSwitcher, planSession, planClient, identityClient, onSessionCreated }: {
  page: PageDefinition;
  showPersonaSwitcher: boolean;
  planSession: PlanSession | null;
  planClient: PlanClient;
  identityClient: IdentityClient;
  onSessionCreated: () => Promise<void>;
}) {
  const isToday = page.id === 'H5-TOD-01';
  const [personaId, setPersonaId] = useState(defaultPersona.id);
  const persona = demoPersonas.find((item) => item.id === personaId) ?? defaultPersona;

  return (
    <div className="h5-viewport">
      <main className="h5-main">
        {isToday ? <H5Today persona={persona} showPersonaSwitcher={showPersonaSwitcher} onPersonaChange={setPersonaId} /> : authOnboardingKind(page) ? <AuthOnboardingPage kind={authOnboardingKind(page)!} identityClient={identityClient} onSessionCreated={onSessionCreated} /> : phase3Kind(page) ? <Phase3Page kind={phase3Kind(page)!} /> : realPlanKind(page) ? <RealPlanPage kind={realPlanKind(page)!} session={planSession} client={planClient} /> : <GenericPage page={page} />}
      </main>
      <nav className="mobile-nav" aria-label="移动端主导航">
        <MobileNavItem to="/h5/today" label="今日" icon={<Home />} active={isToday} />
        <MobileNavItem to="/h5/plans/current" label="计划" icon={<CalendarDays />} active={page.id.startsWith('H5-PLN')} />
        <MobileNavItem to="/h5/records" label="记录" icon={<ListChecks />} active={page.id.startsWith('H5-REC')} />
        <MobileNavItem to="/h5/data-requests" label="我的" icon={<UserRound />} active={page.id === 'H5-P1-DATA-01'} />
      </nav>
    </div>
  );
}

function realPlanKind(page: PageDefinition): RealPlanPageKind | undefined {
  if (page.id === 'H5-PLN-01') return 'pending';
  if (page.id === 'H5-PLN-02') return 'current';
  if (page.id === 'H5-PLN-04') return 'history';
  return undefined;
}

function authOnboardingKind(page: PageDefinition): AuthOnboardingKind | undefined {
  const map: Partial<Record<string, AuthOnboardingKind>> = {
    'H5-AUTH-01': 'invited-login',
    'H5-AUTH-02': 'change-password',
    'H5-ONB-01': 'consent',
    'H5-ONB-02': 'screening',
    'H5-ONB-03': 'profile',
    'H5-ONB-04': 'preparation',
    'WEB-AUTH-01': 'staff-login',
  };
  return map[page.id];
}

function phase3Kind(page: PageDefinition): Phase3PageKind | undefined {
  const map: Partial<Record<string, Phase3PageKind>> = {'H5-ONB-01':'consent','H5-ONB-02':'screening','H5-ONB-03':'profile','H5-REC-02':'diet','H5-REC-03':'training-live','H5-REC-04':'training-retro','H5-REC-05':'weekly-feedback','H5-SAF-01':'safety','H5-P1-MSG-01':'messages','H5-P1-DATA-01':'data','WEB-USR-01':'user','WEB-RSK-02':'risk','WEB-ADJ-01':'adjustment'};
  return map[page.id];
}

function MobileNavItem({ to, label, icon, active }: { to: string; label: string; icon: React.ReactNode; active: boolean }) {
  return <Link to={to} className={active ? 'mobile-nav__item is-active' : 'mobile-nav__item'}>{icon}<span>{label}</span></Link>;
}

const adminNav = [
  { to: '/web/work-queue', label: '工作队列', icon: ListChecks },
  { to: '/web/users/demo', label: '用户复核', icon: UserRound },
  { to: '/web/plans/workspace', label: '计划工作区', icon: FileText },
  { to: '/web/adjustments/review', label: '周调整', icon: ClipboardCheck },
  { to: '/web/risks', label: '风险与异常', icon: ShieldAlert },
];

function WebWorkQueue() {
  const fatLossPersona = demoPersonas.find((persona) => persona.goalType === 'FAT_LOSS') ?? defaultPersona;
  const muscleGainPersona = demoPersonas.find((persona) => persona.goalType === 'MUSCLE_GAIN') ?? defaultPersona;
  const items = [
    { level: '高优先级', type: '风险复核', user: fatLossPersona.displayName, detail: '训练后反馈膝部不适，关联动作已暂停', time: '12 分钟前', tone: 'risk' },
    { level: '临近截止', type: '计划发布', user: muscleGainPersona.displayName, detail: '双审核已通过，等待运营核对发布时间', time: '今天 15:20', tone: 'warning' },
    { level: '普通', type: '饮食审核', user: fatLossPersona.displayName, detail: '第 2 周演示计划饮食部分待复核', time: '今天 14:05', tone: 'info' },
  ];

  return (
    <>
      <div className="web-page-heading"><div><span className="eyebrow">今日工作</span><h1>工作队列</h1><p>按风险、逾期、优先级与进入时间排序。</p></div><button className="button button--secondary">刷新队列</button></div>
      <div className="metric-row">
        <Metric label="待处理" value="12" note="较昨日 -3" />
        <Metric label="高风险" value="2" note="需要立即处理" risk />
        <Metric label="临近截止" value="4" note="24 小时内" />
        <Metric label="我的任务" value="7" note="运营人员" />
      </div>
      <div className="toolbar"><div className="segmented" role="group" aria-label="队列范围"><button className="is-selected">我的待办</button><button>全部任务</button></div><button className="filter-button">风险与逾期优先</button></div>
      <section className="queue-panel" aria-label="待办列表">
        <div className="queue-header"><span>任务</span><span>对象与说明</span><span>进入时间</span><span aria-label="操作" /></div>
        {items.map((item) => (
          <Link to={item.type === '风险复核' ? '/web/risks/demo' : '/web/plans/publish'} className="queue-row" key={`${item.type}-${item.user}`}>
            <span><span className={`status status--${item.tone}`}>{item.level}</span><strong>{item.type}</strong></span>
            <span><strong>{item.user}</strong><small>{item.detail}</small></span>
            <span className="quiet">{item.time}</span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        ))}
      </section>
    </>
  );
}

function Metric({ label, value, note, risk = false }: { label: string; value: string; note: string; risk?: boolean }) {
  return <div className={risk ? 'metric metric--risk' : 'metric'}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function WebShell({ page, showPersonaSwitcher }: { page: PageDefinition; showPersonaSwitcher: boolean }) {
  const [personaId, setPersonaId] = useState(defaultPersona.id);
  const persona = demoPersonas.find((item) => item.id === personaId) ?? defaultPersona;
  const authKind = authOnboardingKind(page);
  const kind = phase3Kind(page);
  const content = authKind
    ? <AuthOnboardingPage kind={authKind} />
    : kind
    ? <Phase3Page kind={kind} />
    : page.id === 'WEB-WQ-01'
    ? <WebWorkQueue />
    : page.id === 'WEB-REV-01'
      ? <ReviewDetailPage kind="diet" persona={persona} />
      : page.id === 'WEB-REV-02'
        ? <ReviewDetailPage kind="training" persona={persona} />
        : <GenericPage page={page} />;

  return (
    <div className="web-app">
      <aside className="web-sidebar">
        <Link className="brand" to="/web/work-queue"><span className="brand-mark"><Check /></span><span><strong>练伴</strong><small>专业协作台</small></span></Link>
        <nav aria-label="后台主导航">
          {adminNav.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={page.path === to ? 'is-active' : ''}><Icon size={18} /><span>{label}</span></Link>)}
        </nav>
        <div className="sidebar-spacer" />
        <Link to="/web/audit"><FileText size={18} /><span>审计查询</span><span className="p1-mark">P1</span></Link>
        <div className="staff-profile"><span className="staff-avatar">运</span><span><strong>运营人员</strong><small>演示工作区</small></span><MoreHorizontal size={18} /></div>
      </aside>
      <div className="web-content">
        <header className="web-topbar"><DemoNotice /><DemoPersonaSwitcher compact enabled={showPersonaSwitcher} persona={persona} onChange={setPersonaId} /></header>
        <main>{content}</main>
      </div>
      <div className="unsupported-width" role="alert">当前宽度不支持处理后台任务，请将窗口调整到至少 1024px。</div>
    </div>
  );
}

function GenericPage({ page }: { page: PageDefinition }) {
  return (
    <div className={page.surface === 'h5' ? 'generic-page generic-page--h5' : 'generic-page'}>
      <div className="generic-topline">
        <span className="page-id">{page.id}</span>
        <span className={page.priority === 'P1' ? 'priority priority--p1' : 'priority'}>{page.priority}{page.priority === 'P1' ? ' 最小入口' : ''}</span>
      </div>
      <h1>{page.title}</h1>
      <p className="page-intro">{page.entryCondition}</p>
      <DemoNotice />
      <section className="state-panel">
        <span className="eyebrow">当前演示状态</span>
        <h2>可以继续</h2>
        <p>{page.primaryAction}</p>
        <button className="button">{page.primaryAction}<ArrowRight size={17} /></button>
      </section>
      <section className="contract-grid">
        <div><span>空态</span><p>{page.emptyState}</p></div>
        <div><span>阻断与异常</span><p>{page.blockedState}</p></div>
        <div><span>退出结果</span><p>{page.exitResult}</p></div>
      </section>
      <details className="route-directory">
        <summary>查看本端全部页面</summary>
        <div>{pageCatalog.filter((item) => item.surface === page.surface).map((item) => <Link key={item.id} to={item.path}>{item.id} · {item.title}</Link>)}</div>
      </details>
    </div>
  );
}

export type AppRoutesProps = { demoEnvironment?: DemoRuntimeEnvironment; identityClient?: IdentityClient; planClient?: PlanClient };

export function AppRoutes({ demoEnvironment = runtimeDemoEnvironment, identityClient = defaultIdentityClient, planClient = defaultPlanClient }: AppRoutesProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const page = resolveRoute(location.pathname);
  const detailVersion = planDetailVersion(location.pathname);
  const [recoveryPending, setRecoveryPending] = useState(() => identityClient.hasStoredSession());
  const [recoveryError, setRecoveryError] = useState<IdentityError>();
  const [restoredSession, setRestoredSession] = useState<RestoredUserSession>();

  async function restore() {
    setRecoveryPending(identityClient.hasStoredSession());
    setRecoveryError(undefined);
    await identityClient.restoreSession().then((session) => {
      if (session) {
        setRestoredSession(session);
        if (!location.pathname.startsWith('/h5/plans/')) {
          navigate(pathForNextAction(session.nextAction), { replace: true });
        }
      }
      setRecoveryPending(false);
    }).catch((error: unknown) => {
      if (error instanceof IdentityError && (error.status === 401 || error.status === 423)) {
        navigate('/h5/login', { replace: true });
        setRecoveryPending(false);
        return;
      }
      setRecoveryPending(false);
      setRecoveryError(error instanceof IdentityError ? error : new IdentityError('网络连接不可用，请检查连接后重试。', 0, 'NETWORK_ERROR'));
    });
  }

  useEffect(() => {
    void restore();
  }, [identityClient]);

  if (location.pathname === '/') return <Navigate to="/h5/today" replace />;
  if (recoveryPending) return <div className="h5-viewport"><main className="h5-main"><div className="generic-page generic-page--h5 identity-next-action" role="status">正在确认登录状态</div></main></div>;
  if (recoveryError) return <div className="h5-viewport"><main className="h5-main"><IdentityRecoveryIssue
    message={recoveryError.message}
    {...(recoveryError.recoverableActions.includes('RETRY') ? { onRetry: restore } : {})}
  /></main></div>;
  const identityAction = nextActionForIdentityPath(location.pathname);
  if (identityAction) return <div className="h5-viewport"><main className="h5-main"><IdentityNextActionPage nextAction={identityAction} /></main></div>;
  if (location.pathname === '/h5/contact-operations') return <div className="h5-viewport"><main className="h5-main"><AuthOnboardingPage kind="contact-operations" identityClient={identityClient} /></main></div>;
  if (detailVersion) {
    const planSession = restoredSession ? { accountId: restoredSession.accountId, token: restoredSession.token } : null;
    return <div className="h5-viewport"><main className="h5-main"><RealPlanPage kind="detail" planVersionId={detailVersion} session={planSession} client={planClient} /></main></div>;
  }
  if (!page) return <div className="not-found"><AlertTriangle /><h1>页面不存在</h1><Link to="/h5/today">返回今日</Link></div>;
  const showPersonaSwitcher = isDemoPersonaSwitcherEnabled(demoEnvironment);
  const planSession = restoredSession ? { accountId: restoredSession.accountId, token: restoredSession.token } : null;
  return page.surface === 'h5' ? <H5Shell page={page} showPersonaSwitcher={showPersonaSwitcher} planSession={planSession} planClient={planClient} identityClient={identityClient} onSessionCreated={restore} /> : <WebShell page={page} showPersonaSwitcher={showPersonaSwitcher} />;
}

function planDetailVersion(path: string): string | undefined {
  const match = /^\/h5\/plans\/detail\/([^/]+)$/.exec(path);
  if (!match) return undefined;
  try {
    const version = decodeURIComponent(match[1]!);
    return version.trim() ? version : undefined;
  } catch {
    return undefined;
  }
}
