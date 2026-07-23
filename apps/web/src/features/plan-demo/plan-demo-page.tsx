import { AlertTriangle, Check, Clock3, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  loadDemoContext,
  type DemoContext,
  type FixtureId,
} from '../../api/demo-client.js';
import { prototypeDisclaimer } from '../../mocks/personas.js';
import {
  confirmPlanSection,
  createPlanScenario,
  type PlanDemoState,
  type PlanScenario,
} from './plan-state.js';

type LoadContext = (fixtureId: FixtureId) => Promise<DemoContext>;

interface PlanDemoPageProps {
  fixtureId?: FixtureId;
  loadContext?: LoadContext;
}

const stateCopy: Record<PlanScenario, { title: string; description: string }> = {
  'pending-confirmation': {
    title: '待确认计划',
    description: '饮食与训练需要分别确认，完成双确认后仍需等待生效时间。',
  },
  scheduled: {
    title: '已双确认，等待生效',
    description: '当前版本尚未生效。在生效时间前，旧计划仍按原周期执行。',
  },
  'confirmation-timeout': {
    title: '确认已超时',
    description: '该版本不能继续确认，也不会自动生效。团队将处理新版本或新的生效日期。',
  },
  'plan-gap': {
    title: '当前处于计划空档',
    description: '旧计划已到期且没有新版本生效，不生成饮食或训练任务。',
  },
  'risk-paused': {
    title: '训练任务已暂停',
    description: '仅暂停关联训练任务，饮食任务仍可继续。请等待具备资格的审核者给出恢复结论。',
  },
};

export function PlanDemoPage({
  fixtureId = 'persona_muscle_gain',
  loadContext = loadDemoContext,
}: PlanDemoPageProps) {
  const [context, setContext] = useState<DemoContext>();
  const [state, setState] = useState<PlanDemoState>(() => createPlanScenario('pending-confirmation'));

  useEffect(() => {
    let active = true;
    void loadContext(fixtureId).then((result) => {
      if (active) setContext(result);
    });
    return () => { active = false; };
  }, [fixtureId, loadContext]);

  const copy = stateCopy[state.status];
  const changeScenario = (scenario: PlanScenario) => setState(createPlanScenario(scenario));

  return (
    <div className="plan-demo-page">
      <header className="plan-demo-header">
        <span className="eyebrow">第二周演示版本 · V2</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>

      <div className="demo-notice demo-notice--strong" role="note">
        <AlertTriangle aria-hidden="true" size={17} />
        <span>{prototypeDisclaimer}</span>
      </div>

      <div className="source-row" aria-live="polite">
        <span className={context?.source === 'api' ? 'source-pill source-pill--api' : 'source-pill'}>
          {context ? (context.source === 'api' ? '已连接演示 API' : '本地安全回退') : '正在读取演示数据'}
        </span>
        <span>demoOnly=true · DEMO_UNREVIEWED · publishable=false</span>
      </div>

      <label className="scenario-control">
        <span>切换计划演示状态</span>
        <select
          aria-label="切换计划演示状态"
          value={state.status}
          onChange={(event) => changeScenario(event.target.value as PlanScenario)}
        >
          <option value="pending-confirmation">待确认</option>
          <option value="confirmation-timeout">确认超时</option>
          <option value="plan-gap">旧计划到期空档</option>
          <option value="risk-paused">风险暂停</option>
        </select>
      </label>

      {state.status === 'risk-paused' && (
        <section className="risk-banner" role="alert">
          <ShieldAlert aria-hidden="true" />
          <div><strong>训练任务已暂停</strong><span>影响范围：关联训练任务。饮食任务仍可继续。</span></div>
        </section>
      )}

      <section className="plan-window" aria-label="计划时间">
        <div><Clock3 aria-hidden="true" /><span>确认截止<strong>7月27日 20:00</strong></span></div>
        <div><Check aria-hidden="true" /><span>计划生效<strong>7月28日 00:00</strong></span></div>
      </section>

      <section className="confirmation-panel" aria-labelledby="confirmation-title">
        <div className="section-heading"><div><span className="eyebrow">分别确认</span><h2 id="confirmation-title">确认你已理解两个部分</h2></div></div>
        <ConfirmationRow
          label="饮食部分"
          description="查看目标结构、执行方式与安全说明"
          confirmed={state.confirmations.diet}
          disabled={!state.canConfirm || state.confirmations.diet}
          onConfirm={() => setState((current) => confirmPlanSection(current, 'diet'))}
        />
        <ConfirmationRow
          label="训练部分"
          description="查看训练结构、记录方式与暂停说明"
          confirmed={state.confirmations.training}
          disabled={!state.canConfirm || state.confirmations.training}
          onConfirm={() => setState((current) => confirmPlanSection(current, 'training'))}
        />
      </section>

      {state.status === 'plan-gap' && (
        <section className="empty-plan-state">
          <Clock3 aria-hidden="true" />
          <strong>不生成饮食或训练任务</strong>
          <span>你仍可查看历史计划、提交反馈或联系运营。</span>
        </section>
      )}
    </div>
  );
}

function ConfirmationRow({
  label,
  description,
  confirmed,
  disabled,
  onConfirm,
}: {
  label: '饮食部分' | '训练部分';
  description: string;
  confirmed: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="confirmation-row">
      <span className={confirmed ? 'confirmation-check is-complete' : 'confirmation-check'} aria-hidden="true"><Check /></span>
      <span className="confirmation-copy"><strong>{confirmed ? `${label.replace('部分', '')}已确认` : label}</strong><span>{description}</span></span>
      <button className="button button--small" disabled={disabled} onClick={onConfirm}>
        {confirmed ? '已确认' : `确认${label}`}
      </button>
    </div>
  );
}
