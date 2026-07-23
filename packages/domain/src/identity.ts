export const staffRoles = [
  'OPERATIONS',
  'NUTRITION_REVIEWER',
  'TRAINING_REVIEWER',
  'SYSTEM_ADMIN',
  'AUDIT_VIEWER',
] as const;

export type StaffRole = (typeof staffRoles)[number];

export type Account = {
  id: string;
  loginIdentifier: string;
  status: 'INVITED' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
  initialPasswordChangeRequired: boolean;
  roles: StaffRole[];
};
