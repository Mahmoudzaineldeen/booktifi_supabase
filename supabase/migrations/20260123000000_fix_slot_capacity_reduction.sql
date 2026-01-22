/*
  # Fix Slot Capacity Reduction on Booking
  
  ## Problem
  Bookings are created with status 'pending', but the trigger only reduces
  slot capacity when status is 'confirmed'. This means slot capacity is not
  reduced when bookings are created.
  
  ## Solution
  Update the trigger to reduce capacity for both 'pending' and 'confirmed' bookings.
  Capacity should be reduced immediately when a booking is created, regardless
  of initial status. It should only be restored if the booking is cancelled.
*/

-- Function to reduce slot capacity when booking is created (pending or confirmed)
CREATE OR REPLACE FUNCTION reduce_slot_capacity_on_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Reduce capacity for both 'pending' and 'confirmed' bookings
  -- Bookings should reduce capacity immediately when created
  IF NEW.status IN ('pending', 'confirmed') THEN
    -- Reduce the slot's available capacity and increment booked_count
    UPDATE slots
    SET 
      available_capacity = GREATEST(0, available_capacity - NEW.visitor_count),
      booked_count = booked_count + NEW.visitor_count
    WHERE id = NEW.slot_id;
    
    RAISE NOTICE 'Reduced slot % capacity by % (new capacity: %, booked: %)', 
      NEW.slot_id, 
      NEW.visitor_count,
      (SELECT available_capacity FROM slots WHERE id = NEW.slot_id),
      (SELECT booked_count FROM slots WHERE id = NEW.slot_id);
  END IF;

  RETURN NEW;
END;
$$;

-- Function to restore slot capacity when booking status changes
CREATE OR REPLACE FUNCTION restore_slot_capacity_on_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- When booking is cancelled or completed, restore capacity
  -- Only restore if the booking was previously pending or confirmed
  IF OLD.status IN ('pending', 'confirmed') AND NEW.status IN ('cancelled', 'completed', 'no_show') THEN
    UPDATE slots
    SET 
      available_capacity = LEAST(original_capacity, available_capacity + OLD.visitor_count),
      booked_count = GREATEST(0, booked_count - OLD.visitor_count)
    WHERE id = OLD.slot_id;
    
    RAISE NOTICE 'Restored slot % capacity by % (booking cancelled/completed)', 
      OLD.slot_id, 
      OLD.visitor_count;
  END IF;

  -- When booking changes from pending to confirmed, no change needed
  -- (capacity was already reduced when booking was created as pending)
  -- But we should ensure capacity is correct in case of any inconsistencies
  IF OLD.status = 'pending' AND NEW.status = 'confirmed' THEN
    -- Verify capacity is correct (should already be reduced, but ensure consistency)
    -- No action needed - capacity was already reduced on insert
    RAISE NOTICE 'Booking % confirmed (capacity already reduced on creation)', NEW.id;
  END IF;
  
  -- When booking changes from confirmed to pending (shouldn't happen, but handle it)
  IF OLD.status = 'confirmed' AND NEW.status = 'pending' THEN
    -- Capacity should remain reduced (no change needed)
    RAISE NOTICE 'Booking % changed from confirmed to pending (capacity remains reduced)', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure triggers exist and are active
DROP TRIGGER IF EXISTS trigger_reduce_slot_capacity_on_insert ON bookings;
CREATE TRIGGER trigger_reduce_slot_capacity_on_insert
  AFTER INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION reduce_slot_capacity_on_booking();

DROP TRIGGER IF EXISTS trigger_manage_slot_capacity_on_update ON bookings;
CREATE TRIGGER trigger_manage_slot_capacity_on_update
  AFTER UPDATE ON bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION restore_slot_capacity_on_booking();

COMMENT ON FUNCTION reduce_slot_capacity_on_booking IS 'Reduces slot available_capacity when a booking is created (pending or confirmed)';
COMMENT ON FUNCTION restore_slot_capacity_on_booking IS 'Manages slot capacity when booking status changes, restoring capacity when cancelled/completed';
