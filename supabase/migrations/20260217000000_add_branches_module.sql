-- Multi-branch module: branches, service_branches, package_branches, branch_id on bookings/subscriptions/users
-- Ensures data isolation per branch and branch-scoped income tracking.

-- ============================================
-- 1. BRANCHES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS branches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant_id ON branches(tenant_id);
COMMENT ON TABLE branches IS 'Physical branches per tenant; users and data are scoped by branch for receptionists/cashiers.';

-- ============================================
-- 2. SERVICE_BRANCHES (service assigned to one or more branches)
-- ============================================
CREATE TABLE IF NOT EXISTS service_branches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(service_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_service_branches_service_id ON service_branches(service_id);
CREATE INDEX IF NOT EXISTS idx_service_branches_branch_id ON service_branches(branch_id);

-- ============================================
-- 3. PACKAGE_BRANCHES (package assigned to one or more branches)
-- ============================================
CREATE TABLE IF NOT EXISTS package_branches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id uuid NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(package_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_package_branches_package_id ON package_branches(package_id);
CREATE INDEX IF NOT EXISTS idx_package_branches_branch_id ON package_branches(branch_id);

-- ============================================
-- 4. ADD branch_id TO BOOKINGS (income per branch)
-- ============================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_branch_id ON bookings(branch_id) WHERE branch_id IS NOT NULL;

-- ============================================
-- 5. ADD branch_id TO PACKAGE_SUBSCRIPTIONS (income per branch)
-- ============================================
ALTER TABLE package_subscriptions ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_branch_id ON package_subscriptions(branch_id) WHERE branch_id IS NOT NULL;

-- ============================================
-- 6. ADD branch_id TO USERS (one branch per receptionist/cashier/employee)
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_branch_id ON users(branch_id) WHERE branch_id IS NOT NULL;

-- ============================================
-- 7. CREATE DEFAULT BRANCH PER TENANT & BACKFILL
-- ============================================
DO $$
DECLARE
  r RECORD;
  default_branch_id uuid;
BEGIN
  FOR r IN SELECT id FROM tenants
  LOOP
    SELECT id INTO default_branch_id FROM branches WHERE tenant_id = r.id ORDER BY created_at LIMIT 1;

    IF default_branch_id IS NULL THEN
      INSERT INTO branches (tenant_id, name, location)
      VALUES (r.id, 'Main Branch', 'Headquarters')
      RETURNING id INTO default_branch_id;
    END IF;

    IF default_branch_id IS NOT NULL THEN
      UPDATE bookings SET branch_id = default_branch_id WHERE tenant_id = r.id AND branch_id IS NULL;
      UPDATE package_subscriptions SET branch_id = default_branch_id WHERE tenant_id = r.id AND branch_id IS NULL;
      UPDATE users
      SET branch_id = default_branch_id
      WHERE tenant_id = r.id AND branch_id IS NULL
        AND role IN ('receptionist', 'cashier', 'employee', 'coordinator');
    END IF;
  END LOOP;
END $$;

-- ============================================
-- 8. ASSIGN ALL EXISTING SERVICES TO DEFAULT BRANCH (per tenant)
-- ============================================
INSERT INTO service_branches (service_id, branch_id)
SELECT s.id, b.id
FROM services s
CROSS JOIN LATERAL (SELECT id FROM branches WHERE tenant_id = s.tenant_id ORDER BY created_at LIMIT 1) b
WHERE NOT EXISTS (SELECT 1 FROM service_branches sb WHERE sb.service_id = s.id);

-- ============================================
-- 9. ASSIGN ALL EXISTING PACKAGES TO DEFAULT BRANCH (per tenant)
-- ============================================
INSERT INTO package_branches (package_id, branch_id)
SELECT sp.id, (SELECT id FROM branches WHERE tenant_id = sp.tenant_id LIMIT 1)
FROM service_packages sp
WHERE NOT EXISTS (SELECT 1 FROM package_branches pb WHERE pb.package_id = sp.id);

-- ============================================
-- 10. TRIGGER: Assign new services to tenant default branch
-- ============================================
CREATE OR REPLACE FUNCTION assign_new_service_to_default_branch()
RETURNS TRIGGER AS $$
DECLARE
  first_branch_id uuid;
BEGIN
  SELECT id INTO first_branch_id FROM branches WHERE tenant_id = NEW.tenant_id ORDER BY created_at LIMIT 1;
  IF first_branch_id IS NOT NULL THEN
    INSERT INTO service_branches (service_id, branch_id) VALUES (NEW.id, first_branch_id)
    ON CONFLICT (service_id, branch_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_new_service_to_default_branch ON services;
CREATE TRIGGER trg_assign_new_service_to_default_branch
  AFTER INSERT ON services FOR EACH ROW EXECUTE FUNCTION assign_new_service_to_default_branch();
