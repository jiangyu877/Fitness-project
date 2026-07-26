// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdentityNextActionPage } from './identity-next-action-page.js';
import { AppRoutes } from '../../app/app.js';
import { IdentityError, type IdentityClient } from './identity-client.js';
import { pathForNextAction } from '../auth-onboarding/auth-onboarding-pages.js';
import type { PlanClient } from '../plans-real/plan-client.js';

afterEach(cleanup);

describe('IdentityNextActionPage', () => {
  it.each([
    ['ACCEPT_CURRENT_CONSENT', '当前授权内容尚未接入，不能继续'],
    ['WAIT_FOR_SCREENING_RULES', '筛查规则尚未批准，不能继续'],
    ['WAIT_FOR_HUMAN_REVIEW', '正在等待专业复核'],
    ['WAIT_FOR_PLAN', '计划正在准备中'],
  ] as const)('renders real-session %s without demo controls', (nextAction, copy) => {
    render(<MemoryRouter><IdentityNextActionPage nextAction={nextAction} /></MemoryRouter>);

    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /明确同意|提交问卷/ })).not.toBeInTheDocument();
    expect(screen.queryByText('v1.0-demo')).not.toBeInTheDocument();
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
  });

  it('renders contact operations for unknown server action', () => {
    render(<MemoryRouter><IdentityNextActionPage nextAction="UNCLASSIFIED_ACTION" /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '联系运营' })).toBeInTheDocument();
  });

  it('routes contact from a real waiting page to the isolated identity page without demo controls', async () => {
    render(<MemoryRouter initialEntries={['/h5/identity/wait-for-plan']}><AppRoutes identityClient={identityClient({})} /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('link', { name: '联系运营' }));

    expect(await screen.findByRole('heading', { name: '联系运营' })).toBeInTheDocument();
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
  });

  it('maps real identity actions to distinct isolated paths and unknown actions to contact operations', () => {
    expect(pathForNextAction('ACCEPT_CURRENT_CONSENT')).toBe('/h5/identity/accept-current-consent');
    expect(pathForNextAction('WAIT_FOR_SCREENING_RULES')).toBe('/h5/identity/wait-for-screening-rules');
    expect(pathForNextAction('WAIT_FOR_HUMAN_REVIEW')).toBe('/h5/identity/wait-for-human-review');
    expect(pathForNextAction('WAIT_FOR_PLAN')).toBe('/h5/identity/wait-for-plan');
    expect(pathForNextAction('VIEW_PENDING_PLAN')).toBe('/h5/plans/pending');
    expect(pathForNextAction('VIEW_TODAY')).toBe('/h5/plans/current');
    expect(pathForNextAction('UNCLASSIFIED_ACTION')).toBe('/h5/identity/contact-operations');
  });

  it('restores the normal login session before loading the real pending plan', async () => {
    const restoreSession = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        kind: 'session-created', accountId: 'user-after-login', token: 'token-after-login',
        expiresAt: '2026-07-26T18:00:00Z', nextAction: 'VIEW_PENDING_PLAN',
      });
    const client = identityClient({
      hasStoredSession: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
      createSession: vi.fn().mockResolvedValue({ kind: 'session-created', expiresAt: '2026-07-26T18:00:00Z', nextAction: 'VIEW_PENDING_PLAN' }),
      restoreSession,
    });
    const pending = vi.fn().mockResolvedValue({ businessStatus: 'NO_PENDING_PLAN', plan: null });
    render(<MemoryRouter initialEntries={['/h5/login']}><AppRoutes identityClient={client} planClient={planClient({ pending })} /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('受邀账号'), { target: { value: 'real-user' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'real-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('heading', { name: '暂无待确认计划' })).toBeInTheDocument();
    expect(pending).toHaveBeenCalledWith({ accountId: 'user-after-login', token: 'token-after-login' });
    expect(restoreSession).toHaveBeenCalledTimes(2);
  });

  it('restores the full session after first password change before loading the real current plan', async () => {
    const restoreSession = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        kind: 'session-created', accountId: 'user-after-password', token: 'token-after-password',
        expiresAt: '2026-07-26T18:00:00Z', nextAction: 'VIEW_TODAY',
      });
    const client = identityClient({
      hasStoredSession: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true),
      createSession: vi.fn().mockResolvedValue({ kind: 'password-change-required', expiresAt: '2026-07-25T18:00:00Z', expectedVersion: 4, nextAction: 'CHANGE_INITIAL_PASSWORD' }),
      getRestrictedContext: vi.fn().mockReturnValue({ expiresAt: '2026-07-25T18:00:00Z', expectedVersion: 4 }),
      changeInitialPassword: vi.fn().mockResolvedValue({ kind: 'session-created', expiresAt: '2026-07-26T18:00:00Z', nextAction: 'VIEW_TODAY' }),
      restoreSession,
    });
    const current = vi.fn().mockResolvedValue({ businessStatus: 'PLAN_GAP', plan: null });
    render(<MemoryRouter initialEntries={['/h5/login']}><AppRoutes identityClient={client} planClient={planClient({ current })} /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('受邀账号'), { target: { value: 'first-login-user' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'initial-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    fireEvent.change(await screen.findByLabelText('新密码'), { target: { value: 'replacement-password' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'replacement-password' } });
    fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));

    expect(await screen.findByRole('heading', { name: '暂无生效计划，团队正在处理' })).toBeInTheDocument();
    expect(current).toHaveBeenCalledWith({ accountId: 'user-after-password', token: 'token-after-password' });
    expect(restoreSession).toHaveBeenCalledTimes(2);
  });

  it('restores a shared plan detail deep link without trusting a URL user identity', async () => {
    const client = identityClient({
      hasStoredSession: vi.fn().mockReturnValue(true),
      restoreSession: vi.fn().mockResolvedValue({
        kind: 'session-created', accountId: 'trusted-user', token: 'trusted-token',
        expiresAt: '2026-07-26T18:00:00Z', nextAction: 'VIEW_TODAY',
      }),
    });
    const detail = vi.fn().mockResolvedValue({
      id: 'version-from-url', userId: 'trusted-user', version: 'R7', status: 'SUPERSEDED',
      confirmationDeadlineAt: '2026-07-27T12:00:00Z', effectiveAt: '2026-07-28T12:00:00Z', effectiveTo: '2026-08-04T12:00:00Z',
      dietConfirmed: true, trainingConfirmed: true, allowedActions: [],
    });
    render(<MemoryRouter initialEntries={['/h5/plans/detail/version-from-url']}><AppRoutes identityClient={client} planClient={planClient({ detail })} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '版本详情' })).toBeInTheDocument();
    expect(detail).toHaveBeenCalledWith({ accountId: 'trusted-user', token: 'trusted-token' }, 'version-from-url');
  });

  it('routes a recovered real session to the isolated consent state instead of demo consent', async () => {
    const client = identityClient({ restoreSession: vi.fn().mockResolvedValue({ kind: 'session-created', expiresAt: '2026-07-23T18:00:00Z', nextAction: 'ACCEPT_CURRENT_CONSENT' }) });
    render(<MemoryRouter initialEntries={['/h5/login']}><AppRoutes identityClient={client} /></MemoryRouter>);

    expect(await screen.findByText('当前授权内容尚未接入，不能继续')).toBeInTheDocument();
    expect(screen.queryByText('说明版本 v1.0-demo')).not.toBeInTheDocument();
  });

  it.each([403, 409, 502, 503])('does not offer identity recovery retry for %s without a server RETRY action', async (status) => {
    const outage = identityClient({ restoreSession: vi.fn().mockRejectedValue(new IdentityError('恢复被阻断。', status, 'RECOVERY_BLOCKED')) });
    render(<MemoryRouter initialEntries={['/h5/login']}><AppRoutes identityClient={outage} /></MemoryRouter>);
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveFocus();
    expect(screen.queryByRole('button', { name: '重试恢复' })).not.toBeInTheDocument();
  });

  it('returns to login after recovery 401', async () => {
    const expired = identityClient({ restoreSession: vi.fn().mockRejectedValue(new IdentityError('expired', 401, 'SESSION_INVALID')) });
    render(<MemoryRouter initialEntries={['/h5/today']}><AppRoutes identityClient={expired} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '受邀登录' })).toBeInTheDocument();
  });

  it('returns to invited login after a locked-session 423 without offering a retry', async () => {
    const locked = identityClient({ restoreSession: vi.fn().mockRejectedValue(new IdentityError('locked', 423, 'ACCOUNT_LOCKED')) });
    render(<MemoryRouter initialEntries={['/h5/today']}><AppRoutes identityClient={locked} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '受邀登录' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试恢复' })).not.toBeInTheDocument();
    expect(screen.queryByText('今天，先完成最重要的事')).not.toBeInTheDocument();
  });

  it('blocks demo and business content while recovery is pending, then follows the server action', async () => {
    let resolveRestore!: (session: Awaited<ReturnType<IdentityClient['restoreSession']>>) => void;
    const restoreSession = vi.fn().mockReturnValue(new Promise((resolve) => { resolveRestore = resolve; }));
    const client = identityClient({ hasStoredSession: () => true, restoreSession });
    render(<MemoryRouter initialEntries={['/h5/today']}><AppRoutes identityClient={client} /></MemoryRouter>);

    expect(screen.getByRole('status')).toHaveTextContent('正在确认登录状态');
    expect(screen.queryByText('今天，先完成最重要的事')).not.toBeInTheDocument();
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();

    resolveRestore({
      kind: 'session-created', accountId: 'restored-user', token: 'restored-token',
      expiresAt: '2026-07-23T18:00:00Z', nextAction: 'WAIT_FOR_PLAN',
    });
    expect(await screen.findByText('计划正在准备中')).toBeInTheDocument();
  });

  it('retries recovery after an outage and follows the returned real-session action', async () => {
    const restoreSession = vi.fn()
      .mockRejectedValueOnce(new IdentityError('服务端允许重试。', 503, 'SERVICE_UNAVAILABLE', ['RETRY']))
      .mockResolvedValueOnce({ kind: 'session-created', expiresAt: '2026-07-23T18:00:00Z', nextAction: 'WAIT_FOR_PLAN' });
    const client = identityClient({ restoreSession });
    render(<MemoryRouter initialEntries={['/h5/login']}><AppRoutes identityClient={client} /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '重试恢复' }));
    expect(await screen.findByText('计划正在准备中')).toBeInTheDocument();
    await waitFor(() => expect(restoreSession).toHaveBeenCalledTimes(2));
  });
});

function identityClient(overrides: Partial<IdentityClient>): IdentityClient {
  return {
    hasStoredSession: vi.fn().mockReturnValue(false),
    createSession: vi.fn(),
    changeInitialPassword: vi.fn(),
    restoreSession: vi.fn().mockResolvedValue(null),
    logout: vi.fn().mockResolvedValue(undefined),
    getRestrictedContext: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function planClient(overrides: Partial<PlanClient>): PlanClient {
  return {
    createTransitionIntent: vi.fn((type) => ({ type, idempotencyKey: 'intent' })),
    transition: vi.fn().mockResolvedValue(undefined),
    current: vi.fn().mockResolvedValue({ businessStatus: 'PLAN_GAP', plan: null }),
    history: vi.fn().mockResolvedValue({ items: [] }),
    pending: vi.fn().mockResolvedValue({ businessStatus: 'NO_PENDING_PLAN', plan: null }),
    detail: vi.fn(),
    ...overrides,
  };
}
