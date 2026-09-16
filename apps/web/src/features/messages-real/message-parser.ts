type JsonObject = Record<string, unknown>;

export type MessageReadState = 'UNREAD' | 'READ';
export type MessageRecord = {
  messageId: string;
  readState: MessageReadState;
  targetType: string;
  targetId: string;
};
export type MessageRead = { messageId: string; readState: 'READ' };
export type MessageTarget = { targetType: string; targetId: string };

function invalid(): never {
  throw new Error('MESSAGE_RESPONSE_INVALID');
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as JsonObject;
}

function exactKeys(value: JsonObject, required: readonly string[]): void {
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !required.includes(key))) invalid();
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

function readState(value: unknown): MessageReadState {
  if (value !== 'UNREAD' && value !== 'READ') invalid();
  return value;
}

export function parseMessage(value: unknown): MessageRecord {
  const message = object(value);
  exactKeys(message, ['messageId', 'readState', 'targetType', 'targetId']);
  return {
    messageId: text(message.messageId),
    readState: readState(message.readState),
    targetType: text(message.targetType),
    targetId: text(message.targetId),
  };
}

export function parseMessageList(value: unknown): MessageRecord[] {
  const envelope = object(value);
  exactKeys(envelope, ['messages']);
  if (!Array.isArray(envelope.messages)) invalid();
  const messages = envelope.messages.map(parseMessage);
  if (new Set(messages.map((message) => message.messageId)).size !== messages.length) invalid();
  return messages;
}

export function parseMessageRead(value: unknown): MessageRead {
  const read = object(value);
  exactKeys(read, ['messageId', 'readState']);
  if (read.readState !== 'READ') invalid();
  return { messageId: text(read.messageId), readState: 'READ' };
}

export function parseMessageTarget(value: unknown): MessageTarget {
  const target = object(value);
  exactKeys(target, ['targetType', 'targetId']);
  return { targetType: text(target.targetType), targetId: text(target.targetId) };
}
