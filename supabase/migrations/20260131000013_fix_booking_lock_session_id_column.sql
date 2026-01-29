/*
  # Fix create_booking_with_lock: use reserved_by_session_id
  
  booking_locks table has reserved_by_session_id, not session_id.
  Replaces the function to use the correct column name.
*/

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
  p_package_subscription_id uuid DEFAULT NULL,
  p_package_covered_quantity integer DEFAULT 0,
  p_paid_quantity integer DEFAULT NULL
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
  v_paid_qty integer;
  v_package_covered_qty integer;
BEGIN
  IF p_slot_id IS NULL OR p_service_id IS NULL OR p_tenant_id IS NULL OR 
     p_customer_name IS NULL OR p_customer_phone IS NULL THEN
    RAISE EXCEPTION 'Missing required fields';
  END IF;

  IF p_visitor_count != (p_adult_count + p_child_count) THEN
    RAISE EXCEPTION 'visitor_count (%) does not match adult_count (%) + child_count (%)', 
      p_visitor_count, p_adult_count, p_child_count;
  END IF;

  IF p_paid_quantity IS NULL THEN
    v_paid_qty := p_visitor_count - p_package_covered_quantity;
  ELSE
    v_paid_qty := p_paid_quantity;
  END IF;

  v_package_covered_qty := p_package_covered_quantity;

  IF (v_package_covered_qty + v_paid_qty) != p_visitor_count THEN
    RAISE EXCEPTION 'package_covered_quantity (%) + paid_quantity (%) must equal visitor_count (%)', 
      v_package_covered_qty, v_paid_qty, p_visitor_count;
  END IF;

  IF v_package_covered_qty < 0 OR v_paid_qty < 0 THEN
    RAISE EXCEPTION 'package_covered_quantity and paid_quantity must be non-negative';
  END IF;

  SELECT id, available_capacity, is_available, original_capacity, booked_count, tenant_id
  INTO v_slot_record
  FROM slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot not found';
  END IF;

  IF v_slot_record.tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'Slot does not belong to the specified tenant';
  END IF;

  IF NOT v_slot_record.is_available THEN
    RAISE EXCEPTION 'Slot is not available';
  END IF;

  SELECT id, tenant_id, is_active
  INTO v_service_record
  FROM services
  WHERE id = p_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found';
  END IF;

  IF v_service_record.tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'Service does not belong to the specified tenant';
  END IF;

  IF NOT v_service_record.is_active THEN
    RAISE EXCEPTION 'Service is not active';
  END IF;

  SELECT id
  INTO v_tenant_record
  FROM tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  -- booking_locks uses reserved_by_session_id, not session_id
  IF p_lock_id IS NOT NULL THEN
    SELECT id, slot_id, reserved_capacity, reserved_by_session_id, lock_expires_at
    INTO v_lock_record
    FROM booking_locks
    WHERE id = p_lock_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lock not found or expired';
    END IF;

    IF v_lock_record.slot_id != p_slot_id THEN
      RAISE EXCEPTION 'Lock does not belong to the specified slot';
    END IF;

    IF v_lock_record.reserved_by_session_id != p_session_id THEN
      RAISE EXCEPTION 'Lock does not belong to the specified session';
    END IF;

    IF v_lock_record.lock_expires_at < NOW() THEN
      RAISE EXCEPTION 'Lock has expired';
    END IF;

    v_locked_capacity := v_lock_record.reserved_capacity;
  ELSE
    v_locked_capacity := 0;
  END IF;

  v_available_capacity := v_slot_record.available_capacity - v_locked_capacity;

  IF v_available_capacity < p_visitor_count THEN
    RAISE EXCEPTION 'Not enough tickets available. Available: %, Requested: %', 
      v_available_capacity, p_visitor_count;
  END IF;

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
    package_subscription_id,
    package_covered_quantity,
    paid_quantity
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
    CASE WHEN v_paid_qty > 0 THEN 'unpaid'::payment_status ELSE 'paid'::payment_status END,
    p_notes,
    CASE WHEN p_session_id IS NOT NULL AND p_session_id != '' THEN p_session_id::uuid ELSE NULL END,
    p_customer_id,
    p_offer_id,
    p_language,
    p_package_subscription_id,
    v_package_covered_qty,
    v_paid_qty
  )
  RETURNING id INTO v_booking_id;

  UPDATE slots
  SET 
    available_capacity = GREATEST(0, available_capacity - p_visitor_count),
    booked_count = booked_count + p_visitor_count
  WHERE id = p_slot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update slot capacity';
  END IF;

  IF p_lock_id IS NOT NULL THEN
    DELETE FROM booking_locks WHERE id = p_lock_id;
  END IF;

  SELECT jsonb_build_object(
    'id', b.id,
    'tenant_id', b.tenant_id,
    'service_id', b.service_id,
    'slot_id', b.slot_id,
    'customer_name', b.customer_name,
    'customer_phone', b.customer_phone,
    'customer_email', b.customer_email,
    'visitor_count', b.visitor_count,
    'adult_count', b.adult_count,
    'child_count', b.child_count,
    'total_price', b.total_price,
    'status', b.status,
    'payment_status', b.payment_status,
    'package_subscription_id', b.package_subscription_id,
    'package_covered_quantity', b.package_covered_quantity,
    'paid_quantity', b.paid_quantity,
    'created_at', b.created_at
  )
  INTO v_booking
  FROM bookings b
  WHERE b.id = v_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking', v_booking
  );
END;
$$;
