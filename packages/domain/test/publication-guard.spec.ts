import { describe, expect, it } from 'vitest';

import { checkPublication } from '../src/publication-guard.js';

describe('checkPublication', () => {
  it('blocks publication while professional rules are unapproved', () => {
    expect(
      checkPublication({ professionalRulesApproved: false, content: [] }),
    ).toEqual({
      allowed: false,
      blockers: ['PROFESSIONAL_RULES_UNAPPROVED'],
    });
  });

  it('blocks demo content even when professional rules are approved', () => {
    expect(
      checkPublication({
        professionalRulesApproved: true,
        content: [{ demoOnly: true, reviewStatus: 'DEMO_UNREVIEWED' }],
      }),
    ).toEqual({ allowed: false, blockers: ['DEMO_CONTENT_REFERENCED'] });
  });

  it('allows only reviewed non-demo content', () => {
    expect(
      checkPublication({
        professionalRulesApproved: true,
        content: [{ demoOnly: false, reviewStatus: 'APPROVED' }],
      }),
    ).toEqual({ allowed: true, blockers: [] });
  });
});
