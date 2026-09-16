import { parseMessageList, parseMessageRead, parseMessageTarget, type MessageRead, type MessageRecord, type MessageTarget } from './message-parser.js';

export type MessageSession = { accountId: string; token: string };
export type MessageTransport = {
  list(session: MessageSession): Promise<unknown>;
  markRead(session: MessageSession, messageId: string): Promise<unknown>;
  readTarget(session: MessageSession, message: MessageRecord): Promise<unknown>;
};

export class MessageClientError extends Error {
  constructor(readonly code: string, readonly clientStateDisposition: 'CLEAR_ALL' = 'CLEAR_ALL') {
    super('Message response cannot be consumed safely.');
    this.name = 'MessageClientError';
  }
}

function requireSession(session: MessageSession): void {
  if (!session.accountId.trim() || !session.token.trim()) throw new MessageClientError('MESSAGE_SESSION_INVALID');
}

export function createMessageClient(transport: MessageTransport) {
  return {
    async list(session: MessageSession): Promise<MessageRecord[]> {
      requireSession(session);
      try { return parseMessageList(await transport.list(session)); } catch (error) {
        if (error instanceof MessageClientError) throw error;
        throw new MessageClientError('MESSAGE_RESPONSE_INVALID');
      }
    },
    async markRead(session: MessageSession, messageId: string): Promise<MessageRead> {
      requireSession(session);
      try { return parseMessageRead(await transport.markRead(session, messageId)); } catch (error) {
        if (error instanceof MessageClientError) throw error;
        throw new MessageClientError('MESSAGE_RESPONSE_INVALID');
      }
    },
    async readTarget(session: MessageSession, message: MessageRecord): Promise<MessageTarget> {
      requireSession(session);
      try { return parseMessageTarget(await transport.readTarget(session, message)); } catch (error) {
        if (error instanceof MessageClientError) throw error;
        throw new MessageClientError('MESSAGE_TARGET_NOT_AUTHORIZED');
      }
    },
  };
}

export type MessageClient = ReturnType<typeof createMessageClient>;
