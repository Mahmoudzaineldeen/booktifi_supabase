-- Global Scheduling Mode (tenant_features)
-- Controls how the entire booking system behaves: employee_based (availability from employee shifts)
-- or service_slot_based (availability from service-defined slots). No data is deleted when switching.

ALTER TABLE tenant_features
  ADD COLUMN IF NOT EXISTS scheduling_mode text DEFAULT 'service_slot_based' NOT NULL;

-- Constraint: only allowed values
ALTER TABLE tenant_features DROP CONSTRAINT IF EXISTS tenant_features_scheduling_mode_check;
ALTER TABLE tenant_features ADD CONSTRAINT tenant_features_scheduling_mode_check
  CHECK (scheduling_mode IN ('employee_based', 'service_slot_based'));

COMMENT ON COLUMN tenant_features.scheduling_mode IS 'Global scheduling mode: employee_based = availability from employee shifts only; service_slot_based = availability from service slots';

-- Ensure existing rows have default
UPDATE tenant_features SET scheduling_mode = 'service_slot_based' WHERE scheduling_mode IS NULL;

-- Allow tenant admins to update their own tenant_features (for Scheduling Configuration in Settings)
DROP POLICY IF EXISTS "Tenant admins can update own features" ON tenant_features;
CREATE POLICY "Tenant admins can update own features"
  ON tenant_features
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND role = 'tenant_admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND role = 'tenant_admin')
  );
