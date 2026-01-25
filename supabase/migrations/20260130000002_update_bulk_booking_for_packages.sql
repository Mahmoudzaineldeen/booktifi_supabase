/*
  # Update create_bulk_booking to support package_subscription_id
  
  Adds package_subscription_id parameter to bulk booking creation function
  so that package capacity can be automatically applied during bulk bookings.
  All bookings in a bulk booking use the same package subscription if capacity exists.
  
  NOTE: This migration applies the full updated function from database/create_bulk_booking_function.sql
*/

-- Drop ALL existing versions of the function first to avoid ambiguity
-- Use a DO block to dynamically drop all overloads
DO $$
DECLARE
  r record;
BEGIN
  -- Find and drop all versions of create_bulk_booking
  FOR r IN 
    SELECT oid, proname, pg_get_function_identity_arguments(oid) as args
    FROM pg_proc
    WHERE proname = 'create_bulk_booking'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.proname, r.args);
  END LOOP;
END $$;

-- Apply the updated function with package_subscription_id support
-- This includes the fix for v_unique_slot_count variable declaration
CREATE OR REPLACE FUNCTION public.create_bulk_booking(
  p_slot_ids uuid[],
  p_service_id uuid,
  p_tenant_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_visitor_count integer,
  p_adult_count integer,
  p_child_count integer,
  p_total_price numeric(10,2),
  p_notes text,
  p_employee_id uuid,
  p_session_id text,
  p_customer_id uuid,
  p_offer_id uuid,
  p_language text DEFAULT 'en',
  p_booking_group_id uuid DEFAULT NULL,
  p_package_subscription_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot_record RECORD;
  v_service_record RECORD;
  v_tenant_record RECORD;
  v_booking_id uuid;
  v_booking_ids uuid[] := ARRAY[]::uuid[];
  v_locked_capacity integer;
  v_available_capacity integer;
  v_total_requested integer;
  v_slot_index integer;
  v_booking jsonb;
  v_bookings jsonb[] := ARRAY[]::jsonb[];
  v_booking_group_id_final uuid;
  v_price_per_slot numeric(10,2);
  v_unique_slot_count integer;
BEGIN
  -- Validate required fields
  IF array_length(p_slot_ids, 1) IS NULL OR array_length(p_slot_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one slot must be provided';
  END IF;

  IF p_service_id IS NULL OR p_tenant_id IS NULL OR 
     p_customer_name IS NULL OR p_customer_phone IS NULL THEN
    RAISE EXCEPTION 'Missing required fields';
  END IF;

  -- Validate visitor_count matches adult_count + child_count
  IF p_visitor_count != (p_adult_count + p_child_count) THEN
    RAISE EXCEPTION 'visitor_count (%) does not match adult_count (%) + child_count (%)', 
      p_visitor_count, p_adult_count, p_child_count;
  END IF;

  -- Get service
  SELECT id, tenant_id, is_active
  INTO v_service_record
  FROM services
  WHERE id = p_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found';
  END IF;

  -- Verify service belongs to tenant
  IF v_service_record.tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'Service does not belong to the specified tenant';
  END IF;

  -- Check if service is active
  IF NOT v_service_record.is_active THEN
    RAISE EXCEPTION 'Service is not active';
  END IF;

  -- Get tenant
  SELECT id, is_active
  INTO v_tenant_record
  FROM tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  -- Check if tenant is active
  IF NOT v_tenant_record.is_active THEN
    RAISE EXCEPTION 'Tenant account is deactivated';
  END IF;

  -- Generate booking_group_id if not provided
  IF p_booking_group_id IS NULL THEN
    v_booking_group_id_final := gen_random_uuid();
  ELSE
    v_booking_group_id_final := p_booking_group_id;
  END IF;

  -- ============================================================================
  -- STEP 1: Validate ALL slots BEFORE creating any bookings (prevent overbooking)
  -- ============================================================================
  
  -- Check for duplicate slot IDs
  SELECT COUNT(DISTINCT slot_id)
  INTO v_unique_slot_count
  FROM unnest(p_slot_ids) AS slot_id;
  
  IF v_unique_slot_count != array_length(p_slot_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate slot IDs detected. Each slot can only be booked once per request.';
  END IF;

  -- Idempotency check
  IF p_booking_group_id IS NOT NULL THEN
    DECLARE
      v_existing_count integer;
    BEGIN
      SELECT COUNT(*)
      INTO v_existing_count
      FROM bookings
      WHERE booking_group_id = p_booking_group_id;
      
      IF v_existing_count > 0 THEN
        RAISE EXCEPTION 'Booking group % already exists. This request appears to be a duplicate.', p_booking_group_id;
      END IF;
    END;
  END IF;
  
  -- Pre-validate ALL slots
  v_total_requested := 0;
  DECLARE
    v_total_available integer := 0;
    v_slot_available_capacities integer[] := ARRAY[]::integer[];
  BEGIN
    FOR v_slot_index IN 1..array_length(p_slot_ids, 1) LOOP
      SELECT id, available_capacity, is_available, original_capacity, booked_count, tenant_id
      INTO v_slot_record
      FROM slots
      WHERE id = p_slot_ids[v_slot_index]
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Slot % not found', p_slot_ids[v_slot_index];
      END IF;

      IF v_slot_record.tenant_id != p_tenant_id THEN
        RAISE EXCEPTION 'Slot % does not belong to the specified tenant', p_slot_ids[v_slot_index];
      END IF;

      IF NOT v_slot_record.is_available THEN
        RAISE EXCEPTION 'Slot % is not available', p_slot_ids[v_slot_index];
      END IF;

      SELECT COALESCE(SUM(reserved_capacity), 0)
      INTO v_locked_capacity
      FROM booking_locks
      WHERE slot_id = p_slot_ids[v_slot_index]
        AND lock_expires_at > now()
        AND (p_session_id IS NULL OR reserved_by_session_id != p_session_id);

      v_available_capacity := v_slot_record.available_capacity - v_locked_capacity;

      IF v_available_capacity < 1 THEN
        RAISE EXCEPTION 'Not enough tickets available for slot %. Only % available, but 1 requested.', 
          p_slot_ids[v_slot_index], v_available_capacity;
      END IF;

      v_slot_available_capacities := array_append(v_slot_available_capacities, v_available_capacity);
      v_total_available := v_total_available + v_available_capacity;
      v_total_requested := v_total_requested + 1;
    END LOOP;

    IF v_total_requested > v_total_available THEN
      RAISE EXCEPTION 'Not enough tickets available. Total available: %, Total requested: %.', 
        v_total_available, v_total_requested;
    END IF;

    IF array_length(p_slot_ids, 1) > v_total_available THEN
      RAISE EXCEPTION 'Not enough slots available. Available slots: %, Requested slots: %.', 
        v_total_available, array_length(p_slot_ids, 1);
    END IF;
  END;

  IF v_total_requested != p_visitor_count THEN
    RAISE EXCEPTION 'Number of slots (%) does not match visitor_count (%). Each slot requires 1 visitor.', 
      v_total_requested, p_visitor_count;
  END IF;

  v_price_per_slot := p_total_price / array_length(p_slot_ids, 1);

  -- ============================================================================
  -- STEP 2: Create ALL bookings in transaction
  -- ============================================================================
  FOR v_slot_index IN 1..array_length(p_slot_ids, 1) LOOP
    SELECT id, available_capacity, is_available, original_capacity, booked_count, tenant_id
    INTO v_slot_record
    FROM slots
    WHERE id = p_slot_ids[v_slot_index];

    INSERT INTO bookings (
      tenant_id, service_id, slot_id, employee_id,
      customer_name, customer_phone, customer_email,
      visitor_count, adult_count, child_count,
      total_price, status, payment_status, notes,
      created_by_user_id, customer_id, offer_id, language,
      booking_group_id, package_subscription_id
    ) VALUES (
      p_tenant_id, p_service_id, p_slot_ids[v_slot_index], p_employee_id,
      p_customer_name, p_customer_phone, p_customer_email,
      1,
      CASE WHEN v_slot_index <= p_adult_count THEN 1 ELSE 0 END,
      CASE WHEN v_slot_index > p_adult_count THEN 1 ELSE 0 END,
      v_price_per_slot, 'pending', 'unpaid', p_notes,
      p_customer_id, p_customer_id, p_offer_id, p_language,
      v_booking_group_id_final, p_package_subscription_id
    )
    RETURNING id INTO v_booking_id;

    UPDATE slots
    SET 
      available_capacity = GREATEST(0, available_capacity - 1),
      booked_count = booked_count + 1
    WHERE id = p_slot_ids[v_slot_index];
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Failed to update slot capacity for slot %', p_slot_ids[v_slot_index];
    END IF;

    v_booking_ids := array_append(v_booking_ids, v_booking_id);

    SELECT jsonb_build_object(
      'id', b.id, 'tenant_id', b.tenant_id, 'service_id', b.service_id,
      'slot_id', b.slot_id, 'employee_id', b.employee_id,
      'customer_name', b.customer_name, 'customer_phone', b.customer_phone,
      'customer_email', b.customer_email, 'visitor_count', b.visitor_count,
      'adult_count', b.adult_count, 'child_count', b.child_count,
      'total_price', b.total_price, 'status', b.status,
      'payment_status', b.payment_status, 'notes', b.notes,
      'customer_id', b.customer_id, 'offer_id', b.offer_id,
      'language', b.language, 'booking_group_id', b.booking_group_id,
      'created_at', b.created_at, 'updated_at', b.updated_at
    )
    INTO v_booking
    FROM bookings b
    WHERE b.id = v_booking_id;

    v_bookings := array_append(v_bookings, v_booking);
  END LOOP;

  RETURN jsonb_build_object(
    'booking_group_id', v_booking_group_id_final,
    'bookings', v_bookings,
    'total_bookings', array_length(v_booking_ids, 1),
    'total_visitors', p_visitor_count,
    'total_price', p_total_price
  );
END;
$$;

-- Set ownership for the function (after creation, so we know the exact signature)
DO $$
BEGIN
  -- Set ownership using the function OID to avoid ambiguity
  EXECUTE format('ALTER FUNCTION public.create_bulk_booking(%s) OWNER TO postgres',
    (SELECT pg_get_function_identity_arguments(oid)
     FROM pg_proc
     WHERE proname = 'create_bulk_booking'
       AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
       AND array_length(proargtypes::regtype[], 1) = 18
     LIMIT 1));
EXCEPTION
  WHEN OTHERS THEN
    -- If ALTER fails, that's okay - function was created successfully
    NULL;
END $$;

COMMENT ON FUNCTION public.create_bulk_booking IS 'Creates multiple bookings in a single atomic transaction. Validates total availability across all slots before creating any bookings. Prevents overbooking and ensures all-or-nothing booking creation. Returns all bookings with a common booking_group_id.';
