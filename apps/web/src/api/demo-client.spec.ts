import { describe, expect, it, vi } from 'vitest';

import { loadDemoContext } from './demo-client.js';

const readiness = {
  readyForRealUsers: false,
  blockers: ['PROFESSIONAL_RULES_UNAPPROVED'],
};

const fixture = {
  fixtureId: 'persona_fat_loss',
  goalType: 'FAT_LOSS',
  demoOnly: true,
  reviewStatus: 'DEMO_UNREVIEWED',
  publishable: false,
  disclaimer: '仅用于原型演示，未经专业审核',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('loadDemoContext', () => {
  it('uses the stable API when readiness and fixture safeguards are valid', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse(readiness))
      .mockResolvedValueOnce(jsonResponse(fixture));

    const result = await loadDemoContext('persona_fat_loss', fetcher);

    expect(result.source).toBe('api');
    expect(result.fixture).toEqual(fixture);
    expect(result.readiness).toEqual(readiness);
  });

  it('falls back to safe local data when the network fails', async () => {
    const result = await loadDemoContext(
      'persona_muscle_gain',
      vi.fn().mockRejectedValue(new TypeError('network unavailable')),
    );

    expect(result.source).toBe('fallback');
    expect(result.fixture).toMatchObject({
      fixtureId: 'persona_muscle_gain',
      demoOnly: true,
      reviewStatus: 'DEMO_UNREVIEWED',
      publishable: false,
    });
  });

  it('rejects an API fixture that drops publication safeguards', async () => {
    const unsafeFixture = { ...fixture, demoOnly: false, publishable: true };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse(readiness))
      .mockResolvedValueOnce(jsonResponse(unsafeFixture));

    const result = await loadDemoContext('persona_fat_loss', fetcher);

    expect(result.source).toBe('fallback');
    expect(result.fixture.demoOnly).toBe(true);
    expect(result.fixture.reviewStatus).toBe('DEMO_UNREVIEWED');
    expect(result.fixture.publishable).toBe(false);
  });
});
