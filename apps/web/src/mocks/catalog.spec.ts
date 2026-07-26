import { describe, expect, it } from 'vitest';

import { pageCatalog } from './page-catalog.js';
import {
  demoPersonas,
  isDemoPersonaSwitcherEnabled,
  prototypeDisclaimer,
} from './personas.js';

describe('frozen page catalog', () => {
  it('contains 32 unique page IDs in the frozen priority groups', () => {
    expect(new Set(pageCatalog.map((page) => page.id)).size).toBe(32);
    expect(pageCatalog.filter((page) => page.surface === 'h5' && page.priority === 'P0')).toHaveLength(17);
    expect(pageCatalog.filter((page) => page.surface === 'h5' && page.priority === 'P1')).toHaveLength(2);
    expect(pageCatalog.filter((page) => page.surface === 'web' && page.priority === 'P0')).toHaveLength(10);
    expect(pageCatalog.filter((page) => page.surface === 'web' && page.priority === 'P1')).toHaveLength(3);
  });

  it('gives every route its UI matrix contract', () => {
    for (const page of pageCatalog) {
      expect(page.path).toMatch(/^\/(h5|web)\//);
      expect(page.roles.length).toBeGreaterThan(0);
      expect(page.entryCondition).toBeTruthy();
      expect(page.primaryAction).toBeTruthy();
      expect(page.emptyState).toBeTruthy();
      expect(page.blockedState).toBeTruthy();
      expect(page.exitResult).toBeTruthy();
    }
  });
});

describe('demo personas', () => {
  it('contains separate fat-loss and muscle-gain prototype branches', () => {
    expect(demoPersonas.map((persona) => persona.goalType)).toEqual(['FAT_LOSS', 'MUSCLE_GAIN']);
    expect(demoPersonas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'persona_fat_loss',
        displayName: '林悦',
        age: 29,
        trainingScene: '居家',
        trainingDaysPerWeek: 3,
        selectedPlanState: 'EFFECTIVE',
      }),
      expect.objectContaining({
        id: 'persona_muscle_gain',
        displayName: '周远',
        age: 32,
        trainingScene: '商业健身房',
        trainingDaysPerWeek: 4,
        selectedPlanState: 'EFFECTIVE',
      }),
    ]));
    expect(demoPersonas.every((persona) => (
      persona.demoOnly === true
      && persona.reviewStatus === 'DEMO_UNREVIEWED'
      && persona.publishable === false
    ))).toBe(true);
  });

  it('keeps the professional-review warning explicit', () => {
    expect(prototypeDisclaimer).toBe('仅用于原型演示，未经专业审核');
  });

  it('keeps both personas first-week facts aligned with fixture v1.1', () => {
    expect(demoPersonas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'persona_fat_loss',
        heightCm: 165,
        weightKg: 68,
        trainingSessions: { completed: 3, planned: 3 },
        mealRecords: { onPlan: 4, partialDeviation: 2, majorDeviation: 1 },
      }),
      expect.objectContaining({
        id: 'persona_muscle_gain',
        heightCm: 178,
        weightKg: 69.5,
        trainingSessions: { completed: 4, planned: 4 },
        mealRecords: { onPlan: 5, partialDeviation: 2, majorDeviation: 0 },
      }),
    ]));
  });

  it('enables the persona switcher only for explicitly enabled local development', () => {
    expect(isDemoPersonaSwitcherEnabled({ mode: 'development', dev: true, demoPersonaSwitcher: 'true' })).toBe(true);
    expect(isDemoPersonaSwitcherEnabled({ mode: 'production', dev: false, demoPersonaSwitcher: 'true' })).toBe(false);
    expect(isDemoPersonaSwitcherEnabled({ mode: 'development', dev: true })).toBe(false);
    expect(isDemoPersonaSwitcherEnabled({})).toBe(false);
  });
});
