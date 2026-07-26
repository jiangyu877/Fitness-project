import { describe, expect, it } from 'vitest';
import { normalizeStableSecurityError } from '../src/application.js';

const structured = {
  businessStatus: 'WRITE_REJECTED',
  errorCode: 'SESSION_INVALID',
  recoverableActions: ['LOGIN'],
};

describe('stable security error normalization', () => {
  it.each([
    ['primitive', 'denied'],
    ['array', [structured]],
  ])('delegates target-status %s responses to the Nest default filter', (_case, response) => {
    expect(normalizeStableSecurityError(401, response, 'generated')).toBeNull();
  });

  it.each([404, 409])('delegates status %s to the Nest default filter', (status) => {
    expect(normalizeStableSecurityError(status, structured, 'generated')).toBeNull();
  });

  it('whitelists documented fields and strips sensitive extras', () => {
    expect(normalizeStableSecurityError(403, {
      ...structured,
      requestId: 'existing',
      password: 'must-not-leak',
      token: 'must-not-leak',
      internal: { secret: true },
    }, 'generated')).toEqual({ ...structured, requestId: 'existing' });
  });

  it('adds a server request id only to a structured target-status response', () => {
    expect(normalizeStableSecurityError(503, structured, 'generated')).toEqual({
      ...structured, requestId: 'generated',
    });
  });
});
