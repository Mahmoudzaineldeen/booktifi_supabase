-- ============================================
-- QUICK FIX: Run this BEFORE applying the dump
-- ============================================
-- This ensures the auth schema exists and won't cause errors
-- ============================================

CREATE SCHEMA IF NOT EXISTS auth;
ALTER SCHEMA auth OWNER TO postgres;

-- Now you can run the original dump, but replace:
-- CREATE SCHEMA auth;
-- with:
-- CREATE SCHEMA IF NOT EXISTS auth;
-- 
-- Or use the apply_new_schema.sql script which handles everything automatically.
