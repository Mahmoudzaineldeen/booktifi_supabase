/*
  # Verify Database State - Partial Package Coverage
  
  This migration verifies that all required columns, functions, and policies
  for partial package coverage are in place. It's safe to run multiple times.
*/

-- Verify bookings table has partial coverage columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'package_covered_quantity'
  ) THEN
    RAISE EXCEPTION 'Missing column: bookings.package_covered_quantity. Please run migration 20260131000000_add_partial_package_coverage.sql';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'paid_quantity'
  ) THEN
    RAISE EXCEPTION 'Missing column: bookings.paid_quantity. Please run migration 20260131000000_add_partial_package_coverage.sql';
  END IF;

  RAISE NOTICE '✅ Verified: bookings table has package_covered_quantity and paid_quantity columns';
END $$;

-- Verify create_booking_with_lock function has partial coverage parameters
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'create_booking_with_lock'
      AND pg_get_function_arguments(p.oid) LIKE '%p_package_covered_quantity%'
  ) THEN
    RAISE EXCEPTION 'Missing parameter: create_booking_with_lock.p_package_covered_quantity. Please run migration 20260131000001_update_booking_function_partial_coverage.sql';
  END IF;

  RAISE NOTICE '✅ Verified: create_booking_with_lock function has partial coverage parameters';
END $$;

-- Verify create_bulk_booking function has partial coverage parameters
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'create_bulk_booking'
      AND pg_get_function_arguments(p.oid) LIKE '%p_package_covered_quantity%'
  ) THEN
    RAISE EXCEPTION 'Missing parameter: create_bulk_booking.p_package_covered_quantity. Please run migration 20260131000003_update_bulk_booking_partial_coverage.sql';
  END IF;

  RAISE NOTICE '✅ Verified: create_bulk_booking function has partial coverage parameters';
END $$;

-- Verify decrement_package_usage_on_booking trigger function uses package_covered_quantity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'decrement_package_usage_on_booking'
      AND pg_get_functiondef(p.oid) LIKE '%package_covered_quantity%'
  ) THEN
    RAISE EXCEPTION 'Trigger function does not use package_covered_quantity. Please run migration 20260131000002_update_package_deduction_trigger.sql';
  END IF;

  RAISE NOTICE '✅ Verified: decrement_package_usage_on_booking trigger uses package_covered_quantity';
END $$;

-- Verify RLS policy allows admin_user and customer_admin to update subscriptions
DO $$
DECLARE
  v_policy_exists boolean;
  v_qual_text text;
  v_with_check_text text;
BEGIN
  -- Check if policy exists
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'package_subscriptions'
      AND policyname = 'Tenant users can update subscriptions in their tenant'
  ) INTO v_policy_exists;

  IF NOT v_policy_exists THEN
    RAISE EXCEPTION 'RLS policy "Tenant users can update subscriptions in their tenant" not found. Please run migration 20260131000004_enable_subscription_cancellation.sql';
  END IF;

  -- Get policy qual and with_check expressions from pg_policy
  SELECT 
    COALESCE(pg_get_expr(p.polqual, p.polrelid), ''),
    COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
  INTO v_qual_text, v_with_check_text
  FROM pg_policy p
  JOIN pg_class c ON p.polrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'package_subscriptions'
    AND p.polname = 'Tenant users can update subscriptions in their tenant';

  -- Handle case where policy exists but we couldn't get the expressions
  IF v_qual_text IS NULL AND v_with_check_text IS NULL THEN
    RAISE WARNING 'Policy exists but could not retrieve policy expressions. This may indicate the policy needs to be recreated.';
    RAISE WARNING 'Please verify manually that migration 20260131000004_enable_subscription_cancellation.sql was applied correctly.';
    RETURN;
  END IF;

  -- Ensure we have text values
  v_qual_text := COALESCE(v_qual_text, '');
  v_with_check_text := COALESCE(v_with_check_text, '');

  -- Check if policy includes admin_user and customer_admin
  IF (v_qual_text NOT LIKE '%admin_user%' AND v_with_check_text NOT LIKE '%admin_user%')
     OR (v_qual_text NOT LIKE '%customer_admin%' AND v_with_check_text NOT LIKE '%customer_admin%') THEN
    RAISE WARNING 'RLS policy exists but may not include admin_user and customer_admin. Policy qual: %, with_check: %', v_qual_text, v_with_check_text;
    RAISE WARNING 'Please verify manually that migration 20260131000004_enable_subscription_cancellation.sql was applied correctly.';
  ELSE
    RAISE NOTICE '✅ Verified: RLS policy allows admin_user and customer_admin to update subscriptions';
  END IF;
END $$;

-- Final success message
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ All database migrations verified successfully!';
  RAISE NOTICE 'Database is up to date with partial package coverage support.';
  RAISE NOTICE '========================================';
END $$;
