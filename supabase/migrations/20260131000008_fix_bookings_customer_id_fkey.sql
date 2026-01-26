/*
  # Fix bookings.customer_id foreign key constraint
  
  The bookings.customer_id should reference customers(id), not users(id).
  This migration fixes the foreign key constraint to point to the correct table.
*/

-- Drop the existing foreign key constraint if it exists (regardless of what it references)
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_customer_id_fkey;

-- Clean up invalid customer_id references before adding the constraint
-- Set customer_id to NULL for any bookings that reference non-existent customers
DO $$
DECLARE
  invalid_count integer;
BEGIN
  -- Check if customers table exists
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'customers') THEN
    -- Check if customer_id column exists in bookings
    IF EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'bookings' 
      AND column_name = 'customer_id'
    ) THEN
      -- Find and fix invalid customer_id references
      UPDATE bookings
      SET customer_id = NULL
      WHERE customer_id IS NOT NULL
        AND customer_id NOT IN (SELECT id FROM customers);
      
      GET DIAGNOSTICS invalid_count = ROW_COUNT;
      
      IF invalid_count > 0 THEN
        RAISE NOTICE 'Cleaned up % invalid customer_id references in bookings table', invalid_count;
      END IF;
      
      -- Now add the correct foreign key constraint
      ALTER TABLE bookings 
        ADD CONSTRAINT bookings_customer_id_fkey 
        FOREIGN KEY (customer_id) 
        REFERENCES customers(id) 
        ON DELETE SET NULL;
      
      -- Add comment
      COMMENT ON COLUMN bookings.customer_id IS 'References the customer record. NULL for guest bookings.';
      
      RAISE NOTICE 'Successfully added foreign key constraint bookings_customer_id_fkey';
    END IF;
  END IF;
END $$;
