export type PlanStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'READY_TO_PUBLISH'
  | 'PENDING_CONFIRMATION'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'STAFF_REVISION_REQUIRED'
  | 'USER_REVISION_REQUIRED'
  | 'CONFIRMATION_TIMED_OUT'
  | 'SUPERSEDED';

export type PlanAllowedAction =
  | 'CONFIRM_DIET'
  | 'CONFIRM_TRAINING'
  | 'REJECT_DIET'
  | 'REJECT_TRAINING'
  | 'OPEN_PLAN_HISTORY'
  | 'CONTACT_OPERATIONS';

export type PlanVersion = {
  id: string;
  userId: string;
  version?: string;
  status: PlanStatus;
  confirmationDeadlineAt: string;
  effectiveAt: string;
  effectiveTo: string | null;
  dietConfirmed: boolean;
  trainingConfirmed: boolean;
  rejectionReasonCode?: string | null;
  allowedActions: PlanAllowedAction[];
};

export type CurrentPlanResult =
  | { businessStatus: 'CURRENT_PLAN'; plan: PlanVersion }
  | { businessStatus: 'PLAN_GAP'; plan: null };

export type PlanHistoryResult = { items: PlanVersion[] };
export type PlanSession = { token: string; accountId: string };
export type ConfirmationStatus = 'PENDING' | 'CONFIRMED';
export type PendingPlanSummary = {
  version: string;
  status: 'PENDING_CONFIRMATION' | 'SCHEDULED';
  effectiveAt: string;
  confirmationDeadlineAt: string;
  dietConfirmation: ConfirmationStatus;
  trainingConfirmation: ConfirmationStatus;
  allowedActions: Array<'CONFIRM_DIET' | 'REJECT_DIET' | 'CONFIRM_TRAINING' | 'REJECT_TRAINING'>;
};
export type PendingPlanResult =
  | { businessStatus: 'PLAN_PENDING_CONFIRMATION'; plan: PendingPlanSummary & { status: 'PENDING_CONFIRMATION' } }
  | { businessStatus: 'PLAN_WAITING_EFFECTIVE'; plan: PendingPlanSummary & { status: 'SCHEDULED'; allowedActions: [] } }
  | { businessStatus: 'NO_PENDING_PLAN'; plan: null };
export type PlanTransitionType = 'CONFIRM_DIET' | 'CONFIRM_TRAINING' | 'REJECT_DIET' | 'REJECT_TRAINING';
export type PlanTransitionIntent = {
  type: PlanTransitionType;
  idempotencyKey: string;
};

export class PlanClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly recoverableActions: string[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'PlanClientError';
  }
}

type Fetcher = typeof fetch;
type Payload = Record<string, unknown>;

const planStatuses = new Set<PlanStatus>([
  'DRAFT', 'IN_REVIEW', 'READY_TO_PUBLISH', 'PENDING_CONFIRMATION', 'SCHEDULED', 'ACTIVE',
  'STAFF_REVISION_REQUIRED', 'USER_REVISION_REQUIRED', 'CONFIRMATION_TIMED_OUT', 'SUPERSEDED',
]);
const historyStatuses = new Set<PlanStatus>([
  'PENDING_CONFIRMATION', 'SCHEDULED', 'ACTIVE', 'USER_REVISION_REQUIRED', 'CONFIRMATION_TIMED_OUT', 'SUPERSEDED',
]);
const userAllowedActions = new Set<PlanAllowedAction>([
  'CONFIRM_DIET', 'CONFIRM_TRAINING', 'REJECT_DIET', 'REJECT_TRAINING', 'OPEN_PLAN_HISTORY', 'CONTACT_OPERATIONS',
]);
const pendingAllowedActions = new Set<PendingPlanSummary['allowedActions'][number]>([
  'CONFIRM_DIET', 'REJECT_DIET', 'CONFIRM_TRAINING', 'REJECT_TRAINING',
]);
const transitionErrors = new Map<string, string[]>([
  ['409:PLAN_VERSION_CONFLICT:VERSION_CONFLICT', ['REFRESH']],
  ['409:PLAN_VERSION_CONFLICT:IDEMPOTENCY_KEY_REUSED', ['USE_NEW_IDEMPOTENCY_KEY']],
  ['409:PLAN_TRANSITION_BLOCKED:PLAN_PART_ALREADY_DECIDED', ['REFRESH']],
  ['409:PLAN_TRANSITION_BLOCKED:STATE_TRANSITION_NOT_ALLOWED', ['REFRESH', 'OPEN_PLAN_HISTORY']],
  ['409:CONFIRMATION_CLOSED:CONFIRMATION_DEADLINE_PASSED', ['CREATE_NEW_VERSION']],
  ['401:WRITE_REJECTED:SESSION_INVALID', ['LOGIN']],
  ['403:WRITE_REJECTED:ROLE_NOT_AUTHORIZED', ['CONTACT_OPERATIONS']],
]);

