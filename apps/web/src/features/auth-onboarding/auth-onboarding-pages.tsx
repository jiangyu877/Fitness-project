import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { demoSafety } from '../phase3/phase3-model.js';
import { createIdentityClient, IdentityError, type IdentityClient, type NextAction } from '../identity/identity-client.js';
import { identityPathForNextAction } from '../identity/identity-next-action-page.js';

export const defaultIdentityClient = createIdentityClient();

export type AuthOnboardingKind =
  | 'invited-login'
  | 'change-password'
  | 'consent'
  | 'screening'
  | 'profile'
  | 'preparation'
  | 'staff-login'
  | 'contact-operations';

export function pathForNextAction(nextAction: string | undefined): string {
  return (nextAction ? identityPathForNextAction(nextAction as NextAction) : undefined) ?? '/h5/identity/contact-operations';
}

function messageFor(error: unknown): string {
  if (!(error instanceof IdentityError)) return '网络连接不可用，请检查连接后重试。';
  if (error.status === 401) return '登录或首次改密会话已失效，请重新登录。';
  if (error.status === 409) return '当前版本已变化，请联系运营后重新开始。';
  if (error.status === 423) return '账号当前不可用，请联系运营。';
  if (error.status === 503) return '服务暂不可用，请稍后重试。';
  return '身份请求未完成，请稍后重试。';
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="generic-page auth-flow">
      <div className="demo-notice" role="note">
        仅用于原型演示，未经专业审核 · demoOnly={String(demoSafety.demoOnly)} ·
        reviewStatus={demoSafety.reviewStatus} · publishable={String(demoSafety.publishable)}
      </div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

function InvitedLogin({ identityClient, onSessionCreated }: { identityClient: IdentityClient; onSessionCreated?: () => Promise<void> }) {
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) summaryRef.current?.focus(); }, [error]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await identityClient.createSession({ loginId, password });
      if (result.kind === 'session-created') await onSessionCreated?.();
      navigate(pathForNextAction(result.nextAction), { replace: true });
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title="受邀登录">
      <div role="status" className="state-panel">会话可恢复：使用受邀账号继续服务流程。</div>
      {error && <div ref={summaryRef} tabIndex={-1} role="alert" aria-live="assertive">{error}</div>}
      <form onSubmit={submit}>
        <label>受邀账号<input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" required /></label>
        <label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
        <button className="button" disabled={submitting}>{submitting ? '登录中' : '登录'}</button>
      </form>
      <Link to="/h5/identity/contact-operations">联系运营</Link>
    </Page>
  );
}

function ChangePassword({ identityClient, onSessionCreated }: { identityClient: IdentityClient; onSessionCreated?: () => Promise<void> }) {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) summaryRef.current?.focus(); }, [error]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!newPassword || !confirmation) return setError('请检查：新密码与确认密码均为必填。');
    if (newPassword !== confirmation) return setError('请检查：新密码与确认新密码必须一致。');
    setError(undefined);
    setSubmitting(true);
    try {
      const context = identityClient.getRestrictedContext();
      const result = await identityClient.changeInitialPassword({ newPassword, expectedVersion: context?.expectedVersion ?? 0 });
      await onSessionCreated?.();
      navigate(pathForNextAction(result.nextAction), { replace: true });
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Page title="首次修改密码">
      {error && <div ref={summaryRef} tabIndex={-1} role="alert" aria-live="assertive">{error}</div>}
      <form onSubmit={submit}>
        <label>新密码<input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" /></label>
        <label>确认新密码<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} type="password" autoComplete="new-password" /></label>
        <button className="button" disabled={submitting}>{submitting ? '保存中' : '保存新密码'}</button>
      </form>
      <Link to="/h5/identity/contact-operations">无法完成首次改密？联系运营</Link>
    </Page>
  );
}

function ContactOperations({ identityClient }: { identityClient: IdentityClient }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) summaryRef.current?.focus(); }, [error]);
  async function logout() {
    setError(undefined);
    try {
      await identityClient.logout();
      navigate('/h5/login', { replace: true });
    } catch (logoutError) {
      setError(messageFor(logoutError));
    }
  }
  return <Page title="联系运营"><div className="state-panel" role="status">当前账号或流程需要人工处理，请联系运营人员。</div>{error && <div ref={summaryRef} tabIndex={-1} role="alert" aria-live="assertive">{error}</div>}<button className="button button--secondary" onClick={() => void logout()}>退出登录</button></Page>;
}

