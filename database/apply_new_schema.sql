-- ============================================
-- COMPLETE DATABASE SCHEMA REPLACEMENT
-- ============================================
-- This script drops all existing database objects and recreates them
-- with the new schema provided.
--
-- WARNING: This will DELETE ALL DATA in your database!
-- Make sure to backup your data before running this script.
--
-- Usage:
--   1. Via Supabase SQL Editor: Copy and paste this entire script
--   2. Via psql: psql $DATABASE_URL -f apply_new_schema.sql
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
-- STEP 2: DROP ALL POLICIES (RLS)
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

-- ============================================
-- STEP 3: DROP ALL TABLES (CASCADE to handle dependencies)
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
-- Note: auth.users is managed by Supabase and should NOT be dropped
-- DROP TABLE IF EXISTS auth.users CASCADE;

-- ============================================
-- STEP 4: DROP ALL FUNCTIONS
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
-- STEP 5: DROP ALL TYPES
-- ============================================
DROP TYPE IF EXISTS public.user_role CASCADE;
DROP TYPE IF EXISTS public.payment_status CASCADE;
DROP TYPE IF EXISTS public.capacity_mode CASCADE;
DROP TYPE IF EXISTS public.booking_status CASCADE;

COMMIT;

-- ============================================
-- STEP 6: CREATE SCHEMA AND EXTENSIONS
-- ============================================
-- Note: auth schema is managed by Supabase and should NOT be created or altered
-- CREATE SCHEMA IF NOT EXISTS auth;
-- ALTER SCHEMA auth OWNER TO postgres;  -- Cannot alter Supabase-managed schema

-- Create uuid-ossp extension for uuid_generate_v4() function
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';

-- ============================================
-- STEP 7: CREATE TYPES
-- ============================================
CREATE TYPE public.booking_status AS ENUM (
    'pending',
    'confirmed',
    'checked_in',
    'completed',
    'cancelled'
);
ALTER TYPE public.booking_status OWNER TO postgres;

CREATE TYPE public.capacity_mode AS ENUM (
    'employee_based',
    'service_based'
);
ALTER TYPE public.capacity_mode OWNER TO postgres;

CREATE TYPE public.payment_status AS ENUM (
    'unpaid',
    'paid_manual',
    'awaiting_payment',
    'paid',
    'refunded'
);
ALTER TYPE public.payment_status OWNER TO postgres;

CREATE TYPE public.user_role AS ENUM (
    'solution_owner',
    'tenant_admin',
    'receptionist',
    'cashier',
    'employee',
    'customer'
);
ALTER TYPE public.user_role OWNER TO postgres;

-- ============================================
-- STEP 8: CREATE FUNCTIONS
-- ============================================

-- acquire_booking_lock
CREATE FUNCTION public.acquire_booking_lock(p_slot_id uuid, p_session_id text, p_reserved_capacity integer, p_lock_duration_seconds integer DEFAULT 120) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_slot_record RECORD;
  v_locked_capacity integer;
  v_available_capacity integer;
  v_lock_id uuid;
BEGIN
  SELECT id, available_capacity, is_available, original_capacity
  INTO v_slot_record
  FROM slots
  WHERE id = p_slot_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot not found';
  END IF;
  
  IF NOT v_slot_record.is_available THEN
    RAISE EXCEPTION 'Slot is not available';
  END IF;
  
  SELECT COALESCE(SUM(reserved_capacity), 0)
  INTO v_locked_capacity
  FROM booking_locks
  WHERE slot_id = p_slot_id
    AND lock_expires_at > now();
  
  v_available_capacity := v_slot_record.available_capacity - v_locked_capacity;
  
  IF v_available_capacity < p_reserved_capacity THEN
    RAISE EXCEPTION 'Not enough tickets available. Only % available, but % requested.', 
      v_available_capacity, p_reserved_capacity;
  END IF;
  
  INSERT INTO booking_locks (
    slot_id, reserved_by_session_id, reserved_capacity, lock_expires_at
  ) VALUES (
    p_slot_id, p_session_id, p_reserved_capacity,
    now() + (p_lock_duration_seconds || ' seconds')::interval
  )
  RETURNING id INTO v_lock_id;
  
  RETURN v_lock_id;
END;
$$;
ALTER FUNCTION public.acquire_booking_lock(uuid, text, integer, integer) OWNER TO postgres;

-- check_slot_overbooked
CREATE FUNCTION public.check_slot_overbooked() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.available_capacity < NEW.booked_count THEN
    NEW.is_overbooked := true;
  ELSE
    NEW.is_overbooked := false;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.check_slot_overbooked() OWNER TO postgres;

-- cleanup_expired_locks
CREATE FUNCTION public.cleanup_expired_locks() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM booking_locks WHERE lock_expires_at <= now();
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;
ALTER FUNCTION public.cleanup_expired_locks() OWNER TO postgres;

