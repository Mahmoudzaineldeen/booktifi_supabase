/*
  # Drop All Database Objects

  This migration removes all tables, functions, types, and extensions created for the booking system.
  
  ## Warning
  This is a destructive operation that will delete all data and schema objects.
*/

-- Drop all tables in dependency order
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS testimonials CASCADE;
DROP TABLE IF EXISTS tenant_features CASCADE;
DROP TABLE IF EXISTS package_usage CASCADE;
DROP TABLE IF EXISTS package_subscriptions CASCADE;
DROP TABLE IF EXISTS package_services CASCADE;
DROP TABLE IF EXISTS service_packages CASCADE;
DROP TABLE IF EXISTS queue_jobs CASCADE;
DROP TABLE IF EXISTS sms_logs CASCADE;
DROP TABLE IF EXISTS otp_requests CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS tenant_zoho_configs CASCADE;
DROP TABLE IF EXISTS zoho_invoice_logs CASCADE;
DROP TABLE IF EXISTS zoho_tokens CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS booking_locks CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS slots CASCADE;
DROP TABLE IF EXISTS employee_services CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS service_offers CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS service_categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- Drop all functions
DROP FUNCTION IF EXISTS cleanup_expired_locks() CASCADE;
DROP FUNCTION IF EXISTS get_active_locks_for_slots(uuid[]) CASCADE;
DROP FUNCTION IF EXISTS validate_booking_lock(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS acquire_booking_lock(uuid, text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS generate_slots_for_shift(uuid, date, date) CASCADE;
DROP FUNCTION IF EXISTS get_user_tenant_id() CASCADE;
DROP FUNCTION IF EXISTS get_user_role() CASCADE;
DROP FUNCTION IF EXISTS generate_tenant_slug() CASCADE;

-- Drop all custom types
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS booking_status CASCADE;

-- Drop extension
DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
