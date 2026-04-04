/**
 * Real-data validation: ensure booking phone search can find existing tenant customers.
 *
 * Flow:
 * 1) Authenticate (TEST_TOKEN or TEST_EMAIL/TEST_PASSWORD).
 * 2) Resolve tenant id.
 * 3) Fetch all customers for that tenant.
 * 4) Fetch all booking-history phones for that tenant.
 * 5) For each unique phone, try multiple query variants against /bookings/customer-search.
 * 6) Fail if any phone cannot be discovered by any variant.
 *
 * Usage:
 *   API_URL=http://localhost:5173/api TEST_TOKEN=... node tests/test-customer-search-real-tenant.js
 *   API_URL=http://localhost:5173/api TEST_EMAIL=... TEST_PASSWORD=... node tests/test-customer-search-real-tenant.js
 *
 * Defaults:
 *   TEST_EMAIL defaults to healingtouches_sa@hotmail.com
 */

const API_URL = process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:5173/api';
const TEST_TOKEN = process.env.TEST_TOKEN || '';
let TEST_EMAIL = process.env.TEST_EMAIL || 'healingtouches_sa@hotmail.com';
let TEST_PASSWORD = process.env.TEST_PASSWORD || '';
const SEARCH_LIMIT = 200;
const FETCH_LIMIT = 10000;

let token = TEST_TOKEN || null;
let tenantId = null;

async function promptIfMissingCredentials() {
  if (token || (TEST_EMAIL && TEST_PASSWORD)) return;
  const { createInterface } = await import('node:readline/promises');
  const { stdin, stdout } = await import('node:process');
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const emailInput = await rl.question(`Enter TEST_EMAIL (default: ${TEST_EMAIL}): `);
    if (emailInput && emailInput.trim()) TEST_EMAIL = emailInput.trim();
    const passwordInput = await rl.question('Enter TEST_PASSWORD: ');
    TEST_PASSWORD = (passwordInput || '').trim();
  } finally {
    rl.close();
  }
}

function normalizeDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function buildVariantsFromPhone(phone) {
  const digits = normalizeDigits(phone);
  const variants = new Set();
  const add = (x) => {
    const d = normalizeDigits(x);
    if (d.length >= 3) variants.add(d);
  };

  add(digits);
  add(digits.slice(0, 4));
  add(digits.slice(-6));

  if (digits.startsWith('966') && digits.length > 3) {
    const local = digits.slice(3);
    const localTrim = local.replace(/^0+/, '');
    add(local);
    add(localTrim);
    add(`0${localTrim}`);
    add(localTrim.slice(0, 4));
  } else if (digits.startsWith('00966') && digits.length > 5) {
    const local = digits.slice(5);
    const localTrim = local.replace(/^0+/, '');
    add(local);
    add(localTrim);
    add(`0${localTrim}`);
    add(localTrim.slice(0, 4));
  } else if (digits.startsWith('0')) {
    const localTrim = digits.replace(/^0+/, '');
    add(localTrim);
    add(`966${localTrim}`);
    add(`00966${localTrim}`);
  }

  return Array.from(variants).filter((v) => v.length >= 3);
}

async function apiRequest(endpoint, options = {}) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { ok: res.ok, status: res.status, data };
}

async function ensureAuth() {
  if (!token) {
    await promptIfMissingCredentials();
    if (!TEST_EMAIL || !TEST_PASSWORD) throw new Error('No TEST_TOKEN and missing TEST_EMAIL/TEST_PASSWORD.');
    const login = await apiRequest('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    if (!login.ok) throw new Error(`Login failed: ${JSON.stringify(login.data)}`);
    token = login.data?.session?.access_token || login.data?.token || null;
    tenantId = login.data?.user?.tenant_id || login.data?.tenant_id || login.data?.tenant?.id || null;
  }

  if (!tenantId) {
    const me = await apiRequest('/auth/user', { method: 'GET' });
    if (!me.ok) throw new Error(`Failed to resolve auth user: ${JSON.stringify(me.data)}`);
    tenantId = me.data?.user?.tenant_id || me.data?.tenant_id || null;
  }

  if (!token || !tenantId) {
    throw new Error('Authentication succeeded but token/tenant_id is missing.');
  }
}

async function fetchAllCustomers() {
  const res = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'customers',
      select: 'id,name,phone,email',
      where: { tenant_id: tenantId },
      orderBy: { column: 'created_at', ascending: false },
      limit: FETCH_LIMIT,
    }),
  });

  if (!res.ok) throw new Error(`Failed to fetch customers: ${JSON.stringify(res.data)}`);
  const list = Array.isArray(res.data) ? res.data : [];
  return list.filter((c) => normalizeDigits(c?.phone).length >= 3);
}