function key(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function object(value: unknown): Payload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Payload : null;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : string(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function invalid(): never {
  throw new PlanClientError('计划服务返回了无法安全显示的数据。', 502, 'PLAN_RESPONSE_INVALID', ['CONTACT_OPERATIONS']);
}

function parsePlan(value: unknown, expectedUserId: string): PlanVersion {
  const payload = object(value);
  if (!payload) invalid();
  const id = string(payload.id);
  const userId = string(payload.userId);
  const status = string(payload.status) as PlanStatus | undefined;
  const confirmationDeadlineAt = string(payload.confirmationDeadlineAt);
  const effectiveAt = string(payload.effectiveAt);
  const effectiveTo = nullableString(payload.effectiveTo);
  const version = string(payload.version);
  if (!id || userId !== expectedUserId || !status || !planStatuses.has(status) || !confirmationDeadlineAt || !effectiveAt || effectiveTo === undefined) invalid();

  return {
    id,
    userId,
    ...(version ? { version } : {}),
    status,
    confirmationDeadlineAt,
    effectiveAt,
    effectiveTo,
    dietConfirmed: payload.dietConfirmed === true,
    trainingConfirmed: payload.trainingConfirmed === true,
    ...(payload.rejectionReasonCode === undefined ? {} : { rejectionReasonCode: nullableString(payload.rejectionReasonCode) ?? null }),
    allowedActions: strings(payload.allowedActions).filter((action): action is PlanAllowedAction => userAllowedActions.has(action as PlanAllowedAction)),
  };
}

function parsePendingPlan(value: unknown): PendingPlanSummary {
  const body = object(value);
  if (!body) invalid();
  const allowedKeys = new Set([
    'version', 'status', 'effectiveAt', 'confirmationDeadlineAt',
    'dietConfirmation', 'trainingConfirmation', 'allowedActions',
  ]);
  if (Object.keys(body).some((field) => !allowedKeys.has(field))) invalid();
  const version = string(body.version);
  const status = body.status;
  const effectiveAt = string(body.effectiveAt);
  const confirmationDeadlineAt = string(body.confirmationDeadlineAt);
  const dietConfirmation = body.dietConfirmation;
  const trainingConfirmation = body.trainingConfirmation;
  if (
    !version || (status !== 'PENDING_CONFIRMATION' && status !== 'SCHEDULED')
    || !effectiveAt || !confirmationDeadlineAt
    || (dietConfirmation !== 'PENDING' && dietConfirmation !== 'CONFIRMED')
    || (trainingConfirmation !== 'PENDING' && trainingConfirmation !== 'CONFIRMED')
    || !Array.isArray(body.allowedActions)
  ) invalid();
  const allowedActions = body.allowedActions;
  if (allowedActions.some((action) => typeof action !== 'string' || !pendingAllowedActions.has(action as PendingPlanSummary['allowedActions'][number]))) invalid();
  const expectedActions: PendingPlanSummary['allowedActions'] = [];
  if (dietConfirmation === 'PENDING') expectedActions.push('CONFIRM_DIET', 'REJECT_DIET');
  if (trainingConfirmation === 'PENDING') expectedActions.push('CONFIRM_TRAINING', 'REJECT_TRAINING');
  if (
    new Set(allowedActions).size !== allowedActions.length
    || allowedActions.length !== expectedActions.length
    || expectedActions.some((action) => !allowedActions.includes(action))
    || (status === 'SCHEDULED' && (dietConfirmation !== 'CONFIRMED' || trainingConfirmation !== 'CONFIRMED'))
    || (status === 'PENDING_CONFIRMATION' && dietConfirmation === 'CONFIRMED' && trainingConfirmation === 'CONFIRMED')
  ) invalid();
  return {
    version,
    status,
    effectiveAt,
    confirmationDeadlineAt,
    dietConfirmation,
    trainingConfirmation,
    allowedActions: allowedActions as PendingPlanSummary['allowedActions'],
  };
}

async function payload(response: Response): Promise<Payload> {
  try {
    return object(await response.json()) ?? {};
  } catch {
    return {};
  }
}

export function createPlanClient(options: {
  fetcher?: Fetcher;
  requestId?: () => string;
  idempotencyKey?: () => string;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const requestId = options.requestId ?? key;
  const idempotencyKey = options.idempotencyKey ?? key;

  function requireSession(session: PlanSession) {
    if (!session.accountId.trim() || !session.token.trim()) {
      throw new PlanClientError('尚未取得可信用户会话，计划暂不可显示。', 401, 'PLAN_SESSION_REQUIRED', ['WAIT_FOR_IDENTITY_CONTRACT']);
    }
  }

  async function read(path: string, session: PlanSession): Promise<Payload> {
    requireSession(session);
    try {
      const response = await fetcher(path, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.token}`,
          'x-request-id': requestId(),
        },
      });
      const body = await payload(response);
      if (!response.ok) {
        throw new PlanClientError(
          string(body.message) ?? '计划请求未完成。',
          response.status,
          string(body.errorCode) ?? 'PLAN_REQUEST_FAILED',
          strings(body.recoverableActions),
          response.headers.get('x-request-id') ?? undefined,
        );
      }
      return body;
    } catch (error) {
      if (error instanceof PlanClientError) throw error;
      throw new PlanClientError('网络连接不可用，请稍后联系运营。', 0, 'NETWORK_ERROR');
    }
  }

  return {
    createTransitionIntent(type: PlanTransitionType): PlanTransitionIntent {
      return { type, idempotencyKey: idempotencyKey() };
    },
    async transition(session: PlanSession, version: string, intent: PlanTransitionIntent): Promise<void> {
      requireSession(session);
      if (!version.trim() || !intent.idempotencyKey.trim()) invalid();
      try {
        const response = await fetcher(`/api/v1/plan-versions/${encodeURIComponent(version)}/transitions`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${session.token}`,
            'Content-Type': 'application/json',
            'idempotency-key': intent.idempotencyKey,
            'x-request-id': requestId(),
          },
          body: JSON.stringify({ type: intent.type }),
        });
        let body: Payload | null = null;
        try {
          body = object(await response.json());
        } catch {
          body = null;
        }
        if (response.status === 200) {
          if (!body) invalid();
          return;
        }
        if (response.status === 503) {
          throw new PlanClientError('计划服务暂不可用。', 503, string(body?.errorCode) ?? 'PLAN_SERVICE_UNAVAILABLE', ['CONTACT_OPERATIONS'], response.headers.get('x-request-id') ?? undefined);
        }
        const businessStatus = string(body?.businessStatus);
        const errorCode = string(body?.errorCode);
        const recoverableActions = businessStatus && errorCode
          ? transitionErrors.get(`${response.status}:${businessStatus}:${errorCode}`)
          : undefined;
        if (!errorCode || !recoverableActions) invalid();
        throw new PlanClientError(
          string(body?.message) ?? '计划操作未完成。',
          response.status,
          errorCode,
          recoverableActions,
          response.headers.get('x-request-id') ?? undefined,
        );
      } catch (error) {
        if (error instanceof PlanClientError) throw error;
        throw new PlanClientError('网络连接不可用，服务端未提供可恢复动作。', 0, 'NETWORK_ERROR');
      }
    },
    async current(session: PlanSession): Promise<CurrentPlanResult> {
      const body = await read(`/api/v1/users/${encodeURIComponent(session.accountId)}/plans/current`, session);
      if (body.businessStatus === 'PLAN_GAP' && body.plan === null) return { businessStatus: 'PLAN_GAP', plan: null };
      if (body.businessStatus !== 'CURRENT_PLAN') invalid();
      const plan = parsePlan(body.plan, session.accountId);
      if (plan.status !== 'ACTIVE') invalid();
      return { businessStatus: 'CURRENT_PLAN', plan };
    },
    async history(session: PlanSession): Promise<PlanHistoryResult> {
      const body = await read(`/api/v1/users/${encodeURIComponent(session.accountId)}/plans/history`, session);
      if (!Array.isArray(body.items)) invalid();
      const items = body.items.map((item) => parsePlan(item, session.accountId));
      if (items.some((item) => !historyStatuses.has(item.status))) invalid();
      return { items };
    },
    async pending(session: PlanSession): Promise<PendingPlanResult> {
      const body = await read(`/api/v1/users/${encodeURIComponent(session.accountId)}/plans/pending`, session);
      if (body.businessStatus === 'NO_PENDING_PLAN' && body.plan === null) return { businessStatus: 'NO_PENDING_PLAN', plan: null };
      const plan = parsePendingPlan(body.plan);
      if (body.businessStatus === 'PLAN_PENDING_CONFIRMATION' && plan.status === 'PENDING_CONFIRMATION') {
        return { businessStatus: body.businessStatus, plan: { ...plan, status: 'PENDING_CONFIRMATION' } };
      }
      if (body.businessStatus === 'PLAN_WAITING_EFFECTIVE' && plan.status === 'SCHEDULED' && plan.allowedActions.length === 0) {
        return { businessStatus: body.businessStatus, plan: { ...plan, status: 'SCHEDULED', allowedActions: [] } };
      }
      invalid();
    },
    async detail(session: PlanSession, planVersionId: string): Promise<PlanVersion> {
      if (!planVersionId.trim()) invalid();
      const plan = parsePlan(await read(`/api/v1/plan-versions/${encodeURIComponent(planVersionId)}`, session), session.accountId);
      if (!historyStatuses.has(plan.status)) invalid();
      return plan;
    },
  };
}

export type PlanClient = ReturnType<typeof createPlanClient>;
