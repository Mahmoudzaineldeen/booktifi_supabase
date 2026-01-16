-- Add password_hash column to users table for authentication
-- This allows users to authenticate without Supabase Auth

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash) WHERE password_hash IS NOT NULL;

-- Note: Existing users will need to set passwords
-- You can create a migration script to hash existing passwords if needed
