async function fetchAllBookingVisitors() {
  const res = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'customer_id,customer_name,customer_phone,customer_email,created_at',
      where: { tenant_id: tenantId },
      orderBy: { column: 'created_at', ascending: false },
      limit: FETCH_LIMIT,
    }),
  });

  if (!res.ok) throw new Error(`Failed to fetch bookings: ${JSON.stringify(res.data)}`);
  const list = Array.isArray(res.data) ? res.data : [];
  return list.filter((b) => normalizeDigits(b?.customer_phone).length >= 3);
}

function buildVisitorDataset(customers, bookings) {
  const byPhone = new Map();

  for (const c of customers) {
    const phoneDigits = normalizeDigits(c.phone);
    if (!phoneDigits) continue;
    byPhone.set(phoneDigits, {
      phone: c.phone,
      digits: phoneDigits,
      name: c.name || '',
      email: c.email || null,
      sources: new Set(['customers']),
      customerId: c.id || null,
    });
  }

  for (const b of bookings) {
    const phone = b.customer_phone;
    const phoneDigits = normalizeDigits(phone);
    if (!phoneDigits) continue;
    const existing = byPhone.get(phoneDigits);
    if (existing) {
      existing.sources.add('bookings');
      if (!existing.name && b.customer_name) existing.name = b.customer_name;
      if (!existing.email && b.customer_email) existing.email = b.customer_email;
      if (!existing.customerId && b.customer_id) existing.customerId = b.customer_id;
    } else {
      byPhone.set(phoneDigits, {
        phone,
        digits: phoneDigits,
        name: b.customer_name || '',
        email: b.customer_email || null,
        sources: new Set(['bookings']),
        customerId: b.customer_id || null,
      });
    }
  }

  return Array.from(byPhone.values());
}

async function run() {
  console.log('=========================================================');
  console.log('Real tenant customer-search validation (all customers)');
  console.log('=========================================================\n');
  console.log(`API URL: ${API_URL}`);

  await ensureAuth();
  console.log(`Tenant resolved: ${tenantId}`);

  const customers = await fetchAllCustomers();
  const bookingVisitors = await fetchAllBookingVisitors();
  const visitors = buildVisitorDataset(customers, bookingVisitors);
  const bookingOnlyCount = visitors.filter((v) => v.sources.has('bookings') && !v.sources.has('customers')).length;

  console.log(`Fetched customers: ${customers.length}`);
  console.log(`Fetched bookings with customer phone: ${bookingVisitors.length}`);
  console.log(`Unique visitor phones to validate: ${visitors.length}`);
  console.log(`Booking-history-only phones: ${bookingOnlyCount}`);

  if (visitors.length === 0) {
    console.log('No visitor phones found. Nothing to validate.');
    return;
  }

  const queryCache = new Map();
  async function getSearchResults(queryDigits) {
    if (queryCache.has(queryDigits)) return queryCache.get(queryDigits);
    const res = await apiRequest(`/bookings/customer-search?phone=${encodeURIComponent(queryDigits)}&limit=${SEARCH_LIMIT}`, {
      method: 'GET',
    });
    if (!res.ok) throw new Error(`Search failed for "${queryDigits}": ${JSON.stringify(res.data)}`);
    const list = Array.isArray(res.data?.customers) ? res.data.customers : [];
    queryCache.set(queryDigits, list);
    return list;
  }

  const failures = [];
  let checked = 0;

  for (const v of visitors) {
    const targetDigits = v.digits;
    const variants = buildVariantsFromPhone(v.phone);
    let found = false;

    for (const q of variants) {
      const results = await getSearchResults(q);
      const match = results.find((r) => normalizeDigits(r?.phone) === targetDigits);
      if (match) {
        found = true;
        break;
      }
    }

    checked += 1;
    if (!found) {
      failures.push({
        id: v.customerId,
        phone: v.phone,
        name: v.name,
        source: Array.from(v.sources).join('+'),
        triedQueries: variants.slice(0, 8),
      });
    }
  }

  console.log(`Checked: ${checked}`);
  console.log(`Unique search queries executed: ${queryCache.size}`);

  if (failures.length > 0) {
    console.error(`\n❌ Failures: ${failures.length}`);
    console.error('Sample failures (first 10):');
    console.error(JSON.stringify(failures.slice(0, 10), null, 2));
    process.exit(1);
  }

  console.log('\n✅ All tenant visitor phones (customers + booking history) were discoverable by booking phone search.');
}

run().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
