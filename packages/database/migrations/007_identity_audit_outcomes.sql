ALTER TABLE audit.audit_event
  ADD COLUMN outcome text NOT NULL DEFAULT 'SUCCEEDED'
    CHECK (outcome IN ('SUCCEEDED', 'REJECTED')),
  ADD COLUMN error_code text;
