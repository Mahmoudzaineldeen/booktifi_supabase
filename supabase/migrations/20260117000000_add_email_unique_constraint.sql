-- Add Unique Constraint on Email
-- Migration: 20260117000000_add_email_unique_constraint.sql
-- 
-- This migration ensures email uniqueness in the users table to prevent
-- login issues caused by multiple users with the same email.
--
-- IMPORTANT: Run scripts/check-and-fix-duplicate-emails.js --fix first
-- if you have existing duplicate emails.

-- Check for duplicate emails before applying constraint
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
        RAISE EXCEPTION 'Cannot apply constraint: duplicate emails exist. Run scripts/check-and-fix-duplicate-emails.js --fix first.';
    END IF;
END $$;

-- Drop existing index if it exists (in case of re-running)
DROP INDEX IF EXISTS users_email_unique_idx;

-- Create unique index on email (allows NULL but enforces uniqueness for non-null emails)
CREATE UNIQUE INDEX users_email_unique_idx 
ON users (email) 
WHERE email IS NOT NULL;

-- Add comment for documentation
COMMENT ON INDEX users_email_unique_idx IS 'Ensures email uniqueness in users table (allows NULL values)';

-- Verify the constraint was created
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
