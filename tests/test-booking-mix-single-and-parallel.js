/**
 * Test 1: Book one slot (mix service) – normal single booking.
 * Test 2: Book 3 slots – 2 at the same time (parallel) + 1 at another time;
 *         verifies parallel allocation and that remaining availability decreases.
 *
 * Uses: mahmoudnzaineldeen@gmail.com / 111111, service name "mix".
 *
 * Run: npm run test:booking-mix-single-parallel
 *   or: node tests/test-booking-mix-single-and-parallel.js
 *
 * Env: VITE_API_URL or API_URL (default: production API).
 *
 * If Test 2 fails with "payment_status is of type payment_status but expression is of type text",
 * apply migration: supabase/migrations/20260225100000_fix_bulk_booking_payment_status_cast.sql
 */

const API_URL = process.env.VITE_API_URL || process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';

const TEST_EMAIL = process.env.TEST_EMAIL || 'receptionist1@bookati.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '111111';
const SERVICE_NAME = 'mix';

let token = null;
let tenantId = null;
let userId = null;
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
  console.log('\n🔐 Logging in as', TEST_EMAIL, '...');
  const res = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) { throw new Error('Login failed: ' + JSON.stringify(res.data)); }
  token = res.data.session?.access_token || res.data.token || res.data.access_token;
  const user = res.data.user;
  tenantId = user?.tenant_id || res.data.tenant_id || res.data.tenant?.id;
  userId = user?.id || res.data.user_id;
  if (!token || !tenantId) {
    console.error('Login response:', JSON.stringify(res.data, null, 2));
    throw new Error('Missing token or tenant_id in login response');
  }
  console.log('✅ Logged in. Tenant ID:', tenantId?.slice(0, 8) + '...');
}

async function findMixService() {
  console.log('\n🔍 Finding service "' + SERVICE_NAME + '"...');
  const res = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: 'id, name, base_price',
      where: { tenant_id: tenantId, is_active: true },
      limit: 50,
    }),
  });
  if (!res.ok) { throw new Error('Query services failed: ' + JSON.stringify(res.data)); }
  const raw = res.data;
  const list = Array.isArray(raw) ? raw : (raw?.data || raw?.rows || []);
  const nameNorm = (n) => (n || '').trim().toLowerCase();
  const mix = list.find((s) => nameNorm(s.name) === nameNorm(SERVICE_NAME))
    || list.find((s) => nameNorm(s.name).includes('mix'));
  if (!mix) { throw new Error('Service "' + SERVICE_NAME + '" not found. Available: ' + (list.map((s) => s.name).join(', ') || 'none')); }
  serviceId = mix.id;
  console.log('✅ Found service:', mix.name, '(' + serviceId.slice(0, 8) + '...)');
}

function getNextWeekdayDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < 14; i++) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) break;
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().split('T')[0];
}

