import { describe, expect, it, vi } from 'vitest';

import { createDeleteRequestClient } from './delete-client.js';

const session = { accountId: 'user-1', token: 'session-token' };
const status = { requestId: 'request-opaque', requestType: 'ANONYMIZE' as const, status: 'PROCESSING' as const };

describe('delete request client', () => {
  it('submits and rereads status through trusted session', async () => {
    const transport = { submit: vi.fn().mockResolvedValue(status), readStatus: vi.fn().mockResolvedValue(status) };
    const client = createDeleteRequestClient(transport);
    await expect(client.submit(session, status.requestId, status.requestType)).resolves.toEqual(status);
    await expect(client.readStatus(session, status.requestId, status.requestType)).resolves.toEqual(status);
    expect(transport.submit).toHaveBeenCalledWith(session, status.requestId, status.requestType);
    expect(transport.readStatus).toHaveBeenCalledWith(session, status.requestId);
  });

  it('maps malformed transport data to CLEAR_ALL', async () => {
    const client = createDeleteRequestClient({ submit: vi.fn().mockResolvedValue({ ...status, status: 'UNKNOWN' }), readStatus: vi.fn() });
    await expect(client.submit(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'DELETE_RESPONSE_INVALID', clientStateDisposition: 'CLEAR_ALL' });
  });

  it('rejects mismatched response request id and converts transport failures', async () => {
    const mismatch = createDeleteRequestClient({
      submit: vi.fn().mockResolvedValue({ ...status, requestId: 'other-request' }), readStatus: vi.fn(),
    });
    await expect(mismatch.submit(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'DELETE_RESPONSE_INVALID' });

    const failed = createDeleteRequestClient({ submit: vi.fn().mockRejectedValue(new Error('raw')), readStatus: vi.fn() });
    await expect(failed.submit(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'DELETE_REQUEST_FAILED', clientStateDisposition: 'CLEAR_ALL' });
  });

  it('validates read status request type and converts read transport failures', async () => {
    const mismatch = createDeleteRequestClient({
      submit: vi.fn(), readStatus: vi.fn().mockResolvedValue({ ...status, requestType: 'DELETE' }),
    });
    await expect(mismatch.readStatus(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'DELETE_RESPONSE_INVALID' });

    const failed = createDeleteRequestClient({ submit: vi.fn(), readStatus: vi.fn().mockRejectedValue(new Error('raw')) });
    await expect(failed.readStatus(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'DELETE_REQUEST_FAILED', clientStateDisposition: 'CLEAR_ALL' });
  });

  it('rejects non-string session and request id inputs with ClientError', async () => {
    const client = createDeleteRequestClient({ submit: vi.fn(), readStatus: vi.fn() });
    await expect(client.submit({ accountId: 42, token: 'token' } as unknown as typeof session, 'request', 'DELETE')).rejects.toMatchObject({ code: 'DELETE_SESSION_INVALID', clientStateDisposition: 'CLEAR_ALL' });
    await expect(client.submit(session, 42 as unknown as string, 'DELETE')).rejects.toMatchObject({ code: 'DELETE_REQUEST_ID_INVALID', clientStateDisposition: 'CLEAR_ALL' });
  });
});
