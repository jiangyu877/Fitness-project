ALTER TABLE audit.idempotency_key
  ADD COLUMN operation text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN principal_scope text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN request_fingerprint text NOT NULL DEFAULT '';

ALTER TABLE iam.session
  ADD COLUMN active_role text;

UPDATE iam.session SET active_role='USER' WHERE session_kind='USER';

ALTER TABLE iam.session
  ADD CONSTRAINT ck_session_active_role
  CHECK (
    active_role IS NULL
    OR (session_kind = 'USER' AND active_role = 'USER')
    OR (session_kind = 'STAFF' AND active_role IN (
      'OPERATIONS',
      'NUTRITION_REVIEWER',
      'TRAINING_REVIEWER',
      'SYSTEM_ADMIN',
      'AUDIT_VIEWER'
    ))
  );

ALTER TABLE audit.audit_event
  DROP CONSTRAINT ck_audit_event_actor_role;

ALTER TABLE audit.audit_event
  ADD CONSTRAINT ck_audit_event_actor_role
  CHECK (actor_role IN (
    'OPERATIONS',
    'NUTRITION_REVIEWER',
    'TRAINING_REVIEWER',
    'SYSTEM_ADMIN',
    'AUDIT_VIEWER',
    'USER',
    'SYSTEM'
  ));
