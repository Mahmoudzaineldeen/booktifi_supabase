/*
  # Fix Existing Slot Capacity
  
  ## Purpose
  Recalculates slot capacity for existing bookings that were created
  before the trigger fix. This ensures all slots have correct capacity
  values based on actual bookings.
  
  ## How It Works
  1. For each slot, count all pending/confirmed bookings
  2. Update available_capacity = original_capacity - total_booked
  3. Update booked_count = total_booked
*/

-- Fix existing slots that may have incorrect capacity
UPDATE slots s
SET 
  available_capacity = GREATEST(0, 
    s.original_capacity - COALESCE((
      SELECT SUM(b.visitor_count)
      FROM bookings b
      WHERE b.slot_id = s.id
        AND b.status IN ('pending', 'confirmed')
    ), 0)
  ),
  booked_count = COALESCE((
    SELECT SUM(b.visitor_count)
    FROM bookings b
    WHERE b.slot_id = s.id
      AND b.status IN ('pending', 'confirmed')
  ), 0)
WHERE EXISTS (
  SELECT 1
  FROM bookings b
  WHERE b.slot_id = s.id
    AND b.status IN ('pending', 'confirmed')
);

-- Log the fix
DO $$
DECLARE
  v_fixed_count integer;
BEGIN
  GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed capacity for % slots', v_fixed_count;
END;
$$;