-- create_tenant_features_for_new_tenant
CREATE FUNCTION public.create_tenant_features_for_new_tenant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO tenant_features (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.create_tenant_features_for_new_tenant() OWNER TO postgres;

-- decrement_package_usage_on_booking
CREATE FUNCTION public.decrement_package_usage_on_booking() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.package_subscription_id IS NOT NULL AND NEW.status != 'cancelled' THEN
    UPDATE package_subscription_usage
    SET remaining_quantity = remaining_quantity - 1,
        used_quantity = used_quantity + 1,
        updated_at = now()
    WHERE subscription_id = NEW.package_subscription_id
      AND service_id = NEW.service_id
      AND remaining_quantity > 0;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No available package quantity for service in subscription %', NEW.package_subscription_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.decrement_package_usage_on_booking() OWNER TO postgres;

-- generate_slots_for_shift (abbreviated - full version in new_schema_dump.sql)
CREATE FUNCTION public.generate_slots_for_shift(p_shift_id uuid, p_start_date date, p_end_date date) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_tenant_id uuid;
  v_service_id uuid;
  v_start_time_utc time;
  v_end_time_utc time;
  v_days_of_week integer[];
  v_service_duration_minutes integer;
  v_service_capacity_per_slot integer;
  v_capacity_mode capacity_mode;
  v_employee_record record;
  v_current_date date;
  v_slot_start_minutes integer;
  v_slot_end_minutes integer;
  v_shift_start_minutes integer;
  v_shift_end_minutes integer;
  v_shift_duration_minutes integer;
  v_slots_generated integer := 0;
  v_start_time time;
  v_end_time time;
  v_start_timestamp timestamptz;
  v_end_timestamp timestamptz;
  v_employees_count integer;
  v_employee_duration integer;
  v_employee_capacity integer;
  v_slot_capacity integer;
BEGIN
  SELECT sh.tenant_id, sh.service_id, sh.start_time_utc, sh.end_time_utc, sh.days_of_week,
         srv.service_duration_minutes, COALESCE(srv.service_capacity_per_slot, 1) as service_capacity_per_slot,
         srv.capacity_mode
  INTO v_tenant_id, v_service_id, v_start_time_utc, v_end_time_utc, v_days_of_week,
       v_service_duration_minutes, v_service_capacity_per_slot, v_capacity_mode
  FROM shifts sh
  JOIN services srv ON sh.service_id = srv.id
  WHERE sh.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  v_shift_start_minutes := EXTRACT(HOUR FROM v_start_time_utc) * 60 + EXTRACT(MINUTE FROM v_start_time_utc);
  v_shift_end_minutes := EXTRACT(HOUR FROM v_end_time_utc) * 60 + EXTRACT(MINUTE FROM v_end_time_utc);
  v_shift_duration_minutes := v_shift_end_minutes - v_shift_start_minutes;

  IF v_shift_duration_minutes < v_service_duration_minutes THEN
    RAISE EXCEPTION 'Shift duration (%) is shorter than service duration (%)', 
      v_shift_duration_minutes, v_service_duration_minutes;
  END IF;

  DELETE FROM slots
  WHERE shift_id = p_shift_id
    AND slot_date >= p_start_date
    AND slot_date <= p_end_date;

  SELECT COUNT(*) INTO v_employees_count
  FROM employee_services
  WHERE shift_id = p_shift_id;

  IF v_capacity_mode = 'service_based' THEN
    v_slot_capacity := v_service_capacity_per_slot;
    IF v_slot_capacity IS NULL OR v_slot_capacity = 0 THEN
      RAISE EXCEPTION 'Service capacity not configured for service-based mode';
    END IF;
  ELSE
    IF v_employees_count = 0 THEN
      RAISE EXCEPTION 'No employees assigned to this shift for employee-based service';
    END IF;
  END IF;

  v_current_date := p_start_date;
  WHILE v_current_date <= p_end_date LOOP
    IF EXTRACT(DOW FROM v_current_date)::integer = ANY(v_days_of_week) THEN
      IF v_capacity_mode = 'service_based' THEN
        v_slot_start_minutes := v_shift_start_minutes;
        WHILE v_slot_start_minutes + v_service_duration_minutes <= v_shift_end_minutes LOOP
          v_slot_end_minutes := v_slot_start_minutes + v_service_duration_minutes;
          v_start_time := make_time(v_slot_start_minutes / 60, v_slot_start_minutes % 60, 0);
          v_end_time := make_time(v_slot_end_minutes / 60, v_slot_end_minutes % 60, 0);
          v_start_timestamp := v_current_date + v_start_time;
          v_end_timestamp := v_current_date + v_end_time;

          INSERT INTO slots (
            tenant_id, shift_id, employee_id, slot_date, start_time, end_time,
            start_time_utc, end_time_utc, available_capacity, original_capacity, booked_count, is_available
          ) VALUES (
            v_tenant_id, p_shift_id, NULL, v_current_date, v_start_time, v_end_time,
            v_start_timestamp, v_end_timestamp, v_slot_capacity, v_slot_capacity, 0, true
          );

          v_slots_generated := v_slots_generated + 1;
          v_slot_start_minutes := v_slot_start_minutes + v_service_duration_minutes;
        END LOOP;
      ELSE
        FOR v_employee_record IN
          (SELECT DISTINCT es.employee_id,
                  COALESCE(es.duration_minutes, v_service_duration_minutes) as duration_minutes,
                  COALESCE(es.capacity_per_slot, v_service_capacity_per_slot) as capacity_per_slot
           FROM employee_services es
           WHERE es.shift_id = p_shift_id
           UNION
           SELECT DISTINCT es.employee_id,
                  COALESCE(es.duration_minutes, v_service_duration_minutes) as duration_minutes,
                  COALESCE(es.capacity_per_slot, v_service_capacity_per_slot) as capacity_per_slot
           FROM employee_services es
           WHERE es.service_id = v_service_id AND es.shift_id IS NULL AND v_employees_count = 0
           UNION
           SELECT DISTINCT u.id as employee_id,
                  v_service_duration_minutes as duration_minutes,
                  v_service_capacity_per_slot as capacity_per_slot
           FROM users u
           WHERE u.tenant_id = v_tenant_id AND u.role = 'employee' AND u.is_active = true
             AND v_employees_count = 0
             AND NOT EXISTS (SELECT 1 FROM employee_services WHERE service_id = v_service_id))
        LOOP
          v_employee_duration := v_employee_record.duration_minutes;
          v_employee_capacity := v_employee_record.capacity_per_slot;
          v_slot_start_minutes := v_shift_start_minutes;

          WHILE v_slot_start_minutes + v_employee_duration <= v_shift_end_minutes LOOP
            v_slot_end_minutes := v_slot_start_minutes + v_employee_duration;
            v_start_time := make_time(v_slot_start_minutes / 60, v_slot_start_minutes % 60, 0);
            v_end_time := make_time(v_slot_end_minutes / 60, v_slot_end_minutes % 60, 0);
            v_start_timestamp := v_current_date + v_start_time;
            v_end_timestamp := v_current_date + v_end_time;

            INSERT INTO slots (
              tenant_id, shift_id, employee_id, slot_date, start_time, end_time,
              start_time_utc, end_time_utc, available_capacity, original_capacity, booked_count, is_available
            ) VALUES (
              v_tenant_id, p_shift_id, v_employee_record.employee_id, v_current_date,
              v_start_time, v_end_time, v_start_timestamp, v_end_timestamp,
              v_employee_capacity, v_employee_capacity, 0, true
            );

            v_slots_generated := v_slots_generated + 1;
            v_slot_start_minutes := v_slot_start_minutes + v_employee_duration;
          END LOOP;
        END LOOP;
      END IF;
    END IF;
    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN v_slots_generated;
END;
$$;
ALTER FUNCTION public.generate_slots_for_shift(uuid, date, date) OWNER TO postgres;

-- generate_tenant_slug
CREATE FUNCTION public.generate_tenant_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := lower(regexp_replace(NEW.name, '[^a-zA-Z0-9]+', '', 'g'));
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.generate_tenant_slug() OWNER TO postgres;

-- get_active_locks_for_slots
CREATE FUNCTION public.get_active_locks_for_slots(p_slot_ids uuid[]) RETURNS TABLE(slot_id uuid, total_locked_capacity integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT bl.slot_id, COALESCE(SUM(bl.reserved_capacity), 0)::integer as total_locked_capacity
  FROM booking_locks bl
  WHERE bl.slot_id = ANY(p_slot_ids) AND bl.lock_expires_at > now()
  GROUP BY bl.slot_id;
END;
$$;
ALTER FUNCTION public.get_active_locks_for_slots(uuid[]) OWNER TO postgres;

-- get_current_user_info
CREATE FUNCTION public.get_current_user_info() RETURNS TABLE(user_role public.user_role, user_tenant_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT u.role, u.tenant_id
  FROM public.users u
  WHERE u.id = auth.uid()
  LIMIT 1;
END;
$$;
ALTER FUNCTION public.get_current_user_info() OWNER TO postgres;

-- initialize_package_usage
CREATE FUNCTION public.initialize_package_usage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO package_subscription_usage (subscription_id, service_id, original_quantity, remaining_quantity, used_quantity)
  SELECT NEW.id, ps.service_id, ps.quantity, ps.quantity, 0
  FROM package_services ps
  WHERE ps.package_id = NEW.package_id;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.initialize_package_usage() OWNER TO postgres;

-- reduce_slot_capacity_on_booking
CREATE FUNCTION public.reduce_slot_capacity_on_booking() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    UPDATE slots
    SET available_capacity = GREATEST(0, available_capacity - NEW.visitor_count),
        booked_count = booked_count + NEW.visitor_count
    WHERE id = NEW.slot_id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.reduce_slot_capacity_on_booking() OWNER TO postgres;
COMMENT ON FUNCTION public.reduce_slot_capacity_on_booking() IS 'Reduces slot available_capacity when a booking is confirmed';

-- restore_overlapping_slot_capacity
CREATE FUNCTION public.restore_overlapping_slot_capacity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_booking_slot_date date;
  v_booking_start_time time;
  v_booking_end_time time;
  v_employee_id uuid;
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'completed') THEN
    SELECT s.slot_date, s.start_time, s.end_time, b.employee_id
    INTO v_booking_slot_date, v_booking_start_time, v_booking_end_time, v_employee_id
    FROM slots s
    JOIN bookings b ON b.slot_id = s.id
    WHERE b.id = NEW.id;

    IF v_employee_id IS NOT NULL THEN
      UPDATE slots
      SET available_capacity = LEAST(original_capacity, available_capacity + OLD.visitor_count)
      WHERE id IN (
        SELECT s2.id
        FROM slots s2
        WHERE s2.employee_id = v_employee_id
          AND s2.slot_date = v_booking_slot_date
          AND (s2.start_time < v_booking_end_time AND s2.end_time > v_booking_start_time)
          AND s2.id != OLD.slot_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.restore_overlapping_slot_capacity() OWNER TO postgres;

-- restore_package_usage_on_cancellation
CREATE FUNCTION public.restore_package_usage_on_cancellation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND NEW.package_subscription_id IS NOT NULL THEN
    IF NEW.service_id IS NOT NULL THEN
      UPDATE package_subscription_usage
      SET used_quantity = GREATEST(0, used_quantity - NEW.visitor_count),
          remaining_quantity = remaining_quantity + NEW.visitor_count,
          updated_at = now()
      WHERE subscription_id = NEW.package_subscription_id AND service_id = NEW.service_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.restore_package_usage_on_cancellation() OWNER TO postgres;

-- restore_slot_capacity_on_booking
CREATE FUNCTION public.restore_slot_capacity_on_booking() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'completed') THEN
    UPDATE slots
    SET available_capacity = LEAST(original_capacity, available_capacity + OLD.visitor_count),
        booked_count = GREATEST(0, booked_count - OLD.visitor_count)
    WHERE id = OLD.slot_id;
  END IF;

  IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
    UPDATE slots
    SET available_capacity = GREATEST(0, available_capacity - NEW.visitor_count),
        booked_count = booked_count + NEW.visitor_count
    WHERE id = NEW.slot_id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.restore_slot_capacity_on_booking() OWNER TO postgres;
COMMENT ON FUNCTION public.restore_slot_capacity_on_booking() IS 'Manages slot capacity when booking status changes between confirmed, cancelled, completed, or no_show';

-- sync_all_slots_with_service_capacity
CREATE FUNCTION public.sync_all_slots_with_service_capacity() RETURNS TABLE(service_id uuid, service_name text, slots_updated integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_service_record RECORD;
  v_updated_count integer;
BEGIN
  FOR v_service_record IN
    SELECT s.id, s.name, s.service_capacity_per_slot
    FROM services s
    WHERE s.capacity_mode = 'service_based' AND s.service_capacity_per_slot IS NOT NULL
  LOOP
    UPDATE slots sl
    SET original_capacity = v_service_record.service_capacity_per_slot,
        available_capacity = GREATEST(0, v_service_record.service_capacity_per_slot - sl.booked_count),
        is_overbooked = (sl.booked_count > v_service_record.service_capacity_per_slot)
    FROM shifts sh
    WHERE sh.service_id = v_service_record.id
      AND sl.shift_id = sh.id
      AND sl.slot_date >= CURRENT_DATE
      AND (sl.original_capacity != v_service_record.service_capacity_per_slot
           OR sl.available_capacity != GREATEST(0, v_service_record.service_capacity_per_slot - sl.booked_count));
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    service_id := v_service_record.id;
    service_name := v_service_record.name;
    slots_updated := v_updated_count;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
ALTER FUNCTION public.sync_all_slots_with_service_capacity() OWNER TO postgres;
COMMENT ON FUNCTION public.sync_all_slots_with_service_capacity() IS 'Syncs all future slots with their service''s current capacity. Can be run manually to fix capacity mismatches.';

-- trigger_zoho_receipt_on_insert
CREATE FUNCTION public.trigger_zoho_receipt_on_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.payment_status = 'paid' AND NEW.zoho_invoice_id IS NULL THEN
    INSERT INTO queue_jobs (job_type, payload, status)
    VALUES ('zoho_receipt',
            jsonb_build_object('booking_id', NEW.id, 'tenant_id', NEW.tenant_id, 'attempt', 0),
            'pending');
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.trigger_zoho_receipt_on_insert() OWNER TO postgres;

-- trigger_zoho_receipt_on_payment
CREATE FUNCTION public.trigger_zoho_receipt_on_payment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
    IF NEW.zoho_invoice_id IS NULL THEN
      INSERT INTO queue_jobs (job_type, payload, status)
      VALUES ('zoho_receipt',
              jsonb_build_object('booking_id', NEW.id, 'tenant_id', NEW.tenant_id, 'attempt', 0),
              'pending');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.trigger_zoho_receipt_on_payment() OWNER TO postgres;

-- update_customer_updated_at
CREATE FUNCTION public.update_customer_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.update_customer_updated_at() OWNER TO postgres;

-- update_package_usage_updated_at
CREATE FUNCTION public.update_package_usage_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.update_package_usage_updated_at() OWNER TO postgres;

-- update_service_offers_updated_at
CREATE FUNCTION public.update_service_offers_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.update_service_offers_updated_at() OWNER TO postgres;

-- update_service_packages_updated_at
CREATE FUNCTION public.update_service_packages_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.update_service_packages_updated_at() OWNER TO postgres;

-- update_slots_on_service_capacity_change
CREATE FUNCTION public.update_slots_on_service_capacity_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_new_capacity integer;
  v_old_capacity integer;
  v_updated_count integer;
BEGIN
  IF NEW.capacity_mode = 'service_based' AND NEW.service_capacity_per_slot IS NOT NULL THEN
    v_new_capacity := NEW.service_capacity_per_slot;
    v_old_capacity := OLD.service_capacity_per_slot;
    
    UPDATE slots s
    SET original_capacity = v_new_capacity,
        available_capacity = GREATEST(0, v_new_capacity - s.booked_count),
        is_overbooked = (s.booked_count > v_new_capacity)
    FROM shifts sh
    WHERE sh.service_id = NEW.id AND s.shift_id = sh.id AND s.slot_date >= CURRENT_DATE;
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    
    IF v_old_capacity IS DISTINCT FROM v_new_capacity THEN
      RAISE NOTICE 'Updated % slots for service %: capacity changed from % to %', 
        v_updated_count, NEW.id, COALESCE(v_old_capacity::text, 'NULL'), v_new_capacity;
    ELSE
      RAISE NOTICE 'Updated % slots for service %: capacity set to %', 
        v_updated_count, NEW.id, v_new_capacity;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.update_slots_on_service_capacity_change() OWNER TO postgres;
COMMENT ON FUNCTION public.update_slots_on_service_capacity_change() IS 'Automatically updates slot capacities when service capacity is changed. Only affects future slots.';

-- update_tenant_features_updated_at
CREATE FUNCTION public.update_tenant_features_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.update_tenant_features_updated_at() OWNER TO postgres;

-- update_tenant_zoho_configs_updated_at
CREATE FUNCTION public.update_tenant_zoho_configs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.update_tenant_zoho_configs_updated_at() OWNER TO postgres;

-- update_zoho_tokens_updated_at
CREATE FUNCTION public.update_zoho_tokens_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.update_zoho_tokens_updated_at() OWNER TO postgres;

-- validate_booking_lock
CREATE FUNCTION public.validate_booking_lock(p_lock_id uuid, p_session_id text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_lock_record RECORD;
BEGIN
  SELECT id, slot_id, reserved_by_session_id, reserved_capacity, lock_expires_at
  INTO v_lock_record
  FROM booking_locks
  WHERE id = p_lock_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  IF v_lock_record.lock_expires_at <= now() THEN
    RETURN false;
  END IF;
  
  IF v_lock_record.reserved_by_session_id != p_session_id THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$;
ALTER FUNCTION public.validate_booking_lock(uuid, text) OWNER TO postgres;

-- ============================================
-- STEP 9: CREATE TABLES
-- ============================================

-- auth.users
-- NOTE: auth.users is managed by Supabase and should NOT be created or modified
-- Supabase automatically creates and manages this table for authentication
-- CREATE TABLE auth.users (
--     id uuid DEFAULT uuid_generate_v4() NOT NULL,
--     email text,
--     created_at timestamp with time zone DEFAULT now()
-- );
-- ALTER TABLE auth.users OWNER TO postgres;
-- ALTER TABLE ONLY auth.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);

-- audit_logs
CREATE TABLE public.audit_logs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid,
    user_id uuid,
    action_type text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    old_values jsonb,
    new_values jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.audit_logs OWNER TO postgres;
ALTER TABLE ONLY public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

-- booking_locks
CREATE TABLE public.booking_locks (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    slot_id uuid NOT NULL,
    reserved_by_session_id text NOT NULL,
    reserved_capacity integer DEFAULT 1 NOT NULL,
    lock_acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    lock_expires_at timestamp with time zone NOT NULL,
    CONSTRAINT booking_locks_reserved_capacity_check CHECK ((reserved_capacity > 0))
);
ALTER TABLE public.booking_locks OWNER TO postgres;
ALTER TABLE ONLY public.booking_locks ADD CONSTRAINT booking_locks_pkey PRIMARY KEY (id);

-- bookings
CREATE TABLE public.bookings (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    employee_id uuid,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    visitor_count integer DEFAULT 1 NOT NULL,
    total_price numeric(10,2) NOT NULL,
    status public.booking_status DEFAULT 'pending'::public.booking_status NOT NULL,
    payment_status public.payment_status DEFAULT 'unpaid'::public.payment_status NOT NULL,
    notes text,
    qr_token text,
    created_by_user_id uuid,
    checked_in_at timestamp with time zone,
    checked_in_by_user_id uuid,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    booking_group_id uuid,
    package_subscription_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid,
    offer_id uuid,
    adult_count integer NOT NULL,
    child_count integer DEFAULT 0 NOT NULL,
    qr_scanned boolean DEFAULT false NOT NULL,
    qr_scanned_at timestamp with time zone,
    qr_scanned_by_user_id uuid,
    package_id uuid,
    zoho_invoice_id text,
    zoho_invoice_created_at timestamp with time zone,
    language text DEFAULT 'en'::text NOT NULL,
    CONSTRAINT bookings_adult_count_check CHECK ((adult_count >= 0)),
    CONSTRAINT bookings_child_count_check CHECK ((child_count >= 0)),
    CONSTRAINT bookings_language_check CHECK ((language = ANY (ARRAY['en'::text, 'ar'::text]))),
    CONSTRAINT bookings_total_price_check CHECK ((total_price >= (0)::numeric)),
    CONSTRAINT bookings_visitor_count_check CHECK (((visitor_count = (adult_count + child_count)) AND (visitor_count > 0)))
);
ALTER TABLE public.bookings OWNER TO postgres;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
COMMENT ON COLUMN public.bookings.customer_id IS 'References the user account of the customer who made this booking. NULL for guest bookings.';
COMMENT ON COLUMN public.bookings.offer_id IS 'References the selected offer for this booking. NULL means basic service was selected.';
COMMENT ON COLUMN public.bookings.adult_count IS 'Number of adult tickets in this booking';
COMMENT ON COLUMN public.bookings.child_count IS 'Number of child tickets in this booking';
COMMENT ON COLUMN public.bookings.qr_scanned IS 'Whether the QR code has been scanned (invalidates QR)';
COMMENT ON COLUMN public.bookings.qr_scanned_at IS 'Timestamp when QR code was scanned';
COMMENT ON COLUMN public.bookings.qr_scanned_by_user_id IS 'User ID who scanned the QR code (cashier/receptionist)';
COMMENT ON COLUMN public.bookings.package_id IS 'Package ID if this booking is part of a service package (nullable)';
COMMENT ON COLUMN public.bookings.language IS 'Customer preferred language for ticket generation and communications. Values: en (English) or ar (Arabic).';

-- customers
CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    phone text NOT NULL,
    name text NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_booking_at timestamp with time zone,
    total_bookings integer DEFAULT 0
);
ALTER TABLE public.customers OWNER TO postgres;
ALTER TABLE ONLY public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.customers ADD CONSTRAINT customers_tenant_id_phone_key UNIQUE (tenant_id, phone);

-- employee_services
CREATE TABLE public.employee_services (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    service_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    shift_id uuid,
    duration_minutes integer,
    capacity_per_slot integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.employee_services OWNER TO postgres;
ALTER TABLE ONLY public.employee_services ADD CONSTRAINT employee_services_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_services ADD CONSTRAINT employee_services_employee_id_service_id_shift_id_key UNIQUE (employee_id, service_id, shift_id);

-- otp_requests
CREATE TABLE public.otp_requests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    phone text,
    otp_code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text DEFAULT 'password_reset'::text,
    email text
);
ALTER TABLE public.otp_requests OWNER TO postgres;
ALTER TABLE ONLY public.otp_requests ADD CONSTRAINT otp_requests_pkey PRIMARY KEY (id);
COMMENT ON COLUMN public.otp_requests.purpose IS 'Purpose of OTP: password_reset, login, etc.';

-- package_services
CREATE TABLE public.package_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_id uuid NOT NULL,
    service_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT package_services_quantity_check CHECK ((quantity > 0))
);
ALTER TABLE public.package_services OWNER TO postgres;
ALTER TABLE ONLY public.package_services ADD CONSTRAINT package_services_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.package_services ADD CONSTRAINT package_services_package_id_service_id_key UNIQUE (package_id, service_id);

-- package_subscription_usage
CREATE TABLE public.package_subscription_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    service_id uuid NOT NULL,
    original_quantity integer NOT NULL,
    remaining_quantity integer NOT NULL,
    used_quantity integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT package_subscription_usage_check CHECK ((original_quantity = (remaining_quantity + used_quantity))),
    CONSTRAINT package_subscription_usage_original_quantity_check CHECK ((original_quantity > 0)),
    CONSTRAINT package_subscription_usage_remaining_quantity_check CHECK ((remaining_quantity >= 0)),
    CONSTRAINT package_subscription_usage_used_quantity_check CHECK ((used_quantity >= 0))
);
ALTER TABLE public.package_subscription_usage OWNER TO postgres;
ALTER TABLE ONLY public.package_subscription_usage ADD CONSTRAINT package_subscription_usage_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.package_subscription_usage ADD CONSTRAINT package_subscription_usage_subscription_id_service_id_key UNIQUE (subscription_id, service_id);

