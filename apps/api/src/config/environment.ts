import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_PATH: z.string().trim().min(1, 'DATABASE_PATH is required'),
    DEMO_MODE: booleanString,
    PROFESSIONAL_RULES_APPROVED: booleanString,
    AUTH_SECURITY_POLICY_APPROVED: booleanString,
    PRIVACY_REVIEW_APPROVED: booleanString,
    DATA_RIGHTS_DRILL_COMPLETE: booleanString,
    BACKUP_RESTORE_DRILL_COMPLETE: booleanString,
    OPERATIONS_READINESS_APPROVED: booleanString,
    DEPLOYMENT_SECURITY_APPROVED: booleanString,
  })
  .superRefine((environment, context) => {
    if (environment.DEMO_MODE && environment.NODE_ENV === 'production') {
      context.addIssue({
        code: 'custom',
        path: ['DEMO_MODE'],
        message: 'DEMO_MODE cannot be enabled in production',
      });
    }
  });

export type Environment = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databasePath: string;
  demoMode: boolean;
  professionalRulesApproved: boolean;
  authSecurityPolicyApproved: boolean;
  privacyReviewApproved: boolean;
  dataRightsDrillComplete: boolean;
  backupRestoreDrillComplete: boolean;
  operationsReadinessApproved: boolean;
  deploymentSecurityApproved: boolean;
};

export function parseEnvironment(input: Record<string, string | undefined>): Environment {
  const parsed = environmentSchema.parse(input);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databasePath: parsed.DATABASE_PATH,
    demoMode: parsed.DEMO_MODE,
    professionalRulesApproved: parsed.PROFESSIONAL_RULES_APPROVED,
    authSecurityPolicyApproved: parsed.AUTH_SECURITY_POLICY_APPROVED,
    privacyReviewApproved: parsed.PRIVACY_REVIEW_APPROVED,
    dataRightsDrillComplete: parsed.DATA_RIGHTS_DRILL_COMPLETE,
    backupRestoreDrillComplete: parsed.BACKUP_RESTORE_DRILL_COMPLETE,
    operationsReadinessApproved: parsed.OPERATIONS_READINESS_APPROVED,
    deploymentSecurityApproved: parsed.DEPLOYMENT_SECURITY_APPROVED,
  };
}
