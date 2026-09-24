// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { P11LocalTodayPage } from './p11-local-today-page.js';

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

const fatTasks = [
  { taskId: 'fat-task-01-01', businessDate: '2026-01-01', taskState: 'OPEN', dateState: 'OPEN', riskState: 'CLEAR' },
  { taskId: 'fat-task-01-02', businessDate: '2026-01-02', taskState: 'OPEN', dateState: 'OPEN', riskState: 'CLEAR' },
];

const taskSurface = {
  testOnly: true,
  fixtures: [
    { fixtureId: 'persona_fat_loss', tasks: fatTasks },
    {
      fixtureId: 'persona_muscle_gain',
      tasks: [{ taskId: 'muscle-task-01-02', businessDate: '2026-01-02', taskState: 'OPEN', dateState: 'OPEN', riskState: 'CLEAR' }],
    },
  ],
};

function urlFetcher(overrides: { manifest?: unknown; tasks?: unknown } = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/p11-local/fixtures')) {
      return new Response(JSON.stringify(overrides.manifest ?? manifest), { status: 200 });
    }
    if (url.endsWith('/p11-local/tasks')) {
      return new Response(JSON.stringify(overrides.tasks ?? taskSurface), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
}

afterEach(cleanup);

describe('P11 local today task view', () => {
  it('renders both personas generated tasks and opens the selected task', async () => {
    const onOpen = vi.fn();
    render(<P11LocalTodayPage fetcher={urlFetcher()} onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByTestId('p11-local-today')).toBeInTheDocument());
    const fatTaskButtons = screen.getAllByTestId('p11-local-today-task')
      .filter((button) => button.getAttribute('data-fixture-id') === 'persona_fat_loss');
    expect(fatTaskButtons.map((button) => button.getAttribute('data-business-date')))
      .toEqual(['2026-01-01', '2026-01-02']);
    fireEvent.click(fatTaskButtons[0]!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      fixtureId: 'persona_fat_loss', taskId: 'fat-task-01-01', sessionToken: 'fat-token',
    }));
  });

  it('fails closed on malformed task surfaces', async () => {
    const malformed: unknown[] = [
      { ...taskSurface, extra: true },
      { ...taskSurface, testOnly: false },
      { ...taskSurface, fixtures: [taskSurface.fixtures[0]] },
      {
        ...taskSurface,
        fixtures: [
          { ...taskSurface.fixtures[0], tasks: [{ ...fatTasks[0], taskState: 'SOMEDAY' }] },
          taskSurface.fixtures[1],
        ],
      },
      {
        ...taskSurface,
        fixtures: [
          { ...taskSurface.fixtures[0], tasks: [{ ...fatTasks[0], businessDate: '2026/01/01' }] },
          taskSurface.fixtures[1],
        ],
      },
      {
        ...taskSurface,
        fixtures: [
          { ...taskSurface.fixtures[0], tasks: [fatTasks[0], { ...fatTasks[1], taskId: 'fat-task-01-01' }] },
          taskSurface.fixtures[1],
        ],
      },
      {
        ...taskSurface,
        fixtures: [
          { ...taskSurface.fixtures[0], tasks: fatTasks.filter((task) => task.taskId !== 'fat-task-01-02') },
          taskSurface.fixtures[1],
        ],
      },
      {
        ...taskSurface,
        fixtures: [{ ...taskSurface.fixtures[0], tasks: [] }, taskSurface.fixtures[1]],
      },
    ];
    for (const tasks of malformed) {
      cleanup();
      render(<P11LocalTodayPage fetcher={urlFetcher({ tasks })} onOpen={vi.fn()} />);
      await waitFor(() => expect(screen.getByTestId('p11-local-today-error')).toBeInTheDocument());
      expect(screen.getByTestId('p11-local-today-error-code'))
        .toHaveTextContent('P11_LOCAL_TASK_SURFACE_INVALID');
    }
  });
});
