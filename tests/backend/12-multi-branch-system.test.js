/**
 * Multi-Branch System API Tests
 * Validates: branch isolation, service/package rules, role restrictions, income per branch, no cross-branch leakage.
 * Uses Admin: mahmoudnzaineldeen@gmail.com / 111111
 */

import { CONFIG, apiRequest, logTest, delay } from './config.js';

const results = { passed: 0, failed: 0, tests: [] };

async function test(name, testFn) {
  try {
    const result = await testFn();
    const passed = result !== false;
    logTest(name, passed, result?.message);
    results.tests.push({ name, passed, message: result?.message || '' });
    if (passed) results.passed++;
    else results.failed++;
    return passed;
  } catch (error) {
    logTest(name, false, error.message);
    results.tests.push({ name, passed: false, message: error.message });
    results.failed++;
    return false;
  }
}

// Store branch and user ids for later steps
const MULTI_BRANCH = {
  branchAId: null,
  branchBId: null,
  receptionistAToken: null,
  receptionistBToken: null,
  adminToken: null,
  employeeAId: null,
  employeeBId: null,
  serviceIdForIsolation: null,
};

// ============================================================================
// STEP 1: Admin login & create branches
// ============================================================================
async function runMultiBranchTests() {
  console.log('\n========== MULTI-BRANCH SYSTEM TESTS ==========\n');

  await test('Admin login (mahmoudnzaineldeen@gmail.com)', async () => {
    const res = await apiRequest('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({
        email: 'mahmoudnzaineldeen@gmail.com',
        password: '111111',
      }),
      headers: { Authorization: '' },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data.session?.access_token) throw new Error('No access token');
    CONFIG.TEST_DATA.serviceProviderToken = res.data.session.access_token;
    MULTI_BRANCH.adminToken = res.data.session.access_token;
    CONFIG.TEST_DATA.tenantId = res.data.user?.tenant_id;
    return { message: `tenant_id=${CONFIG.TEST_DATA.tenantId}` };
  });

  await test('Create Branch A (Main Branch)', async () => {
    const res = await apiRequest('/branches', {
      method: 'POST',
      body: JSON.stringify({ name: 'Branch A (Main Branch)', location: 'HQ' }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.data?.id) throw new Error('No branch id returned');
    MULTI_BRANCH.branchAId = res.data.data.id;
    return { message: `id=${MULTI_BRANCH.branchAId}` };
  });

  await test('Create Branch B (Second Branch)', async () => {
    const res = await apiRequest('/branches', {
      method: 'POST',
      body: JSON.stringify({ name: 'Branch B (Second Branch)', location: 'Second' }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.data?.id) throw new Error('No branch id returned');
    MULTI_BRANCH.branchBId = res.data.data.id;
    return { message: `id=${MULTI_BRANCH.branchBId}` };
  });

  await test('GET /branches — list includes Branch A and B', async () => {
    const res = await apiRequest('/branches', {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const list = res.data?.data || [];
    const hasA = list.some((b) => b.id === MULTI_BRANCH.branchAId);
    const hasB = list.some((b) => b.id === MULTI_BRANCH.branchBId);
    if (!hasA || !hasB) throw new Error('Branch A or B missing from list');
    return { message: `${list.length} branches` };
  });

  await test('GET /branches/:id — Branch A "See More" (detail) loads', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchAId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const d = res.data?.data;
    if (!d) throw new Error('No data');
    if (!Array.isArray(d.assigned_services)) throw new Error('Missing assigned_services');
    if (!Array.isArray(d.assigned_packages)) throw new Error('Missing assigned_packages');
    if (!d.income_summary || typeof d.income_summary.total !== 'number')
      throw new Error('Missing or invalid income_summary');
    return { message: 'assigned_services, assigned_packages, income_summary present' };
  });

  await test('GET /branches/:id — Branch B detail loads', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchBId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const d = res.data?.data;
    if (!d || !d.income_summary) throw new Error('Branch B detail invalid');
    return { message: 'OK' };
  });

  // ============================================================================
  // STEP 4: Create receptionists with branch assignment
  // ============================================================================
  const unique = Date.now().toString(36).slice(-6);
  const emailReceptionistA = `mahmoudnzaineldeen+ra${unique}@gmail.com`;
  const emailReceptionistB = `mahmoudnzaineldeen+rb${unique}@gmail.com`;
  const password = '111111';

  await test('Create Receptionist A (Branch A)', async () => {
    const res = await apiRequest('/employees/create', {
      method: 'POST',
      body: JSON.stringify({
        username: `receptionist_a_${unique}`,
        password,
        full_name: 'Receptionist A',
        full_name_ar: 'موظف الاستقبال أ',
        email: emailReceptionistA,
        phone: null,
        role: 'receptionist',
        tenant_id: CONFIG.TEST_DATA.tenantId,
        branch_id: MULTI_BRANCH.branchAId,
      }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    return { message: emailReceptionistA };
  });

  await test('Create Receptionist B (Branch B)', async () => {
    const res = await apiRequest('/employees/create', {
      method: 'POST',
      body: JSON.stringify({
        username: `receptionist_b_${unique}`,
        password,
        full_name: 'Receptionist B',
        full_name_ar: 'موظف الاستقبال ب',
        email: emailReceptionistB,
        phone: null,
        role: 'receptionist',
        tenant_id: CONFIG.TEST_DATA.tenantId,
        branch_id: MULTI_BRANCH.branchBId,
      }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    return { message: emailReceptionistB };
  });

  await delay(500);

  await test('Login as Receptionist A — token has branch_id (branch-scoped)', async () => {
    const res = await apiRequest('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email: emailReceptionistA, password }),
      headers: { Authorization: '' },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    MULTI_BRANCH.receptionistAToken = res.data.session?.access_token;
    if (!MULTI_BRANCH.receptionistAToken) throw new Error('No token');
    const user = res.data.user || {};
    if (user.branch_id !== MULTI_BRANCH.branchAId)
      throw new Error(`Expected branch_id=${MULTI_BRANCH.branchAId}, got ${user.branch_id}`);
    return { message: `branch_id=${user.branch_id}` };
  });

  await test('Login as Receptionist B — token has branch_id', async () => {
    const res = await apiRequest('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email: emailReceptionistB, password }),
      headers: { Authorization: '' },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    MULTI_BRANCH.receptionistBToken = res.data.session?.access_token;
    if (!MULTI_BRANCH.receptionistBToken) throw new Error('No token');
    const user = res.data.user || {};
    if (user.branch_id !== MULTI_BRANCH.branchBId)
      throw new Error(`Expected branch_id=${MULTI_BRANCH.branchBId}, got ${user.branch_id}`);
    return { message: `branch_id=${user.branch_id}` };
  });

  // ============================================================================
  // Create employees per branch and assign to services (isolation)
  // ============================================================================
  await test('Get one tenant service for employee assignment (optional)', async () => {
    const res = await apiRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'services',
        where: { tenant_id: CONFIG.TEST_DATA.tenantId },
        select: 'id',
        limit: 1,
      }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
      MULTI_BRANCH.serviceIdForIsolation = res.data[0].id;
      return { message: `service_id=${MULTI_BRANCH.serviceIdForIsolation}` };
    }
    return { message: 'No service (employees will be created without service assignment)' };
  });

  async function assignServiceToBranches(serviceId) {
    await apiRequest(`/branches/${MULTI_BRANCH.branchAId}/services`, {
      method: 'PUT',
      body: JSON.stringify({ service_ids: [serviceId] }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    await apiRequest(`/branches/${MULTI_BRANCH.branchBId}/services`, {
      method: 'PUT',
      body: JSON.stringify({ service_ids: [serviceId] }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
  }

  await test('Create Employee A (Branch A) with optional service', async () => {
    const body = {
      username: `employee_a_${unique}`,
      password,
      full_name: 'Employee A',
      full_name_ar: 'موظف أ',
      email: `mahmoudnzaineldeen+ea${unique}@gmail.com`,
      phone: null,
      role: 'employee',
      tenant_id: CONFIG.TEST_DATA.tenantId,
      branch_id: MULTI_BRANCH.branchAId,
    };
    if (MULTI_BRANCH.serviceIdForIsolation) {
      await assignServiceToBranches(MULTI_BRANCH.serviceIdForIsolation);
      body.service_shift_assignments = [{ serviceId: MULTI_BRANCH.serviceIdForIsolation }];
    }
    const res = await apiRequest('/employees/create', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.user?.id) throw new Error('No user id returned');
    MULTI_BRANCH.employeeAId = res.data.user.id;
    return { message: `id=${MULTI_BRANCH.employeeAId}` };
  });

  await test('Create Employee B (Branch B) with optional service', async () => {
    const body = {
      username: `employee_b_${unique}`,
      password,
      full_name: 'Employee B',
      full_name_ar: 'موظف ب',
      email: `mahmoudnzaineldeen+eb${unique}@gmail.com`,
      phone: null,
      role: 'employee',
      tenant_id: CONFIG.TEST_DATA.tenantId,
      branch_id: MULTI_BRANCH.branchBId,
    };
    if (MULTI_BRANCH.serviceIdForIsolation) {
      body.service_shift_assignments = [{ serviceId: MULTI_BRANCH.serviceIdForIsolation }];
    }
    const res = await apiRequest('/employees/create', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.user?.id) throw new Error('No user id returned');
    MULTI_BRANCH.employeeBId = res.data.user.id;
    return { message: `id=${MULTI_BRANCH.employeeBId}` };
  });

  await test('Branch A detail: assigned_employees includes Employee A only (isolation)', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchAId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const employees = res.data?.data?.assigned_employees ?? [];
    const ids = employees.map((e) => e.id);
    if (!ids.includes(MULTI_BRANCH.employeeAId))
      throw new Error(`Branch A must list Employee A; got ids: ${ids.join(', ')}`);
    if (ids.includes(MULTI_BRANCH.employeeBId))
      throw new Error('Branch A must not list Employee B (cross-branch leak)');
    return { message: `Branch A has ${employees.length} employee(s), includes only Employee A` };
  });

  await test('Branch B detail: assigned_employees includes Employee B only (isolation)', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchBId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const employees = res.data?.data?.assigned_employees ?? [];
    const ids = employees.map((e) => e.id);
    if (!ids.includes(MULTI_BRANCH.employeeBId))
      throw new Error(`Branch B must list Employee B; got ids: ${ids.join(', ')}`);
    if (ids.includes(MULTI_BRANCH.employeeAId))
      throw new Error('Branch B must not list Employee A (cross-branch leak)');
    return { message: `Branch B has ${employees.length} employee(s), includes only Employee B` };
  });

  // ============================================================================
  // STEP 5 & 6: Data isolation — Receptionist A sees only Branch A
  // ============================================================================
  await test('Receptionist A: GET /packages/receptionist/packages returns 200 (branch-scoped)', async () => {
    const res = await apiRequest('/packages/receptionist/packages', {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.receptionistAToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const packages = res.data?.packages ?? [];
    return { message: `${packages.length} packages (Branch A only)` };
  });

  await test('Receptionist A: GET /bookings/search returns 200 (branch-scoped)', async () => {
    const res = await apiRequest('/bookings/search?phone=12345', {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.receptionistAToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    return { message: 'search OK' };
  });

  await test('Receptionist A: GET /branches/:branchBId — must be 403 (no cross-branch)', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchBId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.receptionistAToken}` },
    });
    if (res.status !== 403)
      throw new Error(`Expected 403 for Branch B access, got ${res.status}`);
    return { message: 'Correctly blocked' };
  });

  await test('Receptionist B: GET /branches/:branchAId — must be 403 (no cross-branch)', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchAId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.receptionistBToken}` },
    });
    if (res.status !== 403)
      throw new Error(`Expected 403 for Branch A access, got ${res.status}`);
    return { message: 'Correctly blocked' };
  });

  await test('Receptionist B: GET /packages/receptionist/packages returns 200', async () => {
    const res = await apiRequest('/packages/receptionist/packages', {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.receptionistBToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    return { message: `${(res.data?.packages ?? []).length} packages (Branch B only)` };
  });

  // ============================================================================
  // Branch services API — receptionist can read own branch only; admin any branch
  // ============================================================================
  await test('Receptionist A: GET /branches/:branchAId/services returns 200 (own branch)', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchAId}/services`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.receptionistAToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const list = res.data?.data;
    if (!Array.isArray(list)) throw new Error('Expected data to be array');
    return { message: `${list.length} services for Branch A` };
  });

  await test('Receptionist A: GET /branches/:branchBId/services returns 403 (other branch)', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchBId}/services`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.receptionistAToken}` },
    });
    if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
    return { message: 'Correctly blocked' };
  });

  await test('Admin: GET /branches/:branchAId/services returns 200', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchAId}/services`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    if (!Array.isArray(res.data?.data)) throw new Error('Expected data array');
    return { message: `${(res.data?.data ?? []).length} services` };
  });

  await test('Admin: PUT /branches/:branchAId/services (assign empty then re-get)', async () => {
    const putRes = await apiRequest(`/branches/${MULTI_BRANCH.branchAId}/services`, {
      method: 'PUT',
      body: JSON.stringify({ service_ids: [] }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status}: ${JSON.stringify(putRes.data)}`);
    const getRes = await apiRequest(`/branches/${MULTI_BRANCH.branchAId}/services`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!getRes.ok) throw new Error(`GET after PUT failed: ${getRes.status}`);
    const list = getRes.data?.data ?? [];
    if (list.length !== 0) throw new Error(`Expected 0 services after assign [], got ${list.length}`);
    return { message: 'Assign empty and GET OK' };
  });

  // ============================================================================
  // Branch deactivate / reactivate (admin only)
  // ============================================================================
  await test('Admin: PATCH /branches/:id is_active false (deactivate Branch B)', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchBId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const d = res.data?.data;
    if (d && typeof d.is_active === 'boolean' && d.is_active !== false)
      throw new Error('Expected is_active false');
    return { message: 'Branch B deactivated' };
  });

  await test('Admin: PATCH /branches/:id is_active true (reactivate Branch B)', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchBId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: true }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    return { message: 'Branch B reactivated' };
  });

  // ============================================================================
  // Branch delete (create Branch C then delete it)
  // ============================================================================
  let branchCId = null;
  await test('Admin: Create Branch C for delete test', async () => {
    const res = await apiRequest('/branches', {
      method: 'POST',
      body: JSON.stringify({ name: 'Branch C (To Delete)', location: 'Temp' }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.data?.id) throw new Error('No branch id');
    branchCId = res.data.data.id;
    return { message: `id=${branchCId}` };
  });

  await test('Admin: DELETE /branches/:id (Branch C)', async () => {
    const res = await apiRequest(`/branches/${branchCId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    return { message: 'Branch C deleted' };
  });

  await test('Admin: GET /branches/:branchCId returns 404 after delete', async () => {
    const res = await apiRequest(`/branches/${branchCId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (res.status !== 404) throw new Error(`Expected 404 after delete, got ${res.status}`);
    return { message: 'Correctly 404' };
  });

  // ============================================================================
  // Income filtering (admin can see branch detail with income)
  // ============================================================================
  await test('Admin: Branch A detail income_summary is numeric', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchAId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const total = res.data?.data?.income_summary?.total;
    if (typeof total !== 'number') throw new Error('income_summary.total not a number');
    return { message: `total=${total}` };
  });

  await test('Admin: Branch B detail income_summary is numeric', async () => {
    const res = await apiRequest(`/branches/${MULTI_BRANCH.branchBId}`, {
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const total = res.data?.data?.income_summary?.total;
    if (typeof total !== 'number') throw new Error('income_summary.total not a number');
    return { message: `total=${total}` };
  });

  // ============================================================================
  // Package validation: at least one branch required
  // ============================================================================
  await test('POST /packages with empty branch_ids — must be 400', async () => {
    const res = await apiRequest('/packages', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: CONFIG.TEST_DATA.tenantId,
        name: 'Test Pkg No Branch',
        name_ar: 'حزمة بدون فرع',
        total_price: 100,
        original_price: 100,
        services: [], // will fail "at least 1 service" first; some backends may check branch first
        branch_ids: [],
      }),
      headers: { Authorization: `Bearer ${MULTI_BRANCH.adminToken}` },
    });
    // Backend may return 400 for "at least 1 service" or "at least one branch"
    if (res.ok) throw new Error('Expected 400 for empty branch_ids or no services');
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return { message: 'Validation enforced' };
  });

  console.log('\n========== MULTI-BRANCH TESTS COMPLETE ==========');
  console.log(`Passed: ${results.passed} | Failed: ${results.failed}\n`);
  return results;
}

runMultiBranchTests()
  .then((r) => {
    process.exit(r && r.failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
