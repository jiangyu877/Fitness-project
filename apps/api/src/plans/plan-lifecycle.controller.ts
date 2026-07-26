import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { PlanVersion } from '@lianban/domain';
import { PlanLifecycleService, type ContentMode } from './plan-lifecycle.service.js';
import { IdentityOnboardingService, type Principal } from '../identity/identity-onboarding.service.js';
import { planNotFound } from './plan-lifecycle.errors.js';

const createSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  effectiveAt: z.string().datetime({ offset: true }),
  effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
  contentMode: z.enum(['REVIEWED', 'DEMO_UNREVIEWED']).default('REVIEWED'),
});

const transitionTypesWithoutReviewRejection = [
    'SUBMIT_REVIEW',
    'APPROVE_DIET',
    'APPROVE_TRAINING',
    'PUBLISH',
    'CONFIRM_DIET',
    'CONFIRM_TRAINING',
    'REJECT_DIET',
    'REJECT_TRAINING',
    'EXPIRE_CONFIRMATION',
    'ACTIVATE',
] as const;
const transitionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(transitionTypesWithoutReviewRejection), reasonCode: z.never().optional() }),
  z.object({ type: z.literal('REJECT_DIET_REVIEW'), reasonCode: z.string().trim().min(1) }),
  z.object({ type: z.literal('REJECT_TRAINING_REVIEW'), reasonCode: z.string().trim().min(1) }),
]);

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

const transitionTypes = [
  ...transitionTypesWithoutReviewRejection,
  'REJECT_DIET_REVIEW',
  'REJECT_TRAINING_REVIEW',
] as const;
const USER_PLAN_REJECTION_REASON_CODE = 'USER_REJECTED_PLAN';

const planVersionSchema = {
  type: 'object',
  required: [
    'id', 'userId', 'status', 'confirmationDeadlineAt', 'effectiveAt', 'effectiveTo',
    'publishedAt', 'confirmationTimedOutAt', 'rejectionReasonCode', 'dietReview',
    'trainingReview', 'dietReviewerId', 'trainingReviewerId', 'dietConfirmed', 'trainingConfirmed',
  ],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    status: { type: 'string', enum: [...planStatuses] },
    confirmationDeadlineAt: { type: 'string', format: 'date-time' },
    effectiveAt: { type: 'string', format: 'date-time' },
    effectiveTo: { type: 'string', format: 'date-time', nullable: true },
    rejectionReasonCode: { type: 'string', nullable: true },
    publishedAt: { type: 'string', format: 'date-time', nullable: true },
    confirmationTimedOutAt: { type: 'string', format: 'date-time', nullable: true },
    dietReview: { type: 'string', enum: ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] },
    trainingReview: { type: 'string', enum: ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] },
    dietReviewerId: { type: 'string', nullable: true },
    trainingReviewerId: { type: 'string', nullable: true },
    dietConfirmed: { type: 'boolean' },
    trainingConfirmed: { type: 'boolean' },
  },
};
const userPlanVersionSchema = {
  type: 'object',
  required: ['id', 'version', 'status', 'confirmationDeadlineAt', 'effectiveAt', 'effectiveTo', 'publishedAt', 'confirmationTimedOutAt', 'rejectionReasonCode', 'dietConfirmation', 'trainingConfirmation', 'allowedActions'],
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
    status: { type: 'string', enum: [...planStatuses] },
    confirmationDeadlineAt: { type: 'string', format: 'date-time' },
    effectiveAt: { type: 'string', format: 'date-time' },
    effectiveTo: { type: 'string', format: 'date-time', nullable: true },
    publishedAt: { type: 'string', format: 'date-time', nullable: true },
    confirmationTimedOutAt: { type: 'string', format: 'date-time', nullable: true },
    rejectionReasonCode: { type: 'string', nullable: true },
    dietConfirmation: { type: 'string', enum: ['PENDING', 'CONFIRMED'] },
    trainingConfirmation: { type: 'string', enum: ['PENDING', 'CONFIRMED'] },
    allowedActions: { type: 'array', items: { type: 'string', enum: ['CONFIRM_DIET', 'REJECT_DIET', 'CONFIRM_TRAINING', 'REJECT_TRAINING'] } },
  },
};

