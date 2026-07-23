import { describe, expect, it } from 'vitest';

import { pageCatalog } from './page-catalog.js';
import { demoPersonas, prototypeDisclaimer } from './personas.js';

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
    expect(demoPersonas.map((persona) => persona.goal)).toEqual(['fat-loss', 'muscle-gain']);
    expect(demoPersonas.every((persona) => persona.reviewStatus === 'unreviewed-demo')).toBe(true);
  });

  it('keeps the professional-review warning explicit', () => {
    expect(prototypeDisclaimer).toBe('仅用于原型演示，未经专业审核');
  });
});
