import { describe, expect, it } from 'vitest';

import { deriveWeeklyFeedbackState, parseWeeklyFeedbackView } from './weekly-feedback-view.js';

const view = {
  windowState: 'OPEN',
  weekIndex: 2,
  sufficiency: 'SUFFICIENT',
  painState: 'CLEAR',
  submissionState: 'NONE',
  nextWindowAt: null,
  fields: [{ id: 'execution', required: true }, { id: 'bodyTrend', required: false }],
  allowedOutcomes: ['KEEP_CORE_PLAN', 'CHANGE_TRAINING_CONTENT'],
};

describe('P12 weekly feedback view contract', () => {
  it('parses a valid envelope and preserves server-provided fields and actions', () => {
    expect(parseWeeklyFeedbackView(view)).toEqual(view);
  });

  it('rejects malformed envelopes fail closed', () => {
    const { weekIndex, ...missingWeekIndex } = view;
    void weekIndex;
    for (const invalid of [
      { ...view, extra: true },
      missingWeekIndex,
      { ...view, windowState: 'LATER' },
      { ...view, sufficiency: 'MAYBE' },
      { ...view, painState: 'SORE' },
      { ...view, submissionState: 'DONE' },
      { ...view, weekIndex: 0 },
      { ...view, weekIndex: 1.5 },
      { ...view, weekIndex: '2' },
      { ...view, nextWindowAt: '2026-09-25T00:00:00.000Z' },
      { ...view, windowState: 'CLOSED', nextWindowAt: null },
      { ...view, windowState: 'CLOSED', nextWindowAt: '   ' },
      { ...view, fields: [] },
      { ...view, fields: [{ id: 'a', required: true }, { id: 'a', required: false }] },
      { ...view, fields: [{ id: '', required: true }] },
      { ...view, fields: [{ id: 'a', required: 'yes' }] },
      { ...view, fields: [{ id: 'a', required: true, extra: 1 }] },
      { ...view, allowedOutcomes: ['KEEP_CORE_PLAN', 'KEEP_CORE_PLAN'] },
      { ...view, allowedOutcomes: [7] },
      { ...view, allowedOutcomes: '' },
    ]) {
      expect(() => parseWeeklyFeedbackView(invalid)).toThrowError('WEEKLY_FEEDBACK_VIEW_INVALID');
    }
  });

  it('derives the display status with the frozen priority', () => {
    const base = parseWeeklyFeedbackView(view);
    expect(deriveWeeklyFeedbackState(base).status).toBe('FORM_OPEN');
    expect(deriveWeeklyFeedbackState({ ...base, sufficiency: 'INSUFFICIENT' }).status).toBe('INSUFFICIENT_DATA');
    expect(deriveWeeklyFeedbackState({
      ...base, windowState: 'CLOSED', nextWindowAt: '2026-09-25T00:00:00.000Z',
    }).status).toBe('WINDOW_CLOSED');
    expect(deriveWeeklyFeedbackState({ ...base, submissionState: 'ADJUSTMENT_PENDING' }).status)
      .toBe('ADJUSTMENT_PENDING');
    expect(deriveWeeklyFeedbackState({ ...base, painState: 'REPORTED' }).status).toBe('RISK_HANDOFF');
    expect(deriveWeeklyFeedbackState({
      ...base, painState: 'REPORTED', submissionState: 'ADJUSTMENT_PENDING',
      windowState: 'CLOSED', nextWindowAt: '2026-09-25T00:00:00.000Z', sufficiency: 'INSUFFICIENT',
    }).status).toBe('RISK_HANDOFF');
    expect(deriveWeeklyFeedbackState({
      ...base, submissionState: 'ADJUSTMENT_PENDING', windowState: 'CLOSED', nextWindowAt: '2026-09-25T00:00:00.000Z',
    }).status).toBe('ADJUSTMENT_PENDING');
    expect(deriveWeeklyFeedbackState({
      ...base, windowState: 'CLOSED', nextWindowAt: '2026-09-25T00:00:00.000Z', sufficiency: 'INSUFFICIENT',
    }).status).toBe('WINDOW_CLOSED');
  });

  it('forces empty actions in the three non-submittable states and passes server actions through otherwise', () => {
    const base = parseWeeklyFeedbackView(view);
    expect(deriveWeeklyFeedbackState({ ...base, painState: 'REPORTED' }).allowedOutcomes).toEqual([]);
    expect(deriveWeeklyFeedbackState({ ...base, submissionState: 'ADJUSTMENT_PENDING' }).allowedOutcomes).toEqual([]);
    expect(deriveWeeklyFeedbackState({
      ...base, windowState: 'CLOSED', nextWindowAt: '2026-09-25T00:00:00.000Z',
    }).allowedOutcomes).toEqual([]);
    expect(deriveWeeklyFeedbackState({ ...base, sufficiency: 'INSUFFICIENT' }).allowedOutcomes)
      .toEqual(view.allowedOutcomes);
    expect(deriveWeeklyFeedbackState(base).allowedOutcomes).toEqual(view.allowedOutcomes);
    expect(deriveWeeklyFeedbackState(base).fields).toEqual(view.fields);
    expect(deriveWeeklyFeedbackState({
      ...base, windowState: 'CLOSED', nextWindowAt: '2026-09-25T00:00:00.000Z',
    }).nextWindowAt).toBe('2026-09-25T00:00:00.000Z');
  });
});
