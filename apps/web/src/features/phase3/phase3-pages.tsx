import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import { demoSafety, phase3Model, type PlanStatus } from './phase3-model.js';

export type Phase3PageKind =
  | 'consent'
  | 'screening'
  | 'profile'
  | 'today'
  | 'diet'
  | 'training-live'
  | 'training-retro'
  | 'weekly-feedback'
  | 'safety'
  | 'messages'
  | 'data'
  | 'user'
  | 'risk'
  | 'adjustment';

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="generic-page">
      <div className="demo-notice" role="note">
        仅用于原型演示，未经专业审核 · demoOnly={String(demoSafety.demoOnly)} ·
        reviewStatus={demoSafety.reviewStatus} · publishable={String(demoSafety.publishable)}
      </div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

function ConsentPage() {
  const [accepted, setAccepted] = useState(false);
  return (
    <Frame title="知情说明与授权">
      <p>请阅读演示说明、风险边界与数据使用范围。</p>
      <label>
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        我已阅读并理解
      </label>
      <Link className="button" aria-disabled={!accepted} to={accepted ? '/h5/screening' : '#'}>
        继续筛查
      </Link>
    </Frame>
  );
}

function ScreeningPage() {
  const [result, setResult] = useState('');
  const options = [
    ['approved', '演示：通过'],
    ['human-review', '演示：进入人工复核'],
    ['stopped', '演示：停止流程'],
  ] as const;
  return (
    <Frame title="健康风险筛查">
      <p>以下按钮仅用于演示状态切换，不代表用户可自行选择专业结论，也不提供诊断。</p>
      {options.map(([value, label]) => (
        <button className="button" key={value} onClick={() => setResult(value)}>
          {label}
        </button>
      ))}
      {result && <div className="state-panel" role="status">当前演示状态：{result}</div>}
    </Frame>
  );
}

function ProfilePage() {
  return <Frame title="分阶段建档"><p>草稿可恢复，矛盾资料会阻断。</p><button className="button">保存当前步骤</button></Frame>;
}

const todayScenarios: ReadonlyArray<[PlanStatus, string]> = [
  ['pending-confirmation', '待确认'],
  ['confirmation-timeout', '确认超时'],
  ['plan-gap', '计划空档'],
  ['scheduled', '等待生效'],
  ['active', '当前生效'],
  ['risk-paused', '风险暂停'],
];

function TodayPage() {
  const [status, setStatus] = useState<PlanStatus>('pending-confirmation');
  const tasks = phase3Model.today.tasks(status);
  return (
    <Frame title="今日任务">
      <p>仅当前生效计划生成任务；等待生效仍不生成任务。</p>
      {todayScenarios.map(([value, label]) => (
        <button className="button button--secondary" key={value} onClick={() => setStatus(value)}>
          {label}
        </button>
      ))}
      <div className="state-panel" role="status">
        {tasks.length === 0 ? '当前没有可执行任务' : tasks.map((task) => <p key={task}>{task === 'diet' ? '饮食记录' : '训练逐组记录'}</p>)}
      </div>
    </Frame>
  );
}

function DietPage() {
  const [state, setState] = useState('');
  const [reason, setReason] = useState('');
  const valid = state === 'on-plan' || ((state === 'partial' || state === 'clear-deviation') && reason.trim());
  return (
    <Frame title="饮食记录">
      <select aria-label="执行状态" value={state} onChange={(event) => setState(event.target.value)}>
        <option value="">选择状态</option><option value="on-plan">按计划</option>
        <option value="partial">部分偏离</option><option value="clear-deviation">明显偏离</option>
      </select>
      {state && state !== 'on-plan' && <input aria-label="偏离原因" value={reason} onChange={(event) => setReason(event.target.value)} />}
      <button className="button" disabled={!valid}>提交记录</button>
    </Frame>
  );
}

function TrainingPage() {
  const [pain, setPain] = useState(false);
  return (
    <Frame title="训练逐组记录">
      <label><input type="checkbox" />第 1 组完成</label>
      <label><input type="checkbox" onChange={(event) => setPain(event.target.checked)} />出现疼痛</label>
      {pain && <div className="state-panel" role="alert">关联动作已暂停，进入人工处理。<Link to="/h5/safety-review">安全处理</Link></div>}
    </Frame>
  );
}

function SimplePage({ title, body }: { title: string; body: string }) {
  return <Frame title={title}><p>{body}</p><button className="button">保存演示状态</button></Frame>;
}

function WebOpsPage({ kind }: { kind: 'user' | 'risk' | 'adjustment' }) {
  const [status, setStatus] = useState('待处理');
  const titles = { user: '共享用户详情', risk: '风险与异常详情', adjustment: '周调整审核' };
  return (
    <Frame title={titles[kind]}>
      <div className="state-panel" role="status">状态：{status}</div>
      <button className="button" onClick={() => setStatus('已接单')}>接单</button>
      <button className="button button--secondary" onClick={() => setStatus('等待补充')}>请求补充</button>
      <button className="button" disabled>真人发布（禁用）</button>
    </Frame>
  );
}

export function Phase3Page({ kind }: { kind: Phase3PageKind }) {
  switch (kind) {
    case 'consent': return <ConsentPage />;
    case 'screening': return <ScreeningPage />;
    case 'profile': return <ProfilePage />;
    case 'today': return <TodayPage />;
    case 'diet': return <DietPage />;
    case 'training-live': return <TrainingPage />;
    case 'training-retro': return <SimplePage title="训练事后补录" body="冲突时不静默覆盖。" />;
    case 'weekly-feedback': return <SimplePage title="周反馈" body="提交后进入调整等待；数据不足时保持当前方案。" />;
    case 'safety': return <SimplePage title="安全阻断与人工复核" body="影响范围：关联训练。下一步：联系运营。" />;
    case 'messages': return <SimplePage title="消息中心" body="标记已读并打开任务深链。" />;
    case 'data': return <SimplePage title="数据导出与删除" body="提交导出或删除请求并查看状态。" />;
    case 'user':
    case 'risk':
    case 'adjustment':
      return <WebOpsPage kind={kind} />;
  }
}
