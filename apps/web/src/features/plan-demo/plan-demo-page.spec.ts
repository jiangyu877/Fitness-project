// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DemoContext } from '../../api/demo-client.js';
import { PlanDemoPage } from './plan-demo-page.js';

const fallbackContext: DemoContext = {
  source: 'fallback',
  readiness: {
    readyForRealUsers: false,
    blockers: ['PROFESSIONAL_RULES_UNAPPROVED'],
  },
  fixture: {
    fixtureId: 'persona_muscle_gain',
    goalType: 'MUSCLE_GAIN',
    demoOnly: true,
    reviewStatus: 'DEMO_UNREVIEWED',
    publishable: false,
    disclaimer: '仅用于原型演示，未经专业审核',
  },
};

afterEach(cleanup);

function renderPage() {
  return render(React.createElement(PlanDemoPage, {
    fixtureId: 'persona_muscle_gain',
    loadContext: vi.fn().mockResolvedValue(fallbackContext),
  }));
}

describe('PlanDemoPage', () => {
  it('confirms diet and training independently before waiting for activation', async () => {
    renderPage();

    expect(await screen.findByText('本地安全回退')).toBeInTheDocument();
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认饮食部分' }));
    expect(screen.getByText('饮食已确认')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '待确认计划' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认训练部分' }));
    expect(screen.getByRole('heading', { name: '已双确认，等待生效' })).toBeInTheDocument();
    expect(screen.getByText('当前版本尚未生效', { exact: false })).toBeInTheDocument();
  });

  it('shows timeout, plan gap and risk-paused states without losing the disclaimer', async () => {
    renderPage();
    await screen.findByText('本地安全回退');
    const scenario = screen.getByLabelText('切换计划演示状态');

    fireEvent.change(scenario, { target: { value: 'confirmation-timeout' } });
    expect(screen.getByRole('heading', { name: '确认已超时' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认训练部分' })).toBeDisabled();

    fireEvent.change(scenario, { target: { value: 'plan-gap' } });
    expect(screen.getByRole('heading', { name: '当前处于计划空档' })).toBeInTheDocument();
    expect(screen.getByText('不生成饮食或训练任务')).toBeInTheDocument();

    fireEvent.change(scenario, { target: { value: 'risk-paused' } });
    expect(screen.getByRole('heading', { name: '训练任务已暂停' })).toBeInTheDocument();
    expect(screen.getAllByText('饮食任务仍可继续', { exact: false })).toHaveLength(2);
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();
  });
});
