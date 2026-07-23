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
import React, { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';

import { demoPersonas, prototypeDisclaimer, type DemoPersona } from '../mocks/personas.js';
import { pageCatalog, type PageDefinition } from '../mocks/page-catalog.js';
import { resolveRoute } from './routing.js';

function getDefaultPersona(): DemoPersona {
  const persona = demoPersonas[0];
  if (!persona) {
    throw new Error('At least one demo persona is required');
  }
  return persona;
}

const defaultPersona = getDefaultPersona();

function DemoNotice() {
  return (
    <div className="demo-notice" role="note">
      <Sparkles aria-hidden="true" size={16} />
      <span>{prototypeDisclaimer}</span>
    </div>
  );
}

function PersonaSwitcher({ compact = false }: { compact?: boolean }) {
  const [personaId, setPersonaId] = useState(defaultPersona.id);
  const persona = demoPersonas.find((item) => item.id === personaId) ?? defaultPersona;

  return (
    <div className={compact ? 'persona persona--compact' : 'persona'}>
      <div className="avatar" aria-hidden="true">{persona.name.slice(0, 1)}</div>
      <div className="persona__copy">
        <strong>{persona.name}</strong>
        <span>{persona.goalLabel}</span>
      </div>
      <label className="sr-only" htmlFor={compact ? 'persona-web' : 'persona-h5'}>切换演示用户</label>
      <select
        id={compact ? 'persona-web' : 'persona-h5'}
        aria-label="切换演示用户"
        value={persona.id}
        onChange={(event) => setPersonaId(event.target.value as typeof personaId)}
      >
        {demoPersonas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <span className={persona.planStatus === 'active' ? 'status status--success' : 'status status--warning'}>
        {persona.planStatus === 'active' ? '执行中' : '待确认'}
      </span>
    </div>
  );
}

function H5Today() {
  return (
    <div className="today-page">
      <header className="mobile-header">
        <div>
          <span className="eyebrow">7月23日 · 周三</span>
          <h1>今天，先完成最重要的事</h1>
        </div>
        <Link className="icon-button" aria-label="打开消息中心" to="/h5/messages"><Bell size={20} /></Link>
      </header>

      <DemoNotice />
      <PersonaSwitcher />

      <section className="progress-band" aria-labelledby="weekly-progress">
        <div>
          <span className="eyebrow eyebrow--dark">本周进度</span>
          <h2 id="weekly-progress">稳定完成，比一次完美更重要</h2>
        </div>
        <div className="progress-ring" aria-label="本周完成度 68%"><span>68%</span></div>
      </section>

      <section className="section-block" aria-labelledby="today-tasks">
        <div className="section-heading">
          <div><span className="eyebrow">今日任务</span><h2 id="today-tasks">3 项待完成</h2></div>
          <span className="quiet">约 46 分钟</span>
        </div>
        <TaskRow icon={<Utensils />} tone="lime" label="饮食记录" meta="完成三态打卡" action="去记录" to="/h5/records/diet" />
        <TaskRow icon={<Dumbbell />} tone="blue" label="下肢基础训练" meta="5 个动作 · 约 40 分钟" action="开始" to="/h5/records/training-live" />
        <TaskRow icon={<ClipboardCheck />} tone="amber" label="恢复感受" meta="训练后快速记录" action="待训练后" to="/h5/records" />
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

function H5Shell({ page }: { page: PageDefinition }) {
  const isToday = page.id === 'H5-TOD-01';

  return (
    <div className="h5-viewport">
      <main className="h5-main">
        {isToday ? <H5Today /> : <GenericPage page={page} />}
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
  const items = [
    { level: '高优先级', type: '风险复核', user: '林晓雨', detail: '训练后反馈膝部不适，关联动作已暂停', time: '12 分钟前', tone: 'risk' },
    { level: '临近截止', type: '计划发布', user: '周屿', detail: '双审核已通过，等待运营核对发布时间', time: '今天 15:20', tone: 'warning' },
    { level: '普通', type: '饮食审核', user: '林晓雨', detail: '第 2 周演示计划饮食部分待复核', time: '今天 14:05', tone: 'info' },
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

function WebShell({ page }: { page: PageDefinition }) {
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
        <header className="web-topbar"><DemoNotice /><PersonaSwitcher compact /></header>
        <main>{page.id === 'WEB-WQ-01' ? <WebWorkQueue /> : <GenericPage page={page} />}</main>
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

export function AppRoutes() {
  const location = useLocation();
  const page = resolveRoute(location.pathname);

  if (location.pathname === '/') return <Navigate to="/h5/today" replace />;
  if (!page) return <div className="not-found"><AlertTriangle /><h1>页面不存在</h1><Link to="/h5/today">返回今日</Link></div>;
  return page.surface === 'h5' ? <H5Shell page={page} /> : <WebShell page={page} />;
}
