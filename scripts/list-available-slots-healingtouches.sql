-- Available slots for Isabletia and Marivick, today, for tenant healingtouches_sa@hotmail.com
-- Matches the same logic as the app (bookingAvailability.ts):
--   - is_available = true, available_capacity > 0
--   - Exclude slots that have an active booking lock (lock_expires_at > now())
--   - Only slots whose shift allows this weekday (shift.days_of_week)
--   - For today: only slots with start_time > current time (future slots only)
--
-- Run in Supabase SQL Editor. For a specific date, replace CURRENT_DATE and drop the "today" filter if needed.

WITH tenant AS (
  SELECT id AS tenant_id
  FROM tenants
  WHERE contact_email = 'healingtouches_sa@hotmail.com'
  LIMIT 1
),
employees AS (
  SELECT u.id, u.full_name, u.full_name_ar
  FROM users u
  CROSS JOIN tenant t
  WHERE u.tenant_id = t.tenant_id
    AND u.role = 'employee'
    AND (u.full_name ILIKE '%Isabletia%' OR u.full_name ILIKE '%Marivick%'
         OR u.full_name_ar ILIKE '%Isabletia%' OR u.full_name_ar ILIKE '%Marivick%')
)
SELECT
  s.id AS slot_id,
  s.slot_date,
  s.start_time,
  s.end_time,
  s.available_capacity,
  s.booked_count,
  e.full_name,
  e.full_name_ar
FROM slots s
JOIN employees e ON e.id = s.employee_id
JOIN shifts sh ON sh.id = s.shift_id AND sh.is_active = true
CROSS JOIN tenant t
WHERE s.tenant_id = t.tenant_id
  AND s.employee_id IN (SELECT id FROM employees)
  AND s.slot_date = CURRENT_DATE
  AND s.is_available = true
  AND s.available_capacity > 0
  -- Shift must allow this weekday (0=Sun .. 6=Sat, same as app getDayOfWeekFromDateString)
  AND (EXTRACT(DOW FROM s.slot_date)::integer) = ANY(sh.days_of_week)
  -- Exclude slots that are currently locked (active booking lock)
  AND NOT EXISTS (
    SELECT 1 FROM booking_locks bl
    WHERE bl.slot_id = s.id AND bl.lock_expires_at > now()
  )
  -- For today only: show future slots (same as app: slot start time > current time).
  -- Session timezone should match app/user (e.g. set timezone in connection if needed).
  AND (s.slot_date <> CURRENT_DATE OR s.start_time > (CURRENT_TIMESTAMP)::time)
ORDER BY s.start_time;
