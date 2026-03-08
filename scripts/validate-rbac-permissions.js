#!/usr/bin/env node

/**
 * RBAC Permission Validation Test Suite
 *
 * Validates that every permission in the system:
 * - Grants only the intended capability
 * - Blocks all other actions (403)
 * - Is enforced by backend APIs
 * - Resolves from DB (no stale JWT)
 *
 * Test account: test@gmail.com / 111111 (must be tenant_admin for setup).
 * This account is assigned different test roles during the run.
 *
 * Usage:
 *   node scripts/validate-rbac-permissions.js
 *   API_BASE_URL=http://localhost:3001 node scripts/validate-rbac-permissions.js
 *
 * Requires: API server running (e.g. cd server && npm run dev)
 */

const API_BASE = process.env.API_BASE_URL || process.env.VITE_API_URL || 'http://localhost:3001';
const API = API_BASE.replace(/\/$/, '') + (API_BASE.includes('/api') ? '' : '/api');
// Admin account: used only for creating roles and assigning them (never has role changed). Must be tenant_admin.
const ADMIN_EMAIL = process.env.TENANT_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'test@gmail.com';
const ADMIN_PASSWORD = process.env.TENANT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '111111';
// Test account: the user that gets different roles assigned; we sign in as this user to verify permissions.
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '111111';
const USE_SINGLE_ACCOUNT = ADMIN_EMAIL === TEST_EMAIL;

// Endpoints that require specific permissions (for "must be blocked" tests).
// When user has only one permission, these (which require OTHER perms) must return 403.
const ENDPOINTS_REQUIRING_PERMISSION = [
  { method: 'POST', path: '/bookings', body: {}, required: ['create_booking', 'manage_bookings'] },
  { method: 'GET', path: '/employees/list', required: ['manage_employees'] },
  { method: 'POST', path: '/roles', body: { name: 'x', category: 'admin', permission_ids: [] }, required: ['manage_roles'] },
  { method: 'GET', path: '/branches', required: ['manage_branches'] },
];

let totalTests = 0;
let passedTests = 0;

function ok(msg) {
  totalTests++;
  passedTests++;
  console.log(`  ✔ ${msg}`);
}

