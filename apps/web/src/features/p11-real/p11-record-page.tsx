import { useEffect, useRef, useState } from 'react';

import { applyRecordClientDisposition, type RecordClientState } from './p11-client-state.js';
import { P11ClientError, type P11Client, type P11Session, type RecordCommand } from './p11-client.js';
import type { RecordContext } from './p11-parser.js';

type Props = {
  taskId: string;
  session: P11Session | null;
  client: P11Client;
};

function initialState(session: P11Session | null, taskId: string): RecordClientState {
  return {
    trustedSubjectId: session?.accountId ?? null,
    taskId: session ? taskId : null,
    recordTarget: null,
    recordData: null,
    unsavedInput: null,
    conflictDraft: null,
    editor: null,
    visibleRecoverableActions: [],
  };
}

function asP11Error(cause: unknown): P11ClientError {
  return cause instanceof P11ClientError
    ? cause
    : new P11ClientError('P11 request did not complete safely.', 0, 'NETWORK_ERROR');
}

export function P11RecordPage({ taskId, session, client }: Props) {
  const [context, setContext] = useState<RecordContext>();
  const [error, setError] = useState<P11ClientError>();
  const [clientState, setClientState] = useState(() => initialState(session, taskId));
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [writeStatus, setWriteStatus] = useState<string>();
  const requestGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    requestGeneration.current += 1;
    setContext(undefined);
    setError(undefined);
    setDraft({});
    setSubmitting(false);
    setWriteStatus(undefined);
    setClientState(initialState(session, taskId));

    if (!session) {
      setError(new P11ClientError('P11 session is not trusted.', 401, 'P11_SESSION_REQUIRED'));
      return () => { active = false; };
    }

    if (!taskId.trim()) {
      const nextError = new P11ClientError('P11 task locator is missing.', 400, 'P11_TASK_ID_REQUIRED');
      setError(nextError);
      setClientState((current) => applyRecordClientDisposition(current, {
        errorCode: nextError.code,
        clientStateDisposition: nextError.clientStateDisposition,
        trustedSubjectId: session.accountId,
        taskId,
        recoverableActions: [],
      }));
      return () => { active = false; };
    }

    void client.getContext(session, taskId).then((nextContext) => {
      if (!active) return;
      setContext(nextContext);
      setClientState({
        ...initialState(session, taskId),
        recordData: nextContext.records,
      });
      setDraft(draftFromContext(nextContext));
    }).catch((cause: unknown) => {
      if (!active) return;
      const nextError = asP11Error(cause);
      setError(nextError);
      setClientState((current) => applyRecordClientDisposition(current, {
        errorCode: nextError.code,
        clientStateDisposition: nextError.clientStateDisposition,
        trustedSubjectId: session.accountId,
        taskId,
        recoverableActions: nextError.recoverableActions,
      }));
    });

    return () => { active = false; };
  }, [client, session?.accountId, session?.token, taskId]);

  async function submit(): Promise<void> {
    if (!session || !context) return;
    const recordKind = writableRecordKind(context);
    if (!recordKind) return;
    const command = commandFromDraft(context, recordKind, draft);
    if (!command) return;
    const generation = requestGeneration.current;
    setSubmitting(true);
    setError(undefined);
    setWriteStatus('RECORD_WRITE_SUBMITTING');
    try {
      const result = await client.upsertRecord(session, taskId, command);
      if (generation !== requestGeneration.current) return;
      setClientState((current) => applyRecordClientDisposition(current, {
        businessStatus: result.businessStatus,
        nextAction: result.nextAction,
        recoverableActions: result.recoverableActions,
      }));
      const refreshed = await client.getContext(session, taskId);
      if (generation !== requestGeneration.current) return;
      assertAuthoritativeWrite(refreshed, taskId, command, result);
      setContext(refreshed);
      setClientState({ ...initialState(session, taskId), recordData: refreshed.records });
      setDraft(draftFromContext(refreshed));
      setWriteStatus('RECORD_CONTEXT_REFRESHED');
    } catch (cause: unknown) {
      if (generation !== requestGeneration.current) return;
      const nextError = asP11Error(cause);
      setError(nextError);
      setWriteStatus(undefined);
      if (nextError.code === 'RECORD_STATE_BLOCKED' && nextError.clientStateDisposition === 'DISABLE_EDITOR') {
        setDraft(draftFromContext(context));
      }
      setClientState((current) => applyRecordClientDisposition(current, {
        errorCode: nextError.code,
        clientStateDisposition: nextError.clientStateDisposition,
        trustedSubjectId: session.accountId,
        taskId,
        recoverableActions: nextError.recoverableActions,
      }));
    } finally {
      if (generation === requestGeneration.current) setSubmitting(false);
    }
  }

  if (error && (!context || error.clientStateDisposition !== 'DISABLE_EDITOR')) {
    return (
      <div className="generic-page generic-page--h5" data-testid="p11-record-context-blocked" role="alert">
        <output data-testid="p11-context-error-code">{error.code}</output>
        <output data-testid="p11-context-disposition">{error.clientStateDisposition}</output>
        <output data-testid="p11-context-cleared">{clientState.trustedSubjectId === null ? 'true' : 'false'}</output>
      </div>
    );
  }

  if (!context) {
    return <div className="generic-page generic-page--h5" data-testid="p11-record-context-loading" role="status">P11_CONTEXT_LOADING</div>;
  }

  const recordKind = writableRecordKind(context);
  const command = recordKind ? commandFromDraft(context, recordKind, draft) : undefined;
  const editorDisabled = submitting || clientState.editor?.enabled === false;

  return (
    <div className="generic-page generic-page--h5" data-testid="p11-record-context">
      <output data-testid="p11-context-status">{context.businessStatus}</output>
      <output data-testid="p11-context-task">{context.taskId}</output>
      <output data-testid="p11-context-schema">{context.schema.version}</output>
      <output data-testid="p11-context-access">{context.accessMode}</output>
      <output data-testid="p11-context-record-count">{Array.isArray(clientState.recordData) ? clientState.recordData.length : 0}</output>
      {error && <div data-testid="p11-context-inline-error" role="alert">
        <output data-testid="p11-context-error-code">{error.code}</output>
        <output data-testid="p11-context-disposition">{error.clientStateDisposition}</output>
      </div>}
      {recordKind && recordKind.fields.length > 0 && (
        <form data-testid="p11-record-editor" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {recordKind.fields.map((field) => {
            const value = draft[field.id];
            if (field.valueType === 'BOOLEAN') {
              return <label key={field.id}><span>{field.id}</span><input
                aria-label={field.id}
                type="checkbox"
                checked={value === true}
                disabled={editorDisabled}
                onChange={(event) => setDraft((current) => ({ ...current, [field.id]: event.target.checked }))}
              /></label>;
            }
            return <label key={field.id}><span>{field.id}</span><input
              aria-label={field.id}
              type={field.valueType === 'NUMBER' ? 'number' : 'text'}
              value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
              required={field.required === true}
              disabled={editorDisabled}
              onChange={(event) => setDraft((current) => ({
                ...current,
                [field.id]: field.valueType === 'NUMBER'
                  ? (event.target.value.trim() ? Number(event.target.value) : '')
                  : event.target.value,
              }))}
            /></label>;
          })}
          <button className="button" type="submit" disabled={editorDisabled || !command}>提交测试记录</button>
        </form>
      )}
      {writeStatus && <output data-testid="p11-record-write-status" role="status">{writeStatus}</output>}
    </div>
  );
}

