import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIdentityClient, createMemorySessionStorage } from './identity-client.js';

const sessionResponse = {
  businessStatus: 'SESSION_CREATED',
  sessionToken: 'full-session-token',
  expiresAt: '2026-07-23T18:00:00.000Z',
  nextAction: 'ACCEPT_CURRENT_CONSENT',
};

const activeSessionResponse = {
  accountId: 'active-user',
  accountType: 'USER',
  activeRole: 'USER',
  businessStatus: 'SESSION_ACTIVE',
  expiresAt: '2026-07-24T18:00:00.000Z',
  nextAction: 'VIEW_TODAY',
};

afterEach(() => vi.unstubAllGlobals());

describe('identity client', () => {
  it('restores a trusted session after the default client is rebuilt for a hard refresh', async () => {
    const browserStorage = new Map<string, string>();
    const sessionStorage = {
      getItem: (key: string) => browserStorage.get(key) ?? null,
      setItem: (key: string, value: string) => { browserStorage.set(key, value); },
      removeItem: (key: string) => { browserStorage.delete(key); },
    };
    vi.stubGlobal('sessionStorage', sessionStorage);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(sessionResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(activeSessionResponse), { status: 200 }));

    const loginClient = createIdentityClient({ fetcher });
    await loginClient.createSession({ loginId: 'user', password: 'secret' });
    const refreshedClient = createIdentityClient({ fetcher });

    expect(refreshedClient.hasStoredSession()).toBe(true);
    await expect(refreshedClient.restoreSession()).resolves.toMatchObject({
      accountId: 'active-user',
      token: 'full-session-token',
      nextAction: 'VIEW_TODAY',
    });
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer full-session-token');
  });

  it('stores only a full session after an active user login and sends write correlation headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(sessionResponse), { status: 200 }));
    const storage = createMemorySessionStorage();
    const client = createIdentityClient({ fetcher, storage, requestId: () => 'request-1', idempotencyKey: () => 'key-1' });

    const result = await client.createSession({ loginId: 'fat-loss-user', password: 'secret' });

    expect(result.kind).toBe('session-created');
    expect(storage.get()).toEqual({ token: 'full-session-token', expiresAt: sessionResponse.expiresAt });
    const loginRequest = fetcher.mock.calls[0]?.[1]!;
    expect(loginRequest.method).toBe('POST');
    expect(new Headers(loginRequest.headers).get('x-request-id')).toBe('request-1');
    expect(new Headers(loginRequest.headers).get('idempotency-key')).toBe('key-1');
    expect(loginRequest.body).toBe(JSON.stringify({ loginIdentifier: 'fat-loss-user', password: 'secret', sessionKind: 'USER' }));
  });

  it('rejects a full session response that requests the restricted password-change action', async () => {
    const storage = createMemorySessionStorage();
    const client = createIdentityClient({
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        ...sessionResponse,
        nextAction: 'CHANGE_INITIAL_PASSWORD',
      }), { status: 200 })),
      storage,
    });

    await expect(client.createSession({ loginId: 'user', password: 'secret' })).rejects.toMatchObject({
      status: 502,
      code: 'IDENTITY_RESPONSE_INVALID',
    });
    expect(storage.get()).toBeNull();
  });

  it('keeps the restricted initial-password token out of the full session port until password change succeeds', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        businessStatus: 'PASSWORD_CHANGE_REQUIRED', passwordChangeToken: 'restricted-token', expiresAt: '2026-07-23T17:00:00.000Z', expectedVersion: 3, nextAction: 'CHANGE_INITIAL_PASSWORD',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(sessionResponse), { status: 200 }));
    const storage = createMemorySessionStorage();
    const client = createIdentityClient({ fetcher, storage, requestId: () => 'request-1', idempotencyKey: () => 'key-1' });

    const restricted = await client.createSession({ loginId: 'muscle-gain-user', password: 'secret' });
    expect(restricted.kind).toBe('password-change-required');
    expect(storage.get()).toBeNull();
    await client.changeInitialPassword({ newPassword: 'replaced-secret', expectedVersion: 3 });

    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer restricted-token');
    expect(storage.get()?.token).toBe('full-session-token');
    expect(client.getRestrictedContext()).toBeNull();
  });

  it('uses the full session only for restore and logout, then clears it on logout', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(activeSessionResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const storage = createMemorySessionStorage({ token: 'full-session-token', expiresAt: sessionResponse.expiresAt });
    const client = createIdentityClient({ fetcher, storage });

    await expect(client.restoreSession()).resolves.toEqual({
      kind: 'session-created',
      accountId: 'active-user',
      token: 'full-session-token',
      expiresAt: activeSessionResponse.expiresAt,
      nextAction: 'VIEW_TODAY',
    });
    expect(storage.get()).toEqual({ token: 'full-session-token', expiresAt: activeSessionResponse.expiresAt });
    await client.logout();

    const restoreRequest = fetcher.mock.calls[0]?.[1]!;
    const logoutRequest = fetcher.mock.calls[1]?.[1]!;
    expect(new Headers(restoreRequest.headers).get('Authorization')).toBe('Bearer full-session-token');
    expect(new Headers(restoreRequest.headers).get('x-request-id')).toEqual(expect.any(String));
    expect(new Headers(restoreRequest.headers).get('idempotency-key')).toBeNull();
    expect(logoutRequest.method).toBe('POST');
    expect(new Headers(logoutRequest.headers).get('Authorization')).toBe('Bearer full-session-token');
    expect(new Headers(logoutRequest.headers).get('x-request-id')).toEqual(expect.any(String));
    expect(new Headers(logoutRequest.headers).get('idempotency-key')).toEqual(expect.any(String));
    expect(storage.get()).toBeNull();
  });

  it.each([
    [503, 'IDENTITY_REQUEST_FAILED'],
    [0, 'NETWORK_ERROR'],
  ])('preserves a full session when logout fails with %s', async (status, code) => {
    const failure = status === 0
      ? new TypeError('offline')
      : new Response(JSON.stringify({ errorCode: code }), { status });
    const fetcher = vi.fn().mockImplementation(() => failure instanceof Response ? Promise.resolve(failure) : Promise.reject(failure));
    const storage = createMemorySessionStorage({ token: 'full-session-token', expiresAt: sessionResponse.expiresAt });
    const client = createIdentityClient({ fetcher, storage });

    await expect(client.logout()).rejects.toMatchObject({ status, code });
    expect(storage.get()?.token).toBe('full-session-token');
  });

  it('clears an expired full session on recovery 401 but retains it on recoverable outage', async () => {
    const expiredStorage = createMemorySessionStorage({ token: 'expired-token', expiresAt: sessionResponse.expiresAt });
    const expired = createIdentityClient({ fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ errorCode: 'SESSION_INVALID' }), { status: 401 })), storage: expiredStorage });
    await expect(expired.restoreSession()).rejects.toMatchObject({ status: 401 });
    expect(expiredStorage.get()).toBeNull();

    const outageStorage = createMemorySessionStorage({ token: 'retained-token', expiresAt: sessionResponse.expiresAt });
    const outage = createIdentityClient({ fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ errorCode: 'SERVICE_UNAVAILABLE' }), { status: 503 })), storage: outageStorage });
    await expect(outage.restoreSession()).rejects.toMatchObject({ status: 503 });
    expect(outageStorage.get()?.token).toBe('retained-token');
  });

  it('clears a locked full session on recovery 423', async () => {
    const storage = createMemorySessionStorage({ token: 'locked-token', expiresAt: sessionResponse.expiresAt });
    const client = createIdentityClient({
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ errorCode: 'ACCOUNT_LOCKED' }), { status: 423 })),
      storage,
    });

    await expect(client.restoreSession()).rejects.toMatchObject({ status: 423 });
    expect(storage.get()).toBeNull();
  });

  it('rejects an active session with an unknown next action and retains the existing token', async () => {
    const storage = createMemorySessionStorage({ token: 'retained-token', expiresAt: sessionResponse.expiresAt });
    const client = createIdentityClient({
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        ...activeSessionResponse,
        nextAction: 'UNCLASSIFIED_ACTION',
      }), { status: 200 })),
      storage,
    });

    await expect(client.restoreSession()).rejects.toMatchObject({ status: 502, code: 'IDENTITY_RESPONSE_INVALID' });
    expect(storage.get()).toEqual({ token: 'retained-token', expiresAt: sessionResponse.expiresAt });
  });

  it.each([
    ['empty account id', { accountId: '' }],
    ['staff account type', { accountType: 'STAFF' }],
    ['staff active role', { activeRole: 'OPERATIONS' }],
    ['restricted password action', { nextAction: 'CHANGE_INITIAL_PASSWORD' }],
  ])('rejects an active session with %s and retains the existing token', async (_case, override) => {
    const storage = createMemorySessionStorage({ token: 'retained-token', expiresAt: sessionResponse.expiresAt });
    const client = createIdentityClient({
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        ...activeSessionResponse,
        ...override,
      }), { status: 200 })),
      storage,
    });

    await expect(client.restoreSession()).rejects.toMatchObject({ status: 502, code: 'IDENTITY_RESPONSE_INVALID' });
    expect(storage.get()).toEqual({ token: 'retained-token', expiresAt: sessionResponse.expiresAt });
  });

  it('normalizes stable server, network, and malformed errors', async () => {
    const server = createIdentityClient({ fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ errorCode: 'ACCOUNT_LOCKED', recoverableActions: ['CONTACT_OPERATIONS'] }), { status: 423 })) });
    await expect(server.createSession({ loginId: 'user', password: 'secret' })).rejects.toMatchObject({ status: 423, code: 'ACCOUNT_LOCKED', recoverableActions: ['CONTACT_OPERATIONS'] });

    const network = createIdentityClient({ fetcher: vi.fn().mockRejectedValue(new TypeError('offline')) });
    await expect(network.createSession({ loginId: 'user', password: 'secret' })).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });

    const malformed = createIdentityClient({ fetcher: vi.fn().mockResolvedValue(new Response('not-json', { status: 503 })) });
    await expect(malformed.createSession({ loginId: 'user', password: 'secret' })).rejects.toMatchObject({ status: 503, code: 'IDENTITY_REQUEST_FAILED' });
  });
});
