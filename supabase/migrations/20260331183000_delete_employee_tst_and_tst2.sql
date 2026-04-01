-- Remove test employee account(s) named "tst" and "tst2".
-- Safe to run multiple times (idempotent).
WITH target_employees AS (
  SELECT id
  FROM users
  WHERE role = 'employee'
    AND (
      LOWER(COALESCE(username, '')) IN ('tst', 'tst2')
      OR LOWER(COALESCE(full_name, '')) IN ('tst', 'tst2')
      OR LOWER(COALESCE(email, '')) IN (
        'tst',
        'tst2',
        'tst@bookati.local',
        'tst2@bookati.local'
      )
    )
)
DELETE FROM users u
USING target_employees t
WHERE u.id = t.id;
