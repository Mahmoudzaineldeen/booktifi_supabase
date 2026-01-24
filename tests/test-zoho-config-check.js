/**
 * Zoho Configuration Check Test
 * 
 * Checks Zoho configuration for a tenant to identify why invoices aren't being created
 * 
 * Usage:
 *   node tests/test-zoho-config-check.js
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';

let authToken = null;
let tenantId = null;

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️'
  }[type] || 'ℹ️';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

async function makeRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
    ...(options.headers || {})
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    const data = await response.json().catch(() => ({}));
    
    return {
      ok: response.ok,
      status: response.status,
      data,
      headers: response.headers
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { error: error.message },
      error
    };
  }
}

// Test 1: Login
async function testLogin() {
  const result = await makeRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({
      email: 'receptionist1@bookati.local',
      password: '111111'
    })
  });

  if (!result.ok) {
    throw new Error(`Login failed: ${result.status} - ${JSON.stringify(result.data)}`);
  }

  let token = result.data.access_token || result.data.token || result.data.accessToken;
  let user = result.data.user || result.data;
  let tenant = result.data.tenant || result.data.user?.tenant;

  if (!token) {
    if (result.data.session?.access_token) {
      token = result.data.session.access_token;
      user = result.data.session.user || user;
      tenant = result.data.session.tenant || tenant;
    } else if (result.data.data?.access_token) {
      token = result.data.data.access_token;
      user = result.data.data.user || user;
      tenant = result.data.data.tenant || tenant;
    }
  }

  if (!token) {
    throw new Error(`No access token in response`);
  }

  authToken = token;
  tenantId = tenant?.id || user?.tenant_id || user?.tenantId || result.data.tenant?.id;

  log(`Logged in as: ${user?.email || 'unknown'}`, 'success');
  log(`Tenant ID: ${tenantId}`, 'info');
  return true;
}

// Test 2: Check Zoho Configuration
async function testCheckZohoConfig() {
  if (!tenantId) {
    throw new Error('No tenant_id available');
  }

  log(`\n🔍 Checking Zoho Configuration for tenant ${tenantId}...`, 'info');
  
  // Check tenant_zoho_configs
  log(`\n1. Checking tenant_zoho_configs...`, 'info');
  const configResult = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'tenant_zoho_configs',
      select: '*',
      where: {
        tenant_id: tenantId
      }
    })
  });

  if (configResult.ok && configResult.data && configResult.data.length > 0) {
    const config = configResult.data[0];
    log(`   ✅ Config found:`, 'success');
    log(`      ID: ${config.id}`, 'info');
    log(`      Is Active: ${config.is_active}`, config.is_active ? 'success' : 'error');
    log(`      Has Client ID: ${!!config.client_id}`, config.client_id ? 'success' : 'error');
    log(`      Has Client Secret: ${!!config.client_secret}`, config.client_secret ? 'success' : 'info');
    log(`      Redirect URI: ${config.redirect_uri || 'N/A'}`, 'info');
    log(`      Region: ${config.region || 'N/A'}`, 'info');
    
    if (!config.is_active) {
      log(`   ❌ PROBLEM: Config is not active!`, 'error');
    }
    if (!config.client_id) {
      log(`   ❌ PROBLEM: Missing client_id!`, 'error');
    }
    if (!config.redirect_uri) {
      log(`   ❌ PROBLEM: Missing redirect_uri!`, 'error');
    }
  } else {
    log(`   ❌ PROBLEM: No Zoho config found!`, 'error');
    log(`      This is why invoices are not being created.`, 'error');
    log(`      Solution: Go to Settings → Zoho Integration and add credentials.`, 'info');
  }

  // Check zoho_tokens
  log(`\n2. Checking zoho_tokens...`, 'info');
  const tokenResult = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'zoho_tokens',
      select: '*',
      where: {
        tenant_id: tenantId
      }
    })
  });

  if (tokenResult.ok && tokenResult.data && tokenResult.data.length > 0) {
    const token = tokenResult.data[0];
    log(`   ✅ Token found:`, 'success');
    log(`      ID: ${token.id}`, 'info');
    log(`      Has Access Token: ${!!token.access_token}`, token.access_token ? 'success' : 'error');
    log(`      Has Refresh Token: ${!!token.refresh_token}`, token.refresh_token ? 'success' : 'error');
    
    if (token.expires_at) {
      const expiresAt = new Date(token.expires_at);
      const now = new Date();
      const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60);
      
      log(`      Expires At: ${expiresAt.toISOString()}`, 'info');
      log(`      Current Time: ${now.toISOString()}`, 'info');
      log(`      Minutes Until Expiry: ${minutesUntilExpiry}`, minutesUntilExpiry > 5 ? 'success' : 'error');
      
      if (expiresAt <= now) {
        log(`   ❌ PROBLEM: Token is expired!`, 'error');
        log(`      Solution: Go to Settings → Zoho Integration and reconnect.`, 'info');
      } else if (minutesUntilExpiry <= 5) {
        log(`   ⚠️ WARNING: Token expires soon (${minutesUntilExpiry} minutes)`, 'warning');
      } else {
        log(`   ✅ Token is valid`, 'success');
      }
    } else {
      log(`   ⚠️ WARNING: Token has no expiration date`, 'warning');
    }
  } else {
    log(`   ❌ PROBLEM: No Zoho token found!`, 'error');
    log(`      This is why invoices are not being created.`, 'error');
    log(`      Solution: Go to Settings → Zoho Integration and complete OAuth flow.`, 'info');
  }

  // Summary
  log(`\n📊 SUMMARY:`, 'info');
  const hasConfig = configResult.ok && configResult.data && configResult.data.length > 0;
  const hasToken = tokenResult.ok && tokenResult.data && tokenResult.data.length > 0;
  const configActive = hasConfig && configResult.data[0].is_active;
  const tokenValid = hasToken && (!tokenResult.data[0].expires_at || new Date(tokenResult.data[0].expires_at) > new Date());
  
  if (hasConfig && configActive && hasToken && tokenValid) {
    log(`   ✅ Zoho is properly configured!`, 'success');
    log(`   ⚠️ If invoices still aren't being created, check server logs for errors.`, 'warning');
  } else {
    log(`   ❌ Zoho is NOT properly configured:`, 'error');
    log(`      Config exists: ${hasConfig}`, 'info');
    log(`      Config active: ${configActive}`, 'info');
    log(`      Token exists: ${hasToken}`, 'info');
    log(`      Token valid: ${tokenValid}`, 'info');
    log(`   Solution: Configure Zoho in Settings → Zoho Integration`, 'info');
  }
}

// Main
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 ZOHO CONFIGURATION CHECK');
  console.log('='.repeat(60) + '\n');

  try {
    await testLogin();
    await testCheckZohoConfig();
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ CHECK COMPLETE');
  console.log('='.repeat(60) + '\n');
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
