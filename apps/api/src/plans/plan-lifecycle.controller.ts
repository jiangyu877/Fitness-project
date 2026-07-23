import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { PlanLifecycleService, type ContentMode } from './plan-lifecycle.service.js';

const createSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  effectiveAt: z.string().datetime({ offset: true }),
  effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
  contentMode: z.enum(['REVIEWED', 'DEMO_UNREVIEWED']).default('REVIEWED'),
});

const transitionSchema = z.object({
  type: z.enum([
    'SUBMIT_REVIEW',
    'APPROVE_DIET',
    'APPROVE_TRAINING',
    'REJECT_DIET_REVIEW',
    'REJECT_TRAINING_REVIEW',
    'PUBLISH',
    'CONFIRM_DIET',
    'CONFIRM_TRAINING',
    'REJECT_DIET',
    'REJECT_TRAINING',
    'EXPIRE_CONFIRMATION',
    'ACTIVATE',
    'SUPERSEDE',
  ]),
  actorId: z.string().min(1).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  reasonCode: z.string().min(1).optional(),
});

const planStatuses = [
  'DRAFT',
  'IN_REVIEW',
  'READY_TO_PUBLISH',
  'PENDING_CONFIRMATION',
  'SCHEDULED',
  'ACTIVE',
  'STAFF_REVISION_REQUIRED',
  'USER_REVISION_REQUIRED',
  'CONFIRMATION_TIMED_OUT',
  'SUPERSEDED',
] as const;

const transitionTypes = transitionSchema.shape.type.options;

const planVersionSchema = {
  type: 'object',
  required: ['id', 'userId', 'status', 'confirmationDeadlineAt', 'effectiveAt'],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    status: { type: 'string', enum: [...planStatuses] },
    confirmationDeadlineAt: { type: 'string', format: 'date-time' },
    effectiveAt: { type: 'string', format: 'date-time' },
    effectiveTo: { type: 'string', format: 'date-time', nullable: true },
    rejectionReasonCode: { type: 'string', nullable: true },
  },
};

const conflictSchema = {
  type: 'object',
  required: ['businessStatus', 'errorCode', 'recoverableActions'],
  properties: {
    businessStatus: {
      type: 'string',
      enum: ['PUBLICATION_BLOCKED', 'PLAN_TRANSITION_BLOCKED', 'CONFIRMATION_CLOSED'],
    },
    errorCode: {
      type: 'string',
      enum: [
        'PROFESSIONAL_RULES_UNAPPROVED',
        'DEMO_CONTENT_REFERENCED',
        'SINGLE_PENDING_VERSION_REQUIRED',
        'PUBLICATION_LEAD_TIME_INSUFFICIENT',
        'CONFIRMATION_DEADLINE_PASSED',
        'EFFECTIVE_TIME_NOT_REACHED',
        'STATE_TRANSITION_NOT_ALLOWED',
      ],
    },
    recoverableActions: { type: 'array', items: { type: 'string' } },
  },
};

@ApiTags('plan-lifecycle')
@Controller('api/v1')
export class PlanLifecycleController {
  constructor(
    @Inject(PlanLifecycleService) private readonly service: PlanLifecycleService,
  ) {}

  @Post('plan-versions')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['id', 'userId', 'effectiveAt'],
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        effectiveAt: { type: 'string', format: 'date-time' },
        effectiveTo: { type: 'string', format: 'date-time', nullable: true },
        contentMode: { type: 'string', enum: ['REVIEWED', 'DEMO_UNREVIEWED'] },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Created draft plan version', schema: planVersionSchema })
  create(@Body() body: unknown) {
    const input = createSchema.parse(body);
    return this.service.create({
      id: input.id,
      userId: input.userId,
      effectiveAt: new Date(input.effectiveAt),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      contentMode: input.contentMode as ContentMode,
    });
  }

  @Get('plan-versions/:id')
  @ApiParam({ name: 'id', type: 'string' })
  @ApiOkResponse({ description: 'Plan version', schema: planVersionSchema })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('plan-versions/:id/transitions')
  @HttpCode(200)
  @ApiParam({ name: 'id', type: 'string' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { type: 'string', enum: [...transitionTypes] },
        actorId: { type: 'string' },
        occurredAt: { type: 'string', format: 'date-time' },
        reasonCode: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'Transitioned plan version', schema: planVersionSchema })
  @ApiConflictResponse({ description: 'Business guard blocked transition', schema: conflictSchema })
  transition(@Param('id') id: string, @Body() body: unknown) {
    const parsed = transitionSchema.parse(body);
    return this.service.transition(id, toPlanEvent(parsed));
  }

  @Get('users/:userId/plans/current')
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiOkResponse({
    description: 'Current plan or explicit gap',
    schema: {
      type: 'object',
      required: ['businessStatus', 'plan'],
      properties: {
        businessStatus: { type: 'string', enum: ['CURRENT_PLAN', 'PLAN_GAP'] },
        plan: { ...planVersionSchema, nullable: true },
      },
    },
  })
  current(@Param('userId') userId: string, @Query('at') at?: string) {
    const now = at ? new Date(at) : new Date();
    const resolved = this.service.current(userId, now);
    return resolved.plan
      ? { businessStatus: 'CURRENT_PLAN', plan: resolved.plan }
      : { businessStatus: 'PLAN_GAP', plan: null };
  }

  @Get('users/:userId/plans/history')
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiOkResponse({
    description: 'Read-only plan history',
    schema: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: planVersionSchema } },
    },
  })
  history(@Param('userId') userId: string) {
    return { items: this.service.history(userId) };
  }
}

function toPlanEvent(input: z.infer<typeof transitionSchema>) {
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : undefined;
  switch (input.type) {
    case 'SUBMIT_REVIEW':
      return { type: input.type } as const;
    case 'APPROVE_DIET':
      if (!input.actorId) throw new Error('ACTOR_ID_REQUIRED');
      return { type: input.type, actorId: input.actorId } as const;
    case 'APPROVE_TRAINING':
      if (!input.actorId) throw new Error('ACTOR_ID_REQUIRED');
      return { type: input.type, actorId: input.actorId } as const;
    case 'REJECT_DIET_REVIEW':
      if (!input.actorId) throw new Error('ACTOR_ID_REQUIRED');
      if (!input.reasonCode) throw new Error('REASON_CODE_REQUIRED');
      return {
        type: input.type,
        actorId: input.actorId,
        reasonCode: input.reasonCode,
      } as const;
    case 'REJECT_TRAINING_REVIEW':
      if (!input.actorId) throw new Error('ACTOR_ID_REQUIRED');
      if (!input.reasonCode) throw new Error('REASON_CODE_REQUIRED');
      return {
        type: input.type,
        actorId: input.actorId,
        reasonCode: input.reasonCode,
      } as const;
    case 'PUBLISH':
    case 'CONFIRM_DIET':
    case 'CONFIRM_TRAINING':
    case 'EXPIRE_CONFIRMATION':
    case 'ACTIVATE':
    case 'SUPERSEDE':
      if (!occurredAt) throw new Error('OCCURRED_AT_REQUIRED');
      return { type: input.type, occurredAt } as const;
    case 'REJECT_DIET':
    case 'REJECT_TRAINING':
      if (!occurredAt) throw new Error('OCCURRED_AT_REQUIRED');
      if (!input.reasonCode) throw new Error('REASON_CODE_REQUIRED');
      return { type: input.type, occurredAt, reasonCode: input.reasonCode } as const;
  }
}
