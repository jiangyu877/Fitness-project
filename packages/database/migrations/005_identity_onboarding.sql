ALTER TABLE iam.account
  ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN disabled_at timestamptz,
  ADD COLUMN password_changed_at timestamptz;

CREATE TABLE iam.session (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES iam.account(id),
  session_kind text NOT NULL CHECK (session_kind IN ('USER', 'STAFF')),
  token_hash text NOT NULL UNIQUE,
  mfa_verified boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE care.consent_record
  ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK (record_version > 0);

CREATE TABLE care.screening_result (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES iam.account(id),
  conclusion text NOT NULL CHECK (conclusion IN ('PASS', 'HUMAN_REVIEW', 'EXCLUDED')),
  source text NOT NULL CHECK (source IN ('PROFESSIONAL_RULE', 'MANUAL_REVIEW')),
  rule_version text,
  recorded_by text NOT NULL REFERENCES iam.account(id),
  actor_role text NOT NULL CHECK (actor_role IN ('NUTRITION_REVIEWER', 'TRAINING_REVIEWER')),
  created_at timestamptz NOT NULL DEFAULT now()
);
