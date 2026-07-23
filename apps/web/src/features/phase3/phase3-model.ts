export type PlanStatus = 'pending-confirmation' | 'confirmation-timeout' | 'plan-gap' | 'scheduled' | 'risk-paused';

export const phase3Model = {
  consent: { canContinue: (accepted: boolean) => accepted },
  screening: { resolve: (result: 'pass' | 'risk' | 'exclude') => result === 'pass' ? 'approved' : result === 'risk' ? 'human-review' : 'stopped' },
  today: { tasks: (status: PlanStatus) => status === 'scheduled' ? ['diet', 'training'] : status === 'risk-paused' ? ['diet'] : [] },
  records: {
    dietValid: (state: 'on-plan' | 'partial' | 'clear-deviation', reason: string) => state === 'on-plan' || reason.trim().length > 0,
    trainingAfterPain: (_note: string) => 'paused-human-review',
  },
};

export const demoSafety = { demoOnly: true, reviewStatus: 'DEMO_UNREVIEWED', publishable: false } as const;
