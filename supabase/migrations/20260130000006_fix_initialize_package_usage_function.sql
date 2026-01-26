/*
  # Fix initialize_package_usage Function
  
  Updates the trigger function to use capacity_total instead of quantity
  (which was renamed in migration 20260130000000_redesign_package_capacity_system.sql)
*/

-- Update the function to use capacity_total instead of quantity
CREATE OR REPLACE FUNCTION initialize_package_usage()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert usage records for all services in the package
  INSERT INTO package_subscription_usage (subscription_id, service_id, original_quantity, remaining_quantity, used_quantity)
  SELECT 
    NEW.id,
    ps.service_id,
    ps.capacity_total,
    ps.capacity_total,
    0
  FROM package_services ps
  WHERE ps.package_id = NEW.package_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS initialize_subscription_usage ON package_subscriptions;

CREATE TRIGGER initialize_subscription_usage
  AFTER INSERT ON package_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION initialize_package_usage();

COMMENT ON FUNCTION initialize_package_usage() IS 
  'Automatically creates package_subscription_usage records when a new subscription is created. Uses capacity_total from package_services.';
