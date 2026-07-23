ALTER TABLE planning.plan_version
  ADD COLUMN published_at timestamptz,
  ADD COLUMN rejection_reason_code text;

ALTER TABLE planning.plan_version
  ADD CONSTRAINT ck_plan_version_effective_window
    CHECK (effective_to IS NULL OR effective_to > effective_at),
  ADD CONSTRAINT ck_plan_version_confirmation_deadline_cst
    CHECK (
      confirmation_deadline_at = (
        date_trunc('day', effective_at AT TIME ZONE 'Asia/Shanghai')
        - interval '4 hours'
      ) AT TIME ZONE 'Asia/Shanghai'
    ),
  ADD CONSTRAINT ck_plan_version_publication_lead_time
    CHECK (
      published_at IS NULL
      OR published_at <= confirmation_deadline_at - interval '24 hours'
    ),
  ADD CONSTRAINT ck_plan_version_published_state_has_timestamp
    CHECK (
      status NOT IN (
        'PENDING_CONFIRMATION',
        'SCHEDULED',
        'ACTIVE',
        'USER_REVISION_REQUIRED',
        'CONFIRMATION_TIMED_OUT',
        'SUPERSEDED'
      )
      OR published_at IS NOT NULL
    ),
  ADD CONSTRAINT ck_plan_version_timeout_timestamp
    CHECK (
      (status = 'CONFIRMATION_TIMED_OUT' AND confirmation_timed_out_at IS NOT NULL)
      OR (status <> 'CONFIRMATION_TIMED_OUT' AND confirmation_timed_out_at IS NULL)
    );

CREATE FUNCTION planning.prevent_published_plan_content_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN (
    'PENDING_CONFIRMATION',
    'SCHEDULED',
    'ACTIVE',
    'USER_REVISION_REQUIRED',
    'CONFIRMATION_TIMED_OUT',
    'SUPERSEDED'
  ) AND (
    NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.confirmation_deadline_at IS DISTINCT FROM OLD.confirmation_deadline_at
    OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
    OR NEW.payload IS DISTINCT FROM OLD.payload
  ) THEN
    RAISE EXCEPTION 'published plan version is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_plan_version_published_immutable
BEFORE UPDATE ON planning.plan_version
FOR EACH ROW
EXECUTE FUNCTION planning.prevent_published_plan_content_update();
