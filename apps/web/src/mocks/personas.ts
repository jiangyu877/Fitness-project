export const prototypeDisclaimer = '仅用于原型演示，未经专业审核';

type TodayTask = {
  kind: 'meal' | 'training' | 'recovery';
  label: string;
  meta: string;
  action: string;
  to: string;
};

export interface DemoPersona {
  id: 'persona_fat_loss' | 'persona_muscle_gain';
  displayName: string;
  goalType: 'FAT_LOSS' | 'MUSCLE_GAIN';
  goalLabel: string;
  age: number;
  heightCm: number;
  weightKg: number;
  trainingScene: '居家' | '商业健身房';
  trainingDaysPerWeek: number;
  trainingSessions: { completed: number; planned: number };
  mealRecords: { onPlan: number; partialDeviation: number; majorDeviation: number };
  planVersion: string;
  goalSummary: string;
  today: {
    dateLabel: string;
    fixtureState: 'recovery-day' | 'training-day';
    estimatedMinutes?: string;
    tasks: readonly TodayTask[];
  };
  weekLabel: string;
  selectedPlanState: 'EFFECTIVE';
  completion: number;
  demoOnly: true;
  reviewStatus: 'DEMO_UNREVIEWED';
  publishable: false;
}

export interface DemoRuntimeEnvironment {
  mode?: string;
  dev?: boolean;
  demoPersonaSwitcher?: string;
}

export const demoPersonas: readonly DemoPersona[] = [
  {
    id: 'persona_fat_loss',
    displayName: '林悦',
    goalType: 'FAT_LOSS',
    goalLabel: '减脂入门',
    age: 29,
    heightCm: 165,
    weightKg: 68,
    trainingScene: '居家',
    trainingDaysPerWeek: 3,
    trainingSessions: { completed: 3, planned: 3 },
    mealRecords: { onPlan: 4, partialDeviation: 2, majorDeviation: 1 },
    planVersion: 'FL-2026-W30-R1',
    goalSummary: '减脂与生活节奏稳定',
    today: {
      dateLabel: '7月23日 · 周四',
      fixtureState: 'recovery-day',
      tasks: [
        { kind: 'meal', label: '饮食记录', meta: '按计划 · 完成三态打卡', action: '去记录', to: '/h5/records/diet' },
        { kind: 'recovery', label: '恢复日', meta: '无异常 · 保持日常活动', action: '查看计划', to: '/h5/plans/current' },
      ],
    },
    weekLabel: '第 1 周 / 共 4 周',
    selectedPlanState: 'EFFECTIVE',
    completion: 68,
    demoOnly: true,
    reviewStatus: 'DEMO_UNREVIEWED',
    publishable: false,
  },
  {
    id: 'persona_muscle_gain',
    displayName: '周远',
    goalType: 'MUSCLE_GAIN',
    goalLabel: '增肌入门',
    age: 32,
    heightCm: 178,
    weightKg: 69.5,
    trainingScene: '商业健身房',
    trainingDaysPerWeek: 4,
    trainingSessions: { completed: 4, planned: 4 },
    mealRecords: { onPlan: 5, partialDeviation: 2, majorDeviation: 0 },
    planVersion: 'MG-2026-W30-R1',
    goalSummary: '系统学习力量训练，稳定增加训练表现',
    today: {
      dateLabel: '7月23日 · 周四',
      fixtureState: 'training-day',
      estimatedMinutes: '约 50–60 分钟',
      tasks: [
        { kind: 'meal', label: '饮食记录', meta: '按计划 · 完成三态打卡', action: '去记录', to: '/h5/records/diet' },
        { kind: 'training', label: '上肢 B', meta: '最后一个动作可事后补录', action: '开始', to: '/h5/records/training-live' },
      ],
    },
    weekLabel: '第 1 周 / 共 4 周',
    selectedPlanState: 'EFFECTIVE',
    completion: 74,
    demoOnly: true,
    reviewStatus: 'DEMO_UNREVIEWED',
    publishable: false,
  },
];

export function isDemoPersonaSwitcherEnabled(environment: DemoRuntimeEnvironment): boolean {
  return environment.mode === 'development'
    && environment.dev === true
    && environment.demoPersonaSwitcher === 'true';
}
