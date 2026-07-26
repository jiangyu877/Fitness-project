export type P07Session = { accountId: string; token: string };
export type P07NextAction =
  | 'WAIT_FOR_SCREENING_RULES'
  | 'WAIT_FOR_HUMAN_REVIEW'
  | 'STOP_SERVICE_FLOW'
  | 'COMPLETE_PROFILE'
  | 'WAIT_FOR_PLAN';
export type ScreeningConclusion = 'PASS' | 'HUMAN_REVIEW' | 'EXCLUDED' | null;

export type CurrentConsent = {
  businessStatus: 'CURRENT_CONSENT_AVAILABLE';
  consentVersion: string;
  content: { format: 'PLAIN_TEXT'; text: string };
};

export type ConsentAccepted = {
  businessStatus: 'CONSENT_ACCEPTED';
  consentId: string;
  consentVersion: string;
  version: number;
};

export type ScreeningStatus = {
  businessStatus: 'SCREENING_STATUS_AVAILABLE';
  nextAction: P07NextAction;
  conclusion: ScreeningConclusion;
};

export type ProfileField = { name: string; type: 'STRING' | 'NUMBER' | 'BOOLEAN'; required: boolean };
export type ProfileStep = { id: string; fields: ProfileField[] };
export type ProfileDraft = {
  businessStatus: 'PROFILE_DRAFT_AVAILABLE';
  schemaVersion: string;
  steps: ProfileStep[];
  recordVersion: number;
  completedSteps: string[];
  currentStep: string | null;
  drafts: Record<string, Record<string, string | number | boolean>>;
};
export type ProfileSaved = { businessStatus: 'PROFILE_DRAFT_SAVED'; requestId: string; version: number };
export type SaveProfileStepInput = { schemaVersion: string; expectedVersion: number; data: Record<string, string | number | boolean> };

export class P07ClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly recoverableActions: string[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'P07ClientError';
  }
}

type Fetcher = typeof fetch;
type Payload = Record<string, unknown>;

