import { type ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  canCreatePendingVersion,
  checkPublication,
  createDraftPlan,
  resolveCurrentPlan,
  transitionPlan,
  type PlanEvent,
  type PlanStatus,
  type PlanVersion,
} from '@lianban/domain';
import type { Environment } from '../config/environment.js';
import { ENVIRONMENT } from '../readiness/readiness.controller.js';
import { planConflict, planNotFound } from './plan-lifecycle.errors.js';

export type ContentMode = 'REVIEWED' | 'DEMO_UNREVIEWED';

type StoredPlan = {
  plan: PlanVersion;
  contentMode: ContentMode;
  createdSequence: number;
};

@Injectable()
export class PlanLifecycleService {
  private readonly plans = new Map<string, StoredPlan>();
  private sequence = 0;

  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  create(input: {
    id: string;
    userId: string;
    effectiveAt: Date;
    effectiveTo: Date | null;
    contentMode: ContentMode;
  }): PlanVersion {
    if (this.plans.has(input.id)) {
      throw planConflict('PLAN_VERSION_ALREADY_EXISTS', 'PLAN_VERSION_CONFLICT', ['REFRESH']);
    }
    if (input.effectiveTo && input.effectiveTo <= input.effectiveAt) {
      throw planConflict('INVALID_EFFECTIVE_WINDOW', 'PLAN_VERSION_INVALID', ['EDIT_PLAN']);
    }
    const plan = createDraftPlan(input.id, input.userId, input.effectiveAt, input.effectiveTo);
    this.plans.set(input.id, {
      plan,
      contentMode: input.contentMode,
      createdSequence: ++this.sequence,
    });
    return plan;
  }

  get(id: string): PlanVersion {
    return this.getStored(id).plan;
  }

  transition(id: string, event: PlanEvent): PlanVersion {
    const stored = this.getStored(id);
    if (event.type === 'PUBLISH') {
      this.assertPublishable(stored);
      const otherPlans = [...this.plans.values()]
        .filter((candidate) => candidate.plan.id !== id)
        .map((candidate) => candidate.plan);
      if (!canCreatePendingVersion(otherPlans, stored.plan.userId)) {
        throw planConflict(
          'SINGLE_PENDING_VERSION_REQUIRED',
          'PUBLICATION_BLOCKED',
          ['WAIT_FOR_EXISTING_VERSION', 'OPEN_PLAN_HISTORY'],
        );
      }
    }

    let updated: PlanVersion;
    try {
      updated = transitionPlan(stored.plan, event);
    } catch (error) {
      throw this.mapDomainError(error);
    }
    this.plans.set(id, { ...stored, plan: updated });

    if (event.type === 'ACTIVATE') {
      this.supersedeOtherActiveVersions(stored.plan.userId, id, event.occurredAt);
    }
    return updated;
  }

  current(userId: string, now: Date) {
    const active = [...this.plans.values()]
      .map((stored) => stored.plan)
      .filter(
        (plan): plan is PlanVersion & { status: 'ACTIVE' } => plan.status === 'ACTIVE',
      )
      .map((plan) => ({ ...plan, effectiveTo: plan.effectiveTo ?? new Date('9999-12-31T23:59:59.999Z') }));
    return resolveCurrentPlan(active, userId, now);
  }

  history(userId: string): PlanVersion[] {
    return [...this.plans.values()]
      .filter((stored) => stored.plan.userId === userId)
      .sort((left, right) => right.createdSequence - left.createdSequence)
      .map((stored) => stored.plan);
  }

  private getStored(id: string): StoredPlan {
    const stored = this.plans.get(id);
    if (!stored) {
      throw planNotFound(id);
    }
    return stored;
  }

  private assertPublishable(stored: StoredPlan): void {
    const publication = checkPublication({
      professionalRulesApproved: this.environment.professionalRulesApproved,
      content: [
        stored.contentMode === 'DEMO_UNREVIEWED'
          ? { demoOnly: true, reviewStatus: 'DEMO_UNREVIEWED' as const }
          : { demoOnly: false, reviewStatus: 'APPROVED' as const },
      ],
    });
    if (!publication.allowed) {
      const blocker = publication.blockers[0] ?? 'CONTENT_NOT_APPROVED';
      throw planConflict(
        blocker,
        'PUBLICATION_BLOCKED',
        blocker === 'PROFESSIONAL_RULES_UNAPPROVED'
          ? ['WAIT_FOR_PROFESSIONAL_APPROVAL']
          : ['REPLACE_WITH_REVIEWED_CONTENT'],
      );
    }
  }

  private supersedeOtherActiveVersions(userId: string, activatedId: string, occurredAt: Date): void {
    for (const [id, stored] of this.plans) {
      if (id === activatedId || stored.plan.userId !== userId || stored.plan.status !== 'ACTIVE') {
        continue;
      }
      this.plans.set(id, {
        ...stored,
        plan: transitionPlan(stored.plan, { type: 'SUPERSEDE', occurredAt }),
      });
    }
  }

  private mapDomainError(error: unknown): ConflictException {
    const message = error instanceof Error ? error.message : 'INVALID_PLAN_TRANSITION';
    const [errorCode] = message.split(':');
    const status: PlanStatus | undefined = this.getStoredStatusFromMessage(message);
    return planConflict(
      errorCode || 'INVALID_PLAN_TRANSITION',
      status === 'CONFIRMATION_TIMED_OUT' ? 'CONFIRMATION_CLOSED' : 'PLAN_TRANSITION_BLOCKED',
      this.recoverableActions(errorCode || 'INVALID_PLAN_TRANSITION'),
    );
  }

  private getStoredStatusFromMessage(message: string): PlanStatus | undefined {
    const match = message.match(/STATE_TRANSITION_NOT_ALLOWED:([^->]+)->/);
    return match?.[1] as PlanStatus | undefined;
  }

  private recoverableActions(errorCode: string): string[] {
    switch (errorCode) {
      case 'CONFIRMATION_DEADLINE_PASSED':
      case 'CONFIRMATION_DEADLINE_NOT_REACHED':
      case 'PUBLICATION_LEAD_TIME_INSUFFICIENT':
        return ['CREATE_NEW_VERSION'];
      case 'EFFECTIVE_TIME_NOT_REACHED':
        return ['WAIT_FOR_EFFECTIVE_TIME'];
      default:
        return ['REFRESH', 'OPEN_PLAN_HISTORY'];
    }
  }
}
