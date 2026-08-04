import { describe, expect, it, vi } from 'vitest';

import { createP11Client, P11ClientError } from './p11-client.js';

const context = {
  businessStatus: 'RECORD_CONTEXT_AVAILABLE',
  taskId: 'task-opaque',
  planVersion: 'plan-opaque',
  businessDate: 'server-date',
  accessMode: 'EDITABLE',
  schema: {
    version: 'schema-test-v1',
    testOnly: true,
    recordKinds: [{ id: 'kind-opaque', fields: [], allowedActions: ['UPSERT_RECORD'] }],
  },
  records: [],
};

describe('P11 GET_RECORD_CONTEXT client', () => {
  it('gets a context with only the trusted bearer and opaque task locator', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(context), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const client = createP11Client({ fetcher, requestId: () => 'request-1' });

    await expect(client.getContext({ accountId: 'trusted-user', token: 'trusted-token' }, 'task-opaque'))
      .resolves.toEqual(context);

    expect(fetcher).toHaveBeenCalledWith('/api/v1/record-tasks/task-opaque/context', expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer trusted-token',
        'x-request-id': 'request-1',
      }),
    }));
    const [, init] = fetcher.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer trusted-token');
    expect(headers.get('x-request-id')).toBe('request-1');
    expect(JSON.stringify(init)).not.toContain('trusted-user');
  });

  it('surfaces only the strictly parsed structured error disposition', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      businessStatus: 'RECORD_CONTEXT_BLOCKED',
      errorCode: 'RECORD_STATE_BLOCKED',
      recoverableActions: [],
      clientStateDisposition: 'DISABLE_EDITOR',
      requestId: 'request-2',
    }), { status: 409 }));
    const client = createP11Client({ fetcher, requestId: () => 'request-2' });

    await expect(client.getContext({ accountId: 'trusted-user', token: 'trusted-token' }, 'task-opaque'))
      .rejects.toMatchObject({
        code: 'RECORD_STATE_BLOCKED',
        recoverableActions: [],
        clientStateDisposition: 'DISABLE_EDITOR',
        requestId: 'request-2',
      });
  });

  it('fails closed when a successful response is not a strict context envelope', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      businessStatus: 'RECORD_CONTEXT_AVAILABLE',
      taskId: 'task-opaque',
      extra: 'must-not-be-consumed',
    }), { status: 200 }));
    const client = createP11Client({ fetcher, requestId: () => 'request-3' });

    const result = client.getContext({ accountId: 'trusted-user', token: 'trusted-token' }, 'task-opaque');
    await expect(result).rejects.toBeInstanceOf(P11ClientError);
    await expect(result).rejects.toMatchObject({
      code: 'RECORD_RESPONSE_INVALID',
      recoverableActions: [],
      clientStateDisposition: 'CLEAR_ALL',
    });
  });
});
