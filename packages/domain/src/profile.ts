export type ConsentRecord = {
  id: string;
  userId: string;
  consentVersion: string;
  acceptedAt: Date;
};

export type UserProfile = {
  id: string;
  userId: string;
  goalType: 'FAT_LOSS' | 'MUSCLE_GAIN' | null;
  completedSteps: string[];
  version: number;
};
