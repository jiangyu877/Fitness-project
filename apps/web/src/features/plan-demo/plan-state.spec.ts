import { describe, expect, it } from 'vitest';

import { confirmPlanSection, createPlanScenario } from './plan-state.js';

describe('pending plan confirmation', () => {
  it('keeps the plan pending after only diet is confirmed', () => {
    const pending = createPlanScenario('pending-confirmation');

    const result = confirmPlanSection(pending, 'diet');

    expect(result.confirmations).toEqual({ diet: true, training: false });
    expect(result.status).toBe('pending-confirmation');
    expect(result.isEffective).toBe(false);
  });

  it('moves to scheduled only after both sections are confirmed', () => {
    const dietConfirmed = confirmPlanSection(createPlanScenario('pending-confirmation'), 'diet');

    const result = confirmPlanSection(dietConfirmed, 'training');

    expect(result.status).toBe('scheduled');
    expect(result.isEffective).toBe(false);
    expect(result.confirmations).toEqual({ diet: true, training: true });
  });
});

describe('blocked plan states', () => {
  it('does not accept confirmations after the deadline', () => {
    const timeout = createPlanScenario('confirmation-timeout');
    expect(confirmPlanSection(timeout, 'diet')).toEqual(timeout);
    expect(timeout.canConfirm).toBe(false);
  });

  it('does not generate tasks during an old-plan gap', () => {
    const gap = createPlanScenario('plan-gap');
    expect(gap.oldPlanActive).toBe(false);
    expect(gap.availableTasks).toEqual({ diet: false, training: false });
  });

  it('pauses only the affected training task for the risk scenario', () => {
    const risk = createPlanScenario('risk-paused');
    expect(risk.availableTasks).toEqual({ diet: true, training: false });
    expect(risk.riskScope).toBe('training');
  });
});
