import { describe, expect, it, vi } from 'vitest';

import { createExportRequestClient } from './export-client.js';

const session = { accountId: 'user-1', token: 'session-token' };
const status = { requestId: 'request-opaque', requestType: 'DELETE' as const, status: 'FROZEN' as const };

describe('export request client', () => {
  it('submits and reads status using the trusted session and same request id', async () => {
    const transport = {
      submit: vi.fn().mockResolvedValue(status),
      readStatus: vi.fn().mockResolvedValue(status),
    };
    const client = createExportRequestClient(transport);
    await expect(client.submit(session, status.requestId, status.requestType)).resolves.toEqual(status);
    await expect(client.readStatus(session, status.requestId, status.requestType)).resolves.toEqual(status);
    expect(transport.submit).toHaveBeenCalledWith(session, status.requestId, status.requestType);
    expect(transport.readStatus).toHaveBeenCalledWith(session, status.requestId);
  });

  it('maps malformed transport data to a fail-closed error', async () => {
    const client = createExportRequestClient({
      submit: vi.fn().mockResolvedValue({ ...status, status: 'UNKNOWN' }),
      readStatus: vi.fn(),
    });
    await expect(client.submit(session, status.requestId, status.requestType)).rejects.toMatchObject({
      code: 'EXPORT_RESPONSE_INVALID', clientStateDisposition: 'CLEAR_ALL',
    });
  });

  it('rejects response request identity mismatches', async () => {
    const client = createExportRequestClient({
      submit: vi.fn().mockResolvedValue({ ...status, requestId: 'other-request' }),
      readStatus: vi.fn(),
    });
    await expect(client.submit(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'EXPORT_RESPONSE_INVALID' });
  });

  it('converts transport rejection into a fail-closed client error', async () => {
    const client = createExportRequestClient({ submit: vi.fn().mockRejectedValue(new Error('raw')), readStatus: vi.fn() });
    await expect(client.submit(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'EXPORT_REQUEST_FAILED', clientStateDisposition: 'CLEAR_ALL' });
  });

  it('validates read status request identity and converts read transport failures', async () => {
    const mismatch = createExportRequestClient({
      submit: vi.fn(),
      readStatus: vi.fn().mockResolvedValue({ ...status, requestType: 'ANONYMIZE' }),
    });
    await expect(mismatch.readStatus(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'EXPORT_RESPONSE_INVALID' });

    const failed = createExportRequestClient({ submit: vi.fn(), readStatus: vi.fn().mockRejectedValue(new Error('raw')) });
    await expect(failed.readStatus(session, status.requestId, status.requestType)).rejects.toMatchObject({ code: 'EXPORT_REQUEST_FAILED', clientStateDisposition: 'CLEAR_ALL' });
  });

  it('rejects non-string session and request id inputs with ClientError', async () => {
    const client = createExportRequestClient({ submit: vi.fn(), readStatus: vi.fn() });
    await expect(client.submit({ accountId: 42, token: 'token' } as unknown as typeof session, 'request', 'EXPORT')).rejects.toMatchObject({ code: 'EXPORT_SESSION_INVALID', clientStateDisposition: 'CLEAR_ALL' });
    await expect(client.submit(session, 42 as unknown as string, 'EXPORT')).rejects.toMatchObject({ code: 'EXPORT_REQUEST_ID_INVALID', clientStateDisposition: 'CLEAR_ALL' });
  });
});
