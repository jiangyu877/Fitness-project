import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';

export type AuthSecurityPolicy = {
  approved: boolean;
  passwordMinLength: number;
  sessionTtlSeconds: number;
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
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await runScrypt(password, Buffer.from(saltHex, 'hex'), Number(keyLength), {
    N: Number(cost), r: Number(blockSize), p: Number(parallelization),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateSessionCredential(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}

function requireApprovedPolicy(policy: AuthSecurityPolicy): void {
  if (!policy.approved) throw new Error('AUTH_SECURITY_POLICY_UNAPPROVED');
}

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
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
