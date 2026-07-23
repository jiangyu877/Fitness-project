// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../../app/app.js';

afterEach(cleanup);

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
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
