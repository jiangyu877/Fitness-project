import { describe, expect, it } from 'vitest';
import { phase3Model } from './phase3-model.js';

describe('phase 3 demo state model', () => {
  it('blocks screening until consent and routes risk to human review', () => {
    expect(phase3Model.consent.canContinue(false)).toBe(false);
    expect(phase3Model.consent.canContinue(true)).toBe(true);
    expect(phase3Model.screening.resolve('pass')).toBe('approved');
    expect(phase3Model.screening.resolve('risk')).toBe('human-review');
    expect(phase3Model.screening.resolve('exclude')).toBe('stopped');
  });

  it('only creates today tasks for an effective plan', () => {
    expect(phase3Model.today.tasks('pending-confirmation')).toEqual([]);
    expect(phase3Model.today.tasks('confirmation-timeout')).toEqual([]);
    expect(phase3Model.today.tasks('plan-gap')).toEqual([]);
    expect(phase3Model.today.tasks('scheduled')).toEqual([]);
    expect(phase3Model.today.tasks('active')).toEqual(['diet', 'training']);
    expect(phase3Model.today.tasks('risk-paused')).toEqual(['diet']);
  });

  it('requires deviation reason and pauses training on pain', () => {
    expect(phase3Model.records.dietValid('partial', '')).toBe(false);
    expect(phase3Model.records.dietValid('partial', '加班')).toBe(true);
    expect(phase3Model.records.trainingAfterPain('膝部不适')).toBe('paused-human-review');
  });
});
