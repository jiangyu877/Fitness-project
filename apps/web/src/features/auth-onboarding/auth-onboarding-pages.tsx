import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { demoSafety } from '../phase3/phase3-model.js';

export type AuthOnboardingKind =
  | 'invited-login'
  | 'change-password'
  | 'consent'
  | 'screening'
  | 'profile'
  | 'preparation'
  | 'staff-login';

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

function InvitedLogin() {
  return (
    <Page title="受邀登录">
      <div role="status" className="state-panel">会话可恢复：授权步骤尚未完成</div>
      <label>受邀账号<input autoComplete="username" /></label>
      <label>密码<input type="password" autoComplete="current-password" /></label>
      <button className="button">登录演示账号</button>
    </Page>
  );
}

function ChangePassword() {
  const [invalid, setInvalid] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (invalid) summaryRef.current?.focus(); }, [invalid]);
  return (
    <Page title="首次修改密码">
      {invalid && <div ref={summaryRef} tabIndex={-1} role="alert">请检查：新密码与确认密码均为必填。</div>}
      <label>新密码<input type="password" autoComplete="new-password" /></label>
      <label>确认新密码<input type="password" autoComplete="new-password" /></label>
      <button className="button" onClick={() => setInvalid(true)}>保存新密码</button>
    </Page>
  );
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

export function AuthOnboardingPage({ kind }: { kind: AuthOnboardingKind }) {
  switch (kind) {
    case 'invited-login': return <InvitedLogin />;
    case 'change-password': return <ChangePassword />;
    case 'consent': return <Consent />;
    case 'screening': return <Screening />;
    case 'profile': return <Profile />;
    case 'preparation': return <Preparation />;
    case 'staff-login': return <StaffLogin />;
  }
}
