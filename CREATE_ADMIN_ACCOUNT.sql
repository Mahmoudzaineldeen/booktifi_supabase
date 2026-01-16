-- ============================================
-- Create Solution Owner Account for Testing
-- ============================================
-- Username: Bookatiadmin
-- Password: Flipper@6722
--
-- INSTRUCTIONS:
-- 1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/0ec90b57d6e95fcbda19832f
-- 2. Navigate to SQL Editor
-- 3. Copy and paste this ENTIRE script
-- 4. Click "Run" or press Ctrl+Enter
-- ============================================

-- Step 1: First, check if database tables exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'ERROR: Tables not found! Please run supabase/setup.sql first.';
  END IF;

  RAISE NOTICE '✅ Database tables verified';
END $$;

-- Step 2: Create the auth user via Supabase Auth
-- NOTE: We cannot create auth users via SQL in Supabase
-- You MUST do this step manually in the Supabase Dashboard:
--
-- Go to: Authentication > Users > Add User
-- Email: bookatiadmin@bookati.local
-- Password: Flipper@6722
-- Auto Confirm User: YES (check this box)
--
-- After creating the auth user, copy the User ID and run Step 3 below

-- Step 3: Insert user profile (replace USER_ID after creating auth user)
-- First, let's see what auth users exist:
SELECT
  id,
  email,
  created_at,
  'Copy this ID to use below' as note
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Now insert the user profile with the ID from above
-- IMPORTANT: Replace 'PASTE-USER-ID-HERE' with actual ID from auth.users above

/*
INSERT INTO public.users (
  id,
  email,
  full_name,
  role,
  is_active,
  tenant_id
)
VALUES (
  'PASTE-USER-ID-HERE'::uuid,  -- Replace with actual auth.users ID
  'bookatiadmin@bookati.local',
  'Bookati Admin',
  'solution_owner',
  true,
  NULL  -- Solution owners don't belong to a tenant
)
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;
*/

-- Step 4: Verify the user was created
SELECT
  u.id,
  u.email,
  u.full_name,
  u.role,
  u.is_active,
  au.email as auth_email,
  au.created_at
FROM public.users u
LEFT JOIN auth.users au ON u.id = au.id
WHERE u.role = 'solution_owner'
ORDER BY u.created_at DESC;

-- ============================================
-- ALTERNATIVE: If you already created the auth user
-- ============================================
-- Run this to automatically link the existing auth user to a profile:

DO $$
DECLARE
  auth_user_id uuid;
BEGIN
  -- Find the auth user by email
  SELECT id INTO auth_user_id
  FROM auth.users
  WHERE email = 'bookatiadmin@bookati.local'
  LIMIT 1;

  IF auth_user_id IS NOT NULL THEN
    -- Insert or update the user profile
    INSERT INTO public.users (
      id,
      email,
      full_name,
      role,
      is_active,
      tenant_id
    )
    VALUES (
      auth_user_id,
      'bookatiadmin@bookati.local',
      'Bookati Admin',
      'solution_owner',
      true,
      NULL
    )
    ON CONFLICT (id) DO UPDATE
    SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active;

    RAISE NOTICE '✅ Solution Owner profile created successfully!';
    RAISE NOTICE 'Email: bookatiadmin@bookati.local';
    RAISE NOTICE 'Password: Flipper@6722';
    RAISE NOTICE 'Login at: /management (NOT /auth/login)';
  ELSE
    RAISE NOTICE '⚠️  Auth user not found!';
    RAISE NOTICE 'Please create the auth user first:';
    RAISE NOTICE '1. Go to Authentication > Users > Add User';
    RAISE NOTICE '2. Email: bookatiadmin@bookati.local';
    RAISE NOTICE '3. Password: Flipper@6722';
    RAISE NOTICE '4. Check "Auto Confirm User"';
    RAISE NOTICE '5. Click "Create User"';
    RAISE NOTICE '6. Run this script again';
  END IF;
END $$;

-- ============================================
-- FINAL CHECK
-- ============================================
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.users
      WHERE email = 'bookatiadmin@bookati.local'
      AND role = 'solution_owner'
    ) THEN '✅ Solution Owner account is ready! You can now login.'
    ELSE '⚠️  Account not created yet. Follow the instructions above.'
  END as status;