-- package_subscriptions
CREATE TABLE public.package_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    package_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT package_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text])))
);
ALTER TABLE public.package_subscriptions OWNER TO postgres;
ALTER TABLE ONLY public.package_subscriptions ADD CONSTRAINT package_subscriptions_pkey PRIMARY KEY (id);

-- payments
CREATE TABLE public.payments (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    provider text,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'SAR'::text,
    status text,
    gateway_txn_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.payments OWNER TO postgres;
ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

-- queue_jobs
CREATE TABLE public.queue_jobs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'pending'::text,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);
ALTER TABLE public.queue_jobs OWNER TO postgres;
ALTER TABLE ONLY public.queue_jobs ADD CONSTRAINT queue_jobs_pkey PRIMARY KEY (id);

-- reviews
CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL,
    booking_id uuid,
    customer_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    comment_ar text,
    is_approved boolean DEFAULT false NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);
ALTER TABLE public.reviews OWNER TO postgres;
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_booking_id_key UNIQUE (booking_id);

-- service_categories
CREATE TABLE public.service_categories (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    name_ar text DEFAULT ''::text NOT NULL,
    description text,
    description_ar text,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.service_categories OWNER TO postgres;
ALTER TABLE ONLY public.service_categories ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);

-- service_offers
CREATE TABLE public.service_offers (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    service_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    name_ar text,
    description text,
    description_ar text,
    price numeric(10,2) NOT NULL,
    original_price numeric(10,2),
    discount_percentage integer,
    duration_minutes integer,
    perks jsonb DEFAULT '[]'::jsonb,
    perks_ar jsonb DEFAULT '[]'::jsonb,
    badge text,
    badge_ar text,
    display_order integer DEFAULT 0,
    is_active boolean DEFAULT true NOT NULL,
    closing_time time without time zone,
    meeting_point text,
    meeting_point_ar text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_offers_price_check CHECK ((price >= (0)::numeric))
);
ALTER TABLE public.service_offers OWNER TO postgres;
ALTER TABLE ONLY public.service_offers ADD CONSTRAINT service_offers_pkey PRIMARY KEY (id);
COMMENT ON TABLE public.service_offers IS 'Offers/variants for services (e.g., Basic, Fast Track, VIP)';
COMMENT ON COLUMN public.service_offers.perks IS 'Array of perks/features for this offer (e.g., ["Fast-track entry", "Access to telescopes"])';
COMMENT ON COLUMN public.service_offers.badge IS 'Badge text to display (e.g., "Most Popular", "Best Value")';
COMMENT ON COLUMN public.service_offers.closing_time IS 'Closing time for this offer (e.g., "11:30pm")';

