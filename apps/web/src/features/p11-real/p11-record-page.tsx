import { useEffect, useState } from 'react';

import { applyRecordClientDisposition, type RecordClientState } from './p11-client-state.js';
import { P11ClientError, type P11Client, type P11Session } from './p11-client.js';
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

  useEffect(() => {
    let active = true;
    setContext(undefined);
    setError(undefined);
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

  if (error) {
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

  return (
    <div className="generic-page generic-page--h5" data-testid="p11-record-context">
      <output data-testid="p11-context-status">{context.businessStatus}</output>
      <output data-testid="p11-context-task">{context.taskId}</output>
      <output data-testid="p11-context-schema">{context.schema.version}</output>
      <output data-testid="p11-context-access">{context.accessMode}</output>
      <output data-testid="p11-context-record-count">{Array.isArray(clientState.recordData) ? clientState.recordData.length : 0}</output>
    </div>
  );
}

export function P11RecordTestOnlyBlockedPage() {
  return (
    <div className="generic-page generic-page--h5" data-testid="p11-record-context-test-only" role="alert">
      <output data-testid="p11-context-error-code">P11_TEST_ONLY</output>
      <output data-testid="p11-context-disposition">CLEAR_ALL</output>
    </div>
  );
}
