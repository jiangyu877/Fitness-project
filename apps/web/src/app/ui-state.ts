export const uiStateKinds = [
  'loading',
  'empty',
  'ready',
  'blocked',
  'submitting',
  'success',
  'retryable-error',
  'terminal-error',
] as const;

export type UiStateKind = (typeof uiStateKinds)[number];

interface StatePresentation {
  label: string;
  liveMode: 'off' | 'polite' | 'assertive';
}

const presentations: Record<UiStateKind, StatePresentation> = {
  loading: { label: '正在加载', liveMode: 'polite' },
  empty: { label: '暂无内容', liveMode: 'polite' },
  ready: { label: '可以继续', liveMode: 'off' },
  blocked: { label: '当前操作已暂停', liveMode: 'assertive' },
  submitting: { label: '正在提交', liveMode: 'polite' },
  success: { label: '操作已完成', liveMode: 'polite' },
  'retryable-error': { label: '加载失败，可以重试', liveMode: 'polite' },
  'terminal-error': { label: '当前操作无法继续', liveMode: 'assertive' },
};

export function getStatePresentation(kind: UiStateKind): StatePresentation {
  return presentations[kind];
}