-- service_packages
CREATE TABLE public.service_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    name_ar text NOT NULL,
    description text,
    description_ar text,
    total_price numeric(10,2) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    original_price numeric(10,2),
    discount_percentage integer,
    image_url text,
    gallery_urls jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT service_packages_discount_percentage_check CHECK (((discount_percentage >= 0) AND (discount_percentage <= 100))),
    CONSTRAINT service_packages_original_price_check CHECK ((original_price >= (0)::numeric)),
    CONSTRAINT service_packages_total_price_check CHECK ((total_price >= (0)::numeric))
);
ALTER TABLE public.service_packages OWNER TO postgres;
ALTER TABLE ONLY public.service_packages ADD CONSTRAINT service_packages_pkey PRIMARY KEY (id);
COMMENT ON COLUMN public.service_packages.original_price IS 'Original combined price of all services in the package before discount';
COMMENT ON COLUMN public.service_packages.discount_percentage IS 'Discount percentage (0-100) applied to the package';
COMMENT ON COLUMN public.service_packages.image_url IS 'Main/featured image URL (base64 or URL)';
COMMENT ON COLUMN public.service_packages.gallery_urls IS 'Array of image URLs (JSONB array)';

-- services
CREATE TABLE public.services (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    category_id uuid,
    name text NOT NULL,
    name_ar text DEFAULT ''::text NOT NULL,
    description text,
    description_ar text,
    duration_minutes integer NOT NULL,
    base_price numeric(10,2) NOT NULL,
    capacity_per_slot integer DEFAULT 1 NOT NULL,
    capacity_mode public.capacity_mode DEFAULT 'employee_based'::public.capacity_mode NOT NULL,
    service_duration_minutes integer NOT NULL,
    service_capacity_per_slot integer,
    is_public boolean DEFAULT false NOT NULL,
    assigned_employee_id uuid,
    image_url text,
    gallery_urls jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    average_rating numeric(3,2) DEFAULT 0,
    total_reviews integer DEFAULT 0,
    original_price numeric(10,2),
    discount_percentage integer,
    child_price numeric(10,2),
    CONSTRAINT check_service_based_capacity CHECK ((((capacity_mode = 'service_based'::public.capacity_mode) AND (service_capacity_per_slot IS NOT NULL) AND (service_capacity_per_slot > 0)) OR ((capacity_mode = 'employee_based'::public.capacity_mode) AND (service_capacity_per_slot IS NULL)))),
    CONSTRAINT services_average_rating_check CHECK (((average_rating >= (0)::numeric) AND (average_rating <= (5)::numeric))),
    CONSTRAINT services_base_price_check CHECK ((base_price >= (0)::numeric)),
    CONSTRAINT services_capacity_per_slot_check CHECK ((capacity_per_slot > 0)),
    CONSTRAINT services_duration_minutes_check CHECK ((duration_minutes > 0)),
    CONSTRAINT services_service_duration_minutes_check CHECK ((service_duration_minutes > 0))
);
ALTER TABLE public.services OWNER TO postgres;
ALTER TABLE ONLY public.services ADD CONSTRAINT services_pkey PRIMARY KEY (id);
COMMENT ON COLUMN public.services.original_price IS 'Original price before discount';
COMMENT ON COLUMN public.services.discount_percentage IS 'Discount percentage (0-100)';

