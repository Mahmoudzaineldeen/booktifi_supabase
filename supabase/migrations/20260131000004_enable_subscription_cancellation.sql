/*
  # Enable Subscription Cancellation for Admin Users and Customer Admins
  
  Updates RLS policies to allow admin_user and customer_admin
  roles to cancel package subscriptions in addition to tenant_admin and receptionist.
*/

-- Drop existing update policy
DROP POLICY IF EXISTS "Tenant users can update subscriptions in their tenant" ON package_subscriptions;

-- Recreate with expanded roles (tenant_admin, receptionist, admin_user, customer_admin)
CREATE POLICY "Tenant users can update subscriptions in their tenant"
  ON package_subscriptions FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users 
      WHERE id = auth.uid() 
      AND role IN ('tenant_admin', 'receptionist', 'admin_user', 'customer_admin')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM users 
      WHERE id = auth.uid() 
      AND role IN ('tenant_admin', 'receptionist', 'admin_user', 'customer_admin')
    )
  );
