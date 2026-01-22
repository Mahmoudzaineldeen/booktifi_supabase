-- ============================================================================
-- Edit Booking Time Function (Atomic Transaction)
-- ============================================================================
-- This migration creates the edit_booking_time function which allows
-- tenant providers to edit booking time with strict transactional integrity
-- ============================================================================

-- ============================================================================
-- Edit Booking Time Function (Atomic Transaction)
-- ============================================================================
-- This function allows tenant providers to edit booking time with strict
-- transactional integrity:
-- 1. Validates new slot availability
-- 2. Releases old slot capacity
-- 3. Reserves new slot capacity
-- 4. Invalidates old tickets (marks qr_scanned = true, clears qr_token)
-- 5. Updates booking with new slot
-- 6. All in one atomic transaction
-- ============================================================================

CREATE OR REPLACE FUNCTION public.edit_booking_time(
  p_booking_id uuid,
  p_new_slot_id uuid,
  p_tenant_id uuid,
  p_user_id uuid,
  p_old_slot_id uuid DEFAULT NULL -- Optional: for validation
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
    adult_count,
    child_count,
    total_price,
    status,
    payment_status,
    customer_name,
    customer_phone,
    customer_email,
    qr_token,
    qr_scanned,
    language,
    booking_group_id
  INTO v_booking_record
  FROM bookings
  WHERE id = p_booking_id
    AND tenant_id = p_tenant_id
  FOR UPDATE; -- Lock booking to prevent concurrent modifications

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found or does not belong to tenant';
  END IF;

  -- Prevent editing cancelled or completed bookings
  IF v_booking_record.status IN ('cancelled', 'completed', 'no_show') THEN
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
    id,
    tenant_id,
    service_id,
    remaining_capacity,
    total_capacity,
    is_available
  INTO v_new_slot_record
  FROM time_slots
  WHERE id = p_new_slot_id
  FOR UPDATE; -- Lock new slot to prevent concurrent modifications

  IF NOT FOUND THEN
    RAISE EXCEPTION 'New slot not found';
  END IF;

  -- Verify new slot belongs to same tenant and service
  IF v_new_slot_record.tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'New slot belongs to a different tenant';
  END IF;

  IF v_new_slot_record.service_id != v_booking_record.service_id THEN
    RAISE EXCEPTION 'New slot belongs to a different service. Cannot change service when rescheduling.';
  END IF;

  -- Check if new slot is available
  IF NOT v_new_slot_record.is_available THEN
    RAISE EXCEPTION 'Selected time slot is not available';
  END IF;

  -- Calculate available capacity (excluding locks)
  SELECT COALESCE(SUM(reserved_capacity), 0)
  INTO v_locked_capacity
  FROM booking_locks
  WHERE slot_id = p_new_slot_id
    AND lock_expires_at > now();

  v_available_capacity := v_new_slot_record.remaining_capacity - v_locked_capacity;

  -- Check if new slot has enough capacity
  IF v_available_capacity < v_visitor_count THEN
    RAISE EXCEPTION 'Not enough capacity. Slot has % available, but booking requires %',
      v_available_capacity, v_visitor_count;
  END IF;

  -- ============================================================================
  -- STEP 3: Get old slot (if different) and validate it can be released
  -- ============================================================================
  IF v_old_slot_id_final != p_new_slot_id THEN
    SELECT 
      id,
      tenant_id,
      remaining_capacity,
      total_capacity
    INTO v_old_slot_record
    FROM time_slots
    WHERE id = v_old_slot_id_final
    FOR UPDATE; -- Lock old slot

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Old slot not found';
    END IF;

    -- Verify old slot belongs to tenant
    IF v_old_slot_record.tenant_id != p_tenant_id THEN
      RAISE EXCEPTION 'Old slot belongs to a different tenant';
    END IF;
  END IF;

  -- ============================================================================
  -- STEP 4: Calculate new price (if service pricing differs by time)
  -- Note: This is a placeholder - actual price calculation should be done
  -- based on your business logic (service pricing, time-based pricing, etc.)
  -- ============================================================================
  -- For now, keep the same price unless explicitly changed
  -- You can extend this to calculate price based on slot/service pricing
  v_new_price := v_old_price;
  v_price_changed := false;

  -- ============================================================================
  -- STEP 5: ATOMIC TRANSACTION - All changes happen here
  -- ============================================================================
  
  -- 5a. Release old slot capacity (if slot changed)
  -- Note: time_slots table uses remaining_capacity, not available_capacity
  IF v_old_slot_id_final != p_new_slot_id THEN
    UPDATE time_slots
    SET 
      remaining_capacity = LEAST(total_capacity, remaining_capacity + v_visitor_count)
    WHERE id = v_old_slot_id_final;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Failed to release old slot capacity';
    END IF;
  END IF;

  -- 5b. Reserve new slot capacity
  -- Note: time_slots table uses remaining_capacity, not available_capacity
  UPDATE time_slots
  SET 
    remaining_capacity = GREATEST(0, remaining_capacity - v_visitor_count)
  WHERE id = p_new_slot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to reserve new slot capacity';
  END IF;

  -- 5c. Invalidate old tickets (mark as scanned, clear QR token)
  -- This makes old QR codes unusable for entry validation
  UPDATE bookings
  SET 
    slot_id = p_new_slot_id,
    total_price = v_new_price,
    qr_token = NULL, -- Clear QR token to invalidate old tickets
    qr_scanned = true, -- Mark as scanned to prevent reuse
    qr_scanned_at = now(), -- Record invalidation time
    qr_scanned_by_user_id = p_user_id, -- Record who invalidated
    updated_at = now()
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update booking';
  END IF;

  -- 5d. Create audit log entry
  INSERT INTO audit_logs (
    tenant_id,
    user_id,
    action_type,
    resource_type,
    resource_id,
    old_values,
    new_values
  ) VALUES (
    p_tenant_id,
    p_user_id,
    'booking_time_edit',
    'booking',
    p_booking_id,
    jsonb_build_object(
      'slot_id', v_old_slot_id_final,
      'total_price', v_old_price,
      'qr_token', v_booking_record.qr_token,
      'qr_scanned', v_booking_record.qr_scanned
    ),
    jsonb_build_object(
      'slot_id', p_new_slot_id,
      'total_price', v_new_price,
      'qr_token', NULL,
      'qr_scanned', true,
      'qr_scanned_at', now()
    )
  );

  -- ============================================================================
  -- STEP 6: Return success with booking details
  -- ============================================================================
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'old_slot_id', v_old_slot_id_final,
    'new_slot_id', p_new_slot_id,
    'old_price', v_old_price,
    'new_price', v_new_price,
    'price_changed', v_price_changed,
    'visitor_count', v_visitor_count,
    'tickets_invalidated', true,
    'message', 'Booking time updated successfully. Old tickets invalidated. New tickets must be generated.'
  );
END;
$$;

ALTER FUNCTION public.edit_booking_time(
  uuid, uuid, uuid, uuid, uuid
) OWNER TO postgres;

COMMENT ON FUNCTION public.edit_booking_time IS 'Atomically edits booking time: validates availability, releases old slot, reserves new slot, invalidates old tickets. All in one transaction. Only tenant providers can use this function.';
