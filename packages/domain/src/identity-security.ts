import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';

export const SCRYPT_MAXMEM_BYTES = 64 * 1024 * 1024;
export const SCRYPT_MAX_WORK = 262_144;
export const SCRYPT_MAX_PARALLELIZATION = 16;

export type AuthSecurityPolicy = {
  approved: boolean;
  passwordMinLength: number;
  sessionTtlSeconds: number;
  passwordChangeTtlSeconds: number;
  maxFailedAttempts: number;
  mfaRequiredForStaff: boolean;
  scryptCost: number;
  scryptBlockSize: number;
  scryptParallelization: number;
  scryptKeyLength: number;
};

export async function hashPassword(
  password: string,
  policy: AuthSecurityPolicy,
): Promise<string> {
  requireApprovedPolicy(policy);
  if (password.length < policy.passwordMinLength) {
    throw new Error('PASSWORD_POLICY_NOT_SATISFIED');
  }
  const salt = randomBytes(16);
  const derived = await derive(password, salt, policy);
  return [
    'scrypt',
    policy.scryptCost,
    policy.scryptBlockSize,
    policy.scryptParallelization,
    policy.scryptKeyLength,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, keyLength, saltHex, hashHex] =
    encoded.split('$');
  if (
    algorithm !== 'scrypt' || !cost || !blockSize || !parallelization ||
    !keyLength || !saltHex || !hashHex
  ) {
    return false;
  }
  const parameters = { N: Number(cost), r: Number(blockSize), p: Number(parallelization) };
  const parsedKeyLength = Number(keyLength);
  try {
    validateScryptExecution(parameters.N, parameters.r, parameters.p, parsedKeyLength);
  } catch {
    return false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await runScrypt(password, Buffer.from(saltHex, 'hex'), parsedKeyLength, parameters);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateSessionCredential(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}

export function validateAuthSecurityPolicy(policy: AuthSecurityPolicy): void {
  if (!policy.approved) throw new Error('AUTH_SECURITY_POLICY_UNAPPROVED');
  if (!Number.isInteger(policy.passwordMinLength) || policy.passwordMinLength <= 0
    || !Number.isInteger(policy.sessionTtlSeconds) || policy.sessionTtlSeconds <= 0
    || !Number.isInteger(policy.maxFailedAttempts) || policy.maxFailedAttempts <= 0
    || typeof policy.mfaRequiredForStaff !== 'boolean') {
    throw new Error('AUTH_SECURITY_POLICY_INVALID');
  }
  if (!Number.isInteger(policy.passwordChangeTtlSeconds)
    || policy.passwordChangeTtlSeconds <= 0
    || policy.passwordChangeTtlSeconds > 600
    || policy.passwordChangeTtlSeconds >= policy.sessionTtlSeconds) {
    throw new Error('PASSWORD_CHANGE_TTL_POLICY_INVALID');
  }
  validateScryptExecution(
    policy.scryptCost, policy.scryptBlockSize, policy.scryptParallelization, policy.scryptKeyLength,
  );
}

const requireApprovedPolicy = validateAuthSecurityPolicy;

async function derive(
  password: string,
  salt: Buffer,
  policy: AuthSecurityPolicy,
): Promise<Buffer> {
  return runScrypt(password, salt, policy.scryptKeyLength, {
    N: policy.scryptCost,
    r: policy.scryptBlockSize,
    p: policy.scryptParallelization,
  });
}

function runScrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { ...options, maxmem: SCRYPT_MAXMEM_BYTES }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function validateScryptExecution(N: number, r: number, p: number, keyLength: number): void {
  if (![N, r, p, keyLength].every(Number.isSafeInteger)
    || N <= 1 || (BigInt(N) & (BigInt(N) - 1n)) !== 0n
    || r <= 0 || p <= 0 || keyLength <= 0) {
    throw new Error('AUTH_SECURITY_POLICY_INVALID');
  }
  const requiredBytes = 128n * BigInt(N) * BigInt(r) + 128n * BigInt(r) * BigInt(p) + BigInt(keyLength);
  if (requiredBytes > BigInt(SCRYPT_MAXMEM_BYTES)) throw new Error('AUTH_SECURITY_POLICY_INVALID');
  const work = BigInt(N) * BigInt(r) * BigInt(p);
  if (p > SCRYPT_MAX_PARALLELIZATION || work > BigInt(SCRYPT_MAX_WORK)) {
    throw new Error('AUTH_SECURITY_POLICY_INVALID');
  }
}