-- shifts
CREATE TABLE public.shifts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL,
    days_of_week integer[] NOT NULL,
    start_time_utc time without time zone NOT NULL,
    end_time_utc time without time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shifts_days_of_week_check CHECK ((array_length(days_of_week, 1) > 0))
);
ALTER TABLE public.shifts OWNER TO postgres;
ALTER TABLE ONLY public.shifts ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);

-- slots
CREATE TABLE public.slots (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    shift_id uuid NOT NULL,
    employee_id uuid,
    slot_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    start_time_utc timestamp with time zone NOT NULL,
    end_time_utc timestamp with time zone NOT NULL,
    available_capacity integer NOT NULL,
    booked_count integer DEFAULT 0 NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    is_overbooked boolean DEFAULT false NOT NULL,
    original_capacity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slots_available_capacity_check CHECK ((available_capacity >= 0)),
    CONSTRAINT slots_booked_count_check CHECK ((booked_count >= 0)),
    CONSTRAINT slots_original_capacity_check CHECK ((original_capacity > 0))
);
ALTER TABLE public.slots OWNER TO postgres;
ALTER TABLE ONLY public.slots ADD CONSTRAINT slots_pkey PRIMARY KEY (id);

-- sms_logs
CREATE TABLE public.sms_logs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid,
    phone text NOT NULL,
    message text NOT NULL,
    status text,
    provider_response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.sms_logs OWNER TO postgres;
ALTER TABLE ONLY public.sms_logs ADD CONSTRAINT sms_logs_pkey PRIMARY KEY (id);

-- tenant_features
CREATE TABLE public.tenant_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    employees_enabled boolean DEFAULT true NOT NULL,
    employee_assignment_mode text DEFAULT 'both'::text NOT NULL,
    packages_enabled boolean DEFAULT true NOT NULL,
    landing_page_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_features_employee_assignment_mode_check CHECK ((employee_assignment_mode = ANY (ARRAY['automatic'::text, 'manual'::text, 'both'::text])))
);
ALTER TABLE public.tenant_features OWNER TO postgres;
ALTER TABLE ONLY public.tenant_features ADD CONSTRAINT tenant_features_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_features ADD CONSTRAINT tenant_features_tenant_id_key UNIQUE (tenant_id);

