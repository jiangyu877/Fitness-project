import { useEffect, useRef, useState } from 'react';

import { applyMessageEvent, emptyMessageState, type MessageState } from './message-client-state.js';
import { MessageClientError, type MessageClient, type MessageSession } from './message-client.js';

type Props = {
  session: MessageSession | null;
  client: MessageClient;
  onTargetReady?: (target: { targetType: string; targetId: string }) => void;
};

export type MessageRequestContext = { generation: number; accountId: string; token: string; messageId: string };

export function nextMessageRequestGeneration(current: number): number {
  return current + 1;
}

export function isMessageRequestCurrent(
  request: MessageRequestContext,
  current: MessageRequestContext,
  active: boolean,
): boolean {
  return active
    && request.generation === current.generation
    && request.accountId === current.accountId
    && request.token === current.token
    && request.messageId === current.messageId;
}

export function P11MessagesPage({ session, client, onTargetReady }: Props) {
  const [state, setState] = useState<MessageState>(() => emptyMessageState());
  const [error, setError] = useState<string | null>(null);
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const currentSession = useRef(session);
  currentSession.current = session;

  useEffect(() => {
    let active = true;
    requestGeneration.current = nextMessageRequestGeneration(requestGeneration.current);
    setState(emptyMessageState());
    setError(null);
    if (!session) {
      setError('MESSAGE_SESSION_INVALID');
      return () => { active = false; };
    }
    void client.list(session).then((messages) => {
      if (!active) return;
      setState(applyMessageEvent(emptyMessageState(), { type: 'MESSAGES_AVAILABLE', trustedSubjectId: session.accountId, messages }));
    }).catch((cause: unknown) => {
      if (!active) return;
      setState(applyMessageEvent(emptyMessageState(), { type: 'CLEAR_ALL', code: cause instanceof MessageClientError ? cause.code : 'MESSAGE_RESPONSE_INVALID' }));
      setError(cause instanceof MessageClientError ? cause.code : 'MESSAGE_RESPONSE_INVALID');
    });
    return () => { active = false; };
  }, [client, session?.accountId, session?.token]);

  async function openMessage(messageId: string): Promise<void> {
    if (!session || busyMessageId) return;
    const message = state.messages.find((item) => item.messageId === messageId);
    if (!message) return;
    setBusyMessageId(messageId);
    setError(null);
    requestGeneration.current = nextMessageRequestGeneration(requestGeneration.current);
    const request: MessageRequestContext = {
      generation: requestGeneration.current,
      accountId: session.accountId,
      token: session.token,
      messageId,
    };
    const isCurrent = () => isMessageRequestCurrent(request, {
      generation: requestGeneration.current,
      accountId: currentSession.current?.accountId ?? '',
      token: currentSession.current?.token ?? '',
      messageId,
    }, true);
    try {
      const read = message.readState === 'UNREAD' ? await client.markRead(session, message.messageId) : { messageId: message.messageId, readState: 'READ' as const };
      if (!isCurrent()) {
        setState((current) => applyMessageEvent(current, { type: 'CLEAR_ALL', code: 'MESSAGE_SESSION_CHANGED' }));
        return;
      }
      setState((current) => applyMessageEvent(current, { type: 'MESSAGE_READ_ACCEPTED', trustedSubjectId: session.accountId, message: read }));
      const target = await client.readTarget(session, message);
      if (!isCurrent()) {
        setState((current) => applyMessageEvent(current, { type: 'CLEAR_ALL', code: 'MESSAGE_SESSION_CHANGED' }));
        return;
      }
      setState((current) => applyMessageEvent(current, {
        type: 'MESSAGE_TARGET_AVAILABLE', trustedSubjectId: session.accountId, messageId: message.messageId, target,
      }));
      onTargetReady?.(target);
    } catch (cause: unknown) {
      if (!isCurrent()) {
        setState((current) => applyMessageEvent(current, { type: 'CLEAR_ALL', code: 'MESSAGE_SESSION_CHANGED' }));
        return;
      }
      setState((current) => applyMessageEvent(current, {
        type: 'CLEAR_ALL', code: cause instanceof MessageClientError ? cause.code : 'MESSAGE_RESPONSE_INVALID',
      }));
      setError(cause instanceof MessageClientError ? cause.code : 'MESSAGE_RESPONSE_INVALID');
    } finally {
      setBusyMessageId(null);
    }
  }

  if (error) {
    return <div className="generic-page generic-page--h5" data-testid="message-context-blocked" role="alert">
      <h1>消息中心</h1><output data-testid="message-error-code">{error}</output>
    </div>;
  }

  return <div className="generic-page generic-page--h5" data-testid="message-center">
    <h1>消息中心</h1>
    <div data-testid="message-list">
      {state.messages.map((message) => <button
        className="button"
        data-message-id={message.messageId}
        key={message.messageId}
        disabled={busyMessageId !== null}
        onClick={() => void openMessage(message.messageId)}
      >
        打开消息
      </button>)}
    </div>
    {state.selectedTarget && <output data-testid="message-target" data-target-type={state.selectedTarget.targetType}>{state.selectedTarget.targetId}</output>}
  </div>;
}

export function P11MessagesTestOnlyBlockedPage() {
  return <div className="generic-page generic-page--h5" data-testid="message-test-only-blocked" role="alert">
    <h1>消息中心</h1>
    <output data-testid="message-error-code">MESSAGE_TEST_ONLY</output>
  </div>;
}
