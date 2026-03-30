-- Remove test employee account(s) named "tst".
-- Safe to run multiple times (idempotent).
WITH target_employees AS (
  SELECT id
  FROM users
  WHERE role = 'employee'
    AND (
      LOWER(COALESCE(username, '')) = 'tst'
      OR LOWER(COALESCE(full_name, '')) = 'tst'
      OR LOWER(COALESCE(email, '')) IN ('tst', 'tst@bookati.local')
    )
)
DELETE FROM users u
USING target_employees t
WHERE u.id = t.id;
