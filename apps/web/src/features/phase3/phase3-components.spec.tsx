// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../../app/app.js';
import { Phase3Page } from './phase3-pages.js';

afterEach(cleanup);

function renderPage(kind: Parameters<typeof Phase3Page>[0]['kind']) {
  return render(<MemoryRouter><Phase3Page kind={kind} /></MemoryRouter>);
}

describe('Phase3Page safety interactions', () => {
  it('blocks consent until explicitly accepted', () => {
    renderPage('consent');
    expect(screen.getByRole('link', { name: '继续筛查' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('link', { name: '继续筛查' })).toHaveAttribute('href', '/h5/screening');
  });

  it('shows no task before activation and scopes a risk pause', () => {
    renderPage('today');
    for (const scenario of ['待确认', '确认超时', '计划空档', '等待生效']) {
      fireEvent.click(screen.getByRole('button', { name: scenario }));
      expect(screen.getByRole('status')).toHaveTextContent('当前没有可执行任务');
    }
    fireEvent.click(screen.getByRole('button', { name: '当前生效' }));
    expect(screen.getByRole('status')).toHaveTextContent('饮食记录');
    expect(screen.getByRole('status')).toHaveTextContent('训练逐组记录');
    fireEvent.click(screen.getByRole('button', { name: '风险暂停' }));
    expect(screen.getByRole('status')).toHaveTextContent('饮食记录');
    expect(screen.getByRole('status')).not.toHaveTextContent('训练逐组记录');
  });

  it('requires a reason for diet deviation and pauses training after pain', () => {
    const view = renderPage('diet');
    fireEvent.change(screen.getByLabelText('执行状态'), { target: { value: 'partial' } });
    expect(screen.getByRole('button', { name: '提交记录' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('偏离原因'), { target: { value: '加班' } });
    expect(screen.getByRole('button', { name: '提交记录' })).toBeEnabled();
    view.unmount();
    renderPage('training-live');
    fireEvent.click(screen.getByRole('checkbox', { name: '出现疼痛' }));
    expect(screen.getByRole('alert')).toHaveTextContent('关联动作已暂停');
  });

  it('keeps the disclaimer and all demo safety fields visible', () => {
    renderPage('screening');
    expect(screen.getByRole('note')).toHaveTextContent('仅用于原型演示，未经专业审核');
    expect(screen.getByRole('note')).toHaveTextContent('demoOnly=true');
    expect(screen.getByRole('note')).toHaveTextContent('reviewStatus=DEMO_UNREVIEWED');
    expect(screen.getByRole('note')).toHaveTextContent('publishable=false');
  });
});

describe.each([
  ['/web/users/demo', '共享用户详情'],
  ['/web/risks/demo', '风险与异常详情'],
  ['/web/adjustments/review', '周调整审核'],
])('Web phase 3 route %s', (path, title) => {
  it('renders an actionable state instead of the generic placeholder', () => {
    render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接单' })).toBeInTheDocument();
    expect(screen.queryByText('当前演示状态')).not.toBeInTheDocument();
  });
});
