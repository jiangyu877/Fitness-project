import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, History, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  PlanClientError,
  createPlanClient,
  type CurrentPlanResult,
  type PlanClient,
  type PendingPlanResult,
  type PlanSession,
  type PlanTransitionIntent,
  type PlanTransitionType,
  type PlanVersion,
} from './plan-client.js';

export type RealPlanPageKind = 'pending' | 'current' | 'history' | 'detail';

export function RealPlanPage({
  kind,
  planVersionId,
  session,
  client = createPlanClient(),
}: {
  kind: RealPlanPageKind;
  planVersionId?: string;
  session: PlanSession | null;
  client?: PlanClient;
}) {
  const [current, setCurrent] = useState<CurrentPlanResult>();
  const [history, setHistory] = useState<PlanVersion[]>();
  const [detail, setDetail] = useState<PlanVersion>();
  const [pending, setPending] = useState<PendingPlanResult>();
  const [readAttempt, setReadAttempt] = useState(0);
  const [transitionPending, setTransitionPending] = useState(false);
  const [failedTransition, setFailedTransition] = useState<{ version: string; intent: PlanTransitionIntent }>();
  const [error, setError] = useState<PlanClientError>();

  useEffect(() => {
    let active = true;
    setCurrent(undefined);
    setHistory(undefined);
    setDetail(undefined);
    setPending(undefined);
    setTransitionPending(false);
    setFailedTransition(undefined);
    setError(undefined);
    if (!session) return () => { active = false; };
    const request = kind === 'current'
      ? client.current(session)
      : kind === 'history'
        ? client.history(session)
        : kind === 'detail'
          ? client.detail(session, planVersionId ?? '')
          : client.pending(session);
    void request.then((result) => {
      if (!active) return;
      if (kind === 'current') setCurrent(result as CurrentPlanResult);
      else if (kind === 'history') setHistory((result as { items: PlanVersion[] }).items);
      else if (kind === 'detail') setDetail(result as PlanVersion);
      else setPending(result as PendingPlanResult);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(asPlanError(reason));
    });
    return () => { active = false; };
  }, [client, kind, planVersionId, readAttempt, session]);

  async function submitTransition(version: string, intent: PlanTransitionIntent) {
    if (!session || transitionPending) return;
    setTransitionPending(true);
    setFailedTransition(undefined);
    setError(undefined);
    try {
      await client.transition(session, version, intent);
      setPending(await client.pending(session));
    } catch (reason) {
      const planError = asPlanError(reason);
      if (planError.recoverableActions.includes('RETRY')) setFailedTransition({ version, intent });
      setError(planError);
    } finally {
      setTransitionPending(false);
    }
  }

  function startTransition(version: string, type: PlanTransitionType) {
    void submitTransition(version, client.createTransitionIntent(type));
  }

  if (!session) return <MissingSessionState />;
  if (error && !(kind === 'pending' && pending)) {
    return <PlanBlockedState
      error={error}
      {...(error.recoverableActions.includes('RETRY') ? { onRetry: () => setReadAttempt((attempt) => attempt + 1) } : {})}
    />;
  }
  if (kind === 'current' && !current) return <PlanLoadingState />;
  if (kind === 'history' && !history) return <PlanLoadingState />;
  if (kind === 'detail' && !detail) return <PlanLoadingState />;
  if (kind === 'pending' && !pending && !error) return <PlanLoadingState />;

  if (kind === 'current') {
    return current?.businessStatus === 'PLAN_GAP'
      ? <PlanGapState />
      : <CurrentPlan plan={current!.plan} />;
  }

  if (kind === 'pending') {
    if (error) {
      return <TransitionBlockedState
        error={error}
        {...(failedTransition ? { retry: () => void submitTransition(failedTransition.version, failedTransition.intent) } : {})}
      />;
    }
    return <PendingPlan result={pending!} submitting={transitionPending} onAction={startTransition} />;
  }

  if (kind === 'detail') {
    return <div className="real-plan-page"><PlanDetail plan={detail!} /><a className="button button--secondary" href="/h5/plans/history">返回历史计划</a></div>;
  }

  return (
    <div className="real-plan-page real-plan-page--history">
      <header className="real-plan-heading">
        <span className="eyebrow">P09 · 服务端只读</span>
        <h1>历史计划</h1>
        <p>按服务端版本状态查看，不会覆盖或恢复历史版本。</p>
      </header>
      {history!.length === 0 ? (
        <section className="real-plan-empty"><History aria-hidden="true" /><h2>暂无历史计划</h2><p>当前账号还没有可追溯的计划版本。</p></section>
      ) : (
        <section className="real-plan-history" aria-label="计划版本列表">
          {history!.map((item) => (
            <article className="real-plan-history__item" key={item.id}>
              <div>
                <span className="status status--info">只读</span>
                <h2>{item.version ?? item.id}</h2>
                <p>{statusCopy(item)}</p>
              </div>
              <a className="button button--secondary" href={`/h5/plans/detail/${encodeURIComponent(item.id)}`}>
                查看 {item.id} 详情
              </a>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function PlanLoadingState() {
  return <div className="real-plan-page real-plan-loading" role="status"><Clock3 aria-hidden="true" /><span>正在读取计划状态</span></div>;
}

function PendingPlan({ result, submitting, onAction }: {
  result: PendingPlanResult;
  submitting: boolean;
  onAction: (version: string, type: PlanTransitionType) => void;
}) {
  if (result.businessStatus === 'NO_PENDING_PLAN') {
    return (
      <div className="real-plan-page">
        <section className="real-plan-empty">
          <Clock3 aria-hidden="true" /><span className="eyebrow">NO_PENDING_PLAN</span>
          <h1>暂无待确认计划</h1><p>当前没有需要确认或等待生效的计划版本。</p>
          <a className="button button--secondary" href="/h5/plans/current">查看当前计划</a>
        </section>
      </div>
    );
  }
  const waiting = result.businessStatus === 'PLAN_WAITING_EFFECTIVE';
  const { plan } = result;
  return (
    <div className="real-plan-page">
      <header className="real-plan-heading">
        <span className="eyebrow">{result.businessStatus}</span>
        <h1>{waiting ? '已确认，等待生效' : '待确认计划'}</h1>
        <p>版本 {plan.version}</p>
      </header>
      <section className="real-plan-callout" role="note">
        <Clock3 aria-hidden="true" /><div><strong>确认不等于立即生效</strong><span>计划仅会在服务端状态变为当前计划后用于执行。</span></div>
      </section>
      <section className="real-plan-dates" aria-label="确认与生效时间">
        <div><Clock3 aria-hidden="true" /><span>确认截止<strong>{formatDate(plan.confirmationDeadlineAt)}</strong></span></div>
        <div><CalendarDays aria-hidden="true" /><span>预计生效<strong>{formatDate(plan.effectiveAt)}</strong></span></div>
      </section>
      <section className="real-plan-confirmations" aria-label="分别确认状态">
        <PendingConfirmationRow section="diet" version={plan.version} status={plan.dietConfirmation} actions={plan.allowedActions} submitting={submitting} onAction={onAction} />
        <PendingConfirmationRow section="training" version={plan.version} status={plan.trainingConfirmation} actions={plan.allowedActions} submitting={submitting} onAction={onAction} />
      </section>
      {!waiting && <p className="real-plan-rejection-note">拒绝任一部分后，整份计划版本将退回团队处理。</p>}
    </div>
  );
}

function PendingConfirmationRow({ section, version, status, actions, submitting, onAction }: {
  section: 'diet' | 'training';
  version: string;
  status: 'PENDING' | 'CONFIRMED';
  actions: Array<'CONFIRM_DIET' | 'REJECT_DIET' | 'CONFIRM_TRAINING' | 'REJECT_TRAINING'>;
  submitting: boolean;
  onAction: (version: string, type: PlanTransitionType) => void;
}) {
  const label = section === 'diet' ? '饮食' : '训练';
  const confirmAction = section === 'diet' ? 'CONFIRM_DIET' : 'CONFIRM_TRAINING';
  const rejectAction = section === 'diet' ? 'REJECT_DIET' : 'REJECT_TRAINING';
  return (
    <article className="real-plan-confirmation-row">
      <div><span className={status === 'CONFIRMED' ? 'status status--success' : 'status status--warning'}>{status === 'CONFIRMED' ? `${label}已确认` : `${label}待确认`}</span></div>
      <div className="real-plan-confirmation-actions">
        {actions.includes(confirmAction) && <button className="button" type="button" disabled={submitting} onClick={() => onAction(version, confirmAction)}>确认{label}部分</button>}
        {actions.includes(rejectAction) && <button className="button button--secondary" type="button" disabled={submitting} onClick={() => onAction(version, rejectAction)}>拒绝{label}部分</button>}
      </div>
    </article>
  );
}

function TransitionBlockedState({ error, retry }: { error: PlanClientError; retry?: () => void }) {
  return (
    <div className="real-plan-page">
      <section className="real-plan-blocked" role="alert">
        <AlertTriangle aria-hidden="true" />
        <h1>计划操作未完成</h1>
        <p>服务端未确认本次操作，页面不会本地模拟成功。</p>
        <dl><div><dt>错误代码</dt><dd>{error.code}</dd></div>{error.requestId && <div><dt>请求标识</dt><dd>{error.requestId}</dd></div>}</dl>
        <div className="real-plan-actions">
          {retry && <button className="button" type="button" onClick={retry}>重试同一操作</button>}
          {error.recoverableActions.includes('REFRESH') && <a className="button" href="/h5/plans/pending">刷新计划状态</a>}
          {error.recoverableActions.includes('USE_NEW_IDEMPOTENCY_KEY') && <a className="button" href="/h5/plans/pending">重新发起操作</a>}
          {error.recoverableActions.includes('OPEN_PLAN_HISTORY') && <a className="button button--secondary" href="/h5/plans/history">查看历史计划</a>}
          {error.recoverableActions.includes('CREATE_NEW_VERSION') && <a className="button button--secondary" href="/h5/contact-operations">联系团队创建新版本</a>}
          {error.recoverableActions.includes('LOGIN') && <a className="button" href="/h5/login">重新登录</a>}
          {error.recoverableActions.includes('CONTACT_OPERATIONS') && <a className="button button--secondary" href="/h5/contact-operations">联系运营</a>}
        </div>
      </section>
    </div>
  );
}

function MissingSessionState() {
  return (
    <div className="real-plan-page">
      <section className="real-plan-blocked" role="alert">
        <ShieldAlert aria-hidden="true" />
        <h1>计划暂不可显示</h1>
        <p>尚未取得可信 USER accountId 与会话令牌。</p>
        <a className="button button--secondary" href="/h5/contact-operations">联系运营</a>
      </section>
    </div>
  );
}

function PlanBlockedState({ error, onRetry }: { error: PlanClientError; onRetry?: () => void }) {
  return (
    <div className="real-plan-page">
      <section className="real-plan-blocked" role="alert">
        <AlertTriangle aria-hidden="true" />
        <h1>计划暂不可显示</h1>
        <p>当前响应无法安全确认，请稍后重试或联系运营。</p>
        <dl><div><dt>错误代码</dt><dd>{error.code}</dd></div>{error.requestId && <div><dt>请求标识</dt><dd>{error.requestId}</dd></div>}</dl>
        <span className="sr-only">错误代码：{error.code}</span>
        {error.requestId && <span className="sr-only">请求标识：{error.requestId}</span>}
        <div className="real-plan-actions">
          {onRetry && <button className="button" type="button" onClick={onRetry}>重试读取</button>}
          <a className="button button--secondary" href="/h5/contact-operations">联系运营</a>
        </div>
      </section>
    </div>
  );
}

function PlanGapState() {
  return (
    <div className="real-plan-page">
      <section className="real-plan-empty">
        <Clock3 aria-hidden="true" />
        <span className="eyebrow">PLAN_GAP</span>
        <h1>暂无生效计划，团队正在处理</h1>
        <p>不会生成饮食或训练任务。</p>
        <div className="real-plan-actions"><a className="button" href="/h5/plans/history">查看历史计划</a><a className="button button--secondary" href="/h5/contact-operations">联系运营</a></div>
      </section>
    </div>
  );
}

function CurrentPlan({ plan }: { plan: PlanVersion }) {
  return (
    <div className="real-plan-page">
      <header className="real-plan-heading"><span className="eyebrow">P09 · CURRENT_PLAN</span><h1>当前计划</h1><p>仅当前生效版本可作为今日任务来源。</p></header>
      <section className="real-plan-summary">
        <CheckCircle2 aria-hidden="true" />
        <div><span>版本标识</span><strong>{plan.version ?? plan.id}</strong><small>服务端状态：{plan.status}</small></div>
      </section>
      <section className="real-plan-dates" aria-label="计划周期">
        <div><CalendarDays aria-hidden="true" /><span>生效时间<strong>{formatDate(plan.effectiveAt)}</strong></span></div>
        <div><Clock3 aria-hidden="true" /><span>结束时间<strong>{plan.effectiveTo ? formatDate(plan.effectiveTo) : '由服务端另行确定'}</strong></span></div>
      </section>
      <a className="button button--secondary" href="/h5/plans/history">查看历史计划</a>
    </div>
  );
}

function PlanDetail({ plan }: { plan: PlanVersion }) {
  return (
    <section className="real-plan-detail" aria-live="polite">
      <span className="eyebrow">只读版本</span><h2>版本详情</h2>
      <dl>
        <div><dt>版本标识</dt><dd>{plan.version ?? plan.id}</dd></div>
        <div><dt>服务端状态</dt><dd>{plan.status}</dd></div>
        <div><dt>确认截止</dt><dd>{formatDate(plan.confirmationDeadlineAt)}</dd></div>
        <div><dt>预计生效</dt><dd>{formatDate(plan.effectiveAt)}</dd></div>
      </dl>
    </section>
  );
}

function statusCopy(plan: PlanVersion): string {
  switch (plan.status) {
    case 'PENDING_CONFIRMATION':
      if (plan.dietConfirmed && !plan.trainingConfirmed) return '饮食已确认，训练待确认';
      if (!plan.dietConfirmed && plan.trainingConfirmed) return '训练已确认，饮食待确认';
      return '待确认计划，当前页面只读';
    case 'SCHEDULED': return '已双确认，等待服务端生效';
    case 'ACTIVE': return '当前生效版本';
    case 'USER_REVISION_REQUIRED': return '整版已退回，团队处理中';
    case 'CONFIRMATION_TIMED_OUT': return '确认已超时，不可继续确认';
    case 'SUPERSEDED': return '历史版本，已被后续版本替代';
    case 'STAFF_REVISION_REQUIRED': return '专业审核退回，团队处理中';
    case 'DRAFT':
    case 'IN_REVIEW':
    case 'READY_TO_PUBLISH':
      return '内部处理版本，当前页面只读';
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间格式异常';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function asPlanError(reason: unknown): PlanClientError {
  return reason instanceof PlanClientError
    ? reason
    : new PlanClientError('计划请求未完成，未取得服务端恢复动作。', 0, 'NETWORK_ERROR');
}
