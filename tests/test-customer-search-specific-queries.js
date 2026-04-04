/**
 * Targeted live validation for specific create-booking phone queries.
 *
 * Verifies for each query:
 * 1) There is matching tenant data in customers/bookings tables.
 * 2) /bookings/customer-search returns matching rows.
 *
 * Default queries:
 * - 9660531
 * - 055
 *
 * Usage:
 *   npm run test:customer-search-specific-queries
 */

const API_URL = process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:5173/api';
const TEST_TOKEN = process.env.TEST_TOKEN || '';
let TEST_EMAIL = process.env.TEST_EMAIL || 'healingtouches_sa@hotmail.com';
let TEST_PASSWORD = process.env.TEST_PASSWORD || '';
const SEARCH_LIMIT = 200;
const QUERIES = ['9660531', '055'];

let token = TEST_TOKEN || null;
let tenantId = null;

function normalizeDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function buildSearchDigitVariants(inputDigits) {
  const raw = normalizeDigits(inputDigits);
  if (!raw) return [];
  const set = new Set();
  const trimmedLeadingZeros = raw.replace(/^0+/, '');
  const add = (v) => {
    const n = normalizeDigits(v);
    if (n.length >= 3) set.add(n);
  };

  add(raw);
  add(trimmedLeadingZeros);

  if (raw.startsWith('0') && trimmedLeadingZeros) {
    add(`966${trimmedLeadingZeros}`);
    add(`00966${trimmedLeadingZeros}`);
  }
  if (raw.startsWith('966') && raw.length > 3) {
    const local = raw.slice(3);
    const trimmedLocal = local.replace(/^0+/, '');
    add(local);
    add(trimmedLocal);
    if (trimmedLocal) add(`0${trimmedLocal}`);
  }
  if (raw.startsWith('00966') && raw.length > 5) {
    const local = raw.slice(5);
    const trimmedLocal = local.replace(/^0+/, '');
    add(local);
    add(trimmedLocal);
    if (trimmedLocal) {
      add(`0${trimmedLocal}`);
      add(`966${trimmedLocal}`);
    }
  }

  return Array.from(set);
}

function phoneMatchesAnyVariant(phone, variants) {
  const normalized = normalizeDigits(phone);
  return variants.some((v) => normalized.includes(v));
}

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

  if (!token || !tenantId) throw new Error('Authentication succeeded but token/tenant_id is missing.');
}

async function fetchTenantPhones() {
  const [customersRes, bookingsRes] = await Promise.all([
    apiRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'customers',
        select: 'phone',
        where: { tenant_id: tenantId },
        limit: 10000,
      }),
    }),
    apiRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'bookings',
        select: 'customer_phone',
        where: { tenant_id: tenantId },
        limit: 10000,
      }),
    }),
  ]);

  if (!customersRes.ok) throw new Error(`Failed to fetch customers: ${JSON.stringify(customersRes.data)}`);
  if (!bookingsRes.ok) throw new Error(`Failed to fetch bookings: ${JSON.stringify(bookingsRes.data)}`);

  const customerPhones = (customersRes.data || []).map((r) => r?.phone).filter(Boolean);
  const bookingPhones = (bookingsRes.data || []).map((r) => r?.customer_phone).filter(Boolean);
  return [...customerPhones, ...bookingPhones];
}

async function run() {
  console.log('=======================================================');
  console.log('Targeted customer-search query validation');
  console.log('=======================================================\n');
  console.log(`API URL: ${API_URL}`);

  await ensureAuth();
  console.log(`Tenant resolved: ${tenantId}`);

  const tenantPhones = await fetchTenantPhones();
  console.log(`Tenant phones loaded (raw rows): ${tenantPhones.length}`);

  const failures = [];

  for (const query of QUERIES) {
    const variants = buildSearchDigitVariants(query);
    const expectedMatches = tenantPhones.filter((p) => phoneMatchesAnyVariant(p, variants));

    const res = await apiRequest(`/bookings/customer-search?phone=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`, {
      method: 'GET',
    });
    if (!res.ok) {
      failures.push({ query, reason: `http_${res.status}`, details: res.data });
      continue;
    }

    const returned = Array.isArray(res.data?.customers) ? res.data.customers : [];
    const invalid = returned.filter((r) => !phoneMatchesAnyVariant(r?.phone || '', variants));

    console.log(`\nQuery: ${query}`);
    console.log(`- expected tenant matches: ${expectedMatches.length}`);
    console.log(`- returned by endpoint:   ${returned.length}`);
    console.log(`- invalid returned rows:  ${invalid.length}`);

    if (expectedMatches.length > 0 && returned.length === 0) {
      failures.push({ query, reason: 'expected_matches_exist_but_endpoint_returned_0' });
    }
    if (invalid.length > 0) {
      failures.push({
        query,
        reason: 'endpoint_returned_unrelated_rows',
        sample: invalid.slice(0, 5).map((x) => x?.phone),
      });
    }
  }

  if (failures.length > 0) {
    console.error('\n❌ Validation failed:');
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }

  console.log('\n✅ Endpoint returns correct data for queries: 9660531 and 055');
}

run().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
