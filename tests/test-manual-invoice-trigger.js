/**
 * Manual Invoice Trigger Test
 * 
 * Manually triggers invoice creation for an existing booking
 * to test if the invoice creation flow works
 * 
 * Usage:
 *   node tests/test-manual-invoice-trigger.js
 *   BOOKING_ID=<booking-id> node tests/test-manual-invoice-trigger.js
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';
const BOOKING_ID = process.env.BOOKING_ID || 'd4eb0407-94a8-46e1-8aa1-c7a94414979d'; // Most recent booking without invoice

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

// Test 2: Check Booking
async function testCheckBooking(bookingId) {
  log(`Checking booking ${bookingId}...`, 'info');
  
  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id, customer_name, customer_email, customer_phone, total_price, zoho_invoice_id, zoho_invoice_created_at, tenant_id',
      where: {
        id: bookingId
      }
    })
  });

  if (!result.ok || !result.data || result.data.length === 0) {
    throw new Error(`Booking not found: ${result.status}`);
  }

  const booking = result.data[0];
  
  log(`Booking found:`, 'success');
  log(`   Customer: ${booking.customer_name}`, 'info');
  log(`   Email: ${booking.customer_email || 'N/A'}`, 'info');
  log(`   Phone: ${booking.customer_phone || 'N/A'}`, 'info');
  log(`   Total: ${booking.total_price}`, 'info');
  log(`   Has Invoice: ${!!booking.zoho_invoice_id}`, booking.zoho_invoice_id ? 'success' : 'warning');
  log(`   Invoice ID: ${booking.zoho_invoice_id || 'NONE'}`, 'info');
  
  if (!booking.customer_email && !booking.customer_phone) {
    throw new Error('Booking has no email or phone - invoice cannot be created');
  }
  
  return booking;
}

// Test 3: Manually Trigger Invoice via Test Endpoint
async function testTriggerInvoice(bookingId) {
  log(`\n🔍 Manually triggering invoice creation via test endpoint...`, 'info');
  log(`   Using: POST /api/zoho/test-invoice`, 'info');
  
  const triggerResult = await makeRequest('/zoho/test-invoice', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      booking_id: bookingId
    })
  });
  
  if (triggerResult.ok) {
    log(`✅ Invoice creation triggered successfully!`, 'success');
    log(`   Response: ${JSON.stringify(triggerResult.data, null, 2)}`, 'info');
    
    if (triggerResult.data.success) {
      log(`   Invoice ID: ${triggerResult.data.invoice_id}`, 'success');
      return triggerResult.data;
    } else {
      log(`   ⚠️ Invoice creation returned success=false`, 'warning');
      log(`   Error: ${triggerResult.data.error || 'Unknown'}`, 'error');
      throw new Error(triggerResult.data.error || 'Invoice creation failed');
    }
  } else {
    log(`❌ Failed to trigger invoice creation`, 'error');
    log(`   Status: ${triggerResult.status}`, 'error');
    log(`   Response: ${JSON.stringify(triggerResult.data, null, 2)}`, 'error');
    throw new Error(`Trigger failed: ${triggerResult.status} - ${JSON.stringify(triggerResult.data)}`);
  }
}

// Test 4: Monitor Invoice Creation
async function testMonitorInvoice(bookingId, maxWaitSeconds = 30) {
  log(`\n⏳ Monitoring invoice creation (max ${maxWaitSeconds}s)...`, 'info');
  
  const startTime = Date.now();
  const maxWait = maxWaitSeconds * 1000;
  const checkInterval = 3000; // Check every 3 seconds
  
  while (Date.now() - startTime < maxWait) {
    const result = await makeRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'bookings',
        select: 'id, zoho_invoice_id, zoho_invoice_created_at',
        where: {
          id: bookingId
        }
      })
    });
    
    if (result.ok && result.data && result.data.length > 0) {
      const booking = result.data[0];
      
      if (booking.zoho_invoice_id) {
        log(`\n✅ SUCCESS: Invoice created!`, 'success');
        log(`   Invoice ID: ${booking.zoho_invoice_id}`, 'info');
        log(`   Created At: ${booking.zoho_invoice_created_at}`, 'info');
        log(`   Time taken: ${Math.round((Date.now() - startTime) / 1000)}s`, 'info');
        return booking;
      }
    }
    
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log(`   Still waiting... (${elapsed}s / ${maxWaitSeconds}s)`, 'info');
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  throw new Error(`Invoice not created within ${maxWaitSeconds} seconds`);
}

// Main
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 MANUAL INVOICE TRIGGER TEST');
  console.log('='.repeat(60) + '\n');
  console.log(`Using Booking ID: ${BOOKING_ID}\n`);

  try {
    await testLogin();
    const booking = await testCheckBooking(BOOKING_ID);
    
    if (booking.zoho_invoice_id) {
      log(`\n✅ Booking already has an invoice!`, 'success');
      log(`   Invoice ID: ${booking.zoho_invoice_id}`, 'info');
      process.exit(0);
    }
    
    log(`\n⚠️ Booking does not have an invoice`, 'warning');
    log(`   This booking was created but invoice was not generated`, 'warning');
    log(`   This indicates the invoice creation promise did not execute or failed`, 'warning');
    
    // Try manual trigger
    await testTriggerInvoice(BOOKING_ID);
    
    // Monitor for invoice creation
    try {
      await testMonitorInvoice(BOOKING_ID, 30);
    } catch (error) {
      log(`\n❌ Invoice was not created`, 'error');
      log(`   Error: ${error.message}`, 'error');
      log(`\n📋 DIAGNOSIS:`, 'info');
      log(`   1. Check Railway logs for [Booking Creation] messages`, 'info');
      log(`   2. Check Railway logs for [ZohoService] messages`, 'info');
      log(`   3. Verify the booking has email or phone (it does: ${booking.customer_email || booking.customer_phone})`, 'info');
      log(`   4. Check if the invoice creation promise is executing`, 'info');
      log(`   5. Check for any errors in the promise chain`, 'info');
    }
    
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(60) + '\n');
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
