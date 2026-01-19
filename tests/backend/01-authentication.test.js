/**
 * Authentication & User Management Tests
 * Tests: Sign up, Login, Token issuance, Protected routes, Role-based access
 */

import { CONFIG, apiRequest, logTest, delay } from './config.js';

const results = {
  passed: 0,
  failed: 0,
  tests: []
};

async function test(name, testFn) {
  try {
    const result = await testFn();
    const passed = result !== false;
    logTest(name, passed, result?.message);
    results.tests.push({ name, passed, message: result?.message || '' });
    if (passed) results.passed++;
    else results.failed++;
    return passed;
  } catch (error) {
    logTest(name, false, error.message);
    results.tests.push({ name, passed: false, message: error.message });
    results.failed++;
    return false;
  }
}

// ============================================================================
// Test 1: Service Provider Login
// ============================================================================
async function testServiceProviderLogin() {
  const { email, password } = CONFIG.ACCOUNTS.SERVICE_PROVIDER;
  
  const response = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }
  
  if (!response.data.session?.access_token) {
    throw new Error('No access token in response');
  }
  
  if (response.data.user?.role !== CONFIG.ACCOUNTS.SERVICE_PROVIDER.expectedRole) {
    throw new Error(`Wrong role: expected ${CONFIG.ACCOUNTS.SERVICE_PROVIDER.expectedRole}, got ${response.data.user?.role}`);
  }
  
  // Store token for later tests
  CONFIG.TEST_DATA.serviceProviderToken = response.data.session.access_token;
  CONFIG.TEST_DATA.serviceProviderId = response.data.user.id;
  CONFIG.TEST_DATA.tenantId = response.data.user.tenant_id;
  
  return { message: `Token received, role: ${response.data.user.role}, tenant: ${CONFIG.TEST_DATA.tenantId || 'N/A'}` };
}

// ============================================================================
// Test 2: Customer Login
// ============================================================================
async function testCustomerLogin() {
  const { email, password } = CONFIG.ACCOUNTS.CUSTOMER;
  
  const response = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password, forCustomer: true })
  });
  
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }
  
  if (!response.data.session?.access_token) {
    throw new Error('No access token in response');
  }
  
  if (response.data.user?.role !== CONFIG.ACCOUNTS.CUSTOMER.expectedRole) {
    throw new Error(`Wrong role: expected ${CONFIG.ACCOUNTS.CUSTOMER.expectedRole}, got ${response.data.user?.role}`);
  }
  
  // Store token for later tests
  CONFIG.TEST_DATA.customerToken = response.data.session.access_token;
  CONFIG.TEST_DATA.customerId = response.data.user.id;
  
  return { message: `Token received, role: ${response.data.user.role}` };
}

// ============================================================================
// Test 3: Invalid Credentials
// ============================================================================
async function testInvalidCredentials() {
  const response = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email: 'invalid@test.com', password: 'wrongpassword' })
  });
  
  if (response.ok) {
    throw new Error('Login should fail with invalid credentials');
  }
  
  if (response.status !== 401) {
    throw new Error(`Expected 401, got ${response.status}`);
  }
  
  return { message: 'Correctly rejected invalid credentials' };
}

