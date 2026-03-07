#!/usr/bin/env node

/**
 * Test: Create a role with admin permissions, assign it to test@gmail.com,
 * then assign an employee role (Receptionist) to the same user.
 *
 * Verifies that switching from admin-type role to employee-type role persists
 * correctly (role + role_id) and that the user is shown as Receptionist after.
 *
 * Usage: node scripts/test-employee-role-assign-admin-then-employee.js
 * Requires: API running (e.g. cd server && npm run dev), test account test@gmail.com / 111111
 */

const API_BASE = process.env.API_BASE_URL || process.env.VITE_API_URL || 'http://localhost:3001';
const API = API_BASE.replace(/\/$/, '') + (API_BASE.includes('/api') ? '' : '/api');
const EMAIL = process.env.TEST_EMAIL || 'test@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || '111111';

const BUILTIN_RECEPTIONIST_ROLE_ID = '00000000-0000-0000-0000-000000000002';

async function signIn(email, password) {
  const res = await fetch(`${API}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sign in failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const token = data?.session?.access_token || data?.token || data?.access_token;
  const user = data?.user;
  if (!token || !user?.id) throw new Error('Sign in response missing token or user.id');
  return { token, user };
}

async function fetchWithAuth(path, token, options = {}) {
  const url = path.startsWith('http') ? path : `${API}${path.startsWith('/') ? path : '/' + path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

async function main() {
  console.log('=== Test: Assign admin role then employee role to test@gmail.com ===\n');
  console.log(`API: ${API}`);
  console.log(`Email: ${EMAIL}\n`);

  let token;
  let userId;
  let tenantId;

  // 1. Sign in as test@gmail.com
  console.log('1. Signing in as', EMAIL, '...');
  try {
    const { token: t, user } = await signIn(EMAIL, PASSWORD);
    token = t;
    userId = user.id;
    tenantId = user.tenant_id;
    console.log('   OK. User id:', userId, '| role:', user.role, '| role_id:', user.role_id || '(null)');
  } catch (e) {
    console.error('   FAIL:', e.message);
    if (e.message.includes('fetch failed') || e.message.includes('ECONNREFUSED')) {
      console.error('\n   Make sure the API server is running (e.g. cd server && npm run dev).');
      console.error('   If the server fails to start, set APP_URL or ZOHO_REDIRECT_URI in server/.env.');
    }
    process.exit(1);
  }

  // 2. Get admin permissions
  console.log('\n2. Fetching permissions (admin)...');
  const permRes = await fetchWithAuth('/roles/permissions', token);
  if (!permRes.ok) {
    console.error('   FAIL: GET /roles/permissions', permRes.status, await permRes.text());
    process.exit(1);
  }
  const permData = await permRes.json();
  const permissions = permData.permissions || [];
  const adminPerms = permissions.filter((p) => p.category === 'admin');
  const oneAdminId = adminPerms.length ? adminPerms[0].id : 'manage_roles';
  console.log('   Using admin permission:', oneAdminId);

  // 3. Create a role with admin permissions
  const roleName = 'Test Admin Role ' + Date.now();
  console.log('\n3. Creating role:', roleName, '(admin)...');
  const createRoleRes = await fetchWithAuth('/roles', token, {
    method: 'POST',
    body: JSON.stringify({
      name: roleName,
      description: 'Test role for assign-admin-then-employee',
      category: 'admin',
      permission_ids: [oneAdminId],
      tenant_id: tenantId || undefined,
    }),
  });
  if (!createRoleRes.ok) {
    const errText = await createRoleRes.text();
    console.error('   FAIL: POST /roles', createRoleRes.status, errText);
    process.exit(1);
  }
  const createdRole = await createRoleRes.json();
  const customAdminRoleId = createdRole.id;
  console.log('   OK. Role id:', customAdminRoleId);

  // 4. Assign this admin role to test@gmail.com (current user)
  console.log('\n4. Assigning admin role to', EMAIL, '...');
  const assignAdminRes = await fetchWithAuth('/employees/update', token, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: userId,
      role_id: customAdminRoleId,
      role: 'admin_user',
    }),
  });
  if (!assignAdminRes.ok) {
    const errText = await assignAdminRes.text();
    console.error('   FAIL: POST /employees/update (assign admin)', assignAdminRes.status, errText);
    process.exit(1);
  }
  const assignAdminBody = await assignAdminRes.json();
  console.log('   OK.', assignAdminBody.message || 'Updated.');

  // 5. Sign in again to get fresh user (with new role from DB)
  console.log('\n5. Signing in again to read current role...');
  const { user: userAfterAdmin } = await signIn(EMAIL, PASSWORD);
  console.log('   role:', userAfterAdmin.role, '| role_id:', userAfterAdmin.role_id);
  if (userAfterAdmin.role_id !== customAdminRoleId) {
    console.warn('   WARN: role_id expected', customAdminRoleId, 'got', userAfterAdmin.role_id);
  }

  // 6. Assign employee role (Receptionist) to the same user
  console.log('\n6. Assigning employee role (Receptionist) to', EMAIL, '...');
  const assignReceptionistRes = await fetchWithAuth('/employees/update', token, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: userId,
      role: 'receptionist',
      role_id: BUILTIN_RECEPTIONIST_ROLE_ID,
    }),
  });
  if (!assignReceptionistRes.ok) {
    const errText = await assignReceptionistRes.text();
    console.error('   FAIL: POST /employees/update (assign Receptionist)', assignReceptionistRes.status, errText);
    process.exit(1);
  }
  const assignReceptionistBody = await assignReceptionistRes.json();
  console.log('   OK.', assignReceptionistBody.message || 'Updated.');

  // 7. Sign in again and verify user is Receptionist
  console.log('\n7. Signing in again to verify final role...');
  const { user: userFinal } = await signIn(EMAIL, PASSWORD);
  console.log('   role:', userFinal.role, '| role_id:', userFinal.role_id);

  const expectedRoleId = BUILTIN_RECEPTIONIST_ROLE_ID;
  const roleOk = userFinal.role === 'receptionist' && userFinal.role_id === expectedRoleId;
  if (roleOk) {
    console.log('\n✅ SUCCESS: User is now receptionist with correct role_id.');
  } else {
    console.error('\n❌ FAIL: Expected role=receptionist and role_id=' + expectedRoleId);
    console.error('   Got role=' + userFinal.role + ', role_id=' + userFinal.role_id);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
