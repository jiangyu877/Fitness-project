import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ROUTE_ACCESS_SNAPSHOT, type RouteAccessSnapshot } from './route-access.js';

export const ENVIRONMENT = Symbol('ENVIRONMENT');

@ApiTags('readiness')
@Controller('api/v1/readiness')
export class ReadinessController {
  constructor(@Inject(ROUTE_ACCESS_SNAPSHOT) private readonly snapshot: RouteAccessSnapshot) {}

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
              'AUTH_POLICY_PROVIDER_UNAVAILABLE',
              'AUTH_SECURITY_POLICY_INVALID',
              'MFA_VERIFIER_UNAVAILABLE',
              'HMAC_KEY_UNAVAILABLE',
              'CURRENT_CONSENT_VERSION_UNAVAILABLE',
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
    return {
      readyForRealUsers: this.snapshot.audience === 'REAL_USER' && this.snapshot.allowProtectedRoutes,
      blockers: this.snapshot.blockers as ReadinessBlocker[],
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
  | 'DEPLOYMENT_SECURITY_UNAPPROVED'
  | 'AUTH_POLICY_PROVIDER_UNAVAILABLE'
  | 'AUTH_SECURITY_POLICY_INVALID'
  | 'MFA_VERIFIER_UNAVAILABLE'
  | 'HMAC_KEY_UNAVAILABLE'
  | 'CURRENT_CONSENT_VERSION_UNAVAILABLE';
