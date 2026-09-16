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

  it('rejects a syntactically valid context for a different task before it can be consumed', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ...context,
      taskId: 'other-opaque-task',
    }), { status: 200 }));
    const client = createP11Client({ fetcher, requestId: () => 'request-task-mismatch' });

    await expect(client.getContext({ accountId: 'trusted-user', token: 'trusted-token' }, 'task-opaque'))
      .rejects.toMatchObject({
        code: 'RECORD_RESPONSE_INVALID',
        clientStateDisposition: 'CLEAR_ALL',
      });
  });

  it('sends a strict record command with correlation and idempotency headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
      schemaVersion: 'schema-test-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createP11Client({
      fetcher, requestId: () => 'command-request-1', idempotencyKey: () => 'command-idempotency-1',
    } as never);

    await expect((client as unknown as { upsertRecord: (session: { accountId: string; token: string }, taskId: string, command: unknown) => Promise<unknown> }).upsertRecord(
      { accountId: 'trusted-user', token: 'trusted-token' },
      'task-opaque',
      {
        operation: 'UPSERT_RECORD', recordKindId: 'kind-opaque', schemaVersion: 'schema-test-v1',
        expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'opaque-value' }],
      },
    )).resolves.toEqual({
      businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
      schemaVersion: 'schema-test-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
    });

    expect(fetcher).toHaveBeenCalledWith('/api/v1/record-tasks/task-opaque/commands', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer trusted-token',
        'x-request-id': 'command-request-1',
        'idempotency-key': 'command-idempotency-1',
      }),
      body: JSON.stringify({
        operation: 'UPSERT_RECORD', recordKindId: 'kind-opaque', schemaVersion: 'schema-test-v1',
        expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'opaque-value' }],
      }),
    }));
  });

  it('rejects missing command correlation or idempotency before transport', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createP11Client({ fetcher, requestId: () => '', idempotencyKey: () => 'key-1' } as never);
    await expect((client as unknown as { upsertRecord: (session: { accountId: string; token: string }, taskId: string, command: unknown) => Promise<unknown> }).upsertRecord(
      { accountId: 'trusted-user', token: 'trusted-token' }, 'task-opaque', {
        operation: 'UPSERT_RECORD', recordKindId: 'kind-opaque', schemaVersion: 'schema-test-v1',
        expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'opaque-value' }],
      },
    )).rejects.toMatchObject({ code: 'P11_REQUEST_ID_REQUIRED', clientStateDisposition: 'CLEAR_ALL' });
    expect(fetcher).not.toHaveBeenCalled();

    const missingKeyClient = createP11Client({ fetcher, requestId: () => 'request-1', idempotencyKey: () => '' } as never);
    await expect((missingKeyClient as unknown as { upsertRecord: (session: { accountId: string; token: string }, taskId: string, command: unknown) => Promise<unknown> }).upsertRecord(
      { accountId: 'trusted-user', token: 'trusted-token' }, 'task-opaque', {
        operation: 'UPSERT_RECORD', recordKindId: 'kind-opaque', schemaVersion: 'schema-test-v1',
        expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'opaque-value' }],
      },
    )).rejects.toMatchObject({ code: 'P11_IDEMPOTENCY_KEY_REQUIRED', clientStateDisposition: 'CLEAR_ALL' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed for malformed command success and structured command errors', async () => {
    const malformedFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
    }), { status: 200 }));
    const malformedClient = createP11Client({ fetcher: malformedFetcher, requestId: () => 'request-1', idempotencyKey: () => 'key-1' } as never);
    await expect((malformedClient as unknown as { upsertRecord: (session: { accountId: string; token: string }, taskId: string, command: unknown) => Promise<unknown> }).upsertRecord(
      { accountId: 'trusted-user', token: 'trusted-token' }, 'task-opaque', {
        operation: 'UPSERT_RECORD', recordKindId: 'kind-opaque', schemaVersion: 'schema-test-v1',
        expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'opaque-value' }],
      },
    )).rejects.toMatchObject({ code: 'RECORD_RESPONSE_INVALID', clientStateDisposition: 'CLEAR_ALL' });

    const errorFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      businessStatus: 'RECORD_CONTEXT_BLOCKED', errorCode: 'IDEMPOTENCY_KEY_REUSED',
      recoverableActions: ['USE_NEW_IDEMPOTENCY_KEY'], clientStateDisposition: 'CLEAR_ALL', requestId: 'request-2',
    }), { status: 409 }));
    const errorClient = createP11Client({ fetcher: errorFetcher, requestId: () => 'request-2', idempotencyKey: () => 'key-2' } as never);
    await expect((errorClient as unknown as { upsertRecord: (session: { accountId: string; token: string }, taskId: string, command: unknown) => Promise<unknown> }).upsertRecord(
      { accountId: 'trusted-user', token: 'trusted-token' }, 'task-opaque', {
        operation: 'UPSERT_RECORD', recordKindId: 'kind-opaque', schemaVersion: 'schema-test-v1',
        expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'opaque-value' }],
      },
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', recoverableActions: ['USE_NEW_IDEMPOTENCY_KEY'] });
  });

  it('fails closed with client errors for non-string runtime boundaries', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createP11Client({ fetcher });
    await expect(client.getContext({ accountId: undefined as never, token: 'token' }, 'task-opaque'))
      .rejects.toMatchObject({ code: 'P11_SESSION_REQUIRED', clientStateDisposition: 'CLEAR_ALL' });
    await expect(client.getContext({ accountId: 'user', token: 'token' }, undefined as never))
      .rejects.toMatchObject({ code: 'P11_TASK_ID_REQUIRED', clientStateDisposition: 'CLEAR_ALL' });
    expect(fetcher).not.toHaveBeenCalled();

    const invalidRequestIdClient = createP11Client({
      fetcher, requestId: () => ({ invalid: true }) as never, idempotencyKey: () => 'key-1',
    } as never);
    await expect((invalidRequestIdClient as unknown as { upsertRecord: (session: { accountId: string; token: string }, taskId: string, command: unknown) => Promise<unknown> }).upsertRecord(
      { accountId: 'user', token: 'token' }, 'task-opaque', {
        operation: 'UPSERT_RECORD', recordKindId: 'kind', schemaVersion: 'schema',
        expectedRecordVersion: null, entries: [{ fieldId: 'field', value: 'value' }],
      },
    )).rejects.toMatchObject({ code: 'P11_REQUEST_ID_REQUIRED', clientStateDisposition: 'CLEAR_ALL' });

    const invalidKeyClient = createP11Client({
      fetcher, requestId: () => 'request-1', idempotencyKey: () => ({ invalid: true }) as never,
    } as never);
    await expect((invalidKeyClient as unknown as { upsertRecord: (session: { accountId: string; token: string }, taskId: string, command: unknown) => Promise<unknown> }).upsertRecord(
      { accountId: 'user', token: 'token' }, 'task-opaque', {
        operation: 'UPSERT_RECORD', recordKindId: 'kind', schemaVersion: 'schema',
        expectedRecordVersion: null, entries: [{ fieldId: 'field', value: 'value' }],
      },
    )).rejects.toMatchObject({ code: 'P11_IDEMPOTENCY_KEY_REQUIRED', clientStateDisposition: 'CLEAR_ALL' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts an empty string when the server schema marks no required constraint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
      schemaVersion: 'schema', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
    }), { status: 200 }));
    const client = createP11Client({ fetcher, requestId: () => 'request-empty', idempotencyKey: () => 'key-empty' });
    await expect(client.upsertRecord({ accountId: 'user', token: 'token' }, 'task', {
      operation: 'UPSERT_RECORD', recordKindId: 'kind', schemaVersion: 'schema',
      expectedRecordVersion: null, entries: [{ fieldId: 'field', value: '' }],
    })).resolves.toMatchObject({ businessStatus: 'RECORD_WRITE_ACCEPTED' });
  });
});
