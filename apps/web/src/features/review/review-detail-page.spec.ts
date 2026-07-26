// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ReviewDetailPage } from './review-detail-page.js';
import { demoPersonas } from '../../mocks/personas.js';

afterEach(cleanup);

describe('ReviewDetailPage', () => {
  it.each([
    ['diet', '饮食审核', '营养审核者', '饮食结构与执行约束'],
    ['training', '训练审核', '训练审核者', '训练结构与疼痛暂停规则'],
  ] as const)('shows scoped %s review facts and blocks demo publishing', (kind, title, role, fact) => {
    render(React.createElement(ReviewDetailPage, { kind, persona: demoPersonas[0]! }));

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('林悦')).toBeInTheDocument();
    expect(screen.getByText('计划版本 FL-2026-W30-R1')).toBeInTheDocument();
    expect(screen.getByText(fact)).toBeInTheDocument();
    expect(screen.getByText(`当前职责：${role}`)).toBeInTheDocument();
    expect(screen.getByText('demoOnly=true · DEMO_UNREVIEWED · publishable=false')).toBeInTheDocument();
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布给真人用户' })).toBeDisabled();
  });

  it('keeps approval and return decisions local while preserving the safety warning', () => {
    render(React.createElement(ReviewDetailPage, { kind: 'diet', persona: demoPersonas[0]! }));

    fireEvent.click(screen.getByRole('button', { name: '批准饮食部分' }));
    expect(screen.getByRole('status')).toHaveTextContent('本地演示结果：饮食审核已批准');
    expect(screen.getByText('仅用于原型演示，未经专业审核')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('审核意见'), { target: { value: '请补充执行边界。' } });
    fireEvent.click(screen.getByRole('button', { name: '退回饮食部分' }));
    expect(screen.getByRole('status')).toHaveTextContent('本地演示结果：饮食审核已退回');
    expect(screen.getByRole('status')).toHaveTextContent('请补充执行边界。');
    expect(screen.getByText('demoOnly=true · DEMO_UNREVIEWED · publishable=false')).toBeInTheDocument();
  });
});
