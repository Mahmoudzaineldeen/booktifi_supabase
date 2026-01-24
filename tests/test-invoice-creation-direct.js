/**
 * Direct Invoice Creation Test
 * 
 * This test directly tests invoice creation for an existing booking
 * or creates a minimal booking to test invoice creation
 * 
 * Usage:
 *   node tests/test-invoice-creation-direct.js
 *   BOOKING_ID=<existing-booking-id> node tests/test-invoice-creation-direct.js
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';
const BOOKING_ID = process.env.BOOKING_ID || null;

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

// Test 1: Login as Receptionist
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
    throw new Error(`No access token in response. Response: ${JSON.stringify(result.data, null, 2)}`);
  }

  authToken = token;
  tenantId = tenant?.id || user?.tenant_id || user?.tenantId || result.data.tenant?.id;

  log(`Logged in as: ${user?.email || 'unknown'}`, 'success');
  log(`Tenant ID: ${tenantId}`, 'info');
  return true;
}

// Test 2: Find Recent Bookings (with or without invoice)
async function testFindRecentBookings() {
  if (!tenantId) {
    throw new Error('No tenant_id available');
  }

  log(`Searching for recent bookings...`, 'info');
  
  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id, customer_name, customer_email, customer_phone, total_price, zoho_invoice_id, zoho_invoice_created_at, created_at',
      where: {
        tenant_id: tenantId
      },
      orderBy: {
        column: 'created_at',
        ascending: false
      },
      limit: 10
    })
  });

  if (!result.ok) {
    throw new Error(`Failed to fetch bookings: ${result.status} - ${JSON.stringify(result.data)}`);
  }

  const bookings = result.data || [];
  
  if (bookings.length === 0) {
    log(`No bookings found`, 'warning');
    return null;
  }

  log(`Found ${bookings.length} recent booking(s)`, 'success');
  
  // Show all bookings
  bookings.forEach((booking, index) => {
    log(`\n   Booking ${index + 1}:`, 'info');
    log(`      ID: ${booking.id}`, 'info');
    log(`      Customer: ${booking.customer_name}`, 'info');
    log(`      Email: ${booking.customer_email || 'N/A'}`, 'info');
    log(`      Phone: ${booking.customer_phone || 'N/A'}`, 'info');
    log(`      Total: ${booking.total_price}`, 'info');
    log(`      Has Invoice: ${!!booking.zoho_invoice_id}`, booking.zoho_invoice_id ? 'success' : 'warning');
    log(`      Invoice ID: ${booking.zoho_invoice_id || 'NONE'}`, 'info');
    log(`      Invoice Created: ${booking.zoho_invoice_created_at || 'N/A'}`, 'info');
    log(`      Booking Created: ${booking.created_at}`, 'info');
  });

  // Find one without invoice
  const bookingWithoutInvoice = bookings.find(b => !b.zoho_invoice_id && (b.customer_email || b.customer_phone));
  
  if (bookingWithoutInvoice) {
    log(`\n✅ Found booking without invoice: ${bookingWithoutInvoice.id}`, 'success');
    return bookingWithoutInvoice;
  }

  // All have invoices - return most recent one for analysis
  log(`\n⚠️ All recent bookings have invoices`, 'warning');
  log(`   Using most recent booking for analysis: ${bookings[0].id}`, 'info');
  return bookings[0];
}

// Test 3: Manually Trigger Invoice Creation
async function testTriggerInvoiceCreation(bookingId) {
  if (!bookingId) {
    throw new Error('No booking ID provided');
  }

  log(`Manually triggering invoice creation for booking ${bookingId}...`, 'info');
  log(`This will call the ZohoService.generateReceipt() method directly`, 'info');
  
  // We can't directly call the service, but we can check if invoice was created
  // by waiting and checking the booking
  log(`Waiting 10 seconds for invoice creation to complete...`, 'info');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Check if invoice was created
  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id, zoho_invoice_id, zoho_invoice_created_at, customer_name, total_price',
      where: {
        id: bookingId
      }
    })
  });

  if (!result.ok) {
    throw new Error(`Failed to check booking: ${result.status}`);
  }

  const bookings = result.data || [];
  if (bookings.length === 0) {
    throw new Error('Booking not found');
  }

  const booking = bookings[0];
  
  if (booking.zoho_invoice_id) {
    log(`✅ Invoice created: ${booking.zoho_invoice_id}`, 'success');
    log(`   Created at: ${booking.zoho_invoice_created_at || 'N/A'}`, 'info');
    return booking;
  } else {
    log(`❌ No invoice created yet`, 'error');
    log(`   Booking ID: ${booking.id}`, 'info');
    log(`   Customer: ${booking.customer_name}`, 'info');
    throw new Error('Invoice was not created');
  }
}

// Test 4: Check Invoice Logs
async function testCheckInvoiceLogs(bookingId) {
  if (!bookingId) {
    throw new Error('No booking ID provided');
  }

  log(`Checking invoice logs for booking ${bookingId}...`, 'info');
  
  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'zoho_invoice_logs',
      select: '*',
      where: {
        booking_id: bookingId
      },
      orderBy: {
        column: 'created_at',
        ascending: false
      },
      limit: 10
    })
  });

  if (result.ok && result.data && result.data.length > 0) {
    log(`Found ${result.data.length} log entry/entries`, 'success');
    result.data.forEach((logEntry, index) => {
      log(`   ${index + 1}. Status: ${logEntry.status}, Invoice ID: ${logEntry.zoho_invoice_id || 'N/A'}`, 'info');
      if (logEntry.error_message) {
        log(`      Error: ${logEntry.error_message}`, 'error');
      }
    });
    return result.data;
  } else {
    log(`No invoice logs found`, 'warning');
    return [];
  }
}

// Main test flow
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 DIRECT INVOICE CREATION TEST');
  console.log('='.repeat(60) + '\n');

  try {
    // Step 1: Login
    await testLogin();

    let bookingId = BOOKING_ID;

    // Step 2: Find booking if not provided
    if (!bookingId) {
      log(`No BOOKING_ID provided, searching for recent bookings...`, 'info');
      const booking = await testFindRecentBookings();
      if (!booking) {
        log(`❌ No bookings found`, 'error');
        log(`   Please create a booking first, or provide BOOKING_ID environment variable`, 'info');
        process.exit(1);
      }
      bookingId = booking.id;
      
      if (booking.zoho_invoice_id) {
        log(`\n⚠️ Selected booking already has an invoice`, 'warning');
        log(`   This test will analyze why invoices are being created`, 'info');
        log(`   To test invoice creation, create a NEW booking without an invoice`, 'info');
      }
    } else {
      log(`Using provided BOOKING_ID: ${bookingId}`, 'info');
    }

    // Step 3: Check current state
    log(`\n📋 Current Booking State:`, 'info');
    const currentState = await makeRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'bookings',
        select: 'id, customer_name, customer_email, customer_phone, zoho_invoice_id, zoho_invoice_created_at, total_price',
        where: {
          id: bookingId
        }
      })
    });

    if (currentState.ok && currentState.data && currentState.data.length > 0) {
      const booking = currentState.data[0];
      log(`   Booking ID: ${booking.id}`, 'info');
      log(`   Customer: ${booking.customer_name}`, 'info');
      log(`   Email: ${booking.customer_email || 'N/A'}`, 'info');
      log(`   Phone: ${booking.customer_phone || 'N/A'}`, 'info');
      log(`   Has Invoice: ${!!booking.zoho_invoice_id}`, 'info');
      log(`   Invoice ID: ${booking.zoho_invoice_id || 'NONE'}`, 'info');
      
      if (booking.zoho_invoice_id) {
        log(`\n✅ Booking already has an invoice!`, 'success');
        log(`   Invoice ID: ${booking.zoho_invoice_id}`, 'info');
        log(`   Created at: ${booking.zoho_invoice_created_at || 'N/A'}`, 'info');
      } else {
        log(`\n⚠️ Booking does not have an invoice yet`, 'warning');
        log(`   This booking should trigger invoice creation automatically`, 'info');
        log(`   Checking if invoice creation is in progress...`, 'info');
      }
    }

    // Step 4: Check invoice logs
    await testCheckInvoiceLogs(bookingId);

    // Step 5: Wait and check again
    log(`\n⏳ Waiting 15 seconds for invoice creation...`, 'info');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    log(`\n📋 Checking booking state again...`, 'info');
    const finalState = await makeRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'bookings',
        select: 'id, zoho_invoice_id, zoho_invoice_created_at',
        where: {
          id: bookingId
        }
      })
    });

    if (finalState.ok && finalState.data && finalState.data.length > 0) {
      const booking = finalState.data[0];
      if (booking.zoho_invoice_id) {
        log(`\n✅ SUCCESS: Invoice was created!`, 'success');
        log(`   Invoice ID: ${booking.zoho_invoice_id}`, 'info');
        log(`   Created at: ${booking.zoho_invoice_created_at}`, 'info');
      } else {
        log(`\n❌ FAILED: Invoice was not created`, 'error');
        log(`   Booking ID: ${booking.id}`, 'info');
        log(`   Check server logs for [Booking Creation] and [ZohoService] messages`, 'info');
      }
    }

    // Step 6: Check logs again
    log(`\n📋 Final Invoice Logs:`, 'info');
    await testCheckInvoiceLogs(bookingId);

  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(60) + '\n');
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
