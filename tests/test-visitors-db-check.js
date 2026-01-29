/**
 * Visitors DB verification test.
 * Compares GET /api/debug/visitors-db-check (DB truth) vs GET /api/visitors summary.
 *
 * Run (localhost):
 *   1. Start server: cd server && npm run dev
 *   2. Set credentials for your local DB (tenant_admin or receptionist):
 *      $env:VISITORS_TEST_EMAIL="your@email.com"; $env:VISITORS_TEST_PASSWORD="yourpassword"
 *      node tests/test-visitors-db-check.js
 *   Or: set VISITORS_TEST_EMAIL=your@email.com && set VISITORS_TEST_PASSWORD=yourpassword && node tests/test-visitors-db-check.js
 *
 * Run (Railway/deployed): API_BASE_URL=https://your-app.up.railway.app/api node tests/test-visitors-db-check.js
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

const envEmail = process.env.VISITORS_TEST_EMAIL || process.env.TEST_EMAIL;
const envPassword = process.env.VISITORS_TEST_PASSWORD || process.env.TEST_PASSWORD;

const ACCOUNTS = [];
if (envEmail && envPassword) {
  ACCOUNTS.push({ email: envEmail, password: envPassword, name: 'env' });
}
ACCOUNTS.push(
  { email: 'mahmoudnzaineldeen@gmail.com', password: '111111', name: 'tenant_admin' },
  { email: 'receptionist@test.com', password: 'test123', name: 'receptionist' }
);

let token = null;

async function login() {
  for (const acc of ACCOUNTS) {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: acc.email, password: acc.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.session?.access_token) {
        token = data.session.access_token;
        return true;
      }
    } catch (e) {
      // Network error (e.g. server not running)
      if (acc === ACCOUNTS[0]) console.error('Request error:', e.message);
    }
  }
  return false;
}

async function run() {
  console.log('Visitors DB verification test');
  console.log('API_BASE_URL:', API_BASE_URL);
  console.log('');

  const ok = await login();
  if (!ok) {
    const isLocal = !process.env.API_BASE_URL || process.env.API_BASE_URL.includes('localhost');
    console.error('Login failed.');
    if (isLocal) {
      console.error('');
      console.error('For localhost:');
      console.error('  1. Start the server:  cd server  then  npm run dev');
      console.error('  2. Use a tenant_admin or receptionist account. Set env vars:');
      console.error('     PowerShell:  $env:VISITORS_TEST_EMAIL="your@email.com"; $env:VISITORS_TEST_PASSWORD="yourpassword"');
      console.error('     CMD:         set VISITORS_TEST_EMAIL=your@email.com& set VISITORS_TEST_PASSWORD=yourpassword');
      console.error('  3. Run again:  node tests/test-visitors-db-check.js');
    } else {
      console.error('Use an account with visitors access (tenant_admin or receptionist).');
    }
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  let dbCheck = null;
  let apiVisitors;
  try {
    const r1 = await fetch(`${API_BASE_URL}/debug/visitors-db-check`, { headers });
    const r2 = await fetch(`${API_BASE_URL}/visitors?page=1&limit=20`, { headers });
    if (r1.ok) {
      dbCheck = await r1.json();
    } else {
      if (r1.status === 404) {
        console.log('⚠ Debug endpoint not found (404). Deploy latest server to add GET /api/debug/visitors-db-check.');
      } else {
        console.error('Debug endpoint failed:', r1.status, await r1.text());
      }
    }
    if (!r2.ok) {
      console.error('Visitors API failed:', r2.status, await r2.text());
      process.exit(1);
    }
    apiVisitors = await r2.json();
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exit(1);
  }

  const api = apiVisitors.summary || {};
  const apiTotal = apiVisitors.pagination?.total ?? 0; // Displayed as "Total Visitors" in UI
  const apiTotalCustomers = api.totalCustomers ?? null;

  if (dbCheck) {
    const db = dbCheck;
    console.log('--- DB (visitors_db_verification RPC) ---');
    console.log('  total_customers:      ', db.total_customers);
    console.log('  total_unique_visitors:', db.total_unique_visitors);
    console.log('  total_bookings:      ', db.total_bookings);
    console.log('  total_package_bookings:', db.total_package_bookings);
    console.log('  total_paid_bookings: ', db.total_paid_bookings);
    console.log('  total_spent:         ', db.total_spent);
    console.log('');
  }

  console.log('--- API (GET /api/visitors summary + pagination.total) ---');
  console.log('  pagination.total:    ', apiTotal, '  (displayed as Total Visitors)');
  console.log('  totalCustomers:     ', apiTotalCustomers, '  (customers in visitor list)');
  console.log('  totalBookings:      ', api.totalBookings);
  console.log('  totalPackageBookings:', api.totalPackageBookings);
  console.log('  totalPaidBookings:  ', api.totalPaidBookings);
  console.log('  totalSpent:         ', api.totalSpent);
  console.log('');

  if (!dbCheck) {
    console.log('Skipping DB vs API comparison (debug endpoint not available).');
    console.log('Visitors API responded successfully.');
    process.exit(0);
  }

  const db = dbCheck;
  let failed = 0;

  // Displayed total (Total Visitors) must match DB unique visitors (customers + distinct guests)
  if (Number(apiTotal) !== Number(db.total_unique_visitors)) {
    console.log('❌ Total Visitors (displayed): API', apiTotal, 'vs DB total_unique_visitors', db.total_unique_visitors);
    failed++;
  } else {
    console.log('✅ Total Visitors (displayed total) accurate:', apiTotal, '=== DB total_unique_visitors');
  }

  // Total customers in visitor list must match DB customer count (when no filters)
  if (apiTotalCustomers != null && Number(apiTotalCustomers) !== Number(db.total_customers)) {
    console.log('❌ Total Customers: API', apiTotalCustomers, 'vs DB total_customers', db.total_customers);
    failed++;
  } else if (apiTotalCustomers != null) {
    console.log('✅ Total Customers accurate:', apiTotalCustomers, '=== DB total_customers');
  }
  if (Number(api.totalBookings) !== Number(db.total_bookings)) {
    console.log('❌ Total Bookings: API', api.totalBookings, 'vs DB', db.total_bookings);
    failed++;
  } else {
    console.log('✅ Total Bookings match:', api.totalBookings);
  }
  if (Number(api.totalPackageBookings) !== Number(db.total_package_bookings)) {
    console.log('❌ Package Bookings: API', api.totalPackageBookings, 'vs DB', db.total_package_bookings);
    failed++;
  } else {
    console.log('✅ Package Bookings match:', api.totalPackageBookings);
  }
  if (Number(api.totalPaidBookings) !== Number(db.total_paid_bookings)) {
    console.log('❌ Paid Bookings: API', api.totalPaidBookings, 'vs DB', db.total_paid_bookings);
    failed++;
  } else {
    console.log('✅ Paid Bookings match:', api.totalPaidBookings);
  }
  const apiSpent = Number(api.totalSpent);
  const dbSpent = Number(db.total_spent);
  if (Math.abs(apiSpent - dbSpent) > 0.01) {
    console.log('❌ Total Spent: API', api.totalSpent, 'vs DB', db.total_spent);
    failed++;
  } else {
    console.log('✅ Total Spent match:', api.totalSpent);
  }

  console.log('');
  console.log(failed === 0 ? 'All checks passed.' : failed + ' check(s) failed.');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