-- tenant_zoho_configs
CREATE TABLE public.tenant_zoho_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    client_id character varying(255) NOT NULL,
    client_secret character varying(255) NOT NULL,
    redirect_uri character varying(500) DEFAULT 'http://localhost:3001/api/zoho/callback'::character varying,
    scopes text[] DEFAULT ARRAY['ZohoInvoice.invoices.CREATE'::text, 'ZohoInvoice.invoices.READ'::text, 'ZohoInvoice.contacts.CREATE'::text, 'ZohoInvoice.contacts.READ'::text],
    region character varying(50) DEFAULT 'com'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.tenant_zoho_configs OWNER TO postgres;
ALTER TABLE ONLY public.tenant_zoho_configs ADD CONSTRAINT tenant_zoho_configs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenant_zoho_configs ADD CONSTRAINT tenant_zoho_configs_tenant_id_key UNIQUE (tenant_id);
COMMENT ON TABLE public.tenant_zoho_configs IS 'Stores Zoho OAuth credentials per tenant for multi-tenant SaaS architecture';
COMMENT ON COLUMN public.tenant_zoho_configs.client_secret IS 'Should be encrypted at application level before storage';
COMMENT ON COLUMN public.tenant_zoho_configs.region IS 'Zoho region: com, eu, in, au, jp, etc.';

-- tenants
CREATE TABLE public.tenants (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    name_ar text DEFAULT ''::text NOT NULL,
    slug text NOT NULL,
    industry text NOT NULL,
    contact_email text,
    contact_phone text,
    address text,
    tenant_time_zone text DEFAULT 'Asia/Riyadh'::text NOT NULL,
    announced_time_zone text DEFAULT 'Asia/Riyadh'::text NOT NULL,
    subscription_start timestamp with time zone DEFAULT now(),
    subscription_end timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    public_page_enabled boolean DEFAULT true NOT NULL,
    maintenance_mode boolean DEFAULT false NOT NULL,
    maintenance_message text,
    theme_preset text DEFAULT 'blue-gold'::text,
    logo_url text,
    custom_theme_config jsonb,
    landing_page_settings jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    smtp_settings jsonb,
    whatsapp_settings jsonb
);
ALTER TABLE public.tenants OWNER TO postgres;
ALTER TABLE ONLY public.tenants ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenants ADD CONSTRAINT tenants_slug_key UNIQUE (slug);
COMMENT ON COLUMN public.tenants.smtp_settings IS 'SMTP configuration for email sending: {smtp_host, smtp_port, smtp_user, smtp_password}';
COMMENT ON COLUMN public.tenants.whatsapp_settings IS 'WhatsApp Business API configuration for sending OTP messages: {provider, api_url, api_key, phone_number_id, access_token, account_sid, auth_token, from}';

-- time_slots
CREATE TABLE public.time_slots (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL,
    shift_id uuid NOT NULL,
    start_time_utc timestamp with time zone NOT NULL,
    end_time_utc timestamp with time zone NOT NULL,
    total_capacity integer NOT NULL,
    remaining_capacity integer NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT time_slots_check CHECK ((remaining_capacity <= total_capacity)),
    CONSTRAINT time_slots_remaining_capacity_check CHECK ((remaining_capacity >= 0)),
    CONSTRAINT time_slots_total_capacity_check CHECK ((total_capacity > 0))
);
ALTER TABLE public.time_slots OWNER TO postgres;
ALTER TABLE ONLY public.time_slots ADD CONSTRAINT time_slots_pkey PRIMARY KEY (id);

-- users
CREATE TABLE public.users (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid,
    email text,
    username text,
    phone text,
    full_name text NOT NULL,
    full_name_ar text DEFAULT ''::text,
    role public.user_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    capacity_per_slot integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    password_hash text,
    CONSTRAINT users_capacity_per_slot_check CHECK ((capacity_per_slot > 0))
);
ALTER TABLE public.users OWNER TO postgres;
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_username_key UNIQUE (username);

-- zoho_invoice_logs
CREATE TABLE public.zoho_invoice_logs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    booking_id uuid,
    tenant_id uuid,
    zoho_invoice_id text,
    status text NOT NULL,
    error_message text,
    request_payload jsonb,
    response_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT zoho_invoice_logs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'pending'::text])))
);
ALTER TABLE public.zoho_invoice_logs OWNER TO postgres;
ALTER TABLE ONLY public.zoho_invoice_logs ADD CONSTRAINT zoho_invoice_logs_pkey PRIMARY KEY (id);

