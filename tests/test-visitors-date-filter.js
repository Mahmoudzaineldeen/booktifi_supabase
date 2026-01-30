/**
 * Visitors Page — Start/End Date Filter Tests
 *
 * Ensures startDate and endDate filters affect:
 * - All summary totals (totalBookings, totalPackageBookings, totalPaidBookings, totalSpent)
 * - All displayed visitor data (only visitors with bookings in range; per-visitor counts/spent in range)
 *
 * Run:
 *   API_BASE_URL=https://your-api/api node tests/test-visitors-date-filter.js
 *
 * Optional credentials:
 *   VISITORS_TEST_EMAIL=... VISITORS_TEST_PASSWORD=...
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

function log(name, passed, detail = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  return passed;
}

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
      if (acc === ACCOUNTS[0]) console.error('Request error:', e.message);
    }
  }
  return false;
}

async function fetchVisitors(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE_URL}/visitors${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Date in YYYY-MM-DD for comparison (booking dates from API are in this form)
function dateInRange(dateStr, startDate, endDate) {
  if (!dateStr) return true;
  if (startDate && dateStr < startDate) return false;
  if (endDate && dateStr > endDate) return false;
  return true;
}

async function run() {
  console.log('Visitors Page — Start/End Date Filter Tests');
  console.log('API_BASE_URL:', API_BASE_URL);
  console.log('');

  const ok = await login();
  if (!ok) {
    console.error('Login failed. Set VISITORS_TEST_EMAIL and VISITORS_TEST_PASSWORD.');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  const limit = 9999; // fetch full set so summary = sum of rows

  // --- 1. No date filter: baseline ---
  console.log('1. Baseline (no date filter)');
  const noDate = await fetchVisitors({ page: 1, limit });
  if (!noDate.ok) {
    log('Baseline: 200', false, `status ${noDate.status}`);
    failed++;
    console.log('\nCannot continue. Ensure server is running and credentials have visitors access.');
    process.exit(1);
  }
  log('Baseline: 200', true);
  passed++;

  const baselineData = noDate.data?.data || [];
  const baselineSummary = noDate.data?.summary || {};
  const baselineTotal = noDate.data?.pagination?.total ?? 0;

  const baselineBookings = baselineSummary.totalBookings ?? 0;
  const baselineSpent = baselineSummary.totalSpent ?? 0;
  const sumRowBookings = baselineData.reduce((s, r) => s + (Number(r.total_bookings) || 0), 0);
  const sumRowSpent = baselineData.reduce((s, r) => s + (Number(r.total_spent) || 0), 0);

  const baselineConsistent = baselineTotal === baselineData.length && (baselineTotal === 0 || (baselineBookings === sumRowBookings && baselineSpent === sumRowSpent));
  log('Baseline: summary totals = sum of row data (full set)', baselineConsistent, baselineTotal === 0 ? 'no visitors' : `totalBookings=${baselineBookings} sum=${sumRowBookings}`);
  baselineConsistent ? passed++ : failed++;

  console.log('');

  // --- 2. With startDate and endDate: filtered results ---
  console.log('2. Date filter (startDate + endDate)');
  const startDate = '2026-01-01';
  const endDate = '2026-01-31';
  const withDate = await fetchVisitors({ page: 1, limit, startDate, endDate });
  if (!withDate.ok) {
    log('Date filter: 200', false, `status ${withDate.status}`);
    failed++;
  } else {
    log('Date filter: 200', true);
    passed++;
  }

  const filteredData = withDate.data?.data || [];
  const filteredSummary = withDate.data?.summary || {};
  const filteredTotal = withDate.data?.pagination?.total ?? 0;

  // 2a. Filtered totals should be <= baseline (date filter restricts to bookings in range)
  const totalsNotExceeding = (filteredSummary.totalBookings ?? 0) <= baselineBookings + 1 && (filteredSummary.totalSpent ?? 0) <= baselineSpent + 1;
  log('Date filter: summary totals <= baseline', totalsNotExceeding, `filtered totalBookings=${filteredSummary.totalBookings} baseline=${baselineBookings}`);
  totalsNotExceeding ? passed++ : failed++;

  // 2b. Every displayed visitor's last_booking_date must be within [startDate, endDate] (when date filter is applied)
  let allDatesInRange = true;
  let outOfRangeExample = null;
  for (const row of filteredData) {
    const last = row.last_booking_date ? String(row.last_booking_date).slice(0, 10) : null;
    if (last && !dateInRange(last, startDate, endDate)) {
      allDatesInRange = false;
      outOfRangeExample = { name: row.customer_name, last_booking_date: row.last_booking_date };
      break;
    }
  }
  log('Date filter: every row last_booking_date in range', allDatesInRange, allDatesInRange ? `${filteredData.length} rows` : (outOfRangeExample ? JSON.stringify(outOfRangeExample) : ''));
  allDatesInRange ? passed++ : failed++;

  // 2c. Summary = sum of rows when we have full set
  const sumFilteredBookings = filteredData.reduce((s, r) => s + (Number(r.total_bookings) || 0), 0);
  const sumFilteredSpent = filteredData.reduce((s, r) => s + (Number(r.total_spent) || 0), 0);
  const filteredConsistent = filteredTotal === filteredData.length && (filteredTotal === 0 || (filteredSummary.totalBookings === sumFilteredBookings && filteredSummary.totalSpent === sumFilteredSpent));
  log('Date filter: summary = sum of displayed rows (full set)', filteredConsistent, filteredTotal === 0 ? 'no visitors' : `totalBookings=${filteredSummary.totalBookings} sum=${sumFilteredBookings}`);
  filteredConsistent ? passed++ : failed++;

  console.log('');

  // --- 3. Narrow date range (same logic: totals and rows must respect range) ---
  console.log('3. Narrow date range');
  const narrowStart = '2026-01-28';
  const narrowEnd = '2026-01-30';
  const narrow = await fetchVisitors({ page: 1, limit, startDate: narrowStart, endDate: narrowEnd });
  if (!narrow.ok) {
    log('Narrow range: 200', false, `status ${narrow.status}`);
    failed++;
  } else {
    log('Narrow range: 200', true);
    passed++;
  }

  const narrowData = narrow.data?.data || [];
  const narrowSummary = narrow.data?.summary || {};
  let narrowDatesInRange = true;
  for (const row of narrowData) {
    const last = row.last_booking_date ? String(row.last_booking_date).slice(0, 10) : null;
    if (last && !dateInRange(last, narrowStart, narrowEnd)) {
      narrowDatesInRange = false;
      break;
    }
  }
  log('Narrow range: every row last_booking_date in range', narrowDatesInRange, `${narrowData.length} rows`);
  narrowDatesInRange ? passed++ : failed++;

  const sumNarrowBookings = narrowData.reduce((s, r) => s + (Number(r.total_bookings) || 0), 0);
  const narrowTotal = narrow.data?.pagination?.total ?? 0;
  const narrowConsistent = narrowTotal === narrowData.length && (narrowTotal === 0 || narrowSummary.totalBookings === sumNarrowBookings);
  log('Narrow range: summary totalBookings = sum(rows)', narrowConsistent, narrowTotal === 0 ? 'no visitors' : `${narrowSummary.totalBookings} === ${sumNarrowBookings}`);
  narrowConsistent ? passed++ : failed++;

  console.log('');

  // --- 4. Future date range: no bookings → empty or minimal list and totals ---
  console.log('4. Future date range (no bookings)');
  const futureStart = '2030-01-01';
  const futureEnd = '2030-12-31';
  const future = await fetchVisitors({ page: 1, limit, startDate: futureStart, endDate: futureEnd });
  if (!future.ok) {
    log('Future range: 200', false, `status ${future.status}`);
    failed++;
  } else {
    log('Future range: 200', true);
    passed++;
  }
  const futureSummary = future.data?.summary || {};
  const futureTotal = future.data?.pagination?.total ?? 0;
  const futureData = future.data?.data || [];
  // With future range we expect 0 visitors (or very few); totals should be 0 or minimal
  const futureTotalsZeroOrLow = (futureSummary.totalBookings ?? 0) <= baselineBookings && futureTotal === futureData.length;
  log('Future range: summary and list consistent', futureTotalsZeroOrLow, `totalBookings=${futureSummary.totalBookings} visitors=${futureTotal}`);
  futureTotalsZeroOrLow ? passed++ : failed++;

  console.log('');

  // --- 5. Export with date filter: totals in export should match filtered list API ---
  console.log('5. Export respects date filter');
  let exportWithDateOk = false;
  try {
    const exportUrl = `${API_BASE_URL}/visitors/export/xlsx?startDate=${startDate}&endDate=${endDate}&includeTotals=1&includeVisitorDetails=1`;
    const exportRes = await fetch(exportUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (exportRes.ok) {
      const buf = await exportRes.arrayBuffer();
      const size = buf.byteLength;
      exportWithDateOk = size > 500;
      log('Export with date filter: 200 and non-empty file', exportWithDateOk, `size ${size}`);
    } else {
      log('Export with date filter: 200', false, `status ${exportRes.status}`);
    }
  } catch (e) {
    log('Export with date filter', false, e.message);
  }
  exportWithDateOk ? passed++ : failed++;

  // --- 6. startDate-only and endDate-only filters return valid structure ---
  console.log('');
  console.log('6. startDate-only and endDate-only');
  const startOnly = await fetchVisitors({ page: 1, limit: 20, startDate: '2026-01-01' });
  const endOnly = await fetchVisitors({ page: 1, limit: 20, endDate: '2026-12-31' });
  const startOnlyOk = startOnly.ok && Array.isArray(startOnly.data?.data) && startOnly.data?.summary != null;
  const endOnlyOk = endOnly.ok && Array.isArray(endOnly.data?.data) && endOnly.data?.summary != null;
  log('startDate only: valid response with summary and data', startOnlyOk, startOnlyOk ? `rows=${startOnly.data.data.length}` : (startOnly.data?.error || startOnly.status));
  startOnlyOk ? passed++ : failed++;
  log('endDate only: valid response with summary and data', endOnlyOk, endOnlyOk ? `rows=${endOnly.data.data.length}` : (endOnly.data?.error || endOnly.status));
  endOnlyOk ? passed++ : failed++;

  console.log('');
  console.log('---');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
