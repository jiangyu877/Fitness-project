import { demoPersonas, type DemoPersona } from '../mocks/personas.js';
import './development-persona-switcher.css';

export default function DevelopmentPersonaSwitcher({
  compact = false,
  persona,
  onChange,
}: {
  compact?: boolean;
  persona: DemoPersona;
  onChange: (personaId: DemoPersona['id']) => void;
}) {
  return (
    <div className={compact ? 'persona persona--compact' : 'persona'}>
      <div className="avatar" aria-hidden="true">{persona.displayName.slice(0, 1)}</div>
      <div className="persona__copy">
        <strong>{persona.displayName}</strong>
        <span>{persona.goalLabel}</span>
      </div>
      <label className="sr-only" htmlFor={compact ? 'persona-web' : 'persona-h5'}>切换演示用户</label>
      <select
        id={compact ? 'persona-web' : 'persona-h5'}
        aria-label="切换演示用户"
        value={persona.id}
        onChange={(event) => onChange(event.target.value as DemoPersona['id'])}
      >
        {demoPersonas.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
      </select>
      <span className="status status--success">
        {persona.selectedPlanState === 'EFFECTIVE' ? '当前计划已生效' : '当前计划不可执行'}
      </span>
    </div>
  );
}
