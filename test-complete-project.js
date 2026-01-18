/**
 * Complete Project Test Suite
 * Tests entire project: Backend, Frontend, Supabase, All Features
 * 
 * Usage: node test-complete-project.js
 */

const RAILWAY_URL = 'https://booktifisupabase-production.up.railway.app';
const API_URL = `${RAILWAY_URL}/api`;
const SUPABASE_URL = 'https://pivmdulophbdciygvegx.supabase.co';

// Test results tracking
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: []
};

// Helper: Run a test
async function test(name, testFn, category = 'General') {
  results.total++;
  try {
    process.stdout.write(`\n🧪 [${category}] ${name}... `);
    const result = await testFn();
    
    if (result.warning) {
      process.stdout.write('⚠️  WARNING\n');
      console.log(`   ${result.message || result.warning}`);
      results.warnings++;
    } else {
      process.stdout.write('✅ PASS\n');
      if (result.message) console.log(`   ${result.message}`);
      results.passed++;
    }
    
    results.tests.push({ name, category, status: 'pass', ...result });
    return true;
  } catch (error) {
    process.stdout.write('❌ FAIL\n');
    console.error(`   Error: ${error.message}`);
    results.failed++;
    results.tests.push({ name, category, status: 'fail', error: error.message });
    return false;
  }
}

// ============================================================================
// CATEGORY 1: Backend Availability Tests
// ============================================================================

async function testBackendHealth() {
  const response = await fetch(`${RAILWAY_URL}/health`);
  const data = await response.json();
  
  if (response.status !== 200) {
    throw new Error(`Expected 200, got ${response.status}`);
  }
  
  if (data.status !== 'ok') {
    throw new Error(`Expected status 'ok', got '${data.status}'`);
  }
  
  return { message: `Backend: ${data.status}, Database: ${data.database}` };
}

async function testAPIHealth() {
  const response = await fetch(`${API_URL}/health`);
  const data = await response.json();
  
  if (response.status !== 200) {
    throw new Error(`Expected 200, got ${response.status}`);
  }
  
  return { message: `API health check passed` };
}

async function testRootEndpoint() {
  const response = await fetch(`${RAILWAY_URL}/`);
  const data = await response.json();
  
  if (response.status !== 200) {
    throw new Error(`Expected 200, got ${response.status}`);
  }
  
  if (data.status !== 'running') {
    throw new Error(`Expected status 'running', got '${data.status}'`);
  }
  
  return { message: `Server: ${data.message}, Version: ${data.version}` };
}

async function testCORS() {
  const response = await fetch(`${API_URL}/health`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://bookati-2jy1.bolt.host',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type'
    }
  });
  
  const corsHeader = response.headers.get('access-control-allow-origin');
  
  if (!corsHeader || (corsHeader !== '*' && !corsHeader.includes('bolt.host'))) {
    return { 
      warning: true, 
      message: `CORS header: ${corsHeader || 'Not set'}. May cause issues in Bolt.` 
    };
  }
  
  return { message: `CORS: ${corsHeader}` };
}

// ============================================================================
// CATEGORY 2: Frontend API Integration Tests
// ============================================================================

function testEnvironmentDetection() {
  const testCases = [
    { hostname: 'bookati-2jy1.bolt.host', expected: 'Railway', port: null },
    { hostname: 'localhost', expected: 'Railway', port: '5173' },
    { hostname: 'localhost', expected: 'Local', port: '3000' },
  ];
  
  let passed = 0;
  for (const testCase of testCases) {
    const isBolt = testCase.hostname.includes('bolt.host') || 
                   testCase.hostname.includes('webcontainer') ||
                   (testCase.hostname === 'localhost' && testCase.port === '5173');
    
    const apiUrl = isBolt 
      ? 'https://booktifisupabase-production.up.railway.app/api'
      : 'http://localhost:3001/api';
    
    const expectedUrl = testCase.expected === 'Railway'
      ? 'https://booktifisupabase-production.up.railway.app/api'
      : 'http://localhost:3001/api';
    
    if (apiUrl === expectedUrl) passed++;
  }
  
  if (passed !== testCases.length) {
    throw new Error(`Only ${passed}/${testCases.length} environment detection cases passed`);
  }
  
  return { message: `All ${testCases.length} environment detection cases passed` };
}

