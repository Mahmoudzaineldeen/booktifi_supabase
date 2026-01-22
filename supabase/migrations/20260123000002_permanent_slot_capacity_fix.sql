/*
  # PERMANENT FIX: Slot Capacity Management
  
  ## Problem
  1. Bookings are created with status 'pending', but old triggers only reduce capacity for 'confirmed'
  2. When bookings are cancelled, capacity is only restored if status was 'confirmed', not 'pending'
  3. This causes slots to show incorrect availability
  
  ## Solution
  - Update trigger to reduce capacity for BOTH 'pending' AND 'confirmed' bookings
  - Update trigger to restore capacity when booking is cancelled from ANY status (pending or confirmed)
  - Ensure RPC function also updates capacity (backup)
  - Add function to recalculate all slot capacities
*/

-- ============================================================================
-- STEP 1: Fix the INSERT trigger to reduce capacity for pending AND confirmed
-- ============================================================================
CREATE OR REPLACE FUNCTION reduce_slot_capacity_on_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_capacity integer;
  v_updated_booked integer;
BEGIN
  -- CRITICAL: Reduce capacity for BOTH 'pending' AND 'confirmed' bookings
  -- Bookings should reduce capacity immediately when created, regardless of status
  IF NEW.status IN ('pending', 'confirmed') THEN
    -- Reduce the slot's available capacity and increment booked_count
    UPDATE slots
    SET 
      available_capacity = GREATEST(0, available_capacity - NEW.visitor_count),
      booked_count = booked_count + NEW.visitor_count
    WHERE id = NEW.slot_id
    RETURNING available_capacity, booked_count INTO v_updated_capacity, v_updated_booked;
    
    -- Log for debugging
    RAISE NOTICE '[TRIGGER] Reduced slot % capacity by % visitors. New capacity: %, booked: %', 
      NEW.slot_id, 
      NEW.visitor_count,
      v_updated_capacity,
      v_updated_booked;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- STEP 2: Fix the UPDATE trigger to restore capacity when cancelled from ANY status
-- ============================================================================
CREATE OR REPLACE FUNCTION restore_slot_capacity_on_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_capacity integer;
  v_updated_booked integer;
BEGIN
  -- CRITICAL FIX: Restore capacity when booking is cancelled from EITHER pending OR confirmed
  -- This ensures capacity is restored regardless of initial booking status
  IF OLD.status IN ('pending', 'confirmed') AND NEW.status = 'cancelled' THEN
    UPDATE slots
    SET 
      available_capacity = LEAST(original_capacity, available_capacity + OLD.visitor_count),
      booked_count = GREATEST(0, booked_count - OLD.visitor_count)
    WHERE id = OLD.slot_id
    RETURNING available_capacity, booked_count INTO v_updated_capacity, v_updated_booked;
    
    RAISE NOTICE '[TRIGGER] Restored slot % capacity by % visitors (booking cancelled). New capacity: %, booked: %', 
      OLD.slot_id, 
      OLD.visitor_count,
      v_updated_capacity,
      v_updated_booked;
  END IF;

  -- When booking is completed, also restore capacity (if it was pending or confirmed)
  IF OLD.status IN ('pending', 'confirmed') AND NEW.status = 'completed' THEN
    UPDATE slots
    SET 
      available_capacity = LEAST(original_capacity, available_capacity + OLD.visitor_count),
      booked_count = GREATEST(0, booked_count - OLD.visitor_count)
    WHERE id = OLD.slot_id
    RETURNING available_capacity, booked_count INTO v_updated_capacity, v_updated_booked;
    
    RAISE NOTICE '[TRIGGER] Restored slot % capacity by % visitors (booking completed). New capacity: %, booked: %', 
      OLD.slot_id, 
      OLD.visitor_count,
      v_updated_capacity,
      v_updated_booked;
  END IF;

  -- When booking changes from pending to confirmed, no change needed
  -- (capacity was already reduced when booking was created as pending)
  IF OLD.status = 'pending' AND NEW.status = 'confirmed' THEN
    RAISE NOTICE '[TRIGGER] Booking % confirmed (capacity already reduced on creation)', NEW.id;
  END IF;
  
  -- When booking changes from confirmed to pending (shouldn't happen, but handle it)
  IF OLD.status = 'confirmed' AND NEW.status = 'pending' THEN
    RAISE NOTICE '[TRIGGER] Booking % changed from confirmed to pending (capacity remains reduced)', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- STEP 3: Ensure triggers exist and are active
-- ============================================================================
DROP TRIGGER IF EXISTS trigger_reduce_slot_capacity_on_insert ON bookings;
CREATE TRIGGER trigger_reduce_slot_capacity_on_insert
  AFTER INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION reduce_slot_capacity_on_booking();

DROP TRIGGER IF EXISTS trigger_manage_slot_capacity_on_update ON bookings;
CREATE TRIGGER trigger_manage_slot_capacity_on_update
  AFTER UPDATE ON bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.visitor_count IS DISTINCT FROM NEW.visitor_count)
  EXECUTE FUNCTION restore_slot_capacity_on_booking();

-- ============================================================================
-- STEP 4: Add function to recalculate all slot capacities (for fixing existing data)
-- ============================================================================
CREATE OR REPLACE FUNCTION recalculate_all_slot_capacities()
RETURNS TABLE(
  slot_id uuid,
  slot_date date,
  start_time time,
  original_capacity integer,
  old_available_capacity integer,
  old_booked_count integer,
  new_available_capacity integer,
  new_booked_count integer,
  bookings_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH slot_bookings AS (
    SELECT 
      s.id as slot_id,
      s.original_capacity,
      s.available_capacity as old_available_capacity,
      s.booked_count as old_booked_count,
      COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0) as total_booked
    FROM slots s
    LEFT JOIN bookings b ON b.slot_id = s.id
    GROUP BY s.id, s.original_capacity, s.available_capacity, s.booked_count
  )
  UPDATE slots s
  SET 
    available_capacity = GREATEST(0, sb.original_capacity - sb.total_booked),
    booked_count = sb.total_booked
  FROM slot_bookings sb
  WHERE s.id = sb.slot_id
  RETURNING 
    s.id,
    s.slot_date,
    s.start_time,
    s.original_capacity,
    sb.old_available_capacity,
    sb.old_booked_count,
    s.available_capacity,
    s.booked_count,
    (SELECT COUNT(*) FROM bookings WHERE slot_id = s.id AND status IN ('pending', 'confirmed'))::bigint;
END;
$$;

-- ============================================================================
-- STEP 5: Update comments
-- ============================================================================
COMMENT ON FUNCTION reduce_slot_capacity_on_booking IS 'Reduces slot available_capacity when a booking is created (pending or confirmed). This ensures capacity is reduced immediately.';
COMMENT ON FUNCTION restore_slot_capacity_on_booking IS 'Manages slot capacity when booking status changes. Restores capacity when cancelled or completed from pending or confirmed status.';
COMMENT ON FUNCTION recalculate_all_slot_capacities IS 'Recalculates all slot capacities based on actual bookings. Use this to fix existing data after trigger updates.';

-- ============================================================================
-- STEP 6: Run the recalculation to fix existing data
-- ============================================================================
DO $$
DECLARE
  v_fixed_count integer;
BEGIN
  -- Recalculate all slot capacities
  PERFORM recalculate_all_slot_capacities();
  GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed capacity for % slots', v_fixed_count;
END;
$$;
