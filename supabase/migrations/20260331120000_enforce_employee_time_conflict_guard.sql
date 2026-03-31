-- Enforce global employee time lock at DB level.
-- Prevent an employee from having two non-cancelled bookings that overlap
-- on the same date, even when bookings come from different services.

CREATE OR REPLACE FUNCTION public.prevent_employee_time_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_slot_date date;
  v_new_start time;
  v_new_end time;
  v_effective_employee_id uuid;
  v_conflict_booking_id uuid;
BEGIN
  -- Ignore rows that do not participate in assignment lock rules.
  IF NEW.slot_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT s.slot_date, s.start_time, s.end_time, COALESCE(NEW.employee_id, s.employee_id)
  INTO v_new_slot_date, v_new_start, v_new_end, v_effective_employee_id
  FROM slots s
  WHERE s.id = NEW.slot_id;

  IF v_new_slot_date IS NULL THEN
    RAISE EXCEPTION 'Slot % not found for booking validation', NEW.slot_id
      USING ERRCODE = '23503';
  END IF;

  IF v_effective_employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize checks for the same tenant+employee+date to avoid race conditions.
  PERFORM pg_advisory_xact_lock(hashtext(
    COALESCE(NEW.tenant_id::text, '') || ':' ||
    v_effective_employee_id::text || ':' ||
    v_new_slot_date::text
  ));

  SELECT b.id
  INTO v_conflict_booking_id
  FROM bookings b
  JOIN slots s ON s.id = b.slot_id
  WHERE b.tenant_id = NEW.tenant_id
    AND COALESCE(b.employee_id, s.employee_id) = v_effective_employee_id
    AND b.status <> 'cancelled'
    AND b.id <> NEW.id
    AND s.slot_date = v_new_slot_date
    AND s.start_time < v_new_end
    AND s.end_time > v_new_start
  LIMIT 1;

  IF v_conflict_booking_id IS NOT NULL THEN
    RAISE EXCEPTION 'Employee % is already booked in overlapping time window (% to %). Conflicting booking: %',
      v_effective_employee_id,
      v_new_start,
      v_new_end,
      v_conflict_booking_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_employee_time_overlap ON bookings;

CREATE TRIGGER trg_prevent_employee_time_overlap
BEFORE INSERT OR UPDATE OF employee_id, slot_id, status
ON bookings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_employee_time_overlap();