-- zoho_tokens
CREATE TABLE public.zoho_tokens (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id uuid,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.zoho_tokens OWNER TO postgres;
ALTER TABLE ONLY public.zoho_tokens ADD CONSTRAINT zoho_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.zoho_tokens ADD CONSTRAINT zoho_tokens_tenant_id_key UNIQUE (tenant_id);

-- ============================================
-- STEP 10: CREATE INDEXES
-- ============================================

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);
CREATE INDEX idx_audit_logs_resource_type_id ON public.audit_logs USING btree (resource_type, resource_id);
CREATE INDEX idx_audit_logs_tenant_id ON public.audit_logs USING btree (tenant_id);
CREATE INDEX idx_booking_locks_expires_at ON public.booking_locks USING btree (lock_expires_at);
CREATE INDEX idx_booking_locks_session_id ON public.booking_locks USING btree (reserved_by_session_id);
CREATE INDEX idx_booking_locks_slot_expires ON public.booking_locks USING btree (slot_id, lock_expires_at);
CREATE INDEX idx_booking_locks_slot_id ON public.booking_locks USING btree (slot_id);
CREATE INDEX idx_bookings_created_at ON public.bookings USING btree (created_at DESC);
CREATE INDEX idx_bookings_customer_id ON public.bookings USING btree (customer_id);
CREATE INDEX idx_bookings_customer_phone ON public.bookings USING btree (customer_phone);
CREATE INDEX idx_bookings_group_id ON public.bookings USING btree (booking_group_id);
CREATE INDEX idx_bookings_language ON public.bookings USING btree (language);
CREATE INDEX idx_bookings_offer_id ON public.bookings USING btree (offer_id);
CREATE INDEX idx_bookings_package_id ON public.bookings USING btree (package_id) WHERE (package_id IS NOT NULL);
CREATE INDEX idx_bookings_package_subscription ON public.bookings USING btree (package_subscription_id);
CREATE INDEX idx_bookings_service_id ON public.bookings USING btree (service_id);
CREATE INDEX idx_bookings_slot_id ON public.bookings USING btree (slot_id);
CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);
CREATE INDEX idx_bookings_tenant_id ON public.bookings USING btree (tenant_id);
CREATE INDEX idx_bookings_zoho_invoice_id ON public.bookings USING btree (zoho_invoice_id) WHERE (zoho_invoice_id IS NOT NULL);
CREATE INDEX idx_customers_tenant_id ON public.customers USING btree (tenant_id);
CREATE INDEX idx_customers_tenant_phone ON public.customers USING btree (tenant_id, phone);
CREATE INDEX idx_employee_services_employee_id ON public.employee_services USING btree (employee_id);
CREATE INDEX idx_employee_services_service_id ON public.employee_services USING btree (service_id);
CREATE INDEX idx_employee_services_shift_id ON public.employee_services USING btree (shift_id);
CREATE INDEX idx_employee_services_tenant_id ON public.employee_services USING btree (tenant_id);
CREATE INDEX idx_otp_requests_email ON public.otp_requests USING btree (email) WHERE (email IS NOT NULL);
CREATE INDEX idx_otp_requests_email_purpose ON public.otp_requests USING btree (email, purpose, verified, expires_at) WHERE (email IS NOT NULL);
CREATE INDEX idx_otp_requests_phone_purpose ON public.otp_requests USING btree (phone, purpose, verified, expires_at) WHERE (phone IS NOT NULL);
CREATE INDEX idx_otp_requests_purpose ON public.otp_requests USING btree (purpose) WHERE (purpose IS NOT NULL);
CREATE INDEX idx_package_services_package_id ON public.package_services USING btree (package_id);
CREATE INDEX idx_package_services_service_id ON public.package_services USING btree (service_id);
CREATE INDEX idx_package_subscriptions_customer ON public.package_subscriptions USING btree (customer_id, status);
CREATE INDEX idx_package_subscriptions_package ON public.package_subscriptions USING btree (package_id);
CREATE INDEX idx_package_subscriptions_tenant ON public.package_subscriptions USING btree (tenant_id);
CREATE INDEX idx_package_usage_service ON public.package_subscription_usage USING btree (service_id);
CREATE INDEX idx_package_usage_subscription ON public.package_subscription_usage USING btree (subscription_id);
CREATE INDEX idx_reviews_approved ON public.reviews USING btree (is_approved, is_visible);
CREATE INDEX idx_reviews_customer_id ON public.reviews USING btree (customer_id);
CREATE INDEX idx_reviews_service_id ON public.reviews USING btree (service_id);
CREATE INDEX idx_reviews_tenant_id ON public.reviews USING btree (tenant_id);
CREATE INDEX idx_service_categories_tenant_id ON public.service_categories USING btree (tenant_id);
CREATE INDEX idx_service_offers_is_active ON public.service_offers USING btree (is_active);
CREATE INDEX idx_service_offers_service_id ON public.service_offers USING btree (service_id);
CREATE INDEX idx_service_offers_tenant_id ON public.service_offers USING btree (tenant_id);
CREATE INDEX idx_service_packages_active ON public.service_packages USING btree (tenant_id, is_active);
CREATE INDEX idx_service_packages_tenant_id ON public.service_packages USING btree (tenant_id);
CREATE INDEX idx_services_capacity_mode ON public.services USING btree (capacity_mode);
CREATE INDEX idx_services_category_id ON public.services USING btree (category_id);
CREATE INDEX idx_services_is_public ON public.services USING btree (is_public) WHERE (is_public = true);
CREATE INDEX idx_services_tenant_id ON public.services USING btree (tenant_id);
CREATE INDEX idx_shifts_service_id ON public.shifts USING btree (service_id);
CREATE INDEX idx_shifts_tenant_id ON public.shifts USING btree (tenant_id);
CREATE INDEX idx_slots_date ON public.slots USING btree (slot_date);
CREATE INDEX idx_slots_employee_id ON public.slots USING btree (employee_id);
CREATE INDEX idx_slots_overbooked ON public.slots USING btree (is_overbooked) WHERE (is_overbooked = true);
CREATE INDEX idx_slots_shift_id ON public.slots USING btree (shift_id);
CREATE INDEX idx_slots_tenant_id ON public.slots USING btree (tenant_id);
CREATE INDEX idx_tenant_zoho_configs_active ON public.tenant_zoho_configs USING btree (tenant_id, is_active);
CREATE INDEX idx_tenant_zoho_configs_tenant_id ON public.tenant_zoho_configs USING btree (tenant_id);
CREATE INDEX idx_tenants_slug ON public.tenants USING btree (slug);
CREATE INDEX idx_time_slots_available ON public.time_slots USING btree (is_available) WHERE (is_available = true);
CREATE INDEX idx_time_slots_service_id ON public.time_slots USING btree (service_id);
CREATE INDEX idx_time_slots_start_time ON public.time_slots USING btree (start_time_utc);
CREATE INDEX idx_time_slots_tenant_id ON public.time_slots USING btree (tenant_id);
CREATE INDEX idx_users_capacity ON public.users USING btree (capacity_per_slot);
CREATE INDEX idx_users_password_hash ON public.users USING btree (password_hash) WHERE (password_hash IS NOT NULL);
CREATE INDEX idx_users_role ON public.users USING btree (role);
CREATE INDEX idx_users_tenant_id ON public.users USING btree (tenant_id);
CREATE INDEX idx_users_username ON public.users USING btree (username);
CREATE INDEX idx_zoho_invoice_logs_booking_id ON public.zoho_invoice_logs USING btree (booking_id);
CREATE INDEX idx_zoho_invoice_logs_created_at ON public.zoho_invoice_logs USING btree (created_at);
CREATE INDEX idx_zoho_invoice_logs_status ON public.zoho_invoice_logs USING btree (status);
CREATE INDEX idx_zoho_invoice_logs_tenant_id ON public.zoho_invoice_logs USING btree (tenant_id);
CREATE INDEX idx_zoho_tokens_expires_at ON public.zoho_tokens USING btree (expires_at);
CREATE INDEX idx_zoho_tokens_tenant_id ON public.zoho_tokens USING btree (tenant_id);

-- ============================================
-- STEP 11: CREATE FOREIGN KEY CONSTRAINTS
-- ============================================

