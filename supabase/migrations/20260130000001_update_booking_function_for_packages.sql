/*
  # Update create_booking_with_lock to support package_subscription_id
  
  Adds package_subscription_id parameter to the booking creation function
  so that package capacity can be automatically applied during booking.
*/

-- Update the function signature and logic
CREATE OR REPLACE FUNCTION public.create_booking_with_lock(
  p_slot_id uuid,
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
  p_lock_id uuid,
  p_session_id text,
  p_customer_id uuid,
  p_offer_id uuid,
  p_language text DEFAULT 'en',
  p_package_subscription_id uuid DEFAULT NULL -- NEW: Package subscription ID
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

  -- Validate visitor_count matches adult_count + child_count
  IF p_visitor_count != (p_adult_count + p_child_count) THEN
    RAISE EXCEPTION 'visitor_count (%) does not match adult_count (%) + child_count (%)', 
      p_visitor_count, p_adult_count, p_child_count;
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

  -- Validate lock if provided
  IF p_lock_id IS NOT NULL AND p_session_id IS NOT NULL THEN
    SELECT id, slot_id, reserved_by_session_id, reserved_capacity, lock_expires_at
    INTO v_lock_record
    FROM booking_locks
    WHERE id = p_lock_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lock not found';
    END IF;

    IF v_lock_record.lock_expires_at <= now() THEN
      RAISE EXCEPTION 'Lock has expired';
    END IF;

    IF v_lock_record.reserved_by_session_id != p_session_id THEN
      RAISE EXCEPTION 'Lock does not belong to this session';
    END IF;

    IF v_lock_record.slot_id != p_slot_id THEN
      RAISE EXCEPTION 'Lock does not match the specified slot';
    END IF;

    IF v_lock_record.reserved_capacity < p_visitor_count THEN
      RAISE EXCEPTION 'Lock reserved capacity (%) is less than requested visitor count (%)', 
        v_lock_record.reserved_capacity, p_visitor_count;
    END IF;
  END IF;

  -- Calculate currently locked capacity (excluding the current lock if provided)
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

  -- Create booking (now includes package_subscription_id)
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
    customer_id,
    offer_id,
    language,
    package_subscription_id -- NEW: Include package subscription
  ) VALUES (
    p_tenant_id,
    p_service_id,
    p_slot_id,
    p_employee_id,
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_visitor_count,
    p_adult_count,
    p_child_count,
    p_total_price,
    'pending',
    'unpaid',
    p_notes,
    p_customer_id,
    p_customer_id,
    p_offer_id,
    p_language,
    p_package_subscription_id -- NEW: Set package subscription
  )
  RETURNING id INTO v_booking_id;

  -- CRITICAL FIX: Reduce slot capacity immediately when booking is created
  -- The trigger should handle this, but we also do it here as a backup
  -- This ensures capacity is reduced even if trigger fails or doesn't fire
  -- Using FOR UPDATE to prevent race conditions
  UPDATE slots
  SET 
    available_capacity = GREATEST(0, available_capacity - p_visitor_count),
    booked_count = booked_count + p_visitor_count
  WHERE id = p_slot_id;
  
  -- Verify the update succeeded
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update slot capacity';
  END IF;

  -- Delete the lock if it was used
  IF p_lock_id IS NOT NULL THEN
    DELETE FROM booking_locks WHERE id = p_lock_id;
  END IF;

  -- Get the created booking with related data
  SELECT jsonb_build_object(
    'id', b.id,
    'tenant_id', b.tenant_id,
    'service_id', b.service_id,
    'slot_id', b.slot_id,
    'employee_id', b.employee_id,
    'customer_name', b.customer_name,
    'customer_phone', b.customer_phone,
    'customer_email', b.customer_email,
    'visitor_count', b.visitor_count,
    'adult_count', b.adult_count,
    'child_count', b.child_count,
    'total_price', b.total_price,
    'status', b.status,
    'payment_status', b.payment_status,
    'notes', b.notes,
    'customer_id', b.customer_id,
    'offer_id', b.offer_id,
    'language', b.language,
    'package_subscription_id', b.package_subscription_id, -- NEW: Include in response
    'created_at', b.created_at,
    'updated_at', b.updated_at
  )
  INTO v_booking
  FROM bookings b
  WHERE b.id = v_booking_id;

  RETURN v_booking;
END;
$$;

-- Update function permissions
ALTER FUNCTION public.create_booking_with_lock(
  uuid, uuid, uuid, text, text, text, integer, integer, integer, 
  numeric, text, uuid, uuid, text, uuid, uuid, text, uuid
) SECURITY DEFINER;
