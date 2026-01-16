-- ============================================
-- DROP AND RECREATE DATABASE SCHEMA
-- ============================================
-- This script drops all existing database objects and recreates them
-- from the new schema dump.
--
-- WARNING: This will DELETE ALL DATA in your database!
-- Make sure to backup your data before running this script.
--
-- Usage:
--   1. Via Supabase SQL Editor: Copy and paste this entire script
--   2. Via psql: psql $DATABASE_URL -f drop_and_recreate_schema.sql
-- ============================================

BEGIN;

-- ============================================
-- STEP 1: DROP ALL TRIGGERS
-- ============================================
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT trigger_name, event_object_table 
              FROM information_schema.triggers 
              WHERE trigger_schema = 'public') 
    LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.trigger_name) || 
                ' ON ' || quote_ident(r.event_object_table) || ' CASCADE';
    END LOOP;
END $$;

-- ============================================
-- STEP 2: DROP ALL TABLES (CASCADE to handle dependencies)
-- ============================================
DROP TABLE IF EXISTS public.zoho_tokens CASCADE;
DROP TABLE IF EXISTS public.zoho_invoice_logs CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.time_slots CASCADE;
DROP TABLE IF EXISTS public.tenants CASCADE;
DROP TABLE IF EXISTS public.tenant_zoho_configs CASCADE;
DROP TABLE IF EXISTS public.tenant_features CASCADE;
DROP TABLE IF EXISTS public.sms_logs CASCADE;
DROP TABLE IF EXISTS public.slots CASCADE;
DROP TABLE IF EXISTS public.shifts CASCADE;
DROP TABLE IF EXISTS public.services CASCADE;
DROP TABLE IF EXISTS public.service_packages CASCADE;
DROP TABLE IF EXISTS public.service_offers CASCADE;
DROP TABLE IF EXISTS public.service_categories CASCADE;
DROP TABLE IF EXISTS public.reviews CASCADE;
DROP TABLE IF EXISTS public.queue_jobs CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.package_subscriptions CASCADE;
DROP TABLE IF EXISTS public.package_subscription_usage CASCADE;
DROP TABLE IF EXISTS public.package_services CASCADE;
DROP TABLE IF EXISTS public.otp_requests CASCADE;
DROP TABLE IF EXISTS public.employee_services CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.bookings CASCADE;
DROP TABLE IF EXISTS public.booking_locks CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS auth.users CASCADE;

-- ============================================
-- STEP 3: DROP ALL FUNCTIONS
-- ============================================
DROP FUNCTION IF EXISTS public.validate_booking_lock(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.update_zoho_tokens_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.update_tenant_zoho_configs_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.update_tenant_features_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.update_slots_on_service_capacity_change() CASCADE;
DROP FUNCTION IF EXISTS public.update_service_packages_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.update_service_offers_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.update_package_usage_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.update_customer_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_zoho_receipt_on_payment() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_zoho_receipt_on_insert() CASCADE;
DROP FUNCTION IF EXISTS public.sync_all_slots_with_service_capacity() CASCADE;
DROP FUNCTION IF EXISTS public.restore_slot_capacity_on_booking() CASCADE;
DROP FUNCTION IF EXISTS public.restore_package_usage_on_cancellation() CASCADE;
DROP FUNCTION IF EXISTS public.restore_overlapping_slot_capacity() CASCADE;
DROP FUNCTION IF EXISTS public.reduce_slot_capacity_on_booking() CASCADE;
DROP FUNCTION IF EXISTS public.initialize_package_usage() CASCADE;
DROP FUNCTION IF EXISTS public.get_current_user_info() CASCADE;
DROP FUNCTION IF EXISTS public.get_active_locks_for_slots(uuid[]) CASCADE;
DROP FUNCTION IF EXISTS public.generate_tenant_slug() CASCADE;
DROP FUNCTION IF EXISTS public.generate_slots_for_shift(uuid, date, date) CASCADE;
DROP FUNCTION IF EXISTS public.decrement_package_usage_on_booking() CASCADE;
DROP FUNCTION IF EXISTS public.create_tenant_features_for_new_tenant() CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_expired_locks() CASCADE;
DROP FUNCTION IF EXISTS public.check_slot_overbooked() CASCADE;
DROP FUNCTION IF EXISTS public.acquire_booking_lock(uuid, text, integer, integer) CASCADE;

-- ============================================
-- STEP 4: DROP ALL TYPES
-- ============================================
DROP TYPE IF EXISTS public.user_role CASCADE;
DROP TYPE IF EXISTS public.payment_status CASCADE;
DROP TYPE IF EXISTS public.capacity_mode CASCADE;
DROP TYPE IF EXISTS public.booking_status CASCADE;

-- ============================================
-- STEP 5: DROP ALL POLICIES (RLS)
-- ============================================
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT schemaname, tablename, policyname 
              FROM pg_policies 
              WHERE schemaname = 'public') 
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || 
                ' ON ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename);
    END LOOP;
END $$;

COMMIT;

-- ============================================
-- STEP 6: APPLY NEW SCHEMA
-- ============================================
-- Now run the new_schema_dump.sql file
-- This can be done by:
-- 1. Running this script, then separately running new_schema_dump.sql
-- 2. Or concatenating both files together
-- ============================================
