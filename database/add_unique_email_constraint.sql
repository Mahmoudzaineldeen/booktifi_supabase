-- Add Unique Constraint on Email
-- This migration ensures email uniqueness in the users table
-- 
-- IMPORTANT: Before running this, you must resolve any duplicate emails
-- Run: database/fix_duplicate_emails.sql first if duplicates exist

-- Step 1: Check for duplicate emails (for reference)
-- SELECT email, COUNT(*) as count 
-- FROM users 
-- WHERE email IS NOT NULL 
-- GROUP BY email 
-- HAVING COUNT(*) > 1;

-- Step 2: Add unique constraint on email (only if email is not null)
-- We use a partial unique index to allow NULL emails but enforce uniqueness for non-null emails
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx 
ON users (email) 
WHERE email IS NOT NULL;

-- Step 3: Add a comment for documentation
COMMENT ON INDEX users_email_unique_idx IS 'Ensures email uniqueness in users table (allows NULL)';

-- Alternative: If you want to enforce NOT NULL on email as well, uncomment:
-- ALTER TABLE users ALTER COLUMN email SET NOT NULL;
-- Then use: ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