const conflictSchema = {
  type: 'object',
  required: ['businessStatus', 'errorCode', 'recoverableActions'],
  properties: {
    businessStatus: {
      type: 'string',
      enum: ['PUBLICATION_BLOCKED', 'PLAN_TRANSITION_BLOCKED', 'CONFIRMATION_CLOSED', 'PLAN_VERSION_CONFLICT', 'PLAN_VERSION_INVALID', 'PLAN_STATE_INVALID'],
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
        'PLAN_PART_ALREADY_DECIDED',
        'VERSION_CONFLICT',
        'IDEMPOTENCY_KEY_REUSED',
        'INVALID_EFFECTIVE_WINDOW',
        'EFFECTIVE_TO_REQUIRED',
        'PLAN_VERSION_ALREADY_EXISTS',
        'PLAN_VERSION_INVALID',
        'CONFIRMATION_DEADLINE_NOT_REACHED',
        'MULTIPLE_ACTIVE_PLAN_VERSIONS',
      ],
    },
    recoverableActions: { type: 'array', items: { type: 'string' } },
  },
};
const transitionUnauthorizedSchema = {
  type: 'object',
  required: ['businessStatus', 'errorCode', 'recoverableActions', 'requestId'],
  properties: {
    businessStatus: { type: 'string', enum: ['WRITE_REJECTED'] },
    errorCode: { type: 'string', enum: ['SESSION_INVALID'] },
    recoverableActions: { type: 'array', items: { type: 'string', enum: ['LOGIN'] } },
    requestId: { type: 'string' },
  },
};
const transitionForbiddenSchema = {
  type: 'object',
  required: ['businessStatus', 'errorCode', 'recoverableActions', 'requestId'],
  properties: {
    businessStatus: { type: 'string', enum: ['WRITE_REJECTED'] },
    errorCode: { type: 'string', enum: [
      'SESSION_KIND_MISMATCH', 'ROLE_NOT_AUTHORIZED', 'PROFESSIONAL_QUALIFICATION_REQUIRED',
      'PLAN_PART_SELF_REVIEW_FORBIDDEN',
    ] },
    recoverableActions: { type: 'array', items: { type: 'string' } },
    requestId: { type: 'string' },
  },
};
const transitionNotFoundSchema = {
  type: 'object',
  required: ['businessStatus', 'errorCode', 'recoverableActions'],
  properties: {
    businessStatus: { type: 'string', enum: ['PLAN_VERSION_NOT_FOUND'] },
    errorCode: { type: 'string', enum: ['PLAN_VERSION_NOT_FOUND'] },
    recoverableActions: { type: 'array', items: { type: 'string', enum: ['REFRESH'] } },
  },
};
const transitionInvalidSchema = {
  type: 'object',
  required: ['businessStatus', 'errorCode', 'recoverableActions'],
  properties: {
    businessStatus: { type: 'string', enum: ['REQUEST_INVALID'] },
    errorCode: { type: 'string', enum: [
      'REVIEW_REASON_CODE_REQUIRED', 'INVALID_TRANSITION_REQUEST', 'REQUEST_HEADER_REQUIRED',
    ] },
    recoverableActions: { type: 'array', items: { type: 'string', enum: ['FIX_REQUEST'] } },
  },
};
const userTransitionSchema = (type: 'CONFIRM_DIET' | 'CONFIRM_TRAINING' | 'REJECT_DIET' | 'REJECT_TRAINING') => ({
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: [type] },
  },
});
const staffTransitionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: transitionTypes.filter((type) =>
      ![
        'CONFIRM_DIET', 'CONFIRM_TRAINING', 'REJECT_DIET', 'REJECT_TRAINING',
        'REJECT_DIET_REVIEW', 'REJECT_TRAINING_REVIEW',
      ].includes(type)) },
  },
};
const reviewRejectionTransitionSchema = (type: 'REJECT_DIET_REVIEW' | 'REJECT_TRAINING_REVIEW') => ({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'reasonCode'],
  properties: {
    type: { type: 'string', enum: [type] },
    reasonCode: { type: 'string', minLength: 1 },
  },
});
const routeAccessErrorSchema = {
  type: 'object',
  required: ['businessStatus', 'errorCode', 'recoverableActions', 'requestId'],
  properties: {
    businessStatus: { type: 'string', enum: ['IDENTITY_BLOCKED'] },
    errorCode: { type: 'string', enum: ['ROUTE_ACCESS_NOT_APPROVED'] },
    recoverableActions: { type: 'array', items: { type: 'string', enum: ['WAIT_FOR_SECURITY_APPROVAL'] } },
    requestId: { type: 'string' },
  },
};
const pendingPlanSummarySchema = {
  type: 'object',
  required: ['businessStatus', 'plan'],
  properties: {
    businessStatus: { type: 'string', enum: ['PLAN_PENDING_CONFIRMATION', 'PLAN_WAITING_EFFECTIVE', 'NO_PENDING_PLAN'] },
    plan: {
      nullable: true,
      type: 'object',
      required: ['version', 'status', 'effectiveAt', 'confirmationDeadlineAt', 'dietConfirmation', 'trainingConfirmation', 'allowedActions'],
      properties: {
        version: { type: 'string' },
        status: { type: 'string', enum: ['PENDING_CONFIRMATION', 'SCHEDULED'] },
        effectiveAt: { type: 'string', format: 'date-time' },
        confirmationDeadlineAt: { type: 'string', format: 'date-time' },
        dietConfirmation: { type: 'string', enum: ['PENDING', 'CONFIRMED'] },
        trainingConfirmation: { type: 'string', enum: ['PENDING', 'CONFIRMED'] },
        allowedActions: { type: 'array', items: { type: 'string', enum: ['CONFIRM_DIET', 'REJECT_DIET', 'CONFIRM_TRAINING', 'REJECT_TRAINING'] } },
      },
    },
  },
};
const taskCandidatesSchema = {
  type: 'object',
  required: ['businessStatus', 'planVersion', 'items'],
  properties: {
    businessStatus: { type: 'string', enum: ['TASK_GENERATION_ALLOWED', 'PLAN_GAP'] },
    planVersion: { type: 'string', nullable: true },
    items: { type: 'array', maxItems: 0, items: {} },
  },
};

