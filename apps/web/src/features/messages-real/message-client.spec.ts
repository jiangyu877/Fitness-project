import { describe, expect, it, vi } from 'vitest';

import { createMessageClient } from './message-client.js';

const session = { accountId: 'user-1', token: 'session-token' };
const message = { messageId: 'message-1', readState: 'UNREAD' as const, targetType: 'type-opaque', targetId: 'id-opaque' };

describe('message client', () => {
  it('parses list, idempotent read, and server target reread responses', async () => {
    const transport = {
      list: vi.fn().mockResolvedValue({ messages: [message] }),
      markRead: vi.fn().mockResolvedValue({ messageId: message.messageId, readState: 'READ' }),
      readTarget: vi.fn().mockResolvedValue({ targetType: message.targetType, targetId: message.targetId }),
    };
    const client = createMessageClient(transport);
    await expect(client.list(session)).resolves.toEqual([message]);
    await expect(client.markRead(session, message.messageId)).resolves.toEqual({ messageId: message.messageId, readState: 'READ' });
    await expect(client.readTarget(session, message)).resolves.toEqual({ targetType: message.targetType, targetId: message.targetId });
    expect(transport.markRead).toHaveBeenCalledWith(session, message.messageId);
    expect(transport.readTarget).toHaveBeenCalledWith(session, message);
  });

  it('maps malformed transport data to a fail-closed error', async () => {
    const client = createMessageClient({
      list: vi.fn().mockResolvedValue({ messages: [{ ...message, readState: 'UNKNOWN' }] }),
      markRead: vi.fn(),
      readTarget: vi.fn(),
    });
    await expect(client.list(session)).rejects.toMatchObject({
      code: 'MESSAGE_RESPONSE_INVALID', clientStateDisposition: 'CLEAR_ALL',
    });
  });
});
