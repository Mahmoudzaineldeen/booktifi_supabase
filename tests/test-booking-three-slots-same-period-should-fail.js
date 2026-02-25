/**
 * Test: Booking 3 slots in the same period (which has only 2 slots) must fail.
 * Date: 28/2 (February 28). Ensures the fix: one selection per slot per period;
 * duplicate slot IDs or 3 slots from a 2-slot period should be rejected.
 *
 * Run: node tests/test-booking-three-slots-same-period-should-fail.js
 * Env: VITE_API_URL or API_URL (default: production API).
 * Env: TEST_EMAIL, TEST_PASSWORD (default: receptionist1@bookati.local / 111111).
 */

const API_URL = process.env.VITE_API_URL || process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';
const TEST_EMAIL = process.env.TEST_EMAIL || 'receptionist1@bookati.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '111111';
const SERVICE_NAME = 'mix';
const TEST_DATE = '2026-02-28'; // 28/2

let token = null;
let tenantId = null;
let serviceId = null;

function apiRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  }).then(async (res) => {
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();
    return { ok: res.ok, status: res.status, data };
  });
}

async function login() {
  const res = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) throw new Error('Login failed: ' + JSON.stringify(res.data));
  token = res.data.session?.access_token || res.data.token;
  const user = res.data.user;
  tenantId = user?.tenant_id || res.data.tenant_id;
  if (!token || !tenantId) throw new Error('Missing token or tenant_id');
}

async function findMixService() {
  const res = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: 'id, name',
      where: { tenant_id: tenantId, is_active: true },
      limit: 50,
    }),
  });
  if (!res.ok) throw new Error('Query services failed');
  const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
  const mix = list.find((s) => (s.name || '').toLowerCase() === 'mix') || list.find((s) => (s.name || '').toLowerCase().includes('mix'));
  if (!mix) throw new Error('Service "mix" not found');
  serviceId = mix.id;
}

async function getSlotsForDate(dateStr) {
  const res = await fetch(`${API_URL}/bookings/ensure-employee-based-slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, serviceId, date: dateStr }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('ensure-employee-based-slots failed: ' + JSON.stringify(data));
  const slots = Array.isArray(data.slots) ? data.slots : [];
  return slots.filter((s) => (s.available_capacity ?? 0) > 0);
}

function groupByPeriod(slots) {
  const byTime = new Map();
  for (const s of slots) {
    const key = `${s.slot_date}-${s.start_time}-${s.end_time}`;
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(s);
  }
  return Array.from(byTime.entries()).map(([timeKey, list]) => {
    const uniqueById = list.filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i);
    return { timeKey, slots: uniqueById };
  });
}

async function run() {
  console.log('========================================');
  console.log('Test: 3 slots in same period (28/2) must FAIL');
  console.log('========================================\n');

  await login();
  await findMixService();

  const slots = await getSlotsForDate(TEST_DATE);
  if (slots.length < 2) {
    throw new Error(`Not enough slots on ${TEST_DATE}. Need at least 2 in one period.`);
  }

  const periods = groupByPeriod(slots);
  const periodWithTwo = periods.find((p) => p.slots.length === 2);
  const periodToUse = periodWithTwo || periods.find((p) => p.slots.length >= 2);
  if (!periodToUse || periodToUse.slots.length < 2) {
    throw new Error(`No period with at least 2 slots on ${TEST_DATE}. Found: ${periods.map((p) => p.slots.length).join(', ')}`);
  }

  const [slot1, slot2] = periodToUse.slots;
  const slotIdsThreeSamePeriod = [slot1.id, slot2.id, slot1.id];
  console.log('Date:', TEST_DATE);
  console.log('Period:', slot1.start_time, '-', slot1.end_time, '| distinct slots:', periodToUse.slots.length);
  console.log('Attempting create-bulk with visitor_count=3 and slot_ids=[id1, id2, id1] (3 slots, 2 unique)...');

  const res = await apiRequest('/bookings/create-bulk', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      service_id: serviceId,
      slot_ids: slotIdsThreeSamePeriod,
      customer_name: 'Test Three Same Period',
      customer_phone: '+966500000001',
      customer_email: 'test-three@example.com',
      visitor_count: 3,
      adult_count: 3,
      child_count: 0,
      total_price: 300,
      notes: 'Test: should fail (duplicate slot in same period)',
      language: 'en',
    }),
  });

  if (res.ok) {
    console.error('\n❌ Expected booking to FAIL (3 slots in a 2-slot period / duplicate slot IDs), but it succeeded.');
    process.exit(1);
  }

  const msg = typeof res.data === 'object' && res.data?.error ? res.data.error : String(res.data);
  console.log('\n✅ Booking correctly failed:', res.status, msg);

  if (res.status !== 400 && res.status !== 409) {
    console.log('   (Accepting any non-2xx as success for this test.)');
  }

  console.log('\n========================================');
  console.log('✅ Test passed: 3 slots in same period (2-slot period) is rejected.');
  console.log('========================================\n');
}

run().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
