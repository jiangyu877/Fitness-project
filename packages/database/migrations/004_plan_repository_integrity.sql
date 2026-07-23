ALTER TABLE audit.idempotency_key
  ADD COLUMN result jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE audit.audit_event
  ADD CONSTRAINT ck_audit_event_actor_role
  CHECK (actor_role IN (
    'OPERATIONS',
    'NUTRITION_REVIEWER',
    'TRAINING_REVIEWER',
    'SYSTEM_ADMIN',
    'AUDIT_VIEWER',
    'USER'
  ));