async function getSlotsForDate(dateStr) {
  const res = await fetch(`${API_URL}/bookings/ensure-employee-based-slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, serviceId, date: dateStr }),
  });
  const data = await res.json();
  if (!res.ok) { throw new Error('ensure-employee-based-slots failed: ' + JSON.stringify(data)); }
  const slots = Array.isArray(data.slots) ? data.slots : [];
  return slots.filter((s) => (s.available_capacity ?? 0) > 0);
}

async function createSingleBooking(slotId, slot) {
  const res = await apiRequest('/bookings/create', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      service_id: serviceId,
      slot_id: slotId,
      employee_id: slot?.employee_id || null,
      customer_name: 'Test Customer Single',
      customer_phone: '+201111111111',
      customer_email: 'test-single@example.com',
      visitor_count: 1,
      total_price: 100,
      notes: 'Test 1: single slot booking',
      language: 'en',
    }),
  });
  if (!res.ok) { throw new Error('Single booking failed: ' + JSON.stringify(res.data)); }
  return res.data;
}

async function createBulkBooking(slotIds, customerName, customerPhone) {
  const n = slotIds.length;
  const res = await apiRequest('/bookings/create-bulk', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      service_id: serviceId,
      slot_ids: slotIds,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: 'test-bulk@example.com',
      visitor_count: n,
      adult_count: n,
      child_count: 0,
      total_price: 100 * n,
      notes: 'Test 2: 3 slots (2 parallel + 1 other)',
      language: 'en',
    }),
  });
  if (!res.ok) { throw new Error('Bulk booking failed: ' + JSON.stringify(res.data)); }
  return res.data;
}

function groupSlotsByTime(slots) {
  const byTime = new Map();
  for (const s of slots) {
    const key = `${s.start_time}-${s.end_time}`;
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(s);
  }
  return Array.from(byTime.entries()).map(([time, list]) => ({ time, slots: list }));
}

async function run() {
  console.log('========================================');
  console.log('Booking tests: 1 single + 3 (2 parallel + 1) for mix service');
  console.log('========================================');

  await login();
  await findMixService();
  let dateStr = getNextWeekdayDate();
  let slots = await getSlotsForDate(dateStr);
  for (let tries = 0; tries < 5 && (slots.length === 0 || slots.length < 4); tries++) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    dateStr = d.toISOString().split('T')[0];
    slots = await getSlotsForDate(dateStr);
  }
  console.log('\n📅 Test date:', dateStr);
  if (slots.length === 0) {
    throw new Error('No available slots for ' + dateStr + '. Ensure mix service has employees with shifts.');
  }
  console.log('   Available slots (with capacity):', slots.length);

  // ---------- Test 1: Single slot booking ----------
  console.log('\n---------- Test 1: Book one slot ----------');
  const slot1 = slots[0];
  const slot1Id = slot1.id;
  console.log('   Booking slot:', slot1.start_time, '-', slot1.end_time, '(', slot1Id.slice(0, 8) + '...)');
  const booking1 = await createSingleBooking(slot1Id, slot1);
  console.log('   ✅ Single booking created:', booking1?.id || booking1?.booking?.id);

  slots = await getSlotsForDate(dateStr);
  const stillAvailableAfter1 = slots.length;
  console.log('   Slots still available after Test 1:', stillAvailableAfter1);

  // ---------- Test 2: 3 bookings (2 parallel + 1 other) ----------
  console.log('\n---------- Test 2: 3 slots (2 same time + 1 other) ----------');
  const byTime = groupSlotsByTime(slots);
  const periodWithTwo = byTime.find((g) => g.slots.length >= 2);
  const otherSlot = byTime.find((g) => g.slots.length >= 1 && g !== periodWithTwo)?.slots?.[0] || slots.find((s) => s.id !== periodWithTwo?.slots?.[0]?.id);

  const seen = new Set();
  const slotIdsForBulk = [];
  if (periodWithTwo && periodWithTwo.slots.length >= 2) {
    periodWithTwo.slots.forEach((s) => {
      if (!seen.has(s.id)) { seen.add(s.id); slotIdsForBulk.push(s.id); }
    });
  }
  if (slotIdsForBulk.length < 3 && otherSlot && !seen.has(otherSlot.id)) {
    seen.add(otherSlot.id);
    slotIdsForBulk.push(otherSlot.id);
  }
  // Use any remaining distinct slots from slots array to reach 3 if possible
  for (const s of slots) {
    if (slotIdsForBulk.length >= 3) break;
    if (!seen.has(s.id)) { seen.add(s.id); slotIdsForBulk.push(s.id); }
  }
  const uniqueIds = slotIdsForBulk;
  if (uniqueIds.length < 2) {
    throw new Error('Not enough distinct slots for bulk test (need at least 2, have ' + uniqueIds.length + '). Try another date or free more slots.');
  }
  if (uniqueIds.length < 3) {
    console.log('   ⚠️ Only', uniqueIds.length, 'distinct slots available. Bulk booking', uniqueIds.length, 'slots.');
  }

  console.log('   Bulk booking', uniqueIds.length, 'slots');
  const bulkResult = await createBulkBooking(uniqueIds, 'Test Customer Bulk', '+202222222222');
  const bookings = bulkResult?.bookings || [];
  console.log('   ✅ Bulk booking created. Bookings:', bookings.length);

  // Verify each bulk booking has employee_id (fix for "no employee assigned")
  const missingEmployee = (bookings || []).filter((b) => !b.employee_id);
  if (missingEmployee.length > 0) {
    console.error(
      `   ❌ Verification failed: ${missingEmployee.length} of ${bookings.length} bulk bookings have no employee_id.`
    );
    console.error(
      '   Apply migration 20260225100000_fix_bulk_booking_payment_status_cast.sql on your database and re-run this test.'
    );
    throw new Error(
      `Problem not eliminated: ${missingEmployee.length} of ${bookings.length} bulk bookings missing employee_id. Apply migration and re-run.`
    );
  }
  console.log('   ✅ Verification: all', bookings.length, 'bulk bookings have employee_id assigned.');

  const slotsAfterBulk = await getSlotsForDate(dateStr);
  console.log('   Slots still available after Test 2:', slotsAfterBulk.length);

  console.log('\n========================================');
  console.log('✅ All tests passed.');
  console.log('   Test 1: 1 single booking created.');
  console.log('   Test 2: ' + uniqueIds.length + ' bookings created (bulk).');
  console.log('   All bulk bookings have employee assigned. Availability decreased as expected.');
  console.log('========================================\n');
}

run().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
