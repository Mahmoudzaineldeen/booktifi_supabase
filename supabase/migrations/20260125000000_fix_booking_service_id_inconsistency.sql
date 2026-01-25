-- ============================================================================
-- Fix Booking Service ID Inconsistency
-- ============================================================================
-- This migration fixes bookings where service_id doesn't match their slot's shift's service_id
-- 
-- Root Cause:
-- - Shifts can be reassigned to different services
-- - When this happens, existing bookings' service_id is not updated
-- - This causes validation failures when trying to change booking time
-- ============================================================================

-- Step 1: Fix existing bookings with inconsistent service_id
-- Update bookings where service_id doesn't match their slot's shift's service_id
UPDATE bookings b
SET 
  service_id = sh.service_id,
  updated_at = now()
FROM slots s
JOIN shifts sh ON s.shift_id = sh.id
WHERE b.slot_id = s.id
  AND b.service_id != sh.service_id
  AND b.status NOT IN ('cancelled', 'completed');

-- Log how many were fixed
DO $$
DECLARE
  v_fixed_count integer;
BEGIN
  GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % bookings with inconsistent service_id', v_fixed_count;
END $$;

-- Step 2: Update edit_booking_time function to sync service_id automatically
-- This prevents future inconsistencies when changing booking time
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
  -- STEP 7: Update booking with new slot and price
  -- ============================================================================
  UPDATE bookings
  SET 
    slot_id = p_new_slot_id,
    service_id = v_new_slot_record.service_id, -- Ensure service_id is synced
    total_price = v_new_price,
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

-- Add comment
COMMENT ON FUNCTION public.edit_booking_time IS 
  'Atomically updates booking time slot. Automatically syncs booking.service_id with slot''s shift.service_id to prevent data inconsistencies.';
