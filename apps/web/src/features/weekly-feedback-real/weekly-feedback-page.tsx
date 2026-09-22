import {
  deriveWeeklyFeedbackState, parseWeeklyFeedbackView, type WeeklyFeedbackDisplayState,
} from './weekly-feedback-view.js';

type Props = { view: unknown; onSubmit?: (outcome: string) => void };

export function WeeklyFeedbackPage({ view, onSubmit }: Props) {
  let state: WeeklyFeedbackDisplayState;
  try {
    state = deriveWeeklyFeedbackState(parseWeeklyFeedbackView(view));
  } catch {
    return <div className="generic-page generic-page--h5" data-testid="weekly-feedback-blocked" role="alert">
      <h1>周反馈</h1>
      <output data-testid="weekly-feedback-error-code">WEEKLY_FEEDBACK_VIEW_INVALID</output>
    </div>;
  }

  const formOpen = state.status === 'FORM_OPEN' || state.status === 'INSUFFICIENT_DATA';
  return <div className="generic-page generic-page--h5" data-testid="weekly-feedback">
    <h1>周反馈</h1>
    {state.status === 'WINDOW_CLOSED'
      && <output data-testid="weekly-feedback-next-window">{state.nextWindowAt}</output>}
    {state.status === 'RISK_HANDOFF'
      && <div data-testid="weekly-feedback-risk" role="alert">疼痛进入人工风险处理</div>}
    {state.status === 'ADJUSTMENT_PENDING'
      && <output data-testid="weekly-feedback-pending">进入调整等待状态</output>}
    {state.status === 'INSUFFICIENT_DATA'
      && <div data-testid="weekly-feedback-insufficient">数据不足时保持当前方案</div>}
    {formOpen && <form onSubmit={(event) => event.preventDefault()}>
      {state.fields.map((field) => <input
        className="input"
        data-testid={`weekly-feedback-field-${field.id}`}
        key={field.id}
        name={field.id}
        required={field.required}
      />)}
      {state.allowedOutcomes.map((outcome) => <button
        className="button"
        data-outcome={outcome}
        data-testid="weekly-feedback-outcome"
        key={outcome}
        onClick={() => onSubmit?.(outcome)}
        type="button"
      >提交</button>)}
    </form>}
  </div>;
}