function Consent() {
  const [accepted, setAccepted] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Page title="知情说明与授权">
      <strong>说明版本 v1.0-demo</strong>
      {failed && <div role="alert">说明加载失败，已禁止提交同意。</div>}
      <label><input type="checkbox" disabled={failed} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />我已阅读当前版本</label>
      <button className="button" disabled={failed || !accepted}>明确同意</button>
      <button className="button button--secondary">退出流程</button>
      <button className="button button--secondary" onClick={() => setFailed(true)}>演示加载失败</button>
    </Page>
  );
}

function Screening() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <Page title="健康风险筛查">
      <fieldset aria-label="筛查问卷字段骨架">
        <legend>已批准字段结构占位</legend>
        <label><input type="checkbox" />既往健康资料（演示字段）</label>
        <label><input type="checkbox" />当前不适资料（演示字段）</label>
      </fieldset>
      <button className="button" onClick={() => setSubmitted(true)}>提交问卷骨架</button>
      {submitted && <div className="state-panel" role="status"><strong>系统结果：HUMAN_REVIEW</strong><p>只读系统结果；等待人工复核，不提供诊断。</p></div>}
    </Page>
  );
}

function Profile() {
  const [experience, setExperience] = useState('');
  const [checked, setChecked] = useState(false);
  return (
    <Page title="分阶段建档">
      {checked && <div role="alert" tabIndex={-1}>请补充目标体重；训练频率存在矛盾，请核对。</div>}
      <p>步骤 2/3 · 基础情况与训练经验</p>
      <label>训练经验<input value={experience} onChange={(event) => setExperience(event.target.value)} /></label>
      <button className="button button--secondary" onClick={() => setExperience('6个月')}>恢复演示草稿</button>
      <button className="button" onClick={() => setChecked(true)}>检查并保存</button>
    </Page>
  );
}

function Preparation() {
  return (
    <Page title="计划准备时间线">
      <ol aria-label="计划准备时间线"><li>授权已记录</li><li>筛查已提交</li><li><strong>人工复核中</strong></li><li>计划尚未生成</li></ol>
      <p>关联流程已阻断，等待结论或补充资料。</p>
      <Link to="/h5/messages">联系运营</Link>
    </Page>
  );
}

function StaffLogin() {
  const gates = [
    'DEMO_MODE_ACTIVE',
    'PROFESSIONAL_RULES_UNAPPROVED',
    'AUTH_SECURITY_POLICY_UNAPPROVED',
    'PRIVACY_REVIEW_UNAPPROVED',
    'DATA_RIGHTS_DRILL_INCOMPLETE',
    'BACKUP_RESTORE_DRILL_INCOMPLETE',
    'OPERATIONS_READINESS_INCOMPLETE',
    'DEPLOYMENT_SECURITY_UNAPPROVED',
  ];
  return (
    <Page title="员工登录">
      <label>员工账号<input autoComplete="username" /></label>
      <label>密码<input type="password" autoComplete="current-password" /></label>
      <p>当前角色：运营人员（演示）</p>
      <p>MFA 实施参数待安全评审</p>
      <ul aria-label="真人服务门禁">{gates.map((gate) => <li key={gate}>{gate}</li>)}</ul>
      <button className="button" disabled>真人入口不可用</button>
    </Page>
  );
}

export function AuthOnboardingPage({ kind, identityClient = defaultIdentityClient, onSessionCreated }: {
  kind: AuthOnboardingKind;
  identityClient?: IdentityClient;
  onSessionCreated?: () => Promise<void>;
}) {
  switch (kind) {
    case 'invited-login': return <InvitedLogin identityClient={identityClient} {...(onSessionCreated ? { onSessionCreated } : {})} />;
    case 'change-password': return <ChangePassword identityClient={identityClient} {...(onSessionCreated ? { onSessionCreated } : {})} />;
    case 'consent': return <Consent />;
    case 'screening': return <Screening />;
    case 'profile': return <Profile />;
    case 'preparation': return <Preparation />;
    case 'staff-login': return <StaffLogin />;
    case 'contact-operations': return <ContactOperations identityClient={identityClient} />;
  }
}
