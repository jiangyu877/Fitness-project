import { describe, expect, it } from 'vitest';

import { getStatePresentation, uiStateKinds } from './ui-state.js';

describe('shared page state contract', () => {
  it('covers the eight UI states frozen by the specification', () => {
    expect(uiStateKinds).toEqual([
      'loading',
      'empty',
      'ready',
      'blocked',
      'submitting',
      'success',
      'retryable-error',
      'terminal-error',
    ]);
  });

  it('uses assertive announcements only for blocking and terminal states', () => {
    expect(getStatePresentation('blocked').liveMode).toBe('assertive');
    expect(getStatePresentation('terminal-error').liveMode).toBe('assertive');
    expect(getStatePresentation('success').liveMode).toBe('polite');
  });
});
