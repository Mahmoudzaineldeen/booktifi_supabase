-- PostgreSQL database dump
--

\restrict 4FYzsa4S48TG9G3olygZOlY1yTogLjjybtTSQZNjbdFyjGe1NgpMs3HKH00FCKe

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA IF NOT EXISTS auth;


ALTER SCHEMA auth OWNER TO postgres;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: postgres
--

DROP TYPE IF EXISTS public.booking_status CASCADE;
CREATE TYPE public.booking_status AS ENUM (
    'pending',
    'confirmed',
    'checked_in',
    'completed',
    'cancelled'
);


ALTER TYPE public.booking_status OWNER TO postgres;

--
-- Name: capacity_mode; Type: TYPE; Schema: public; Owner: postgres
--

DROP TYPE IF EXISTS public.capacity_mode CASCADE;
CREATE TYPE public.capacity_mode AS ENUM (
    'employee_based',
    'service_based'
);


ALTER TYPE public.capacity_mode OWNER TO postgres;

--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: postgres
--

DROP TYPE IF EXISTS public.payment_status CASCADE;
CREATE TYPE public.payment_status AS ENUM (
    'unpaid',
    'paid_manual',
    'awaiting_payment',
    'paid',
    'refunded'
);


ALTER TYPE public.payment_status OWNER TO postgres;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: postgres
--

DROP TYPE IF EXISTS public.user_role CASCADE;
CREATE TYPE public.user_role AS ENUM (
    'solution_owner',
    'tenant_admin',
    'receptionist',
    'cashier',
    'employee',
    'customer'
);


ALTER TYPE public.user_role OWNER TO postgres;

