import { businessDatesForWindow } from './p10-task-generation.js';

export const weeklyFeedbackFieldIds = Object.freeze([
  'execution', 'trainingPerformance', 'sleep', 'energy', 'hunger', 'stress', 'recovery', 'pain', 'bodyTrend',
] as const);
export type WeeklyFeedbackFieldId = (typeof weeklyFeedbackFieldIds)[number];

export const requiredWeeklyFeedbackFields = Object.freeze([
  'execution', 'trainingPerformance', 'sleep', 'energy', 'hunger', 'stress', 'recovery', 'pain',
] as const);
export const optionalWeeklyFeedbackFields = Object.freeze(['bodyTrend'] as const);

export const adjustmentOutcomes = Object.freeze([
  'KEEP_CORE_PLAN', 'RESOLVE_EXECUTION_FRICTION',
  'TIGHTEN_ENERGY', 'INCREASE_TRAINING_VOLUME', 'INCREASE_TRAINING_INTENSITY',
  'CHANGE_DIET_GOAL', 'CHANGE_TRAINING_CONTENT', 'CHANGE_TRAINING_FREQUENCY', 'CHANGE_TRAINING_CYCLE',
] as const);
export type AdjustmentOutcome = (typeof adjustmentOutcomes)[number];

/** PRD 6.4 hard rule: with insufficient data the outcome must be one of these two. */
export const insufficientDataAllowedOutcomes = Object.freeze([
  'KEEP_CORE_PLAN', 'RESOLVE_EXECUTION_FRICTION',
] as const);
export const insufficientDataForbiddenOutcomes = Object.freeze([
  'TIGHTEN_ENERGY', 'INCREASE_TRAINING_VOLUME', 'INCREASE_TRAINING_INTENSITY',
] as const);

export const painFieldValues = Object.freeze(['CLEAR', 'REPORTED'] as const);
export type PainFieldValue = (typeof painFieldValues)[number];

export type Sufficiency = 'SUFFICIENT' | 'INSUFFICIENT';
export type WeeklyDataFacts = { recordedDays: number };
export type SufficiencyPolicy = (facts: WeeklyDataFacts) => Sufficiency | unknown;

export type WeeklySubmissionInput = {
  weekIndex: number;
  windowState: 'OPEN' | 'CLOSED';
  fields: Partial<Record<WeeklyFeedbackFieldId, string>>;
  facts: WeeklyDataFacts;
  requestedOutcome: string;
};

export type WeeklyAdoption = {
  weekIndex: number;
  outcome: AdjustmentOutcome;
  submittedFieldIds: WeeklyFeedbackFieldId[];
};

export type WeeklySubmissionResult =
  | { outcome: 'ADJUSTMENT_PENDING'; adoption: WeeklyAdoption }
  | { outcome: 'RISK_HANDOFF'; blocked: 'PAIN_REPORTED' }
  | {
    outcome: 'BLOCKED';
    reason: 'WINDOW_CLOSED' | 'MISSING_REQUIRED_FIELDS' | 'UNKNOWN_FIELD'
      | 'ADJUSTMENT_OUTCOME_BLOCKED' | 'SUFFICIENCY_UNAVAILABLE';
    allowedActions: readonly AdjustmentOutcome[];
  };

/** Up to four consecutive 7-day weeks (frozen four-week service cycle) of Asia/Shanghai business dates. */
export function deriveWeeklyWindows(effectiveAt: Date, effectiveTo: Date): string[][] {
  const dates = businessDatesForWindow(effectiveAt, effectiveTo);
  const weeks: string[][] = [];
  for (let start = 0; start < dates.length && weeks.length < 4; start += 7) {
    weeks.push(dates.slice(start, start + 7));
  }
  return weeks;
}

export type WeeklyFeedbackFixture = {
  submit(input: WeeklySubmissionInput): WeeklySubmissionResult;
  adoptions(): readonly WeeklyAdoption[];
};

export function createWeeklyFeedbackFixture(
  options: { sufficiencyPolicy?: SufficiencyPolicy } = {},
): WeeklyFeedbackFixture {
  const adoptions: WeeklyAdoption[] = [];
  return {
    submit(input: WeeklySubmissionInput): WeeklySubmissionResult {
      if (input.windowState === 'CLOSED') {
        return { outcome: 'BLOCKED', reason: 'WINDOW_CLOSED', allowedActions: [] };
      }
      const fields = input.fields ?? {};
      const unknownIds = Object.keys(fields)
        .filter((id) => !(weeklyFeedbackFieldIds as readonly string[]).includes(id));
      if (unknownIds.length > 0) {
        return { outcome: 'BLOCKED', reason: 'UNKNOWN_FIELD', allowedActions: [] };
      }
      const missing = requiredWeeklyFeedbackFields.filter((id) => fields[id] === undefined);
      if (missing.length > 0) {
        return { outcome: 'BLOCKED', reason: 'MISSING_REQUIRED_FIELDS', allowedActions: [] };
      }
      const pain = fields.pain;
      if (!(painFieldValues as readonly string[]).includes(pain as string)) {
        return { outcome: 'BLOCKED', reason: 'UNKNOWN_FIELD', allowedActions: [] };
      }
      if (pain === 'REPORTED') {
        return { outcome: 'RISK_HANDOFF', blocked: 'PAIN_REPORTED' };
      }
      let verdict: unknown;
      try {
        verdict = options.sufficiencyPolicy?.(input.facts);
      } catch {
        verdict = undefined;
      }
      if (verdict !== 'SUFFICIENT' && verdict !== 'INSUFFICIENT') {
        return { outcome: 'BLOCKED', reason: 'SUFFICIENCY_UNAVAILABLE', allowedActions: [] };
      }
      const requested = input.requestedOutcome;
      if (!(adjustmentOutcomes as readonly string[]).includes(requested)) {
        return { outcome: 'BLOCKED', reason: 'ADJUSTMENT_OUTCOME_BLOCKED', allowedActions: [] };
      }
      if (verdict === 'INSUFFICIENT'
        && !(insufficientDataAllowedOutcomes as readonly string[]).includes(requested)) {
        return {
          outcome: 'BLOCKED',
          reason: 'ADJUSTMENT_OUTCOME_BLOCKED',
          allowedActions: insufficientDataAllowedOutcomes,
        };
      }
      const adoption: WeeklyAdoption = {
        weekIndex: input.weekIndex,
        outcome: requested as AdjustmentOutcome,
        submittedFieldIds: weeklyFeedbackFieldIds.filter((id) => fields[id] !== undefined),
      };
      adoptions.push(adoption);
      return { outcome: 'ADJUSTMENT_PENDING', adoption };
    },
    adoptions: () => adoptions,
  };
}
