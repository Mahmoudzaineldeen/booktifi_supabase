/*
  # Redesign Package Capacity System
  
  ## Objective
  Decouple packages from "multi-service booking" logic and introduce service-level capacity tracking.
  Packages have no time expiration - they end only when capacity is fully consumed.
  
  ## Changes
  1. Rename `quantity` to `capacity_total` in `package_services` for clarity
  2. Remove time-based expiration logic (keep `expires_at` column but ignore it)
  3. Create `resolveCustomerServiceCapacity` function for fast capacity resolution
  4. Update triggers to use new capacity model
  5. Add notification tracking for package exhaustion
*/

-- Step 1: Add is_active column to package_subscriptions if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'package_subscriptions' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE package_subscriptions ADD COLUMN is_active boolean DEFAULT true NOT NULL;
  END IF;
END $$;

-- Step 2: Rename quantity to capacity_total in package_services for clarity
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'package_services' AND column_name = 'quantity'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'package_services' AND column_name = 'capacity_total'
  ) THEN
    ALTER TABLE package_services RENAME COLUMN quantity TO capacity_total;
  END IF;
END $$;

-- Step 3: Add comment to clarify capacity_total
COMMENT ON COLUMN package_services.capacity_total IS 'Total capacity (number of booking tickets) for this service in the package. Capacity is consumed per booking ticket.';

