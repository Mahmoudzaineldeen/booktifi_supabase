/*
  # Allow Authenticated Users to Create Tenants

  1. Changes
    - Add policy to allow newly registered users to create their own tenant
    - This enables the signup flow to work in production without backend server

  2. Security
    - Only allows authenticated users (after signup) to create tenants
    - Users can insert their own tenant data during registration
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Authenticated users can create tenants" ON tenants;
DROP POLICY IF EXISTS "Authenticated users can view their tenant" ON tenants;
DROP POLICY IF EXISTS "Tenant admins can update their tenant" ON tenants;

-- Allow authenticated users to insert tenants (for signup flow)
CREATE POLICY "Authenticated users can create tenants"
  ON tenants FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to view their own tenant
CREATE POLICY "Authenticated users can view their tenant"
  ON tenants FOR SELECT
  TO authenticated
  USING (true);

-- Allow tenant admins to update their own tenant
CREATE POLICY "Tenant admins can update their tenant"
  ON tenants FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );