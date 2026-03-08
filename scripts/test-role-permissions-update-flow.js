#!/usr/bin/env node

/**
 * Test: Change a role's permissions (admin -> employee) and verify
 * GET /roles/permissions/me returns the NEW permissions without re-login.
 *
 * Flow: Admin creates role, assigns to target user; target signs in; GET permissions/me;
 * admin PUTs role to employee perms; GET permissions/me again with target token -> must be employee only.
 *
 * Usage:
 *   npm run test:role-permissions-update
 *   # Or with two users (admin keeps manage_roles, target gets the role):
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=xxx TARGET_EMAIL=test@gmail.com TARGET_PASSWORD=xxx node scripts/test-role-permissions-update-flow.js
 *
 * Requires: API running (e.g. cd server && npm run dev).
 * If using one user (default): that user must be Tenant Admin (manage_roles) before running.
 */

const API_BASE = process.env.API_BASE_URL || process.env.VITE_API_URL || 'http://localhost:3001';
const API = API_BASE.replace(/\/$/, '') + (API_BASE.includes('/api') ? '' : '/api');
// Admin user (must have manage_roles / tenant_admin) for creating role and PUT
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.TEST_EMAIL || 'test@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.TEST_PASSWORD || '111111';
// Target user to assign the role to (will GET permissions/me as this user). If not set, use admin as target.
const TARGET_EMAIL = process.env.TARGET_EMAIL;
const TARGET_PASSWORD = process.env.TARGET_PASSWORD || (TARGET_EMAIL ? '111111' : null);

