/**
 * Real-data filtering validation for booking phone search.
 *
 * Goal:
 * - Ensure /bookings/customer-search returns only phones relevant to the typed query
 *   (no unrelated numbers), while still finding expected matches.
 *
 * Usage:
 *   npm run test:customer-search-filtering-real-tenant
 *   (will prompt for credentials if TEST_TOKEN not provided)
 */

const API_URL = process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:5173/api';
const TEST_TOKEN = process.env.TEST_TOKEN || '';
let TEST_EMAIL = process.env.TEST_EMAIL || 'healingtouches_sa@hotmail.com';
let TEST_PASSWORD = process.env.TEST_PASSWORD || '';

const SEARCH_LIMIT = 200;
const FETCH_LIMIT = 10000;
const MAX_QUERIES = 40;

let token = TEST_TOKEN || null;
let tenantId = null;

function normalizeDigits(v) {
  return String(v || '').replace(/\D/g, '');
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

function unique(arr) {
  return Array.from(new Set(arr));
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

async function fetchVisitorPhones() {
  const [customersRes, bookingsRes] = await Promise.all([
    apiRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'customers',
        select: 'phone',
        where: { tenant_id: tenantId },
        limit: FETCH_LIMIT,
      }),
    }),
    apiRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'bookings',
        select: 'customer_phone',
        where: { tenant_id: tenantId },
        limit: FETCH_LIMIT,
      }),
    }),
  ]);

  if (!customersRes.ok) throw new Error(`Failed loading customers: ${JSON.stringify(customersRes.data)}`);
  if (!bookingsRes.ok) throw new Error(`Failed loading bookings: ${JSON.stringify(bookingsRes.data)}`);

  const customerPhones = (Array.isArray(customersRes.data) ? customersRes.data : [])
    .map((r) => r?.phone)
    .filter(Boolean);
  const bookingPhones = (Array.isArray(bookingsRes.data) ? bookingsRes.data : [])
    .map((r) => r?.customer_phone)
    .filter(Boolean);

  const merged = unique([...customerPhones, ...bookingPhones])
    .map(normalizeDigits)
    .filter((d) => d.length >= 7);
  return merged;
}

function deriveQueriesFromPhone(digits) {
  const queries = [];
  if (digits.startsWith('966') && digits.length > 7) {
    const local = digits.slice(3);
    const localNo0 = local.replace(/^0+/, '');
    const localWith0 = localNo0 ? `0${localNo0}` : local;
    queries.push(localWith0.slice(0, 4), localNo0.slice(0, 4), localNo0.slice(0, 5));
  } else if (digits.startsWith('0')) {
    const no0 = digits.replace(/^0+/, '');
    queries.push(digits.slice(0, 4), no0.slice(0, 4), no0.slice(0, 5));
  } else {
    queries.push(digits.slice(0, 4), digits.slice(0, 5));
  }
  return unique(queries.filter((q) => q && q.length >= 3));
}

async function run() {
  console.log('============================================================');
  console.log('Real tenant filtering validation (booking phone search only)');
  console.log('============================================================\n');
  console.log(`API URL: ${API_URL}`);

  await ensureAuth();
  console.log(`Tenant resolved: ${tenantId}`);

  const phones = await fetchVisitorPhones();
  console.log(`Unique tenant visitor phones: ${phones.length}`);
  if (phones.length === 0) {
    console.log('No phones found. Nothing to validate.');
    return;
  }

  const queries = unique(
    phones.flatMap((p) => deriveQueriesFromPhone(p))
  ).slice(0, MAX_QUERIES);

  console.log(`Queries to validate: ${queries.length}`);
  const queryToResults = new Map();
  const failures = [];
  let totalReturned = 0;

  for (const q of queries) {
    const res = await apiRequest(`/bookings/customer-search?phone=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`, { method: 'GET' });
    if (!res.ok) {
      failures.push({ query: q, reason: `http_${res.status}`, details: res.data });
      continue;
    }
    const rows = Array.isArray(res.data?.customers) ? res.data.customers : [];
    queryToResults.set(q, rows);
    totalReturned += rows.length;

    const variants = buildSearchDigitVariants(q);
    const invalidRows = rows.filter((r) => !phoneMatchesAnyVariant(r?.phone || '', variants));
    if (invalidRows.length > 0) {
      failures.push({
        query: q,
        reason: 'invalid_filtered_rows',
        sample: invalidRows.slice(0, 5).map((r) => r?.phone),
      });
    }
  }

  // Coverage check: sampled queries should find at least one known tenant phone.
  let queriesWithKnownMatch = 0;
  for (const q of queries) {
    const rows = queryToResults.get(q) || [];
    const hasKnown = rows.some((r) => phones.includes(normalizeDigits(r?.phone)));
    if (hasKnown) queriesWithKnownMatch += 1;
  }

  const coverageRatio = queries.length > 0 ? queriesWithKnownMatch / queries.length : 1;
  if (coverageRatio < 0.9) {
    failures.push({
      reason: 'low_query_coverage',
      queriesWithKnownMatch,
      totalQueries: queries.length,
      coverageRatio,
    });
  }

  console.log(`Total rows returned across queries: ${totalReturned}`);
  console.log(`Queries with known tenant match: ${queriesWithKnownMatch}/${queries.length}`);

  if (failures.length > 0) {
    console.error('\n❌ Filtering validation failed.');
    console.error(JSON.stringify(failures.slice(0, 10), null, 2));
    process.exit(1);
  }

  console.log('\n✅ Filtering works as expected for sampled create-booking phone queries.');
}

run().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