@ApiTags('plan-lifecycle')
@ApiServiceUnavailableResponse({ description: 'Unified route access gate rejected the request', schema: routeAccessErrorSchema })
@Controller('api/v1')
export class PlanLifecycleController {
  constructor(
    @Inject(PlanLifecycleService) private readonly service: PlanLifecycleService,
    @Inject(IdentityOnboardingService) private readonly identity: IdentityOnboardingService,
  ) {}

  @Post('plan-versions')
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-request-id', required: true })
  @ApiHeader({ name: 'idempotency-key', required: true })
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
  @ApiConflictResponse({ description: 'Invalid window, duplicate version, or idempotency conflict', schema: conflictSchema })
  @ApiUnauthorizedResponse({ description: 'Session rejected' })
  @ApiForbiddenResponse({ description: 'Role rejected' })
  async create(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    const input = createSchema.parse(body);
    const principal = await this.requireStaff(headers, 'OPERATIONS');
    return this.service.create({
      id: input.id,
      userId: input.userId,
      effectiveAt: new Date(input.effectiveAt),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      contentMode: input.contentMode as ContentMode,
      createdBy: principal.accountId,
    }, planRequestMeta(headers, input));
  }

  @Get('plan-versions/:id')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: 'string' })
  @ApiOkResponse({ description: 'Role-filtered plan version', schema: { oneOf: [userPlanVersionSchema, planVersionSchema] } })
  @ApiUnauthorizedResponse({ description: 'Session rejected' })
  @ApiForbiddenResponse({ description: 'Role rejected' })
  async get(@Param('id') id: string, @Headers() headers: Record<string, string>) {
    const principal = await this.authenticatePlanRead(headers, readRequestMeta(headers));
    if (principal.accountType === 'STAFF') await this.requireStaffPlanRead(principal, id, readRequestMeta(headers));
    const plan = await this.service.get(id);
    if (principal.accountType === 'USER' && (principal.accountId !== plan.userId || !isUserVisiblePlan(plan))) {
      await this.identity.auditAuthorizationRejection(
        principal, 'PLAN_READ_REJECTED', 'PLAN_VERSION', id, readRequestMeta(headers), 'PLAN_VERSION_NOT_FOUND',
      );
      throw planNotFound(id);
    }
    return principal.accountType === 'USER' ? toUserPlanVersion(plan) : plan;
  }

  @Post('plan-versions/:id/transitions')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-request-id', required: true })
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiBody({
    schema: {
      oneOf: [
        userTransitionSchema('CONFIRM_DIET'),
        userTransitionSchema('CONFIRM_TRAINING'),
        userTransitionSchema('REJECT_DIET'),
        userTransitionSchema('REJECT_TRAINING'),
        staffTransitionSchema,
        reviewRejectionTransitionSchema('REJECT_DIET_REVIEW'),
        reviewRejectionTransitionSchema('REJECT_TRAINING_REVIEW'),
      ],
    },
  })
  @ApiOkResponse({ description: 'Role-filtered transitioned plan version', schema: { oneOf: [userPlanVersionSchema, planVersionSchema] } })
  @ApiConflictResponse({ description: 'Business guard blocked transition', schema: conflictSchema })
  @ApiUnauthorizedResponse({ description: 'Session rejected', schema: transitionUnauthorizedSchema })
  @ApiForbiddenResponse({ description: 'Session kind, role, qualification, or self-review rejected', schema: transitionForbiddenSchema })
  @ApiNotFoundResponse({ description: 'Absent or unreadable plan version', schema: transitionNotFoundSchema })
  @ApiUnprocessableEntityResponse({ description: 'Action-specific transition body rejected', schema: transitionInvalidSchema })
  async transition(@Param('id') id: string, @Body() body: unknown, @Headers() headers: Record<string, string>) {
    const parsed = parseTransitionBody(body);
    const principal = await this.identity.authorizeSession(bearerToken(headers), this.sessionKindFor(parsed.type), requestMeta(headers));
    await this.requireReviewerQualification(principal, parsed.type, id, requestMeta(headers));
    try {
      const plan = await this.service.transition(id, toPlanEvent(parsed, principal.accountId), {
        accountId: principal.accountId,
        role: principal.activeRole ?? 'SYSTEM',
      }, planRequestMeta(headers, parsed));
      return principal.accountType === 'USER' ? toUserPlanVersion(plan) : plan;
    } catch (error) {
      const errorCode = rejectionErrorCode(error);
      if (errorCode) {
        await this.identity.auditAuthorizationRejection(
          principal, 'PLAN_TRANSITION_REJECTED', 'PLAN_VERSION', id, requestMeta(headers), errorCode,
        );
      }
      throw error;
    }
  }

  @Get('users/:userId/plans/current')
  @ApiBearerAuth()
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiOkResponse({
    description: 'Current plan or explicit gap',
    schema: {
      type: 'object',
      required: ['businessStatus', 'plan'],
      properties: {
        businessStatus: { type: 'string', enum: ['CURRENT_PLAN', 'PLAN_GAP'] },
        plan: { oneOf: [userPlanVersionSchema, planVersionSchema], nullable: true },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Session rejected' })
  @ApiForbiddenResponse({ description: 'Role rejected' })
  async current(@Param('userId') userId: string, @Headers() headers: Record<string, string>) {
    const principal = await this.authenticatePlanRead(headers, readRequestMeta(headers));
    await this.requirePlanRead(
      principal,
      userId,
      readRequestMeta(headers),
    );
    const resolved = await this.service.current(userId);
    if (resolved.status === 'PLAN_STATE_INVALID') {
      throw new ConflictException({
        businessStatus: 'PLAN_STATE_INVALID',
        errorCode: 'MULTIPLE_ACTIVE_PLAN_VERSIONS',
        recoverableActions: ['CONTACT_SUPPORT'],
      });
    }
    return resolved.plan
      ? { businessStatus: 'CURRENT_PLAN', plan: principal.accountType === 'USER' ? toUserPlanVersion(resolved.plan) : resolved.plan }
      : { businessStatus: 'PLAN_GAP', plan: null };
  }

  @Get('users/:userId/plans/history')
  @ApiBearerAuth()
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiOkResponse({
    description: 'Read-only plan history',
    schema: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: { oneOf: [userPlanVersionSchema, planVersionSchema] } } },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Session rejected' })
  @ApiForbiddenResponse({ description: 'Role rejected' })
  async history(@Param('userId') userId: string, @Headers() headers: Record<string, string>) {
    const principal = await this.authenticatePlanRead(headers, readRequestMeta(headers));
    await this.requirePlanRead(
      principal,
      userId,
      readRequestMeta(headers),
    );
    const items = await this.service.history(userId);
    return {
      items: principal.accountType === 'USER'
        ? items.filter(isUserVisiblePlan).map(toUserPlanVersion)
        : items,
    };
  }

  @Get('users/:userId/plans/pending')
  @ApiBearerAuth()
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiOkResponse({ description: 'User-scoped pending or scheduled plan summary, or explicit empty state', schema: pendingPlanSummarySchema })
  @ApiUnauthorizedResponse({ description: 'User session rejected' })
  @ApiForbiddenResponse({ description: 'Cross-user access rejected' })
  async pending(@Param('userId') userId: string, @Headers() headers: Record<string, string>) {
    const principal = await this.identity.authorizeSession(bearerToken(headers), 'USER', readRequestMeta(headers));
    if (principal.accountId !== userId) {
      await this.auditPlanReadDenied(principal, userId, readRequestMeta(headers));
      throw this.roleDenied();
    }
    const plan = await this.service.pending(userId);
    if (!plan) return { businessStatus: 'NO_PENDING_PLAN', plan: null };
    return {
      businessStatus: plan.status === 'SCHEDULED' ? 'PLAN_WAITING_EFFECTIVE' : 'PLAN_PENDING_CONFIRMATION',
      plan: {
        version: plan.id,
        status: plan.status,
        effectiveAt: plan.effectiveAt,
        confirmationDeadlineAt: plan.confirmationDeadlineAt,
        dietConfirmation: plan.dietConfirmed ? 'CONFIRMED' : 'PENDING',
        trainingConfirmation: plan.trainingConfirmed ? 'CONFIRMED' : 'PENDING',
        allowedActions: plan.status === 'PENDING_CONFIRMATION'
          ? [
              ...(plan.dietConfirmed ? [] : ['CONFIRM_DIET', 'REJECT_DIET']),
              ...(plan.trainingConfirmed ? [] : ['CONFIRM_TRAINING', 'REJECT_TRAINING']),
            ]
          : [],
      },
    };
  }

  @Get('users/:userId/task-candidates')
  @ApiBearerAuth()
  @ApiParam({ name: 'userId', type: 'string' })
  @ApiOkResponse({ description: 'Trusted plan task-generation admission with no professional task content', schema: taskCandidatesSchema })
  @ApiUnauthorizedResponse({ description: 'Session rejected' })
  @ApiForbiddenResponse({ description: 'Cross-user access rejected' })
  async taskCandidates(@Param('userId') userId: string, @Headers() headers: Record<string, string>) {
    const principal = await this.identity.authorizeSession(bearerToken(headers), 'USER', readRequestMeta(headers));
    await this.requirePlanRead(principal, userId, readRequestMeta(headers));
    return this.service.taskCandidates(userId);
  }

  private async requireStaff(
    headers: Record<string, string>,
    role: 'OPERATIONS',
  ): Promise<Principal> {
    const principal = await this.identity.authorizeSession(
      bearerToken(headers),
      'STAFF',
      requestMeta(headers),
    );
    if (principal.activeRole !== role) {
      await this.identity.auditAuthorizationRejection(
        principal, 'PLAN_WRITE_REJECTED', 'PLAN_VERSION', 'NEW', requestMeta(headers), 'ROLE_NOT_AUTHORIZED',
      );
      throw new ForbiddenException({
        businessStatus: 'WRITE_REJECTED',
        errorCode: 'ROLE_NOT_AUTHORIZED',
        recoverableActions: [],
      });
    }
    return principal;
  }

  private async authenticatePlanRead(
    headers: Record<string, string>,
    meta: ReturnType<typeof readRequestMeta>,
  ): Promise<Principal> {
    return this.identity.authorizeAnySession(bearerToken(headers), meta);
  }

  private async requirePlanRead(
    principal: Principal,
    userId: string,
    meta: ReturnType<typeof readRequestMeta>,
  ): Promise<void> {
    if (principal.accountType === 'USER') {
      if (principal.accountId === userId) return;
      await this.auditPlanReadDenied(principal, userId, meta);
      throw this.roleDenied();
    }
    await this.requireStaffPlanRead(principal, userId, meta);
  }

  private async requireStaffPlanRead(
    principal: Principal,
    subjectId: string,
    meta: ReturnType<typeof readRequestMeta>,
  ): Promise<void> {
    if (principal.activeRole === 'OPERATIONS') return;
    if (principal.activeRole === 'NUTRITION_REVIEWER' || principal.activeRole === 'TRAINING_REVIEWER') {
      const grant = principal.roles.find((role) => role.code === principal.activeRole);
      if (grant?.qualifiedAt) return;
    }
    await this.auditPlanReadDenied(principal, subjectId, meta);
    throw this.roleDenied();
  }

  private async auditPlanReadDenied(principal: Principal, subjectId: string, meta: ReturnType<typeof readRequestMeta>) {
    await this.identity.auditAuthorizationRejection(
      principal, 'PLAN_READ_REJECTED', 'PLAN', subjectId, meta, 'ROLE_NOT_AUTHORIZED',
    );
  }

  private roleDenied() {
    return new ForbiddenException({
      businessStatus: 'WRITE_REJECTED',
      errorCode: 'ROLE_NOT_AUTHORIZED',
      recoverableActions: [],
    });
  }

  private async requireReviewerQualification(
    principal: Principal,
    type: z.infer<typeof transitionSchema>['type'],
    planVersionId: string,
    meta: ReturnType<typeof requestMeta>,
  ) {
    const requiredRole = type === 'APPROVE_DIET' || type === 'REJECT_DIET_REVIEW'
      ? 'NUTRITION_REVIEWER'
      : type === 'APPROVE_TRAINING' || type === 'REJECT_TRAINING_REVIEW'
        ? 'TRAINING_REVIEWER'
        : null;
    if (!requiredRole) return;
    const grant = principal.roles.find((role) => role.code === requiredRole);
    if (principal.activeRole !== requiredRole || !grant?.qualifiedAt) {
      await this.identity.auditAuthorizationRejection(
        principal, 'PLAN_REVIEW_REJECTED', 'PLAN_VERSION', planVersionId, meta, 'PROFESSIONAL_QUALIFICATION_REQUIRED',
      );
      throw new ForbiddenException({
        businessStatus: 'WRITE_REJECTED',
        errorCode: 'PROFESSIONAL_QUALIFICATION_REQUIRED',
        recoverableActions: [],
      });
    }
  }

  private sessionKindFor(type: z.infer<typeof transitionSchema>['type']): 'USER' | 'STAFF' {
    return type === 'CONFIRM_DIET' || type === 'CONFIRM_TRAINING' || type === 'REJECT_DIET' || type === 'REJECT_TRAINING'
      ? 'USER'
      : 'STAFF';
  }
}

const userVisiblePlanStatuses = new Set([
  'PENDING_CONFIRMATION', 'SCHEDULED', 'ACTIVE', 'USER_REVISION_REQUIRED',
  'CONFIRMATION_TIMED_OUT', 'SUPERSEDED',
]);

function isUserVisiblePlan(plan: PlanVersion): boolean {
  return userVisiblePlanStatuses.has(plan.status);
}

function toUserPlanVersion(plan: PlanVersion) {
  return {
    id: plan.id,
    version: plan.id,
    status: plan.status,
    confirmationDeadlineAt: plan.confirmationDeadlineAt,
    effectiveAt: plan.effectiveAt,
    effectiveTo: plan.effectiveTo,
    publishedAt: plan.publishedAt,
    confirmationTimedOutAt: plan.confirmationTimedOutAt,
    rejectionReasonCode: plan.rejectionReasonCode,
    dietConfirmation: plan.dietConfirmed ? 'CONFIRMED' : 'PENDING',
    trainingConfirmation: plan.trainingConfirmed ? 'CONFIRMED' : 'PENDING',
    allowedActions: allowedUserActions(plan),
  };
}

function allowedUserActions(plan: PlanVersion): string[] {
  if (plan.status !== 'PENDING_CONFIRMATION') return [];
  return [
    ...(plan.dietConfirmed ? [] : ['CONFIRM_DIET', 'REJECT_DIET']),
    ...(plan.trainingConfirmed ? [] : ['CONFIRM_TRAINING', 'REJECT_TRAINING']),
  ];
}

function rejectionErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) return null;
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null || !('errorCode' in response)) return null;
  return typeof response.errorCode === 'string' ? response.errorCode : null;
}

