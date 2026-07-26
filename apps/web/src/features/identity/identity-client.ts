export type NextAction =
  | 'CHANGE_INITIAL_PASSWORD'
  | 'ACCEPT_CURRENT_CONSENT'
  | 'WAIT_FOR_SCREENING_RULES'
  | 'COMPLETE_SCREENING'
  | 'WAIT_FOR_HUMAN_REVIEW'
  | 'STOP_SERVICE_FLOW'
  | 'COMPLETE_PROFILE'
  | 'WAIT_FOR_PLAN'
  | 'VIEW_PENDING_PLAN'
  | 'VIEW_TODAY'
  | 'CONTACT_OPERATIONS';

const nextActions = new Set<NextAction>([
  'CHANGE_INITIAL_PASSWORD',
  'ACCEPT_CURRENT_CONSENT',
  'WAIT_FOR_SCREENING_RULES',
  'COMPLETE_SCREENING',
  'WAIT_FOR_HUMAN_REVIEW',
  'STOP_SERVICE_FLOW',
  'COMPLETE_PROFILE',
  'WAIT_FOR_PLAN',
  'VIEW_PENDING_PLAN',
  'VIEW_TODAY',
  'CONTACT_OPERATIONS',
]);

const fullUserSessionActions = new Set<NextAction>([
  'ACCEPT_CURRENT_CONSENT',
  'WAIT_FOR_SCREENING_RULES',
  'COMPLETE_SCREENING',
  'WAIT_FOR_HUMAN_REVIEW',
  'STOP_SERVICE_FLOW',
  'COMPLETE_PROFILE',
  'WAIT_FOR_PLAN',
  'VIEW_PENDING_PLAN',
  'VIEW_TODAY',
  'CONTACT_OPERATIONS',
]);

export type FullSession = { token: string; expiresAt: string };

export interface SessionStoragePort {
  get(): FullSession | null;
  set(session: FullSession): void;
  clear(): void;
}

export function createMemorySessionStorage(initial: FullSession | null = null): SessionStoragePort {
  let session = initial;
  return {
    get: () => session,
    set: (next) => { session = next; },
    clear: () => { session = null; },
  };
}

const browserSessionKey = 'lianban.user-session';

function createBrowserSessionStorage(storage: Storage): SessionStoragePort {
  return {
    get() {
      const raw = storage.getItem(browserSessionKey);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          !parsed
          || typeof parsed !== 'object'
          || typeof (parsed as FullSession).token !== 'string'
          || !(parsed as FullSession).token.trim()
          || typeof (parsed as FullSession).expiresAt !== 'string'
          || !(parsed as FullSession).expiresAt.trim()
        ) throw new Error('invalid session');
        return { token: (parsed as FullSession).token, expiresAt: (parsed as FullSession).expiresAt };
      } catch {
        storage.removeItem(browserSessionKey);
        return null;
      }
    },
    set: (session) => storage.setItem(browserSessionKey, JSON.stringify(session)),
    clear: () => storage.removeItem(browserSessionKey),
  };
}

function createDefaultSessionStorage(): SessionStoragePort {
  try {
    return typeof globalThis.sessionStorage === 'undefined'
      ? createMemorySessionStorage()
      : createBrowserSessionStorage(globalThis.sessionStorage);
  } catch {
    return createMemorySessionStorage();
  }
}

export class IdentityError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly recoverableActions: string[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

type SessionCreated = { kind: 'session-created'; expiresAt: string; nextAction: NextAction };
type ParsedSessionCreated = SessionCreated & { token: string };
export type RestoredUserSession = SessionCreated & { token: string; accountId: string };
type PasswordChangeRequired = { kind: 'password-change-required'; expiresAt: string; expectedVersion: number; nextAction: 'CHANGE_INITIAL_PASSWORD' };
export type IdentityResult = SessionCreated | PasswordChangeRequired;

type RestrictedContext = { token: string; expiresAt: string; expectedVersion: number };
type Fetcher = typeof fetch;

export interface IdentityClient {
  hasStoredSession(): boolean;
  createSession(input: { loginId: string; password: string }): Promise<IdentityResult>;
  changeInitialPassword(input: { newPassword: string; expectedVersion: number }): Promise<SessionCreated>;
  restoreSession(): Promise<RestoredUserSession | null>;
  logout(): Promise<void>;
  getRestrictedContext(): Omit<RestrictedContext, 'token'> | null;
}

type ClientOptions = {
  fetcher?: Fetcher;
  storage?: SessionStoragePort;
  requestId?: () => string;
  idempotencyKey?: () => string;
};

type ResponsePayload = Record<string, unknown>;

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readPayload(response: Response): Promise<ResponsePayload> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' ? parsed as ResponsePayload : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asActions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isNextAction(value: unknown): value is NextAction {
  return typeof value === 'string' && nextActions.has(value as NextAction);
}

