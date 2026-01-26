/*
  # Update package capacity deduction trigger for partial coverage
  
  Updates the trigger to only deduct package_covered_quantity instead of
  always deducting 1. This supports partial package coverage.
*/

-- Update the trigger function to handle partial coverage
CREATE OR REPLACE FUNCTION decrement_package_usage_on_booking()
RETURNS TRIGGER AS $$
DECLARE
  v_remaining_after integer;
  v_should_notify boolean;
  v_quantity_to_deduct integer;
BEGIN
  -- Only process if booking uses a package
  IF NEW.package_subscription_id IS NOT NULL AND NEW.status != 'cancelled' THEN
    -- Determine how much to deduct: use package_covered_quantity if available, otherwise default to 1
    -- This supports both old bookings (without package_covered_quantity) and new bookings (with partial coverage)
    v_quantity_to_deduct := COALESCE(NEW.package_covered_quantity, 1);
    
    -- Only deduct if there's actually something to deduct
    IF v_quantity_to_deduct > 0 THEN
      -- Decrement the package usage for this service by the covered quantity
      UPDATE package_subscription_usage
      SET 
        remaining_quantity = remaining_quantity - v_quantity_to_deduct,
        used_quantity = used_quantity + v_quantity_to_deduct,
        updated_at = now()
      WHERE subscription_id = NEW.package_subscription_id
        AND service_id = NEW.service_id
        AND remaining_quantity >= v_quantity_to_deduct -- Ensure we don't go negative
      RETURNING remaining_quantity INTO v_remaining_after;
      
      -- Check if update happened (had enough capacity)
      IF NOT FOUND THEN
        -- This shouldn't happen if backend logic is correct, but log it
        RAISE WARNING 'Insufficient package capacity: requested %, but not enough available', v_quantity_to_deduct;
        -- Don't fail the booking - it will be handled as paid
      ELSE
      -- If capacity just hit 0 (after deducting covered quantity), record notification (one-time)
      -- This handles both full coverage (v_quantity_to_deduct = visitor_count) and partial coverage
      IF v_remaining_after = 0 THEN
        INSERT INTO package_exhaustion_notifications (subscription_id, service_id)
        VALUES (NEW.package_subscription_id, NEW.service_id)
        ON CONFLICT (subscription_id, service_id) DO NOTHING;
      END IF;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
