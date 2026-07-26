import { describe, expect, it, vi } from 'vitest';

import { P07ClientError, createP07Client } from './p07-client.js';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'x-request-id': 'server-request-1' } });
}

const session = { accountId: 'user-1', token: 'user-token' };

describe('P07 client', () => {
  it('reads the current consent from the authenticated USER scope without local content', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      businessStatus: 'CURRENT_CONSENT_AVAILABLE', consentVersion: 'consent-v2', content: { format: 'PLAIN_TEXT', text: 'server-approved-content' },
    }));
    const client = createP07Client({ fetcher });

    await expect(client.currentConsent(session)).resolves.toEqual({
      businessStatus: 'CURRENT_CONSENT_AVAILABLE', consentVersion: 'consent-v2', content: { format: 'PLAIN_TEXT', text: 'server-approved-content' },
    });
    const init = fetcher.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-token');
  });

  it('accepts only the server consent version and returns the structured result', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      businessStatus: 'CONSENT_ACCEPTED', requestId: 'server-request-1', consentId: 'consent-1', consentVersion: 'consent-v2', version: 1,
    }, 201));
    const client = createP07Client({ fetcher, requestId: () => 'request-1', idempotencyKey: () => 'key-1' });

    await expect(client.acceptConsent(session, 'consent-v2')).resolves.toEqual({
      businessStatus: 'CONSENT_ACCEPTED', consentId: 'consent-1', consentVersion: 'consent-v2', version: 1,
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ consentVersion: 'consent-v2' });
  });

  it('fails closed when the consent provider is unavailable', async () => {
    const client = createP07Client({ fetcher: vi.fn().mockResolvedValue(response({
      businessStatus: 'IDENTITY_BLOCKED', errorCode: 'CURRENT_CONSENT_VERSION_UNAVAILABLE', recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'], requestId: 'server-request-1',
    }, 503)) });

    await expect(client.currentConsent(session)).rejects.toMatchObject({
      status: 503, code: 'CURRENT_CONSENT_VERSION_UNAVAILABLE', recoverableActions: ['WAIT_FOR_SECURITY_APPROVAL'],
    });
  });

  it.each([
    ['WAIT_FOR_SCREENING_RULES', null],
    ['WAIT_FOR_HUMAN_REVIEW', 'HUMAN_REVIEW'],
    ['STOP_SERVICE_FLOW', 'EXCLUDED'],
    ['COMPLETE_PROFILE', 'PASS'],
    ['WAIT_FOR_PLAN', 'PASS'],
  ] as const)('consumes server screening state %s without exposing professional content', async (nextAction, conclusion) => {
    const client = createP07Client({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus: 'SCREENING_STATUS_AVAILABLE', nextAction, conclusion })) });

    await expect(client.screeningStatus(session)).resolves.toEqual({ businessStatus: 'SCREENING_STATUS_AVAILABLE', nextAction, conclusion });
  });

  it.each([
    ['WAIT_FOR_SCREENING_RULES', 'PASS'],
    ['WAIT_FOR_HUMAN_REVIEW', 'EXCLUDED'],
    ['STOP_SERVICE_FLOW', 'HUMAN_REVIEW'],
    ['COMPLETE_PROFILE', null],
    ['WAIT_FOR_PLAN', 'EXCLUDED'],
  ] as const)('rejects conflicting screening combination %s/%s', async (nextAction, conclusion) => {
    const client = createP07Client({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus: 'SCREENING_STATUS_AVAILABLE', nextAction, conclusion })) });
    await expect(client.screeningStatus(session)).rejects.toMatchObject({ code: 'P07_RESPONSE_INVALID' });
  });

  it('does not invent a profile schema when the profile contract is unavailable', async () => {
    const client = createP07Client({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus: 'PROFILE_DRAFT_AVAILABLE' })) });

    await expect(client.profile(session)).rejects.toMatchObject({
      status: 502, code: 'PROFILE_SCHEMA_UNAVAILABLE', recoverableActions: ['CONTACT_OPERATIONS'],
    });
    expect(client).toBeDefined();
    expect(P07ClientError).toBeDefined();
  });

  it('reads the ordered approved schema and saves a step with the exact contract body', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ businessStatus: 'PROFILE_DRAFT_AVAILABLE', schemaVersion: 'profile-v1', steps: [{ id: 'basics', fields: [{ name: 'age', type: 'NUMBER', required: true }, { name: 'active', type: 'BOOLEAN' }] }], recordVersion: 0, completedSteps: [], currentStep: 'basics', drafts: {} }))
      .mockResolvedValueOnce(response({ businessStatus: 'PROFILE_DRAFT_SAVED', requestId: 'server-request-1', version: 1 }));
    const client = createP07Client({ fetcher, requestId: () => 'request-1', idempotencyKey: () => 'key-1' });

    await expect(client.profile(session)).resolves.toMatchObject({ schemaVersion: 'profile-v1', steps: [{ id: 'basics' }], recordVersion: 0 });
    await expect(client.saveProfileStep(session, 'basics', { schemaVersion: 'profile-v1', expectedVersion: 0, data: { age: 30, active: true } })).resolves.toEqual({ businessStatus: 'PROFILE_DRAFT_SAVED', requestId: 'server-request-1', version: 1 });
    expect(fetcher.mock.calls[1]![0]).toBe('/api/v1/onboarding/profile/steps/basics');
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ schemaVersion: 'profile-v1', expectedVersion: 0, data: { age: 30, active: true } });
    const headers = new Headers(fetcher.mock.calls[1]![1].headers);
    expect(headers.get('Authorization')).toBe('Bearer user-token');
    expect(headers.get('x-request-id')).toBe('request-1');
    expect(headers.get('idempotency-key')).toBe('key-1');
  });

  it('rejects a saved profile response without the required requestId', async () => {
    const client = createP07Client({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus: 'PROFILE_DRAFT_SAVED', version: 1 })) });
    await expect(client.saveProfileStep(session, 'basics', { schemaVersion: 'profile-v1', expectedVersion: 0, data: { age: 30 } })).rejects.toMatchObject({ code: 'P07_RESPONSE_INVALID' });
  });

  it.each([
    { businessStatus: 'PROFILE_DRAFT_AVAILABLE', schemaVersion: 'v1', steps: [], recordVersion: 0, completedSteps: [], currentStep: null, drafts: {} },
    { businessStatus: 'PROFILE_DRAFT_AVAILABLE', schemaVersion: 'v1', steps: [{ id: 'basics', fields: [{ name: 'age', type: 'UNSAFE' }] }], recordVersion: 0, completedSteps: [], currentStep: 'basics', drafts: {} },
    { businessStatus: 'PROFILE_DRAFT_AVAILABLE', schemaVersion: 'v1', steps: [{ id: 'basics', fields: [{ name: 'age', type: 'NUMBER' }] }], recordVersion: 0, completedSteps: [], currentStep: 'unknown', drafts: {} },
  ])('blocks malformed profile response', async (body) => {
    const client = createP07Client({ fetcher: vi.fn().mockResolvedValue(response(body)) });
    await expect(client.profile(session)).rejects.toMatchObject({ code: 'PROFILE_SCHEMA_UNAVAILABLE', recoverableActions: ['CONTACT_OPERATIONS'] });
  });

  it('preserves structured version conflict and server refresh action', async () => {
    const client = createP07Client({ fetcher: vi.fn().mockResolvedValue(response({ businessStatus: 'VERSION_CONFLICT', errorCode: 'VERSION_CONFLICT', recoverableActions: ['REFRESH'] }, 409)) });
    await expect(client.saveProfileStep(session, 'basics', { schemaVersion: 'profile-v1', expectedVersion: 0, data: { age: 30 } })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT', recoverableActions: ['REFRESH'] });
  });

});
