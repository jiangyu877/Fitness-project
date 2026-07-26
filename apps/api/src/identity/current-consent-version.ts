export const CURRENT_CONSENT_VERSION = Symbol('CURRENT_CONSENT_VERSION');

export type CurrentConsentVersionProvider = {
  getCurrentConsentVersion(): Promise<string>;
};
