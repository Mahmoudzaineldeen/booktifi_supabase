-- Branch-level working shifts. Employees without custom shifts inherit these.
-- Shift resolution: if employee has any employee_shift → use employee shifts; else use branch_shifts for employee's branch.

CREATE TABLE IF NOT EXISTS branch_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  days_of_week integer[] NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CHECK (array_length(days_of_week, 1) > 0),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_branch_shifts_branch_id ON branch_shifts(branch_id);
COMMENT ON TABLE branch_shifts IS 'Default working shifts per branch. Used for slot generation when employee has no custom employee_shifts.';

-- RLS: tenant users can read; only tenant_admin/solution_owner can insert/update/delete
ALTER TABLE branch_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view branch shifts"
  ON branch_shifts FOR SELECT TO authenticated
  USING (
    branch_id IN (SELECT id FROM branches WHERE tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'solution_owner'
  );

CREATE POLICY "Tenant admins can manage branch shifts"
  ON branch_shifts FOR ALL TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('tenant_admin', 'solution_owner')
    AND branch_id IN (SELECT id FROM branches WHERE tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()) OR (SELECT role FROM users WHERE id = auth.uid()) = 'solution_owner')
  )
  WITH CHECK (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('tenant_admin', 'solution_owner')
  );
