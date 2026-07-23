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
  | { type: 'PUBLISH' }
  | { type: 'CONFIRM_DIET'; occurredAt: Date }
  | { type: 'CONFIRM_TRAINING'; occurredAt: Date }
  | { type: 'EXPIRE_CONFIRMATION'; occurredAt: Date };

export function createDraftPlan(
  id: string,
  userId: string,
  confirmationDeadlineAt: Date,
  effectiveAt: Date,
): PlanVersion {
  return {
    id,
    userId,
    status: 'DRAFT',
    confirmationDeadlineAt,
    effectiveAt,
    effectiveTo: null,
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
    case 'PUBLISH':
      if (plan.dietReview !== 'APPROVED') {
        throw new Error('DIET_REVIEW_REQUIRED');
      }
      if (plan.trainingReview !== 'APPROVED') {
        throw new Error('TRAINING_REVIEW_REQUIRED');
      }
      requireStatus(plan, 'READY_TO_PUBLISH');
      return { ...plan, status: 'PENDING_CONFIRMATION' };
    case 'CONFIRM_DIET':
      return confirmPlanPart(plan, 'dietConfirmed', event.occurredAt);
    case 'CONFIRM_TRAINING':
      return confirmPlanPart(plan, 'trainingConfirmed', event.occurredAt);
    case 'EXPIRE_CONFIRMATION':
      requireStatus(plan, 'PENDING_CONFIRMATION');
      if (event.occurredAt < plan.confirmationDeadlineAt) {
        throw new Error('CONFIRMATION_DEADLINE_NOT_REACHED');
      }
      return { ...plan, status: 'CONFIRMATION_TIMED_OUT' };
  }
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
  effectiveTo: Date;
}>(plans: readonly T[], userId: string, now: Date) {
  const plan = plans.find(
    (candidate) =>
      candidate.userId === userId && candidate.status === 'ACTIVE' && candidate.effectiveTo > now,
  );

  return plan ? { status: 'ACTIVE' as const, plan } : { status: 'PLAN_GAP' as const, plan: null };
}

function confirmPlanPart(
  plan: PlanVersion,
  field: 'dietConfirmed' | 'trainingConfirmed',
  occurredAt: Date,
): PlanVersion {
  requireStatus(plan, 'PENDING_CONFIRMATION');
  if (occurredAt >= plan.confirmationDeadlineAt) {
    throw new Error('CONFIRMATION_DEADLINE_PASSED');
  }

  const updated = { ...plan, [field]: true };
  return updated.dietConfirmed && updated.trainingConfirmed
    ? { ...updated, status: 'SCHEDULED' }
    : updated;
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
