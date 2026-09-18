import { describe, expect, it } from 'vitest';

import {
  createWeeklyFeedbackFixture, deriveWeeklyWindows, insufficientDataAllowedOutcomes,
  insufficientDataForbiddenOutcomes, optionalWeeklyFeedbackFields, requiredWeeklyFeedbackFields,
  weeklyFeedbackFieldIds, type WeeklySubmissionInput,
} from './support/p12-weekly-feedback.js';

const sufficient = () => 'SUFFICIENT' as const;
const insufficient = () => 'INSUFFICIENT' as const;

function openSubmission(overrides: Partial<WeeklySubmissionInput> = {}): WeeklySubmissionInput {
  return {
    weekIndex: 2,
    windowState: 'OPEN',
    fields: {
      execution: 'opaque-execution',
      trainingPerformance: 'opaque-training',
      sleep: 'opaque-sleep',
      energy: 'opaque-energy',
      hunger: 'opaque-hunger',
      stress: 'opaque-stress',
      recovery: 'opaque-recovery',
      pain: 'CLEAR',
    },
    facts: { recordedDays: 6 },
    requestedOutcome: 'KEEP_CORE_PLAN',
    ...overrides,
  };
}

describe('P12 weekly feedback structure contract', () => {
  it('derives up to four 7-day weekly windows of Shanghai business dates', () => {
    const weeks = deriveWeeklyWindows(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-29T00:00:00.000Z'));
    expect(weeks).toHaveLength(4);
    expect(weeks[0]).toEqual([
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07',
    ]);
    expect(weeks[3]).toEqual([
      '2026-01-22', '2026-01-23', '2026-01-24', '2026-01-25', '2026-01-26', '2026-01-27', '2026-01-28',
    ]);
    const partial = deriveWeeklyWindows(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-11T00:00:00.000Z'));
    expect(partial).toHaveLength(2);
    expect(partial[1]).toEqual(['2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11']);
  });

  it('freezes the nine weekly feedback field ids with bodyTrend as the only optional field', () => {
    expect(weeklyFeedbackFieldIds).toHaveLength(9);
    expect(requiredWeeklyFeedbackFields).toHaveLength(8);
    expect(optionalWeeklyFeedbackFields).toEqual(['bodyTrend']);
    expect([...requiredWeeklyFeedbackFields, ...optionalWeeklyFeedbackFields]).toEqual([...weeklyFeedbackFieldIds]);
  });

  it('records the adoption and enters ADJUSTMENT_PENDING on a valid submission', () => {
    const fixture = createWeeklyFeedbackFixture({ sufficiencyPolicy: sufficient });
    const result = fixture.submit(openSubmission({ requestedOutcome: 'CHANGE_TRAINING_CONTENT' }));
    expect(result).toEqual({
      outcome: 'ADJUSTMENT_PENDING',
      adoption: {
        weekIndex: 2,
        outcome: 'CHANGE_TRAINING_CONTENT',
        submittedFieldIds: [...requiredWeeklyFeedbackFields],
      },
    });
    expect(fixture.adoptions()).toHaveLength(1);
  });

  it('blocks submissions when the feedback window is closed', () => {
    const fixture = createWeeklyFeedbackFixture({ sufficiencyPolicy: sufficient });
    const result = fixture.submit(openSubmission({ windowState: 'CLOSED' }));
    expect(result).toEqual({ outcome: 'BLOCKED', reason: 'WINDOW_CLOSED', allowedActions: [] });
    expect(fixture.adoptions()).toHaveLength(0);
  });

  it('routes reported pain to the risk handoff without an adoption', () => {
    const fixture = createWeeklyFeedbackFixture({ sufficiencyPolicy: sufficient });
    const result = fixture.submit(openSubmission({
      fields: { ...openSubmission().fields, pain: 'REPORTED' },
    }));
    expect(result).toEqual({ outcome: 'RISK_HANDOFF', blocked: 'PAIN_REPORTED' });
    expect(fixture.adoptions()).toHaveLength(0);
  });

  it('blocks the three PRD-forbidden outcomes when data is insufficient', () => {
    const fixture = createWeeklyFeedbackFixture({ sufficiencyPolicy: insufficient });
    for (const outcome of insufficientDataForbiddenOutcomes) {
      const result = fixture.submit(openSubmission({ requestedOutcome: outcome }));
      expect(result).toEqual({
        outcome: 'BLOCKED',
        reason: 'ADJUSTMENT_OUTCOME_BLOCKED',
        allowedActions: insufficientDataAllowedOutcomes,
      });
    }
    expect(fixture.adoptions()).toHaveLength(0);
  });

  it('allows keeping the core plan when data is insufficient', () => {
    const fixture = createWeeklyFeedbackFixture({ sufficiencyPolicy: insufficient });
    const result = fixture.submit(openSubmission({ requestedOutcome: 'KEEP_CORE_PLAN' }));
    expect(result.outcome).toBe('ADJUSTMENT_PENDING');
    expect(fixture.adoptions()).toHaveLength(1);
  });

  it('fails closed on missing fields, unknown values and unavailable sufficiency policy', () => {
    const fixture = createWeeklyFeedbackFixture({ sufficiencyPolicy: sufficient });
    const { energy, ...missingEnergy } = openSubmission().fields;
    void energy;
    expect(fixture.submit(openSubmission({ fields: missingEnergy })))
      .toEqual({ outcome: 'BLOCKED', reason: 'MISSING_REQUIRED_FIELDS', allowedActions: [] });
    expect(fixture.submit(openSubmission({
      fields: { ...openSubmission().fields, mystery: 'x' } as WeeklySubmissionInput['fields'],
    }))).toEqual({ outcome: 'BLOCKED', reason: 'UNKNOWN_FIELD', allowedActions: [] });
    expect(fixture.submit(openSubmission({ requestedOutcome: 'SHRINK_CALORIES' })))
      .toEqual({ outcome: 'BLOCKED', reason: 'ADJUSTMENT_OUTCOME_BLOCKED', allowedActions: [] });
    const throwing = createWeeklyFeedbackFixture({
      sufficiencyPolicy: () => { throw new Error('boom'); },
    });
    expect(throwing.submit(openSubmission()))
      .toEqual({ outcome: 'BLOCKED', reason: 'SUFFICIENCY_UNAVAILABLE', allowedActions: [] });
    const noPolicy = createWeeklyFeedbackFixture();
    expect(noPolicy.submit(openSubmission()))
      .toEqual({ outcome: 'BLOCKED', reason: 'SUFFICIENCY_UNAVAILABLE', allowedActions: [] });
    const unknownVerdict = createWeeklyFeedbackFixture({ sufficiencyPolicy: () => 'MAYBE' });
    expect(unknownVerdict.submit(openSubmission()))
      .toEqual({ outcome: 'BLOCKED', reason: 'SUFFICIENCY_UNAVAILABLE', allowedActions: [] });
    expect(fixture.adoptions()).toHaveLength(0);
    expect(throwing.adoptions()).toHaveLength(0);
  });
});
