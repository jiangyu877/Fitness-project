export type WeeklyFeedbackWindowState = 'OPEN' | 'CLOSED';
export type WeeklyFeedbackSufficiency = 'SUFFICIENT' | 'INSUFFICIENT';
export type WeeklyFeedbackPainState = 'CLEAR' | 'REPORTED';
export type WeeklyFeedbackSubmissionState = 'NONE' | 'ADJUSTMENT_PENDING';

export type WeeklyFeedbackField = { id: string; required: boolean };

export type WeeklyFeedbackView = {
  windowState: WeeklyFeedbackWindowState;
  weekIndex: number;
  sufficiency: WeeklyFeedbackSufficiency;
  painState: WeeklyFeedbackPainState;
  submissionState: WeeklyFeedbackSubmissionState;
  nextWindowAt: string | null;
  fields: WeeklyFeedbackField[];
  allowedOutcomes: string[];
};

export type WeeklyFeedbackDisplayStatus =
  | 'RISK_HANDOFF'
  | 'ADJUSTMENT_PENDING'
  | 'WINDOW_CLOSED'
  | 'INSUFFICIENT_DATA'
  | 'FORM_OPEN';

export type WeeklyFeedbackDisplayState = {
  status: WeeklyFeedbackDisplayStatus;
  nextWindowAt: string | null;
  fields: WeeklyFeedbackField[];
  allowedOutcomes: string[];
};

type JsonObject = Record<string, unknown>;

function invalid(): never {
  throw new Error('WEEKLY_FEEDBACK_VIEW_INVALID');
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as JsonObject;
}

function exactKeys(value: JsonObject, required: readonly string[]): void {
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !required.includes(key))) invalid();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
  return value as T;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

function parseFields(value: unknown): WeeklyFeedbackField[] {
  if (!Array.isArray(value) || value.length === 0) invalid();
  const fields = value.map((entry) => {
    const field = object(entry);
    exactKeys(field, ['id', 'required']);
    if (typeof field.required !== 'boolean') invalid();
    return { id: text(field.id), required: field.required };
  });
  if (new Set(fields.map((field) => field.id)).size !== fields.length) invalid();
  return fields;
}

function parseOutcomes(value: unknown): string[] {
  if (!Array.isArray(value)) invalid();
  const outcomes = value.map((entry) => text(entry));
  if (new Set(outcomes).size !== outcomes.length) invalid();
  return outcomes;
}

export function parseWeeklyFeedbackView(value: unknown): WeeklyFeedbackView {
  const view = object(value);
  exactKeys(view, [
    'windowState', 'weekIndex', 'sufficiency', 'painState', 'submissionState',
    'nextWindowAt', 'fields', 'allowedOutcomes',
  ]);
  const windowState = enumValue(view.windowState, ['OPEN', 'CLOSED'] as const);
  if (!Number.isInteger(view.weekIndex) || (view.weekIndex as number) < 1) invalid();
  const nextWindowAt = view.nextWindowAt === null ? null : text(view.nextWindowAt);
  if (windowState === 'CLOSED' ? nextWindowAt === null : nextWindowAt !== null) invalid();
  return {
    windowState,
    weekIndex: view.weekIndex as number,
    sufficiency: enumValue(view.sufficiency, ['SUFFICIENT', 'INSUFFICIENT'] as const),
    painState: enumValue(view.painState, ['CLEAR', 'REPORTED'] as const),
    submissionState: enumValue(view.submissionState, ['NONE', 'ADJUSTMENT_PENDING'] as const),
    nextWindowAt,
    fields: parseFields(view.fields),
    allowedOutcomes: parseOutcomes(view.allowedOutcomes),
  };
}

export function deriveWeeklyFeedbackState(view: WeeklyFeedbackView): WeeklyFeedbackDisplayState {
  const status: WeeklyFeedbackDisplayStatus = view.painState === 'REPORTED'
    ? 'RISK_HANDOFF'
    : view.submissionState === 'ADJUSTMENT_PENDING'
      ? 'ADJUSTMENT_PENDING'
      : view.windowState === 'CLOSED'
        ? 'WINDOW_CLOSED'
        : view.sufficiency === 'INSUFFICIENT'
          ? 'INSUFFICIENT_DATA'
          : 'FORM_OPEN';
  const submittable = status === 'FORM_OPEN' || status === 'INSUFFICIENT_DATA';
  return {
    status,
    nextWindowAt: view.nextWindowAt,
    fields: [...view.fields],
    allowedOutcomes: submittable ? [...view.allowedOutcomes] : [],
  };
}
