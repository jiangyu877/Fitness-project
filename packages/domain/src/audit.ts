import type { StaffRole } from './identity.js';

export type AuditEvent = {
  id: string;
  actorId: string;
  actorRole: StaffRole | 'USER' | 'SYSTEM';
  action: string;
  subjectType: string;
  subjectId: string;
  requestId: string;
  occurredAt: Date;
  beforeVersionId: string | null;
  afterVersionId: string | null;
};
