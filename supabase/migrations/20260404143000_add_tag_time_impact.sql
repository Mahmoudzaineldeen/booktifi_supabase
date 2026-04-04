-- Tag time impact (fixed minutes or multiplier) + booking occupancy snapshot
-- Backward compatible defaults keep current behavior unchanged.

ALTER TABLE public.tag_fees
  ADD COLUMN IF NOT EXISTS time_type text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS time_value numeric(10,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tag_fees_time_type_check'
      AND conrelid = 'public.tag_fees'::regclass
  ) THEN
    ALTER TABLE public.tag_fees
      ADD CONSTRAINT tag_fees_time_type_check
      CHECK (time_type IN ('fixed', 'multiplier'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tag_fees_time_value_check'
      AND conrelid = 'public.tag_fees'::regclass
  ) THEN
    ALTER TABLE public.tag_fees
      ADD CONSTRAINT tag_fees_time_value_check
      CHECK (
        (time_type = 'fixed' AND time_value >= 0) OR
        (time_type = 'multiplier' AND time_value >= 1)
      );
  END IF;
END
$$;

UPDATE public.tag_fees
SET
  time_type = COALESCE(NULLIF(time_type, ''), 'fixed'),
  time_value = COALESCE(time_value, 0);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS effective_start_time time,
  ADD COLUMN IF NOT EXISTS effective_end_time time,
  ADD COLUMN IF NOT EXISTS effective_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS required_slot_count integer NOT NULL DEFAULT 1;

UPDATE public.bookings b
SET
  effective_start_time = COALESCE(b.effective_start_time, s.start_time),
  effective_end_time = COALESCE(b.effective_end_time, s.end_time),
  effective_duration_minutes = COALESCE(
    b.effective_duration_minutes,
    GREATEST(
      1,
      CASE
        WHEN s.start_time IS NULL OR s.end_time IS NULL THEN 60
        WHEN s.end_time >= s.start_time THEN
          (EXTRACT(HOUR FROM s.end_time)::int * 60 + EXTRACT(MINUTE FROM s.end_time)::int) -
          (EXTRACT(HOUR FROM s.start_time)::int * 60 + EXTRACT(MINUTE FROM s.start_time)::int)
        ELSE
          ((EXTRACT(HOUR FROM s.end_time)::int * 60 + EXTRACT(MINUTE FROM s.end_time)::int) + 1440) -
          (EXTRACT(HOUR FROM s.start_time)::int * 60 + EXTRACT(MINUTE FROM s.start_time)::int)
      END
    )
  ),
  required_slot_count = COALESCE(NULLIF(b.required_slot_count, 0), 1)
FROM public.slots s
WHERE b.slot_id = s.id;