function key(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function object(value: unknown): Payload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Payload : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function actions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function invalid(): never {
  throw new P07ClientError('P07 服务响应无法安全显示。', 502, 'P07_RESPONSE_INVALID', ['CONTACT_OPERATIONS']);
}

function profileInvalid(): never {
  throw new P07ClientError('批准的 profile schema 缺失或无法安全显示。', 502, 'PROFILE_SCHEMA_UNAVAILABLE', ['CONTACT_OPERATIONS']);
}

function parseProfile(body: Payload): ProfileDraft {
  if (body.businessStatus !== 'PROFILE_DRAFT_AVAILABLE') profileInvalid();
  const schemaVersion = text(body.schemaVersion);
  const recordVersion = body.recordVersion;
  if (!schemaVersion || !Number.isInteger(recordVersion) || (recordVersion as number) < 0 || !Array.isArray(body.steps) || body.steps.length === 0) profileInvalid();
  const ids = new Set<string>();
  const steps = body.steps.map((rawStep) => {
    const step = object(rawStep);
    const id = text(step?.id);
    if (!id || ids.has(id) || !Array.isArray(step?.fields) || step.fields.length === 0) profileInvalid();
    ids.add(id);
    const names = new Set<string>();
    const fields = step.fields.map((rawField) => {
      const field = object(rawField);
      const name = text(field?.name);
      const type = field?.type;
      const required = field?.required;
      if (!name || names.has(name) || (type !== 'STRING' && type !== 'NUMBER' && type !== 'BOOLEAN') || (required !== undefined && typeof required !== 'boolean')) profileInvalid();
      names.add(name);
      return { name, type, required: required === true } as ProfileField;
    });
    return { id, fields };
  });
  if (!Array.isArray(body.completedSteps) || !body.completedSteps.every((item) => typeof item === 'string' && ids.has(item)) || new Set(body.completedSteps).size !== body.completedSteps.length) profileInvalid();
  if (body.currentStep !== null && (typeof body.currentStep !== 'string' || !ids.has(body.currentStep))) profileInvalid();
  const rawDrafts = object(body.drafts);
  if (!rawDrafts) profileInvalid();
  const drafts: ProfileDraft['drafts'] = {};
  for (const [stepId, rawDraft] of Object.entries(rawDrafts)) {
    const schemaStep = steps.find((step) => step.id === stepId);
    const draft = object(rawDraft);
    if (!schemaStep || !draft) profileInvalid();
    const parsed: Record<string, string | number | boolean> = {};
    for (const [fieldName, value] of Object.entries(draft)) {
      const schemaField = schemaStep.fields.find((field) => field.name === fieldName);
      if (!schemaField || (schemaField.type === 'STRING' && typeof value !== 'string') || (schemaField.type === 'NUMBER' && typeof value !== 'number') || (schemaField.type === 'BOOLEAN' && typeof value !== 'boolean')) profileInvalid();
      parsed[fieldName] = value as string | number | boolean;
    }
    drafts[stepId] = parsed;
  }
  return { businessStatus: 'PROFILE_DRAFT_AVAILABLE', schemaVersion, steps, recordVersion: recordVersion as number, completedSteps: [...body.completedSteps] as string[], currentStep: body.currentStep as string | null, drafts };
}

function requireSession(session: P07Session) {
  if (!session.accountId.trim() || !session.token.trim()) {
    throw new P07ClientError('尚未取得可信 USER 会话。', 401, 'P07_SESSION_REQUIRED', ['CONTACT_OPERATIONS']);
  }
}

export function createP07Client(options: { fetcher?: Fetcher; requestId?: () => string; idempotencyKey?: () => string } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const requestId = options.requestId ?? key;
  const idempotencyKey = options.idempotencyKey ?? key;

  async function request(path: string, session: P07Session, init: RequestInit = {}, write = false): Promise<{ body: Payload; response: Response }> {
    requireSession(session);
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${session.token}`);
    headers.set('x-request-id', requestId());
    if (write) headers.set('idempotency-key', idempotencyKey());
    try {
      const response = await fetcher(path, { ...init, headers });
      let body: Payload = {};
      try { body = object(await response.json()) ?? {}; } catch { body = {}; }
      if (!response.ok) {
        throw new P07ClientError(
          text(body.message) ?? 'P07 请求未完成。',
          response.status,
          text(body.errorCode) ?? 'P07_REQUEST_FAILED',
          actions(body.recoverableActions),
          text(body.requestId) ?? response.headers.get('x-request-id') ?? undefined,
        );
      }
      return { body, response };
    } catch (error) {
      if (error instanceof P07ClientError) throw error;
      throw new P07ClientError('P07 网络请求未完成。', 0, 'NETWORK_ERROR');
    }
  }

  return {
    async currentConsent(session: P07Session): Promise<CurrentConsent> {
      const { body } = await request('/api/v1/onboarding/consents/current', session);
      if (body.businessStatus !== 'CURRENT_CONSENT_AVAILABLE') invalid();
      const consentVersion = text(body.consentVersion);
      const content = object(body.content);
      const contentText = text(content?.text);
      if (!consentVersion || content?.format !== 'PLAIN_TEXT' || !contentText) invalid();
      return { businessStatus: 'CURRENT_CONSENT_AVAILABLE', consentVersion, content: { format: 'PLAIN_TEXT', text: contentText } };
    },
    async acceptConsent(session: P07Session, consentVersion: string): Promise<ConsentAccepted> {
      if (!consentVersion.trim()) invalid();
      const { body } = await request('/api/v1/onboarding/consents', session, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentVersion }),
      }, true);
      if (body.businessStatus !== 'CONSENT_ACCEPTED') invalid();
      const consentId = text(body.consentId);
      const returnedVersion = text(body.consentVersion);
      const version = body.version;
      if (!consentId || !returnedVersion || typeof version !== 'number' || !Number.isInteger(version) || version < 1) invalid();
      return { businessStatus: 'CONSENT_ACCEPTED', consentId, consentVersion: returnedVersion, version };
    },
    async screeningStatus(session: P07Session): Promise<ScreeningStatus> {
      const { body } = await request('/api/v1/onboarding/screening-status', session);
      const nextAction = body.nextAction;
      const businessStatus = body.businessStatus;
      const allowed: P07NextAction[] = ['WAIT_FOR_SCREENING_RULES', 'WAIT_FOR_HUMAN_REVIEW', 'STOP_SERVICE_FLOW', 'COMPLETE_PROFILE', 'WAIT_FOR_PLAN'];
      if (!allowed.includes(nextAction as P07NextAction) || businessStatus !== 'SCREENING_STATUS_AVAILABLE') invalid();
      const conclusion = body.conclusion;
      if (conclusion !== null && conclusion !== 'PASS' && conclusion !== 'HUMAN_REVIEW' && conclusion !== 'EXCLUDED') invalid();
      const expectedConclusion: Record<P07NextAction, ScreeningConclusion> = {
        WAIT_FOR_SCREENING_RULES: null,
        WAIT_FOR_HUMAN_REVIEW: 'HUMAN_REVIEW',
        STOP_SERVICE_FLOW: 'EXCLUDED',
        COMPLETE_PROFILE: 'PASS',
        WAIT_FOR_PLAN: 'PASS',
      };
      if (conclusion !== expectedConclusion[nextAction as P07NextAction]) invalid();
      return { businessStatus: 'SCREENING_STATUS_AVAILABLE', nextAction: nextAction as P07NextAction, conclusion: conclusion as ScreeningConclusion };
    },
    async profile(session: P07Session): Promise<ProfileDraft> {
      const { body } = await request('/api/v1/onboarding/profile', session);
      return parseProfile(body);
    },
    async saveProfileStep(session: P07Session, step: string, input: SaveProfileStepInput): Promise<ProfileSaved> {
      if (!step.trim() || !input.schemaVersion.trim() || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) profileInvalid();
      const { body } = await request(`/api/v1/onboarding/profile/steps/${encodeURIComponent(step)}`, session, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }, true);
      const responseRequestId = text(body.requestId);
      if (body.businessStatus !== 'PROFILE_DRAFT_SAVED' || !responseRequestId || !Number.isInteger(body.version) || (body.version as number) < 1) invalid();
      return { businessStatus: 'PROFILE_DRAFT_SAVED', requestId: responseRequestId, version: body.version as number };
    },
  };
}

export type P07Client = ReturnType<typeof createP07Client>;
