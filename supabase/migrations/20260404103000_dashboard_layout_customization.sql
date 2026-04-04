-- Dashboard customization: permission + per-user layout persistence

INSERT INTO permissions (id, name, description, category)
VALUES ('customize_dashboard', 'Customize dashboard', 'Reorder, resize, show/hide dashboard widgets', 'admin')
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

-- Grant for built-in admin roles
INSERT INTO role_permissions (role_id, permission_id) VALUES
('00000000-0000-0000-0000-000000000001'::uuid, 'customize_dashboard'),
('00000000-0000-0000-0000-000000000006'::uuid, 'customize_dashboard'),
('00000000-0000-0000-0000-000000000007'::uuid, 'customize_dashboard')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout_key TEXT NOT NULL DEFAULT 'tenant_admin_home',
  layout_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, layout_key)
);

CREATE INDEX IF NOT EXISTS idx_user_dashboard_layouts_tenant_user
  ON user_dashboard_layouts (tenant_id, user_id);

CREATE OR REPLACE FUNCTION set_user_dashboard_layouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_dashboard_layouts_updated_at ON user_dashboard_layouts;
CREATE TRIGGER trg_user_dashboard_layouts_updated_at
BEFORE UPDATE ON user_dashboard_layouts
FOR EACH ROW
EXECUTE FUNCTION set_user_dashboard_layouts_updated_at();
