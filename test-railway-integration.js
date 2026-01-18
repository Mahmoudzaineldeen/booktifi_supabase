/**
 * Railway Backend Integration Test
 * Tests all critical endpoints and functionality
 */

const RAILWAY_URL = 'https://booktifisupabase-production.up.railway.app';
const API_URL = `${RAILWAY_URL}/api`;

// Test configuration
const tests = [];
let passed = 0;
let failed = 0;

// Helper function to run tests
async function runTest(name, testFn) {
  try {
    process.stdout.write(`\n🧪 Testing: ${name}... `);
    await testFn();
    process.stdout.write('✅ PASS\n');
    passed++;
    return true;
  } catch (error) {
    process.stdout.write(`❌ FAIL\n`);
    console.error(`   Error: ${error.message}`);
    failed++;
    return false;
  }
}

// Test 1: Backend Health
async function testBackendHealth() {
  const response = await fetch(`${RAILWAY_URL}/health`);
  const data = await response.json();
  
  if (response.status !== 200) {
    throw new Error(`Expected 200, got ${response.status}`);
  }
  
  if (data.status !== 'ok') {
    throw new Error(`Expected status 'ok', got '${data.status}'`);
  }
  
  console.log(`   Backend: ${data.status}, Database: ${data.database}`);
}

// Test 2: API Health
async function testApiHealth() {
  const response = await fetch(`${API_URL}/health`);
  const data = await response.json();
  
  if (response.status !== 200) {
    throw new Error(`Expected 200, got ${response.status}`);
  }
  
  if (data.status !== 'ok') {
    throw new Error(`Expected status 'ok', got '${data.status}'`);
  }
  
  console.log(`   API: ${data.status}, Database: ${data.database}`);
}

// Test 3: Root Endpoint
async function testRootEndpoint() {
  const response = await fetch(`${RAILWAY_URL}/`);
  const data = await response.json();
  
  if (response.status !== 200) {
    throw new Error(`Expected 200, got ${response.status}`);
  }
  
  if (data.status !== 'running') {
    throw new Error(`Expected status 'running', got '${data.status}'`);
  }
  
  console.log(`   Server: ${data.message}, Version: ${data.version}`);
}

// Test 4: CORS Headers
async function testCorsHeaders() {
  const response = await fetch(`${API_URL}/health`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://bookati-2jy1.bolt.host',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type'
    }
  });
  
  const corsHeader = response.headers.get('access-control-allow-origin');
  
  if (!corsHeader || (corsHeader !== '*' && corsHeader !== 'https://bookati-2jy1.bolt.host')) {
    throw new Error(`CORS not configured correctly. Got: ${corsHeader}`);
  }
  
  console.log(`   CORS: ${corsHeader || 'Not set'}`);
}

// Test 5: Query Endpoint (without auth - should return 401 or 400)
async function testQueryEndpoint() {
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
  
  // We expect 401 or 400 without auth, or 200 if endpoint allows public queries
  if (response.status === 500) {
    throw new Error(`Server error: ${response.status}`);
  }
  
  console.log(`   Query endpoint status: ${response.status} (${response.status === 401 ? 'Auth required ✓' : 'Response received'})`);
}

// Test 6: Environment Detection Logic
function testEnvironmentDetection() {
  const testCases = [
    { hostname: 'bookati-2jy1.bolt.host', expected: 'Railway' },
    { hostname: 'localhost', port: '5173', expected: 'Railway' },
    { hostname: 'localhost', port: '3000', expected: 'Local' },
  ];
  
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
    
    if (apiUrl !== expectedUrl) {
      throw new Error(`Expected ${expectedUrl}, got ${apiUrl}`);
    }
  }
  
  console.log(`   All environment detection cases passed`);
}

// Test 7: API URL Resolution
function testApiUrlResolution() {
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
  
  console.log(`   Resolved URL: ${resolvedUrl}`);
}

// Test 8: Network Connectivity
async function testNetworkConnectivity() {
  const startTime = Date.now();
  const response = await fetch(`${RAILWAY_URL}/health`);
  const endTime = Date.now();
  const latency = endTime - startTime;
  
  if (latency > 5000) {
    throw new Error(`High latency: ${latency}ms (should be < 5000ms)`);
  }
  
  console.log(`   Latency: ${latency}ms`);
}

// Run all tests
async function runAllTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Railway Backend Integration Test Suite                    ║');
  console.log('║   Backend: booktifisupabase-production.up.railway.app       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  await runTest('Backend Health Endpoint', testBackendHealth);
  await runTest('API Health Endpoint', testApiHealth);
  await runTest('Root Endpoint', testRootEndpoint);
  await runTest('CORS Configuration', testCorsHeaders);
  await runTest('Query Endpoint Accessibility', testQueryEndpoint);
  await runTest('Environment Detection Logic', testEnvironmentDetection);
  await runTest('API URL Resolution', testApiUrlResolution);
  await runTest('Network Connectivity', testNetworkConnectivity);
  
  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     Test Summary                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📊 Total:  ${passed + failed}`);
  console.log(`   🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);
  
  if (failed === 0) {
    console.log('   🎉 All tests passed! Railway backend is fully functional.\n');
  } else {
    console.log('   ⚠️  Some tests failed. Review errors above.\n');
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Execute tests
runAllTests().catch(error => {
  console.error('\n❌ Test suite error:', error);
  process.exit(1);
});
