import { describe, expect, it } from 'vitest';
import {
  generateSessionCredential,
  hashPassword,
  verifyPassword,
  validateAuthSecurityPolicy,
  type AuthSecurityPolicy,
} from '../src/identity-security.js';

const approvedPolicy: AuthSecurityPolicy = {
  approved: true,
  passwordMinLength: 10,
  sessionTtlSeconds: 900,
  passwordChangeTtlSeconds: 300,
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

  it.each([
    ['passwordMinLength', 0],
    ['sessionTtlSeconds', 0],
    ['passwordChangeTtlSeconds', 0],
    ['passwordChangeTtlSeconds', 900],
    ['maxFailedAttempts', 0],
    ['scryptCost', 12_000],
    ['scryptBlockSize', 0],
    ['scryptParallelization', 0],
    ['scryptKeyLength', 0],
  ] as const)('rejects invalid policy invariant %s=%s', (field, value) => {
    expect(() => validateAuthSecurityPolicy({ ...approvedPolicy, [field]: value })).toThrow();
  });

  it('generates an opaque session token and a distinct stored digest', () => {
    const credential = generateSessionCredential();
    expect(credential.token).not.toBe(credential.tokenHash);
    expect(credential.token).toHaveLength(64);
    expect(credential.tokenHash).toHaveLength(64);
  });

  it('rejects an executable-memory overflow policy before invoking Node scrypt', async () => {
    const oversized = { ...approvedPolicy, scryptCost: 2 ** 20, scryptBlockSize: 8 };
    expect(() => validateAuthSecurityPolicy(oversized)).toThrow(/AUTH_SECURITY_POLICY_INVALID/);
    await expect(hashPassword('local-test-password', oversized)).rejects.toThrow(/AUTH_SECURITY_POLICY_INVALID/);
  });

  it('rejects excessive CPU work in both policy and encoded-hash validation', async () => {
    const excessive = {
      ...approvedPolicy, scryptCost: 2 ** 15, scryptBlockSize: 1, scryptParallelization: 2 ** 15,
    };
    expect(() => validateAuthSecurityPolicy(excessive)).toThrow(/AUTH_SECURITY_POLICY_INVALID/);
    await expect(hashPassword('local-test-password', excessive)).rejects.toThrow(/AUTH_SECURITY_POLICY_INVALID/);
    const encoded = `scrypt$32768$1$32768$32$${'00'.repeat(16)}$${'00'.repeat(32)}`;
    await expect(verifyPassword('local-test-password', encoded)).resolves.toBe(false);
  });

  it('validates, hashes, and verifies the maximum supported cost boundary', async () => {
    const boundary = { ...approvedPolicy, scryptCost: 2 ** 15, scryptBlockSize: 8 };
    expect(() => validateAuthSecurityPolicy(boundary)).not.toThrow();
    const encoded = await hashPassword('local-test-password', boundary);
    await expect(verifyPassword('local-test-password', encoded)).resolves.toBe(true);
  }, 10_000);
});
