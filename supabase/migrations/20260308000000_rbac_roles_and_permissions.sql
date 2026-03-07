-- ============================================================================
-- RBAC: Roles and Permissions (Part 1 - Schema + Seed)
-- ============================================================================
-- Creates permissions registry, roles, role_permissions, adds role_id to users.
-- Preserves existing user_role enum and role column for backward compatibility.
-- ============================================================================

-- Permissions table (registry of all system capabilities)
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('admin', 'employee')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roles table (tenant_id NULL = built-in role, non-NULL = tenant-specific custom role)
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('admin', 'employee')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_roles_is_active ON roles(is_active);

-- Role-Permission mapping
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);

-- Add role_id to users (nullable during migration; FK to roles)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

-- Seed permissions (admin + employee as per spec)
INSERT INTO permissions (id, name, description, category) VALUES
-- Admin
('manage_branches', 'Manage branches', 'Create, edit, delete branches', 'admin'),
('manage_services', 'Manage services', 'Create, edit, delete services', 'admin'),
('manage_packages', 'Manage packages', 'Create, edit, delete packages', 'admin'),
('manage_employees', 'Manage employees', 'Create, edit, delete employees', 'admin'),
('manage_shifts', 'Manage shifts', 'Manage employee shifts and scheduling', 'admin'),
('manage_bookings', 'Manage bookings', 'Full booking management', 'admin'),
('view_reports', 'View reports', 'Access reports and analytics', 'admin'),
('manage_roles', 'Manage roles', 'Create, edit, disable, delete roles', 'admin'),
('view_income', 'View income', 'View income and financial data', 'admin'),
('access_support_tickets', 'Access support tickets', 'View and manage support tickets', 'admin'),
('edit_system_settings', 'Edit system settings', 'Edit tenant/system settings', 'admin'),
-- Employee
('create_booking', 'Create booking', 'Create new bookings', 'employee'),
('edit_booking', 'Edit booking', 'Edit existing bookings', 'employee'),
('cancel_booking', 'Cancel booking', 'Cancel bookings', 'employee'),
('assign_employee_to_booking', 'Assign employee to booking', 'Assign employee to a booking', 'employee'),
('sell_packages', 'Sell packages', 'Sell packages to customers', 'employee'),
('create_subscriptions', 'Create subscriptions', 'Create package subscriptions', 'employee'),
('register_visitors', 'Register visitors', 'Register and manage visitors', 'employee'),
('view_schedules', 'View schedules', 'View employee and branch schedules', 'employee'),
('process_payments', 'Process payments', 'Process payments', 'employee'),
('issue_invoices', 'Issue invoices', 'Issue and manage invoices', 'employee')
ON CONFLICT (id) DO NOTHING;

