// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { P07ClientError, type P07Client } from './p07-client.js';
import { P07Page } from './p07-page.js';

afterEach(cleanup);

const session = { accountId: 'trusted-user', token: 'trusted-token' };

describe('P07Page', () => {
  it('renders only server consent content and requires explicit agreement before accepting', async () => {
    const acceptConsent = vi.fn().mockResolvedValue({ businessStatus: 'CONSENT_ACCEPTED', consentId: 'c1', consentVersion: 'v2', version: 1 });
    const client = p07Client({
      currentConsent: vi.fn().mockResolvedValue({ businessStatus: 'CURRENT_CONSENT_AVAILABLE', consentVersion: 'v2', content: { format: 'PLAIN_TEXT', text: '服务端批准正文' } }),
      acceptConsent,
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><P07Page action="ACCEPT_CURRENT_CONSENT" session={session} client={client} onSessionRefresh={refresh} /></MemoryRouter>);

    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
    expect(await screen.findByText('服务端批准正文')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: '明确同意' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '我已阅读并明确同意当前授权内容' }));
    fireEvent.click(submit);

    await waitFor(() => expect(acceptConsent).toHaveBeenCalledWith(session, 'v2'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not show acceptance or inferred retry when consent loading is blocked', async () => {
    const client = p07Client({ currentConsent: vi.fn().mockRejectedValue(new P07ClientError('暂不可用', 503, 'CURRENT_CONSENT_VERSION_UNAVAILABLE', ['WAIT_FOR_SECURITY_APPROVAL'])) });
    render(<MemoryRouter><P07Page action="ACCEPT_CURRENT_CONSENT" session={session} client={client} onSessionRefresh={vi.fn()} /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('暂不可用');
    expect(screen.queryByRole('button', { name: '明确同意' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it.each([
    ['WAIT_FOR_SCREENING_RULES', '筛查规则准备中'],
    ['WAIT_FOR_HUMAN_REVIEW', '等待专业复核'],
    ['STOP_SERVICE_FLOW', '服务流程已停止'],
    ['WAIT_FOR_PLAN', '计划准备中'],
  ] as const)('renders server screening action %s', async (action, heading) => {
    const client = p07Client({ screeningStatus: vi.fn().mockResolvedValue({ businessStatus: 'SCREENING_STATUS_AVAILABLE', nextAction: action, conclusion: action === 'WAIT_FOR_SCREENING_RULES' ? null : 'PASS' }) });
    render(<MemoryRouter><P07Page action={action} session={session} client={client} onSessionRefresh={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByText(/诊断|阈值|筛查题/)).not.toBeInTheDocument();
  });

  it('fails closed when the screening response conflicts with the routed action', async () => {
    const client = p07Client({ screeningStatus: vi.fn().mockResolvedValue({ businessStatus: 'SCREENING_STATUS_AVAILABLE', nextAction: 'WAIT_FOR_PLAN', conclusion: 'PASS' }) });
    render(<MemoryRouter><P07Page action="WAIT_FOR_HUMAN_REVIEW" session={session} client={client} onSessionRefresh={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '联系运营' })).toBeInTheDocument();
  });

  it('renders the approved schema in order, restores drafts, and rereads server state after save', async () => {
    const first = profile({ recordVersion: 2, drafts: { basics: { nickname: '已有输入', age: 28, active: true } } });
    const completed = profile({ recordVersion: 3, completedSteps: ['basics'], currentStep: null, drafts: first.drafts });
    const readProfile = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(completed);
    const saveProfileStep = vi.fn().mockResolvedValue({ businessStatus: 'PROFILE_DRAFT_SAVED', requestId: 'server-request-1', version: 3 });
    const refreshSession = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><P07Page action="COMPLETE_PROFILE" session={session} client={p07Client({ profile: readProfile, saveProfileStep })} onSessionRefresh={refreshSession} /></MemoryRouter>);

    expect(await screen.findByRole('textbox', { name: 'nickname' })).toHaveValue('已有输入');
    expect(screen.getByRole('spinbutton', { name: 'age' })).toHaveValue(28);
    expect(screen.getByRole('checkbox', { name: 'active' })).toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: 'nickname' }), { target: { value: '新输入' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本步' }));

    await waitFor(() => expect(saveProfileStep).toHaveBeenCalledWith(session, 'basics', { schemaVersion: 'profile-v1', expectedVersion: 2, data: { nickname: '新输入', age: 28, active: true } }));
    expect(readProfile).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('closes the editor and refreshes the trusted session when the initial profile is complete', async () => {
    const refreshSession = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><P07Page action="COMPLETE_PROFILE" session={session} client={p07Client({
      profile: vi.fn().mockResolvedValue(profile({ completedSteps: ['basics'], currentStep: null })),
    })} onSessionRefresh={refreshSession} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '建档已完成' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存本步' })).not.toBeInTheDocument();
    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
  });

  it('closes the editor and refreshes the trusted session when save returns a completed profile', async () => {
    const first = profile({ recordVersion: 2, drafts: { basics: { nickname: '已有输入', age: 28, active: true } } });
    const completed = profile({ recordVersion: 3, completedSteps: ['basics'], currentStep: null, drafts: first.drafts });
    const refreshSession = vi.fn().mockResolvedValue(undefined);
    const profileRead = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(completed);
    render(<MemoryRouter><P07Page action="COMPLETE_PROFILE" session={session} client={p07Client({
      profile: profileRead,
      saveProfileStep: vi.fn().mockResolvedValue({ businessStatus: 'PROFILE_DRAFT_SAVED', requestId: 'request-1', version: 3 }),
    })} onSessionRefresh={refreshSession} /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '保存本步' }));

    expect(await screen.findByRole('heading', { name: '建档已完成' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存本步' })).not.toBeInTheDocument();
    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
  });

  it('clears stale profile editing after an authoritative reread failure', async () => {
    const profileRead = vi.fn()
      .mockResolvedValueOnce(profile({ drafts: { basics: { nickname: 'server', age: 28, active: false } } }))
      .mockRejectedValueOnce(new P07ClientError('profile 读取失败', 502, 'PROFILE_RESPONSE_INVALID', ['CONTACT_OPERATIONS']));
    const saveProfileStep = vi.fn().mockResolvedValue({ businessStatus: 'PROFILE_DRAFT_SAVED', requestId: 'request-1', version: 1 });
    render(<MemoryRouter><P07Page action="COMPLETE_PROFILE" session={session} client={p07Client({ profile: profileRead, saveProfileStep })} onSessionRefresh={vi.fn()} /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '保存本步' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('profile 读取失败');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存本步' })).not.toBeInTheDocument();
  });

  it('preserves local input on 409 and refreshes only when the server allows REFRESH', async () => {
    const readProfile = vi.fn().mockResolvedValue(profile({ recordVersion: 2, drafts: { basics: { nickname: 'server', age: 28, active: false } } }));
    const saveProfileStep = vi.fn().mockRejectedValue(new P07ClientError('版本已变化', 409, 'VERSION_CONFLICT', ['REFRESH']));
    render(<MemoryRouter><P07Page action="COMPLETE_PROFILE" session={session} client={p07Client({ profile: readProfile, saveProfileStep })} onSessionRefresh={vi.fn()} /></MemoryRouter>);
    const input = await screen.findByRole('textbox', { name: 'nickname' });
    fireEvent.change(input, { target: { value: '必须保留' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本步' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('版本已变化');
    expect(input).toHaveValue('必须保留');
    fireEvent.click(screen.getByRole('button', { name: '刷新服务端版本' }));
    await waitFor(() => expect(readProfile).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue('必须保留');
  });

  it('keeps profile blocked for malformed schema and does not infer refresh', async () => {
    const blocked = new P07ClientError('schema 不可用', 502, 'PROFILE_SCHEMA_UNAVAILABLE', ['CONTACT_OPERATIONS']);
    render(<MemoryRouter><P07Page action="COMPLETE_PROFILE" session={session} client={p07Client({ profile: vi.fn().mockRejectedValue(blocked) })} onSessionRefresh={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('schema 不可用');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新|重试/ })).not.toBeInTheDocument();
  });
});

function p07Client(overrides: Partial<P07Client>): P07Client {
  return {
    currentConsent: vi.fn(),
    acceptConsent: vi.fn(),
    screeningStatus: vi.fn(),
    profile: vi.fn().mockRejectedValue(new P07ClientError('批准的 profile 字段契约尚未提供。', 503, 'PROFILE_SCHEMA_UNAVAILABLE', ['CONTACT_OPERATIONS'])),
    saveProfileStep: vi.fn(),
    ...overrides,
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    businessStatus: 'PROFILE_DRAFT_AVAILABLE' as const,
    schemaVersion: 'profile-v1',
    steps: [{ id: 'basics', fields: [{ name: 'nickname', type: 'STRING' as const, required: true }, { name: 'age', type: 'NUMBER' as const, required: true }, { name: 'active', type: 'BOOLEAN' as const, required: false }] }],
    recordVersion: 0,
    completedSteps: [],
    currentStep: 'basics',
    drafts: {},
    ...overrides,
  };
}
