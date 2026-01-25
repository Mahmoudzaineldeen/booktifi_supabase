-- ============================================================================
-- Completely Remove Child Ticket Logic from Database Functions
-- ============================================================================
-- This migration completely removes child ticket logic from database functions
-- while maintaining backward compatibility with existing bookings.
-- 
-- Strategy:
-- - Remove adult_count and child_count parameters from function signatures
-- - Always set adult_count = visitor_count and child_count = 0 for new bookings
-- - Remove constraint that requires visitor_count = adult_count + child_count
-- - Keep database columns for backward compatibility (existing bookings)
-- ============================================================================

-- Step 1: Remove the constraint that enforces visitor_count = adult_count + child_count
-- This allows existing bookings to continue working even if they have different values
DO $$
BEGIN
  -- Drop the constraint if it exists
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_visitor_count_check;
  
  -- Add a simpler constraint that only checks visitor_count > 0
  ALTER TABLE bookings ADD CONSTRAINT bookings_visitor_count_check 
    CHECK (visitor_count > 0);
  
  RAISE NOTICE 'Updated visitor_count constraint to only check visitor_count > 0';
END $$;

-- Step 2: Update create_booking_with_lock function
-- Remove adult_count and child_count parameters, always set adult_count = visitor_count, child_count = 0
CREATE OR REPLACE FUNCTION public.create_booking_with_lock(
  p_slot_id uuid,
  p_service_id uuid,
  p_tenant_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_visitor_count integer,
  p_total_price numeric(10,2),
  p_notes text,
  p_employee_id uuid,
  p_lock_id uuid,
  p_session_id text,
  p_customer_id uuid,
  p_offer_id uuid,
  p_language text DEFAULT 'en'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot_record RECORD;
  v_lock_record RECORD;
  v_service_record RECORD;
  v_tenant_record RECORD;
  v_booking_id uuid;
  v_locked_capacity integer;
  v_available_capacity integer;
  v_booking jsonb;
BEGIN
  -- Validate required fields
  IF p_slot_id IS NULL OR p_service_id IS NULL OR p_tenant_id IS NULL OR 
     p_customer_name IS NULL OR p_customer_phone IS NULL THEN
    RAISE EXCEPTION 'Missing required fields';
  END IF;

  -- Validate visitor_count
  IF p_visitor_count < 1 THEN
    RAISE EXCEPTION 'visitor_count must be at least 1';
  END IF;

  -- Get and lock slot
  SELECT id, available_capacity, is_available, original_capacity, booked_count, tenant_id
  INTO v_slot_record
  FROM slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot not found';
  END IF;

  -- Verify slot belongs to tenant
  IF v_slot_record.tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'Slot does not belong to the specified tenant';
  END IF;

  -- Check if slot is available
  IF NOT v_slot_record.is_available THEN
    RAISE EXCEPTION 'Slot is not available';
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

  -- Check lock if provided
  IF p_lock_id IS NOT NULL THEN
    SELECT id, reserved_capacity, lock_expires_at, reserved_by_session_id
    INTO v_lock_record
    FROM booking_locks
    WHERE id = p_lock_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lock not found or expired';
    END IF;

    IF v_lock_record.lock_expires_at < NOW() THEN
      RAISE EXCEPTION 'Lock has expired';
    END IF;

    IF v_lock_record.reserved_by_session_id != p_session_id THEN
      RAISE EXCEPTION 'Lock belongs to a different session';
    END IF;

    -- Verify lock capacity matches request
    IF v_lock_record.reserved_capacity < p_visitor_count THEN
      RAISE EXCEPTION 'Lock capacity (%) is less than requested visitor_count (%)', 
        v_lock_record.reserved_capacity, p_visitor_count;
    END IF;
  END IF;

  -- Check slot capacity
  v_available_capacity := v_slot_record.available_capacity;
  
  IF p_lock_id IS NOT NULL THEN
    v_locked_capacity := v_lock_record.reserved_capacity;
  ELSE
    v_locked_capacity := 0;
  END IF;

  IF (v_available_capacity + v_locked_capacity) < p_visitor_count THEN
    RAISE EXCEPTION 'Not enough capacity available. Available: %, Locked: %, Requested: %', 
      v_available_capacity, v_locked_capacity, p_visitor_count;
  END IF;

  -- Create booking
  -- Always set adult_count = visitor_count and child_count = 0 for unified ticket model
  INSERT INTO bookings (
    tenant_id,
    service_id,
    slot_id,
    employee_id,
    customer_name,
    customer_phone,
    customer_email,
    visitor_count,
    adult_count,  -- Always equals visitor_count
    child_count,  -- Always 0
    total_price,
    status,
    payment_status,
    notes,
    created_by_user_id,
    offer_id,
    language
  ) VALUES (
    p_tenant_id,
    p_service_id,
    p_slot_id,
    p_employee_id,
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_visitor_count,
    p_visitor_count,  -- adult_count = visitor_count
    0,                 -- child_count = 0 (unified ticket model)
    p_total_price,
    'confirmed',
    'unpaid',
    p_notes,
    p_customer_id,
    p_offer_id,
    p_language
  ) RETURNING id INTO v_booking_id;

  -- Update slot capacity
  UPDATE slots
  SET 
    booked_count = booked_count + p_visitor_count,
    available_capacity = GREATEST(0, available_capacity - p_visitor_count),
    is_overbooked = (booked_count + p_visitor_count) > original_capacity
  WHERE id = p_slot_id;

  -- Delete lock if provided
  IF p_lock_id IS NOT NULL THEN
    DELETE FROM booking_locks WHERE id = p_lock_id;
  END IF;

  -- Return booking (without adult_count/child_count in response for cleaner API)
  SELECT jsonb_build_object(
    'id', id,
    'tenant_id', tenant_id,
    'service_id', service_id,
    'slot_id', slot_id,
    'customer_name', customer_name,
    'customer_phone', customer_phone,
    'customer_email', customer_email,
    'visitor_count', visitor_count,
    'total_price', total_price,
    'status', status,
    'payment_status', payment_status,
    'created_at', created_at
  )
  INTO v_booking
  FROM bookings
  WHERE id = v_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking', v_booking
  );
