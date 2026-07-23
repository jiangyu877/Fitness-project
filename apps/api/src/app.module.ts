import { type DynamicModule, Module } from '@nestjs/common';
import type { Environment } from './config/environment.js';
import { DemoController } from './demo/demo.controller.js';
import { HealthController } from './health.controller.js';
import { ENVIRONMENT, ReadinessController } from './readiness/readiness.controller.js';
import { PlanLifecycleController } from './plans/plan-lifecycle.controller.js';
import { PlanLifecycleService } from './plans/plan-lifecycle.service.js';
import { DatabaseService } from './database/database.service.js';
import { IdentityOnboardingController } from './identity/identity-onboarding.controller.js';
import { AUTH_POLICY, IdentityOnboardingService } from './identity/identity-onboarding.service.js';
import type { AuthSecurityPolicy } from '@lianban/domain';

@Module({})
export class AppModule {
  static forEnvironment(environment: Environment, authPolicy: AuthSecurityPolicy | null = null): DynamicModule {
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
        PlanLifecycleService,
        DatabaseService,
        IdentityOnboardingService,
        { provide: AUTH_POLICY, useValue: authPolicy },
      ],
    };
  }
}
