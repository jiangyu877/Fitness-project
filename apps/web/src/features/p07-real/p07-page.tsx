import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { P07ClientError, type CurrentConsent, type P07Client, type P07NextAction, type P07Session, type ProfileDraft, type ProfileField } from './p07-client.js';

type Props = {
  action: 'ACCEPT_CURRENT_CONSENT' | P07NextAction;
  session: P07Session | null;
  client: P07Client;
  onSessionRefresh: () => Promise<void>;
};

const stateCopy: Record<Exclude<P07NextAction, 'COMPLETE_PROFILE'>, { title: string; detail: string }> = {
  WAIT_FOR_SCREENING_RULES: { title: '筛查规则准备中', detail: '当前流程正在等待服务端批准的筛查规则。' },
  WAIT_FOR_HUMAN_REVIEW: { title: '等待专业复核', detail: '当前流程正在等待专业人员复核。' },
  STOP_SERVICE_FLOW: { title: '服务流程已停止', detail: '当前服务流程不能继续，请联系运营人员。' },
  WAIT_FOR_PLAN: { title: '计划准备中', detail: '建档已完成，计划正在由服务端流程准备。' },
};

function contactState(message = '服务端状态无法安全显示，请联系运营人员。') {
  return <div className="generic-page generic-page--h5 identity-next-action"><h1>联系运营</h1><div className="state-panel" role="alert">{message}</div><Link to="/h5/identity/contact-operations">联系运营</Link></div>;
}

export function P07Page({ action, session, client, onSessionRefresh }: Props) {
  if (!session) return contactState('尚未取得可信 USER 会话，不能继续。');
  if (action === 'ACCEPT_CURRENT_CONSENT') return <ConsentPage session={session} client={client} onSessionRefresh={onSessionRefresh} />;
  if (action === 'COMPLETE_PROFILE') return <ProfilePage session={session} client={client} onSessionRefresh={onSessionRefresh} />;
  return <ScreeningStatePage action={action} session={session} client={client} />;
}

function ProfilePage({ session, client, onSessionRefresh }: Pick<Props, 'session' | 'client' | 'onSessionRefresh'> & { session: P07Session }) {
  const [profile, setProfile] = useState<ProfileDraft>();
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [error, setError] = useState<P07ClientError>();
  const [submitting, setSubmitting] = useState(false);
  const initialized = useRef(false);
  const completionRefreshStarted = useRef(false);
  const load = useCallback(async () => {
    setError(undefined);
    setProfile(undefined);
    try {
      const next = await client.profile(session);
      setProfile(next);
      if (next.currentStep === null) {
        setValues({});
        initialized.current = true;
        if (!completionRefreshStarted.current) {
          completionRefreshStarted.current = true;
          await onSessionRefresh();
        }
        return;
      }
      if (!initialized.current) {
        setValues({ ...(next.drafts[next.currentStep] ?? {}) });
        initialized.current = true;
      }
    } catch (cause) {
      setProfile(undefined);
      setError(asP07Error(cause));
    }
  }, [client, onSessionRefresh, session]);
  useEffect(() => { void load(); }, [load]);
  if (error && !profile) return <ProfileError error={error} onRefresh={load} />;
  if (!profile) return <div className="generic-page generic-page--h5 identity-next-action" role="status">正在读取建档草稿</div>;
  if (profile.currentStep === null) {
    return <div className="generic-page generic-page--h5 identity-next-action"><h1>建档已完成</h1><div className="state-panel" role="status">正在确认服务端后续流程</div></div>;
  }
  const step = profile.steps.find((candidate) => candidate.id === profile.currentStep);
  if (!step) return contactState('服务端 profile 步骤无法安全显示。');
  async function save() {
    if (submitting) return;
    setSubmitting(true); setError(undefined);
    try {
      await client.saveProfileStep(session, step!.id, { schemaVersion: profile!.schemaVersion, expectedVersion: profile!.recordVersion, data: values });
    } catch (cause) {
      setError(asP07Error(cause));
      setSubmitting(false);
      return;
    }
    try {
      let refreshed: ProfileDraft;
      try {
        refreshed = await client.profile(session);
      } catch (cause) {
        setProfile(undefined);
        throw cause;
      }
      setProfile(refreshed);
      if (refreshed.currentStep === null) {
        setValues({});
        if (!completionRefreshStarted.current) {
          completionRefreshStarted.current = true;
          await onSessionRefresh();
        }
      } else {
        setValues({ ...(refreshed.drafts[refreshed.currentStep] ?? {}) });
        await onSessionRefresh();
      }
    } catch (cause) { setError(asP07Error(cause)); }
    finally { setSubmitting(false); }
  }
  return <div className="generic-page generic-page--h5 identity-next-action"><h1>完成建档</h1><div className="state-panel"><p>当前步骤：{step.id}</p><p>服务端版本：{profile.recordVersion}</p></div>{error && <div className="state-panel" role="alert">{error.message}</div>}<div className="p07-profile-fields">{step.fields.map((field) => <ProfileInput key={field.name} field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />)}</div><button className="button" disabled={submitting} onClick={() => void save()}>保存本步</button>{error?.recoverableActions.includes('REFRESH') && <button className="button button--secondary" onClick={() => void load()}>刷新服务端版本</button>}</div>;
}

