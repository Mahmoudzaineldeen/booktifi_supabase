-- ============================================================================
-- Booking Lock Functions
-- ============================================================================

-- Function to acquire a booking lock atomically
-- Parameters:
--   p_slot_id: UUID of the slot to lock
--   p_session_id: Session identifier (user ID or anonymous session)
--   p_reserved_capacity: Number of tickets/capacity to reserve
--   p_lock_duration_seconds: How long the lock should last (default 120 seconds)
-- Returns: UUID of the created lock, or NULL if lock could not be acquired
CREATE OR REPLACE FUNCTION acquire_booking_lock(
  p_slot_id uuid,
  p_session_id text,
  p_reserved_capacity integer,
  p_lock_duration_seconds integer DEFAULT 120
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_slot_record RECORD;
  v_locked_capacity integer;
  v_available_capacity integer;
  v_lock_id uuid;
BEGIN
  -- Lock the slot row to prevent concurrent modifications
  -- Use slots table (the table that booking_locks references via foreign key)
  SELECT 
    id,
    available_capacity,
    is_available,
    original_capacity
  INTO v_slot_record
  FROM slots
  WHERE id = p_slot_id
  FOR UPDATE;
  
  -- Check if slot exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot not found';
  END IF;
  
  -- Check if slot is available
  IF NOT v_slot_record.is_available THEN
    RAISE EXCEPTION 'Slot is not available';
  END IF;
  
  -- Calculate currently locked capacity (from active locks)
  SELECT COALESCE(SUM(reserved_capacity), 0)
  INTO v_locked_capacity
  FROM booking_locks
  WHERE slot_id = p_slot_id
    AND lock_expires_at > now();
  
  -- Calculate available capacity (available - locked)
  v_available_capacity := v_slot_record.available_capacity - v_locked_capacity;
  
  -- Check if there's enough capacity
  IF v_available_capacity < p_reserved_capacity THEN
    RAISE EXCEPTION 'Not enough tickets available. Only % available, but % requested.', 
      v_available_capacity, p_reserved_capacity;
  END IF;
  
  -- Create the lock
  INSERT INTO booking_locks (
    slot_id,
    reserved_by_session_id,
    reserved_capacity,
    lock_expires_at
  ) VALUES (
    p_slot_id,
    p_session_id,
    p_reserved_capacity,
    now() + (p_lock_duration_seconds || ' seconds')::interval
  )
  RETURNING id INTO v_lock_id;
  
  RETURN v_lock_id;
END;
$$;

-- Function to validate a booking lock is still active
CREATE OR REPLACE FUNCTION validate_booking_lock(
  p_lock_id uuid,
  p_session_id text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_lock_record RECORD;
BEGIN
  SELECT 
    id,
    slot_id,
    reserved_by_session_id,
    reserved_capacity,
    lock_expires_at
  INTO v_lock_record
  FROM booking_locks
  WHERE id = p_lock_id;
  
  -- Check if lock exists
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Check if lock is expired
  IF v_lock_record.lock_expires_at <= now() THEN
    RETURN false;
  END IF;
  
  -- Check if session matches
  IF v_lock_record.reserved_by_session_id != p_session_id THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$;

-- Function to get active locks for multiple slots (for filtering unavailable slots)
CREATE OR REPLACE FUNCTION get_active_locks_for_slots(
  p_slot_ids uuid[]
) RETURNS TABLE (
  slot_id uuid,
  total_locked_capacity integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bl.slot_id,
    COALESCE(SUM(bl.reserved_capacity), 0)::integer as total_locked_capacity
  FROM booking_locks bl
  WHERE bl.slot_id = ANY(p_slot_ids)
    AND bl.lock_expires_at > now()
  GROUP BY bl.slot_id;
END;
$$;

-- Function to cleanup expired locks (can be called periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_locks()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM booking_locks
  WHERE lock_expires_at <= now();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_booking_locks_slot_id ON booking_locks(slot_id);
CREATE INDEX IF NOT EXISTS idx_booking_locks_expires_at ON booking_locks(lock_expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_locks_session_id ON booking_locks(reserved_by_session_id);

-- Create a composite index for common queries
CREATE INDEX IF NOT EXISTS idx_booking_locks_slot_expires ON booking_locks(slot_id, lock_expires_at);