function toSessionCreated(payload: ResponsePayload): ParsedSessionCreated {
  const token = asString(payload.sessionToken);
  const expiresAt = asString(payload.expiresAt);
  const nextAction = payload.nextAction;
  if (
    !token
    || !expiresAt
    || !isNextAction(nextAction)
    || !fullUserSessionActions.has(nextAction)
    || payload.businessStatus !== 'SESSION_CREATED'
  ) {
    throw new IdentityError('身份服务返回了无效会话响应。', 502, 'IDENTITY_RESPONSE_INVALID');
  }
  return { kind: 'session-created', token, expiresAt, nextAction };
}


function toActiveSession(payload: ResponsePayload, token: string): RestoredUserSession {
  const accountId = asString(payload.accountId);
  const expiresAt = asString(payload.expiresAt);
  const nextAction = payload.nextAction;
  if (
    !accountId?.trim()
    || payload.accountType !== 'USER'
    || payload.activeRole !== 'USER'
    || !expiresAt
    || !isNextAction(nextAction)
    || !fullUserSessionActions.has(nextAction)
    || payload.businessStatus !== 'SESSION_ACTIVE'
  ) {
    throw new IdentityError('身份服务返回了无效会话响应。', 502, 'IDENTITY_RESPONSE_INVALID');
  }
  return { kind: 'session-created', accountId, token, expiresAt, nextAction };
}

export function createIdentityClient(options: ClientOptions = {}): IdentityClient {
  const fetcher = options.fetcher ?? fetch;
  const storage = options.storage ?? createDefaultSessionStorage();
  const requestId = options.requestId ?? newKey;
  const idempotencyKey = options.idempotencyKey ?? newKey;
  let restricted: RestrictedContext | null = null;

  async function request(path: string, init: RequestInit = {}, requestKind: 'none' | 'read' | 'write' = 'none'): Promise<ResponsePayload> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (requestKind === 'read' || requestKind === 'write') headers.set('x-request-id', requestId());
    if (requestKind === 'write') {
      headers.set('idempotency-key', idempotencyKey());
    }
    try {
      const response = await fetcher(path, { ...init, headers });
      const payload = await readPayload(response);
      if (!response.ok) {
        throw new IdentityError(
          asString(payload.message) ?? '身份请求未完成。',
          response.status,
          asString(payload.errorCode) ?? 'IDENTITY_REQUEST_FAILED',
          asActions(payload.recoverableActions),
          response.headers.get('x-request-id') ?? undefined,
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError('网络连接不可用，请检查连接后重试。', 0, 'NETWORK_ERROR');
    }
  }

  return {
    hasStoredSession: () => storage.get() !== null,
    async createSession({ loginId, password }) {
      const payload = await request('/api/v1/identity/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginIdentifier: loginId, password, sessionKind: 'USER' }),
      }, 'write');

      if (payload.businessStatus === 'PASSWORD_CHANGE_REQUIRED') {
        const token = asString(payload.passwordChangeToken);
        const expiresAt = asString(payload.expiresAt);
        const expectedVersion = asNumber(payload.expectedVersion);
        if (!token || !expiresAt || expectedVersion === undefined || payload.nextAction !== 'CHANGE_INITIAL_PASSWORD') {
          throw new IdentityError('身份服务返回了无效的首次改密响应。', 502, 'IDENTITY_RESPONSE_INVALID');
        }
        restricted = { token, expiresAt, expectedVersion };
        return { kind: 'password-change-required', expiresAt, expectedVersion, nextAction: 'CHANGE_INITIAL_PASSWORD' };
      }

      const result = toSessionCreated(payload);
      storage.set({ token: result.token, expiresAt: result.expiresAt });
      return result;
    },

    async changeInitialPassword({ newPassword, expectedVersion }) {
      if (!restricted) throw new IdentityError('首次改密会话已失效，请重新登录。', 401, 'PASSWORD_CHANGE_SESSION_REQUIRED');
      const payload = await request('/api/v1/identity/password/change', {
        method: 'POST',
        headers: { Authorization: `Bearer ${restricted.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword, expectedVersion }),
      }, 'write');
      const result = toSessionCreated(payload);
      storage.set({ token: result.token, expiresAt: result.expiresAt });
      restricted = null;
      return result;
    },

    async restoreSession() {
      const session = storage.get();
      if (!session) return null;
      try {
        const payload = await request('/api/v1/identity/session', { headers: { Authorization: `Bearer ${session.token}` } }, 'read');
        const result = toActiveSession(payload, session.token);
        storage.set({ token: session.token, expiresAt: result.expiresAt });
        return result;
      } catch (error) {
        if (error instanceof IdentityError && (error.status === 401 || error.status === 423)) storage.clear();
        throw error;
      }
    },

    async logout() {
      const session = storage.get();
      if (!session) {
        restricted = null;
        return;
      }
      try {
        await request('/api/v1/identity/session/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } }, 'write');
        restricted = null;
        storage.clear();
      } catch (error) {
        if (error instanceof IdentityError && error.status === 401) {
          restricted = null;
          storage.clear();
          return;
        }
        throw error;
      }
    },

    getRestrictedContext: () => restricted ? { expiresAt: restricted.expiresAt, expectedVersion: restricted.expectedVersion } : null,
  };
}
