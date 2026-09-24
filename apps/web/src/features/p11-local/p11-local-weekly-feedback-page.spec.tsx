// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { P11LocalWeeklyFeedbackPage } from './p11-local-weekly-feedback-page.js';

const manifest = {
  testOnly: true,
  fixtures: [
    {
      fixtureId: 'persona_fat_loss', goalType: 'FAT_LOSS', accountId: 'fat-user',
      taskId: 'fat-task-01-02', sessionToken: 'fat-token', expiresAt: '2099-01-01T00:00:00.000Z',
    },
    {
      fixtureId: 'persona_muscle_gain', goalType: 'MUSCLE_GAIN', accountId: 'muscle-user',
      taskId: 'muscle-task-01-02', sessionToken: 'muscle-token', expiresAt: '2099-01-01T00:00:00.000Z',
    },
  ],
};

function view(submissionState: 'NONE' | 'ADJUSTMENT_PENDING') {
  return {
    windowState: 'OPEN', weekIndex: 1, sufficiency: 'SUFFICIENT', painState: 'CLEAR',
    submissionState, nextWindowAt: null,
    fields: [{ id: 'execution', required: true }, { id: 'bodyTrend', required: false }],
    allowedOutcomes: ['KEEP_CORE_PLAN', 'CHANGE_TRAINING_CONTENT'],
  };
}

const feedback = {
  testOnly: true,
  fixtures: [
    { fixtureId: 'persona_fat_loss', view: view('NONE') },
    { fixtureId: 'persona_muscle_gain', view: view('NONE') },
  ],
};

function urlFetcher(overrides: { feedback?: unknown } = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/p11-local/fixtures')) {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    if (url.endsWith('/p11-local/weekly-feedback') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(overrides.feedback ?? feedback), { status: 200 });
    }
    if (url.endsWith('/p11-local/weekly-feedback')) {
      return new Response(JSON.stringify({ testOnly: true, outcome: 'ADJUSTMENT_PENDING' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
}

afterEach(cleanup);

describe('P11 local weekly feedback page', () => {
  it('renders both personas weekly feedback and submits the selected outcome', async () => {
    const fetcher = urlFetcher();
    render(<P11LocalWeeklyFeedbackPage fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('p11-local-weekly')).toBeInTheDocument());
    expect(screen.getAllByTestId('weekly-feedback')).toHaveLength(2);
    const outcomes = screen.getAllByTestId('weekly-feedback-outcome');
    expect(outcomes.map((button) => button.getAttribute('data-outcome')))
      .toEqual(['KEEP_CORE_PLAN', 'CHANGE_TRAINING_CONTENT', 'KEEP_CORE_PLAN', 'CHANGE_TRAINING_CONTENT']);
    fireEvent.click(outcomes[1]!);
    await waitFor(() => {
      const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(String(post![0])).toContain('/p11-local/weekly-feedback');
      expect(JSON.parse(String(post![1]!.body))).toEqual({
        fixtureId: 'persona_fat_loss', requestedOutcome: 'CHANGE_TRAINING_CONTENT',
      });
    });
    await waitFor(() => {
      const gets = fetcher.mock.calls.filter(([input, init]) =>
        String(input).endsWith('/p11-local/weekly-feedback') && (init?.method ?? 'GET') === 'GET');
      expect(gets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('fails closed on malformed weekly feedback envelopes', async () => {
    const malformed: unknown[] = [
      { ...feedback, extra: true },
      { ...feedback, testOnly: false },
      { ...feedback, fixtures: [feedback.fixtures[0]] },
      {
        ...feedback,
        fixtures: [
          { ...feedback.fixtures[0], view: { ...view('NONE'), painState: 'SORE' } },
          feedback.fixtures[1],
        ],
      },
      {
        ...feedback,
        fixtures: [
          { ...feedback.fixtures[0], view: { ...view('NONE'), allowedOutcomes: [''] } },
          feedback.fixtures[1],
        ],
      },
    ];
    for (const entry of malformed) {
      cleanup();
      render(<P11LocalWeeklyFeedbackPage fetcher={urlFetcher({ feedback: entry })} />);
      await waitFor(() => expect(screen.getByTestId('p11-local-weekly-error')).toBeInTheDocument());
      expect(screen.getByTestId('p11-local-weekly-error-code'))
        .toHaveTextContent('P11_LOCAL_WEEKLY_FEEDBACK_INVALID');
    }
  });
});
