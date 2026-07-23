// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AppRoutes } from './app.js';
import { pageCatalog } from '../mocks/page-catalog.js';

function renderAt(path: string) {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(AppRoutes),
    ),
  );
}

afterEach(cleanup);

describe('H5 shell', () => {
  it('shows the prototype warning and switches between both demo personas', () => {
    renderAt('/h5/today');

    expect(screen.getByRole('heading', { name: '今天，先完成最重要的事' })).toBeInTheDocument();
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();
    expect(screen.getByLabelText('切换演示用户')).toHaveValue('persona_fat_loss');

    fireEvent.change(screen.getByLabelText('切换演示用户'), { target: { value: 'persona_muscle_gain' } });
    expect(screen.getByLabelText('切换演示用户')).toHaveValue('persona_muscle_gain');
    expect(screen.getByText('待确认')).toBeInTheDocument();
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
      const expectedHeading = page.id === 'H5-TOD-01' ? '今天，先完成最重要的事' : page.title;
      expect(screen.getByRole('heading', { name: expectedHeading })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('renders dedicated phase two plan and review experiences', () => {
    const plan = renderAt('/h5/plans/pending');
    expect(screen.getByRole('button', { name: '确认饮食部分' })).toBeInTheDocument();
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
});
