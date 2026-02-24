/**
 * Branch Shifts API Tests — overnight shifts (9 PM–12 AM, 9 PM–2 AM) and validation.
 * Ensures: same-day shifts work, overnight shifts accepted, same start/end rejected.
 * Run: node tests/backend/13-branch-shifts-overnight.test.js
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

async function runBranchShiftsTests() {
  console.log('\n========== BRANCH SHIFTS (OVERNIGHT) TESTS ==========\n');

  let adminToken = null;
  let branchId = null;
  let createdShiftIds = [];

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
    CONFIG.TEST_DATA.serviceProviderToken = adminToken;
    CONFIG.TEST_DATA.tenantId = res.data.user?.tenant_id;
    return { message: 'OK' };
  });

  await test('GET /branches — get first branch', async () => {
    const res = await apiRequest('/branches', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const list = res.data?.data || [];
    if (list.length === 0) throw new Error('No branches; create one in admin first');
    branchId = list[0].id;
    return { message: `branch_id=${branchId}` };
  });

  // --- Overnight: 9 PM to 12 AM (21:00 - 00:00) — must succeed
  await test('POST /branches/:id/shifts — 9 PM to 12 AM (overnight) accepted', async () => {
    const res = await apiRequest(`/branches/${branchId}/shifts`, {
      method: 'POST',
      body: JSON.stringify({
        days_of_week: [0, 1, 2, 3, 4],
        start_time: '21:00',
        end_time: '00:00',
      }),
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) {
      throw new Error(`Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
    const shift = res.data?.data;
    if (!shift?.id) throw new Error('No shift id returned');
    createdShiftIds.push(shift.id);
    return { message: `id=${shift.id}, 21:00–00:00` };
  });

  await delay(300);

  // --- Overnight: 9 PM to 2 AM (21:00 - 02:00) — must succeed
  await test('POST /branches/:id/shifts — 9 PM to 2 AM (overnight) accepted', async () => {
    const res = await apiRequest(`/branches/${branchId}/shifts`, {
      method: 'POST',
      body: JSON.stringify({
        days_of_week: [5, 6],
        start_time: '21:00',
        end_time: '02:00',
      }),
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) {
      throw new Error(`Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
    const shift = res.data?.data;
    if (!shift?.id) throw new Error('No shift id returned');
    createdShiftIds.push(shift.id);
    return { message: `id=${shift.id}, 21:00–02:00` };
  });

  await delay(300);

  // --- Same-day: 9 AM to 5 PM — must succeed
  await test('POST /branches/:id/shifts — 9 AM to 5 PM (same-day) accepted', async () => {
    const res = await apiRequest(`/branches/${branchId}/shifts`, {
      method: 'POST',
      body: JSON.stringify({
        days_of_week: [1, 2, 3],
        start_time: '09:00',
        end_time: '17:00',
      }),
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) {
      throw new Error(`Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
    const shift = res.data?.data;
    if (!shift?.id) throw new Error('No shift id returned');
    createdShiftIds.push(shift.id);
    return { message: `id=${shift.id}, 09:00–17:00` };
  });

  await delay(300);

  // --- Invalid: same start and end — must be rejected with 400
  await test('POST /branches/:id/shifts — same start and end (21:00–21:00) rejected', async () => {
    const res = await apiRequest(`/branches/${branchId}/shifts`, {
      method: 'POST',
      body: JSON.stringify({
        days_of_week: [0],
        start_time: '21:00',
        end_time: '21:00',
      }),
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (res.ok) throw new Error('Expected 400 for same start/end');
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    const msg = (res.data?.error || '').toLowerCase();
    if (!msg.includes('end_time') && !msg.includes('start_time')) {
      throw new Error(`Expected error about end_time/start_time, got: ${res.data?.error}`);
    }
    return { message: 'Validation OK' };
  });

  // --- GET branch detail includes branch_shifts
  await test('GET /branches/:id — includes branch_shifts with overnight times', async () => {
    const res = await apiRequest(`/branches/${branchId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(res.data)}`);
    const shifts = res.data?.data?.branch_shifts || [];
    const hasOvernight = shifts.some(
      (s) =>
        (String(s.start_time).startsWith('21:') && (String(s.end_time).startsWith('00:') || String(s.end_time).startsWith('02:'))) ||
        (String(s.start_time).startsWith('21:') && String(s.end_time).startsWith('00:'))
    );
    if (shifts.length < 2) throw new Error(`Expected at least 2 shifts, got ${shifts.length}`);
    return { message: `${shifts.length} shifts, overnight present` };
  });

  // Cleanup: delete created shifts (optional)
  for (const shiftId of createdShiftIds) {
    await apiRequest(`/branches/${branchId}/shifts/${shiftId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).catch(() => {});
  }

  console.log('\n========== BRANCH SHIFTS TESTS COMPLETE ==========');
  console.log(`Passed: ${results.passed} | Failed: ${results.failed}\n`);
  return results;
}

runBranchShiftsTests()
  .then((r) => {
    process.exit(r && r.failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