END;
$$;

-- Step 3: Update create_bulk_booking function
-- Remove adult_count and child_count parameters
CREATE OR REPLACE FUNCTION public.create_bulk_booking(
  p_slot_ids uuid[],
  p_service_id uuid,
  p_tenant_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_visitor_count integer,
  p_total_price numeric(10,2),
  p_notes text,
  p_employee_id uuid,
  p_session_id text,
  p_customer_id uuid,
  p_offer_id uuid,
  p_language text DEFAULT 'en',
  p_booking_group_id uuid DEFAULT NULL
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
  v_available_capacity integer;
  v_total_requested integer;
  v_slot_index integer;
  v_booking jsonb;
  v_bookings jsonb[] := ARRAY[]::jsonb[];
  v_booking_group_id_final uuid;
  v_price_per_slot numeric(10,2);
BEGIN
  -- Validate required fields
  IF array_length(p_slot_ids, 1) IS NULL OR array_length(p_slot_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one slot must be provided';
  END IF;

  IF p_service_id IS NULL OR p_tenant_id IS NULL OR 
     p_customer_name IS NULL OR p_customer_phone IS NULL THEN
    RAISE EXCEPTION 'Missing required fields';
  END IF;

  -- Validate visitor_count matches number of slots (each slot gets 1 visitor in bulk booking)
  IF array_length(p_slot_ids, 1) != p_visitor_count THEN
    RAISE EXCEPTION 'Number of slots (%) must match visitor_count (%)', 
      array_length(p_slot_ids, 1), p_visitor_count;
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

  -- Calculate price per slot
  v_price_per_slot := p_total_price / array_length(p_slot_ids, 1);

  -- Validate all slots before creating any bookings
  v_total_requested := 0;
  FOR v_slot_index IN 1..array_length(p_slot_ids, 1) LOOP
    SELECT id, available_capacity, is_available, tenant_id
    INTO v_slot_record
    FROM slots
    WHERE id = p_slot_ids[v_slot_index]
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Slot at index % not found', v_slot_index;
    END IF;

    IF v_slot_record.tenant_id != p_tenant_id THEN
      RAISE EXCEPTION 'Slot at index % does not belong to the specified tenant', v_slot_index;
    END IF;

    IF NOT v_slot_record.is_available THEN
      RAISE EXCEPTION 'Slot at index % is not available', v_slot_index;
    END IF;

    IF v_slot_record.available_capacity < 1 THEN
      RAISE EXCEPTION 'Slot at index % has no available capacity', v_slot_index;
    END IF;

    v_total_requested := v_total_requested + 1;
  END LOOP;

  -- Create bookings (one per slot, each with 1 visitor)
  FOR v_slot_index IN 1..array_length(p_slot_ids, 1) LOOP
    -- Get slot again (already locked from validation loop)
    SELECT id, available_capacity, is_available, original_capacity, booked_count, tenant_id
    INTO v_slot_record
    FROM slots
    WHERE id = p_slot_ids[v_slot_index];

    -- Create booking (1 visitor per slot in bulk booking)
    -- Always set adult_count = 1 and child_count = 0 for unified ticket model
    INSERT INTO bookings (
      tenant_id,
      service_id,
      slot_id,
      employee_id,
      customer_name,
      customer_phone,
      customer_email,
      visitor_count,
      adult_count,  -- Always 1 (each slot gets 1 visitor)
      child_count,  -- Always 0 (unified ticket model)
      total_price,
      status,
      payment_status,
      notes,
      created_by_user_id,
      offer_id,
      language,
      booking_group_id
    ) VALUES (
      p_tenant_id,
      p_service_id,
      p_slot_ids[v_slot_index],
      p_employee_id,
      p_customer_name,
      p_customer_phone,
      p_customer_email,
      1,  -- Each slot gets 1 visitor
      1,  -- adult_count = 1
      0,  -- child_count = 0
      v_price_per_slot,
      'confirmed',
      'unpaid',
      p_notes,
      p_customer_id,
      p_offer_id,
      p_language,
      v_booking_group_id_final
    ) RETURNING id INTO v_booking_id;

    v_booking_ids := array_append(v_booking_ids, v_booking_id);

    -- Update slot capacity
    UPDATE slots
    SET 
      booked_count = booked_count + 1,
      available_capacity = GREATEST(0, available_capacity - 1),
      is_overbooked = (booked_count + 1) > original_capacity
    WHERE id = p_slot_ids[v_slot_index];
  END LOOP;

  -- Build response with all bookings (without adult_count/child_count)
  FOR v_slot_index IN 1..array_length(v_booking_ids, 1) LOOP
    SELECT jsonb_build_object(
      'id', id,
      'tenant_id', tenant_id,
      'service_id', service_id,
      'slot_id', slot_id,
      'customer_name', customer_name,
      'customer_phone', customer_phone,
      'customer_email', customer_email,
      'visitor_count', visitor_count,
      'total_price', total_price,
      'status', status,
      'payment_status', payment_status,
      'created_at', created_at
    )
    INTO v_booking
    FROM bookings
    WHERE id = v_booking_ids[v_slot_index];

    v_bookings := array_append(v_bookings, v_booking);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'booking_group_id', v_booking_group_id_final,
    'bookings', v_bookings
  );
END;
$$;

-- Step 4: Update comments to reflect unified ticket model
COMMENT ON COLUMN bookings.adult_count IS 'Legacy field: Always equals visitor_count for unified ticket model';
COMMENT ON COLUMN bookings.child_count IS 'Legacy field: Always 0 for unified ticket model';

-- Step 5: Ensure all existing bookings have consistent values
-- This fixes any existing bookings that might have inconsistent adult_count/child_count
UPDATE bookings
SET 
  adult_count = visitor_count,
  child_count = 0
WHERE adult_count IS NULL 
   OR child_count IS NULL
   OR adult_count != visitor_count
   OR child_count != 0;

-- Log how many were fixed
DO $$
DECLARE
  v_fixed_count integer;
BEGIN
  GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % bookings to use unified ticket model (adult_count = visitor_count, child_count = 0)', v_fixed_count;
END $$;
