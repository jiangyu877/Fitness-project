ALTER TABLE iam.session
  ADD COLUMN session_scope text NOT NULL DEFAULT 'FULL'
  CHECK (session_scope IN ('FULL', 'PASSWORD_CHANGE'));

ALTER TABLE iam.session
  ADD CONSTRAINT ck_password_change_session
  CHECK (
    session_scope = 'FULL'
    OR (
      session_kind = 'USER'
      AND active_role IS NOT NULL
      AND active_role = 'USER'
    )
  );

CREATE FUNCTION iam.enforce_password_change_account_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_scope = 'PASSWORD_CHANGE'
     AND NOT EXISTS (
       SELECT 1 FROM iam.account
       WHERE id = NEW.account_id AND account_type = 'USER'
     ) THEN
    RAISE EXCEPTION 'password change session requires USER account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_password_change_account_type
BEFORE INSERT OR UPDATE OF account_id, session_kind, active_role, session_scope ON iam.session
FOR EACH ROW EXECUTE FUNCTION iam.enforce_password_change_account_type();

CREATE FUNCTION iam.prevent_password_change_account_type_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_type <> 'USER'
     AND EXISTS (SELECT 1 FROM iam.session WHERE account_id = NEW.id AND session_scope = 'PASSWORD_CHANGE') THEN
    RAISE EXCEPTION 'account with password change session must remain USER';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_password_change_account_update
BEFORE UPDATE OF account_type ON iam.account
FOR EACH ROW EXECUTE FUNCTION iam.prevent_password_change_account_type_update();