-- Create built-in roles (tenant_id NULL) and assign permissions
INSERT INTO roles (id, tenant_id, name, description, category, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'System Admin', 'Full tenant administration', 'admin', true),
  ('00000000-0000-0000-0000-000000000002', NULL, 'Receptionist', 'Front desk: bookings, visitors, packages', 'employee', true),
  ('00000000-0000-0000-0000-000000000003', NULL, 'Cashier', 'Payments, invoices, packages', 'employee', true),
  ('00000000-0000-0000-0000-000000000004', NULL, 'Coordinator', 'View and confirm bookings only', 'employee', true),
  ('00000000-0000-0000-0000-000000000005', NULL, 'Employee', 'Service provider only', 'employee', true),
  ('00000000-0000-0000-0000-000000000006', NULL, 'Bookings Only (Admin)', 'Access bookings page only', 'admin', true),
  ('00000000-0000-0000-0000-000000000007', NULL, 'Customer Admin', 'Dashboard, bookings, limited admin', 'admin', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category, is_active = EXCLUDED.is_active, updated_at = NOW();

-- System Admin: all admin permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, id FROM permissions WHERE category = 'admin'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, id FROM permissions WHERE category = 'employee'
ON CONFLICT DO NOTHING;

-- Receptionist: employee booking + visitors + packages
INSERT INTO role_permissions (role_id, permission_id) VALUES
('00000000-0000-0000-0000-000000000002'::uuid, 'create_booking'),
('00000000-0000-0000-0000-000000000002'::uuid, 'edit_booking'),
('00000000-0000-0000-0000-000000000002'::uuid, 'cancel_booking'),
('00000000-0000-0000-0000-000000000002'::uuid, 'assign_employee_to_booking'),
('00000000-0000-0000-0000-000000000002'::uuid, 'sell_packages'),
('00000000-0000-0000-0000-000000000002'::uuid, 'create_subscriptions'),
('00000000-0000-0000-0000-000000000002'::uuid, 'register_visitors'),
('00000000-0000-0000-0000-000000000002'::uuid, 'view_schedules'),
('00000000-0000-0000-0000-000000000002'::uuid, 'process_payments'),
('00000000-0000-0000-0000-000000000002'::uuid, 'issue_invoices'),
('00000000-0000-0000-0000-000000000002'::uuid, 'view_reports')
ON CONFLICT DO NOTHING;

-- Cashier: payments, invoices, packages
INSERT INTO role_permissions (role_id, permission_id) VALUES
('00000000-0000-0000-0000-000000000003'::uuid, 'sell_packages'),
('00000000-0000-0000-0000-000000000003'::uuid, 'create_subscriptions'),
('00000000-0000-0000-0000-000000000003'::uuid, 'view_schedules'),
('00000000-0000-0000-0000-000000000003'::uuid, 'process_payments'),
('00000000-0000-0000-0000-000000000003'::uuid, 'issue_invoices'),
('00000000-0000-0000-0000-000000000003'::uuid, 'create_booking'),
('00000000-0000-0000-0000-000000000003'::uuid, 'edit_booking'),
('00000000-0000-0000-0000-000000000003'::uuid, 'view_reports')
ON CONFLICT DO NOTHING;

-- Coordinator: view schedules, view reports, register visitors (view + confirm only - no create_booking)
INSERT INTO role_permissions (role_id, permission_id) VALUES
('00000000-0000-0000-0000-000000000004'::uuid, 'view_schedules'),
('00000000-0000-0000-0000-000000000004'::uuid, 'register_visitors'),
('00000000-0000-0000-0000-000000000004'::uuid, 'view_reports')
ON CONFLICT DO NOTHING;

-- Employee (service provider): view_schedules only
INSERT INTO role_permissions (role_id, permission_id) VALUES
('00000000-0000-0000-0000-000000000005'::uuid, 'view_schedules')
ON CONFLICT DO NOTHING;

-- Bookings Only (admin_user): manage_bookings, view_reports
INSERT INTO role_permissions (role_id, permission_id) VALUES
('00000000-0000-0000-0000-000000000006'::uuid, 'manage_bookings'),
('00000000-0000-0000-0000-000000000006'::uuid, 'view_reports'),
('00000000-0000-0000-0000-000000000006'::uuid, 'create_booking'),
('00000000-0000-0000-0000-000000000006'::uuid, 'edit_booking'),
('00000000-0000-0000-0000-000000000006'::uuid, 'view_schedules')
ON CONFLICT DO NOTHING;

-- Customer Admin: dashboard, bookings, employees, shifts, package subscribers, reports
INSERT INTO role_permissions (role_id, permission_id) VALUES
('00000000-0000-0000-0000-000000000007'::uuid, 'manage_bookings'),
('00000000-0000-0000-0000-000000000007'::uuid, 'view_reports'),
('00000000-0000-0000-0000-000000000007'::uuid, 'manage_employees'),
('00000000-0000-0000-0000-000000000007'::uuid, 'manage_shifts'),
('00000000-0000-0000-0000-000000000007'::uuid, 'create_booking'),
('00000000-0000-0000-0000-000000000007'::uuid, 'edit_booking'),
('00000000-0000-0000-0000-000000000007'::uuid, 'cancel_booking'),
('00000000-0000-0000-0000-000000000007'::uuid, 'view_schedules'),
('00000000-0000-0000-0000-000000000007'::uuid, 'register_visitors'),
('00000000-0000-0000-0000-000000000007'::uuid, 'sell_packages'),
('00000000-0000-0000-0000-000000000007'::uuid, 'create_subscriptions')
ON CONFLICT DO NOTHING;

-- Backfill role_id for existing users based on current role enum
UPDATE users u
SET role_id = CASE u.role::text
  WHEN 'tenant_admin' THEN '00000000-0000-0000-0000-000000000001'::uuid
  WHEN 'receptionist' THEN '00000000-0000-0000-0000-000000000002'::uuid
  WHEN 'cashier' THEN '00000000-0000-0000-0000-000000000003'::uuid
  WHEN 'coordinator' THEN '00000000-0000-0000-0000-000000000004'::uuid
  WHEN 'employee' THEN '00000000-0000-0000-0000-000000000005'::uuid
  WHEN 'admin_user' THEN '00000000-0000-0000-0000-000000000006'::uuid
  WHEN 'customer_admin' THEN '00000000-0000-0000-0000-000000000007'::uuid
  ELSE NULL
END
WHERE u.role IN ('tenant_admin', 'receptionist', 'cashier', 'coordinator', 'employee', 'admin_user', 'customer_admin')
  AND u.role_id IS NULL;

-- RLS for roles (optional: allow read for authenticated)
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

-- Policies: anyone authenticated can read permissions (registry)
DROP POLICY IF EXISTS "permissions_select_all" ON permissions;
CREATE POLICY "permissions_select_all" ON permissions FOR SELECT TO authenticated USING (true);

-- Roles: users can read built-in (tenant_id NULL) or roles for their tenant
DROP POLICY IF EXISTS "roles_select" ON roles;
CREATE POLICY "roles_select" ON roles FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Role permissions: readable if role is readable
DROP POLICY IF EXISTS "role_permissions_select" ON role_permissions;
CREATE POLICY "role_permissions_select" ON role_permissions FOR SELECT TO authenticated
  USING (
    role_id IN (SELECT id FROM roles WHERE tenant_id IS NULL OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  );

COMMENT ON TABLE permissions IS 'RBAC: Registry of all system permissions';
COMMENT ON TABLE roles IS 'RBAC: Roles (tenant_id NULL = built-in, else tenant-specific)';
COMMENT ON TABLE role_permissions IS 'RBAC: Role to permission mapping';
