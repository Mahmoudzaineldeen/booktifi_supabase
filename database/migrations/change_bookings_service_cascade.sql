-- ============================================================================
-- MIGRATION: Change bookings.service_id to CASCADE delete
-- ============================================================================
-- This migration changes the foreign key constraint on bookings.service_id
-- from ON DELETE RESTRICT to ON DELETE CASCADE, allowing services to be
-- deleted along with their associated bookings.
-- ============================================================================

-- Step 1: Drop the existing foreign key constraint
ALTER TABLE bookings
DROP CONSTRAINT IF EXISTS bookings_service_id_fkey;

-- Step 2: Recreate the foreign key constraint with CASCADE
ALTER TABLE bookings
ADD CONSTRAINT bookings_service_id_fkey
FOREIGN KEY (service_id)
REFERENCES services(id)
ON DELETE CASCADE;

-- Verify the change
DO $$
BEGIN
  RAISE NOTICE '✅ Successfully changed bookings.service_id to CASCADE delete';
END $$;

