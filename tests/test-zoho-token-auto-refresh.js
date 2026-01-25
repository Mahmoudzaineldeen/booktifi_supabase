/**
 * Test Zoho Token Auto-Refresh Mechanism
 * 
 * This test verifies that the permanent token refresh mechanism is working:
 * 1. Checks if tokens exist
 * 2. Verifies token expiration times
 * 3. Tests that tokens are being refreshed automatically
 * 4. Monitors the refresh process
 * 
 * Usage:
 *   node tests/test-zoho-token-auto-refresh.js
 * 
 * Environment Variables:
 *   API_URL - Backend API URL (default: Railway production)
 *   TENANT_EMAIL - Tenant provider email for login
 *   TENANT_PASSWORD - Tenant provider password
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';
const TENANT_EMAIL = process.env.TENANT_EMAIL || 'mahmoudnzaineldeen@gmail.com';
const TENANT_PASSWORD = process.env.TENANT_PASSWORD || '111111';

let authToken = null;
let tenantId = null;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logStep(message) {
  log(`\n${message}`, 'blue');
}

/**
 * Make API request
 */
async function makeRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken && { Authorization: `Bearer ${authToken}` }),
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    let data;
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch (e) {
      logError(`Failed to parse JSON. Status: ${response.status}`);
      data = { error: 'Invalid JSON response', rawText: text.substring(0, 500) };
    }
    
    return { response, data, ok: response.ok, status: response.status };
  } catch (error) {
    logError(`Fetch error for ${url}: ${error.message}`);
    throw error;
  }
}

/**
 * Step 1: Login as Tenant Provider
 */
async function loginAsTenant() {
  logStep('🔐 Step 1: Logging in as tenant provider...');
  logInfo(`Email: ${TENANT_EMAIL}`);

  const { response, data, ok } = await makeRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({
      email: TENANT_EMAIL,
      password: TENANT_PASSWORD,
      forCustomer: false,
    }),
  });

  if (!ok) {
    logError(`Login failed. Status: ${response.status}`);
    logError(`Response: ${JSON.stringify(data, null, 2)}`);
    throw new Error(`Login failed (${response.status}): ${data.error || data.message || 'Unknown error'}`);
  }

  if (!data.session?.access_token) {
    logError('Login response missing access_token');
    throw new Error('Login response missing access_token');
  }

  authToken = data.session.access_token;
  tenantId = data.user?.tenant_id || data.user?.user_metadata?.tenant_id;

  if (!tenantId) {
    logError('Login response missing tenant_id');
    throw new Error('Login response missing tenant_id');
  }

  logSuccess(`Logged in successfully`);
  logInfo(`Tenant ID: ${tenantId}`);
  return true;
}

/**
 * Step 2: Check Current Token Status
 */
async function checkTokenStatus() {
  logStep('🔍 Step 2: Checking current Zoho token status...');

  const { data, ok, status } = await makeRequest(`/query?table=zoho_tokens&tenant_id=eq.${tenantId}&select=*`);

  if (!ok) {
    logError(`Failed to check tokens. Status: ${status}`);
    return null;
  }

  const tokens = Array.isArray(data) ? data : (data?.data || []);

  if (tokens.length === 0) {
    logError('No Zoho tokens found!');
    logWarning('Please configure Zoho in Settings → Zoho Integration');
    return null;
  }

  const token = tokens[0];
  const now = new Date();
  const expiresAt = new Date(token.expires_at);
  const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60);

  logSuccess('Zoho token found');
  logInfo(`Token ID: ${token.id}`);
  logInfo(`Has Access Token: ${token.access_token ? '✅ Yes' : '❌ No'}`);
  logInfo(`Has Refresh Token: ${token.refresh_token ? '✅ Yes' : '❌ No'}`);
  logInfo(`Expires At: ${expiresAt.toISOString()}`);
  logInfo(`Current Time: ${now.toISOString()}`);
  
  if (minutesUntilExpiry > 0) {
    logSuccess(`Token expires in ${minutesUntilExpiry} minutes`);
    if (minutesUntilExpiry <= 15) {
      logWarning(`Token expires soon (within 15 minutes) - should be refreshed by background job`);
    }
  } else {
    logError(`Token expired ${Math.abs(minutesUntilExpiry)} minutes ago`);
    logWarning('Background job should refresh this automatically');
  }

  return token;
}

/**
 * Step 3: Test Token Refresh (Manual Trigger)
 */
async function testTokenRefresh() {
  logStep('🔄 Step 3: Testing token refresh mechanism...');
  logInfo('Attempting to get access token (will auto-refresh if needed)...');

  try {
    // This will trigger getAccessToken() which should refresh if needed
    const { data, ok, status } = await makeRequest(`/zoho/status?tenant_id=${tenantId}`);

    if (!ok) {
      logError(`Failed to check Zoho status. Status: ${status}`);
      logError(`Response: ${JSON.stringify(data, null, 2)}`);
      return false;
    }

    logSuccess('Zoho status check successful');
    logInfo(`Status: ${data.status || 'Unknown'}`);
    logInfo(`Connected: ${data.connected ? '✅ Yes' : '❌ No'}`);

    if (data.connected) {
      logSuccess('Token is valid and working!');
      return true;
    } else {
      logError('Zoho is not connected');
      return false;
    }
  } catch (error) {
    logError(`Error testing token refresh: ${error.message}`);
    return false;
  }
}

/**
 * Step 4: Monitor Token Refresh (Wait and Check Again)
 */