function parseTransitionBody(body: unknown): z.infer<typeof transitionSchema> {
  const parsed = transitionSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const type = typeof body === 'object' && body !== null && 'type' in body ? body.type : null;
  const reviewRejection = type === 'REJECT_DIET_REVIEW' || type === 'REJECT_TRAINING_REVIEW';
  throw new UnprocessableEntityException({
    businessStatus: 'REQUEST_INVALID',
    errorCode: reviewRejection ? 'REVIEW_REASON_CODE_REQUIRED' : 'INVALID_TRANSITION_REQUEST',
    recoverableActions: ['FIX_REQUEST'],
  });
}

function requestMeta(headers: Record<string, string>) {
  const parsed = z.object({
    requestId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1),
  }).safeParse({
    requestId: headers['x-request-id'],
    idempotencyKey: headers['idempotency-key'],
  });
  if (!parsed.success) {
    throw new UnprocessableEntityException({
      businessStatus: 'REQUEST_INVALID',
      errorCode: 'REQUEST_HEADER_REQUIRED',
      recoverableActions: ['FIX_REQUEST'],
    });
  }
  return {
    requestId: parsed.data.requestId,
    idempotencyKey: parsed.data.idempotencyKey,
  };
}

function planRequestMeta(headers: Record<string, string>, input: unknown) {
  return { ...requestMeta(headers), requestFingerprint: JSON.stringify(input) };
}

