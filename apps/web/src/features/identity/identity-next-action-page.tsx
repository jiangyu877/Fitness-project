import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import type { NextAction } from './identity-client.js';

const copy: Partial<Record<NextAction, { title: string; detail: string }>> = {
  ACCEPT_CURRENT_CONSENT: { title: '当前授权暂不可继续', detail: '当前授权内容尚未接入，不能继续' },
  WAIT_FOR_SCREENING_RULES: { title: '筛查暂不可继续', detail: '筛查规则尚未批准，不能继续' },
  WAIT_FOR_HUMAN_REVIEW: { title: '等待专业复核', detail: '正在等待专业复核' },
  WAIT_FOR_PLAN: { title: '计划准备中', detail: '计划正在准备中' },
  COMPLETE_SCREENING: { title: '筛查暂不可继续', detail: '筛查流程尚未接入，不能继续' },
  STOP_SERVICE_FLOW: { title: '服务流程已停止', detail: '当前服务流程已停止，请联系运营人员。' },
  COMPLETE_PROFILE: { title: '建档暂不可继续', detail: '建档流程尚未接入，不能继续' },
  VIEW_PENDING_PLAN: { title: '计划确认暂不可继续', detail: '计划确认内容尚未接入，不能继续' },
  VIEW_TODAY: { title: '当前计划暂不可继续', detail: '当前计划内容尚未接入，不能继续' },
  CONTACT_OPERATIONS: { title: '联系运营', detail: '当前账号或流程需要人工处理，请联系运营人员。' },
};

const paths: Record<Exclude<NextAction, 'CHANGE_INITIAL_PASSWORD'>, string> = {
  ACCEPT_CURRENT_CONSENT: '/h5/identity/accept-current-consent',
  WAIT_FOR_SCREENING_RULES: '/h5/identity/wait-for-screening-rules',
  COMPLETE_SCREENING: '/h5/identity/complete-screening',
  WAIT_FOR_HUMAN_REVIEW: '/h5/identity/wait-for-human-review',
  STOP_SERVICE_FLOW: '/h5/identity/stop-service-flow',
  COMPLETE_PROFILE: '/h5/identity/complete-profile',
  WAIT_FOR_PLAN: '/h5/identity/wait-for-plan',
  VIEW_PENDING_PLAN: '/h5/plans/pending',
  VIEW_TODAY: '/h5/plans/current',
  CONTACT_OPERATIONS: '/h5/identity/contact-operations',
};

export function identityPathForNextAction(nextAction: NextAction): string | undefined {
  return nextAction === 'CHANGE_INITIAL_PASSWORD' ? '/h5/change-password' : paths[nextAction];
}

export function nextActionForIdentityPath(path: string): NextAction | undefined {
  return (Object.entries(paths).find(([, candidate]) => candidate.startsWith('/h5/identity/') && candidate === path)?.[0] as NextAction | undefined);
}

export function IdentityNextActionPage({ nextAction }: { nextAction: string }) {
  const state = copy[nextAction as NextAction] ?? copy.CONTACT_OPERATIONS!;
  return (
    <div className="generic-page generic-page--h5 identity-next-action">
      <h1>{state.title}</h1>
      <div className="state-panel" role="status">{state.detail}</div>
      <Link to="/h5/identity/contact-operations">联系运营</Link>
    </div>
  );
}

export function IdentityRecoveryIssue({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => { summaryRef.current?.focus(); }, []);
  return (
    <div className="generic-page generic-page--h5 identity-next-action">
      <h1>会话恢复未完成</h1>
      <div ref={summaryRef} tabIndex={-1} role="alert" aria-live="assertive">{message}</div>
      {onRetry && <button className="button" onClick={onRetry}>重试恢复</button>}
      <Link to="/h5/identity/contact-operations">联系运营</Link>
    </div>
  );
}
