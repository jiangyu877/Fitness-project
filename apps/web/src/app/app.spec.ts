// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes, type AppRoutesProps, type DemoRuntimeEnvironment } from './app.js';
import { pageCatalog } from '../mocks/page-catalog.js';
import type { IdentityClient } from '../features/identity/identity-client.js';
import type { PlanClient } from '../features/plans-real/plan-client.js';

function renderAt(path: string, demoEnvironment?: DemoRuntimeEnvironment, overrides: Partial<AppRoutesProps> = {}) {
  const appProps = { ...(demoEnvironment ? { demoEnvironment } : {}), ...overrides };
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(AppRoutes, appProps),
    ),
  );
}

afterEach(cleanup);

describe('H5 shell', () => {
  it('shows the prototype warning and switches between both demo personas only in explicitly enabled local development', async () => {
    renderAt('/h5/today', { mode: 'development', dev: true, demoPersonaSwitcher: 'true' });

    expect(screen.getByRole('heading', { name: '今天，先完成最重要的事' })).toBeInTheDocument();
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();
    expect(await screen.findByLabelText('切换演示用户')).toHaveValue('persona_fat_loss');

    fireEvent.change(screen.getByLabelText('切换演示用户'), { target: { value: 'persona_muscle_gain' } });
    expect(screen.getByLabelText('切换演示用户')).toHaveValue('persona_muscle_gain');
    expect(screen.getByText('当前计划已生效')).toBeInTheDocument();
  });

  it('renders July 23 facts from the selected persona goal type and fixture state', async () => {
    renderAt('/h5/today', { mode: 'development', dev: true, demoPersonaSwitcher: 'true' });

    expect(await screen.findByText('7月23日 · 周四')).toBeInTheDocument();
    expect(screen.getByText('恢复日')).toBeInTheDocument();
    expect(screen.getByText('当前计划已生效')).toBeInTheDocument();
    expect(screen.queryByText('下肢基础训练')).not.toBeInTheDocument();
    expect(screen.queryByText('约 46 分钟')).not.toBeInTheDocument();
    expect(screen.queryByText('训练后快速记录')).not.toBeInTheDocument();
    expect(screen.queryByText('待训练后')).not.toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('切换演示用户'), { target: { value: 'persona_muscle_gain' } });

    expect(screen.getByText('上肢 B')).toBeInTheDocument();
    expect(screen.getByText('最后一个动作可事后补录')).toBeInTheDocument();
    expect(screen.getByText('当前计划已生效')).toBeInTheDocument();
    expect(screen.queryByText('待确认')).not.toBeInTheDocument();
    expect(screen.queryByText('恢复日')).not.toBeInTheDocument();
  });

  it('does not render the demo persona switcher in production mode', () => {
    renderAt('/h5/today', { mode: 'production', dev: false, demoPersonaSwitcher: 'true' });

    expect(screen.queryByLabelText('切换演示用户')).not.toBeInTheDocument();
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();
  });

  it('keeps review details aligned with the current goal-type persona', async () => {
    renderAt('/web/reviews/diet', { mode: 'development', dev: true, demoPersonaSwitcher: 'true' });

    expect(await screen.findByText('林悦 · 计划版本 FL-2026-W30-R1')).toBeInTheDocument();
    expect(screen.getByText('减脂与生活节奏稳定')).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('切换演示用户'), { target: { value: 'persona_muscle_gain' } });

    expect(screen.getByText('周远 · 计划版本 MG-2026-W30-R1')).toBeInTheDocument();
    expect(screen.getByText('系统学习力量训练，稳定增加训练表现')).toBeInTheDocument();
    expect(screen.getByText('计划版本 MG-2026-W30-R1')).toBeInTheDocument();
  });
});

describe('Web shell', () => {
  it('shows a work-focused queue with role and priority context', () => {
    renderAt('/web/work-queue');

    expect(screen.getByRole('heading', { name: '工作队列' })).toBeInTheDocument();
    expect(screen.getAllByText('运营人员')).toHaveLength(2);
    expect(screen.getByText('高优先级')).toBeInTheDocument();
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();
  });
});

describe('frozen routes', () => {
  it('renders the matching title for all 32 catalog paths', () => {
    for (const page of pageCatalog) {
      const view = renderAt(page.path);
      const expectedHeading = page.id === 'H5-TOD-01'
        ? '今天，先完成最重要的事'
        : page.id === 'H5-PLN-01'
          ? '计划暂不可显示'
          : page.id === 'H5-PLN-02' || page.id === 'H5-PLN-04'
            ? '计划暂不可显示'
            : page.title;
      expect(screen.getByRole('heading', { name: expectedHeading })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('renders dedicated phase two plan and review experiences', () => {
    const plan = renderAt('/h5/plans/pending');
    expect(screen.getByRole('heading', { name: '计划暂不可显示' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认|拒绝/ })).not.toBeInTheDocument();
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
    plan.unmount();

    const dietReview = renderAt('/web/reviews/diet');
    expect(screen.getByRole('heading', { name: '饮食审核' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布给真人用户' })).toBeDisabled();
    dietReview.unmount();

    const trainingReview = renderAt('/web/reviews/training');
    expect(screen.getByRole('heading', { name: '训练审核' })).toBeInTheDocument();
    expect(screen.getByText('当前职责：训练审核者')).toBeInTheDocument();
    trainingReview.unmount();
  });

  it('passes the restored server accountId and token to the real current-plan route', async () => {
    const identityClient: IdentityClient = {
      hasStoredSession: () => true,
      restoreSession: async () => ({
        kind: 'session-created', accountId: 'server-user-7', token: 'server-token-7',
        expiresAt: '2026-07-25T18:00:00.000Z', nextAction: 'VIEW_TODAY',
      }),
      createSession: async () => { throw new Error('unused'); },
      changeInitialPassword: async () => { throw new Error('unused'); },
      logout: async () => undefined,
      getRestrictedContext: () => null,
    };
    const current = vi.fn().mockResolvedValue({
      businessStatus: 'CURRENT_PLAN',
      plan: {
        id: 'real-plan-7', userId: 'server-user-7', status: 'ACTIVE',
        confirmationDeadlineAt: '2026-07-27T12:00:00.000Z', effectiveAt: '2026-07-28T16:00:00.000Z', effectiveTo: null,
        dietConfirmed: true, trainingConfirmed: true, allowedActions: [],
      },
    });
    const planClient = {
      createTransitionIntent: vi.fn((type) => ({ type, idempotencyKey: 'test-intent' })),
      transition: vi.fn().mockResolvedValue(undefined),
      current,
      history: vi.fn().mockResolvedValue({ items: [] }),
      pending: vi.fn().mockResolvedValue({ businessStatus: 'NO_PENDING_PLAN', plan: null }),
      detail: vi.fn(),
    } as PlanClient;

    renderAt('/h5/plans/current', undefined, { identityClient, planClient });

    expect(await screen.findByText('real-plan-7')).toBeInTheDocument();
    expect(current).toHaveBeenCalledWith({ accountId: 'server-user-7', token: 'server-token-7' });
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
  });
});