function writableRecordKind(context: RecordContext): RecordContext['schema']['recordKinds'][number] | undefined {
  if (context.accessMode !== 'EDITABLE' || context.schema.testOnly !== true) return undefined;
  return context.schema.recordKinds.find((kind) => kind.allowedActions.includes('UPSERT_RECORD'));
}

function draftFromContext(context: RecordContext): Record<string, string | number | boolean> {
  const kind = writableRecordKind(context);
  if (!kind) return {};
  const record = context.records.find((candidate) => candidate.recordKindId === kind.id);
  const values: Record<string, string | number | boolean> = {};
  for (const field of kind.fields) {
    const entry = record?.entries.find((candidate) => candidate.fieldId === field.id);
    if (entry) values[field.id] = entry.value;
    else if (field.valueType === 'BOOLEAN') values[field.id] = false;
    else values[field.id] = '';
  }
  return values;
}

function commandFromDraft(
  context: RecordContext,
  kind: RecordContext['schema']['recordKinds'][number],
  draft: Record<string, string | number | boolean>,
): RecordCommand | undefined {
  const entries = kind.fields.map((field) => {
    const value = draft[field.id];
    if (field.valueType === 'STRING' && typeof value === 'string'
      && (field.required !== true || value.trim().length > 0)) {
      return { fieldId: field.id, value };
    }
    if (field.valueType === 'NUMBER' && typeof value === 'number' && Number.isFinite(value)) {
      return { fieldId: field.id, value };
    }
    if (field.valueType === 'BOOLEAN' && typeof value === 'boolean') {
      return { fieldId: field.id, value };
    }
    return undefined;
  });
  if (entries.some((entry) => entry === undefined)) return undefined;
  const existing = context.records.find((record) => record.recordKindId === kind.id);
  return {
    operation: 'UPSERT_RECORD',
    recordKindId: kind.id,
    schemaVersion: context.schema.version,
    expectedRecordVersion: existing?.recordVersion ?? null,
    entries: entries as Array<{ fieldId: string; value: string | number | boolean }>,
  };
}

function assertAuthoritativeWrite(
  context: RecordContext,
  taskId: string,
  command: RecordCommand,
  result: { recordVersion: number; schemaVersion: string },
): void {
  if (context.taskId !== taskId
    || result.schemaVersion !== command.schemaVersion
    || context.schema.version !== result.schemaVersion) {
    throw new P11ClientError('P11 authoritative context does not match the write.', 502, 'RECORD_RESPONSE_INVALID');
  }
  const record = context.records.find((candidate) => candidate.recordKindId === command.recordKindId);
  if (!record || record.recordVersion !== result.recordVersion || record.schemaVersion !== result.schemaVersion
    || record.entries.length !== command.entries.length
    || command.entries.some((entry) => !record.entries.some((candidate) => candidate.fieldId === entry.fieldId && candidate.value === entry.value))) {
    throw new P11ClientError('P11 authoritative context does not match the write.', 502, 'RECORD_RESPONSE_INVALID');
  }
}

export function P11RecordTestOnlyBlockedPage() {
  return (
    <div className="generic-page generic-page--h5" data-testid="p11-record-context-test-only" role="alert">
      <output data-testid="p11-context-error-code">P11_TEST_ONLY</output>
      <output data-testid="p11-context-disposition">CLEAR_ALL</output>
    </div>
  );
}
