/**
 * Branch Shifts Assigned to Employees Test
 * Verifies that employees assigned to a branch (Main Branch) receive shifts when
 * ensure-employee-based-slots is called — i.e. slot generation uses branch default
 * shifts for employees with no custom shifts, and includes branch employees.
 * Run: node tests/backend/14-branch-shifts-assigned-to-employees.test.js
 */

import { CONFIG, apiRequest, logTest, delay } from './config.js';

const results = { passed: 0, failed: 0, tests: [] };

function nextMonday() {
  const d = new Date();
  const day = d.getDay();
  const add = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

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

async function runTest() {
  console.log('\n========== BRANCH SHIFTS ASSIGNED TO EMPLOYEES (Main Branch) ==========\n');

  let adminToken = null;
  let tenantId = null;
  let mainBranchId = null;
  let mainBranchEmployeeIds = [];
  let serviceId = null;
  let dateStr = null;

  await test('Admin login', async () => {
    const res = await apiRequest('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({
        email: CONFIG.ACCOUNTS.SERVICE_PROVIDER.email,
        password: CONFIG.ACCOUNTS.SERVICE_PROVIDER.password,
      }),
      headers: { Authorization: '' },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data.session?.access_token) throw new Error('No access token');
    adminToken = res.data.session.access_token;
    tenantId = res.data.user?.tenant_id;
    CONFIG.TEST_DATA.serviceProviderToken = adminToken;
    CONFIG.TEST_DATA.tenantId = tenantId;
    if (!tenantId) throw new Error('No tenant_id');
    return { message: `tenant_id=${tenantId}` };
  });

  await test('GET /branches — find Main Branch', async () => {
    const res = await apiRequest('/branches', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const list = res.data?.data || [];
    if (list.length === 0) throw new Error('No branches');
    const main = list.find((b) => (b.name || '').toLowerCase() === 'main branch');
    mainBranchId = main ? main.id : list[0].id;
    return { message: `branch_id=${mainBranchId}` };
  });

  await test('GET /branches/:id — Main Branch detail (assigned_employees + branch_shifts)', async () => {
    const res = await apiRequest(`/branches/${mainBranchId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const d = res.data?.data;
    if (!d) throw new Error('No branch data');
    mainBranchEmployeeIds = (d.assigned_employees || []).map((e) => e.id).filter(Boolean);
    const shifts = d.branch_shifts || [];
    if (mainBranchEmployeeIds.length === 0) {
      return { message: 'No employees assigned to branch (add employees to Main Branch to fully verify)' };
    }
    if (shifts.length === 0) {
      throw new Error('Main Branch has no branch_shifts; add at least one (e.g. Mon–Fri 09:00–17:00)');
    }
    return { message: `${mainBranchEmployeeIds.length} employees, ${shifts.length} branch shifts` };
  });

  await test('GET /branches/:id/services — get a service for Main Branch', async () => {
    const res = await apiRequest(`/branches/${mainBranchId}/services`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const services = res.data?.data || [];
    if (services.length === 0) {
      throw new Error('No services assigned to Main Branch; assign a service to the branch first');
    }
    serviceId = services[0].id;
    return { message: `service_id=${serviceId}` };
  });

  dateStr = nextMonday();
  await test('POST /bookings/ensure-employee-based-slots — slots for branch employees', async () => {
    const res = await apiRequest('/bookings/ensure-employee-based-slots', {
      method: 'POST',
      body: JSON.stringify({ tenantId, serviceId, date: dateStr }),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) {
      throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    }
    const body = res.data;
    const shiftIds = body.shiftIds || [];
    const slots = body.slots || [];
    if (shiftIds.length === 0 && slots.length === 0) {
      return { message: 'No shiftIds/slots (tenant may not be in employee-based mode or no shifts for this day)' };
    }
    const slotEmployeeIds = [...new Set(slots.map((s) => s.employee_id).filter(Boolean))];
    const branchEmployeesInSlots = slotEmployeeIds.filter((id) => mainBranchEmployeeIds.includes(id));
    if (mainBranchEmployeeIds.length > 0 && branchEmployeesInSlots.length === 0 && slots.length > 0) {
      throw new Error(
        `Slots returned but none for Main Branch employees. Branch employee ids: ${mainBranchEmployeeIds.join(', ')}. Slot employee ids: ${slotEmployeeIds.join(', ')}`
      );
    }
    if (mainBranchEmployeeIds.length > 0 && slots.length > 0 && branchEmployeesInSlots.length > 0) {
      return { message: `${slots.length} slots, ${branchEmployeesInSlots.length} from Main Branch employees` };
    }
    if (slots.length > 0) {
      return { message: `${slots.length} slots returned` };
    }
    return { message: 'shiftIds returned (slots may be cached or generated)' };
  });

  await delay(500);

  await test('Slots include at least one employee assigned to Main Branch', async () => {
    if (mainBranchEmployeeIds.length === 0) {
      return { message: 'Skipped (no employees on branch)' };
    }
    const res = await apiRequest('/bookings/ensure-employee-based-slots', {
      method: 'POST',
      body: JSON.stringify({ tenantId, serviceId, date: dateStr }),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const slots = res.data?.slots || [];
    const slotEmployeeIds = [...new Set(slots.map((s) => s.employee_id).filter(Boolean))];
    const match = slotEmployeeIds.some((id) => mainBranchEmployeeIds.includes(id));
    if (!match && slots.length > 0) {
      throw new Error(
        `Expected at least one slot for a Main Branch employee. Branch: [${mainBranchEmployeeIds.join(', ')}], Slots: [${slotEmployeeIds.join(', ')}]`
      );
    }
    if (slots.length === 0) {
      return { message: 'No slots (OK if no shifts for this day or mode)' };
    }
    return { message: `Slots include Main Branch employee(s)` };
  });

  await test('No slots in 5 PM–8 PM window (employees must not have shifts in that window)', async () => {
    const res = await apiRequest('/bookings/ensure-employee-based-slots', {
      method: 'POST',
      body: JSON.stringify({ tenantId, serviceId, date: dateStr }),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const slots = res.data?.slots || [];
    const forbiddenStart = '17:00';
    const forbiddenEnd = '20:00';
    const inForbidden = slots.filter((s) => {
      const t = (s.start_time || '').slice(0, 5);
      return t >= forbiddenStart && t < forbiddenEnd;
    });
    if (inForbidden.length > 0) {
      throw new Error(
        `${inForbidden.length} slot(s) start in 5 PM–8 PM window: ${inForbidden.map((s) => s.start_time).join(', ')}`
      );
    }
    return { message: `None of ${slots.length} slots fall in 5 PM–8 PM` };
  });

  console.log('\n========== BRANCH SHIFTS ASSIGNED TO EMPLOYEES TESTS COMPLETE ==========');
  console.log(`Passed: ${results.passed} | Failed: ${results.failed}\n`);
  return results;
}

runTest()
  .then((r) => {
    process.exit(r && r.failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
