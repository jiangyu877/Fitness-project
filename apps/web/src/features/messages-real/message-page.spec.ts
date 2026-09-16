// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isMessageRequestCurrent, nextMessageRequestGeneration, P11MessagesPage, type MessageRequestContext } from './message-page.js';
import type { MessageClient } from './message-client.js';

const request: MessageRequestContext = { generation: 3, accountId: 'user-1', token: 'token-1', messageId: 'message-1' };
const message = { messageId: 'message-1', readState: 'UNREAD' as const, targetType: 'type-opaque', targetId: 'id-opaque' };
const session = { accountId: 'user-1', token: 'token-1' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

afterEach(cleanup);

describe('message page request ownership', () => {
  it('allocates a new request generation for every click', () => {
    expect(nextMessageRequestGeneration(3)).toBe(4);
  });

  it.each([
    ['same request', request],
    ['changed generation', { ...request, generation: 4 }],
    ['changed subject', { ...request, accountId: 'user-2' }],
    ['changed token', { ...request, token: 'token-2' }],
    ['changed message', { ...request, messageId: 'message-2' }],
  ])('accepts only the current request context: %s', (label, current) => {
    expect(isMessageRequestCurrent(request, current, label === 'same request')).toBe(label === 'same request');
  });
});

describe('message page request chain', () => {
  it('runs markRead before target reread and only then calls onTargetReady', async () => {
    const markRead = vi.fn().mockResolvedValue({ messageId: message.messageId, readState: 'READ' });
    const readTarget = vi.fn().mockResolvedValue({ targetType: message.targetType, targetId: message.targetId });
    const onTargetReady = vi.fn();
    const client = { list: vi.fn().mockResolvedValue([message]), markRead, readTarget } as unknown as MessageClient;
    render(React.createElement(P11MessagesPage, { session, client, onTargetReady }));
    fireEvent.click(await screen.findByRole('button', { name: '打开消息' }));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(session, message.messageId));
    await waitFor(() => expect(readTarget).toHaveBeenCalledWith(session, message));
    await waitFor(() => expect(onTargetReady).toHaveBeenCalledWith({ targetType: message.targetType, targetId: message.targetId }));
  });

  it('clears and ignores an old target when the session changes during reread', async () => {
    const target = deferred<{ targetType: string; targetId: string }>();
    const markRead = vi.fn().mockResolvedValue({ messageId: message.messageId, readState: 'READ' });
    const readTarget = vi.fn().mockReturnValue(target.promise);
    const onTargetReady = vi.fn();
    const client = { list: vi.fn().mockResolvedValue([message]), markRead, readTarget } as unknown as MessageClient;
    const view = render(React.createElement(P11MessagesPage, { session, client, onTargetReady }));
    fireEvent.click(await screen.findByRole('button', { name: '打开消息' }));
    await waitFor(() => expect(readTarget).toHaveBeenCalledTimes(1));

    view.rerender(React.createElement(P11MessagesPage, { session: { accountId: 'user-2', token: 'token-2' }, client, onTargetReady }));
    target.resolve({ targetType: message.targetType, targetId: message.targetId });

    await waitFor(() => expect(screen.queryByTestId('message-target')).not.toBeInTheDocument());
    expect(onTargetReady).not.toHaveBeenCalled();
  });
});
