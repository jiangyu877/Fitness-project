export const prototypeDisclaimer = '仅用于原型演示，未经专业审核';

export interface DemoPersona {
  id: 'persona_fat_loss' | 'persona_muscle_gain';
  name: string;
  goal: 'fat-loss' | 'muscle-gain';
  goalLabel: string;
  context: string;
  weekLabel: string;
  planStatus: 'active' | 'pending-confirmation';
  completion: number;
  reviewStatus: 'unreviewed-demo';
}

export const demoPersonas: readonly DemoPersona[] = [
  {
    id: 'persona_fat_loss',
    name: '林晓雨',
    goal: 'fat-loss',
    goalLabel: '减脂入门',
    context: '29 岁 · 居家训练 · 第一周执行中',
    weekLabel: '第 1 周 / 共 4 周',
    planStatus: 'active',
    completion: 68,
    reviewStatus: 'unreviewed-demo',
  },
  {
    id: 'persona_muscle_gain',
    name: '周屿',
    goal: 'muscle-gain',
    goalLabel: '增肌入门',
    context: '32 岁 · 商业健身房 · 第二周待确认',
    weekLabel: '第 2 周 / 共 4 周',
    planStatus: 'pending-confirmation',
    completion: 74,
    reviewStatus: 'unreviewed-demo',
  },
];
