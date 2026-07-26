import type { Environment } from '../config/environment.js';

export const ROUTE_ACCESS_SNAPSHOT = Symbol('ROUTE_ACCESS_SNAPSHOT');
export type RouteAudience = 'TEST' | 'REAL_USER';
export type RouteAccessSnapshot = Readonly<{
  audience: RouteAudience;
  blockers: readonly string[];
  allowProtectedRoutes: boolean;
}>;

export function createRouteAccessSnapshot(input: {
  environment: Environment;
  audience: RouteAudience;
  authPolicyAvailable: boolean;
  authPolicyValid?: boolean;
  mfaVerifierAvailable: boolean;
  hmacKeyAvailable: boolean;
  currentConsentVersionAvailable: boolean;
  approvedConsentProviderAvailable?: boolean;
  screeningApprovalProviderAvailable?: boolean;
  profileSchemaProviderAvailable?: boolean;
}): RouteAccessSnapshot {
  const blockers = readinessBlockers(input.environment);
  if (!input.authPolicyAvailable) blockers.push('AUTH_POLICY_PROVIDER_UNAVAILABLE');
  else if (input.authPolicyValid === false) blockers.push('AUTH_SECURITY_POLICY_INVALID');
  if (!input.mfaVerifierAvailable) blockers.push('MFA_VERIFIER_UNAVAILABLE');
  if (!input.hmacKeyAvailable) blockers.push('HMAC_KEY_UNAVAILABLE');
  if (!input.currentConsentVersionAvailable) blockers.push('CURRENT_CONSENT_VERSION_UNAVAILABLE');
  if (!input.approvedConsentProviderAvailable) blockers.push('APPROVED_CONSENT_PROVIDER_UNAVAILABLE');
  if (!input.screeningApprovalProviderAvailable) blockers.push('SCREENING_APPROVAL_PROVIDER_UNAVAILABLE');
  if (!input.profileSchemaProviderAvailable) blockers.push('PROFILE_SCHEMA_PROVIDER_UNAVAILABLE');
  const isTestFixture = input.audience === 'TEST' && input.environment.nodeEnv === 'test';
  return Object.freeze({
    audience: input.audience,
    blockers: Object.freeze(blockers),
    allowProtectedRoutes: isTestFixture || (input.audience === 'REAL_USER' && blockers.length === 0),
  });
}

export function readinessBlockers(environment: Environment): string[] {
  const blockers: string[] = [];
  if (environment.demoMode) blockers.push('DEMO_MODE_ACTIVE');
  if (!environment.professionalRulesApproved) blockers.push('PROFESSIONAL_RULES_UNAPPROVED');
  if (!environment.authSecurityPolicyApproved) blockers.push('AUTH_SECURITY_POLICY_UNAPPROVED');
  if (!environment.privacyReviewApproved) blockers.push('PRIVACY_REVIEW_UNAPPROVED');
  if (!environment.dataRightsDrillComplete) blockers.push('DATA_RIGHTS_DRILL_INCOMPLETE');
  if (!environment.backupRestoreDrillComplete) blockers.push('BACKUP_RESTORE_DRILL_INCOMPLETE');
  if (!environment.operationsReadinessApproved) blockers.push('OPERATIONS_READINESS_INCOMPLETE');
  if (!environment.deploymentSecurityApproved) blockers.push('DEPLOYMENT_SECURITY_UNAPPROVED');
  return blockers;
}

export function isProtectedRoute(method: string, path: string): boolean {
  if (!/^\/api\/v1(?:\/|$)/.test(path)) return false;
  const route = `${method.toUpperCase()} ${path}`;
  if (route === 'GET /api/v1/readiness') return false;
  if (/^GET \/api\/v1\/demo\/personas\/[^/]+$/.test(route)) return false;
  return true;
}

export function isClassifiedProtectedRoute(method: string, path: string): boolean {
  const known = [
    /^POST \/api\/v1\/identity\/invitations$/,
    /^POST \/api\/v1\/identity\/password\/change$/,
    /^POST \/api\/v1\/identity\/sessions$/,
    /^GET \/api\/v1\/identity\/session$/,
    /^POST \/api\/v1\/identity\/session\/logout$/,
    /^POST \/api\/v1\/identity\/accounts\/[^/]+\/status$/,
    /^POST \/api\/v1\/onboarding\/consents$/,
    /^GET \/api\/v1\/onboarding\/consents\/current$/,
    /^POST \/api\/v1\/onboarding\/consents\/[^/]+\/withdraw$/,
    /^PUT \/api\/v1\/onboarding\/profile\/steps\/[^/]+$/,
    /^GET \/api\/v1\/onboarding\/profile$/,
    /^GET \/api\/v1\/onboarding\/screening-status$/,
    /^POST \/api\/v1\/onboarding\/screening-results$/,
    /^POST \/api\/v1\/plan-versions$/,
    /^GET \/api\/v1\/plan-versions\/[^/]+$/,
    /^POST \/api\/v1\/plan-versions\/[^/]+\/transitions$/,
    /^GET \/api\/v1\/users\/[^/]+\/plans\/(current|history|pending)$/,
    /^GET \/api\/v1\/users\/[^/]+\/task-candidates$/,
  ];
  return known.some((rule) => rule.test(`${method.toUpperCase()} ${path}`));
}
