export type PlanStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'READY_TO_PUBLISH'
  | 'PENDING_CONFIRMATION'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'STAFF_REVISION_REQUIRED'
  | 'USER_REVISION_REQUIRED'
  | 'CONFIRMATION_TIMED_OUT'
  | 'SUPERSEDED';

type ReviewStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type PlanVersion = {
  id: string;
  userId: string;
  status: PlanStatus;
  confirmationDeadlineAt: Date;
  effectiveAt: Date;
  effectiveTo: Date | null;
  publishedAt: Date | null;
  confirmationTimedOutAt: Date | null;
  rejectionReasonCode: string | null;
  dietReview: ReviewStatus;
  trainingReview: ReviewStatus;
  dietReviewerId: string | null;
  trainingReviewerId: string | null;
  dietConfirmed: boolean;
  trainingConfirmed: boolean;
};

export type PlanEvent =
  | { type: 'SUBMIT_REVIEW' }
  | { type: 'APPROVE_DIET'; actorId: string }
  | { type: 'APPROVE_TRAINING'; actorId: string }
  | { type: 'REJECT_DIET_REVIEW'; actorId: string; reasonCode: string }
  | { type: 'REJECT_TRAINING_REVIEW'; actorId: string; reasonCode: string }
  | { type: 'PUBLISH'; occurredAt: Date }
  | { type: 'CONFIRM_DIET'; occurredAt: Date }
  | { type: 'CONFIRM_TRAINING'; occurredAt: Date }
  | { type: 'REJECT_DIET'; occurredAt: Date; reasonCode: string }
  | { type: 'REJECT_TRAINING'; occurredAt: Date; reasonCode: string }
  | { type: 'EXPIRE_CONFIRMATION'; occurredAt: Date }
  | { type: 'ACTIVATE'; occurredAt: Date }
  | { type: 'SUPERSEDE'; occurredAt: Date };

export function createDraftPlan(
  id: string,
  userId: string,
  effectiveAt: Date,
  effectiveTo: Date | null = null,
): PlanVersion {
  return {
    id,
    userId,
    status: 'DRAFT',
    confirmationDeadlineAt: calculateConfirmationDeadline(effectiveAt),
    effectiveAt,
    effectiveTo,
    publishedAt: null,
    confirmationTimedOutAt: null,
    rejectionReasonCode: null,
    dietReview: 'NOT_SUBMITTED',
    trainingReview: 'NOT_SUBMITTED',
    dietReviewerId: null,
    trainingReviewerId: null,
    dietConfirmed: false,
    trainingConfirmed: false,
  };
}

export function transitionPlan(plan: PlanVersion, event: PlanEvent): PlanVersion {
  switch (event.type) {
    case 'SUBMIT_REVIEW':
      requireStatus(plan, 'DRAFT');
      return {
        ...plan,
        status: 'IN_REVIEW',
        dietReview: 'PENDING',
        trainingReview: 'PENDING',
      };
    case 'APPROVE_DIET':
      requireStatus(plan, 'IN_REVIEW');
      return finishReview({
        ...plan,
        dietReview: 'APPROVED',
        dietReviewerId: event.actorId,
      });
    case 'APPROVE_TRAINING':
      requireStatus(plan, 'IN_REVIEW');
      return finishReview({
        ...plan,
        trainingReview: 'APPROVED',
        trainingReviewerId: event.actorId,
      });
    case 'REJECT_DIET_REVIEW':
      requireStatus(plan, 'IN_REVIEW');
      return {
        ...plan,
        status: 'STAFF_REVISION_REQUIRED',
        dietReview: 'REJECTED',
        dietReviewerId: event.actorId,
        rejectionReasonCode: event.reasonCode,
      };
    case 'REJECT_TRAINING_REVIEW':
      requireStatus(plan, 'IN_REVIEW');
      return {
        ...plan,
        status: 'STAFF_REVISION_REQUIRED',
        trainingReview: 'REJECTED',
        trainingReviewerId: event.actorId,
        rejectionReasonCode: event.reasonCode,
      };
    case 'PUBLISH':
      if (plan.dietReview !== 'APPROVED') {
        throw new Error('DIET_REVIEW_REQUIRED');
      }
      if (plan.trainingReview !== 'APPROVED') {
        throw new Error('TRAINING_REVIEW_REQUIRED');
      }
      requireStatus(plan, 'READY_TO_PUBLISH');
      if (plan.effectiveTo === null) {
        throw new Error('EFFECTIVE_TO_REQUIRED');
      }
      if (plan.effectiveAt >= plan.effectiveTo) {
        throw new Error('INVALID_EFFECTIVE_WINDOW');
      }
      if (event.occurredAt.getTime() > plan.confirmationDeadlineAt.getTime() - 86_400_000) {
        throw new Error('PUBLICATION_LEAD_TIME_INSUFFICIENT');
      }
      return { ...plan, status: 'PENDING_CONFIRMATION', publishedAt: event.occurredAt };
    case 'CONFIRM_DIET':
      return confirmPlanPart(plan, 'dietConfirmed', event.occurredAt);
    case 'CONFIRM_TRAINING':
      return confirmPlanPart(plan, 'trainingConfirmed', event.occurredAt);
    case 'REJECT_DIET':
    case 'REJECT_TRAINING':
      requireStatus(plan, 'PENDING_CONFIRMATION');
      requireBeforeDeadline(plan, event.occurredAt);
      return {
        ...plan,
        status: 'USER_REVISION_REQUIRED',
        rejectionReasonCode: event.reasonCode,
      };
    case 'EXPIRE_CONFIRMATION':
      requireStatus(plan, 'PENDING_CONFIRMATION');
      if (event.occurredAt < plan.confirmationDeadlineAt) {
        throw new Error('CONFIRMATION_DEADLINE_NOT_REACHED');
      }
      return {
        ...plan,
        status: 'CONFIRMATION_TIMED_OUT',
        confirmationTimedOutAt: event.occurredAt,
      };
    case 'ACTIVATE':
      requireStatus(plan, 'SCHEDULED');
      if (event.occurredAt < plan.effectiveAt) {
        throw new Error('EFFECTIVE_TIME_NOT_REACHED');
      }
      return { ...plan, status: 'ACTIVE' };
    case 'SUPERSEDE':
      requireStatus(plan, 'ACTIVE');
      return { ...plan, status: 'SUPERSEDED', effectiveTo: event.occurredAt };
  }
}

