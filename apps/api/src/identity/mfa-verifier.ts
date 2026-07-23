export const MFA_VERIFIER = Symbol('MFA_VERIFIER');

export type MfaVerifier = {
  verify(input: { accountId: string; challengeId: string }): Promise<boolean>;
};
