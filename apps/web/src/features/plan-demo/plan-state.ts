export type PlanScenario =
  | 'pending-confirmation'
  | 'scheduled'
  | 'confirmation-timeout'
  | 'plan-gap'
  | 'risk-paused';

export interface PlanDemoState {
  status: PlanScenario;
  confirmations: { diet: boolean; training: boolean };
  canConfirm: boolean;
  isEffective: boolean;
  oldPlanActive: boolean;
  availableTasks: { diet: boolean; training: boolean };
  riskScope: 'none' | 'training';
}

const scenarios: Record<PlanScenario, PlanDemoState> = {
  'pending-confirmation': {
    status: 'pending-confirmation',
    confirmations: { diet: false, training: false },
    canConfirm: true,
    isEffective: false,
    oldPlanActive: true,
    availableTasks: { diet: true, training: true },
    riskScope: 'none',
  },
  scheduled: {
    status: 'scheduled',
    confirmations: { diet: true, training: true },
    canConfirm: false,
    isEffective: false,
    oldPlanActive: true,
    availableTasks: { diet: true, training: true },
    riskScope: 'none',
  },
  'confirmation-timeout': {
    status: 'confirmation-timeout',
    confirmations: { diet: true, training: false },
    canConfirm: false,
    isEffective: false,
    oldPlanActive: true,
    availableTasks: { diet: true, training: true },
    riskScope: 'none',
  },
  'plan-gap': {
    status: 'plan-gap',
    confirmations: { diet: false, training: false },
    canConfirm: false,
    isEffective: false,
    oldPlanActive: false,
    availableTasks: { diet: false, training: false },
    riskScope: 'none',
  },
  'risk-paused': {
    status: 'risk-paused',
    confirmations: { diet: true, training: true },
    canConfirm: false,
    isEffective: true,
    oldPlanActive: true,
    availableTasks: { diet: true, training: false },
    riskScope: 'training',
  },
};

export function createPlanScenario(scenario: PlanScenario): PlanDemoState {
  const state = scenarios[scenario];
  return {
    ...state,
    confirmations: { ...state.confirmations },
    availableTasks: { ...state.availableTasks },
  };
}

export function confirmPlanSection(
  state: PlanDemoState,
  section: 'diet' | 'training',
): PlanDemoState {
  if (!state.canConfirm || state.status !== 'pending-confirmation') return state;

  const confirmations = { ...state.confirmations, [section]: true };
  const bothConfirmed = confirmations.diet && confirmations.training;
  return {
    ...state,
    status: bothConfirmed ? 'scheduled' : 'pending-confirmation',
    confirmations,
    canConfirm: !bothConfirmed,
    isEffective: false,
  };
}
