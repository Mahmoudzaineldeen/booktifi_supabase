-- ============================================================================
-- Add Coordinator Role to user_role enum
-- ============================================================================
-- Coordinator: view bookings and confirm only (reception page, no create/edit/cancel).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'coordinator'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE 'coordinator';
  END IF;
END $$;

COMMENT ON TYPE user_role IS 'User roles: solution_owner, tenant_admin, receptionist, coordinator (view+confirm only), cashier, employee, customer, customer_admin (bookings only), admin_user (bookings only)';