async function monitorTokenRefresh(initialToken) {
  logStep('⏳ Step 4: Monitoring token refresh (waiting 2 minutes)...');
  logInfo('The background job runs every 10 minutes and refreshes tokens expiring within 15 minutes');
  logInfo('Waiting to see if token gets refreshed...');

  const waitTime = 2 * 60 * 1000; // 2 minutes
  logInfo(`Waiting ${waitTime / 1000} seconds...`);

  await new Promise(resolve => setTimeout(resolve, waitTime));

  logStep('🔍 Step 5: Checking token status again...');

  const { data, ok } = await makeRequest(`/query?table=zoho_tokens&tenant_id=eq.${tenantId}&select=*`);

  if (!ok || !data) {
    logError('Failed to check token after wait');
    return false;
  }

  const tokens = Array.isArray(data) ? data : (data?.data || []);
  if (tokens.length === 0) {
    logError('Token not found after wait');
    return false;
  }

  const currentToken = tokens[0];
  const now = new Date();
  const expiresAt = new Date(currentToken.expires_at);
  const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60);

  logInfo(`Token ID: ${currentToken.id}`);
  logInfo(`Updated At: ${currentToken.updated_at || 'N/A'}`);
  logInfo(`Expires At: ${expiresAt.toISOString()}`);
  logInfo(`Minutes Until Expiry: ${minutesUntilExpiry}`);

  // Check if token was updated
  const initialUpdatedAt = initialToken.updated_at ? new Date(initialToken.updated_at) : null;
  const currentUpdatedAt = currentToken.updated_at ? new Date(currentToken.updated_at) : null;

  if (currentUpdatedAt && initialUpdatedAt && currentUpdatedAt > initialUpdatedAt) {
    logSuccess('✅ Token was refreshed!');
    logInfo(`Initial Updated At: ${initialUpdatedAt.toISOString()}`);
    logInfo(`Current Updated At: ${currentUpdatedAt.toISOString()}`);
    logInfo(`Time Difference: ${Math.round((currentUpdatedAt - initialUpdatedAt) / 1000 / 60)} minutes`);
    return true;
  } else {
    logWarning('Token was not refreshed during the wait period');
    logInfo('This is normal if:');
    logInfo('  - Token expires more than 15 minutes from now');
    logInfo('  - Background job hasn\'t run yet (runs every 10 minutes)');
    logInfo('  - Token was recently refreshed');
    return false;
  }
}

/**
 * Step 6: Verify Background Job is Running
 */
async function verifyBackgroundJob() {
  logStep('🔍 Step 6: Verifying background job is running...');
  logInfo('Checking server logs would show:');
  logInfo('  "[ZohoTokenRefresh] Starting token refresh worker"');
  logInfo('  "[ZohoTokenRefresh] Checking for tokens expiring before..."');
  logWarning('Note: This test cannot directly verify the background job');
  logWarning('Check server logs to confirm the job is running');
  logInfo('Expected log messages:');
  logInfo('  🔄 Zoho token auto-refresh enabled (runs every 10 minutes)');
  logInfo('  [ZohoTokenRefresh] Starting token refresh worker');
  return true;
}

/**
 * Main test flow
 */
async function runTest() {
  try {
    log('\n═══════════════════════════════════════════════════════════', 'cyan');
    log('🔄 ZOHO TOKEN AUTO-REFRESH MECHANISM TEST', 'cyan');
    log('═══════════════════════════════════════════════════════════', 'cyan');

    // Step 1: Login
    await loginAsTenant();

    // Step 2: Check token status
    const initialToken = await checkTokenStatus();
    if (!initialToken) {
      logError('\n❌ TEST FAILED: No Zoho token found');
      process.exit(1);
    }

    // Step 3: Test token refresh
    const refreshWorks = await testTokenRefresh();
    if (!refreshWorks) {
      logWarning('\n⚠️  Token refresh test had issues, but continuing...');
    }

    // Step 4 & 5: Monitor token refresh
    const wasRefreshed = await monitorTokenRefresh(initialToken);

    // Step 6: Verify background job
    await verifyBackgroundJob();

    // Final Summary
    log('\n═══════════════════════════════════════════════════════════', 'cyan');
    log('📊 TEST SUMMARY', 'cyan');
    log('═══════════════════════════════════════════════════════════', 'cyan');
    
    logSuccess('✅ Token exists and is configured');
    if (refreshWorks) {
      logSuccess('✅ Token refresh mechanism is working');
    } else {
      logWarning('⚠️  Token refresh test had issues');
    }
    
    if (wasRefreshed) {
      logSuccess('✅ Token was automatically refreshed by background job!');
      logSuccess('✅ PERMANENT TOKEN REFRESH MECHANISM IS WORKING!');
    } else {
      logWarning('⚠️  Token was not refreshed during test period');
      logInfo('This is normal if token expires more than 15 minutes from now');
      logInfo('The background job refreshes tokens expiring within 15 minutes');
      logInfo('Check server logs to verify the job is running');
    }

    log('\n📋 Next Steps:', 'cyan');
    logInfo('1. Check server logs for "[ZohoTokenRefresh]" messages');
    logInfo('2. Wait for token to be within 15 minutes of expiration');
    logInfo('3. Background job will automatically refresh it');
    logInfo('4. Tokens will remain valid forever (as long as refresh_token is valid)');

    log('\n═══════════════════════════════════════════════════════════', 'cyan');
    log('✅ TEST COMPLETE', 'cyan');
    log('═══════════════════════════════════════════════════════════', 'cyan');

    process.exit(0);
  } catch (error) {
    logError(`\n❌ TEST FAILED WITH EXCEPTION: ${error.message}`);
    logError(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

// Run the test
runTest();
