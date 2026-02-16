-- ============================================================================
-- Edit Booking Time: Sync employee_id from new slot (Employee-Based Mode)
-- ============================================================================
-- When changing booking time in employee-based scheduling, the assigned
-- employee must be updated from the new slot's employee_id. This prevents
-- double booking, invalid assignment, and wrong availability logic.
-- Service-based mode: slots may have NULL employee_id; booking.employee_id
-- is set to NULL in that case.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.edit_booking_time(
  p_booking_id uuid,
  p_new_slot_id uuid,
  p_tenant_id uuid,
  p_user_id uuid,
  p_old_slot_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_record RECORD;
  v_old_slot_record RECORD;
  v_new_slot_record RECORD;
  v_service_record RECORD;
  v_old_price numeric(10,2);
  v_new_price numeric(10,2);
  v_price_changed boolean := false;
  v_old_slot_id_final uuid;
  v_visitor_count integer;
  v_locked_capacity integer;
  v_available_capacity integer;
BEGIN
  -- ============================================================================
  -- STEP 1: Validate booking exists and belongs to tenant
  -- ============================================================================
  SELECT 
    id,
    tenant_id,
    service_id,
    slot_id,
    visitor_count,
    total_price,
    status,
    payment_status
  INTO v_booking_record
  FROM bookings
  WHERE id = p_booking_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found or does not belong to tenant';
  END IF;

  IF v_booking_record.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Cannot edit booking time for bookings with status: %', v_booking_record.status;
  END IF;

  v_old_slot_id_final := COALESCE(p_old_slot_id, v_booking_record.slot_id);
  v_visitor_count := v_booking_record.visitor_count;
  v_old_price := v_booking_record.total_price;

  IF v_old_slot_id_final = p_new_slot_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Booking time unchanged',
      'booking_id', p_booking_id,
      'slot_id', p_new_slot_id
    );
  END IF;

  -- ============================================================================
  -- STEP 2: Validate new slot exists and is available (include employee_id for employee-based sync)
  -- ============================================================================
  SELECT 
    s.id,
    s.tenant_id,
    s.shift_id,
    s.available_capacity,
    s.original_capacity,
    s.is_available,
    s.employee_id,
    sh.service_id
  INTO v_new_slot_record
  FROM slots s
  JOIN shifts sh ON s.shift_id = sh.id
  WHERE s.id = p_new_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'New slot not found';
  END IF;

  IF v_new_slot_record.tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'New slot belongs to a different tenant';
  END IF;

  IF v_new_slot_record.service_id != v_booking_record.service_id THEN
    UPDATE bookings
    SET service_id = v_new_slot_record.service_id,
        updated_at = now()
    WHERE id = p_booking_id;
    v_booking_record.service_id := v_new_slot_record.service_id;
  END IF;

  IF NOT v_new_slot_record.is_available THEN
    RAISE EXCEPTION 'Selected time slot is not available';
  END IF;

  -- ============================================================================
  -- STEP 3: Check capacity (excluding locks)
  -- ============================================================================
  SELECT COALESCE(SUM(visitor_count), 0)
  INTO v_locked_capacity
  FROM slot_locks
  WHERE slot_id = p_new_slot_id
    AND expires_at > now()
    AND session_id != COALESCE(
      (SELECT session_id FROM slot_locks WHERE slot_id = v_old_slot_id_final LIMIT 1),
      '00000000-0000-0000-0000-000000000000'::uuid
    );

  v_available_capacity := v_new_slot_record.available_capacity - v_locked_capacity;

  IF v_available_capacity < v_visitor_count THEN
    RAISE EXCEPTION 'Not enough capacity. Available: %, Required: %', 
      v_available_capacity, 
      v_visitor_count;
  END IF;

  -- ============================================================================
  -- STEP 4: Get service pricing info
  -- ============================================================================
  SELECT 
    id,
    base_price,
    discount_percentage,
    original_price
  INTO v_service_record
  FROM services
  WHERE id = v_new_slot_record.service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found';
  END IF;

  IF v_service_record.original_price IS NOT NULL AND v_service_record.discount_percentage IS NOT NULL THEN
    v_new_price := v_service_record.original_price * (1 - v_service_record.discount_percentage / 100.0) * v_visitor_count;
  ELSE
    v_new_price := COALESCE(v_service_record.base_price, 0) * v_visitor_count;
  END IF;

  v_price_changed := (v_old_price != v_new_price);

  -- ============================================================================
  -- STEP 5: Release old slot capacity and reserve new slot capacity
  -- ============================================================================
  IF v_old_slot_id_final IS NOT NULL THEN
    UPDATE slots
    SET 
      booked_count = GREATEST(0, booked_count - v_visitor_count),
      available_capacity = available_capacity + v_visitor_count,
      is_overbooked = (booked_count - v_visitor_count) > original_capacity
    WHERE id = v_old_slot_id_final;
  END IF;

  UPDATE slots
  SET 
    booked_count = booked_count + v_visitor_count,
    available_capacity = GREATEST(0, available_capacity - v_visitor_count),
    is_overbooked = (booked_count + v_visitor_count) > original_capacity
  WHERE id = p_new_slot_id;

  -- ============================================================================
  -- STEP 6: Invalidate old tickets (if any)
  -- ============================================================================
  UPDATE tickets
  SET 
    qr_scanned = true,
    qr_token = NULL,
    updated_at = now()
  WHERE booking_id = p_booking_id
    AND qr_scanned = false;

  -- ============================================================================
  -- STEP 7: Update booking with new slot, price, and employee (employee-based sync)
  -- ============================================================================
  UPDATE bookings
  SET 
    slot_id = p_new_slot_id,
    service_id = v_new_slot_record.service_id,
    total_price = v_new_price,
    employee_id = v_new_slot_record.employee_id,
    updated_at = now()
  WHERE id = p_booking_id;

  -- ============================================================================
  -- STEP 8: Create audit log
  -- ============================================================================
  INSERT INTO booking_audit_logs (
    booking_id,
    action,
    performed_by_user_id,
    old_values,
    new_values,
    created_at
  ) VALUES (
    p_booking_id,
    'time_changed',
    p_user_id,
    jsonb_build_object(
      'old_slot_id', v_old_slot_id_final,
      'old_price', v_old_price,
      'old_service_id', v_booking_record.service_id
    ),
    jsonb_build_object(
      'new_slot_id', p_new_slot_id,
      'new_price', v_new_price,
      'new_service_id', v_new_slot_record.service_id,
      'new_employee_id', v_new_slot_record.employee_id,
      'price_changed', v_price_changed
    ),
    now()
  );

  -- ============================================================================
  -- STEP 9: Return success with updated booking data
  -- ============================================================================
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Booking time updated successfully',
    'booking_id', p_booking_id,
    'slot_id', p_new_slot_id,
    'service_id', v_new_slot_record.service_id,
    'employee_id', v_new_slot_record.employee_id,
    'price_changed', v_price_changed,
    'old_price', v_old_price,
    'new_price', v_new_price
  );
END;
$$;

COMMENT ON FUNCTION public.edit_booking_time IS 
  'Atomically updates booking time slot. Syncs service_id and employee_id from the new slot (employee-based mode). Prevents invalid employee assignment after time change.';
