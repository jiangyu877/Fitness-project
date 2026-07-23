import { describe, expect, it } from 'vitest';

import {
  canCreatePendingVersion,
  createDraftPlan,
  resolveCurrentPlan,
  transitionPlan,
} from '../src/plan.js';

const deadline = new Date('2026-07-26T12:00:00.000Z');
const effectiveAt = new Date('2026-07-27T00:00:00.000Z');

describe('plan lifecycle', () => {
  it('requires two professional approvals before publication', () => {
    let plan = createDraftPlan('plan-v1', 'user-1', deadline, effectiveAt);
    plan = transitionPlan(plan, { type: 'SUBMIT_REVIEW' });
    plan = transitionPlan(plan, { type: 'APPROVE_DIET', actorId: 'nutrition-1' });

    expect(() => transitionPlan(plan, { type: 'PUBLISH' })).toThrow(
      /TRAINING_REVIEW_REQUIRED/,
    );

    plan = transitionPlan(plan, { type: 'APPROVE_TRAINING', actorId: 'trainer-1' });
    expect(transitionPlan(plan, { type: 'PUBLISH' }).status).toBe(
      'PENDING_CONFIRMATION',
    );
  });

  it('requires both user confirmations before scheduling', () => {
    let plan = publishablePlan();
    plan = transitionPlan(plan, { type: 'PUBLISH' });
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
    const plan = transitionPlan(publishablePlan(), { type: 'PUBLISH' });

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
      effectiveTo: new Date('2026-07-27T00:00:00.000Z'),
    };

    expect(resolveCurrentPlan([current], 'user-1', effectiveAt)).toEqual({
      status: 'PLAN_GAP',
      plan: null,
    });
  });
});

function publishablePlan() {
  let plan = createDraftPlan('plan-v1', 'user-1', deadline, effectiveAt);
  plan = transitionPlan(plan, { type: 'SUBMIT_REVIEW' });
  plan = transitionPlan(plan, { type: 'APPROVE_DIET', actorId: 'nutrition-1' });
  return transitionPlan(plan, { type: 'APPROVE_TRAINING', actorId: 'trainer-1' });
}
