import type { AuthSecurityPolicy } from '@lianban/domain';

import { buildApplication as buildProductionApplication } from '../src/application.js';
import type { Environment } from '../src/config/environment.js';
import type { CurrentConsentVersionProvider } from '../src/identity/current-consent-version.js';
import type { MfaVerifier } from '../src/identity/mfa-verifier.js';
import type { PlanLifecycleClock } from '../src/plans/plan-lifecycle.service.js';
import type { CurrentConsentProvider, ProfileSchemaProvider, ScreeningApprovalProvider } from '../src/identity/p07-providers.js';
import { createRouteAccessSnapshot, type RouteAccessSnapshot } from '../src/readiness/route-access.js';

type TestApplicationOptions = {
  authPolicy?: AuthSecurityPolicy;
  mfaVerifier?: MfaVerifier;
  profileFingerprintSecret?: string;
  currentConsentVersion?: CurrentConsentVersionProvider;
  routeAccessSnapshot?: RouteAccessSnapshot;
  planClock?: PlanLifecycleClock;
  consentProvider?: CurrentConsentProvider;
  screeningProvider?: ScreeningApprovalProvider;
  profileSchemaProvider?: ProfileSchemaProvider;
};

export function buildApplication(environment: Environment, options: TestApplicationOptions = {}) {
  const routeAccessSnapshot = options.routeAccessSnapshot ?? createRouteAccessSnapshot({
    environment,
    audience: 'TEST',
    authPolicyAvailable: true,
    mfaVerifierAvailable: true,
    hmacKeyAvailable: true,
    currentConsentVersionAvailable: true,
    approvedConsentProviderAvailable: Boolean(options.consentProvider),
    screeningApprovalProviderAvailable: Boolean(options.screeningProvider),
    profileSchemaProviderAvailable: Boolean(options.profileSchemaProvider),
  });
  return buildProductionApplication(environment, {
    ...options,
    routeAccessSnapshot,
  });
}
