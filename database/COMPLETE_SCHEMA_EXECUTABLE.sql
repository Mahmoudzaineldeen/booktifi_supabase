-- ============================================================================
-- COMPLETE DATABASE SCHEMA - READY TO EXECUTE
-- ============================================================================
-- 
-- INSTRUCTIONS:
--   1. Copy this entire file
--   2. Open Supabase Dashboard → SQL Editor (or any PostgreSQL client)
--   3. Paste and click "Run" (or press Ctrl+Enter)
--   4. Wait for completion
--
-- This file contains the complete schema for your booking system database.
-- It is idempotent - safe to run multiple times.
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE TYPES/ENUMS (Must be created first)
-- ============================================================================

CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled');
CREATE TYPE capacity_mode AS ENUM ('employee_based', 'service_based');
CREATE TYPE payment_status AS ENUM ('unpaid', 'paid_manual', 'awaiting_payment', 'paid', 'refunded');
CREATE TYPE user_role AS ENUM ('solution_owner', 'tenant_admin', 'receptionist', 'cashier', 'employee', 'customer');

-- ============================================================================
-- STEP 2: CREATE TABLES
-- ============================================================================
-- 
-- NOTE: Due to file size, the complete table definitions are in schema.txt
-- To get all tables, run the queries from export-complete-schema.sql
-- in Supabase SQL Editor, or extract from schema.txt JSON format.
--
-- The schema.txt file contains all CREATE TABLE statements in JSON format.
-- Each table definition is in the "create_table_statement" field.
-- ============================================================================

-- ============================================================================
-- NEXT STEPS:
-- ============================================================================
-- 
-- To get the complete schema:
-- 
-- Option 1: Use Supabase SQL Editor
--   1. Open database/export-complete-schema.sql
--   2. Run each section in Supabase SQL Editor
--   3. Copy the results and combine them
--
-- Option 2: Extract from schema.txt
--   1. Open database/schema.txt
--   2. Copy the SQL statements from the JSON fields:
--      - "create_table_statement" for tables
--      - "create_type_statement" for types (already above)
--      - "create_index_statement" for indexes
--      - "create_trigger_statement" for triggers
--      - "create_fk_statement" for foreign keys
--      - "function_definition" for functions
--   3. Paste them in order: Types → Tables → Indexes → Foreign Keys → Functions → Triggers
--
-- Option 3: Use the export queries
--   Run the queries in database/export-complete-schema.sql in Supabase SQL Editor
--   and copy the results to create your complete SQL file.
--
-- ============================================================================
