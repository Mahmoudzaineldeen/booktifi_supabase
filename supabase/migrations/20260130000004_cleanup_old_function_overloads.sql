/*
  # Cleanup Old Function Overloads
  
  Removes old versions of create_booking_with_lock that don't have
  p_package_subscription_id parameter. Keeps only the 18-parameter version.
  
  NOTE: This is optional - PostgreSQL handles multiple overloads fine,
  but cleaning up keeps things tidy.
*/

-- Drop old versions of create_booking_with_lock (15 and 17 parameters)
-- Keep only the 18-parameter version with p_package_subscription_id

-- Drop 15-parameter version (without adult_count/child_count and package_subscription_id)
DROP FUNCTION IF EXISTS public.create_booking_with_lock(
  uuid, uuid, uuid, text, text, text, integer, numeric, text, uuid, uuid, text, uuid, uuid, text
) CASCADE;

-- Drop 17-parameter version (with adult_count/child_count but without package_subscription_id)
DROP FUNCTION IF EXISTS public.create_booking_with_lock(
  uuid, uuid, uuid, text, text, text, integer, integer, integer, numeric, text, uuid, uuid, text, uuid, uuid, text
) CASCADE;

-- Keep the 18-parameter version (with p_package_subscription_id)
-- This is the one we want to keep, so we don't drop it

COMMENT ON FUNCTION public.create_booking_with_lock(
  uuid, uuid, uuid, text, text, text, integer, integer, integer, 
  numeric, text, uuid, uuid, text, uuid, uuid, text, uuid
) IS 'Creates a booking with lock validation. Supports package subscriptions via p_package_subscription_id parameter.';
