-- ============================================================================
-- RBAC: Enforce permission category matches role category (no mixing)
-- ============================================================================
-- Trigger on role_permissions ensures permission.category = role.category.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_role_permission_category()
RETURNS TRIGGER AS $$
DECLARE
  r_category text;
  p_category text;
BEGIN
  -- Built-in System Admin role is allowed all permissions (admin + employee)
  IF NEW.role_id = '00000000-0000-0000-0000-000000000001'::uuid THEN
    RETURN NEW;
  END IF;

  SELECT category INTO r_category FROM roles WHERE id = NEW.role_id;
  SELECT category INTO p_category FROM permissions WHERE id = NEW.permission_id;
  IF r_category IS NULL OR p_category IS NULL THEN
    RAISE EXCEPTION 'role or permission not found';
  END IF;
  IF r_category != p_category THEN
    RAISE EXCEPTION 'Invalid role configuration. A role cannot include both Admin and Employee permissions.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS role_permissions_category_check ON role_permissions;
CREATE TRIGGER role_permissions_category_check
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION check_role_permission_category();

COMMENT ON FUNCTION check_role_permission_category() IS 'RBAC: Ensures permission category matches role category (admin vs employee)';
