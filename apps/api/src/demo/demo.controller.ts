import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { getDemoFixture, type DemoFixture } from './demo-fixtures.js';

@ApiTags('demo')
@Controller('api/v1/demo/personas')
export class DemoController {
  @Get(':fixtureId')
  @ApiParam({
    name: 'fixtureId',
    enum: ['persona_fat_loss', 'persona_muscle_gain'],
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: [
        'fixtureId',
        'goalType',
        'demoOnly',
        'reviewStatus',
        'publishable',
        'disclaimer',
      ],
      properties: {
        fixtureId: {
          type: 'string',
          enum: ['persona_fat_loss', 'persona_muscle_gain'],
        },
        goalType: { type: 'string', enum: ['FAT_LOSS', 'MUSCLE_GAIN'] },
        demoOnly: { type: 'boolean', enum: [true] },
        reviewStatus: { type: 'string', enum: ['DEMO_UNREVIEWED'] },
        publishable: { type: 'boolean', enum: [false] },
        disclaimer: {
          type: 'string',
          enum: ['仅用于原型演示，未经专业审核'],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Fixture ID is not registered' })
  getFixture(@Param('fixtureId') fixtureId: string): DemoFixture {
    const fixture = getDemoFixture(fixtureId);
    if (!fixture) {
      throw new NotFoundException({
        businessStatus: 'DEMO_FIXTURE_NOT_FOUND',
        errorCode: 'DEMO_FIXTURE_NOT_FOUND',
        recoverableActions: [],
      });
    }
    return fixture;
  }
}
