import type { MessageRead, MessageRecord, MessageTarget } from './message-parser.js';

export type MessageState = {
  trustedSubjectId: string | null;
  messages: MessageRecord[];
  selectedTarget: MessageTarget | null;
  errorCode: string | null;
};

type MessageEvent =
  | { type: 'MESSAGES_AVAILABLE'; trustedSubjectId: string; messages: MessageRecord[] }
  | { type: 'MESSAGE_READ_ACCEPTED'; trustedSubjectId: string; message: MessageRead }
  | { type: 'MESSAGE_TARGET_AVAILABLE'; trustedSubjectId: string; messageId: string; target: MessageTarget }
  | { type: 'CLEAR_ALL'; code: string };

export function emptyMessageState(): MessageState {
  return { trustedSubjectId: null, messages: [], selectedTarget: null, errorCode: null };
}

function sameTarget(left: MessageTarget, right: MessageTarget): boolean {
  return left.targetType === right.targetType && left.targetId === right.targetId;
}

export function applyMessageEvent(state: MessageState, event: MessageEvent): MessageState {
  if (event.type === 'CLEAR_ALL') return emptyMessageState();
  if (typeof event.trustedSubjectId !== 'string' || !event.trustedSubjectId.trim()) return emptyMessageState();
  if (state.trustedSubjectId !== null && state.trustedSubjectId !== event.trustedSubjectId) return emptyMessageState();

  if (event.type === 'MESSAGES_AVAILABLE') {
    return { trustedSubjectId: event.trustedSubjectId, messages: [...event.messages], selectedTarget: null, errorCode: null };
  }

  if (state.trustedSubjectId !== event.trustedSubjectId) return emptyMessageState();
  if (event.type === 'MESSAGE_READ_ACCEPTED') {
    const index = state.messages.findIndex((message) => message.messageId === event.message.messageId);
    if (index < 0) return emptyMessageState();
    const messages = [...state.messages];
    messages[index] = { ...messages[index]!, readState: event.message.readState };
    return { ...state, messages, errorCode: null };
  }

  const message = state.messages.find((item) => item.messageId === event.messageId);
  if (!message || !sameTarget(message, event.target)) return emptyMessageState();
  return { ...state, selectedTarget: event.target, errorCode: null };
}