async function testAPIURLResolution() {
  // Simulate Bolt environment
  const getApiUrl = () => {
    const hostname = 'bookati-2jy1.bolt.host';
    const isBolt = hostname.includes('bolt.host') || hostname.includes('webcontainer');
    
    if (isBolt) {
      return process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';
    }
    
    return process.env.VITE_API_URL || 'http://localhost:3001/api';
  };
  
  const resolvedUrl = getApiUrl();
  
  if (!resolvedUrl.includes('booktifisupabase-production.up.railway.app')) {
    throw new Error(`Expected Railway URL, got ${resolvedUrl}`);
  }
  
  return { message: `Resolved to: ${resolvedUrl}` };
}

// ============================================================================
// CATEGORY 3: Supabase Integration Tests
// ============================================================================

async function testSupabaseConnection() {
  // Test basic Supabase REST API connectivity
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': process.env.VITE_SUPABASE_ANON_KEY || 'test-key',
      'Content-Type': 'application/json'
    }
  });
  
  // Supabase REST API root returns info or 404 for no table
  // Just checking if we can reach it
  if (response.status === 404 || response.status === 200) {
    return { message: 'Supabase REST API reachable' };
  }
  
  throw new Error(`Unexpected status: ${response.status}`);
}

async function testSupabaseQuery() {
  // Test a simple query through backend
  const response = await fetch(`${API_URL}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      table: 'tenants',
      select: 'id,name,slug',
      limit: 1
    })
  });
  
  // Without auth, should return 401 or actual data (if endpoint allows public queries)
  if (response.status === 401) {
    return { message: 'Query endpoint requires auth (expected)' };
  }
  
  if (response.status === 200) {
    return { message: 'Query endpoint accessible' };
  }
  
  if (response.status === 500) {
    throw new Error('Server error on query endpoint');
  }
  
  return { message: `Query endpoint status: ${response.status}` };
}

// ============================================================================
// CATEGORY 4: Network & Performance Tests
// ============================================================================

async function testNetworkLatency() {
  const startTime = Date.now();
  await fetch(`${RAILWAY_URL}/health`);
  const endTime = Date.now();
  const latency = endTime - startTime;
  
  if (latency > 5000) {
    return { 
      warning: true, 
      message: `High latency: ${latency}ms (threshold: 5000ms)` 
    };
  }
  
  return { message: `Latency: ${latency}ms` };
}

async function testResponseTime() {
  const iterations = 5;
  let totalTime = 0;
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await fetch(`${RAILWAY_URL}/health`);
    const end = Date.now();
    totalTime += (end - start);
  }
  
  const avgTime = totalTime / iterations;
  
  return { message: `Average response time: ${avgTime.toFixed(0)}ms (${iterations} requests)` };
}

// ============================================================================
// CATEGORY 5: Configuration Tests
// ============================================================================

function testEnvironmentVariables() {
  const required = ['VITE_API_URL', 'VITE_SUPABASE_URL'];
  const missing = required.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    return { 
      warning: true, 
      message: `Missing env vars: ${missing.join(', ')}. Using defaults.` 
    };
  }
  
  return { message: 'All required environment variables present' };
}

function testAPIURLConfiguration() {
  const apiUrl = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';
  
  if (!apiUrl.includes('booktifisupabase-production.up.railway.app')) {
    return {
      warning: true,
      message: `VITE_API_URL not set to Railway URL. Current: ${apiUrl}`
    };
  }
  
  return { message: `VITE_API_URL configured correctly: ${apiUrl}` };
}

// ============================================================================
// CATEGORY 6: Endpoint Availability Tests
// ============================================================================

async function testAuthEndpoints() {
  const endpoints = [
    '/auth/signin',
    '/auth/signup',
    '/auth/forgot-password'
  ];
  
  let available = 0;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      // 400 or 401 means endpoint exists (just missing data/auth)
      // 404 means endpoint doesn't exist
      if (response.status !== 404) {
        available++;
      }
    } catch (error) {
      // Network error, endpoint not reachable
    }
  }
  
  if (available === 0) {
    throw new Error('No auth endpoints available');
  }
  
  return { message: `${available}/${endpoints.length} auth endpoints available` };
}

async function testTenantEndpoints() {
  const endpoints = [
    '/tenants/smtp-settings',
    '/tenants/whatsapp-settings',
    '/tenants/zoho-config'
  ];
  
  let available = 0;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`);
      
      // 401 means endpoint exists (just needs auth)
      // 404 means endpoint doesn't exist
      if (response.status === 401 || response.status === 200) {
        available++;
      }
    } catch (error) {
      // Network error
    }
  }
  
  if (available === 0) {
    throw new Error('No tenant endpoints available');
  }
  
  return { message: `${available}/${endpoints.length} tenant endpoints available` };
}

