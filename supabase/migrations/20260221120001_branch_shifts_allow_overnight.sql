-- Allow overnight shifts (e.g. 9 PM–12 AM): end_time = midnight is valid.
DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'branch_shifts'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%end_time%'
    AND pg_get_constraintdef(c.oid) LIKE '%start_time%'
  LIMIT 1;
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE branch_shifts DROP CONSTRAINT %I', conname);
  END IF;
  ALTER TABLE branch_shifts
    ADD CONSTRAINT branch_shifts_time_range_check
    CHECK (end_time > start_time OR end_time = '00:00:00'::time);
EXCEPTION
  WHEN duplicate_object THEN NULL; -- constraint already exists (e.g. from fresh migrate)
END $$;
