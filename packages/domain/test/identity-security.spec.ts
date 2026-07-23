import { describe, expect, it } from 'vitest';
import {
  generateSessionCredential,
  hashPassword,
  verifyPassword,
  type AuthSecurityPolicy,
} from '../src/identity-security.js';

const approvedPolicy: AuthSecurityPolicy = {
  approved: true,
  passwordMinLength: 10,
  sessionTtlSeconds: 900,
  maxFailedAttempts: 3,
  mfaRequiredForStaff: true,
  scryptCost: 16_384,
  scryptBlockSize: 8,
  scryptParallelization: 1,
  scryptKeyLength: 32,
};

describe('identity security primitives', () => {
  it('hashes passwords with a random salt and verifies without exposing plaintext', async () => {
    const first = await hashPassword('local-test-password', approvedPolicy);
    const second = await hashPassword('local-test-password', approvedPolicy);

    expect(first).not.toContain('local-test-password');
    expect(first).not.toBe(second);
    await expect(verifyPassword('local-test-password', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', first)).resolves.toBe(false);
  });

  it('rejects use when the external authentication policy is not approved', async () => {
    await expect(hashPassword('local-test-password', {
      ...approvedPolicy,
      approved: false,
    })).rejects.toThrow(/AUTH_SECURITY_POLICY_UNAPPROVED/);
  });

  it('generates an opaque session token and a distinct stored digest', () => {
    const credential = generateSessionCredential();
    expect(credential.token).not.toBe(credential.tokenHash);
    expect(credential.token).toHaveLength(64);
    expect(credential.tokenHash).toHaveLength(64);
  });
});
