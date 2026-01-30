-- Employee & Service Scheduling Enhancement
-- 1. Scheduling type per service: slot_based (service has shifts) vs employee_based (employees have shifts)
-- 2. Assignment mode for employee-based: auto_assign (fair rotation) vs manual_assign
-- 3. Employee shifts: shifts belong to employees (days + time ranges)
-- 4. Pause employee: is_paused_until (absent today or until date)
-- 5. Rotation state for fair auto-assign

-- Scheduling type: who owns availability
DO $$ BEGIN
  CREATE TYPE scheduling_type AS ENUM ('slot_based', 'employee_based');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Assignment mode for employee-based services only
DO $$ BEGIN
  CREATE TYPE assignment_mode AS ENUM ('auto_assign', 'manual_assign');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Services: add scheduling_type and assignment_mode
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS scheduling_type text DEFAULT 'slot_based' NOT NULL,
  ADD COLUMN IF NOT EXISTS assignment_mode text DEFAULT NULL;

-- Constraint: assignment_mode only when scheduling_type = employee_based
ALTER TABLE services DROP CONSTRAINT IF EXISTS check_scheduling_assignment;
ALTER TABLE services ADD CONSTRAINT check_scheduling_assignment
  CHECK (
    (scheduling_type = 'slot_based' AND assignment_mode IS NULL)
    OR (scheduling_type = 'employee_based' AND assignment_mode IN ('auto_assign', 'manual_assign'))
  );

COMMENT ON COLUMN services.scheduling_type IS 'slot_based = service has its own shifts/slots; employee_based = availability from employee shifts';
COMMENT ON COLUMN services.assignment_mode IS 'For employee_based only: auto_assign (fair rotation) or manual_assign (reception picks employee)';

-- Users: pause employee (absent today or until date)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_paused_until date DEFAULT NULL;

COMMENT ON COLUMN users.is_paused_until IS 'When set, employee is paused/absent until this date (inclusive). NULL = not paused';

-- Employee shifts: shifts belong to employees (days + time ranges)
CREATE TABLE IF NOT EXISTS employee_shifts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  days_of_week integer[] NOT NULL,
  start_time_utc time NOT NULL,
  end_time_utc time NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CHECK (array_length(days_of_week, 1) > 0),
  CHECK (end_time_utc > start_time_utc)
);

CREATE INDEX IF NOT EXISTS idx_employee_shifts_tenant ON employee_shifts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_employee ON employee_shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_active ON employee_shifts(employee_id, is_active) WHERE is_active = true;

COMMENT ON TABLE employee_shifts IS 'Working shifts for employees. Used when service.scheduling_type = employee_based.';

-- Service rotation state: last assigned employee per service (for fair auto-assign)
CREATE TABLE IF NOT EXISTS service_rotation_state (
  service_id uuid PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
  last_assigned_employee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE service_rotation_state IS 'For employee_based + auto_assign: tracks last assigned employee for fair rotation';

-- employee_services: allow shift_id NULL when service is employee_based (employee linked to service only; shifts from employee_shifts)
ALTER TABLE employee_services
  ALTER COLUMN shift_id DROP NOT NULL;

-- RLS for employee_shifts
ALTER TABLE employee_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view employee shifts in their tenant"
  ON employee_shifts FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (SELECT id FROM tenants WHERE id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid() OR (SELECT role FROM users WHERE id = auth.uid()) = 'solution_owner'
    ))
    OR (SELECT tenant_id FROM users WHERE id = auth.uid()) = employee_shifts.tenant_id
  );

CREATE POLICY "Tenant admins can manage employee shifts"
  ON employee_shifts FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('tenant_admin', 'solution_owner')
    AND (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()) OR (SELECT role FROM users WHERE id = auth.uid()) = 'solution_owner')
  )
  WITH CHECK (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('tenant_admin', 'solution_owner')
  );

-- RLS for service_rotation_state (internal use; same tenant access)
ALTER TABLE service_rotation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can read rotation state"
  ON service_rotation_state FOR SELECT
  TO authenticated
  USING (
    service_id IN (SELECT id FROM services WHERE tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'solution_owner'
  );

CREATE POLICY "Tenant admins and system can update rotation state"
  ON service_rotation_state FOR ALL
  TO authenticated
  USING (
    service_id IN (SELECT id FROM services WHERE tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'solution_owner'
  );
