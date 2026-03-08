-- Reset test user (test@gmail.com) to tenant_admin so RBAC validation script can run with single account.
-- Run in Supabase SQL Editor or: psql $DATABASE_URL -f scripts/reset-test-user-to-tenant-admin.sql

UPDATE users
SET role = 'tenant_admin', role_id = NULL
WHERE email = 'test@gmail.com'
  AND tenant_id IS NOT NULL;

-- Verify (optional)
-- SELECT id, email, role, role_id, tenant_id FROM users WHERE email = 'test@gmail.com';
