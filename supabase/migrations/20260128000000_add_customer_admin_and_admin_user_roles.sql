-- ============================================================================
-- Add Customer Admin and Admin User Roles
-- ============================================================================
-- This migration adds two new restricted admin roles:
-- - customer_admin: Can access admin dashboard and bookings only
-- - admin_user: Can access bookings page only
-- ============================================================================

-- Add new roles to user_role enum
DO $$
BEGIN
  -- Check if customer_admin already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'customer_admin' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE 'customer_admin';
  END IF;

  -- Check if admin_user already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'admin_user' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE 'admin_user';
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON TYPE user_role IS 'User roles: solution_owner, tenant_admin, receptionist, cashier, employee, customer, customer_admin (bookings only), admin_user (bookings only)';
