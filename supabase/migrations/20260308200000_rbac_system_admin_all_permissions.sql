-- ============================================================================
-- RBAC: Ensure System Admin built-in role has ALL permissions
-- ============================================================================
-- Idempotent: assigns every permission in the registry to the fixed Admin role
-- so the built-in admin always has full credentials (including any new permissions added later).
-- ============================================================================

-- System Admin role UUID (must match 20260308000000_rbac_roles_and_permissions.sql)
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, id FROM permissions
ON CONFLICT (role_id, permission_id) DO NOTHING;