function ProfileInput({ field, value, onChange }: { field: ProfileField; value: string | number | boolean | undefined; onChange: (value: string | number | boolean) => void }) {
  if (field.type === 'BOOLEAN') return <label><input aria-label={field.name} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /> {field.name}</label>;
  return <label>{field.name}<input aria-label={field.name} type={field.type === 'NUMBER' ? 'number' : 'text'} value={typeof value === 'boolean' ? '' : value ?? ''} onChange={(event) => onChange(field.type === 'NUMBER' ? Number(event.target.value) : event.target.value)} /></label>;
}

function ProfileError({ error, onRefresh }: { error: P07ClientError; onRefresh: () => Promise<void> }) {
  const refresh = error.recoverableActions.includes('REFRESH');
  return <div className="generic-page generic-page--h5 identity-next-action"><h1>建档暂不可继续</h1><div className="state-panel" role="alert">{error.message}</div>{refresh && <button className="button" onClick={() => void onRefresh()}>刷新服务端版本</button>}<Link to="/h5/identity/contact-operations">联系运营</Link></div>;
}

function ConsentPage({ session, client, onSessionRefresh }: Pick<Props, 'session' | 'client' | 'onSessionRefresh'> & { session: P07Session }) {
  const [consent, setConsent] = useState<CurrentConsent>();
  const [error, setError] = useState<P07ClientError>();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(undefined);
    setConsent(undefined);
    try { setConsent(await client.currentConsent(session)); }
    catch (cause) { setError(asP07Error(cause)); }
  }, [client, session]);

  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorState error={error} onReload={load} />;
  if (!consent) return <div className="generic-page generic-page--h5 identity-next-action" role="status">正在读取当前授权内容</div>;

  async function accept() {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await client.acceptConsent(session, consent!.consentVersion);
      await onSessionRefresh();
    } catch (cause) {
      setError(asP07Error(cause));
      setSubmitting(false);
    }
  }

  return <div className="generic-page generic-page--h5 identity-next-action">
    <h1>当前授权内容</h1>
    <div className="state-panel"><p>{consent.content.text}</p></div>
    <label><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /> 我已阅读并明确同意当前授权内容</label>
    <button className="button" disabled={!agreed || submitting} onClick={() => void accept()}>明确同意</button>
  </div>;
}

function ScreeningStatePage({ action, session, client }: { action: Exclude<P07NextAction, 'COMPLETE_PROFILE'>; session: P07Session; client: P07Client }) {
  const [state, setState] = useState<'loading' | 'invalid' | 'ready'>('loading');
  const [error, setError] = useState<P07ClientError>();
  const load = useCallback(async () => {
    setState('loading'); setError(undefined);
    try {
      const result = await client.screeningStatus(session);
      setState(result.nextAction === action ? 'ready' : 'invalid');
    } catch (cause) { setError(asP07Error(cause)); }
  }, [action, client, session]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorState error={error} onReload={load} />;
  if (state === 'loading') return <div className="generic-page generic-page--h5 identity-next-action" role="status">正在读取服务端流程状态</div>;
  if (state === 'invalid') return contactState();
  const copy = stateCopy[action];
  return <div className="generic-page generic-page--h5 identity-next-action"><h1>{copy.title}</h1><div className="state-panel" role="status">{copy.detail}</div><Link to="/h5/identity/contact-operations">联系运营</Link></div>;
}

function ErrorState({ error, onReload }: { error: P07ClientError; onReload: () => Promise<void> }) {
  const retry = error.recoverableActions.includes('RETRY');
  const refresh = error.recoverableActions.includes('REFRESH');
  return <div className="generic-page generic-page--h5 identity-next-action"><h1>当前流程暂不可继续</h1><div className="state-panel" role="alert">{error.message}</div>{retry && <button className="button" onClick={() => void onReload()}>重试</button>}{refresh && <button className="button" onClick={() => void onReload()}>刷新</button>}<Link to="/h5/identity/contact-operations">联系运营</Link></div>;
}

function asP07Error(error: unknown): P07ClientError {
  return error instanceof P07ClientError ? error : new P07ClientError('P07 服务响应无法安全显示。', 502, 'P07_RESPONSE_INVALID', ['CONTACT_OPERATIONS']);
}
