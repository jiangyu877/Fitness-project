import { describe, expect, it } from 'vitest';

import { parseMessageList, parseMessageRead, parseMessageTarget } from './message-parser.js';

const message = {
  messageId: 'message-opaque-1',
  readState: 'UNREAD',
  targetType: 'target-type-opaque',
  targetId: 'target-id-opaque',
};

describe('message parser', () => {
  it('accepts the strict list, read, and target envelopes', () => {
    expect(parseMessageList({ messages: [message] })).toEqual([message]);
    expect(parseMessageRead({ messageId: message.messageId, readState: 'READ' })).toEqual({
      messageId: message.messageId,
      readState: 'READ',
    });
    expect(parseMessageTarget({ targetType: message.targetType, targetId: message.targetId })).toEqual({
      targetType: message.targetType,
      targetId: message.targetId,
    });
  });

  it.each([
    ['unknown read state', { messages: [{ ...message, readState: 'ARCHIVED' }] }],
    ['extra list property', { messages: [message], extra: true }],
    ['extra message property', { messages: [{ ...message, subject: 'forbidden' }] }],
    ['duplicate message id', { messages: [message, message] }],
  ])('fails closed for %s', (_case, payload) => {
    expect(() => parseMessageList(payload)).toThrowError('MESSAGE_RESPONSE_INVALID');
  });

  it('rejects malformed read and target envelopes', () => {
    expect(() => parseMessageRead({ messageId: message.messageId, readState: 'UNREAD' })).toThrowError('MESSAGE_RESPONSE_INVALID');
    expect(() => parseMessageTarget({ targetType: message.targetType })).toThrowError('MESSAGE_RESPONSE_INVALID');
  });
});
