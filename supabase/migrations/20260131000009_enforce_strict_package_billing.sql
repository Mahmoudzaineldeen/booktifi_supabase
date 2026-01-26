/*
  # Enforce Strict Package Billing Logic
  
  Adds helper column and ensures proper billing enforcement.
  This migration adds a computed column to help identify fully package-covered bookings.
*/

-- Add is_fully_package_covered computed column (for easier querying)
-- This is a virtual column that can be computed from package_covered_quantity and visitor_count
-- We'll use a function or check in application logic instead of a computed column
-- (PostgreSQL doesn't support computed columns directly, so we'll handle this in application logic)

-- Add comment to clarify billing rules
COMMENT ON COLUMN bookings.package_covered_quantity IS 
  'Number of tickets covered by package subscription. Must be <= visitor_count. If package_covered_quantity = visitor_count, booking is fully covered and NO invoice should be created.';

COMMENT ON COLUMN bookings.paid_quantity IS 
  'Number of tickets that must be paid for. Must be <= visitor_count. Sum with package_covered_quantity should equal visitor_count. Invoice MUST be created ONLY if paid_quantity > 0.';

COMMENT ON COLUMN bookings.total_price IS 
  'Total price for the booking. For package-covered bookings, this should be 0 or the price for paid_quantity only. Invoice MUST NOT be created if total_price = 0.';

-- Add check constraint to ensure total_price is 0 when fully covered by package
-- This enforces: if package_covered_quantity = visitor_count, then total_price must be 0
DO $$
BEGIN
  -- Check if constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'bookings_package_price_check'
  ) THEN
    ALTER TABLE bookings 
    ADD CONSTRAINT bookings_package_price_check 
    CHECK (
      -- If fully covered by package (package_covered_quantity = visitor_count), total_price must be 0
      (package_covered_quantity < visitor_count) OR (total_price = 0)
    );
    
    COMMENT ON CONSTRAINT bookings_package_price_check ON bookings IS 
      'Ensures that fully package-covered bookings have total_price = 0. This prevents invoicing for free bookings.';
  END IF;
END $$;