function fail(msg, detail) {
  totalTests++;
  console.log(`  ✗ ${msg}`);
  if (detail) console.log(`    ${detail}`);
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

async function getMyPermissions(token) {
  const res = await fetchWithAuth('/roles/permissions/me', token);
  if (!res.ok) return null;
  const data = await res.json();
  return data.permissions || [];
}

// ---- STEP 1: Load permission list ----
async function step1LoadPermissions(adminToken) {
  console.log('\n--- STEP 1: Load permission list ---');
  const res = await fetchWithAuth('/roles/permissions', adminToken);
  if (!res.ok) {
    fail('GET /roles/permissions', `${res.status} ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  const permissions = data.permissions || [];
  if (permissions.length === 0) {
    fail('Permission list is empty', '');
    return null;
  }
  ok(`Loaded ${permissions.length} permissions`);
  const byCategory = { admin: [], employee: [] };
  for (const p of permissions) {
    if (!p.id || !p.category) {
      fail(`Permission missing id or category`, JSON.stringify(p));
      continue;
    }
    if (p.category !== 'admin' && p.category !== 'employee') {
      fail(`Invalid category for ${p.id}: ${p.category}`);
      continue;
    }
    byCategory[p.category].push(p);
  }
  ok(`Admin: ${byCategory.admin.length}, Employee: ${byCategory.employee.length}`);
  return permissions;
}

// ---- STEP 2: Single-permission test for one permission ----
async function step2SinglePermissionTest(adminToken, adminUser, testUserId, testUserToken, permission, permissionsAll) {
  const { id: permId, category } = permission;
  const roleName = `test_${permId}_${Date.now()}`;
  const tenantId = adminUser.tenant_id;

  // Create role with only this permission (admin token)
  const createRes = await fetchWithAuth('/roles', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      name: roleName,
      description: `Single-perm test: ${permId}`,
      category,
      permission_ids: [permId],
      tenant_id: tenantId || undefined,
    }),
  });
  if (!createRes.ok) {
    fail(`Create role for ${permId}`, `${createRes.status} ${await createRes.text()}`);
    return false;
  }
  const createdRole = await createRes.json();
  const roleId = createdRole.id;

  // Assign role to test user (admin token)
  const legacyRole = category === 'admin' ? 'admin_user' : 'receptionist';
  const assignRes = await fetchWithAuth('/employees/update', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: testUserId,
      role_id: roleId,
      role: legacyRole,
    }),
  });
  if (!assignRes.ok) {
    fail(`Assign role to user for ${permId}`, `${assignRes.status} ${await assignRes.text()}`);
    return false;
  }

  // Use test user token; backend resolveUserFromDb returns fresh permissions from DB
  const tokenToUse = testUserToken || adminToken;
  const myPerms = await getMyPermissions(tokenToUse);
  if (!myPerms || !Array.isArray(myPerms)) {
    fail(`GET /roles/permissions/me for ${permId}`, 'Invalid response');
    return false;
  }
  const expectedOnly = [permId];
  const sortedGot = [...myPerms].sort();
  const sortedExpected = [...expectedOnly].sort();
  if (sortedGot.length !== sortedExpected.length || sortedGot.some((p, i) => p !== sortedExpected[i])) {
    fail(`Permissions for ${permId}`, `Expected exactly [${expectedOnly}], got [${myPerms.join(', ')}]`);
    return false;
  }
  ok(`${permId}: user has only this permission`);

  // Try endpoints that require OTHER permissions -> must get 403 (use test user token)
  for (const ep of ENDPOINTS_REQUIRING_PERMISSION) {
    const required = ep.required || [];
    if (required.length === 0) continue; // no permission required
    if (required.includes(permId)) continue; // this permission would allow it
    const method = ep.method || 'GET';
    const opts = { method };
    if (ep.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) opts.body = JSON.stringify(ep.body);
    const res = await fetchWithAuth(ep.path, tokenToUse, opts);
    if (res.status !== 403 && res.status !== 404) {
      fail(`${permId}: ${method} ${ep.path} should be 403 (missing ${required.join('/')})`, `Got ${res.status}`);
    } else {
      ok(`${permId}: ${method} ${ep.path} correctly ${res.status === 403 ? '403' : 'blocked'}`);
    }
  }

  return true;
}

/** Re-assign test user to the setup role (manage_roles only). Only needed when using single account. */
async function restoreSetupRole(adminToken, testUserId, setupRoleId) {
  const res = await fetchWithAuth('/employees/update', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: testUserId,
      role_id: setupRoleId,
      role: 'admin_user',
    }),
  });
  return res.ok;
}

// ---- STEP 3: Negative test (role with all except one) ----
async function step3NegativeTest(adminToken, adminUser, testUserId, testUserToken, excludePermissionId, permissionsAll) {
  console.log(`\n--- STEP 3: Negative test (all except ${excludePermissionId}) ---`);
  const permsWithout = (permissionsAll || []).filter((p) => p.id !== excludePermissionId);
  const category = excludePermissionId === 'cancel_booking' ? 'employee' : (permissionsAll.find((p) => p.id === excludePermissionId) || {}).category || 'admin';
  const permIds = permsWithout.filter((p) => p.category === category).map((p) => p.id);
  if (permIds.length === 0) {
    console.log('  Skip: no other permissions in same category');
    return;
  }

  const roleName = `test_no_${excludePermissionId}_${Date.now()}`;
  const createRes = await fetchWithAuth('/roles', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      name: roleName,
      description: `All except ${excludePermissionId}`,
      category,
      permission_ids: permIds.slice(0, 5),
      tenant_id: adminUser.tenant_id || undefined,
    }),
  });
  if (!createRes.ok) {
    fail(`Create role (all except ${excludePermissionId})`, await createRes.text());
    return;
  }
  const role = await createRes.json();
  const assignRes = await fetchWithAuth('/employees/update', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: testUserId,
      role_id: role.id,
      role: category === 'admin' ? 'admin_user' : 'receptionist',
    }),
  });
  if (!assignRes.ok) {
    fail('Assign role', await assignRes.text());
    return;
  }
  const token = testUserToken || adminToken;
  const myPerms = await getMyPermissions(token);
  if (myPerms && myPerms.includes(excludePermissionId)) {
    fail(`User must NOT have ${excludePermissionId}`, `Got: ${myPerms.join(', ')}`);
  } else {
    ok(`User does not have ${excludePermissionId}`);
  }
  if (excludePermissionId === 'cancel_booking') {
    const res = await fetchWithAuth('/bookings', token, { method: 'POST', body: JSON.stringify({}) });
    if (res.status !== 403 && res.status !== 400 && res.status !== 404) {
      fail('POST /bookings without create_booking should be 403 or 400', `Got ${res.status}`);
    } else {
      ok('POST /bookings correctly blocked');
    }
  }
}

// ---- STEP 6: Role switch ----
async function step6RoleSwitch(adminToken, adminUser, testUserId, testUserToken, permissionsAll) {
  console.log('\n--- STEP 6: Role switch test ---');
  const firstPerm = (permissionsAll || []).find((p) => p.category === 'employee');
  if (!firstPerm) {
    console.log('  Skip: no employee permission');
    return;
  }
  const roleName1 = `switch_a_${Date.now()}`;
  const create1 = await fetchWithAuth('/roles', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      name: roleName1,
      category: 'employee',
      permission_ids: [firstPerm.id],
      tenant_id: adminUser.tenant_id,
    }),
  });
  if (!create1.ok) return;
  const role1 = (await create1.json()).id;
  await fetchWithAuth('/employees/update', adminToken, {
    method: 'POST',
    body: JSON.stringify({ employee_id: testUserId, role_id: role1, role: 'receptionist' }),
  });
  const token = testUserToken || adminToken;
  const perms1 = await getMyPermissions(token);
  if (!perms1 || !perms1.includes(firstPerm.id)) {
    fail('After assign role A, permissions should include ' + firstPerm.id, `Got: ${(perms1 || []).join(', ')}`);
    return;
  }
  ok('Role A assigned, permissions include ' + firstPerm.id);

  const secondPerm = (permissionsAll || []).filter((p) => p.category === 'employee' && p.id !== firstPerm.id)[0];
  if (!secondPerm) return;
  const roleName2 = `switch_b_${Date.now()}`;
  const create2 = await fetchWithAuth('/roles', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      name: roleName2,
      category: 'employee',
      permission_ids: [secondPerm.id],
      tenant_id: adminUser.tenant_id,
    }),
  });
  if (!create2.ok) return;
  const role2 = (await create2.json()).id;
  await fetchWithAuth('/employees/update', adminToken, {
    method: 'POST',
    body: JSON.stringify({ employee_id: testUserId, role_id: role2, role: 'receptionist' }),
  });
  const perms2 = await getMyPermissions(token);
  if (perms2 && perms2.includes(firstPerm.id) && !perms2.includes(secondPerm.id)) {
    fail('After switch to role B, should not have role A permission', `Got: ${perms2.join(', ')}`);
  } else if (perms2 && perms2.includes(secondPerm.id)) {
    ok('Role switch: permissions updated to role B');
  }
}

// ---- STEP 7: Category validation (mixed admin+employee rejected) ----
async function step7CategoryValidation(adminToken, adminUser, permissionsAll) {
  console.log('\n--- STEP 7: Category validation (mixed permissions rejected) ---');
  const adminPerm = (permissionsAll || []).find((p) => p.category === 'admin');
  const employeePerm = (permissionsAll || []).find((p) => p.category === 'employee');
  if (!adminPerm || !employeePerm) {
    console.log('  Skip: need both admin and employee permissions');
    return;
  }
  const createRes = await fetchWithAuth('/roles', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      name: `mixed_${Date.now()}`,
      category: 'admin',
      permission_ids: [adminPerm.id, employeePerm.id],
      tenant_id: adminUser.tenant_id,
    }),
  });
  if (createRes.status === 400) {
    ok('Mixed category role correctly rejected (400)');
  } else if (createRes.ok) {
    const data = await createRes.json();
    if (data.permission_ids && data.permission_ids.includes(employeePerm.id)) {
      fail('Role with mixed categories should be rejected', 'Server accepted admin + employee permissions');
    } else {
      ok('Server filtered to same category only');
    }
  } else {
    fail('Expected 400 for mixed category', `Got ${createRes.status}`);
  }
}

// ---- STEP 8: Built-in role safety ----
async function step8BuiltInRole(adminToken, adminUser, testUserId, permissionsAll) {
  console.log('\n--- STEP 8: Built-in role safety ---');
  const BUILTIN_RECEPTIONIST = '00000000-0000-0000-0000-000000000002';
  await fetchWithAuth('/employees/update', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: testUserId,
      role_id: BUILTIN_RECEPTIONIST,
      role: 'receptionist',
    }),
  });
  const testToken = (ADMIN_EMAIL !== TEST_EMAIL) ? (await signIn(TEST_EMAIL, TEST_PASSWORD)).token : adminToken;
  const perms = await getMyPermissions(testToken);
  const expectedReceptionist = ['create_booking', 'edit_booking', 'cancel_booking', 'sell_packages', 'register_visitors', 'view_schedules', 'process_payments', 'issue_invoices', 'view_reports'];
  const hasExpected = expectedReceptionist.every((p) => perms && perms.includes(p));
  if (hasExpected) {
    ok('Built-in Receptionist role has expected permissions');
  } else {
    fail('Built-in Receptionist', `Expected subset of [${expectedReceptionist.join(', ')}], got [${(perms || []).join(', ')}]`);
  }
}

async function main() {
  console.log('=== RBAC Permission Validation ===');
  console.log(`API: ${API}`);
  console.log(`Admin/Test account: ${ADMIN_EMAIL}`);

  let adminToken, adminUser, testUserId, testUserToken;
  try {
    const signInRes = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    adminToken = signInRes.token;
    adminUser = signInRes.user;
    console.log('  Admin signed in. User id:', adminUser.id, '| tenant_id:', adminUser.tenant_id);
  } catch (e) {
    console.error('Admin sign in failed:', e.message);
    if (e.message.includes('fetch failed') || e.message.includes('ECONNREFUSED')) {
      console.error('Ensure API is running: cd server && npm run dev');
    }
    process.exit(1);
  }

  if (!USE_SINGLE_ACCOUNT) {
    try {
      const testRes = await signIn(TEST_EMAIL, TEST_PASSWORD);
      testUserId = testRes.user.id;
      testUserToken = testRes.token;
      console.log('  Test user signed in. id:', testUserId);
    } catch (e) {
      console.error('Test user sign in failed:', e.message);
      process.exit(1);
    }
  } else {
    testUserId = adminUser.id;
    testUserToken = adminToken;
    console.log('  Using single account (admin = test user).');
  }

  const permissions = await step1LoadPermissions(adminToken);
  if (!permissions) {
    console.log('\nAborting: could not load permissions.');
    process.exit(1);
  }

  // Create a "setup" role with only manage_roles (so when using single account we can restore test user to it)
  const manageRolesPerm = permissions.find((p) => p.id === 'manage_roles');
  if (!manageRolesPerm) {
    console.log('\nAborting: manage_roles permission not found.');
    process.exit(1);
  }
  const setupRoleName = `rbac_setup_${Date.now()}`;
  const createSetupRes = await fetchWithAuth('/roles', adminToken, {
    method: 'POST',
    body: JSON.stringify({
      name: setupRoleName,
      description: 'Setup role for RBAC tests',
      category: 'admin',
      permission_ids: ['manage_roles'],
      tenant_id: adminUser.tenant_id || undefined,
    }),
  });
  if (!createSetupRes.ok) {
    console.log('\nSetup role create failed:', await createSetupRes.text());
    console.log('Admin account must be tenant_admin (or have manage_roles) to run this script.');
    console.log('');
    console.log('To fix (single account): reset test user to tenant_admin, then re-run:');
    console.log('  node scripts/reset-test-user-to-tenant-admin.js');
    console.log('');
    console.log('Or use two accounts (admin never has role changed):');
    console.log('  TENANT_ADMIN_EMAIL=admin@example.com TENANT_ADMIN_PASSWORD=... TEST_EMAIL=test@gmail.com TEST_PASSWORD=111111 node scripts/validate-rbac-permissions.js');
    process.exit(1);
  }
  const setupRoleId = (await createSetupRes.json()).id;
  if (USE_SINGLE_ACCOUNT) {
    await fetchWithAuth('/employees/update', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        employee_id: testUserId,
        role_id: setupRoleId,
        role: 'admin_user',
      }),
    });
    console.log('  Setup role (manage_roles only) assigned to test user.');
  }

  // STEP 2: Single-permission tests
  const runAll = process.env.RUN_ALL === '1' || process.env.RUN_ALL === 'true';
  const adminPerms = permissions.filter((p) => p.category === 'admin');
  const employeePerms = permissions.filter((p) => p.category === 'employee');
  const toTest = runAll
    ? permissions
    : [...adminPerms.slice(0, 3), ...employeePerms.slice(0, 3)];

  console.log('\n--- STEP 2: Single-permission tests ---');
  for (const perm of toTest) {
    if (!USE_SINGLE_ACCOUNT) {
      testUserToken = (await signIn(TEST_EMAIL, TEST_PASSWORD)).token;
    }
    await step2SinglePermissionTest(adminToken, adminUser, testUserId, testUserToken, perm, permissions);
    if (USE_SINGLE_ACCOUNT) {
      await restoreSetupRole(adminToken, testUserId, setupRoleId);
    }
  }
  if (!runAll && permissions.length > 6) {
    console.log(`  (Run with RUN_ALL=1 to test all ${permissions.length} permissions)`);
  }

  if (USE_SINGLE_ACCOUNT) await restoreSetupRole(adminToken, testUserId, setupRoleId);
  await step3NegativeTest(adminToken, adminUser, testUserId, testUserToken, 'cancel_booking', permissions);
  if (USE_SINGLE_ACCOUNT) await restoreSetupRole(adminToken, testUserId, setupRoleId);
  await step6RoleSwitch(adminToken, adminUser, testUserId, testUserToken, permissions);
  if (USE_SINGLE_ACCOUNT) await restoreSetupRole(adminToken, testUserId, setupRoleId);
  await step7CategoryValidation(adminToken, adminUser, permissions);
  await step8BuiltInRole(adminToken, adminUser, testUserId, permissions);

  console.log('\n--- Summary ---');
  console.log(`  Passed: ${passedTests}/${totalTests}`);
  if (passedTests < totalTests) {
    process.exit(1);
  }
  console.log('  All RBAC permission checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
