import { AlertTriangle, CheckCircle2, RotateCcw, ShieldX } from 'lucide-react';
import { useState } from 'react';

import { prototypeDisclaimer } from '../../mocks/personas.js';

export type ReviewKind = 'diet' | 'training';

const reviewCopy = {
  diet: {
    title: '饮食审核',
    role: '营养审核者',
    section: '饮食',
    fact: '饮食结构与执行约束',
    summary: '三餐结构、训练日前后补充与外食替换原则。',
    boundary: '只审核饮食内容，不处理训练审核；编制者不可审核本人直接编制的部分。',
  },
  training: {
    title: '训练审核',
    role: '训练审核者',
    section: '训练',
    fact: '训练结构与疼痛暂停规则',
    summary: '每周三次训练、动作记录要求与关联任务暂停边界。',
    boundary: '只审核训练内容，不处理饮食审核；编制者不可审核本人直接编制的部分。',
  },
} as const;

export function ReviewDetailPage({ kind }: { kind: ReviewKind }) {
  const copy = reviewCopy[kind];
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<'approved' | 'returned'>();

  const resultCopy = result === 'approved'
    ? `本地演示结果：${copy.section}审核已批准`
    : `本地演示结果：${copy.section}审核已退回${comment.trim() ? `；意见：${comment.trim()}` : ''}`;

  return (
    <div className="review-detail-page">
      <header className="review-heading">
        <div>
          <span className="eyebrow">计划审核 · 待处理</span>
          <h1>{copy.title}</h1>
          <p>林晓雨 · 计划版本 V2</p>
        </div>
        <span className="status status--warning">等待{copy.section}审核</span>
      </header>

      <div className="demo-notice demo-notice--strong" role="note">
        <AlertTriangle aria-hidden="true" size={17} />
        <span>{prototypeDisclaimer}</span>
      </div>
      <div className="source-row">
        <span className="source-pill">本地审核演示</span>
        <span>demoOnly=true · DEMO_UNREVIEWED · publishable=false</span>
      </div>

      <div className="review-layout">
        <section className="review-facts" aria-labelledby="review-facts-title">
          <div className="section-heading">
            <div><span className="eyebrow">审阅对象</span><h2 id="review-facts-title">{copy.fact}</h2></div>
          </div>
          <dl className="fact-list">
            <div><dt>用户</dt><dd>林晓雨</dd></div>
            <div><dt>目标</dt><dd>减脂与生活节奏稳定</dd></div>
            <div><dt>版本</dt><dd>计划版本 V2</dd></div>
            <div><dt>事实摘要</dt><dd>{copy.summary}</dd></div>
          </dl>
          <div className="review-boundary">
            <ShieldX aria-hidden="true" />
            <div><strong>当前职责：{copy.role}</strong><span>{copy.boundary}</span></div>
          </div>
        </section>

        <aside className="review-action" aria-labelledby="review-action-title">
          <span className="eyebrow">审核决定</span>
          <h2 id="review-action-title">记录本地演示结果</h2>
          <label htmlFor={`review-comment-${kind}`}>审核意见</label>
          <textarea
            id={`review-comment-${kind}`}
            aria-label="审核意见"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="填写结构化审核意见"
            rows={5}
          />
          <div className="review-actions">
            <button className="button" onClick={() => setResult('approved')}><CheckCircle2 size={17} />批准{copy.section}部分</button>
            <button className="button button--secondary" onClick={() => setResult('returned')}><RotateCcw size={17} />退回{copy.section}部分</button>
          </div>
          {result && <p className={`review-result review-result--${result}`} role="status">{resultCopy}</p>}
          <div className="publish-block">
            <strong>真人发布已阻断</strong>
            <span>演示内容未经专业审核，不能发布或用于真人指导。</span>
            <button className="button" disabled>发布给真人用户</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
