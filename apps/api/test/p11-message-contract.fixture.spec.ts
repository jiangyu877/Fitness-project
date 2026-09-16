import { describe, expect, it } from 'vitest';

type ReadState = 'UNREAD' | 'READ';

type Message = {
  messageId: string;
  readState: ReadState;
  targetType: string;
  targetId: string;
};

type TargetReadResult =
  | { ok: true; value: unknown }
  | { ok: false };

const messageContractPaths = Object.freeze({
  list: '/api/v1/messages',
  markRead: (messageId: string) => `/api/v1/messages/${messageId}/read`,
  target: (targetType: string, targetId: string) => `/api/v1/message-targets/${targetType}/${targetId}`,
});

type MessageContractFixture = {
  listMessages(subjectId?: string): { messages: Message[] };
  markRead(subjectId: string, messageId?: string):
    | { ok: true; value: { messageId: string; readState: 'READ' } }
    | { ok: false; clientStateDisposition: 'CLEAR_ALL' };
  openTarget(
    targetType: string,
    targetId: string,
    subjectId: string,
    reader: (input: { targetType: string; targetId: string; subjectId: string }) => TargetReadResult,
  ): TargetReadResult | { ok: false; clientStateDisposition: 'CLEAR_ALL' };
};

function createMessageContractFixture(
  messages: Message[],
  subjectMessages?: ReadonlyMap<string, readonly Message[]>,
): MessageContractFixture {
  const state = messages.map((message) => ({ ...message }));
  const scopedState = new Map<string, Message[]>(
    [...(subjectMessages ?? new Map<string, readonly Message[]>())].map(([subjectId, values]) => [
      subjectId, values.map((message) => ({ ...message })),
    ]),
  );
  return {
    listMessages: (subjectId) => ({
      messages: subjectId
        ? (scopedState.get(subjectId) ?? []).map((message) => ({ ...message }))
        : state.map((message) => ({ ...message })),
    }),
    markRead: (subjectId, messageId = subjectId) => {
      const scopedMessages = subjectMessages ? scopedState.get(subjectId) : state;
      const message = scopedMessages?.find((candidate) => candidate.messageId === messageId);
      if (!message) return { ok: false, clientStateDisposition: 'CLEAR_ALL' };
      message.readState = 'READ';
      return { ok: true, value: { messageId: message.messageId, readState: 'READ' } };
    },
    openTarget: (targetType, targetId, subjectId, reader) => {
      if (!targetType || !targetId || !subjectId) {
        return { ok: false, clientStateDisposition: 'CLEAR_ALL' };
      }
      if (subjectMessages) {
        const subjectMessage = scopedState.get(subjectId)?.find((message) =>
          message.targetType === targetType && message.targetId === targetId);
        if (!subjectMessage) return { ok: false, clientStateDisposition: 'CLEAR_ALL' };
      }
      const result = reader({ targetType, targetId, subjectId });
      return result.ok ? result : { ok: false, clientStateDisposition: 'CLEAR_ALL' };
    },
  };
}

