// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/app.js';
import { AuthOnboardingPage } from './auth-onboarding-pages.js';
import { IdentityError, type IdentityClient } from '../identity/identity-client.js';
import { IdentityNextActionPage } from '../identity/identity-next-action-page.js';

afterEach(cleanup);

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
}

function renderIdentity(kind: 'invited-login' | 'change-password' | 'contact-operations', client: IdentityClient) {
  return render(
    <MemoryRouter initialEntries={[kind === 'invited-login' ? '/h5/login' : '/h5/change-password']}>
      <Routes>
        <Route path="/h5/login" element={<AuthOnboardingPage kind="invited-login" identityClient={client} />} />
        <Route path="/h5/contact-operations" element={<AuthOnboardingPage kind="contact-operations" identityClient={client} />} />
        <Route path="/h5/identity/contact-operations" element={<IdentityNextActionPage nextAction="CONTACT_OPERATIONS" />} />
        <Route path="*" element={<AuthOnboardingPage kind={kind} identityClient={client} />} />
        <Route path="/h5/consent" element={<h1>知情说明与授权</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

function createClient(overrides: Partial<IdentityClient> = {}): IdentityClient {
  return {
    hasStoredSession: vi.fn().mockReturnValue(false),
    createSession: vi.fn(),
    changeInitialPassword: vi.fn(),
    restoreSession: vi.fn().mockResolvedValue(null),
    logout: vi.fn().mockResolvedValue(undefined),
    getRestrictedContext: vi.fn().mockReturnValue({ expectedVersion: 2, expiresAt: '2026-07-23T17:00:00Z' }),
    ...overrides,
  };
}

describe('invited authentication and onboarding routes', () => {
  it('supports invited credentials and visible session recovery', () => {
    renderRoute('/h5/login');
    expect(screen.getByLabelText('受邀账号')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('会话可恢复');
  });

  it('validates first password change and focuses the error summary', () => {
    renderRoute('/h5/change-password');
    fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
    const summary = screen.getByRole('alert');
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent('请检查');
  });

  it.each(['fat-loss-invite', 'muscle-gain-invite'])('submits invited credentials through the same identity contract for %s', async (loginId) => {
    const client = createClient({ createSession: vi.fn().mockResolvedValue({ kind: 'password-change-required', expiresAt: '2026-07-23T17:00:00Z', expectedVersion: 2, nextAction: 'CHANGE_INITIAL_PASSWORD' }) });
    renderIdentity('invited-login', client);

    fireEvent.change(screen.getByLabelText('受邀账号'), { target: { value: loginId } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'initial-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(client.createSession).toHaveBeenCalledWith({ loginId, password: 'initial-secret' }));
  });

  it('keeps new-password input and focuses a live error summary when confirmation differs', async () => {
    const client = createClient();
    renderIdentity('change-password', client);

    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-secret' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'different-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByLabelText('新密码')).toHaveValue('new-secret');
    expect(client.changeInitialPassword).not.toHaveBeenCalled();
  });

  it.each([401, 409, 423, 503])('preserves a replacement password after recoverable identity error %s', async (status) => {
    const client = createClient({ changeInitialPassword: vi.fn().mockRejectedValue(new IdentityError('request rejected', status, 'IDENTITY_REJECTED', ['CONTACT_OPERATIONS'])) });
    renderIdentity('change-password', client);

    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'replacement-secret' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'replacement-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));

    expect(await screen.findByRole('alert')).toHaveFocus();
    expect(screen.getByLabelText('新密码')).toHaveValue('replacement-secret');
  });

  it('routes an unknown server next action to the conservative contact-operations page', async () => {
    const client = createClient({ createSession: vi.fn().mockResolvedValue({ kind: 'session-created', expiresAt: '2026-07-23T18:00:00Z', nextAction: 'FUTURE_UNCLASSIFIED_ACTION' }) });
    renderIdentity('invited-login', client);

    fireEvent.change(screen.getByLabelText('受邀账号'), { target: { value: 'fat-loss-invite' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('heading', { name: '联系运营' })).toBeInTheDocument();
  });

  it('clears the client session and returns to login from contact operations', async () => {
    const client = createClient();
    renderIdentity('contact-operations', client);

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(client.logout).toHaveBeenCalledOnce());
    expect(await screen.findByRole('heading', { name: '受邀登录' })).toBeInTheDocument();
  });

  it('keeps the user on contact operations and focuses an error when logout cannot complete', async () => {
    const client = createClient({ logout: vi.fn().mockRejectedValue(new IdentityError('服务暂不可用，请稍后重试。', 503, 'SERVICE_UNAVAILABLE')) });
    renderIdentity('contact-operations', client);

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByRole('heading', { name: '联系运营' })).toBeInTheDocument();
  });

  it('shows consent version and disables acceptance when loading fails', () => {
    renderRoute('/h5/consent');
    expect(screen.getByText('说明版本 v1.0-demo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '演示加载失败' }));
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '明确同意' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '退出流程' })).toBeEnabled();
  });

  it('submits questionnaire structure then displays a read-only system result', () => {
    renderRoute('/h5/screening');
    expect(screen.getByRole('group', { name: '筛查问卷字段骨架' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交问卷骨架' }));
    expect(screen.getByText('系统结果：HUMAN_REVIEW')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PASS|EXCLUDED/ })).not.toBeInTheDocument();
  });

  it('restores profile drafts and locates missing and conflicting fields', () => {
    renderRoute('/h5/profile');
    fireEvent.click(screen.getByRole('button', { name: '恢复演示草稿' }));
    expect(screen.getByLabelText('训练经验')).toHaveValue('6个月');
    fireEvent.click(screen.getByRole('button', { name: '检查并保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('目标体重');
    expect(screen.getByRole('alert')).toHaveTextContent('训练频率存在矛盾');
  });

  it('shows preparation timeline and human review actions', () => {
    renderRoute('/h5/plan-preparation');
    expect(screen.getByRole('list', { name: '计划准备时间线' })).toBeInTheDocument();
    expect(screen.getByText('人工复核中')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '联系运营' })).toBeInTheDocument();
  });

  it('provides employee login and role state without invented MFA parameters', () => {
    renderRoute('/web/login');
    expect(screen.getByLabelText('员工账号')).toBeInTheDocument();
    expect(screen.getByText('当前角色：运营人员（演示）')).toBeInTheDocument();
    expect(screen.getByText('MFA 实施参数待安全评审')).toBeInTheDocument();
    expect(screen.queryByLabelText(/验证码/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: '真人服务门禁' }).querySelectorAll('li')).toHaveLength(8);
  });
});
