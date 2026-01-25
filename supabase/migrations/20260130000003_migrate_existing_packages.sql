/*
  # Migrate Existing Packages to New Capacity System
  
  This migration ensures backward compatibility with existing packages:
  1. Renames quantity to capacity_total (if not already done)
  2. Ensures all existing subscriptions have proper usage records
  3. Validates data integrity
  4. Removes time-based expiration logic (packages don't expire by time)
*/

-- Step 1: Ensure quantity is renamed to capacity_total
DO $$
BEGIN
  -- Check if quantity column still exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'package_services' AND column_name = 'quantity'
  ) THEN
    -- Rename it
    ALTER TABLE package_services RENAME COLUMN quantity TO capacity_total;
    RAISE NOTICE 'Renamed quantity to capacity_total in package_services';
  END IF;
END $$;

-- Step 2: Ensure all active subscriptions have usage records for all services
-- This fixes any subscriptions that might have been created before the trigger existed
DO $$
DECLARE
  v_subscription RECORD;
  v_package_service RECORD;
  v_existing_usage RECORD;
  v_has_is_active boolean;
BEGIN
  -- Check if is_active column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'package_subscriptions' AND column_name = 'is_active'
  ) INTO v_has_is_active;

  -- Query subscriptions based on whether is_active column exists
  IF v_has_is_active THEN
    FOR v_subscription IN
      SELECT id, package_id, customer_id
      FROM package_subscriptions
      WHERE status = 'active' AND is_active = true
    LOOP
    -- For each service in the package
    FOR v_package_service IN
      SELECT service_id, capacity_total
      FROM package_services
      WHERE package_id = v_subscription.package_id
    LOOP
      -- Check if usage record exists
      SELECT id INTO v_existing_usage
      FROM package_subscription_usage
      WHERE subscription_id = v_subscription.id
        AND service_id = v_package_service.service_id;
      
      -- If no usage record exists, create it
      IF v_existing_usage IS NULL THEN
        INSERT INTO package_subscription_usage (
          subscription_id,
          service_id,
          original_quantity,
          remaining_quantity,
          used_quantity
        ) VALUES (
          v_subscription.id,
          v_package_service.service_id,
          v_package_service.capacity_total,
          v_package_service.capacity_total, -- Assume all capacity is remaining if no usage record exists
          0
        );
        RAISE NOTICE 'Created missing usage record for subscription %, service %', 
          v_subscription.id, v_package_service.service_id;
      END IF;
    END LOOP;
    END LOOP;
  ELSE
    -- Fallback: query without is_active filter
    FOR v_subscription IN
      SELECT id, package_id, customer_id
      FROM package_subscriptions
      WHERE status = 'active'
    LOOP
      -- For each service in the package
      FOR v_package_service IN
        SELECT service_id, capacity_total
        FROM package_services
        WHERE package_id = v_subscription.package_id
      LOOP
        -- Check if usage record exists
        SELECT id INTO v_existing_usage
        FROM package_subscription_usage
        WHERE subscription_id = v_subscription.id
          AND service_id = v_package_service.service_id;
        
        -- If no usage record exists, create it
        IF v_existing_usage IS NULL THEN
          INSERT INTO package_subscription_usage (
            subscription_id,
            service_id,
            original_quantity,
            remaining_quantity,
            used_quantity
          ) VALUES (
            v_subscription.id,
            v_package_service.service_id,
            v_package_service.capacity_total,
            v_package_service.capacity_total, -- Assume all capacity is remaining if no usage record exists
            0
          );
          RAISE NOTICE 'Created missing usage record for subscription %, service %', 
            v_subscription.id, v_package_service.service_id;
        END IF;
      END LOOP;
    END LOOP;
  END IF;
END $$;

-- Step 3: Validate data integrity
-- Ensure all usage records have correct totals
DO $$
DECLARE
  v_invalid_count integer;
BEGIN
  SELECT COUNT(*) INTO v_invalid_count
  FROM package_subscription_usage
  WHERE original_quantity != (remaining_quantity + used_quantity);
  
  IF v_invalid_count > 0 THEN
    RAISE WARNING 'Found % usage records with invalid totals. These should be fixed manually.', v_invalid_count;
  END IF;
END $$;

-- Step 4: Update any subscriptions that might have incorrect status
-- Ensure active subscriptions are properly marked (only if is_active column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'package_subscriptions' AND column_name = 'is_active'
  ) THEN
    UPDATE package_subscriptions
    SET is_active = true
    WHERE status = 'active' AND (is_active IS NULL OR is_active = false);
  END IF;
END $$;

-- Step 5: Add comment documenting the migration
COMMENT ON TABLE package_subscriptions IS 
  'Customer package subscriptions. Packages have no time expiration - they end only when capacity is fully consumed.';

COMMENT ON COLUMN package_subscriptions.expires_at IS 
  'DEPRECATED: Packages no longer expire by time. This field is kept for backward compatibility but is ignored. Packages end only when capacity is fully consumed.';

-- Step 6: Ensure indexes are optimal for the new capacity resolution function
-- (These should already exist from the main migration, but ensure they're there)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'package_subscriptions' AND column_name = 'is_active'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_package_subscriptions_customer_active 
      ON package_subscriptions(customer_id, status, is_active) 
      WHERE status = 'active' AND is_active = true;
  ELSE
    CREATE INDEX IF NOT EXISTS idx_package_subscriptions_customer_active 
      ON package_subscriptions(customer_id, status) 
      WHERE status = 'active';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_package_services_service_package 
  ON package_services(service_id, package_id);

CREATE INDEX IF NOT EXISTS idx_package_usage_subscription_service 
  ON package_subscription_usage(subscription_id, service_id, remaining_quantity);
