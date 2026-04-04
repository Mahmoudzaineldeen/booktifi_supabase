-- Switch tag time-impact to slots-only model.
-- Keeps compatibility with existing records and schema states.

ALTER TABLE public.tag_fees
  ADD COLUMN IF NOT EXISTS slot_count integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tag_fees_slot_count_check'
      AND conrelid = 'public.tag_fees'::regclass
  ) THEN
    ALTER TABLE public.tag_fees
      ADD CONSTRAINT tag_fees_slot_count_check CHECK (slot_count >= 1);
  END IF;
END
$$;

UPDATE public.tag_fees
SET slot_count = CASE
  WHEN slot_count IS NULL OR slot_count < 1 THEN 1
  ELSE slot_count
END;

