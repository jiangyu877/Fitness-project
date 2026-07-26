ALTER TABLE care.user_profile
  ADD COLUMN schema_version text;

ALTER TABLE care.user_profile
  ADD CONSTRAINT user_profile_schema_version_nonempty
  CHECK (schema_version IS NULL OR length(btrim(schema_version)) > 0);
