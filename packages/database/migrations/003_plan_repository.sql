ALTER TABLE planning.plan_version
  ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK (record_version > 0);

CREATE TABLE audit.idempotency_key (
  key text PRIMARY KEY,
  result_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
