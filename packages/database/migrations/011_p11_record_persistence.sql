CREATE SCHEMA IF NOT EXISTS recording;

CREATE UNIQUE INDEX uq_plan_id_user_id
  ON planning.plan (id, user_id);

CREATE UNIQUE INDEX uq_plan_version_id_plan_user
  ON planning.plan_version (id, plan_id, user_id);

CREATE UNIQUE INDEX uq_session_id_account_id
  ON iam.session (id, account_id);

CREATE TABLE recording.p11_write_gate_revision (
  gate_id text NOT NULL CHECK (gate_id = 'P11_RECORD_WRITE'),
  revision bigint NOT NULL CHECK (revision > 0),
  node_env text NOT NULL CHECK (node_env = 'TEST'),
  test_only boolean NOT NULL CHECK (test_only),
  approved_for_real_users boolean NOT NULL CHECK (NOT approved_for_real_users),
  route_access_approved boolean NOT NULL,
  write_enabled boolean NOT NULL,
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) > 0),
  hmac_key_id text NOT NULL CHECK (length(btrim(hmac_key_id)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gate_id, revision)
);

CREATE FUNCTION recording.prevent_p11_write_gate_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P11 write gate revisions are append-only';
END;
$$;

CREATE TRIGGER trg_p11_write_gate_revision_append_only
BEFORE UPDATE OR DELETE ON recording.p11_write_gate_revision
FOR EACH ROW
EXECUTE FUNCTION recording.prevent_p11_write_gate_revision_mutation();

CREATE TABLE recording.p11_write_gate (
  id text PRIMARY KEY CHECK (id = 'P11_RECORD_WRITE'),
  current_revision bigint NOT NULL CHECK (current_revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_p11_write_gate_current_revision
    FOREIGN KEY (id, current_revision)
    REFERENCES recording.p11_write_gate_revision(gate_id, revision)
);

CREATE TABLE recording.record_task (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  plan_id text NOT NULL,
  plan_version_id text NOT NULL,
  business_date date NOT NULL,
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) > 0),
  gate_id text NOT NULL CHECK (gate_id = 'P11_RECORD_WRITE'),
  gate_revision bigint NOT NULL CHECK (gate_revision > 0),
  close_policy text NOT NULL CHECK (close_policy = 'TEST_ONLY_EXPLICIT'),
  task_state text NOT NULL CHECK (task_state IN ('OPEN', 'CLOSED', 'UNKNOWN')),
  date_state text NOT NULL CHECK (date_state IN ('OPEN', 'CLOSED', 'UNKNOWN')),
  risk_state text NOT NULL CHECK (risk_state IN ('CLEAR', 'BLOCKED', 'UNKNOWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_record_task_account
    FOREIGN KEY (user_id) REFERENCES iam.account(id),
  CONSTRAINT fk_record_task_plan_owner
    FOREIGN KEY (plan_id, user_id) REFERENCES planning.plan(id, user_id),
  CONSTRAINT fk_record_task_plan_version
    FOREIGN KEY (plan_version_id, plan_id, user_id)
    REFERENCES planning.plan_version(id, plan_id, user_id),
  CONSTRAINT fk_record_task_gate_revision
    FOREIGN KEY (gate_id, gate_revision)
    REFERENCES recording.p11_write_gate_revision(gate_id, revision),
  CONSTRAINT uq_record_task_scope
    UNIQUE (id, user_id, business_date, schema_version)
);

CREATE INDEX ix_record_task_user_date
  ON recording.record_task (user_id, business_date, id);

CREATE TABLE recording.record (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  user_id text NOT NULL,
  business_date date NOT NULL,
  record_kind_id text NOT NULL CHECK (length(btrim(record_kind_id)) > 0),
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) > 0),
  record_version integer NOT NULL CHECK (record_version > 0),
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_record_task_scope
    FOREIGN KEY (task_id, user_id, business_date, schema_version)
    REFERENCES recording.record_task(id, user_id, business_date, schema_version),
  CONSTRAINT uq_record_task_kind UNIQUE (task_id, record_kind_id),
  CONSTRAINT uq_record_id_task_owner_kind_schema
    UNIQUE (id, task_id, user_id, record_kind_id, schema_version),
  CONSTRAINT uq_record_id_task_owner_schema
    UNIQUE (id, task_id, user_id, schema_version)
);

CREATE TABLE recording.record_idempotency (
  key_id text NOT NULL CHECK (length(btrim(key_id)) > 0),
  idempotency_key_digest bytea NOT NULL CHECK (octet_length(idempotency_key_digest) = 32),
  intent_digest bytea NOT NULL CHECK (octet_length(intent_digest) = 32),
  principal_id text NOT NULL REFERENCES iam.account(id),
  session_id text NOT NULL,
  task_id text NOT NULL,
  business_date date NOT NULL,
  record_kind_id text NOT NULL CHECK (length(btrim(record_kind_id)) > 0),
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) > 0),
  operation text NOT NULL CHECK (operation = 'UPSERT_RECORD'),
  status text NOT NULL CHECK (status IN ('CLAIMED', 'COMPLETED')),
  record_id text REFERENCES recording.record(id),
  replay_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (key_id, idempotency_key_digest),
  CONSTRAINT fk_record_idempotency_session
    FOREIGN KEY (session_id, principal_id) REFERENCES iam.session(id, account_id),
  CONSTRAINT fk_record_idempotency_task_scope
    FOREIGN KEY (task_id, principal_id, business_date, schema_version)
    REFERENCES recording.record_task(id, user_id, business_date, schema_version),
  CONSTRAINT fk_record_idempotency_record_scope
    FOREIGN KEY (record_id, task_id, principal_id, record_kind_id, schema_version)
    REFERENCES recording.record(id, task_id, user_id, record_kind_id, schema_version),
  CONSTRAINT ck_record_idempotency_replay_object
    CHECK (replay_result IS NULL OR jsonb_typeof(replay_result) = 'object'),
  CONSTRAINT ck_record_idempotency_completion
    CHECK (
      (status = 'CLAIMED' AND record_id IS NULL AND replay_result IS NULL AND completed_at IS NULL)
      OR
      (status = 'COMPLETED' AND record_id IS NOT NULL AND replay_result IS NOT NULL AND completed_at IS NOT NULL)
    )
);

CREATE INDEX ix_record_idempotency_scope
  ON recording.record_idempotency (
    principal_id, task_id, business_date, record_kind_id, schema_version, operation
  );

CREATE TABLE recording.record_success_audit (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role = 'USER'),
  action text NOT NULL CHECK (action = 'RECORD_UPSERTED'),
  subject_type text NOT NULL CHECK (subject_type = 'P11_RECORD'),
  record_id text NOT NULL,
  task_id text NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) > 0),
  record_version integer NOT NULL CHECK (record_version > 0),
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) > 0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_record_success_audit_record_scope
    FOREIGN KEY (record_id, task_id, actor_id, schema_version)
    REFERENCES recording.record(id, task_id, user_id, schema_version)
);

CREATE UNIQUE INDEX uq_record_success_audit_version
  ON recording.record_success_audit (record_id, record_version);

CREATE FUNCTION recording.reject_record_success_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'record_success_audit is append-only';
END;
$$;

CREATE TRIGGER tr_record_success_audit_append_only
BEFORE UPDATE OR DELETE ON recording.record_success_audit
FOR EACH ROW
EXECUTE FUNCTION recording.reject_record_success_audit_mutation();
