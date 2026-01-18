/*
  # Add SELECT policies for bookings table
  
  1. Security Changes
    - Add policy for tenant admins to view all bookings in their tenant
    - Add policy for tenant employees to view bookings in their tenant
    - Add policy for customers to view their own bookings
    - Add policy for solution owners to view all bookings
*/

-- Drop existing SELECT policies if any
DROP POLICY IF EXISTS "Tenant admins can view all tenant bookings" ON bookings;
DROP POLICY IF EXISTS "Tenant employees can view tenant bookings" ON bookings;
DROP POLICY IF EXISTS "Customers can view own bookings" ON bookings;
DROP POLICY IF EXISTS "Solution owners can view all bookings" ON bookings;

-- Tenant admins can view all bookings for their tenant
CREATE POLICY "Tenant admins can view all tenant bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.tenant_id = bookings.tenant_id
      AND users.role = 'tenant_admin'
    )
  );

-- Tenant employees can view bookings for their tenant
CREATE POLICY "Tenant employees can view tenant bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.tenant_id = bookings.tenant_id
      AND users.role IN ('employee', 'receptionist', 'cashier')
    )
  );

-- Customers can view their own bookings
CREATE POLICY "Customers can view own bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid() OR created_by_user_id = auth.uid()
  );

-- Solution owners can view all bookings
CREATE POLICY "Solution owners can view all bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'solution_owner'
    )
  );
