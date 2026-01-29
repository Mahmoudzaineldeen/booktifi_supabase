/**
 * Visitors Excel Export Tests
 *
 * Verifies that both Excel exports work as expected:
 *   1. Export Report (main visitors list) — GET /api/visitors/export/xlsx
 *   2. Export visitor details (full report per visitor) — GET /api/visitors/export/xlsx?detail=1
 *
 * Run:
 *   1. Start server: cd server && npm run dev
 *   2. Set credentials (tenant_admin or receptionist):
 *      PowerShell: $env:VISITORS_TEST_EMAIL="your@email.com"; $env:VISITORS_TEST_PASSWORD="yourpassword"
 *      CMD: set VISITORS_TEST_EMAIL=your@email.com& set VISITORS_TEST_PASSWORD=yourpassword
 *   3. node tests/test-visitors-excel-export.js
 *
 * Against deployed API:
 *   API_BASE_URL=https://your-app.up.railway.app/api node tests/test-visitors-excel-export.js
 *
 * Save Excel files to tests/output/ for manual inspection:
 *   SAVE_EXCEL=1 node tests/test-visitors-excel-export.js
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';
const envEmail = process.env.VISITORS_TEST_EMAIL || process.env.TEST_EMAIL;
const envPassword = process.env.VISITORS_TEST_PASSWORD || process.env.TEST_PASSWORD;
const SAVE_EXCEL = /^(1|true|yes)$/i.test(String(process.env.SAVE_EXCEL || '0').trim());

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
      if (acc === ACCOUNTS[0]) console.error('Request error:', e.message);
    }
  }
  return false;
}

function log(name, passed, detail = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  return passed;
}

// Optional: parse xlsx buffer to verify sheet names (uses server's xlsx if available)
async function parseXlsxBuffer(buffer) {
  try {
    const path = (await import('path')).default;
    const fs = (await import('fs')).default;
    const { fileURLToPath } = await import('url');
    const { createRequire } = await import('module');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const require = createRequire(import.meta.url);
    const xlsxPath = path.join(__dirname, '..', 'server', 'node_modules', 'xlsx');
    if (!fs.existsSync(path.join(xlsxPath, 'package.json'))) return null;
    const XLSX = require(xlsxPath);
    const wb = XLSX.read(buffer, { type: 'buffer' });
    return { SheetNames: wb.SheetNames, sheets: wb.SheetNames.map((n) => ({ name: n, rows: wb.Sheets[n] ? Object.keys(wb.Sheets[n]).length : 0 })) };
  } catch (e) {
    return null;
  }
}

async function run() {
  console.log('Visitors Excel Export Tests');
  console.log('API_BASE_URL:', API_BASE_URL);
  console.log('');

  const ok = await login();
  if (!ok) {
    console.error('Login failed. Set VISITORS_TEST_EMAIL and VISITORS_TEST_PASSWORD (tenant_admin or receptionist).');
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  let passed = 0;
  let failed = 0;

  // --- 1. Export Report (main visitors list) — no detail=1 ---
  console.log('1. Export Report (visitors list Excel)');
  try {
    const urlReport = `${API_BASE_URL}/visitors/export/xlsx?includeTotals=1&includeVisitorDetails=1`;
    const resReport = await fetch(urlReport, { headers });
    const contentType = resReport.headers.get('content-type') || '';
    const isXlsx = contentType.includes('spreadsheet') || contentType.includes('xlsx') || contentType.includes('octet-stream');
    const bufferReport = await resReport.arrayBuffer();
    const sizeReport = bufferReport.byteLength;

    const statusOk = log('Export Report: status 200', resReport.ok && resReport.status === 200, resReport.ok ? '' : `status ${resReport.status}`);
    statusOk ? passed++ : failed++;

    const typeOk = log('Export Report: Content-Type is Excel', isXlsx, contentType.slice(0, 60));
    typeOk ? passed++ : failed++;

    const sizeOk = log('Export Report: non-empty file', sizeReport > 200, `size ${sizeReport} bytes`);
    sizeOk ? passed++ : failed++;

    if (SAVE_EXCEL && resReport.ok && sizeReport > 0) {
      const path = (await import('path')).default;
      const fs = (await import('fs')).default;
      const { fileURLToPath } = await import('url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const outDir = path.join(__dirname, 'output');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const reportPath = path.join(outDir, 'visitors-export-report.xlsx');
      fs.writeFileSync(reportPath, Buffer.from(bufferReport));
      console.log('   📁 Saved: tests/output/visitors-export-report.xlsx');
    }

    const parsedReport = await parseXlsxBuffer(Buffer.from(bufferReport));
    if (parsedReport) {
      const hasSummary = parsedReport.SheetNames.includes('Summary');
      const hasVisitors = parsedReport.SheetNames.includes('Visitors');
      const sheetsOk = log('Export Report: sheets Summary + Visitors', hasSummary && hasVisitors, parsedReport.SheetNames.join(', '));
      sheetsOk ? passed++ : failed++;
    } else {
      console.log('   ⚠ Skip sheet check (xlsx not in server/node_modules or require failed)');
    }
  } catch (e) {
    log('Export Report: request', false, e.message);
    failed++;
  }
  console.log('');

  // --- 2. Export visitor details (detail=1) — full report like PDF ---
  console.log('2. Export visitor details (detail=1, full report)');
  try {
    const urlDetails = `${API_BASE_URL}/visitors/export/xlsx?detail=1&includeTotals=1&includeVisitorDetails=1`;
    const resDetails = await fetch(urlDetails, { headers });
    const contentTypeDetails = resDetails.headers.get('content-type') || '';
    const isXlsxDetails = contentTypeDetails.includes('spreadsheet') || contentTypeDetails.includes('xlsx') || contentTypeDetails.includes('octet-stream');
    const bufferDetails = await resDetails.arrayBuffer();
    const sizeDetails = bufferDetails.byteLength;

    const statusOk = log('Export visitor details: status 200', resDetails.ok && resDetails.status === 200, resDetails.ok ? '' : `status ${resDetails.status}`);
    statusOk ? passed++ : failed++;

    const typeOk = log('Export visitor details: Content-Type is Excel', isXlsxDetails, contentTypeDetails.slice(0, 60));
    typeOk ? passed++ : failed++;

    const sizeOk = log('Export visitor details: non-empty file', sizeDetails > 200, `size ${sizeDetails} bytes`);
    sizeOk ? passed++ : failed++;

    if (SAVE_EXCEL && resDetails.ok && sizeDetails > 0) {
      const path = (await import('path')).default;
      const fs = (await import('fs')).default;
      const { fileURLToPath } = await import('url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const outDir = path.join(__dirname, 'output');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const detailsPath = path.join(outDir, 'visitor-details-export.xlsx');
      fs.writeFileSync(detailsPath, Buffer.from(bufferDetails));
      console.log('   📁 Saved: tests/output/visitor-details-export.xlsx');
    }

    const parsedDetails = await parseXlsxBuffer(Buffer.from(bufferDetails));
    if (parsedDetails) {
      const names = parsedDetails.SheetNames;
      const hasFullReport = names.includes('Visitor Details Report');
      const hasSummary = names.includes('Summary');
      const hasVisitorInfo = names.includes('Visitor Info');
      const hasActivePackages = names.includes('Active Packages');
      const hasBookingHistory = names.includes('Booking History');
      // Accept 5 sheets (with Visitor Details Report) or 4 section sheets (deployed may be older)
      const allSheets = (hasFullReport && hasSummary && hasVisitorInfo && hasActivePackages && hasBookingHistory) ||
        (hasSummary && hasVisitorInfo && hasActivePackages && hasBookingHistory);
      const sheetsOk = log('Export visitor details: expected sheets present', allSheets, names.join(', '));
      sheetsOk ? passed++ : failed++;
    } else {
      console.log('   ⚠ Skip sheet check (xlsx not in server/node_modules or require failed)');
    }
  } catch (e) {
    log('Export visitor details: request', false, e.message);
    failed++;
  }
  console.log('');

  // --- Summary ---
  console.log('---');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