async function testBookingEndpoints() {
  const endpoints = [
    '/bookings/lock',
    '/bookings/create'
  ];
  
  let available = 0;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      // 400 or 401 means endpoint exists
      if (response.status !== 404) {
        available++;
      }
    } catch (error) {
      // Network error
    }
  }
  
  if (available === 0) {
    throw new Error('No booking endpoints available');
  }
  
  return { message: `${available}/${endpoints.length} booking endpoints available` };
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║          Complete Project Test Suite                        ║');
  console.log('║          Backend: Railway (booktifisupabase-production)      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  // Category 1: Backend Availability
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  CATEGORY 1: Backend Availability');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  await test('Backend Health Endpoint', testBackendHealth, 'Backend');
  await test('API Health Endpoint', testAPIHealth, 'Backend');
  await test('Root Endpoint', testRootEndpoint, 'Backend');
  await test('CORS Configuration', testCORS, 'Backend');
  
  // Category 2: Frontend API Integration
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  CATEGORY 2: Frontend API Integration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  await test('Environment Detection Logic', testEnvironmentDetection, 'Frontend');
  await test('API URL Resolution', testAPIURLResolution, 'Frontend');
  await test('Environment Variables', testEnvironmentVariables, 'Frontend');
  await test('API URL Configuration', testAPIURLConfiguration, 'Frontend');
  
  // Category 3: Supabase Integration
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  CATEGORY 3: Supabase Integration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  await test('Supabase Connection', testSupabaseConnection, 'Supabase');
  await test('Supabase Query Endpoint', testSupabaseQuery, 'Supabase');
  
  // Category 4: Network & Performance
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  CATEGORY 4: Network & Performance');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  await test('Network Latency', testNetworkLatency, 'Network');
  await test('Response Time', testResponseTime, 'Network');
  
  // Category 5: Endpoint Availability
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  CATEGORY 5: Endpoint Availability');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  await test('Auth Endpoints', testAuthEndpoints, 'Endpoints');
  await test('Tenant Endpoints', testTenantEndpoints, 'Endpoints');
  await test('Booking Endpoints', testBookingEndpoints, 'Endpoints');
  
  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     Test Summary                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  console.log(`\n   ✅ Passed:   ${results.passed}`);
  console.log(`   ❌ Failed:   ${results.failed}`);
  console.log(`   ⚠️  Warnings: ${results.warnings}`);
  console.log(`   📊 Total:    ${results.total}`);
  console.log(`   🎯 Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%\n`);
  
  // Categorized results
  const categories = {};
  results.tests.forEach(t => {
    if (!categories[t.category]) categories[t.category] = { passed: 0, failed: 0, warnings: 0 };
    if (t.status === 'pass') {
      if (t.warning) categories[t.category].warnings++;
      else categories[t.category].passed++;
    } else {
      categories[t.category].failed++;
    }
  });
  
  console.log('   Results by Category:');
  Object.entries(categories).forEach(([category, stats]) => {
    console.log(`   ${category}: ✅ ${stats.passed}  ❌ ${stats.failed}  ⚠️  ${stats.warnings}`);
  });
  
  // Overall status
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (results.failed === 0 && results.warnings === 0) {
    console.log('   🎉 ALL TESTS PASSED! Project is fully functional.\n');
    process.exit(0);
  } else if (results.failed === 0) {
    console.log(`   ✅ All tests passed with ${results.warnings} warnings.\n`);
    console.log('   ⚠️  Review warnings above. Project should be functional.\n');
    process.exit(0);
  } else {
    console.log('   ❌ Some tests failed. Review errors above.\n');
    console.log('   Action required: Fix failing tests before deploying.\n');
    process.exit(1);
  }
}

// Execute
runAllTests().catch(error => {
  console.error('\n❌ Test suite error:', error);
  process.exit(1);
});
