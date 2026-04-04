/**
 * Integration test: customer phone search returns all high-volume matches.
 *
 * What it does:
 * 1) Signs in with a receptionist/tenant-admin account.
 * 2) Seeds 55 customers under the same tenant using a unique phone prefix.
 * 3) Calls GET /bookings/customer-search?phone=<prefix>&limit=120.
 * 4) Verifies all 55 seeded records are returned.
 * 5) Cleans up seeded rows.
 *
 * Usage:
 *   API_URL=http://localhost:8080/api TEST_EMAIL=... TEST_PASSWORD=... node tests/test-customer-phone-search-api.js
 *
 * Safety:
 * - API_URL is required (no production default).
 * - Data is tagged by unique marker and deleted at the end.
 */

const API_URL = process.env.VITE_API_URL || process.env.API_URL;
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const SEEDED_COUNT = 55;

if (!API_URL) {
  console.error('Missing API_URL (or VITE_API_URL). Refusing to run without explicit target.');
  process.exit(1);
}
if (!TEST_EMAIL || !TEST_PASSWORD) {
  console.error('Missing TEST_EMAIL or TEST_PASSWORD.');
  process.exit(1);
}

let token = null;
let tenantId = null;
let marker = null;
let phonePrefixDigits = null;
let searchQueryDigits = null;

function randomDigits(len) {
  let out = '';
  while (out.length < len) out += Math.floor(Math.random() * 10);
  return out.slice(0, len);
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(options.headers || {}),
    },
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { ok: res.ok, status: res.status, data };
}

async function login() {
  const res = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${JSON.stringify(res.data)}`);

  token = res.data?.session?.access_token || res.data?.token;
  tenantId = res.data?.user?.tenant_id || res.data?.tenant_id || res.data?.tenant?.id;
  if (!token || !tenantId) throw new Error('Missing token or tenant_id from login response.');
}

async function seedCustomers() {
  // Prefix pattern example: stored +96653123xx while query is local 053123.
  // This verifies local->international normalization during search.
  const seedPart = randomDigits(3);
  phonePrefixDigits = `531${seedPart}`;
  searchQueryDigits = `0${phonePrefixDigits}`;
  marker = `TEST_PHONE_SEARCH_SCROLL_${Date.now()}_${seedPart}`;

  const rows = Array.from({ length: SEEDED_COUNT }, (_, idx) => {
    const suffix = String(idx).padStart(2, '0');
    return {
      tenant_id: tenantId,
      name: marker,
      phone: `+966${phonePrefixDigits}${suffix}`,
      email: `${marker.toLowerCase()}_${idx}@example.com`,
      customer_type: 'regular',
      is_active: true,
    };
  });

  const res = await apiRequest('/insert/customers', {
    method: 'POST',
    body: JSON.stringify({ data: rows }),
  });

  if (!res.ok) {
    throw new Error(`Failed to seed customers: ${JSON.stringify(res.data)}`);
  }
}

async function verifySearch() {
  const res = await apiRequest(`/bookings/customer-search?phone=${encodeURIComponent(searchQueryDigits)}&limit=120`, {
    method: 'GET',
  });
  if (!res.ok) {
    throw new Error(`customer-search failed (${res.status}): ${JSON.stringify(res.data)}`);
  }

  const customers = Array.isArray(res.data?.customers) ? res.data.customers : [];
  const seeded = customers.filter((c) => c?.name === marker);

  if (seeded.length !== SEEDED_COUNT) {
    const seededPhones = seeded.map((c) => c.phone);
    throw new Error(
      `Expected ${SEEDED_COUNT} seeded matches, got ${seeded.length}. ` +
      `Query prefix=${searchQueryDigits}, sample phones=${JSON.stringify(seededPhones.slice(0, 5))}`
    );
  }

  // Ensure every seeded result still matches the query digits.
  const invalid = seeded.find((c) => !String(c.phone || '').replace(/\D/g, '').includes(phonePrefixDigits));
  if (invalid) {
    throw new Error(`Found seeded row not matching prefix: ${JSON.stringify(invalid)}`);
  }
}

async function cleanup() {
  if (!marker) return;
  // Delete all seeded rows by unique marker name.
  await apiRequest('/delete/customers', {
    method: 'POST',
    body: JSON.stringify({ where: { name: marker } }),
  });
}

async function run() {
  console.log('==============================================');
  console.log('Test: customer-search returns high-volume rows');
  console.log('==============================================\n');

  await login();
  console.log(`Logged in. tenant_id=${tenantId}`);

  await seedCustomers();
  console.log(`Seeded ${SEEDED_COUNT} customers with marker=${marker}, stored-prefix=${phonePrefixDigits}, search=${searchQueryDigits}`);

  await verifySearch();
  console.log(`✅ customer-search returned all ${SEEDED_COUNT} seeded rows (limit=120).`);

  console.log('\n✅ Test passed.');
}

run()
  .catch((err) => {
    console.error('\n❌ Test failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (_) {
      // best-effort cleanup
    }
  });
