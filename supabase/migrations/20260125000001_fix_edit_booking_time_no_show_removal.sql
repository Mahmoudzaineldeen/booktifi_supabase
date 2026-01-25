-- ============================================================================
-- Quick Fix: Remove 'no_show' check from edit_booking_time function
-- ============================================================================
-- The booking_status enum does not include 'no_show', so we need to remove
-- it from the status check in the edit_booking_time function
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
  FOR UPDATE; -- Lock booking to prevent concurrent modifications

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found or does not belong to tenant';
  END IF;

  -- Prevent editing cancelled or completed bookings
  -- Note: 'no_show' is not a valid booking_status enum value
  IF v_booking_record.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Cannot edit booking time for bookings with status: %', v_booking_record.status;
  END IF;

  -- Store old slot ID
  v_old_slot_id_final := COALESCE(p_old_slot_id, v_booking_record.slot_id);
  v_visitor_count := v_booking_record.visitor_count;
  v_old_price := v_booking_record.total_price;

  -- If slot hasn't changed, no-op
  IF v_old_slot_id_final = p_new_slot_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Booking time unchanged',
      'booking_id', p_booking_id,
      'slot_id', p_new_slot_id
    );
  END IF;

  -- ============================================================================
  -- STEP 2: Validate new slot exists and is available
  -- ============================================================================
  SELECT 
    s.id,
    s.tenant_id,
    s.shift_id,
    s.available_capacity,
    s.original_capacity,
    s.is_available,
    sh.service_id
  INTO v_new_slot_record
  FROM slots s
  JOIN shifts sh ON s.shift_id = sh.id
  WHERE s.id = p_new_slot_id
  FOR UPDATE; -- Lock new slot to prevent concurrent modifications

  IF NOT FOUND THEN
    RAISE EXCEPTION 'New slot not found';
  END IF;

  -- Verify new slot belongs to same tenant
  IF v_new_slot_record.tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'New slot belongs to a different tenant';
  END IF;

  -- ============================================================================
  -- STEP 2.5: Sync booking service_id if it doesn't match new slot's shift
  -- This fixes any existing inconsistencies and prevents future ones
  -- ============================================================================
  IF v_new_slot_record.service_id != v_booking_record.service_id THEN
    -- Update booking's service_id to match the new slot's shift
    -- This ensures data consistency going forward
    UPDATE bookings
    SET service_id = v_new_slot_record.service_id,
        updated_at = now()
    WHERE id = p_booking_id;
    
    -- Update v_booking_record for consistency in rest of function
    v_booking_record.service_id := v_new_slot_record.service_id;
    
    -- Log the sync (for debugging)
    RAISE NOTICE 'Synced booking % service_id from % to %', 
      p_booking_id, 
      v_booking_record.service_id, 
      v_new_slot_record.service_id;
  END IF;

  -- Check if new slot is available
  IF NOT v_new_slot_record.is_available THEN
    RAISE EXCEPTION 'Selected time slot is not available';
  END IF;

  -- ============================================================================
  -- STEP 3: Check capacity (excluding locks)
  -- ============================================================================
  -- Calculate locked capacity for this slot
  SELECT COALESCE(SUM(reserved_capacity), 0)
  INTO v_locked_capacity
  FROM booking_locks
  WHERE slot_id = p_new_slot_id
    AND lock_expires_at > now()
    AND reserved_by_session_id != COALESCE(
      (SELECT reserved_by_session_id FROM booking_locks WHERE slot_id = v_old_slot_id_final LIMIT 1),
      ''
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

  -- Calculate new price
  IF v_service_record.original_price IS NOT NULL AND v_service_record.discount_percentage IS NOT NULL THEN
    v_new_price := v_service_record.original_price * (1 - v_service_record.discount_percentage / 100.0) * v_visitor_count;
  ELSE
    v_new_price := COALESCE(v_service_record.base_price, 0) * v_visitor_count;
  END IF;

  v_price_changed := (v_old_price != v_new_price);

  -- ============================================================================
  -- STEP 5: Release old slot capacity and reserve new slot capacity
  -- ============================================================================
  -- Release old slot capacity
  IF v_old_slot_id_final IS NOT NULL THEN
    UPDATE slots
    SET 
      booked_count = GREATEST(0, booked_count - v_visitor_count),
      available_capacity = available_capacity + v_visitor_count,
      is_overbooked = (booked_count - v_visitor_count) > original_capacity
    WHERE id = v_old_slot_id_final;
  END IF;

  -- Reserve new slot capacity
  UPDATE slots
  SET 
    booked_count = booked_count + v_visitor_count,
    available_capacity = GREATEST(0, available_capacity - v_visitor_count),
    is_overbooked = (booked_count + v_visitor_count) > original_capacity
  WHERE id = p_new_slot_id;

  -- ============================================================================
  -- STEP 6: Invalidate old QR tokens (if any)
  -- QR token and qr_scanned are stored directly in bookings table
  -- ============================================================================
  -- This is handled in STEP 7 when we update the booking

  -- ============================================================================
  -- STEP 7: Update booking with new slot and price
  -- Also invalidate old QR tokens by clearing qr_token and marking as scanned
  -- ============================================================================
  UPDATE bookings
  SET 
    slot_id = p_new_slot_id,
    service_id = v_new_slot_record.service_id, -- Ensure service_id is synced
    total_price = v_new_price,
    qr_token = NULL, -- Clear QR token to invalidate old tickets
    qr_scanned = true, -- Mark as scanned to prevent reuse
    qr_scanned_at = now(), -- Record invalidation time
    qr_scanned_by_user_id = p_user_id, -- Record who invalidated
    updated_at = now()
  WHERE id = p_booking_id;

  -- ============================================================================
  -- STEP 8: Create audit log
  -- ============================================================================
  INSERT INTO audit_logs (
    tenant_id,
    user_id,
    action_type,
    resource_type,
    resource_id,
    old_values,
    new_values,
    created_at
  ) VALUES (
    p_tenant_id,
    p_user_id,
    'booking_time_edit',
    'booking',
    p_booking_id,
    jsonb_build_object(
      'old_slot_id', v_old_slot_id_final,
      'old_price', v_old_price,
      'old_service_id', v_booking_record.service_id
    ),
    jsonb_build_object(
      'new_slot_id', p_new_slot_id,
      'new_price', v_new_price,
      'new_service_id', v_new_slot_record.service_id,
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
    'price_changed', v_price_changed,
    'old_price', v_old_price,
    'new_price', v_new_price
  );
END;
$$;
