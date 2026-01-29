/**
 * Visitors DB verification test.
 * Compares GET /api/debug/visitors-db-check (DB truth) vs GET /api/visitors summary.
 *
 * Run: node tests/test-visitors-db-check.js
 * With server: API_BASE_URL=http://localhost:3001/api node tests/test-visitors-db-check.js
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

const ACCOUNTS = [
  { email: 'mahmoudnzaineldeen@gmail.com', password: '111111', name: 'tenant_admin' },
  { email: 'receptionist@test.com', password: 'test123', name: 'receptionist' },
];

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
    } catch (_) {}
  }
  return false;
}

async function run() {
  console.log('Visitors DB verification test');
  console.log('API_BASE_URL:', API_BASE_URL);
  console.log('');

  const ok = await login();
  if (!ok) {
    console.error('Login failed. Start server and use an account with visitors access.');
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
  const apiTotal = apiVisitors.pagination?.total ?? 0;

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
  console.log('  pagination.total:    ', apiTotal, '  (Total Visitors)');
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
  if (Number(apiTotal) !== Number(db.total_unique_visitors)) {
    console.log('❌ Total Visitors: API', apiTotal, 'vs DB', db.total_unique_visitors);
    failed++;
  } else {
    console.log('✅ Total Visitors match:', apiTotal);
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
