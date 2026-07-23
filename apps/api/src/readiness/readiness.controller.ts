import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Environment } from '../config/environment.js';

export const ENVIRONMENT = Symbol('ENVIRONMENT');

@ApiTags('readiness')
@Controller('api/v1/readiness')
export class ReadinessController {
  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['readyForRealUsers', 'blockers'],
      properties: {
        readyForRealUsers: { type: 'boolean' },
        blockers: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'DEMO_MODE_ACTIVE',
              'PROFESSIONAL_RULES_UNAPPROVED',
              'AUTH_SECURITY_POLICY_UNAPPROVED',
              'PRIVACY_REVIEW_UNAPPROVED',
              'DATA_RIGHTS_DRILL_INCOMPLETE',
              'BACKUP_RESTORE_DRILL_INCOMPLETE',
              'OPERATIONS_READINESS_INCOMPLETE',
              'DEPLOYMENT_SECURITY_UNAPPROVED',
            ],
          },
        },
      },
    },
  })
  getReadiness(): {
    readyForRealUsers: boolean;
    blockers: ReadinessBlocker[];
  } {
    const blockers: ReadinessBlocker[] = [];
    if (this.environment.demoMode) blockers.push('DEMO_MODE_ACTIVE');
    if (!this.environment.professionalRulesApproved) {
      blockers.push('PROFESSIONAL_RULES_UNAPPROVED');
    }
    if (!this.environment.authSecurityPolicyApproved) {
      blockers.push('AUTH_SECURITY_POLICY_UNAPPROVED');
    }
    if (!this.environment.privacyReviewApproved) {
      blockers.push('PRIVACY_REVIEW_UNAPPROVED');
    }
    if (!this.environment.dataRightsDrillComplete) {
      blockers.push('DATA_RIGHTS_DRILL_INCOMPLETE');
    }
    if (!this.environment.backupRestoreDrillComplete) {
      blockers.push('BACKUP_RESTORE_DRILL_INCOMPLETE');
    }
    if (!this.environment.operationsReadinessApproved) {
      blockers.push('OPERATIONS_READINESS_INCOMPLETE');
    }
    if (!this.environment.deploymentSecurityApproved) {
      blockers.push('DEPLOYMENT_SECURITY_UNAPPROVED');
    }

    return {
      readyForRealUsers: blockers.length === 0,
      blockers,
    };
  }
}

type ReadinessBlocker =
  | 'DEMO_MODE_ACTIVE'
  | 'PROFESSIONAL_RULES_UNAPPROVED'
  | 'AUTH_SECURITY_POLICY_UNAPPROVED'
  | 'PRIVACY_REVIEW_UNAPPROVED'
  | 'DATA_RIGHTS_DRILL_INCOMPLETE'
  | 'BACKUP_RESTORE_DRILL_INCOMPLETE'
  | 'OPERATIONS_READINESS_INCOMPLETE'
  | 'DEPLOYMENT_SECURITY_UNAPPROVED';