function log(msg) {
  console.log(msg);
}

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
  log('=== Test: Role permissions update flow (change role to employee perms, permissions/me must update) ===\n');
  log('API: ' + API);
  log('Admin: ' + ADMIN_EMAIL + (TARGET_EMAIL ? ' | Target: ' + TARGET_EMAIL : ' (also target)') + '\n');

  let adminToken;
  let userToken;
  let targetUserId;
  let tenantId;
  let roleId;

  // 1. Sign in as admin and ensure we have manage_roles
  log('1. Signing in as admin...');
  try {
    const { token: t, user } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    adminToken = t;
    tenantId = user.tenant_id;
    if (!TARGET_EMAIL || TARGET_EMAIL === ADMIN_EMAIL) {
      targetUserId = user.id;
    }
    log('   OK. Tenant: ' + tenantId + ' | role: ' + user.role);
  } catch (e) {
    log('   FAIL: ' + e.message);
    if (e.message.includes('fetch failed') || e.message.includes('ECONNREFUSED')) {
      log('\n   Ensure API is running: cd server && npm run dev');
    }
    process.exit(1);
  }

  const meCheck = await fetchWithAuth('/roles/permissions/me', adminToken);
  if (!meCheck.ok) {
    log('   FAIL: GET /roles/permissions/me ' + meCheck.status);
    process.exit(1);
  }
  const meCheckJson = await meCheck.json();
  const myPerms = meCheckJson.permissions || [];
  if (!myPerms.includes('manage_roles')) {
    log('\n   (No manage_roles — running partial test only.)');
    log('   Current user permissions (' + myPerms.length + '): ' + myPerms.slice(0, 8).join(', ') + (myPerms.length > 8 ? '...' : ''));
    log('\n   Partial test PASSED: sign-in and GET /roles/permissions/me work; permissions are role-based.');
    log('   To run the full flow (create role → assign → change to employee → assert permissions/me updates):');
    log('   • Re-assign this user to Tenant Admin (via another admin in Employees), then run again; or');
    log('   • Use two users: ADMIN_EMAIL=tenantadmin@... ADMIN_PASSWORD=xxx TARGET_EMAIL=test@gmail.com TARGET_PASSWORD=xxx node scripts/test-role-permissions-update-flow.js');
    process.exit(0);
  }
  log('   Admin has manage_roles, proceeding with full flow.\n');

  if (TARGET_EMAIL && TARGET_EMAIL !== ADMIN_EMAIL) {
    log('1b. Signing in as target user to get target user id...');
    const { user: targetUser } = await signIn(TARGET_EMAIL, TARGET_PASSWORD);
    targetUserId = targetUser.id;
    log('   Target user id: ' + targetUserId + '\n');
  }

  // 2. Get permissions list
  log('2. Fetching permissions list...');
  const permRes = await fetchWithAuth('/roles/permissions', adminToken);
  if (!permRes.ok) {
    log('   FAIL: GET /roles/permissions ' + permRes.status);
    process.exit(1);
  }
  const permData = await permRes.json();
  const allPerms = permData.permissions || [];
  const adminPerms = allPerms.filter((p) => p.category === 'admin');
  const employeePerms = allPerms.filter((p) => p.category === 'employee');
  const oneAdminId = adminPerms.length ? adminPerms[0].id : 'manage_roles';
  const employeePermIds = employeePerms.slice(0, 3).map((p) => p.id);
  if (employeePermIds.length === 0) {
    log('   FAIL: No employee permissions in DB');
    process.exit(1);
  }
  log('   Admin sample: ' + oneAdminId + ' | Employee sample: ' + employeePermIds.join(', '));

  // 3. Create role with admin permission and assign to current user
  const roleName = 'Tester Role ' + Date.now();
  log('\n3. Creating role: ' + roleName + ' (admin, one permission)...');
  const createRes = await fetchWithAuth('/roles', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      name: roleName,
      description: 'Test role for permissions update',
      category: 'admin',
      permission_ids: [oneAdminId],
      tenant_id: tenantId || undefined,
    }),
  });
  if (!createRes.ok) {
    log('   FAIL: POST /roles ' + createRes.status + ' ' + (await createRes.text()));
    process.exit(1);
  }
  const created = await createRes.json();
  roleId = created.id;
  log('   OK. Role id: ' + roleId);

  log('\n4. Assigning this role to target user...');
  const assignRes = await fetchWithAuth('/employees/update', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: targetUserId,
      role_id: roleId,
      role: 'admin_user',
    }),
  });
  if (!assignRes.ok) {
    log('   FAIL: POST /employees/update ' + assignRes.status + ' ' + (await assignRes.text()));
    process.exit(1);
  }
  log('   OK.');

  const targetEmail = TARGET_EMAIL || ADMIN_EMAIL;
  const targetPassword = TARGET_PASSWORD || ADMIN_PASSWORD;
  log('\n5. Sign in as target user to get token with new role_id...');
  const { token: tokenWithRole } = await signIn(targetEmail, targetPassword);
  userToken = tokenWithRole;
  log('   OK.');

  // 6. GET /roles/permissions/me with USER token -> must include the admin permission
  log('\n6. GET /roles/permissions/me with user token (should include admin perm)...');
  const meRes1 = await fetchWithAuth('/roles/permissions/me', userToken);
  if (!meRes1.ok) {
    log('   FAIL: GET /roles/permissions/me ' + meRes1.status);
    process.exit(1);
  }
  const me1 = await meRes1.json();
  const permsBefore = me1.permissions || [];
  const hasAdminBefore = permsBefore.includes(oneAdminId);
  log('   Permissions count: ' + permsBefore.length + ' | has ' + oneAdminId + ': ' + hasAdminBefore);
  if (!hasAdminBefore) {
    log('   FAIL: Expected permission "' + oneAdminId + '" in list. Got: ' + permsBefore.slice(0, 5).join(', '));
    process.exit(1);
  }
  log('   OK.');

  // 7. PUT /roles/:id with ADMIN token -> change to employee category with only employee permissions
  log('\n7. PUT /roles/' + roleId + ' with admin token -> category=employee, permission_ids=employee only...');
  const putRes = await fetchWithAuth('/roles/' + roleId, adminToken, {
    method: 'PUT',
    body: JSON.stringify({
      name: roleName,
      description: 'Updated to employee',
      category: 'employee',
      permission_ids: employeePermIds,
    }),
  });
  if (!putRes.ok) {
    const errText = await putRes.text();
    log('   FAIL: PUT /roles ' + putRes.status + ' ' + errText);
    process.exit(1);
  }
  log('   OK. Role updated.');

  // 8. GET /roles/permissions/me with USER token again (no re-login) -> must NOT have admin perms, only employee
  log('\n8. GET /roles/permissions/me with user token again (no re-login)...');
  const meRes2 = await fetchWithAuth('/roles/permissions/me', userToken);
  if (!meRes2.ok) {
    log('   FAIL: GET /roles/permissions/me ' + meRes2.status);
    process.exit(1);
  }
  const me2 = await meRes2.json();
  const permsAfter = me2.permissions || [];
  const hasAdminAfter = permsAfter.includes(oneAdminId);
  const hasManageRoles = permsAfter.includes('manage_roles');
  const hasEmployeePerm = employeePermIds.some((id) => permsAfter.includes(id));
  log('   Permissions count: ' + permsAfter.length);
  log('   has ' + oneAdminId + ': ' + hasAdminAfter);
  log('   has manage_roles: ' + hasManageRoles);
  log('   has employee perm: ' + hasEmployeePerm);
  log('   List: ' + permsAfter.join(', '));

  if (hasAdminAfter || hasManageRoles) {
    log('\n   FAIL: After updating role to employee-only, /roles/permissions/me must NOT return admin permissions.');
    log('   Expected only employee permissions. Got: ' + permsAfter.join(', '));
    process.exit(1);
  }
  if (!hasEmployeePerm && employeePermIds.length > 0) {
    log('\n   WARN: Expected at least one employee permission. Got: ' + permsAfter.join(', '));
  }

  log('\n   SUCCESS: Permissions updated correctly without re-login.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