describe('P11-15 message read and safe deep-link contract fixture', () => {
  it('keeps strict messages, idempotent read, server reread, and fail-closed target handling', () => {
    expect(messageContractPaths.list).toBe('/api/v1/messages');
    expect(messageContractPaths.markRead('message-opaque-1')).toBe('/api/v1/messages/message-opaque-1/read');
    expect(messageContractPaths.target('record-task', 'target-opaque-1'))
      .toBe('/api/v1/message-targets/record-task/target-opaque-1');

    const fixture = createMessageContractFixture([{
      messageId: 'message-opaque-1', readState: 'UNREAD',
      targetType: 'record-task', targetId: 'target-opaque-1',
    }]);
    const target = { status: 'server-authoritative-opaque-state' };

    expect(fixture.listMessages()).toEqual({
      messages: [{
        messageId: 'message-opaque-1', readState: 'UNREAD',
        targetType: 'record-task', targetId: 'target-opaque-1',
      }],
    });

    const firstRead = fixture.markRead('message-opaque-1');
    const repeatedRead = fixture.markRead('message-opaque-1');
    expect(firstRead).toEqual({ ok: true, value: { messageId: 'message-opaque-1', readState: 'READ' } });
    expect(repeatedRead).toEqual(firstRead);
    expect(fixture.listMessages()).toEqual({
      messages: [{
        messageId: 'message-opaque-1', readState: 'READ',
        targetType: 'record-task', targetId: 'target-opaque-1',
      }],
    });
    expect(fixture.markRead('unknown-message')).toEqual({
      ok: false, clientStateDisposition: 'CLEAR_ALL',
    });

    const readInputs: Array<{ targetType: string; targetId: string; subjectId: string }> = [];
    const reread = fixture.openTarget('record-task', 'target-opaque-1', 'subject-opaque-1', (input) => {
      readInputs.push(input);
      return { ok: true, value: target };
    });
    expect(reread).toEqual({ ok: true, value: target });
    expect(readInputs).toEqual([{
      targetType: 'record-task', targetId: 'target-opaque-1', subjectId: 'subject-opaque-1',
    }]);

    expect(fixture.openTarget('unknown', 'unknown', 'subject-opaque-1', () => ({ ok: false })))
      .toEqual({ ok: false, clientStateDisposition: 'CLEAR_ALL' });
    expect(fixture.openTarget('record-task', 'target-opaque-1', 'subject-opaque-2', () => ({ ok: false })))
      .toEqual({ ok: false, clientStateDisposition: 'CLEAR_ALL' });
  });

  it('keeps both approved persona subjects isolated under one shared message machine contract', () => {
    const fatLossMessage = {
      messageId: 'message-fat-loss-opaque', readState: 'UNREAD' as const,
      targetType: 'record-task', targetId: 'target-fat-loss-opaque',
    };
    const muscleGainMessage = {
      messageId: 'message-muscle-gain-opaque', readState: 'UNREAD' as const,
      targetType: 'record-task', targetId: 'target-muscle-gain-opaque',
    };
    const fixture = createMessageContractFixture([], new Map([
      ['persona_fat_loss', [fatLossMessage]],
      ['persona_muscle_gain', [muscleGainMessage]],
    ]));
    const readerInputs: Array<{ targetType: string; targetId: string; subjectId: string }> = [];
    const serverReader = (input: { targetType: string; targetId: string; subjectId: string }): TargetReadResult => {
      readerInputs.push(input);
      return { ok: true, value: { opaque: `${input.subjectId}:${input.targetId}` } };
    };

    expect(fixture.listMessages('persona_fat_loss')).toEqual({ messages: [fatLossMessage] });
    expect(fixture.listMessages('persona_muscle_gain')).toEqual({ messages: [muscleGainMessage] });
    expect(fixture.markRead('persona_fat_loss', fatLossMessage.messageId)).toEqual({
      ok: true, value: { messageId: fatLossMessage.messageId, readState: 'READ' },
    });
    expect(fixture.markRead('persona_muscle_gain', muscleGainMessage.messageId)).toEqual({
      ok: true, value: { messageId: muscleGainMessage.messageId, readState: 'READ' },
    });
    expect(fixture.markRead('persona_muscle_gain', muscleGainMessage.messageId)).toEqual({
      ok: true, value: { messageId: muscleGainMessage.messageId, readState: 'READ' },
    });
    expect(fixture.markRead('persona_fat_loss', fatLossMessage.messageId)).toEqual({
      ok: true, value: { messageId: fatLossMessage.messageId, readState: 'READ' },
    });
    expect(fixture.openTarget('record-task', fatLossMessage.targetId, 'persona_fat_loss', serverReader))
      .toEqual({ ok: true, value: { opaque: `persona_fat_loss:${fatLossMessage.targetId}` } });
    expect(fixture.openTarget('record-task', muscleGainMessage.targetId, 'persona_muscle_gain', serverReader))
      .toEqual({ ok: true, value: { opaque: `persona_muscle_gain:${muscleGainMessage.targetId}` } });
    expect(readerInputs).toEqual([
      { targetType: 'record-task', targetId: fatLossMessage.targetId, subjectId: 'persona_fat_loss' },
      { targetType: 'record-task', targetId: muscleGainMessage.targetId, subjectId: 'persona_muscle_gain' },
    ]);
    expect(fixture.openTarget('record-task', muscleGainMessage.targetId, 'persona_fat_loss', () => ({ ok: false })))
      .toEqual({ ok: false, clientStateDisposition: 'CLEAR_ALL' });
    expect(fixture.openTarget('unknown', 'unknown-target', 'persona_muscle_gain', () => ({ ok: false })))
      .toEqual({ ok: false, clientStateDisposition: 'CLEAR_ALL' });
  });
});
