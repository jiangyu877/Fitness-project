import { describe, expect, it } from 'vitest';

import {
  canGeneratePlanTasks,
  calculateConfirmationDeadline,
  canCreatePendingVersion,
  createDraftPlan,
  resolveCurrentPlan,
  transitionPlan,
} from '../src/plan.js';

const deadline = new Date('2026-07-26T12:00:00.000Z');
const effectiveAt = new Date('2026-07-27T00:00:00.000Z');
const publishAt = new Date('2026-07-25T12:00:00.000Z');

describe('plan lifecycle', () => {
  it('derives the deadline as 20:00 CST on the day before the effective date', () => {
    expect(calculateConfirmationDeadline(effectiveAt)).toEqual(deadline);
    expect(
      calculateConfirmationDeadline(new Date('2026-07-26T16:30:00.000Z')),
    ).toEqual(deadline);
  });

  it('requires two professional approvals before publication', () => {
    let plan = createDraftPlan('plan-v1', 'user-1', effectiveAt, new Date('2026-08-27T00:00:00.000Z'));
    plan = transitionPlan(plan, { type: 'SUBMIT_REVIEW' });
    plan = transitionPlan(plan, { type: 'APPROVE_DIET', actorId: 'nutrition-1' });

    expect(() => transitionPlan(plan, { type: 'PUBLISH', occurredAt: publishAt })).toThrow(
      /TRAINING_REVIEW_REQUIRED/,
    );

    plan = transitionPlan(plan, { type: 'APPROVE_TRAINING', actorId: 'trainer-1' });
    expect(transitionPlan(plan, { type: 'PUBLISH', occurredAt: publishAt }).status).toBe(
      'PENDING_CONFIRMATION',
    );
  });

  it('requires both user confirmations before scheduling', () => {
    let plan = publishablePlan();
    plan = transitionPlan(plan, { type: 'PUBLISH', occurredAt: publishAt });
    plan = transitionPlan(plan, {
      type: 'CONFIRM_DIET',
      occurredAt: new Date('2026-07-26T10:00:00.000Z'),
    });

    expect(plan.status).toBe('PENDING_CONFIRMATION');

    plan = transitionPlan(plan, {
      type: 'CONFIRM_TRAINING',
      occurredAt: new Date('2026-07-26T10:01:00.000Z'),
    });
    expect(plan.status).toBe('SCHEDULED');
  });

  it('expires confirmation at the approved deadline', () => {
    const plan = transitionPlan(publishablePlan(), { type: 'PUBLISH', occurredAt: publishAt });

    expect(() =>
      transitionPlan(plan, {
        type: 'CONFIRM_DIET',
        occurredAt: deadline,
      }),
    ).toThrow(/CONFIRMATION_DEADLINE_PASSED/);

    expect(
      transitionPlan(plan, { type: 'EXPIRE_CONFIRMATION', occurredAt: deadline }).status,
    ).toBe('CONFIRMATION_TIMED_OUT');
  });

  it('requires publication at least 24 hours before confirmation closes', () => {
    expect(() =>
      transitionPlan(publishablePlan(), {
        type: 'PUBLISH',
        occurredAt: new Date('2026-07-25T12:00:00.001Z'),
      }),
    ).toThrow(/PUBLICATION_LEAD_TIME_INSUFFICIENT/);
  });

  it('returns a rejected professional review for staff revision', () => {
    let plan = createDraftPlan('plan-v1', 'user-1', effectiveAt);
    plan = transitionPlan(plan, { type: 'SUBMIT_REVIEW' });

    plan = transitionPlan(plan, {
      type: 'REJECT_DIET_REVIEW',
      actorId: 'nutrition-1',
      reasonCode: 'CONTENT_REVISION_REQUIRED',
    });

    expect(plan.status).toBe('STAFF_REVISION_REQUIRED');
    expect(plan.rejectionReasonCode).toBe('CONTENT_REVISION_REQUIRED');
  });

  it('returns the entire published version when either user part is rejected', () => {
    const plan = transitionPlan(
      transitionPlan(publishablePlan(), { type: 'PUBLISH', occurredAt: publishAt }),
      {
        type: 'REJECT_TRAINING',
        occurredAt: new Date('2026-07-26T10:00:00.000Z'),
        reasonCode: 'SCHEDULE_CONFLICT',
      },
    );

    expect(plan.status).toBe('USER_REVISION_REQUIRED');
    expect(plan.rejectionReasonCode).toBe('SCHEDULE_CONFLICT');
  });

  it('activates only a fully confirmed version at its effective instant', () => {
    let plan = transitionPlan(publishablePlan(), { type: 'PUBLISH', occurredAt: publishAt });
    plan = transitionPlan(plan, {
      type: 'CONFIRM_DIET',
      occurredAt: new Date('2026-07-26T10:00:00.000Z'),
    });
    plan = transitionPlan(plan, {
      type: 'CONFIRM_TRAINING',
      occurredAt: new Date('2026-07-26T10:01:00.000Z'),
    });

    expect(() =>
      transitionPlan(plan, {
        type: 'ACTIVATE',
        occurredAt: new Date('2026-07-26T23:59:59.999Z'),
      }),
    ).toThrow(/EFFECTIVE_TIME_NOT_REACHED/);
    expect(
      transitionPlan(plan, { type: 'ACTIVATE', occurredAt: effectiveAt }).status,
    ).toBe('ACTIVE');
  });

  it('does not permit confirmation after a version has timed out', () => {
    let plan = transitionPlan(publishablePlan(), { type: 'PUBLISH', occurredAt: publishAt });
    plan = transitionPlan(plan, { type: 'EXPIRE_CONFIRMATION', occurredAt: deadline });

    expect(() =>
      transitionPlan(plan, {
        type: 'CONFIRM_DIET',
        occurredAt: new Date('2026-07-26T12:01:00.000Z'),
      }),
    ).toThrow(/STATE_TRANSITION_NOT_ALLOWED/);
    expect(plan.confirmationTimedOutAt).toEqual(deadline);
  });

  it('prevents a second pending version for the same user', () => {
    expect(
      canCreatePendingVersion([
        { userId: 'user-1', status: 'PENDING_CONFIRMATION' },
      ], 'user-1'),
    ).toBe(false);
  });

  it('returns a plan gap instead of extending an expired plan', () => {
    const current = {
      userId: 'user-1',
      status: 'ACTIVE' as const,
      effectiveAt: new Date('2026-07-20T00:00:00.000Z'),
      effectiveTo: new Date('2026-07-27T00:00:00.000Z'),
    };

    expect(resolveCurrentPlan([current], 'user-1', effectiveAt)).toEqual({
      status: 'PLAN_GAP',
      plan: null,
    });
  });

  it('treats only one active version inside its trusted effective window as current', () => {
    const future = activePlan('future', new Date('2026-07-28T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z'));
    const current = activePlan('current', new Date('2026-07-26T00:00:00.000Z'), new Date('2026-07-28T00:00:00.000Z'));

    expect(resolveCurrentPlan([future], 'user-1', effectiveAt)).toEqual({ status: 'PLAN_GAP', plan: null });
    expect(resolveCurrentPlan([current], 'user-1', effectiveAt)).toEqual({ status: 'ACTIVE', plan: current });
    expect(resolveCurrentPlan([current, { ...current, id: 'duplicate' }], 'user-1', effectiveAt)).toEqual({
      status: 'PLAN_STATE_INVALID',
      plan: null,
    });
  });

  it('allows task generation only for one active version inside its trusted window', () => {
    const current = activePlan('current', new Date('2026-07-26T00:00:00.000Z'), new Date('2026-07-28T00:00:00.000Z'));

    expect(canGeneratePlanTasks([current], 'user-1', effectiveAt)).toBe(true);
    expect(canGeneratePlanTasks([{ ...current, status: 'SCHEDULED' }], 'user-1', effectiveAt)).toBe(false);
    expect(canGeneratePlanTasks([{ ...current, effectiveAt: new Date('2026-07-28T00:00:00.000Z') }], 'user-1', effectiveAt)).toBe(false);
    expect(canGeneratePlanTasks([current, { ...current, id: 'duplicate' }], 'user-1', effectiveAt)).toBe(false);
  });

  it('requires a finite effective end after review before publication', () => {
    expect(() => transitionPlan(publishablePlan(null), { type: 'PUBLISH', occurredAt: publishAt })).toThrow(
      /EFFECTIVE_TO_REQUIRED/,
    );
    const invalid = publishablePlan(new Date('2026-07-27T00:00:00.000Z'));
    expect(() => transitionPlan(invalid, { type: 'PUBLISH', occurredAt: publishAt })).toThrow(
      /INVALID_EFFECTIVE_WINDOW/,
    );
  });

  it('PL10 keeps the unexpired active plan current when a replacement is rejected or timed out', () => {
    const current = activePlan('current', new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-28T00:00:00.000Z'));
    const candidates = [
      { ...current, id: 'rejected', status: 'USER_REVISION_REQUIRED' as const },
      { ...current, id: 'timed-out', status: 'CONFIRMATION_TIMED_OUT' as const },
    ];

    expect(resolveCurrentPlan([current], 'user-1', effectiveAt)).toEqual({ status: 'ACTIVE', plan: current });
    expect(canGeneratePlanTasks([current, ...candidates], 'user-1', effectiveAt)).toBe(true);
  });

  it('PL11 returns a gap and no task eligibility after the old plan expires without replacement', () => {
    const expired = activePlan('expired', new Date('2026-07-20T00:00:00.000Z'), effectiveAt);

    expect(resolveCurrentPlan([expired], 'user-1', effectiveAt)).toEqual({ status: 'PLAN_GAP', plan: null });
    expect(canGeneratePlanTasks([expired], 'user-1', effectiveAt)).toBe(false);
  });
});

function publishablePlan(effectiveTo: Date | null = new Date('2026-08-27T00:00:00.000Z')) {
  let plan = createDraftPlan('plan-v1', 'user-1', effectiveAt, effectiveTo);
  plan = transitionPlan(plan, { type: 'SUBMIT_REVIEW' });
  plan = transitionPlan(plan, { type: 'APPROVE_DIET', actorId: 'nutrition-1' });
  return transitionPlan(plan, { type: 'APPROVE_TRAINING', actorId: 'trainer-1' });
}

function activePlan(id: string, startsAt: Date, endsAt: Date) {
  return { id, userId: 'user-1', status: 'ACTIVE' as const, effectiveAt: startsAt, effectiveTo: endsAt };
}
