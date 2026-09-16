import { describe, expect, it } from 'vitest';

import { applyMessageEvent, emptyMessageState } from './message-client-state.js';

const message = {
  messageId: 'message-opaque-1',
  readState: 'UNREAD' as const,
  targetType: 'target-type-opaque',
  targetId: 'target-id-opaque',
};

describe('message client state', () => {
  it('accepts server messages only for the same trusted subject', () => {
    const state = applyMessageEvent(emptyMessageState(), {
      type: 'MESSAGES_AVAILABLE', trustedSubjectId: 'user-1', messages: [message],
    });
    expect(state.messages).toEqual([message]);
    expect(applyMessageEvent(state, {
      type: 'MESSAGES_AVAILABLE', trustedSubjectId: 'user-2', messages: [message],
    })).toEqual(emptyMessageState());
  });

  it('marks a matching message read and stores only its server-reread target', () => {
    const listed = applyMessageEvent(emptyMessageState(), {
      type: 'MESSAGES_AVAILABLE', trustedSubjectId: 'user-1', messages: [message],
    });
    const read = applyMessageEvent(listed, {
      type: 'MESSAGE_READ_ACCEPTED', trustedSubjectId: 'user-1',
      message: { messageId: message.messageId, readState: 'READ' },
    });
    const opened = applyMessageEvent(read, {
      type: 'MESSAGE_TARGET_AVAILABLE', trustedSubjectId: 'user-1', messageId: message.messageId,
      target: { targetType: message.targetType, targetId: message.targetId },
    });
    expect(opened.messages[0]?.readState).toBe('READ');
    expect(opened.selectedTarget).toEqual({ targetType: message.targetType, targetId: message.targetId });
  });

  it.each([
    ['invalid response', { type: 'CLEAR_ALL' as const, code: 'MESSAGE_RESPONSE_INVALID' }],
    ['expired target', { type: 'CLEAR_ALL' as const, code: 'MESSAGE_TARGET_EXPIRED' }],
    ['unauthorized target', { type: 'CLEAR_ALL' as const, code: 'MESSAGE_TARGET_NOT_AUTHORIZED' }],
    ['changed subject', { type: 'MESSAGE_TARGET_AVAILABLE' as const, trustedSubjectId: 'user-2', messageId: message.messageId, target: { targetType: message.targetType, targetId: message.targetId } }],
  ])('clears all state for %s', (_case, event) => {
    const listed = applyMessageEvent(emptyMessageState(), {
      type: 'MESSAGES_AVAILABLE', trustedSubjectId: 'user-1', messages: [message],
    });
    expect(applyMessageEvent(listed, event as never)).toEqual(emptyMessageState());
  });
});
