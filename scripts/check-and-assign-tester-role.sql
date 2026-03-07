-- ============================================================================
-- Check role for a user and optionally assign "Tester" role (cancel_booking only)
-- ============================================================================
-- 1. Replace 'test@gmail.com' below with your user email (e.g. testWgmail.com if different)
-- 2. Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================================

-- ---------- STEP 1: Check current role (run this first) ----------
SELECT
  u.id,
  u.email,
  u.full_name,
  u.role AS legacy_role,
  u.role_id,
  r.name AS role_name,
  r.category AS role_category
FROM users u
LEFT JOIN roles r ON r.id = u.role_id
WHERE u.email = 'test@gmail.com';  -- change email here

-- ---------- STEP 2: List permissions for this user ----------
SELECT rp.permission_id
FROM role_permissions rp
JOIN users u ON u.role_id = rp.role_id
WHERE u.email = 'test@gmail.com';  -- change email here

-- ---------- STEP 3: Assign Tester role (run after changing email in the block below) ----------
-- Creates "Tester" role with only cancel_booking for the user's tenant, then assigns it to the user.
DO $$
DECLARE
  v_email text := 'test@gmail.com';  -- CHANGE THIS to your user email (e.g. testWgmail.com)
  v_user_id uuid;
  v_tenant_id uuid;
  v_tester_role_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_user_id, v_tenant_id
  FROM users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found with email: %', v_email;
  END IF;

  -- Find existing Tester role for this tenant
  SELECT id INTO v_tester_role_id
  FROM roles
  WHERE tenant_id = v_tenant_id AND name = 'Tester'
  LIMIT 1;

  IF v_tester_role_id IS NULL THEN
    INSERT INTO roles (tenant_id, name, description, category, is_active)
    VALUES (v_tenant_id, 'Tester', 'Can only cancel bookings', 'employee', true)
    RETURNING id INTO v_tester_role_id;

    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (v_tester_role_id, 'cancel_booking');
  END IF;

  UPDATE users
  SET role_id = v_tester_role_id,
      role = 'receptionist'
  WHERE id = v_user_id;

  RAISE NOTICE 'User % now has Tester role (cancel_booking only). Legacy role set to receptionist for bookings list access.', v_email;
END $$;
