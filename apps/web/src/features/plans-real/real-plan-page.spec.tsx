// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanClientError, type PlanClient, type PlanSession, type PlanVersion } from './plan-client.js';
import { RealPlanPage } from './real-plan-page.js';

const session: PlanSession = { token: 'user-token', accountId: 'user-1' };
const plan = (override: Partial<PlanVersion> = {}): PlanVersion => ({
  id: 'plan-v1',
  userId: 'user-1',
  status: 'ACTIVE',
  confirmationDeadlineAt: '2026-07-27T12:00:00.000Z',
  effectiveAt: '2026-07-28T16:00:00.000Z',
  effectiveTo: '2026-08-04T16:00:00.000Z',
  dietConfirmed: true,
  trainingConfirmed: true,
  allowedActions: [],
  ...override,
});

function client(overrides: Partial<PlanClient> = {}): PlanClient {
  return {
    createTransitionIntent: vi.fn((type) => ({ type, idempotencyKey: `intent-${type}` })),
    transition: vi.fn().mockResolvedValue(undefined),
    current: vi.fn().mockResolvedValue({ businessStatus: 'CURRENT_PLAN', plan: plan() }),
    history: vi.fn().mockResolvedValue({ items: [] }),
    detail: vi.fn().mockResolvedValue(plan()),
    pending: vi.fn().mockResolvedValue({ businessStatus: 'NO_PENDING_PLAN', plan: null }),
    ...overrides,
  };
}

afterEach(cleanup);

