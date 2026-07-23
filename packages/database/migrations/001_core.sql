CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS care;
CREATE SCHEMA IF NOT EXISTS planning;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE iam.account (
  id text PRIMARY KEY,
  login_identifier text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('USER', 'STAFF')),
  status text NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'ACTIVE', 'LOCKED', 'DISABLED')),
  initial_password_change_required boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.role (
  code text PRIMARY KEY CHECK (code IN (
    'OPERATIONS',
    'NUTRITION_REVIEWER',
    'TRAINING_REVIEWER',
    'SYSTEM_ADMIN',
    'AUDIT_VIEWER'
  ))
);

INSERT INTO iam.role (code) VALUES
  ('OPERATIONS'),
  ('NUTRITION_REVIEWER'),
  ('TRAINING_REVIEWER'),
  ('SYSTEM_ADMIN'),
  ('AUDIT_VIEWER')
ON CONFLICT DO NOTHING;

CREATE TABLE iam.account_role (
  account_id text NOT NULL REFERENCES iam.account(id),
  role_code text NOT NULL REFERENCES iam.role(code),
  qualified_at timestamptz,
  PRIMARY KEY (account_id, role_code)
);

CREATE TABLE care.consent_record (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES iam.account(id),
  consent_version text NOT NULL,
  accepted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  UNIQUE (user_id, consent_version, accepted_at)
);

CREATE TABLE care.user_profile (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES iam.account(id),
  goal_type text CHECK (goal_type IN ('FAT_LOSS', 'MUSCLE_GAIN')),
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE planning.professional_rule_version (
  id text PRIMARY KEY,
  rule_type text NOT NULL,
  version text NOT NULL,
  approval_status text NOT NULL DEFAULT 'UNAPPROVED'
    CHECK (approval_status IN ('UNAPPROVED', 'APPROVED', 'RETIRED')),
  approved_by text REFERENCES iam.account(id),
  approved_at timestamptz,
  UNIQUE (rule_type, version)
);

CREATE TABLE planning.plan (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES iam.account(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE planning.plan_version (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES planning.plan(id),
  user_id text NOT NULL REFERENCES iam.account(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  source_type text NOT NULL DEFAULT 'INITIAL'
    CHECK (source_type IN ('INITIAL', 'WEEKLY_ADJUSTMENT', 'REVISION', 'ERRATUM')),
  status text NOT NULL CHECK (status IN (
    'DRAFT',
    'IN_REVIEW',
    'READY_TO_PUBLISH',
    'PENDING_CONFIRMATION',
    'SCHEDULED',
    'ACTIVE',
    'STAFF_REVISION_REQUIRED',
    'USER_REVISION_REQUIRED',
    'CONFIRMATION_TIMED_OUT',
    'SUPERSEDED'
  )),
  confirmation_deadline_at timestamptz NOT NULL,
  confirmation_timed_out_at timestamptz,
  effective_at timestamptz NOT NULL,
  effective_to timestamptz,
  professional_rules_approved boolean NOT NULL DEFAULT false,
  demo_only boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version_number)
);

CREATE UNIQUE INDEX uq_plan_version_pending_per_user
  ON planning.plan_version (user_id)
  WHERE status IN ('PENDING_CONFIRMATION', 'SCHEDULED');

CREATE TABLE planning.professional_review (
  id text PRIMARY KEY,
  plan_version_id text NOT NULL REFERENCES planning.plan_version(id),
  review_type text NOT NULL CHECK (review_type IN ('DIET', 'TRAINING')),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reviewer_id text NOT NULL REFERENCES iam.account(id),
  actor_role text NOT NULL CHECK (actor_role IN ('NUTRITION_REVIEWER', 'TRAINING_REVIEWER')),
  decided_at timestamptz NOT NULL,
  UNIQUE (plan_version_id, review_type)
);

CREATE TABLE planning.user_plan_confirmation (
  id text PRIMARY KEY,
  plan_version_id text NOT NULL REFERENCES planning.plan_version(id),
  user_id text NOT NULL REFERENCES iam.account(id),
  confirmation_type text NOT NULL CHECK (confirmation_type IN ('DIET', 'TRAINING')),
  decision text NOT NULL CHECK (decision IN ('ACCEPTED', 'REJECTED')),
  reason_code text,
  decided_at timestamptz NOT NULL,
  UNIQUE (plan_version_id, confirmation_type)
);

CREATE TABLE audit.audit_event (
  id text PRIMARY KEY,
  actor_id text,
  actor_role text NOT NULL,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  request_id text NOT NULL,
  before_version_id text,
  after_version_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