export function calculateConfirmationDeadline(effectiveAt: Date): Date {
  const cstInstant = new Date(effectiveAt.getTime() + 8 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      cstInstant.getUTCFullYear(),
      cstInstant.getUTCMonth(),
      cstInstant.getUTCDate() - 1,
      12,
    ),
  );
}

export function canCreatePendingVersion(
  plans: ReadonlyArray<Pick<PlanVersion, 'userId' | 'status'>>,
  userId: string,
): boolean {
  return !plans.some(
    (plan) =>
      plan.userId === userId &&
      (plan.status === 'PENDING_CONFIRMATION' || plan.status === 'SCHEDULED'),
  );
}

export function resolveCurrentPlan<T extends {
  userId: string;
  status: 'ACTIVE';
  effectiveAt: Date;
  effectiveTo: Date;
}>(plans: readonly T[], userId: string, now: Date) {
  const current = plans.filter(
    (candidate) =>
      candidate.userId === userId &&
      candidate.status === 'ACTIVE' &&
      candidate.effectiveAt <= now &&
      now < candidate.effectiveTo,
  );

  if (current.length > 1) {
    return { status: 'PLAN_STATE_INVALID' as const, plan: null };
  }
  return current[0]
    ? { status: 'ACTIVE' as const, plan: current[0] }
    : { status: 'PLAN_GAP' as const, plan: null };
}

export function canGeneratePlanTasks(
  plans: ReadonlyArray<{
    userId: string;
    status: PlanStatus;
    effectiveAt: Date;
    effectiveTo: Date | null;
  }>,
  userId: string,
  now: Date,
): boolean {
  const active = plans.filter(
    (plan): plan is typeof plan & { status: 'ACTIVE'; effectiveTo: Date } =>
      plan.status === 'ACTIVE' && plan.effectiveTo !== null,
  );
  return resolveCurrentPlan(active, userId, now).status === 'ACTIVE';
}

function confirmPlanPart(
  plan: PlanVersion,
  field: 'dietConfirmed' | 'trainingConfirmed',
  occurredAt: Date,
): PlanVersion {
  requireStatus(plan, 'PENDING_CONFIRMATION');
  requireBeforeDeadline(plan, occurredAt);

  const updated = { ...plan, [field]: true };
  return updated.dietConfirmed && updated.trainingConfirmed
    ? { ...updated, status: 'SCHEDULED' }
    : updated;
}

function requireBeforeDeadline(plan: PlanVersion, occurredAt: Date): void {
  if (occurredAt >= plan.confirmationDeadlineAt) {
    throw new Error('CONFIRMATION_DEADLINE_PASSED');
  }
}

function finishReview(plan: PlanVersion): PlanVersion {
  return plan.dietReview === 'APPROVED' && plan.trainingReview === 'APPROVED'
    ? { ...plan, status: 'READY_TO_PUBLISH' }
    : plan;
}

function requireStatus(plan: PlanVersion, expected: PlanStatus): void {
  if (plan.status !== expected) {
    throw new Error(`STATE_TRANSITION_NOT_ALLOWED:${plan.status}->${expected}`);
  }
}