ALTER TABLE ONLY public.audit_logs ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.booking_locks ADD CONSTRAINT booking_locks_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.slots(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_checked_in_by_user_id_fkey FOREIGN KEY (checked_in_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.service_offers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.service_packages(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_qr_scanned_by_user_id_fkey FOREIGN KEY (qr_scanned_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.slots(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.bookings ADD CONSTRAINT bookings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customers ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_services ADD CONSTRAINT employee_services_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_services ADD CONSTRAINT employee_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_services ADD CONSTRAINT employee_services_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_services ADD CONSTRAINT employee_services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_services ADD CONSTRAINT package_services_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.service_packages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_services ADD CONSTRAINT package_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_subscription_usage ADD CONSTRAINT package_subscription_usage_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_subscription_usage ADD CONSTRAINT package_subscription_usage_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.package_subscriptions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_subscriptions ADD CONSTRAINT package_subscriptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_subscriptions ADD CONSTRAINT package_subscriptions_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.service_packages(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.package_subscriptions ADD CONSTRAINT package_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.service_categories ADD CONSTRAINT service_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.service_offers ADD CONSTRAINT service_offers_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.service_offers ADD CONSTRAINT service_offers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.service_packages ADD CONSTRAINT service_packages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.services ADD CONSTRAINT services_assigned_employee_id_fkey FOREIGN KEY (assigned_employee_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.services ADD CONSTRAINT services_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.service_categories(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.services ADD CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.shifts ADD CONSTRAINT shifts_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.shifts ADD CONSTRAINT shifts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.slots ADD CONSTRAINT slots_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.slots ADD CONSTRAINT slots_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.slots ADD CONSTRAINT slots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sms_logs ADD CONSTRAINT sms_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_features ADD CONSTRAINT tenant_features_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tenant_zoho_configs ADD CONSTRAINT tenant_zoho_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_slots ADD CONSTRAINT time_slots_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_slots ADD CONSTRAINT time_slots_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_slots ADD CONSTRAINT time_slots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.zoho_invoice_logs ADD CONSTRAINT zoho_invoice_logs_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.zoho_invoice_logs ADD CONSTRAINT zoho_invoice_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.zoho_tokens ADD CONSTRAINT zoho_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- ============================================
-- STEP 12: CREATE TRIGGERS
-- ============================================

CREATE TRIGGER create_tenant_features_trigger AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.create_tenant_features_for_new_tenant();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_customer_updated_at();
CREATE TRIGGER decrement_package_usage_on_booking AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.decrement_package_usage_on_booking();
CREATE TRIGGER initialize_subscription_usage AFTER INSERT ON public.package_subscriptions FOR EACH ROW EXECUTE FUNCTION public.initialize_package_usage();
CREATE TRIGGER package_usage_updated_at BEFORE UPDATE ON public.package_subscription_usage FOR EACH ROW EXECUTE FUNCTION public.update_package_usage_updated_at();
CREATE TRIGGER service_packages_updated_at BEFORE UPDATE ON public.service_packages FOR EACH ROW EXECUTE FUNCTION public.update_service_packages_updated_at();
CREATE TRIGGER set_tenant_slug BEFORE INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.generate_tenant_slug();
CREATE TRIGGER tenant_zoho_configs_updated_at BEFORE UPDATE ON public.tenant_zoho_configs FOR EACH ROW EXECUTE FUNCTION public.update_tenant_zoho_configs_updated_at();
CREATE TRIGGER trigger_check_slot_overbooked BEFORE UPDATE OF available_capacity ON public.slots FOR EACH ROW EXECUTE FUNCTION public.check_slot_overbooked();
CREATE TRIGGER trigger_manage_slot_capacity_on_update AFTER UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.restore_slot_capacity_on_booking();
CREATE TRIGGER trigger_reduce_slot_capacity_on_insert AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.reduce_slot_capacity_on_booking();
CREATE TRIGGER trigger_restore_package_usage_on_cancellation AFTER UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.restore_package_usage_on_cancellation();
CREATE TRIGGER trigger_update_service_offers_updated_at BEFORE UPDATE ON public.service_offers FOR EACH ROW EXECUTE FUNCTION public.update_service_offers_updated_at();
CREATE TRIGGER trigger_update_slots_on_service_capacity_change AFTER UPDATE OF service_capacity_per_slot, capacity_mode ON public.services FOR EACH ROW WHEN (((new.capacity_mode = 'service_based'::public.capacity_mode) AND (new.service_capacity_per_slot IS NOT NULL))) EXECUTE FUNCTION public.update_slots_on_service_capacity_change();
CREATE TRIGGER update_tenant_features_updated_at_trigger BEFORE UPDATE ON public.tenant_features FOR EACH ROW EXECUTE FUNCTION public.update_tenant_features_updated_at();
CREATE TRIGGER zoho_receipt_trigger AFTER UPDATE OF payment_status ON public.bookings FOR EACH ROW WHEN (((new.payment_status = 'paid'::public.payment_status) AND ((old.payment_status IS NULL) OR (old.payment_status <> 'paid'::public.payment_status)))) EXECUTE FUNCTION public.trigger_zoho_receipt_on_payment();
CREATE TRIGGER zoho_receipt_trigger_insert AFTER INSERT ON public.bookings FOR EACH ROW WHEN ((new.payment_status = 'paid'::public.payment_status)) EXECUTE FUNCTION public.trigger_zoho_receipt_on_insert();
CREATE TRIGGER zoho_tokens_updated_at BEFORE UPDATE ON public.zoho_tokens FOR EACH ROW EXECUTE FUNCTION public.update_zoho_tokens_updated_at();

-- ============================================
-- STEP 13: ENABLE ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_subscription_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 14: CREATE RLS POLICIES
-- ============================================

CREATE POLICY "Anonymous can insert tenants" ON public.tenants FOR INSERT WITH CHECK (true);
CREATE POLICY "Anonymous can insert user profiles" ON public.users FOR INSERT WITH CHECK (true);
CREATE POLICY "Anonymous can update tenants" ON public.tenants FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anonymous can view all tenants" ON public.tenants FOR SELECT USING (true);
CREATE POLICY "Anyone can create booking locks" ON public.booking_locks FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view booking locks" ON public.booking_locks FOR SELECT USING (true);
CREATE POLICY "Public can create bookings" ON public.bookings FOR INSERT WITH CHECK ((EXISTS ( SELECT 1 FROM public.tenants WHERE ((tenants.id = bookings.tenant_id) AND (tenants.is_active = true) AND (tenants.maintenance_mode = false)))));
CREATE POLICY "Public can view active tenants" ON public.tenants FOR SELECT USING (((is_active = true) AND (public_page_enabled = true)));
CREATE POLICY "Public can view available slots" ON public.slots FOR SELECT USING (((is_available = true) AND (EXISTS ( SELECT 1 FROM public.services WHERE ((services.id IN ( SELECT shifts.service_id FROM public.shifts WHERE (shifts.id = slots.shift_id))) AND (services.is_public = true) AND (services.is_active = true))))));
CREATE POLICY "Tenant users can view all tenant slots" ON public.slots FOR SELECT USING (true);
CREATE POLICY "Users can create own profile after signup" ON public.users FOR INSERT WITH CHECK (true);
CREATE POLICY users_select_own ON public.users FOR SELECT USING (true);

-- ============================================
-- STEP 15: GRANT PERMISSIONS
-- ============================================

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT SELECT ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.booking_locks TO authenticated;
GRANT SELECT ON TABLE public.booking_locks TO anon;
GRANT ALL ON TABLE public.bookings TO authenticated;
GRANT SELECT ON TABLE public.bookings TO anon;
GRANT ALL ON TABLE public.customers TO authenticated;
GRANT SELECT ON TABLE public.customers TO anon;
GRANT ALL ON TABLE public.employee_services TO authenticated;
GRANT SELECT ON TABLE public.employee_services TO anon;
GRANT ALL ON TABLE public.otp_requests TO authenticated;
GRANT SELECT ON TABLE public.otp_requests TO anon;
GRANT ALL ON TABLE public.package_services TO authenticated;
GRANT SELECT ON TABLE public.package_services TO anon;
GRANT ALL ON TABLE public.package_subscription_usage TO authenticated;
GRANT SELECT ON TABLE public.package_subscription_usage TO anon;
GRANT ALL ON TABLE public.package_subscriptions TO authenticated;
GRANT SELECT ON TABLE public.package_subscriptions TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT SELECT ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.queue_jobs TO authenticated;
GRANT SELECT ON TABLE public.queue_jobs TO anon;
GRANT ALL ON TABLE public.service_categories TO authenticated;
GRANT SELECT ON TABLE public.service_categories TO anon;
GRANT ALL ON TABLE public.service_packages TO authenticated;
GRANT SELECT ON TABLE public.service_packages TO anon;
GRANT ALL ON TABLE public.services TO authenticated;
GRANT SELECT ON TABLE public.services TO anon;
GRANT ALL ON TABLE public.shifts TO authenticated;
GRANT SELECT ON TABLE public.shifts TO anon;
GRANT ALL ON TABLE public.slots TO authenticated;
GRANT SELECT ON TABLE public.slots TO anon;
GRANT ALL ON TABLE public.sms_logs TO authenticated;
GRANT SELECT ON TABLE public.sms_logs TO anon;
GRANT ALL ON TABLE public.tenant_features TO authenticated;
GRANT SELECT ON TABLE public.tenant_features TO anon;
GRANT ALL ON TABLE public.tenants TO authenticated;
GRANT SELECT ON TABLE public.tenants TO anon;
GRANT ALL ON TABLE public.time_slots TO authenticated;
GRANT SELECT ON TABLE public.time_slots TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT SELECT ON TABLE public.users TO anon;

COMMIT;

-- ============================================
-- COMPLETE!
-- ============================================
-- The database schema has been successfully replaced.
-- All tables, functions, triggers, indexes, and policies
-- have been recreated according to the new schema.
-- ============================================
