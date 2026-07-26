import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  checkPublication,
  canGeneratePlanTasks,
  createDraftPlan,
  resolveCurrentPlan,
  transitionPlan,
  type PlanEvent,
  type PlanStatus,
  type PlanVersion,
} from '@lianban/domain';
import {
  PGlitePlanRepository,
  VersionConflictError,
  type PlanRepositoryRecord,
  type PlanWriteMetadata,
} from '@lianban/database';
import type { ActorRole } from '../identity/identity-onboarding.service.js';
import type { Environment } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { ENVIRONMENT } from '../readiness/readiness.controller.js';
import { planConflict, planNotFound } from './plan-lifecycle.errors.js';

export type ContentMode = 'REVIEWED' | 'DEMO_UNREVIEWED';
export const PLAN_LIFECYCLE_CLOCK = Symbol('PLAN_LIFECYCLE_CLOCK');
export type PlanLifecycleClock = { now?(): Date };
export type PlanRequestMetadata = Pick<PlanWriteMetadata,
  'idempotencyKey' | 'requestId' | 'requestFingerprint'>;

type StoredPlan = {
  plan: PlanVersion;
  contentMode: ContentMode;
  createdBy: string;
  recordVersion: number;
  planId: string;
  versionNumber: number;
};

@Injectable()
export class PlanLifecycleService {
  private readonly repository: PGlitePlanRepository;

  constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(PLAN_LIFECYCLE_CLOCK) private readonly clock: PlanLifecycleClock,
  ) {
    this.repository = new PGlitePlanRepository(
      databaseService.database,
      this.clock.now ? { now: this.clock.now } : undefined,
    );
  }

  async create(input: {
    id: string;
    userId: string;
    effectiveAt: Date;
    effectiveTo: Date | null;
    contentMode: ContentMode;
    createdBy: string;
  }, metadata: PlanRequestMetadata): Promise<PlanVersion> {
    if (input.effectiveTo && input.effectiveTo <= input.effectiveAt) {
      throw planConflict('INVALID_EFFECTIVE_WINDOW', 'PLAN_VERSION_INVALID', ['EDIT_PLAN']);
    }
    const plan = createDraftPlan(input.id, input.userId, input.effectiveAt, input.effectiveTo);
    const history = await this.repository.listByUser(input.userId);
    try {
      const result = await this.repository.createWithWrite({
        id: input.id,
        planId: `user-plan:${input.userId}`,
        userId: input.userId,
        versionNumber: history.length + 1,
        status: plan.status,
        confirmationDeadlineAt: plan.confirmationDeadlineAt,
        effectiveAt: plan.effectiveAt,
        effectiveTo: plan.effectiveTo,
        payload: this.serialize({ plan, contentMode: input.contentMode, createdBy: input.createdBy }),
      }, this.writeMetadata(metadata, input.createdBy, 'OPERATIONS', 'CREATE_PLAN_VERSION', 'PLAN_VERSION_CREATED', input.id));
      return this.deserialize(result.record).plan;
    } catch (error) {
      throw this.mapRepositoryError(error);
    }
  }

  async get(id: string): Promise<PlanVersion> {
    return (await this.getStored(id)).plan;
  }

  async transition(
    id: string,
    event: PlanEvent,
    actor: { accountId: string; role: ActorRole },
    metadata: PlanRequestMetadata,
  ): Promise<PlanVersion> {
    const stored = await this.getStored(id);
    this.authorizeTransition(stored, event, actor);
    const writeMetadata = this.writeMetadata(
      metadata, actor.accountId, actor.role, `TRANSITION_PLAN_VERSION:${event.type}`,
      `PLAN_${event.type}`, id,
    );
    if (event.type === 'PUBLISH') {
      this.assertPublishable(stored);
    }
    try {
      const result = await this.repository.transitionWithWrite(id, writeMetadata, (lockedRecord, trustedNow) => {
        const locked = this.deserialize(lockedRecord);
        this.authorizeTransition(locked, event, actor);
        const trustedEvent = this.withTrustedTime(event, trustedNow);
        this.assertUserPartAvailable(locked.plan, trustedEvent);
        if (locked.plan.status === 'CONFIRMATION_TIMED_OUT'
          && (trustedEvent.type === 'CONFIRM_DIET' || trustedEvent.type === 'CONFIRM_TRAINING')) {
          throw planConflict('CONFIRMATION_DEADLINE_PASSED', 'CONFIRMATION_CLOSED', ['CREATE_NEW_VERSION']);
        }
        let updated: PlanVersion;
        try {
          updated = transitionPlan(locked.plan, trustedEvent);
        } catch (error) {
          if (error instanceof Error && error.message === 'CONFIRMATION_DEADLINE_PASSED'
            && (trustedEvent.type === 'CONFIRM_DIET' || trustedEvent.type === 'CONFIRM_TRAINING')) {
            const timedOut = transitionPlan(locked.plan, { type: 'EXPIRE_CONFIRMATION', occurredAt: trustedNow });
            return {
              patch: {
                status: timedOut.status,
                effectiveTo: timedOut.effectiveTo,
                payload: this.serialize({ plan: timedOut, contentMode: locked.contentMode, createdBy: locked.createdBy }),
              },
              action: 'PLAN_EXPIRE_CONFIRMATION',
              terminalError: 'CONFIRMATION_DEADLINE_PASSED',
            };
          }
          throw this.mapDomainError(error);
        }
        return {
          patch: {
            status: updated.status,
            effectiveTo: updated.effectiveTo,
            payload: this.serialize({ plan: updated, contentMode: locked.contentMode, createdBy: locked.createdBy }),
          },
          supersedeActive: trustedEvent.type === 'ACTIVATE',
        };
      }, { enforceSinglePending: event.type === 'PUBLISH' });
      const persisted = this.deserialize(result.record).plan;
      if ((result.terminalError === 'CONFIRMATION_DEADLINE_PASSED' || persisted.status === 'CONFIRMATION_TIMED_OUT')
        && (event.type === 'CONFIRM_DIET' || event.type === 'CONFIRM_TRAINING')) {
        throw planConflict('CONFIRMATION_DEADLINE_PASSED', 'CONFIRMATION_CLOSED', ['CREATE_NEW_VERSION']);
      }
      return persisted;
    } catch (error) {
      if (error instanceof VersionConflictError
        && (event.type === 'CONFIRM_DIET' || event.type === 'CONFIRM_TRAINING')) {
        const latest = await this.repository.get(id);
        if (latest && this.deserialize(latest).plan.status === 'CONFIRMATION_TIMED_OUT') {
          throw planConflict('CONFIRMATION_DEADLINE_PASSED', 'CONFIRMATION_CLOSED', ['CREATE_NEW_VERSION']);
        }
      }
      if (error instanceof ConflictException) throw error;
      throw this.mapRepositoryError(error);
    }
  }

  async current(userId: string, now?: Date) {
    const active = (await this.repository.listByUser(userId))
      .map((record) => this.deserialize(record).plan)
      .filter((plan): plan is PlanVersion & { status: 'ACTIVE'; effectiveTo: Date } =>
        plan.status === 'ACTIVE' && plan.effectiveTo !== null);
    return resolveCurrentPlan(active, userId, now ?? await this.repository.currentTrustedTime());
  }

  async history(userId: string): Promise<PlanVersion[]> {
    return (await this.repository.listByUser(userId)).map((record) => this.deserialize(record).plan);
  }

  async pending(userId: string): Promise<PlanVersion | null> {
    const plans = await this.history(userId);
    return plans.find((plan) => plan.status === 'PENDING_CONFIRMATION' || plan.status === 'SCHEDULED') ?? null;
  }

  async taskCandidates(userId: string): Promise<{
    businessStatus: 'TASK_GENERATION_ALLOWED' | 'PLAN_GAP';
    planVersion: string | null;
    items: never[];
  }> {
    const plans = (await this.repository.listByUser(userId)).map((record) => this.deserialize(record).plan);
    const trustedNow = await this.repository.currentTrustedTime();
    if (!canGeneratePlanTasks(plans, userId, trustedNow)) {
      return { businessStatus: 'PLAN_GAP', planVersion: null, items: [] };
    }
    const current = resolveCurrentPlan(
      plans.filter((plan): plan is PlanVersion & { status: 'ACTIVE'; effectiveTo: Date } =>
        plan.status === 'ACTIVE' && plan.effectiveTo !== null),
      userId,
      trustedNow,
    );
    return current.status === 'ACTIVE'
      ? { businessStatus: 'TASK_GENERATION_ALLOWED', planVersion: current.plan.id, items: [] }
      : { businessStatus: 'PLAN_GAP', planVersion: null, items: [] };
  }

  private async getStored(id: string): Promise<StoredPlan> {
    const stored = await this.repository.get(id);
    if (!stored) throw planNotFound(id);
    return this.deserialize(stored);
  }

  private authorizeTransition(stored: StoredPlan, event: PlanEvent, actor: { accountId: string; role: ActorRole }) {
    const requireRole = (role: ActorRole) => {
      if (actor.role !== role) throw new ForbiddenException({ businessStatus: 'WRITE_REJECTED', errorCode: 'ROLE_NOT_AUTHORIZED', recoverableActions: [] });
    };
    switch (event.type) {
      case 'APPROVE_DIET': case 'REJECT_DIET_REVIEW': requireRole('NUTRITION_REVIEWER'); this.rejectSelfReview(stored, actor.accountId); return;
      case 'APPROVE_TRAINING': case 'REJECT_TRAINING_REVIEW': requireRole('TRAINING_REVIEWER'); this.rejectSelfReview(stored, actor.accountId); return;
      case 'CONFIRM_DIET': case 'CONFIRM_TRAINING': case 'REJECT_DIET': case 'REJECT_TRAINING':
        requireRole('USER');
        if (stored.plan.userId !== actor.accountId) throw planNotFound(stored.plan.id);
        return;
      default: requireRole(actor.role === 'SYSTEM' ? 'SYSTEM' : 'OPERATIONS');
    }
  }

  private rejectSelfReview(stored: StoredPlan, accountId: string) {
    if (stored.createdBy === accountId) throw new ForbiddenException({ businessStatus: 'WRITE_REJECTED', errorCode: 'PLAN_PART_SELF_REVIEW_FORBIDDEN', recoverableActions: [] });
  }

  private assertUserPartAvailable(plan: PlanVersion, event: PlanEvent): void {
    const alreadyDecided = (event.type === 'CONFIRM_DIET' || event.type === 'REJECT_DIET')
      ? plan.dietConfirmed
      : (event.type === 'CONFIRM_TRAINING' || event.type === 'REJECT_TRAINING')
        ? plan.trainingConfirmed
        : false;
    if (alreadyDecided) {
      throw planConflict('PLAN_PART_ALREADY_DECIDED', 'PLAN_TRANSITION_BLOCKED', ['REFRESH']);
    }
  }

  private assertPublishable(stored: StoredPlan): void {
    const publication = checkPublication({
      professionalRulesApproved: this.environment.professionalRulesApproved,
      content: [stored.contentMode === 'DEMO_UNREVIEWED'
        ? { demoOnly: true, reviewStatus: 'DEMO_UNREVIEWED' as const }
        : { demoOnly: false, reviewStatus: 'APPROVED' as const }],
    });
    if (!publication.allowed) {
      const blocker = publication.blockers[0] ?? 'CONTENT_NOT_APPROVED';
      throw planConflict(blocker, 'PUBLICATION_BLOCKED', blocker === 'PROFESSIONAL_RULES_UNAPPROVED'
        ? ['WAIT_FOR_PROFESSIONAL_APPROVAL'] : ['REPLACE_WITH_REVIEWED_CONTENT']);
    }
  }

  private serialize(stored: Omit<StoredPlan, 'recordVersion' | 'planId' | 'versionNumber'>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
  }

  private deserialize(record: PlanRepositoryRecord): StoredPlan {
    const payload = record.payload as unknown as { plan: PlanVersion; contentMode: ContentMode; createdBy: string };
    return {
      ...payload,
      plan: {
        ...payload.plan,
        confirmationDeadlineAt: new Date(payload.plan.confirmationDeadlineAt),
        effectiveAt: new Date(payload.plan.effectiveAt),
        effectiveTo: payload.plan.effectiveTo ? new Date(payload.plan.effectiveTo) : null,
        publishedAt: payload.plan.publishedAt ? new Date(payload.plan.publishedAt) : null,
        confirmationTimedOutAt: payload.plan.confirmationTimedOutAt ? new Date(payload.plan.confirmationTimedOutAt) : null,
      },
      recordVersion: record.recordVersion,
      planId: record.planId,
      versionNumber: record.versionNumber,
    };
  }

  private writeMetadata(
    metadata: PlanRequestMetadata, actorId: string, actorRole: ActorRole,
    operation: string, action: string, subjectId: string,
  ): PlanWriteMetadata {
    return { ...metadata, actorId, actorRole, operation, action, subjectId } as PlanWriteMetadata;
  }

  private withTrustedTime(event: PlanEvent, trustedNow: Date): PlanEvent {
    switch (event.type) {
      case 'PUBLISH': case 'CONFIRM_DIET': case 'CONFIRM_TRAINING': case 'REJECT_DIET':
      case 'REJECT_TRAINING': case 'EXPIRE_CONFIRMATION': case 'ACTIVATE': case 'SUPERSEDE':
        return { ...event, occurredAt: trustedNow };
      default:
        return event;
    }
  }

  private mapRepositoryError(error: unknown): never {
    if (error instanceof VersionConflictError) throw planConflict('VERSION_CONFLICT', 'PLAN_VERSION_CONFLICT', ['REFRESH']);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('IDEMPOTENCY_KEY_REUSED')) throw planConflict('IDEMPOTENCY_KEY_REUSED', 'PLAN_VERSION_CONFLICT', ['USE_NEW_IDEMPOTENCY_KEY']);
    if (
      message.includes('SINGLE_PENDING_VERSION_REQUIRED') ||
      message.includes('uq_plan_version_pending_per_user')
    ) {
      throw planConflict('SINGLE_PENDING_VERSION_REQUIRED', 'PUBLICATION_BLOCKED', [
        'WAIT_FOR_EXISTING_VERSION',
        'OPEN_PLAN_HISTORY',
      ]);
    }
    if (message.includes('MULTIPLE_ACTIVE_PLAN_VERSIONS') || message.includes('uq_plan_version_active_per_user')) throw planConflict('MULTIPLE_ACTIVE_PLAN_VERSIONS', 'PLAN_STATE_INVALID', ['CONTACT_SUPPORT']);
    if (message.includes('unique') || message.includes('duplicate')) throw planConflict('PLAN_VERSION_ALREADY_EXISTS', 'PLAN_VERSION_CONFLICT', ['REFRESH']);
    throw error;
  }

  private mapDomainError(error: unknown): ConflictException {
    const message = error instanceof Error ? error.message : 'INVALID_PLAN_TRANSITION';
    const [errorCode] = message.split(':');
    const match = message.match(/STATE_TRANSITION_NOT_ALLOWED:([^->]+)->/);
    const status = match?.[1] as PlanStatus | undefined;
    return planConflict(errorCode || 'INVALID_PLAN_TRANSITION',
      errorCode === 'EFFECTIVE_TO_REQUIRED' || errorCode === 'INVALID_EFFECTIVE_WINDOW'
        ? 'PLAN_VERSION_INVALID'
        : status === 'CONFIRMATION_TIMED_OUT' || errorCode === 'CONFIRMATION_DEADLINE_PASSED'
          ? 'CONFIRMATION_CLOSED' : 'PLAN_TRANSITION_BLOCKED',
      this.recoverableActions(errorCode || 'INVALID_PLAN_TRANSITION'));
  }

  private recoverableActions(errorCode: string): string[] {
    switch (errorCode) {
      case 'CONFIRMATION_DEADLINE_PASSED': case 'CONFIRMATION_DEADLINE_NOT_REACHED': case 'PUBLICATION_LEAD_TIME_INSUFFICIENT': return ['CREATE_NEW_VERSION'];
      case 'EFFECTIVE_TIME_NOT_REACHED': return ['WAIT_FOR_EFFECTIVE_TIME'];
      default: return ['REFRESH', 'OPEN_PLAN_HISTORY'];
    }
  }
}
