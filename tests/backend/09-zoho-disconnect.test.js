/**
 * Zoho Disconnect Endpoint Tests
 * Tests for the Zoho disconnect functionality
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
// Setup: Sign in as tenant admin
// ============================================================================
async function setupTenantAdmin() {
  const { email, password } = CONFIG.ACCOUNTS.SERVICE_PROVIDER;
  
  const response = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password, forCustomer: false })
  });
  
  if (!response.ok || !response.data.session?.access_token) {
    throw new Error('Failed to sign in as tenant admin');
  }
  
  CONFIG.TEST_DATA.serviceProviderToken = response.data.session.access_token;
  CONFIG.TEST_DATA.serviceProviderId = response.data.user?.id;
  CONFIG.TEST_DATA.tenantId = response.data.user?.tenant_id;
  
  return response.data.session.access_token;
}

// ============================================================================
// Test 1: Disconnect Without Token (Should Fail)
// ============================================================================
async function testDisconnectWithoutToken() {
  const response = await apiRequest('/zoho/disconnect', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: 'invalid-tenant-id' }),
  });

  // Should fail without authentication or with invalid tenant
  if (response.ok && response.status === 200) {
    throw new Error('Disconnect should require authentication or valid tenant');
  }

  return { message: 'Disconnect correctly requires authentication' };
}

// ============================================================================
// Test 2: Disconnect With Authentication (Should Succeed)
// ============================================================================
async function testDisconnectWithAuth() {
  if (!CONFIG.TEST_DATA.tenantId || !CONFIG.TEST_DATA.serviceProviderToken) {
    throw new Error('Must setup tenant admin first');
  }

  // First check if there's a token to disconnect
  const statusResponse = await apiRequest(`/zoho/status?tenant_id=${CONFIG.TEST_DATA.tenantId}`, {
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`,
    },
  });

  if (!statusResponse.data.connected) {
    return { message: 'No Zoho connection to disconnect (expected if not connected)' };
  }

  // Now disconnect
  const response = await apiRequest('/zoho/disconnect', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: CONFIG.TEST_DATA.tenantId }),
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`,
    },
  });

  if (!response.ok || response.status !== 200) {
    throw new Error(`Disconnect failed: ${JSON.stringify(response.data)}`);
  }

  if (!response.data.success) {
    throw new Error('Response should indicate success');
  }

  // Verify token is deleted
  await delay(1000);
  const verifyResponse = await apiRequest(`/zoho/status?tenant_id=${CONFIG.TEST_DATA.tenantId}`, {
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`,
    },
  });

  if (verifyResponse.data.connected) {
    throw new Error('Token should be deleted after disconnect');
  }

  return { message: 'Zoho disconnected successfully and token deleted' };
}

// ============================================================================
// Test 3: Disconnect Without Tenant ID (Should Fail)
// ============================================================================
async function testDisconnectWithoutTenantId() {
  if (!CONFIG.TEST_DATA.serviceProviderToken) {
    throw new Error('Must setup tenant admin first');
  }

  const response = await apiRequest('/zoho/disconnect', {
    method: 'POST',
    body: JSON.stringify({}), // No tenant_id
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`,
    },
  });

  if (response.ok && response.status === 200) {
    throw new Error('Disconnect should require tenant_id');
  }

  if (response.status !== 400) {
    throw new Error(`Expected 400, got ${response.status}`);
  }

  return { message: 'Disconnect correctly requires tenant_id' };
}

// ============================================================================
// Test 4: Disconnect Multiple Times (Should Handle Gracefully)
// ============================================================================
async function testDisconnectMultipleTimes() {
  if (!CONFIG.TEST_DATA.tenantId || !CONFIG.TEST_DATA.serviceProviderToken) {
    throw new Error('Must setup tenant admin first');
  }

  // First disconnect
  const response1 = await apiRequest('/zoho/disconnect', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: CONFIG.TEST_DATA.tenantId }),
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`,
    },
  });

  await delay(500);

  // Try to disconnect again (should handle gracefully)
  const response2 = await apiRequest('/zoho/disconnect', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: CONFIG.TEST_DATA.tenantId }),
    headers: {
      'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}`,
    },
  });

  // Both should succeed (idempotent operation)
  if (!response1.ok || !response2.ok) {
    throw new Error('Disconnect should be idempotent');
  }

  return { message: 'Multiple disconnects handled gracefully' };
}

// ============================================================================
// Main Test Runner
// ============================================================================
export async function runAllTests() {
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 9: Zoho Disconnect Endpoint');
  console.log('═'.repeat(62));
  console.log('\n');

  try {
    // Setup
    await test('Setup: Sign in as tenant admin', async () => {
      await setupTenantAdmin();
      return { message: 'Tenant admin authenticated' };
    });

    await delay(1000);

    // Run tests
    await test('Security: Disconnect without token fails', testDisconnectWithoutToken);
    await test('Disconnect: Disconnect with authentication', testDisconnectWithAuth);
    await test('Validation: Disconnect without tenant_id fails', testDisconnectWithoutTenantId);
    await test('Idempotency: Multiple disconnects handled gracefully', testDisconnectMultipleTimes);

    // Summary
    console.log('\n' + '─'.repeat(62));
    console.log('Zoho Disconnect Test Summary:');
    console.log(`  ✅ Passed: ${results.passed}`);
    console.log(`  ❌ Failed: ${results.failed}`);
    console.log(`  📊 Total: ${results.passed + results.failed}`);
    console.log('─'.repeat(62) + '\n');

    return results.failed === 0;
  } catch (error) {
    console.error('\n❌ Test suite error:', error);
    return false;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
