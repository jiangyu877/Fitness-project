import { type DynamicModule, Module } from '@nestjs/common';
import type { Environment } from './config/environment.js';
import { DemoController } from './demo/demo.controller.js';
import { HealthController } from './health.controller.js';
import { ENVIRONMENT, ReadinessController } from './readiness/readiness.controller.js';
import { PlanLifecycleController } from './plans/plan-lifecycle.controller.js';
import { PlanLifecycleService } from './plans/plan-lifecycle.service.js';

@Module({})
export class AppModule {
  static forEnvironment(environment: Environment): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        ReadinessController,
        PlanLifecycleController,
        ...(environment.demoMode ? [DemoController] : []),
      ],
      providers: [
        { provide: ENVIRONMENT, useValue: environment },
        PlanLifecycleService,
      ],
    };
  }
}