-- Step 4: Create table to track package exhaustion notifications (one-time per service per package)
CREATE TABLE IF NOT EXISTS package_exhaustion_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES package_subscriptions(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  notified_at timestamptz DEFAULT now(),
  UNIQUE(subscription_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_package_exhaustion_notifications_subscription 
  ON package_exhaustion_notifications(subscription_id, service_id);

-- Step 5: Create the core capacity resolution function
-- Note: Function name is quoted to preserve case for PostgREST compatibility
CREATE OR REPLACE FUNCTION "resolveCustomerServiceCapacity"(
  p_customer_id uuid,
  p_service_id uuid
)
RETURNS TABLE (
  total_remaining_capacity integer,
  source_package_ids uuid[],
  exhaustion_status jsonb
) 
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_remaining integer := 0;
  v_package_ids uuid[] := ARRAY[]::uuid[];
  v_exhaustion_data jsonb := '[]'::jsonb;
  v_subscription_record record;
  v_usage_record record;
BEGIN
  -- Find all active subscriptions for this customer
  FOR v_subscription_record IN
    SELECT 
      ps.id as subscription_id,
      ps.package_id,
      ps.status
    FROM package_subscriptions ps
    WHERE ps.customer_id = p_customer_id
      AND ps.status = 'active'
      AND ps.is_active = true
      -- Ignore expires_at - packages don't expire by time
  LOOP
    -- Check if this package includes the requested service
    IF EXISTS (
      SELECT 1 
      FROM package_services psvc
      WHERE psvc.package_id = v_subscription_record.package_id
        AND psvc.service_id = p_service_id
    ) THEN
      -- Get usage for this service in this subscription
      SELECT 
        psu.remaining_quantity,
        psu.original_quantity,
        psu.used_quantity
      INTO v_usage_record
      FROM package_subscription_usage psu
      WHERE psu.subscription_id = v_subscription_record.subscription_id
        AND psu.service_id = p_service_id;
      
      -- If usage record exists and has remaining capacity
      IF v_usage_record IS NOT NULL AND v_usage_record.remaining_quantity > 0 THEN
        v_total_remaining := v_total_remaining + v_usage_record.remaining_quantity;
        v_package_ids := array_append(v_package_ids, v_subscription_record.package_id);
        
        -- Track exhaustion status
        v_exhaustion_data := v_exhaustion_data || jsonb_build_object(
          'subscription_id', v_subscription_record.subscription_id,
          'package_id', v_subscription_record.package_id,
          'remaining', v_usage_record.remaining_quantity,
          'total', v_usage_record.original_quantity,
          'used', v_usage_record.used_quantity,
          'is_exhausted', false
        );
      ELSIF v_usage_record IS NOT NULL AND v_usage_record.remaining_quantity = 0 THEN
        -- Track exhausted packages
        v_exhaustion_data := v_exhaustion_data || jsonb_build_object(
          'subscription_id', v_subscription_record.subscription_id,
          'package_id', v_subscription_record.package_id,
          'remaining', 0,
          'total', v_usage_record.original_quantity,
          'used', v_usage_record.used_quantity,
          'is_exhausted', true
        );
      END IF;
    END IF;
  END LOOP;
  
  -- Return results
  RETURN QUERY SELECT 
    v_total_remaining,
    v_package_ids,
    v_exhaustion_data;
END;
$$;

-- Add comment (use quoted name to match function definition)
COMMENT ON FUNCTION "resolveCustomerServiceCapacity"(uuid, uuid) IS 
  'Resolves total remaining capacity for a customer and service across all active packages. Returns total capacity, source package IDs, and exhaustion status.';

-- Step 6: Create function to check if exhaustion notification should be sent
-- Note: Function name is quoted to preserve case for PostgREST compatibility
CREATE OR REPLACE FUNCTION "shouldNotifyPackageExhaustion"(
  p_subscription_id uuid,
  p_service_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_already_notified boolean;
  v_remaining integer;
BEGIN
  -- Check if already notified
  SELECT EXISTS (
    SELECT 1 
    FROM package_exhaustion_notifications
    WHERE subscription_id = p_subscription_id
      AND service_id = p_service_id
  ) INTO v_already_notified;
  
  IF v_already_notified THEN
    RETURN false;
  END IF;
  
  -- Check if capacity is exhausted
  SELECT remaining_quantity
  INTO v_remaining
  FROM package_subscription_usage
  WHERE subscription_id = p_subscription_id
    AND service_id = p_service_id;
  
  -- Notify only if capacity just hit 0
  RETURN (v_remaining IS NOT NULL AND v_remaining = 0);
END;
$$;

-- Step 7: Update the booking trigger to record exhaustion notifications
CREATE OR REPLACE FUNCTION decrement_package_usage_on_booking()
RETURNS TRIGGER AS $$
DECLARE
  v_remaining_after integer;
  v_should_notify boolean;
BEGIN
  -- Only process if booking uses a package
  IF NEW.package_subscription_id IS NOT NULL AND NEW.status != 'cancelled' THEN
    -- Decrement the package usage for this service
    UPDATE package_subscription_usage
    SET 
      remaining_quantity = remaining_quantity - 1,
      used_quantity = used_quantity + 1,
      updated_at = now()
    WHERE subscription_id = NEW.package_subscription_id
      AND service_id = NEW.service_id
      AND remaining_quantity > 0
    RETURNING remaining_quantity INTO v_remaining_after;
    
    -- Check if update happened (remaining_quantity was > 0)
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No available package capacity for service in subscription %', NEW.package_subscription_id;
    END IF;
    
    -- If capacity just hit 0, record notification (one-time)
    IF v_remaining_after = 0 THEN
      INSERT INTO package_exhaustion_notifications (subscription_id, service_id)
      VALUES (NEW.package_subscription_id, NEW.service_id)
      ON CONFLICT (subscription_id, service_id) DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 8: Create index for performance on resolveCustomerServiceCapacity
-- Note: Create partial index only if is_active column exists
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
    -- Fallback: create index without is_active filter
    CREATE INDEX IF NOT EXISTS idx_package_subscriptions_customer_active 
      ON package_subscriptions(customer_id, status) 
      WHERE status = 'active';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_package_services_service_package 
  ON package_services(service_id, package_id);

CREATE INDEX IF NOT EXISTS idx_package_usage_subscription_service 
  ON package_subscription_usage(subscription_id, service_id, remaining_quantity);

-- Step 9: Enable RLS on new table
ALTER TABLE package_exhaustion_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policy for package_exhaustion_notifications (create only if doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'package_exhaustion_notifications'
      AND policyname = 'Users can view exhaustion notifications in their tenant'
  ) THEN
    CREATE POLICY "Users can view exhaustion notifications in their tenant"
      ON package_exhaustion_notifications FOR SELECT
      TO authenticated
      USING (
        subscription_id IN (
          SELECT id FROM package_subscriptions WHERE tenant_id IN (
            SELECT tenant_id FROM users WHERE id = auth.uid()
          )
        )
      );
  END IF;
END $$;
