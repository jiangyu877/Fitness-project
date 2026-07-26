CREATE OR REPLACE FUNCTION planning.prevent_published_plan_content_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN (
    'PENDING_CONFIRMATION', 'SCHEDULED', 'ACTIVE', 'USER_REVISION_REQUIRED',
    'CONFIRMATION_TIMED_OUT', 'SUPERSEDED'
  ) AND (
    NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.confirmation_deadline_at IS DISTINCT FROM OLD.confirmation_deadline_at
    OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
    OR (NEW.payload - 'plan') IS DISTINCT FROM (OLD.payload - 'plan')
    OR (NEW.payload->'plan'->'id') IS DISTINCT FROM (OLD.payload->'plan'->'id')
    OR (NEW.payload->'plan'->'userId') IS DISTINCT FROM (OLD.payload->'plan'->'userId')
    OR (NEW.payload->'plan'->'confirmationDeadlineAt') IS DISTINCT FROM (OLD.payload->'plan'->'confirmationDeadlineAt')
    OR (NEW.payload->'plan'->'effectiveAt') IS DISTINCT FROM (OLD.payload->'plan'->'effectiveAt')
  ) THEN
    RAISE EXCEPTION 'published plan version is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_version_active_per_user
  ON planning.plan_version (user_id)
  WHERE status = 'ACTIVE';
