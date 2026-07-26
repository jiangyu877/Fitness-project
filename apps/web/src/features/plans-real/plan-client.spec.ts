import { describe, expect, it, vi } from 'vitest';

import { PlanClientError, createPlanClient } from './plan-client.js';

const activePlan = {
  id: 'plan-2026-w30-v1',
  userId: 'user-1',
  version: '2026-W30-R1',
  status: 'ACTIVE',
  confirmationDeadlineAt: '2026-07-27T12:00:00.000Z',
  effectiveAt: '2026-07-28T16:00:00.000Z',
  effectiveTo: '2026-08-04T16:00:00.000Z',
  dietConfirmed: true,
  trainingConfirmed: true,
  allowedActions: [],
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'server-request-1' },
  });
}

describe('real plan client', () => {
  it('reads current, history, and detail with the authenticated user identity', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ businessStatus: 'CURRENT_PLAN', plan: activePlan }))
      .mockResolvedValueOnce(response({ items: [activePlan] }))
      .mockResolvedValueOnce(response(activePlan));
    const client = createPlanClient({ fetcher, requestId: () => 'request-1' });
    const session = { token: 'user-token', accountId: 'user-1' };

    await expect(client.current(session)).resolves.toEqual({ businessStatus: 'CURRENT_PLAN', plan: activePlan });
    await expect(client.history(session)).resolves.toEqual({ items: [activePlan] });
    await expect(client.detail(session, activePlan.id)).resolves.toEqual(activePlan);

    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/users/user-1/plans/current',
      '/api/v1/users/user-1/plans/history',
      '/api/v1/plan-versions/plan-2026-w30-v1',
    ]);
    for (const [, init] of fetcher.mock.calls) {
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer user-token');
      expect(headers.get('x-request-id')).toBe('request-1');
    }
  });

  it('accepts an explicit PLAN_GAP without synthesizing a plan', async () => {
    const client = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus: 'PLAN_GAP', plan: null })) });

    await expect(client.current({ token: 'token', accountId: 'user-1' })).resolves.toEqual({ businessStatus: 'PLAN_GAP', plan: null });
  });

  it.each([
    ['PLAN_PENDING_CONFIRMATION', 'PENDING_CONFIRMATION', ['CONFIRM_DIET', 'REJECT_DIET', 'CONFIRM_TRAINING', 'REJECT_TRAINING']],
    ['PLAN_WAITING_EFFECTIVE', 'SCHEDULED', []],
  ] as const)('reads %s from the authenticated user pending endpoint', async (businessStatus, status, allowedActions) => {
    const fetcher = vi.fn().mockResolvedValue(response({
      businessStatus,
      plan: {
        version: 'pending-v1', status,
        effectiveAt: '2026-08-11T00:00:00.000+08:00',
        confirmationDeadlineAt: '2026-08-10T20:00:00.000+08:00',
        dietConfirmation: status === 'SCHEDULED' ? 'CONFIRMED' : 'PENDING',
        trainingConfirmation: status === 'SCHEDULED' ? 'CONFIRMED' : 'PENDING',
        allowedActions,
      },
    }));
    const client = createPlanClient({ fetcher, requestId: () => 'pending-request' });

    await expect(client.pending({ token: 'user-token', accountId: 'user-1' })).resolves.toMatchObject({
      businessStatus,
      plan: { version: 'pending-v1', status, allowedActions: [...allowedActions] },
    });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/users/user-1/plans/pending', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer user-token' }),
    }));
  });

  it('accepts the explicit NO_PENDING_PLAN empty state', async () => {
    const client = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus: 'NO_PENDING_PLAN', plan: null })) });

    await expect(client.pending({ token: 'token', accountId: 'user-1' })).resolves.toEqual({ businessStatus: 'NO_PENDING_PLAN', plan: null });
  });

  it.each([
    ['unknown status', { businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: { version: 'v1', status: 'UNKNOWN', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00', dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING', allowedActions: [] } }],
    ['business/status mismatch', { businessStatus: 'PLAN_WAITING_EFFECTIVE', plan: { version: 'v1', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00', dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING', allowedActions: [] } }],
    ['scheduled actions', { businessStatus: 'PLAN_WAITING_EFFECTIVE', plan: { version: 'v1', status: 'SCHEDULED', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00', dietConfirmation: 'CONFIRMED', trainingConfirmation: 'CONFIRMED', allowedActions: ['CONFIRM_DIET'] } }],
    ['unknown action', { businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: { version: 'v1', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00', dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING', allowedActions: ['ACTIVATE'] } }],
    ['leaked field', { businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: { version: 'v1', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00', dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING', allowedActions: [], reviewerId: 'staff-1' } }],
  ])('fails closed for malformed pending response: %s', async (_case, payload) => {
    const client = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response(payload)) });

    await expect(client.pending({ token: 'token', accountId: 'user-1' })).rejects.toMatchObject({ status: 502, code: 'PLAN_RESPONSE_INVALID' });
  });

  it.each([
    ['scheduled diet pending', 'SCHEDULED', 'PENDING', 'CONFIRMED', []],
    ['scheduled training pending', 'SCHEDULED', 'CONFIRMED', 'PENDING', []],
    ['pending missing reject', 'PENDING_CONFIRMATION', 'PENDING', 'CONFIRMED', ['CONFIRM_DIET']],
    ['pending confirmed part action', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PENDING', ['CONFIRM_TRAINING', 'REJECT_TRAINING', 'CONFIRM_DIET']],
    ['pending cross-part actions', 'PENDING_CONFIRMATION', 'PENDING', 'CONFIRMED', ['CONFIRM_TRAINING', 'REJECT_TRAINING']],
    ['pending duplicate action', 'PENDING_CONFIRMATION', 'PENDING', 'CONFIRMED', ['CONFIRM_DIET', 'REJECT_DIET', 'REJECT_DIET']],
    ['pending extra action pair', 'PENDING_CONFIRMATION', 'PENDING', 'CONFIRMED', ['CONFIRM_DIET', 'REJECT_DIET', 'CONFIRM_TRAINING', 'REJECT_TRAINING']],
    ['pending already fully confirmed', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CONFIRMED', []],
  ] as const)('fails closed for inconsistent pending combination: %s', async (_case, status, dietConfirmation, trainingConfirmation, allowedActions) => {
    const businessStatus = status === 'SCHEDULED' ? 'PLAN_WAITING_EFFECTIVE' : 'PLAN_PENDING_CONFIRMATION';
    const client = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response({
      businessStatus,
      plan: {
        version: 'v1', status, effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00',
        dietConfirmation, trainingConfirmation, allowedActions,
      },
    })) });

    await expect(client.pending({ token: 'token', accountId: 'user-1' })).rejects.toMatchObject({ status: 502, code: 'PLAN_RESPONSE_INVALID' });
  });

  it.each([
    ['unknown business status', { businessStatus: 'WAITING', plan: null }],
    ['unknown plan status', { businessStatus: 'CURRENT_PLAN', plan: { ...activePlan, status: 'UNKNOWN' } }],
    ['cross-user plan', { businessStatus: 'CURRENT_PLAN', plan: { ...activePlan, userId: 'user-2' } }],
  ])('fails closed for %s', async (_case, payload) => {
    const client = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response(payload)) });

    await expect(client.current({ token: 'token', accountId: 'user-1' })).rejects.toMatchObject({
      status: 502,
      code: 'PLAN_RESPONSE_INVALID',
    });
  });

  it.each(['DRAFT', 'IN_REVIEW', 'READY_TO_PUBLISH', 'PENDING_CONFIRMATION', 'SCHEDULED', 'STAFF_REVISION_REQUIRED', 'USER_REVISION_REQUIRED', 'CONFIRMATION_TIMED_OUT', 'SUPERSEDED'] as const)(
    'rejects non-ACTIVE current plan status %s',
    async (status) => {
      const client = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus: 'CURRENT_PLAN', plan: { ...activePlan, status } })) });
      await expect(client.current({ token: 'token', accountId: 'user-1' })).rejects.toMatchObject({ status: 502, code: 'PLAN_RESPONSE_INVALID' });
    },
  );

  it.each(['DRAFT', 'IN_REVIEW', 'READY_TO_PUBLISH', 'STAFF_REVISION_REQUIRED'] as const)(
    'rejects internal plan status %s from history and detail',
    async (status) => {
      const internalPlan = { ...activePlan, status };
      const historyClient = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response({ items: [internalPlan] })) });
      const detailClient = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response(internalPlan)) });

      await expect(historyClient.history({ token: 'token', accountId: 'user-1' })).rejects.toMatchObject({ status: 502, code: 'PLAN_RESPONSE_INVALID' });
      await expect(detailClient.detail({ token: 'token', accountId: 'user-1' }, activePlan.id)).rejects.toMatchObject({ status: 502, code: 'PLAN_RESPONSE_INVALID' });
    },
  );

  it('treats omitted or unknown allowed actions as no authorization', async () => {
    const payload = {
      businessStatus: 'CURRENT_PLAN',
      plan: { ...activePlan, allowedActions: undefined, version: undefined },
    };
    const client = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response(payload)) });

    await expect(client.current({ token: 'token', accountId: 'user-1' })).resolves.toMatchObject({
      plan: { id: activePlan.id, allowedActions: [] },
    });
  });

  it('normalizes structured service failures and network errors without fallback data', async () => {
    const unavailable = createPlanClient({
      fetcher: vi.fn().mockResolvedValue(response({
        businessStatus: 'IDENTITY_BLOCKED',
        errorCode: 'ROUTE_ACCESS_NOT_APPROVED',
        recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
      }, 503)),
    });
    await expect(unavailable.history({ token: 'token', accountId: 'user-1' })).rejects.toEqual(expect.objectContaining({
      status: 503,
      code: 'ROUTE_ACCESS_NOT_APPROVED',
      recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
      requestId: 'server-request-1',
    }));

    const offline = createPlanClient({ fetcher: vi.fn().mockRejectedValue(new TypeError('offline')) });
    await expect(offline.current({ token: 'token', accountId: 'user-1' })).rejects.toEqual(expect.objectContaining({
      status: 0,
      code: 'NETWORK_ERROR',
      recoverableActions: [],
    }));
    expect(PlanClientError).toBeDefined();
  });

  it.each(['CONFIRM_DIET', 'CONFIRM_TRAINING', 'REJECT_DIET', 'REJECT_TRAINING'] as const)(
    'posts the frozen %s transition contract without a rejection reason',
    async (type) => {
      const fetcher = vi.fn().mockResolvedValue(response({ accepted: true }));
      const client = createPlanClient({
        fetcher,
        requestId: () => 'transition-request-1',
        idempotencyKey: () => 'intent-key-1',
      });
      const intent = client.createTransitionIntent(type);

      await expect(client.transition({ token: 'user-token', accountId: 'user-1' }, 'version/7', intent)).resolves.toBeUndefined();

      expect(intent).toEqual({ type, idempotencyKey: 'intent-key-1' });
      expect(fetcher).toHaveBeenCalledWith('/api/v1/plan-versions/version%2F7/transitions', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer user-token',
          'Content-Type': 'application/json',
          'idempotency-key': 'intent-key-1',
          'x-request-id': 'transition-request-1',
        },
        body: JSON.stringify({ type }),
      });
      expect(JSON.parse(fetcher.mock.calls[0]![1].body)).not.toHaveProperty('occurredAt');
      expect(JSON.parse(fetcher.mock.calls[0]![1].body)).not.toHaveProperty('reasonCode');
    },
  );

  it('reuses one intent idempotency key and exact body across a network retry', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response({ accepted: true }));
    const client = createPlanClient({
      fetcher,
      idempotencyKey: vi.fn().mockReturnValueOnce('stable-intent-key').mockReturnValueOnce('new-intent-key'),
    });
    const intent = client.createTransitionIntent('CONFIRM_DIET');

    await expect(client.transition({ token: 'token', accountId: 'user-1' }, 'v1', intent)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(client.transition({ token: 'token', accountId: 'user-1' }, 'v1', intent)).resolves.toBeUndefined();

    expect(fetcher.mock.calls.map(([, init]) => new Headers(init.headers).get('idempotency-key'))).toEqual(['stable-intent-key', 'stable-intent-key']);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { type: 'CONFIRM_DIET' }, { type: 'CONFIRM_DIET' },
    ]);
    expect(fetcher.mock.calls.every(([, init]) => !Object.hasOwn(JSON.parse(init.body), 'occurredAt'))).toBe(true);
    expect(client.createTransitionIntent('CONFIRM_DIET').idempotencyKey).toBe('new-intent-key');
  });

  it('does not invent a RETRY action for a transition network failure', async () => {
    const client = createPlanClient({ fetcher: vi.fn().mockRejectedValue(new TypeError('offline')) });

    await expect(client.transition(
      { token: 'token', accountId: 'user-1' },
      'v1',
      client.createTransitionIntent('CONFIRM_DIET'),
    )).rejects.toMatchObject({ code: 'NETWORK_ERROR', recoverableActions: [] });
  });

  it.each([
    [409, 'PLAN_VERSION_CONFLICT', 'VERSION_CONFLICT', ['REFRESH']],
    [409, 'PLAN_VERSION_CONFLICT', 'IDEMPOTENCY_KEY_REUSED', ['USE_NEW_IDEMPOTENCY_KEY']],
    [409, 'PLAN_TRANSITION_BLOCKED', 'PLAN_PART_ALREADY_DECIDED', ['REFRESH']],
    [409, 'PLAN_TRANSITION_BLOCKED', 'STATE_TRANSITION_NOT_ALLOWED', ['REFRESH', 'OPEN_PLAN_HISTORY']],
    [409, 'CONFIRMATION_CLOSED', 'CONFIRMATION_DEADLINE_PASSED', ['CREATE_NEW_VERSION']],
    [401, 'WRITE_REJECTED', 'SESSION_INVALID', ['LOGIN']],
    [403, 'WRITE_REJECTED', 'ROLE_NOT_AUTHORIZED', ['CONTACT_OPERATIONS']],
  ] as const)('maps %s %s/%s to conservative recovery actions', async (status, businessStatus, errorCode, recoverableActions) => {
    const client = createPlanClient({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus, errorCode }, status)) });
    const intent = client.createTransitionIntent('CONFIRM_DIET');

    await expect(client.transition({ token: 'token', accountId: 'user-1' }, 'v1', intent)).rejects.toMatchObject({
      status, code: errorCode, recoverableActions,
    });
  });

  it.each([
    [409, { businessStatus: 'UNKNOWN', errorCode: 'VERSION_CONFLICT' }],
    [409, { businessStatus: 'PLAN_VERSION_CONFLICT', errorCode: 'UNKNOWN' }],
    [503, { businessStatus: 'SERVICE_UNAVAILABLE', errorCode: 'UPSTREAM_DOWN' }],
    [200, null],
  ])('fails closed for malformed or unavailable transition response %s', async (status, body) => {
    const fetcher = vi.fn().mockResolvedValue(
      body === null ? new Response('not-json', { status }) : response(body, status),
    );
    const client = createPlanClient({ fetcher });

    const expected = status === 503
      ? { status: 503, recoverableActions: ['CONTACT_OPERATIONS'] }
      : { status: 502, code: 'PLAN_RESPONSE_INVALID', recoverableActions: ['CONTACT_OPERATIONS'] };
    await expect(client.transition(
      { token: 'token', accountId: 'user-1' },
      'v1',
      client.createTransitionIntent('CONFIRM_DIET'),
    )).rejects.toMatchObject(expected);
  });
});