--
-- Name: acquire_booking_lock(uuid, text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.acquire_booking_lock(p_slot_id uuid, p_session_id text, p_reserved_capacity integer, p_lock_duration_seconds integer DEFAULT 120) RETURNS uuid
    LANGUAGE plpgsql
    AS $$

DECLARE

  v_slot_record RECORD;

  v_locked_capacity integer;

  v_available_capacity integer;

  v_lock_id uuid;

BEGIN

  -- Lock the slot row to prevent concurrent modifications

  -- Use slots table (the table that booking_locks references via foreign key)

  SELECT 

    id,

    available_capacity,

    is_available,

    original_capacity

  INTO v_slot_record

  FROM slots

  WHERE id = p_slot_id

  FOR UPDATE;

  

  -- Check if slot exists

  IF NOT FOUND THEN

    RAISE EXCEPTION 'Slot not found';

  END IF;

  

  -- Check if slot is available

  IF NOT v_slot_record.is_available THEN

    RAISE EXCEPTION 'Slot is not available';

  END IF;

  

  -- Calculate currently locked capacity (from active locks)

  SELECT COALESCE(SUM(reserved_capacity), 0)

  INTO v_locked_capacity

  FROM booking_locks

  WHERE slot_id = p_slot_id

    AND lock_expires_at > now();

  

  -- Calculate available capacity (available - locked)

  v_available_capacity := v_slot_record.available_capacity - v_locked_capacity;

  

  -- Check if there's enough capacity

  IF v_available_capacity < p_reserved_capacity THEN

    RAISE EXCEPTION 'Not enough tickets available. Only % available, but % requested.', 

      v_available_capacity, p_reserved_capacity;

  END IF;

  

  -- Create the lock

  INSERT INTO booking_locks (

    slot_id,

    reserved_by_session_id,

    reserved_capacity,

    lock_expires_at

  ) VALUES (

    p_slot_id,

    p_session_id,

    p_reserved_capacity,

    now() + (p_lock_duration_seconds || ' seconds')::interval

  )

  RETURNING id INTO v_lock_id;

  

  RETURN v_lock_id;

END;

$$;


ALTER FUNCTION public.acquire_booking_lock(p_slot_id uuid, p_session_id text, p_reserved_capacity integer, p_lock_duration_seconds integer) OWNER TO postgres;

--
-- Name: check_slot_overbooked(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.check_slot_overbooked() RETURNS trigger
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

--
-- Name: cleanup_expired_locks(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.cleanup_expired_locks() RETURNS integer
    LANGUAGE plpgsql
    AS $$

DECLARE

  v_deleted_count integer;

BEGIN

  DELETE FROM booking_locks

  WHERE lock_expires_at <= now();

  

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  

  RETURN v_deleted_count;

END;

$$;


ALTER FUNCTION public.cleanup_expired_locks() OWNER TO postgres;

--
-- Name: create_tenant_features_for_new_tenant(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.create_tenant_features_for_new_tenant() RETURNS trigger
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

--
-- Name: decrement_package_usage_on_booking(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.decrement_package_usage_on_booking() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  IF NEW.package_subscription_id IS NOT NULL AND NEW.status != 'cancelled' THEN

    UPDATE package_subscription_usage

    SET 

      remaining_quantity = remaining_quantity - 1,

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

--
-- Name: generate_slots_for_shift(uuid, date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.generate_slots_for_shift(p_shift_id uuid, p_start_date date, p_end_date date) RETURNS integer
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
  SELECT
    sh.tenant_id,
    sh.service_id,
    sh.start_time_utc,
    sh.end_time_utc,
    sh.days_of_week,
    srv.service_duration_minutes,
    COALESCE(srv.service_capacity_per_slot, 1) as service_capacity_per_slot,
    srv.capacity_mode
  INTO
    v_tenant_id,
    v_service_id,
    v_start_time_utc,
    v_end_time_utc,
    v_days_of_week,
    v_service_duration_minutes,
    v_service_capacity_per_slot,
    v_capacity_mode
  FROM shifts sh
  JOIN services srv ON sh.service_id = srv.id
  WHERE sh.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  -- Calculate shift duration
  v_shift_start_minutes := EXTRACT(HOUR FROM v_start_time_utc) * 60 +
                           EXTRACT(MINUTE FROM v_start_time_utc);
  v_shift_end_minutes := EXTRACT(HOUR FROM v_end_time_utc) * 60 +
                         EXTRACT(MINUTE FROM v_end_time_utc);
  v_shift_duration_minutes := v_shift_end_minutes - v_shift_start_minutes;

  -- Validate shift duration
  IF v_shift_duration_minutes < v_service_duration_minutes THEN
    RAISE EXCEPTION 'Shift duration (%) is shorter than service duration (%)', 
      v_shift_duration_minutes, v_service_duration_minutes;
  END IF;

  -- Delete existing slots for this shift in the date range
  DELETE FROM slots
  WHERE shift_id = p_shift_id
    AND slot_date >= p_start_date
    AND slot_date <= p_end_date;

  -- Check employee count
  SELECT COUNT(*) INTO v_employees_count
  FROM employee_services
  WHERE shift_id = p_shift_id;

  -- Determine capacity based on mode
  IF v_capacity_mode = 'service_based' THEN
    -- Service-based: use service capacity, no employees needed
    v_slot_capacity := v_service_capacity_per_slot;
    IF v_slot_capacity IS NULL OR v_slot_capacity = 0 THEN
      RAISE EXCEPTION 'Service capacity not configured for service-based mode';
    END IF;
  ELSE
    -- Employee-based: check if employees are assigned
    IF v_employees_count = 0 THEN
      RAISE EXCEPTION 'No employees assigned to this shift for employee-based service';
    END IF;
  END IF;

  v_current_date := p_start_date;
  WHILE v_current_date <= p_end_date LOOP
    IF EXTRACT(DOW FROM v_current_date)::integer = ANY(v_days_of_week) THEN

      IF v_capacity_mode = 'service_based' THEN
        -- Service-based: generate slots without employees
        v_slot_start_minutes := v_shift_start_minutes;

        WHILE v_slot_start_minutes + v_service_duration_minutes <= v_shift_end_minutes LOOP
          v_slot_end_minutes := v_slot_start_minutes + v_service_duration_minutes;

          v_start_time := make_time(
            v_slot_start_minutes / 60,
            v_slot_start_minutes % 60,
            0
          );
          v_end_time := make_time(
            v_slot_end_minutes / 60,
            v_slot_end_minutes % 60,
            0
          );

          v_start_timestamp := v_current_date + v_start_time;
          v_end_timestamp := v_current_date + v_end_time;

          INSERT INTO slots (
            tenant_id,
            shift_id,
            employee_id,
            slot_date,
            start_time,
            end_time,
            start_time_utc,
            end_time_utc,
            available_capacity,
            original_capacity,
            booked_count,
            is_available
          ) VALUES (
            v_tenant_id,
            p_shift_id,
            NULL,  -- No employee for service-based
            v_current_date,
            v_start_time,
            v_end_time,
            v_start_timestamp,
            v_end_timestamp,
            v_slot_capacity,
            v_slot_capacity,
            0,
            true
          );

          v_slots_generated := v_slots_generated + 1;
          v_slot_start_minutes := v_slot_start_minutes + v_service_duration_minutes;
        END LOOP;

      ELSE
        -- Employee-based: generate slots for each employee
        FOR v_employee_record IN
          (
            SELECT DISTINCT
              es.employee_id,
              COALESCE(es.duration_minutes, v_service_duration_minutes) as duration_minutes,
              COALESCE(es.capacity_per_slot, v_service_capacity_per_slot) as capacity_per_slot
            FROM employee_services es
            WHERE es.shift_id = p_shift_id

            UNION

            SELECT DISTINCT
              es.employee_id,
              COALESCE(es.duration_minutes, v_service_duration_minutes) as duration_minutes,
              COALESCE(es.capacity_per_slot, v_service_capacity_per_slot) as capacity_per_slot
            FROM employee_services es
            WHERE es.service_id = v_service_id
              AND es.shift_id IS NULL
              AND v_employees_count = 0

            UNION

            SELECT DISTINCT
              u.id as employee_id,
              v_service_duration_minutes as duration_minutes,
              v_service_capacity_per_slot as capacity_per_slot
            FROM users u
            WHERE u.tenant_id = v_tenant_id
              AND u.role = 'employee'
              AND u.is_active = true
              AND v_employees_count = 0
              AND NOT EXISTS (
                SELECT 1 FROM employee_services WHERE service_id = v_service_id
              )
          )
        LOOP

          v_employee_duration := v_employee_record.duration_minutes;
          v_employee_capacity := v_employee_record.capacity_per_slot;

          v_slot_start_minutes := v_shift_start_minutes;

          WHILE v_slot_start_minutes + v_employee_duration <= v_shift_end_minutes LOOP
            v_slot_end_minutes := v_slot_start_minutes + v_employee_duration;

            v_start_time := make_time(
              v_slot_start_minutes / 60,
              v_slot_start_minutes % 60,
              0
            );
            v_end_time := make_time(
              v_slot_end_minutes / 60,
              v_slot_end_minutes % 60,
              0
            );

            v_start_timestamp := v_current_date + v_start_time;
            v_end_timestamp := v_current_date + v_end_time;

            INSERT INTO slots (
              tenant_id,
              shift_id,
              employee_id,
              slot_date,
              start_time,
              end_time,
              start_time_utc,
              end_time_utc,
              available_capacity,
              original_capacity,
              booked_count,
              is_available
            ) VALUES (
              v_tenant_id,
              p_shift_id,
              v_employee_record.employee_id,
              v_current_date,
              v_start_time,
              v_end_time,
              v_start_timestamp,
              v_end_timestamp,
              v_employee_capacity,
              v_employee_capacity,
              0,
              true
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


ALTER FUNCTION public.generate_slots_for_shift(p_shift_id uuid, p_start_date date, p_end_date date) OWNER TO postgres;

--
-- Name: generate_tenant_slug(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.generate_tenant_slug() RETURNS trigger
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

--
-- Name: get_active_locks_for_slots(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.get_active_locks_for_slots(p_slot_ids uuid[]) RETURNS TABLE(slot_id uuid, total_locked_capacity integer)
    LANGUAGE plpgsql
    AS $$

BEGIN

  RETURN QUERY

  SELECT 

    bl.slot_id,

    COALESCE(SUM(bl.reserved_capacity), 0)::integer as total_locked_capacity

  FROM booking_locks bl

  WHERE bl.slot_id = ANY(p_slot_ids)

    AND bl.lock_expires_at > now()

  GROUP BY bl.slot_id;

END;

$$;


ALTER FUNCTION public.get_active_locks_for_slots(p_slot_ids uuid[]) OWNER TO postgres;

--
-- Name: get_current_user_info(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.get_current_user_info() RETURNS TABLE(user_role public.user_role, user_tenant_id uuid)
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

--
-- Name: initialize_package_usage(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.initialize_package_usage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

BEGIN

  INSERT INTO package_subscription_usage (subscription_id, service_id, original_quantity, remaining_quantity, used_quantity)

  SELECT 

    NEW.id,

    ps.service_id,

    ps.quantity,

    ps.quantity,

    0

  FROM package_services ps

  WHERE ps.package_id = NEW.package_id;

  

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.initialize_package_usage() OWNER TO postgres;

--
-- Name: reduce_slot_capacity_on_booking(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.reduce_slot_capacity_on_booking() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Only process for confirmed bookings
  IF NEW.status = 'confirmed' THEN
    -- Reduce the slot's available capacity and increment booked_count
    UPDATE slots
    SET 
      available_capacity = GREATEST(0, available_capacity - NEW.visitor_count),
      booked_count = booked_count + NEW.visitor_count
    WHERE id = NEW.slot_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.reduce_slot_capacity_on_booking() OWNER TO postgres;

--
-- Name: FUNCTION reduce_slot_capacity_on_booking(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.reduce_slot_capacity_on_booking() IS 'Reduces slot available_capacity when a booking is confirmed';


--
-- Name: restore_overlapping_slot_capacity(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.restore_overlapping_slot_capacity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

DECLARE

  v_booking_slot_date date;

  v_booking_start_time time;

  v_booking_end_time time;

  v_employee_id uuid;

BEGIN

  -- Only process when status changes from confirmed to cancelled/completed

  -- REMOVED 'no_show' as it's not a valid enum value

  IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'completed') THEN

    -- Get booking slot details

    SELECT 

      s.slot_date,

      s.start_time,

      s.end_time,

      b.employee_id

    INTO 

      v_booking_slot_date,

      v_booking_start_time,

      v_booking_end_time,

      v_employee_id

    FROM slots s

    JOIN bookings b ON b.slot_id = s.id

    WHERE b.id = NEW.id;



    -- Restore capacity for overlapping slots with same employee

    IF v_employee_id IS NOT NULL THEN

      UPDATE slots

      SET available_capacity = LEAST(original_capacity, available_capacity + OLD.visitor_count)

      WHERE id IN (

        SELECT s2.id

        FROM slots s2

        WHERE s2.employee_id = v_employee_id

          AND s2.slot_date = v_booking_slot_date

          AND (

            (s2.start_time < v_booking_end_time AND s2.end_time > v_booking_start_time)

          )

          AND s2.id != OLD.slot_id

      );

    END IF;

  END IF;



  RETURN NEW;

END;

$$;


ALTER FUNCTION public.restore_overlapping_slot_capacity() OWNER TO postgres;

--
-- Name: restore_package_usage_on_cancellation(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.restore_package_usage_on_cancellation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

BEGIN

  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND NEW.package_subscription_id IS NOT NULL THEN

    IF NEW.service_id IS NOT NULL THEN

      UPDATE package_subscription_usage

      SET 

        used_quantity = GREATEST(0, used_quantity - NEW.visitor_count),

        remaining_quantity = remaining_quantity + NEW.visitor_count,

        updated_at = now()

      WHERE 

        subscription_id = NEW.package_subscription_id

        AND service_id = NEW.service_id;

    END IF;

  END IF;

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.restore_package_usage_on_cancellation() OWNER TO postgres;

--
-- Name: restore_slot_capacity_on_booking(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.restore_slot_capacity_on_booking() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

BEGIN

  -- When booking is cancelled or completed, restore capacity

  -- REMOVED 'no_show' as it's not a valid enum value

  IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'completed') THEN

    UPDATE slots

    SET 

      available_capacity = LEAST(original_capacity, available_capacity + OLD.visitor_count),

      booked_count = GREATEST(0, booked_count - OLD.visitor_count)

    WHERE id = OLD.slot_id;

  END IF;



  -- When booking changes from pending to confirmed, reduce capacity

  IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN

    UPDATE slots

    SET 

      available_capacity = GREATEST(0, available_capacity - NEW.visitor_count),

      booked_count = booked_count + NEW.visitor_count

    WHERE id = NEW.slot_id;

  END IF;



  RETURN NEW;

END;

$$;


ALTER FUNCTION public.restore_slot_capacity_on_booking() OWNER TO postgres;

--
-- Name: FUNCTION restore_slot_capacity_on_booking(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.restore_slot_capacity_on_booking() IS 'Manages slot capacity when booking status changes between confirmed, cancelled, completed, or no_show';


--
-- Name: sync_all_slots_with_service_capacity(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.sync_all_slots_with_service_capacity() RETURNS TABLE(service_id uuid, service_name text, slots_updated integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

DECLARE

  v_service_record RECORD;

  v_updated_count integer;

BEGIN

  -- Loop through all service_based services

  FOR v_service_record IN

    SELECT 

      s.id,

      s.name,

      s.service_capacity_per_slot

    FROM services s

    WHERE s.capacity_mode = 'service_based'

      AND s.service_capacity_per_slot IS NOT NULL

  LOOP

    -- Update all future slots for this service

    UPDATE slots sl

    SET 

      original_capacity = v_service_record.service_capacity_per_slot,

      available_capacity = GREATEST(0, v_service_record.service_capacity_per_slot - sl.booked_count),

      is_overbooked = (sl.booked_count > v_service_record.service_capacity_per_slot)

    FROM shifts sh

    WHERE sh.service_id = v_service_record.id

      AND sl.shift_id = sh.id

      AND sl.slot_date >= CURRENT_DATE

      AND (sl.original_capacity != v_service_record.service_capacity_per_slot

           OR sl.available_capacity != GREATEST(0, v_service_record.service_capacity_per_slot - sl.booked_count));

    

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    

    -- Return result

    service_id := v_service_record.id;

    service_name := v_service_record.name;

    slots_updated := v_updated_count;

    RETURN NEXT;

  END LOOP;

  

  RETURN;

END;

$$;


ALTER FUNCTION public.sync_all_slots_with_service_capacity() OWNER TO postgres;

--
-- Name: FUNCTION sync_all_slots_with_service_capacity(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.sync_all_slots_with_service_capacity() IS 'Syncs all future slots with their service''s current capacity. Can be run manually to fix capacity mismatches.';


--
-- Name: trigger_zoho_receipt_on_insert(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.trigger_zoho_receipt_on_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.payment_status = 'paid' AND NEW.zoho_invoice_id IS NULL THEN
          INSERT INTO queue_jobs (job_type, payload, status)
          VALUES (
            'zoho_receipt',
            jsonb_build_object(
              'booking_id', NEW.id,
              'tenant_id', NEW.tenant_id,
              'attempt', 0
            ),
            'pending'
          );
        END IF;
        RETURN NEW;
      END;
      $$;


ALTER FUNCTION public.trigger_zoho_receipt_on_insert() OWNER TO postgres;

--
-- Name: trigger_zoho_receipt_on_payment(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.trigger_zoho_receipt_on_payment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
          IF NEW.zoho_invoice_id IS NULL THEN
            INSERT INTO queue_jobs (job_type, payload, status)
            VALUES (
              'zoho_receipt',
              jsonb_build_object(
                'booking_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'attempt', 0
              ),
              'pending'
            );
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;


ALTER FUNCTION public.trigger_zoho_receipt_on_payment() OWNER TO postgres;

--
-- Name: update_customer_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.update_customer_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.updated_at = now();

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.update_customer_updated_at() OWNER TO postgres;

--
-- Name: update_package_usage_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.update_package_usage_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.updated_at = now();

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.update_package_usage_updated_at() OWNER TO postgres;

--
-- Name: update_service_offers_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.update_service_offers_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.updated_at = now();

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.update_service_offers_updated_at() OWNER TO postgres;

--
-- Name: update_service_packages_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.update_service_packages_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.updated_at = now();

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.update_service_packages_updated_at() OWNER TO postgres;

--
-- Name: update_slots_on_service_capacity_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.update_slots_on_service_capacity_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$

DECLARE

  v_new_capacity integer;

  v_old_capacity integer;

  v_updated_count integer;

BEGIN

  -- Only process if service is service_based and has capacity set

  IF NEW.capacity_mode = 'service_based' 

     AND NEW.service_capacity_per_slot IS NOT NULL THEN

    

    v_new_capacity := NEW.service_capacity_per_slot;

    v_old_capacity := OLD.service_capacity_per_slot;

    

    -- Update all future slots for this service

    -- For each slot:

    -- 1. Update original_capacity to new service capacity

    -- 2. Recalculate available_capacity = new_capacity - booked_count

    -- 3. Mark as overbooked if booked_count > new_capacity

    

    UPDATE slots s

    SET 

      original_capacity = v_new_capacity,

      available_capacity = GREATEST(0, v_new_capacity - s.booked_count),

      is_overbooked = (s.booked_count > v_new_capacity)

    FROM shifts sh

    WHERE sh.service_id = NEW.id

      AND s.shift_id = sh.id

      AND s.slot_date >= CURRENT_DATE; -- Only update future slots

    

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    

    -- Log the update

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

--
-- Name: FUNCTION update_slots_on_service_capacity_change(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.update_slots_on_service_capacity_change() IS 'Automatically updates slot capacities when service capacity is changed. Only affects future slots.';


--
-- Name: update_tenant_features_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.update_tenant_features_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.updated_at = now();

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.update_tenant_features_updated_at() OWNER TO postgres;

--
-- Name: update_tenant_zoho_configs_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.update_tenant_zoho_configs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.updated_at = NOW();

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.update_tenant_zoho_configs_updated_at() OWNER TO postgres;

--
-- Name: update_zoho_tokens_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.update_zoho_tokens_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$;


ALTER FUNCTION public.update_zoho_tokens_updated_at() OWNER TO postgres;

--
-- Name: validate_booking_lock(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION public.validate_booking_lock(p_lock_id uuid, p_session_id text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$

DECLARE

  v_lock_record RECORD;

BEGIN

  SELECT 

    id,

    slot_id,

    reserved_by_session_id,

    reserved_capacity,

    lock_expires_at

  INTO v_lock_record

  FROM booking_locks

  WHERE id = p_lock_id;

  

  -- Check if lock exists

  IF NOT FOUND THEN

    RETURN false;

  END IF;

  

  -- Check if lock is expired

  IF v_lock_record.lock_expires_at <= now() THEN

    RETURN false;

  END IF;

  

  -- Check if session matches

  IF v_lock_record.reserved_by_session_id != p_session_id THEN

    RETURN false;

  END IF;

  

  RETURN true;

END;

$$;


ALTER FUNCTION public.validate_booking_lock(p_lock_id uuid, p_session_id text) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: users; Type: TABLE; Schema: auth; Owner: postgres
--

DROP TABLE IF EXISTS auth.users CASCADE;
CREATE TABLE auth.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE auth.users OWNER TO postgres;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.audit_logs CASCADE;
CREATE TABLE public.audit_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: booking_locks; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.booking_locks CASCADE;
CREATE TABLE public.booking_locks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slot_id uuid NOT NULL,
    reserved_by_session_id text NOT NULL,
    reserved_capacity integer DEFAULT 1 NOT NULL,
    lock_acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    lock_expires_at timestamp with time zone NOT NULL,
    CONSTRAINT booking_locks_reserved_capacity_check CHECK ((reserved_capacity > 0))
);


ALTER TABLE public.booking_locks OWNER TO postgres;

--
-- Name: bookings; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.bookings CASCADE;
CREATE TABLE public.bookings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: COLUMN bookings.customer_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.customer_id IS 'References the user account of the customer who made this booking. NULL for guest bookings.';


--
-- Name: COLUMN bookings.offer_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.offer_id IS 'References the selected offer for this booking. NULL means basic service was selected.';


--
-- Name: COLUMN bookings.adult_count; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.adult_count IS 'Number of adult tickets in this booking';


--
-- Name: COLUMN bookings.child_count; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.child_count IS 'Number of child tickets in this booking';


--
-- Name: COLUMN bookings.qr_scanned; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.qr_scanned IS 'Whether the QR code has been scanned (invalidates QR)';


--
-- Name: COLUMN bookings.qr_scanned_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.qr_scanned_at IS 'Timestamp when QR code was scanned';


--
-- Name: COLUMN bookings.qr_scanned_by_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.qr_scanned_by_user_id IS 'User ID who scanned the QR code (cashier/receptionist)';


--
-- Name: COLUMN bookings.package_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.package_id IS 'Package ID if this booking is part of a service package (nullable)';


--
-- Name: COLUMN bookings.language; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bookings.language IS 'Customer preferred language for ticket generation and communications. Values: en (English) or ar (Arabic).';


--
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.customers CASCADE;
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

--
-- Name: employee_services; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.employee_services CASCADE;
CREATE TABLE public.employee_services (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    service_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    shift_id uuid,
    duration_minutes integer,
    capacity_per_slot integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.employee_services OWNER TO postgres;

--
-- Name: otp_requests; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.otp_requests CASCADE;
CREATE TABLE public.otp_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    phone text,
    otp_code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text DEFAULT 'password_reset'::text,
    email text
);


ALTER TABLE public.otp_requests OWNER TO postgres;

--
-- Name: COLUMN otp_requests.purpose; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.otp_requests.purpose IS 'Purpose of OTP: password_reset, login, etc.';


--
-- Name: package_services; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.package_services CASCADE;
CREATE TABLE public.package_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_id uuid NOT NULL,
    service_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT package_services_quantity_check CHECK ((quantity > 0))
);


ALTER TABLE public.package_services OWNER TO postgres;

--
-- Name: package_subscription_usage; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.package_subscription_usage CASCADE;
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

--
-- Name: package_subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.package_subscriptions CASCADE;
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

--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.payments CASCADE;
CREATE TABLE public.payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: queue_jobs; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.queue_jobs CASCADE;
CREATE TABLE public.queue_jobs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'pending'::text,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);


ALTER TABLE public.queue_jobs OWNER TO postgres;

--
-- Name: reviews; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.reviews CASCADE;
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

--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.service_categories CASCADE;
CREATE TABLE public.service_categories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    name_ar text DEFAULT ''::text NOT NULL,
    description text,
    description_ar text,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.service_categories OWNER TO postgres;

--
-- Name: service_offers; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.service_offers CASCADE;
CREATE TABLE public.service_offers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: TABLE service_offers; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.service_offers IS 'Offers/variants for services (e.g., Basic, Fast Track, VIP)';


--
-- Name: COLUMN service_offers.perks; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.service_offers.perks IS 'Array of perks/features for this offer (e.g., ["Fast-track entry", "Access to telescopes"])';


--
-- Name: COLUMN service_offers.badge; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.service_offers.badge IS 'Badge text to display (e.g., "Most Popular", "Best Value")';


--
-- Name: COLUMN service_offers.closing_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.service_offers.closing_time IS 'Closing time for this offer (e.g., "11:30pm")';


--
-- Name: service_packages; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.service_packages CASCADE;
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

--
-- Name: COLUMN service_packages.original_price; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.service_packages.original_price IS 'Original combined price of all services in the package before discount';


--
-- Name: COLUMN service_packages.discount_percentage; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.service_packages.discount_percentage IS 'Discount percentage (0-100) applied to the package';


--
-- Name: COLUMN service_packages.image_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.service_packages.image_url IS 'Main/featured image URL (base64 or URL)';


--
-- Name: COLUMN service_packages.gallery_urls; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.service_packages.gallery_urls IS 'Array of image URLs (JSONB array)';


--
-- Name: services; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.services CASCADE;
CREATE TABLE public.services (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: COLUMN services.original_price; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.services.original_price IS 'Original price before discount';


--
-- Name: COLUMN services.discount_percentage; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.services.discount_percentage IS 'Discount percentage (0-100)';


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.shifts CASCADE;
CREATE TABLE public.shifts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: slots; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.slots CASCADE;
CREATE TABLE public.slots (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: sms_logs; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.sms_logs CASCADE;
CREATE TABLE public.sms_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid,
    phone text NOT NULL,
    message text NOT NULL,
    status text,
    provider_response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sms_logs OWNER TO postgres;

--
-- Name: tenant_features; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.tenant_features CASCADE;
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

--
-- Name: tenant_zoho_configs; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.tenant_zoho_configs CASCADE;
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

--
-- Name: TABLE tenant_zoho_configs; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.tenant_zoho_configs IS 'Stores Zoho OAuth credentials per tenant for multi-tenant SaaS architecture';


--
-- Name: COLUMN tenant_zoho_configs.client_secret; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenant_zoho_configs.client_secret IS 'Should be encrypted at application level before storage';


--
-- Name: COLUMN tenant_zoho_configs.region; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenant_zoho_configs.region IS 'Zoho region: com, eu, in, au, jp, etc.';


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.tenants CASCADE;
CREATE TABLE public.tenants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: COLUMN tenants.smtp_settings; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.smtp_settings IS 'SMTP configuration for email sending: {smtp_host, smtp_port, smtp_user, smtp_password}';


--
-- Name: COLUMN tenants.whatsapp_settings; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.whatsapp_settings IS 'WhatsApp Business API configuration for sending OTP messages: {provider, api_url, api_key, phone_number_id, access_token, account_sid, auth_token, from}';


--
-- Name: time_slots; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.time_slots CASCADE;
CREATE TABLE public.time_slots (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.users CASCADE;
CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: zoho_invoice_logs; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.zoho_invoice_logs CASCADE;
CREATE TABLE public.zoho_invoice_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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

--
-- Name: zoho_tokens; Type: TABLE; Schema: public; Owner: postgres
--

DROP TABLE IF EXISTS public.zoho_tokens CASCADE;
CREATE TABLE public.zoho_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.zoho_tokens OWNER TO postgres;