describe('real identity plan pages', () => {
  it('shows a neutral first frame and then renders the server current plan', async () => {
    let resolveCurrent!: (value: Awaited<ReturnType<PlanClient['current']>>) => void;
    const pending = new Promise<Awaited<ReturnType<PlanClient['current']>>>((resolve) => { resolveCurrent = resolve; });
    render(<RealPlanPage kind="current" session={session} client={client({ current: vi.fn(() => pending) })} />);

    expect(screen.getByRole('status')).toHaveTextContent('正在读取计划状态');
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();

    resolveCurrent({ businessStatus: 'CURRENT_PLAN', plan: plan({ id: 'plan-current-7' }) });
    expect(await screen.findByRole('heading', { name: '当前计划' })).toBeInTheDocument();
    expect(screen.getByText('plan-current-7')).toBeInTheDocument();
    expect(screen.getByText('服务端状态：ACTIVE')).toBeInTheDocument();
  });

  it('renders PLAN_GAP without candidate tasks or a demo fallback', async () => {
    render(<RealPlanPage kind="current" session={session} client={client({
      current: vi.fn().mockResolvedValue({ businessStatus: 'PLAN_GAP', plan: null }),
    })} />);

    expect(await screen.findByRole('heading', { name: '暂无生效计划，团队正在处理' })).toBeInTheDocument();
    expect(screen.getByText('不会生成饮食或训练任务。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看历史计划' })).toHaveAttribute('href', '/h5/plans/history');
    expect(screen.getByRole('link', { name: '联系运营' })).toHaveAttribute('href', '/h5/contact-operations');
  });

  it('renders lifecycle history as read-only links to recoverable detail URLs', async () => {
    const items = [
      plan({ id: 'pending', status: 'PENDING_CONFIRMATION', dietConfirmed: true, trainingConfirmed: false }),
      plan({ id: 'scheduled', status: 'SCHEDULED' }),
      plan({ id: 'rejected', status: 'USER_REVISION_REQUIRED', rejectionReasonCode: 'SCHEDULE_CONFLICT' }),
      plan({ id: 'timed-out', status: 'CONFIRMATION_TIMED_OUT', dietConfirmed: true, trainingConfirmed: false }),
      plan({ id: 'historical', status: 'SUPERSEDED' }),
    ];
    render(<RealPlanPage kind="history" session={session} client={client({
      history: vi.fn().mockResolvedValue({ items }),
    })} />);

    expect(await screen.findByRole('heading', { name: '历史计划' })).toBeInTheDocument();
    expect(screen.getByText('饮食已确认，训练待确认')).toBeInTheDocument();
    expect(screen.getByText('已双确认，等待服务端生效')).toBeInTheDocument();
    expect(screen.getByText('整版已退回，团队处理中')).toBeInTheDocument();
    expect(screen.getByText('确认已超时，不可继续确认')).toBeInTheDocument();
    expect(screen.getAllByText('只读')).toHaveLength(5);
    expect(screen.getByRole('link', { name: '查看 historical 详情' })).toHaveAttribute('href', '/h5/plans/detail/historical');
  });

  it('loads a read-only detail from the URL version identifier and trusted session', async () => {
    const detail = vi.fn().mockResolvedValue(plan({ id: 'server-detail-id', version: 'shared-version', status: 'SUPERSEDED' }));
    render(<RealPlanPage kind="detail" planVersionId="shared/version" session={session} client={client({ detail })} />);

    expect(await screen.findByRole('heading', { name: '版本详情' })).toBeInTheDocument();
    expect(detail).toHaveBeenCalledWith(session, 'shared/version');
    expect(screen.getByText('shared-version')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认|拒绝/ })).not.toBeInTheDocument();
  });

  it('offers a native keyboard-focusable retry only for a retryable initial read', async () => {
    const current = vi.fn()
      .mockRejectedValueOnce(new PlanClientError('offline', 0, 'NETWORK_ERROR', ['RETRY', 'CONTACT_OPERATIONS']))
      .mockResolvedValueOnce({ businessStatus: 'PLAN_GAP', plan: null });
    render(<RealPlanPage kind="current" session={session} client={client({ current })} />);

    const retry = await screen.findByRole('button', { name: '重试读取' });
    retry.focus();
    expect(retry).toHaveFocus();
    retry.click();
    expect(await screen.findByRole('heading', { name: '暂无生效计划，团队正在处理' })).toBeInTheDocument();
    expect(current).toHaveBeenCalledTimes(2);
  });

  it.each([
    [403, 'ROLE_NOT_AUTHORIZED'],
    [409, 'VERSION_CONFLICT'],
    [502, 'PLAN_RESPONSE_INVALID'],
    [503, 'SERVICE_UNAVAILABLE'],
  ] as const)('does not offer read retry for %s without a server RETRY action', async (status, code) => {
    render(<RealPlanPage kind="history" session={session} client={client({
      history: vi.fn().mockRejectedValue(new PlanClientError('blocked', status, code, ['CONTACT_OPERATIONS'])),
    })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(code);
    expect(screen.queryByRole('button', { name: '重试读取' })).not.toBeInTheDocument();
  });

  it('does not infer read retry from an unstructured client exception', async () => {
    render(<RealPlanPage kind="current" session={session} client={client({
      current: vi.fn().mockRejectedValue(new Error('unexpected')),
    })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('NETWORK_ERROR');
    expect(screen.queryByRole('button', { name: '重试读取' })).not.toBeInTheDocument();
  });

  it('does not offer transition retry for NETWORK_ERROR without a server RETRY action', async () => {
    const transition = vi.fn().mockRejectedValue(new PlanClientError('offline', 0, 'NETWORK_ERROR', []));
    const planClient = client({ transition, pending: vi.fn().mockResolvedValue({ businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: {
      version: 'v1', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00',
      dietConfirmation: 'PENDING', trainingConfirmation: 'CONFIRMED', allowedActions: ['CONFIRM_DIET', 'REJECT_DIET'],
    } }) });
    render(<RealPlanPage kind="pending" session={session} client={planClient} />);

    fireEvent.click(await screen.findByRole('button', { name: '确认饮食部分' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('NETWORK_ERROR');
    expect(screen.queryByRole('button', { name: '重试同一操作' })).not.toBeInTheDocument();
  });

  it.each([
    ['pending', 'pending', { businessStatus: 'NO_PENDING_PLAN', plan: null }, '暂无待确认计划'],
    ['history', 'history', { items: [] }, '暂无历史计划'],
    ['detail', 'detail', plan({ id: 'retry-detail', status: 'SUPERSEDED' }), '版本详情'],
  ] as const)('retries the initial %s read with the same trusted session semantics', async (kind, method, result, heading) => {
    const request = vi.fn()
      .mockRejectedValueOnce(new PlanClientError('offline', 0, 'NETWORK_ERROR', ['RETRY']))
      .mockResolvedValueOnce(result);
    const planClient = client({ [method]: request });
    render(<RealPlanPage kind={kind} {...(kind === 'detail' ? { planVersionId: 'retry-detail' } : {})} session={session} client={planClient} />);

    const retry = await screen.findByRole('button', { name: '重试读取' });
    retry.focus();
    expect(retry).toHaveFocus();
    retry.click();

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
    const expectedArgument = kind === 'detail' ? [session, 'retry-detail'] : [session];
    expect(request).toHaveBeenLastCalledWith(...expectedArgument);
  });

  it('shows a neutral pending first frame, then renders separate confirmation states and only server-allowed actions', async () => {
    let resolvePending!: (value: Awaited<ReturnType<PlanClient['pending']>>) => void;
    const request = new Promise<Awaited<ReturnType<PlanClient['pending']>>>((resolve) => { resolvePending = resolve; });
    const planClient = client({ pending: vi.fn(() => request) });
    render(<RealPlanPage kind="pending" session={session} client={planClient} />);

    expect(screen.getByRole('status')).toHaveTextContent('正在读取计划状态');
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
    resolvePending({ businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: {
      version: 'pending-v7', status: 'PENDING_CONFIRMATION',
      effectiveAt: '2026-08-11T00:00:00.000+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00.000+08:00',
      dietConfirmation: 'CONFIRMED', trainingConfirmation: 'PENDING',
      allowedActions: ['CONFIRM_TRAINING', 'REJECT_TRAINING'],
    } });

    expect(await screen.findByRole('heading', { name: '待确认计划' })).toBeInTheDocument();
    expect(screen.getByText('确认不等于立即生效')).toBeInTheDocument();
    expect(screen.getByText('饮食已确认')).toBeInTheDocument();
    expect(screen.getByText('训练待确认')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认训练部分' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '拒绝训练部分' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '确认饮食部分' })).not.toBeInTheDocument();
    expect(screen.getByText('拒绝任一部分后，整份计划版本将退回团队处理。')).toBeInTheDocument();
  });

  it('renders waiting-effective with no actions and the explicit NO_PENDING_PLAN empty state', async () => {
    const waiting = render(<RealPlanPage kind="pending" session={session} client={client({ pending: vi.fn().mockResolvedValue({
      businessStatus: 'PLAN_WAITING_EFFECTIVE', plan: {
        version: 'scheduled-v1', status: 'SCHEDULED', effectiveAt: '2026-08-11T00:00:00.000+08:00',
        confirmationDeadlineAt: '2026-08-10T20:00:00.000+08:00', dietConfirmation: 'CONFIRMED', trainingConfirmation: 'CONFIRMED', allowedActions: [],
      },
    }) })} />);
    expect(await screen.findByRole('heading', { name: '已确认，等待生效' })).toBeInTheDocument();
    expect(screen.getByText('确认不等于立即生效')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认|拒绝/ })).not.toBeInTheDocument();
    waiting.unmount();

    render(<RealPlanPage kind="pending" session={session} client={client()} />);
    expect(await screen.findByRole('heading', { name: '暂无待确认计划' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看当前计划' })).toHaveAttribute('href', '/h5/plans/current');
  });

  it.each([
    [503, 'ROUTE_ACCESS_NOT_APPROVED'],
    [409, 'PLAN_VERSION_CONFLICT'],
    [502, 'PLAN_RESPONSE_INVALID'],
  ])('fails closed for status %s without stale plan content', async (status, code) => {
    render(<RealPlanPage kind="current" session={session} client={client({
      current: vi.fn().mockRejectedValue(new PlanClientError('请求未完成', status, code, ['CONTACT_OPERATIONS'], 'request-7')),
    })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('计划暂不可显示');
    expect(screen.getByText(`错误代码：${code}`)).toBeInTheDocument();
    expect(screen.getByText('请求标识：request-7')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '联系运营' })).toBeInTheDocument();
    expect(screen.queryByText('plan-v1')).not.toBeInTheDocument();
  });

  it('blocks before any request when the trusted USER session is unavailable', () => {
    const planClient = client();
    render(<RealPlanPage kind="current" session={null} client={planClient} />);

    expect(screen.getByRole('heading', { name: '计划暂不可显示' })).toBeInTheDocument();
    expect(screen.getByText('尚未取得可信 USER accountId 与会话令牌。')).toBeInTheDocument();
    expect(planClient.current).not.toHaveBeenCalled();
  });

  it.each([
    ['确认饮食部分', 'CONFIRM_DIET'],
    ['确认训练部分', 'CONFIRM_TRAINING'],
    ['拒绝饮食部分', 'REJECT_DIET'],
    ['拒绝训练部分', 'REJECT_TRAINING'],
  ] as const)('submits %s once and refreshes the authenticated pending summary', async (buttonName, type) => {
    let resolveTransition!: () => void;
    const transitionRequest = new Promise<void>((resolve) => { resolveTransition = resolve; });
    const pending = vi.fn()
      .mockResolvedValueOnce({ businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: {
        version: 'pending-v7', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00.000+08:00',
        confirmationDeadlineAt: '2026-08-10T20:00:00.000+08:00', dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING',
        allowedActions: [type],
      } })
      .mockResolvedValueOnce({ businessStatus: 'NO_PENDING_PLAN', plan: null });
    const transition = vi.fn(() => transitionRequest);
    const planClient = client({ pending, transition });
    render(<RealPlanPage kind="pending" session={session} client={planClient} />);

    const button = await screen.findByRole('button', { name: buttonName });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(transition).toHaveBeenCalledWith(session, 'pending-v7', expect.objectContaining({ type }));

    resolveTransition();
    expect(await screen.findByRole('heading', { name: '暂无待确认计划' })).toBeInTheDocument();
    expect(pending).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['PLAN_PENDING_CONFIRMATION', 'PENDING_CONFIRMATION', '饮食已确认'],
    ['PLAN_WAITING_EFFECTIVE', 'SCHEDULED', '已确认，等待生效'],
  ] as const)('renders refreshed %s only after a successful write', async (businessStatus, status, expected) => {
    const pending = vi.fn()
      .mockResolvedValueOnce({ businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: {
        version: 'v1', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00',
        dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING', allowedActions: ['CONFIRM_DIET'],
      } })
      .mockResolvedValueOnce({ businessStatus, plan: {
        version: 'v1', status, effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00',
        dietConfirmation: 'CONFIRMED', trainingConfirmation: status === 'SCHEDULED' ? 'CONFIRMED' : 'PENDING',
        allowedActions: status === 'SCHEDULED' ? [] : ['CONFIRM_TRAINING'],
      } });
    render(<RealPlanPage kind="pending" session={session} client={client({ pending })} />);

    fireEvent.click(await screen.findByRole('button', { name: '确认饮食部分' }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(pending).toHaveBeenCalledTimes(2);
  });

  it('retries a network failure with the same intent and then refreshes', async () => {
    const transition = vi.fn()
      .mockRejectedValueOnce(new PlanClientError('offline', 0, 'NETWORK_ERROR', ['RETRY', 'CONTACT_OPERATIONS']))
      .mockResolvedValueOnce(undefined);
    const pending = vi.fn()
      .mockResolvedValueOnce({ businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: {
        version: 'v1', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00',
        dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING', allowedActions: ['CONFIRM_DIET'],
      } })
      .mockResolvedValueOnce({ businessStatus: 'NO_PENDING_PLAN', plan: null });
    const planClient = client({ transition, pending });
    render(<RealPlanPage kind="pending" session={session} client={planClient} />);

    fireEvent.click(await screen.findByRole('button', { name: '确认饮食部分' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试同一操作' }));
    expect(await screen.findByRole('heading', { name: '暂无待确认计划' })).toBeInTheDocument();
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition.mock.calls[1]![2]).toBe(transition.mock.calls[0]![2]);
    expect(planClient.createTransitionIntent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['VERSION_CONFLICT', ['REFRESH'], '刷新计划状态'],
    ['IDEMPOTENCY_KEY_REUSED', ['USE_NEW_IDEMPOTENCY_KEY'], '重新发起操作'],
    ['PLAN_PART_ALREADY_DECIDED', ['REFRESH'], '刷新计划状态'],
    ['STATE_TRANSITION_NOT_ALLOWED', ['REFRESH', 'OPEN_PLAN_HISTORY'], '查看历史计划'],
    ['CONFIRMATION_DEADLINE_PASSED', ['CREATE_NEW_VERSION'], '联系团队创建新版本'],
    ['SESSION_INVALID', ['LOGIN'], '重新登录'],
    ['ROLE_NOT_AUTHORIZED', ['CONTACT_OPERATIONS'], '联系运营'],
  ] as const)('fails closed for %s and exposes only its stable recovery', async (code, recoverableActions, recoveryName) => {
    const transition = vi.fn().mockRejectedValue(new PlanClientError('blocked', code === 'SESSION_INVALID' ? 401 : code === 'ROLE_NOT_AUTHORIZED' ? 403 : 409, code, [...recoverableActions]));
    const planClient = client({ transition, pending: vi.fn().mockResolvedValue({ businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: {
      version: 'v1', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00',
      dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING', allowedActions: ['CONFIRM_DIET'],
    } }) });
    render(<RealPlanPage kind="pending" session={session} client={planClient} />);

    fireEvent.click(await screen.findByRole('button', { name: '确认饮食部分' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(code);
    expect(screen.getByRole('link', { name: recoveryName })).toBeInTheDocument();
  });

  it('sends zero writes when no action is allowed and fails closed if the refresh is malformed', async () => {
    const transition = vi.fn().mockResolvedValue(undefined);
    const pending = vi.fn().mockResolvedValueOnce({ businessStatus: 'PLAN_PENDING_CONFIRMATION', plan: {
      version: 'v1', status: 'PENDING_CONFIRMATION', effectiveAt: '2026-08-11T00:00:00+08:00', confirmationDeadlineAt: '2026-08-10T20:00:00+08:00',
      dietConfirmation: 'PENDING', trainingConfirmation: 'PENDING', allowedActions: [],
    } });
    render(<RealPlanPage kind="pending" session={session} client={client({ transition, pending })} />);

    await screen.findByRole('heading', { name: '待确认计划' });
    expect(screen.queryByRole('button', { name: /确认|拒绝/ })).not.toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();
    await waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
  });
});