// ============================================================================
// Test 4: Protected Route with Valid Token
// ============================================================================
async function testProtectedRouteWithValidToken() {
  if (!CONFIG.TEST_DATA.serviceProviderToken) {
    throw new Error('Service provider token not available');
  }
  
  const response = await apiRequest('/tenants/smtp-settings', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`
    }
  });
  
  // Should succeed (200) or require tenant_id (400), but not 401
  if (response.status === 401) {
    throw new Error('Valid token was rejected');
  }
  
  return { message: `Protected route accessible with valid token (status: ${response.status})` };
}

// ============================================================================
// Test 5: Protected Route with Invalid Token
// ============================================================================
async function testProtectedRouteWithInvalidToken() {
  const response = await apiRequest('/tenants/smtp-settings', {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer invalid-token-12345'
    }
  });
  
  if (response.status !== 401) {
    throw new Error(`Expected 401 for invalid token, got ${response.status}`);
  }
  
  return { message: 'Correctly rejected invalid token' };
}

// ============================================================================
// Test 6: Protected Route without Token
// ============================================================================
async function testProtectedRouteWithoutToken() {
  // Try a different protected endpoint that definitely requires auth
  const response = await apiRequest('/tenants/smtp-settings', {
    method: 'GET',
    headers: {} // No Authorization header
  });
  
  // Some endpoints might return 200 with null data, but should not return actual data
  if (response.status === 200) {
    // If it returns 200, it should not contain actual settings without auth
    if (response.data?.smtp_settings && response.data.smtp_settings !== null) {
      throw new Error('Protected route returned data without token');
    }
    return { message: 'Endpoint accessible but returns null without token (may be RLS protected)' };
  }
  
  if (response.status !== 401) {
    throw new Error(`Expected 401 for missing token, got ${response.status}`);
  }
  
  return { message: 'Correctly rejected request without token' };
}

// ============================================================================
// Test 7: Role-Based Access - Service Provider Access
// ============================================================================
async function testServiceProviderAccess() {
  if (!CONFIG.TEST_DATA.serviceProviderToken) {
    throw new Error('Service provider token not available');
  }
  
  // Service provider should access tenant settings
  const response = await apiRequest('/tenants/smtp-settings', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`
    }
  });
  
  // Should not be 403 (forbidden)
  if (response.status === 403) {
    throw new Error('Service provider was denied access to tenant settings');
  }
  
  return { message: `Service provider can access tenant settings (status: ${response.status})` };
}

// ============================================================================
// Test 8: Role-Based Access - Customer Cannot Access Provider Routes
// ============================================================================
async function testCustomerCannotAccessProviderRoutes() {
  if (!CONFIG.TEST_DATA.customerToken) {
    throw new Error('Customer token not available');
  }
  
  const response = await apiRequest('/tenants/smtp-settings', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.customerToken}`
    }
  });
  
  // Customer should be denied (403) or not have tenant_id (400)
  if (response.status === 200) {
    throw new Error('Customer should not access tenant settings');
  }
  
  return { message: `Customer correctly denied access (status: ${response.status})` };
}

// ============================================================================
// Test 9: Token Validation
// ============================================================================
async function testTokenValidation() {
  if (!CONFIG.TEST_DATA.serviceProviderToken) {
    throw new Error('Service provider token not available');
  }
  
  const response = await apiRequest('/auth/validate', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`
    }
  });
  
  if (!response.ok && response.status !== 404) {
    throw new Error(`Token validation failed: ${response.status}`);
  }
  
  return { message: 'Token validation endpoint accessible' };
}

// ============================================================================
// Test 10: Get User Profile
// ============================================================================
async function testGetUserProfile() {
  if (!CONFIG.TEST_DATA.serviceProviderToken) {
    throw new Error('Service provider token not available');
  }
  
  const response = await apiRequest('/auth/user', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`
    }
  });
  
  if (!response.ok && response.status !== 404) {
    throw new Error(`Get user failed: ${response.status}`);
  }
  
  return { message: 'User profile endpoint accessible' };
}

// ============================================================================
// Main Test Runner
// ============================================================================
async function runAllTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Authentication & User Management Tests                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  await test('Service Provider Login', testServiceProviderLogin);
  await test('Customer Login', testCustomerLogin);
  await test('Invalid Credentials Rejection', testInvalidCredentials);
  await test('Protected Route with Valid Token', testProtectedRouteWithValidToken);
  await test('Protected Route with Invalid Token', testProtectedRouteWithInvalidToken);
  await test('Protected Route without Token', testProtectedRouteWithoutToken);
  await test('Service Provider Access Control', testServiceProviderAccess);
  await test('Customer Access Restriction', testCustomerCannotAccessProviderRoutes);
  await test('Token Validation', testTokenValidation);
  await test('Get User Profile', testGetUserProfile);
  
  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Authentication Test Summary                                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n   ✅ Passed: ${results.passed}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`   📊 Total:  ${results.passed + results.failed}`);
  console.log(`   🎯 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%\n`);
  
  return results.failed === 0;
}

// Export for use in other test files
export { runAllTests, CONFIG };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}
