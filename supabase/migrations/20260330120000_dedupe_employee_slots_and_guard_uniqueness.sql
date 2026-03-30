-- Dedupe employee slot rows safely and prevent future duplicates.
-- Scope: employee-based slots (employee_id IS NOT NULL).
--
-- Why:
-- Historical duplicate rows for the same employee/time inflate payloads and can hide
-- later time windows due to PostgREST default row limits.
--
-- Safety strategy:
-- 1) Pick one canonical slot per (shift_id, employee_id, slot_date, start_time, end_time).
-- 2) Repoint bookings + booking_locks to canonical slot IDs.
-- 3) Delete duplicate slot rows only when no references remain.
-- 4) Recompute booked_count / available_capacity / is_available for affected slots.
-- 5) Add a unique partial index so duplicates cannot be inserted again for employee slots.

-- 1) Build duplicate mapping (canonical keep_id + duplicate dup_id)
WITH ranked AS (
  SELECT
    s.id,
    s.shift_id,
    s.employee_id,
    s.slot_date,
    s.start_time,
    s.end_time,
    s.available_capacity,
    s.booked_count,
    s.created_at,
    FIRST_VALUE(s.id) OVER (
      PARTITION BY s.shift_id, s.employee_id, s.slot_date, s.start_time, s.end_time
      ORDER BY
        CASE WHEN COALESCE(s.booked_count, 0) > 0 THEN 1 ELSE 0 END DESC,
        COALESCE(s.booked_count, 0) DESC,
        s.created_at ASC,
        s.id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.shift_id, s.employee_id, s.slot_date, s.start_time, s.end_time
      ORDER BY
        CASE WHEN COALESCE(s.booked_count, 0) > 0 THEN 1 ELSE 0 END DESC,
        COALESCE(s.booked_count, 0) DESC,
        s.created_at ASC,
        s.id ASC
    ) AS rn
  FROM slots s
  WHERE s.employee_id IS NOT NULL
),
to_merge AS (
  SELECT id AS dup_id, keep_id
  FROM ranked
  WHERE rn > 1 AND id <> keep_id
)
UPDATE bookings b
SET slot_id = tm.keep_id
FROM to_merge tm
WHERE b.slot_id = tm.dup_id
  AND b.slot_id <> tm.keep_id;

-- 2) Repoint booking_locks as well (active locks and historical locks).
WITH ranked AS (
  SELECT
    s.id,
    s.shift_id,
    s.employee_id,
    s.slot_date,
    s.start_time,
    s.end_time,
    FIRST_VALUE(s.id) OVER (
      PARTITION BY s.shift_id, s.employee_id, s.slot_date, s.start_time, s.end_time
      ORDER BY
        CASE WHEN COALESCE(s.booked_count, 0) > 0 THEN 1 ELSE 0 END DESC,
        COALESCE(s.booked_count, 0) DESC,
        s.created_at ASC,
        s.id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.shift_id, s.employee_id, s.slot_date, s.start_time, s.end_time
      ORDER BY
        CASE WHEN COALESCE(s.booked_count, 0) > 0 THEN 1 ELSE 0 END DESC,
        COALESCE(s.booked_count, 0) DESC,
        s.created_at ASC,
        s.id ASC
    ) AS rn
  FROM slots s
  WHERE s.employee_id IS NOT NULL
),
to_merge AS (
  SELECT id AS dup_id, keep_id
  FROM ranked
  WHERE rn > 1 AND id <> keep_id
)
UPDATE booking_locks bl
SET slot_id = tm.keep_id
FROM to_merge tm
WHERE bl.slot_id = tm.dup_id
  AND bl.slot_id <> tm.keep_id;

-- 3) Delete duplicate slot rows (only when no references remain).
WITH ranked AS (
  SELECT
    s.id,
    s.shift_id,
    s.employee_id,
    s.slot_date,
    s.start_time,
    s.end_time,
    FIRST_VALUE(s.id) OVER (
      PARTITION BY s.shift_id, s.employee_id, s.slot_date, s.start_time, s.end_time
      ORDER BY
        CASE WHEN COALESCE(s.booked_count, 0) > 0 THEN 1 ELSE 0 END DESC,
        COALESCE(s.booked_count, 0) DESC,
        s.created_at ASC,
        s.id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.shift_id, s.employee_id, s.slot_date, s.start_time, s.end_time
      ORDER BY
        CASE WHEN COALESCE(s.booked_count, 0) > 0 THEN 1 ELSE 0 END DESC,
        COALESCE(s.booked_count, 0) DESC,
        s.created_at ASC,
        s.id ASC
    ) AS rn
  FROM slots s
  WHERE s.employee_id IS NOT NULL
),
to_delete AS (
  SELECT id AS dup_id
  FROM ranked
  WHERE rn > 1
)
DELETE FROM slots s
USING to_delete td
WHERE s.id = td.dup_id
  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM booking_locks bl WHERE bl.slot_id = s.id);

-- 4) Recompute counters on affected employee slots (safe and idempotent).
WITH counts AS (
  SELECT
    s.id AS slot_id,
    COUNT(b.id) FILTER (WHERE b.status <> 'cancelled') AS non_cancelled_count
  FROM slots s
  LEFT JOIN bookings b ON b.slot_id = s.id
  WHERE s.employee_id IS NOT NULL
  GROUP BY s.id
)
UPDATE slots s
SET
  booked_count = COALESCE(c.non_cancelled_count, 0),
  available_capacity = GREATEST(
    0,
    COALESCE(
      s.original_capacity,
      GREATEST(COALESCE(s.available_capacity, 0) + COALESCE(s.booked_count, 0), 1)
    ) - COALESCE(c.non_cancelled_count, 0)
  ),
  is_available = (
    GREATEST(
      0,
      COALESCE(
        s.original_capacity,
        GREATEST(COALESCE(s.available_capacity, 0) + COALESCE(s.booked_count, 0), 1)
      ) - COALESCE(c.non_cancelled_count, 0)
    ) > 0
  )
FROM counts c
WHERE s.id = c.slot_id
  AND s.employee_id IS NOT NULL;

-- 5) Prevent future duplicates for employee slots.
CREATE UNIQUE INDEX IF NOT EXISTS slots_employee_unique_shift_time_idx
ON slots (shift_id, employee_id, slot_date, start_time, end_time)
WHERE employee_id IS NOT NULL;

