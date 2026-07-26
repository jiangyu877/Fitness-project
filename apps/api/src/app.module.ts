import { type DynamicModule, Module } from '@nestjs/common';
import type { Environment } from './config/environment.js';
import { DemoController } from './demo/demo.controller.js';
import { HealthController } from './health.controller.js';
import { ENVIRONMENT, ReadinessController } from './readiness/readiness.controller.js';
import { PlanLifecycleController } from './plans/plan-lifecycle.controller.js';
import { PlanLifecycleService } from './plans/plan-lifecycle.service.js';
import { PLAN_LIFECYCLE_CLOCK, type PlanLifecycleClock } from './plans/plan-lifecycle.service.js';
import { DatabaseService } from './database/database.service.js';
import { IdentityOnboardingController } from './identity/identity-onboarding.controller.js';
import { AUTH_POLICY, IdentityOnboardingService, PROFILE_FINGERPRINT_SECRET } from './identity/identity-onboarding.service.js';
import { validateAuthSecurityPolicy, type AuthSecurityPolicy } from '@lianban/domain';
import { MFA_VERIFIER, type MfaVerifier } from './identity/mfa-verifier.js';
import { CURRENT_CONSENT_VERSION, type CurrentConsentVersionProvider } from './identity/current-consent-version.js';
import { createRouteAccessSnapshot, ROUTE_ACCESS_SNAPSHOT, type RouteAccessSnapshot } from './readiness/route-access.js';

@Module({})
export class AppModule {
  static forEnvironment(
    environment: Environment,
    authPolicy: AuthSecurityPolicy | null = null,
    mfaVerifier: MfaVerifier | null = null,
    profileFingerprintSecret: string | null = null,
    currentConsentVersion: CurrentConsentVersionProvider | null = null,
    routeAccessSnapshot: RouteAccessSnapshot | null = null,
    planClock: PlanLifecycleClock = {},
  ): DynamicModule {
    const pinnedAuthPolicy = authPolicy ? Object.freeze({ ...authPolicy }) : null;
    const injectedPlanClock = environment.nodeEnv === 'test' ? planClock : {};
    const injectedTestSnapshot = environment.nodeEnv === 'test' && routeAccessSnapshot?.audience === 'TEST'
      ? routeAccessSnapshot
      : null;
    const authPolicyValid = isValidAuthPolicy(pinnedAuthPolicy);
    const snapshot = injectedTestSnapshot ?? createRouteAccessSnapshot({
      environment,
      audience: 'REAL_USER',
      authPolicyAvailable: Boolean(pinnedAuthPolicy),
      authPolicyValid,
      mfaVerifierAvailable: Boolean(mfaVerifier),
      hmacKeyAvailable: Boolean(profileFingerprintSecret),
      currentConsentVersionAvailable: Boolean(currentConsentVersion),
    });
    return {
      module: AppModule,
      controllers: [
        HealthController,
        ReadinessController,
        PlanLifecycleController,
        IdentityOnboardingController,
        ...(environment.demoMode ? [DemoController] : []),
      ],
      providers: [
        { provide: ENVIRONMENT, useValue: environment },
        { provide: ROUTE_ACCESS_SNAPSHOT, useValue: snapshot },
        PlanLifecycleService,
        { provide: PLAN_LIFECYCLE_CLOCK, useValue: injectedPlanClock },
        DatabaseService,
        IdentityOnboardingService,
        { provide: AUTH_POLICY, useValue: pinnedAuthPolicy },
        { provide: MFA_VERIFIER, useValue: mfaVerifier },
        { provide: PROFILE_FINGERPRINT_SECRET, useValue: profileFingerprintSecret },
        { provide: CURRENT_CONSENT_VERSION, useValue: currentConsentVersion },
      ],
    };
  }
}

function isValidAuthPolicy(policy: AuthSecurityPolicy | null): boolean {
  if (!policy) return false;
  try {
    validateAuthSecurityPolicy(policy);
    return true;
  } catch {
    return false;
  }
}
