import { describe, expect, it } from 'vitest';

import { getNavigation, resolveRoute } from './routing.js';

describe('application routing contract', () => {
  it('exposes every frozen H5 and Web page as a route', () => {
    expect(getNavigation('h5')).toHaveLength(19);
    expect(getNavigation('web')).toHaveLength(13);
  });

  it('resolves known pages and rejects unknown paths without guessing', () => {
    expect(resolveRoute('/h5/today')?.id).toBe('H5-TOD-01');
    expect(resolveRoute('/web/work-queue')?.id).toBe('WEB-WQ-01');
    expect(resolveRoute('/h5/ai-coach')).toBeUndefined();
  });
});