function readRequestMeta(headers: Record<string, string>) {
  return {
    requestId: headers['x-request-id'] ?? 'read-authorization',
    idempotencyKey: 'read-authorization',
  };
}

function bearerToken(headers: Record<string, string>): string | null {
  const parsed = z.string().regex(/^Bearer /).safeParse(headers.authorization);
  return parsed.success ? parsed.data.slice(7) : null;
}

function toPlanEvent(input: z.infer<typeof transitionSchema>, actorId: string) {
  const trustedTimePlaceholder = new Date(0);
  switch (input.type) {
    case 'SUBMIT_REVIEW':
      return { type: input.type } as const;
    case 'APPROVE_DIET':
      return { type: input.type, actorId } as const;
    case 'APPROVE_TRAINING':
      return { type: input.type, actorId } as const;
    case 'REJECT_DIET_REVIEW':
      if (!input.reasonCode) throw new Error('REASON_CODE_REQUIRED');
      return {
        type: input.type,
        actorId,
        reasonCode: input.reasonCode,
      } as const;
    case 'REJECT_TRAINING_REVIEW':
      if (!input.reasonCode) throw new Error('REASON_CODE_REQUIRED');
      return {
        type: input.type,
        actorId,
        reasonCode: input.reasonCode,
      } as const;
    case 'PUBLISH':
    case 'CONFIRM_DIET':
    case 'CONFIRM_TRAINING':
    case 'EXPIRE_CONFIRMATION':
    case 'ACTIVATE':
      return { type: input.type, occurredAt: trustedTimePlaceholder } as const;
    case 'REJECT_DIET':
    case 'REJECT_TRAINING':
      return { type: input.type, occurredAt: trustedTimePlaceholder, reasonCode: USER_PLAN_REJECTION_REASON_CODE } as const;
  }
}
