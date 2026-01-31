-- Employee-based booking availability: indexes for bulk queries (no N+1).
-- Use when applying migrations for this project.

-- employee_shifts: bulk fetch by tenant + employee list + is_active
CREATE INDEX IF NOT EXISTS idx_employee_shifts_tenant_employee_active
  ON employee_shifts(tenant_id, employee_id, is_active)
  WHERE is_active = true;

-- slots: bulk fetch by employee list + date (overlap and existing-slot checks)
CREATE INDEX IF NOT EXISTS idx_slots_employee_date
  ON slots(employee_id, slot_date)
  WHERE employee_id IS NOT NULL;

-- bookings: count by slot_id with status filter (non-cancelled)
CREATE INDEX IF NOT EXISTS idx_bookings_slot_status
  ON bookings(slot_id, status)
  WHERE status IS NOT NULL;
