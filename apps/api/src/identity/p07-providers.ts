export type ConsentContent = { format: 'PLAIN_TEXT'; text: string };
export type ApprovedConsent = { version: string; content: ConsentContent };
export type CurrentConsentProvider = { getCurrentConsent(): Promise<ApprovedConsent> };
export const CURRENT_CONSENT = Symbol('CURRENT_CONSENT');

export type ScreeningConclusion = 'PASS' | 'HUMAN_REVIEW' | 'EXCLUDED';
export type ScreeningApprovalProvider = {
  isApprovedConclusion(input: {
    source: string;
    ruleVersion: string | null;
    conclusion: ScreeningConclusion;
    recordedBy: string;
    actorRole: 'NUTRITION_REVIEWER' | 'TRAINING_REVIEWER';
    qualifiedAt: Date;
  }): Promise<boolean>;
};
export const SCREENING_APPROVAL = Symbol('SCREENING_APPROVAL');

export type ProfileField = { name: string; type: 'STRING' | 'NUMBER' | 'BOOLEAN'; required?: boolean };
export type ProfileStep = { id: string; fields: readonly ProfileField[] };
export type ApprovedProfileSchema = { version: string; steps: readonly ProfileStep[] };
export type ProfileSchemaProvider = { getApprovedProfileSchema(): Promise<ApprovedProfileSchema> };
export const PROFILE_SCHEMA = Symbol('PROFILE_SCHEMA');

export function validConsent(value: unknown): value is ApprovedConsent {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const content = item.content as Record<string, unknown> | undefined;
  return typeof item.version === 'string' && item.version.trim().length > 0
    && !!content && content.format === 'PLAIN_TEXT'
    && typeof content.text === 'string' && content.text.trim().length > 0;
}

export function validProfileSchema(value: unknown): value is ApprovedProfileSchema {
  if (!value || typeof value !== 'object') return false;
  const schema = value as Record<string, unknown>;
  if (typeof schema.version !== 'string' || schema.version.trim().length === 0
    || !Array.isArray(schema.steps) || schema.steps.length === 0) return false;
  const stepIds = new Set<string>();
  return schema.steps.every((step) => {
    if (!step || typeof step !== 'object') return false;
    const item = step as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.id.trim().length === 0
      || stepIds.has(item.id) || !Array.isArray(item.fields) || item.fields.length === 0) return false;
    stepIds.add(item.id);
    const fieldNames = new Set<string>();
    return item.fields.every((field) => {
      if (!field || typeof field !== 'object') return false;
      const candidate = field as Record<string, unknown>;
      if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0
        || fieldNames.has(candidate.name) || !['STRING', 'NUMBER', 'BOOLEAN'].includes(String(candidate.type))
        || ('required' in candidate && typeof candidate.required !== 'boolean')) return false;
      fieldNames.add(candidate.name);
      return true;
    });
  });
}
