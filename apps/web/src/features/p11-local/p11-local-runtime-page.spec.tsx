// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { P11LocalRuntimePage } from './p11-local-runtime-page.js';

const fixtures = {
  testOnly: true,
  fixtures: [
    {
      fixtureId: 'persona_fat_loss', goalType: 'FAT_LOSS', accountId: 'fat-user',
      taskId: 'fat-task', sessionToken: 'fat-token', expiresAt: '2099-01-01T00:00:00.000Z',
    },
    {
      fixtureId: 'persona_muscle_gain', goalType: 'MUSCLE_GAIN', accountId: 'muscle-user',
      taskId: 'muscle-task', sessionToken: 'muscle-token', expiresAt: '2099-01-01T00:00:00.000Z',
    },
  ],
};

afterEach(cleanup);

describe('P11 local test-only fixture selector', () => {
  it('loads both fixture choices and opens only the selected opaque task', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixtures), { status: 200 }));
    const onOpen = vi.fn();

    render(<P11LocalRuntimePage fetcher={fetcher} onOpen={onOpen} />);

    fireEvent.click(await screen.findByRole('button', { name: '打开减脂测试路径' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      fixtureId: 'persona_fat_loss', goalType: 'FAT_LOSS', taskId: 'fat-task',
    }));
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();
    expect(screen.queryByText('fat-token')).not.toBeInTheDocument();
  });

  it('fails closed when the local manifest is malformed', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      testOnly: true,
      fixtures: [{ ...fixtures.fixtures[0], goalType: 'MUSCLE_GAIN', extra: true }],
    }), { status: 200 }));

    render(<P11LocalRuntimePage fetcher={fetcher} onOpen={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('p11-local-runtime-error')).toHaveTextContent('P11_LOCAL_FIXTURE_MANIFEST_INVALID'));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['accountId', 'fat-user'],
    ['taskId', 'fat-task'],
    ['sessionToken', 'fat-token'],
  ] as const)('fails closed when both fixtures share %s', async (field, duplicate) => {
    const malformed = {
      ...fixtures,
      fixtures: [fixtures.fixtures[0], { ...fixtures.fixtures[1], [field]: duplicate }],
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(malformed), { status: 200 }));

    render(<P11LocalRuntimePage fetcher={fetcher} onOpen={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('p11-local-runtime-error')).toHaveTextContent('P11_LOCAL_FIXTURE_MANIFEST_INVALID'));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

});
