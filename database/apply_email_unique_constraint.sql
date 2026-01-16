-- Apply Email Unique Constraint
-- This migration ensures email uniqueness in the users table
-- 
-- IMPORTANT: Before running this, check for duplicate emails:
-- SELECT email, COUNT(*) as count 
-- FROM users 
-- WHERE email IS NOT NULL 
-- GROUP BY email 
-- HAVING COUNT(*) > 1;
--
-- If duplicates exist, fix them first using: database/fix_duplicate_emails.sql

-- Step 1: Check for duplicate emails (for reference)
DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT email, COUNT(*) as count 
        FROM users 
        WHERE email IS NOT NULL 
        GROUP BY email 
        HAVING COUNT(*) > 1
    ) duplicates;
    
    IF dup_count > 0 THEN
        RAISE WARNING 'Found % duplicate email(s). Please fix them before applying constraint.', dup_count;
        RAISE EXCEPTION 'Cannot apply constraint: duplicate emails exist. Run database/fix_duplicate_emails.sql first.';
    END IF;
END $$;

-- Step 2: Drop existing index if it exists (in case of re-running)
DROP INDEX IF EXISTS users_email_unique_idx;

-- Step 3: Create unique index on email (allows NULL but enforces uniqueness for non-null emails)
CREATE UNIQUE INDEX users_email_unique_idx 
ON users (email) 
WHERE email IS NOT NULL;

-- Step 4: Add comment for documentation
COMMENT ON INDEX users_email_unique_idx IS 'Ensures email uniqueness in users table (allows NULL values)';

-- Step 5: Verify the constraint was created
DO $$
DECLARE
    index_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE indexname = 'users_email_unique_idx'
    ) INTO index_exists;
    
    IF index_exists THEN
        RAISE NOTICE '✅ Unique constraint on email successfully applied!';
    ELSE
        RAISE EXCEPTION '❌ Failed to create unique constraint';
    END IF;
END $$;
