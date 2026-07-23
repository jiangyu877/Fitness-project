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
          items: { type: 'string', enum: ['PROFESSIONAL_RULES_UNAPPROVED'] },
        },
      },
    },
  })
  getReadiness(): {
    readyForRealUsers: boolean;
    blockers: Array<'PROFESSIONAL_RULES_UNAPPROVED'>;
  } {
    const blockers: Array<'PROFESSIONAL_RULES_UNAPPROVED'> = [];
    if (!this.environment.professionalRulesApproved) {
      blockers.push('PROFESSIONAL_RULES_UNAPPROVED');
    }

    return {
      readyForRealUsers: blockers.length === 0,
      blockers,
    };
  }
}
