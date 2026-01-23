/*
  # Add explicit DELETE policy for bookings table
  
  1. Security Changes
    - Add explicit policy for tenant admins to delete bookings in their tenant
    - This ensures DELETE operations work correctly even if the "FOR ALL" policy has issues
*/

-- Drop existing DELETE policy if any (in case it exists separately)
DROP POLICY IF EXISTS "Tenant admins can delete tenant bookings" ON bookings;

-- Tenant admins can delete bookings in their tenant
CREATE POLICY "Tenant admins can delete tenant bookings"
  ON bookings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.tenant_id = bookings.tenant_id
      AND users.role = 'tenant_admin'
    )
  );

-- Add comment for documentation
COMMENT ON POLICY "Tenant admins can delete tenant bookings" ON bookings IS 
  'Allows tenant admins (service providers) to delete bookings in their own tenant. This policy works alongside the "Staff can manage bookings" FOR ALL policy to ensure DELETE operations are explicitly allowed.';
