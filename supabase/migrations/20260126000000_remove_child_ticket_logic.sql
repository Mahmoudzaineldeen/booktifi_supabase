-- ============================================================================
-- Remove Child Ticket Logic from Database Functions
-- ============================================================================
-- This migration updates database functions to remove child ticket logic
-- while maintaining backward compatibility with existing bookings
-- ============================================================================

-- Update create_booking_with_lock function
-- Make adult_count and child_count optional, auto-calculate from visitor_count
CREATE OR REPLACE FUNCTION public.create_booking_with_lock(
  p_slot_id uuid,
  p_service_id uuid,
  p_tenant_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_visitor_count integer,
  p_adult_count integer DEFAULT NULL,
  p_child_count integer DEFAULT NULL,
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
  v_final_adult_count integer;
  v_final_child_count integer;
BEGIN
  -- Validate required fields
  IF p_slot_id IS NULL OR p_service_id IS NULL OR p_tenant_id IS NULL OR 
     p_customer_name IS NULL OR p_customer_phone IS NULL THEN
    RAISE EXCEPTION 'Missing required fields';
  END IF;

  -- Auto-calculate adult_count and child_count if not provided
  -- For backward compatibility: adult_count = visitor_count, child_count = 0
  IF p_adult_count IS NULL THEN
    v_final_adult_count := p_visitor_count;
  ELSE
    v_final_adult_count := p_adult_count;
  END IF;
  
  IF p_child_count IS NULL THEN
    v_final_child_count := 0;
  ELSE
    v_final_child_count := p_child_count;
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
    SELECT id, slot_id, visitor_count, lock_expires_at, session_id
    INTO v_lock_record
    FROM booking_locks
    WHERE id = p_lock_id
      AND slot_id = p_slot_id
      AND lock_expires_at > now();

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking lock expired or invalid';
    END IF;

    -- Verify lock session matches
    IF v_lock_record.session_id != COALESCE(p_session_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      RAISE EXCEPTION 'Booking lock session mismatch';
    END IF;
  END IF;

  -- Calculate locked capacity (excluding current lock if provided)
  SELECT COALESCE(SUM(reserved_capacity), 0)
  INTO v_locked_capacity
  FROM booking_locks
  WHERE slot_id = p_slot_id
    AND lock_expires_at > now()
    AND (p_lock_id IS NULL OR id != p_lock_id);

  -- Calculate available capacity
  v_available_capacity := v_slot_record.available_capacity - v_locked_capacity;

  -- Check if there's enough capacity
  IF v_available_capacity < p_visitor_count THEN
    RAISE EXCEPTION 'Not enough tickets available. Only % available, but % requested.', 
      v_available_capacity, p_visitor_count;
  END IF;

  -- Create booking
  INSERT INTO bookings (
    tenant_id,
    service_id,
    slot_id,
    employee_id,
    customer_name,
    customer_phone,
    customer_email,
    visitor_count,
    adult_count,
    child_count,
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
    v_final_adult_count,
    v_final_child_count,
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

  -- Return booking
  SELECT jsonb_build_object(
    'id', id,
    'tenant_id', tenant_id,
    'service_id', service_id,
    'slot_id', slot_id,
    'customer_name', customer_name,
    'customer_phone', customer_phone,
    'customer_email', customer_email,
    'visitor_count', visitor_count,
    'adult_count', adult_count,
    'child_count', child_count,
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

-- Update create_bulk_booking function
-- Make adult_count and child_count optional, auto-calculate from visitor_count
CREATE OR REPLACE FUNCTION public.create_bulk_booking(
  p_slot_ids uuid[],
  p_service_id uuid,
  p_tenant_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_visitor_count integer,
  p_adult_count integer DEFAULT NULL,
  p_child_count integer DEFAULT NULL,
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
  v_locked_capacity integer;
  v_available_capacity integer;
  v_total_requested integer;
  v_slot_index integer;
  v_booking jsonb;
  v_bookings jsonb[] := ARRAY[]::jsonb[];
  v_booking_group_id_final uuid;
  v_price_per_slot numeric(10,2);
  v_final_adult_count integer;
  v_final_child_count integer;
BEGIN
  -- Validate required fields
  IF array_length(p_slot_ids, 1) IS NULL OR array_length(p_slot_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one slot must be provided';
  END IF;

  IF p_service_id IS NULL OR p_tenant_id IS NULL OR 
     p_customer_name IS NULL OR p_customer_phone IS NULL THEN
    RAISE EXCEPTION 'Missing required fields';
  END IF;

  -- Auto-calculate adult_count and child_count if not provided
  IF p_adult_count IS NULL THEN
    v_final_adult_count := p_visitor_count;
  ELSE
    v_final_adult_count := p_adult_count;
  END IF;
  
  IF p_child_count IS NULL THEN
    v_final_child_count := 0;
  ELSE
    v_final_child_count := p_child_count;
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

  -- Calculate price per slot (total price divided by number of slots)
  v_price_per_slot := p_total_price / array_length(p_slot_ids, 1);

  -- Validate total availability across all slots BEFORE creating any bookings
  v_total_requested := array_length(p_slot_ids, 1); -- Each slot gets 1 visitor in bulk booking

  FOR v_slot_index IN 1..array_length(p_slot_ids, 1) LOOP
    SELECT id, available_capacity, is_available, original_capacity, booked_count, tenant_id
    INTO v_slot_record
    FROM slots
    WHERE id = p_slot_ids[v_slot_index]
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Slot at index % not found', v_slot_index;
    END IF;

    -- Verify slot belongs to tenant
    IF v_slot_record.tenant_id != p_tenant_id THEN
      RAISE EXCEPTION 'Slot at index % does not belong to the specified tenant', v_slot_index;
    END IF;

    -- Check if slot is available
    IF NOT v_slot_record.is_available THEN
      RAISE EXCEPTION 'Slot at index % is not available', v_slot_index;
    END IF;

    -- Calculate locked capacity for this slot
    SELECT COALESCE(SUM(reserved_capacity), 0)
    INTO v_locked_capacity
    FROM booking_locks
    WHERE slot_id = p_slot_ids[v_slot_index]
      AND lock_expires_at > now();

    v_available_capacity := v_slot_record.available_capacity - v_locked_capacity;

    -- Each slot in bulk booking gets 1 visitor
    IF v_available_capacity < 1 THEN
      RAISE EXCEPTION 'Not enough capacity in slot at index %. Available: %, Required: 1', 
        v_slot_index, v_available_capacity;
    END IF;
  END LOOP;

  -- All slots validated, now create all bookings
  FOR v_slot_index IN 1..array_length(p_slot_ids, 1) LOOP
    -- Get slot again (already locked from validation loop)
    SELECT id, available_capacity, is_available, original_capacity, booked_count, tenant_id
    INTO v_slot_record
    FROM slots
    WHERE id = p_slot_ids[v_slot_index];

    -- Create booking (1 visitor per slot in bulk booking)
    INSERT INTO bookings (
      tenant_id,
      service_id,
      slot_id,
      employee_id,
      customer_name,
      customer_phone,
      customer_email,
      visitor_count,
      adult_count,
      child_count,
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
      1, -- Each slot gets 1 visitor in bulk booking
      CASE WHEN v_slot_index = 1 THEN v_final_adult_count ELSE 1 END, -- Distribute adult_count across slots
      CASE WHEN v_slot_index = 1 THEN v_final_child_count ELSE 0 END, -- Distribute child_count across slots
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

  -- Build response with all bookings
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
      'adult_count', adult_count,
      'child_count', child_count,
      'total_price', total_price,
      'status', status,
      'payment_status', payment_status,
      'created_at', created_at,
      'booking_group_id', booking_group_id
    )
    INTO v_booking
    FROM bookings
    WHERE id = v_booking_ids[v_slot_index];

    v_bookings := array_append(v_bookings, v_booking);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'bookings', v_bookings,
    'booking_group_id', v_booking_group_id_final,
    'total_bookings', array_length(v_booking_ids, 1)
  );
END;
$$;

COMMENT ON FUNCTION public.create_booking_with_lock IS 'Creates a booking with lock validation. adult_count and child_count are optional and auto-calculated from visitor_count for backward compatibility.';
COMMENT ON FUNCTION public.create_bulk_booking IS 'Creates multiple bookings in a single atomic transaction. adult_count and child_count are optional and auto-calculated from visitor_count for backward compatibility.';
