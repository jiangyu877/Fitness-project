// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WeeklyFeedbackPage } from './weekly-feedback-page.js';

afterEach(cleanup);

const view = {
  windowState: 'OPEN',
  weekIndex: 2,
  sufficiency: 'SUFFICIENT',
  painState: 'CLEAR',
  submissionState: 'NONE',
  nextWindowAt: null,
  fields: [{ id: 'execution', required: true }, { id: 'bodyTrend', required: false }],
  allowedOutcomes: ['KEEP_CORE_PLAN', 'CHANGE_TRAINING_CONTENT'],
};

describe('P12 weekly feedback page', () => {
  it('renders the blocked page for a malformed view', () => {
    render(<WeeklyFeedbackPage view={{ ...view, extra: true }} />);
    expect(screen.getByTestId('weekly-feedback-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-feedback-error-code')).toHaveTextContent('WEEKLY_FEEDBACK_VIEW_INVALID');
  });

  it('renders the open form with server-provided fields and actions', () => {
    const onSubmit = vi.fn();
    render(<WeeklyFeedbackPage view={view} onSubmit={onSubmit} />);
    expect(screen.getByTestId('weekly-feedback')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-feedback-field-execution')).toHaveAttribute('required');
    expect(screen.getByTestId('weekly-feedback-field-bodyTrend')).not.toHaveAttribute('required');
    const buttons = screen.getAllByTestId('weekly-feedback-outcome');
    expect(buttons.map((button) => button.getAttribute('data-outcome')))
      .toEqual(['KEEP_CORE_PLAN', 'CHANGE_TRAINING_CONTENT']);
    fireEvent.click(buttons[1]!);
    expect(onSubmit).toHaveBeenCalledWith('CHANGE_TRAINING_CONTENT');
  });

  it('renders the insufficient-data notice and only the server-allowed outcomes', () => {
    render(<WeeklyFeedbackPage view={{ ...view, sufficiency: 'INSUFFICIENT', allowedOutcomes: ['KEEP_CORE_PLAN'] }} />);
    expect(screen.getByTestId('weekly-feedback-insufficient')).toHaveTextContent('数据不足时保持当前方案');
    expect(screen.getAllByTestId('weekly-feedback-outcome')).toHaveLength(1);
  });

  it('renders the closed window with the next open time and no actions', () => {
    render(<WeeklyFeedbackPage view={{ ...view, windowState: 'CLOSED', nextWindowAt: '2026-09-25T00:00:00.000Z' }} />);
    expect(screen.getByTestId('weekly-feedback-next-window')).toHaveTextContent('2026-09-25T00:00:00.000Z');
    expect(screen.queryAllByTestId('weekly-feedback-outcome')).toHaveLength(0);
  });

  it('renders the risk handoff for reported pain without actions', () => {
    render(<WeeklyFeedbackPage view={{ ...view, painState: 'REPORTED' }} />);
    expect(screen.getByTestId('weekly-feedback-risk')).toHaveTextContent('疼痛进入人工风险处理');
    expect(screen.queryAllByTestId('weekly-feedback-outcome')).toHaveLength(0);
  });

  it('renders the adjustment pending state without actions', () => {
    render(<WeeklyFeedbackPage view={{ ...view, submissionState: 'ADJUSTMENT_PENDING' }} />);
    expect(screen.getByTestId('weekly-feedback-pending')).toHaveTextContent('进入调整等待状态');
    expect(screen.queryAllByTestId('weekly-feedback-outcome')).toHaveLength(0);
  });
});
