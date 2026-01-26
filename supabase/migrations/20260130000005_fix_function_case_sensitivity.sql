/*
  # Fix Function Case Sensitivity
  
  PostgreSQL converts unquoted identifiers to lowercase, but PostgREST
  and the backend code use mixed case. This migration ensures functions
  are created with quoted names to preserve case.
  
  This fixes the bug where resolveCustomerServiceCapacity was not found
  because it was stored as resolvecustomerservicecapacity (lowercase).
*/

-- Recreate resolveCustomerServiceCapacity with quoted name (preserves case)
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

-- Update comment
COMMENT ON FUNCTION "resolveCustomerServiceCapacity"(uuid, uuid) IS 
  'Resolves total remaining capacity for a customer and service across all active packages. Returns total capacity, source package IDs, and exhaustion status.';

-- Recreate shouldNotifyPackageExhaustion with quoted name
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
