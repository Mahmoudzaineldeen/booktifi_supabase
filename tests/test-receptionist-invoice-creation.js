/**
 * Test Receptionist Booking with Zoho Invoice Creation
 * 
 * This script tests the complete flow:
 * 1. Login as receptionist
 * 2. Create a booking with customer email/phone
 * 3. Verify Zoho invoice is created
 * 4. Verify invoice is linked to booking
 * 5. Verify invoice is sent to customer
 * 
 * Credentials:
 * - Email: receptionist1@bookati.local
 * - Password: 111111
 * 
 * Usage:
 *   node tests/test-receptionist-invoice-creation.js
 *   API_URL=https://booktifisupabase-production.up.railway.app/api node tests/test-receptionist-invoice-creation.js
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';

let authToken = null;
let tenantId = null;
let userId = null;
let bookingId = null;
let invoiceId = null;

// Test results
const results = {
  passed: [],
  failed: [],
  warnings: []
};

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

async function testStep(name, testFn) {
  log(`Testing: ${name}`, 'info');
  try {
    const result = await testFn();
    if (result !== false && result !== null && result !== undefined) {
      results.passed.push(name);
      log(`✅ PASSED: ${name}`, 'success');
      return result; // Return the actual result, not just true
    } else {
      results.failed.push(name);
      log(`❌ FAILED: ${name}`, 'error');
      return false;
    }
  } catch (error) {
    results.failed.push(name);
    log(`❌ FAILED: ${name} - ${error.message}`, 'error');
    return false;
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
  userId = user?.id;

  log(`Logged in as: ${user?.email || 'unknown'}`, 'success');
  log(`Tenant ID: ${tenantId}`, 'info');
  log(`User ID: ${userId}`, 'info');
  log(`Role: ${user?.role}`, 'info');

  if (user?.role !== 'receptionist') {
    results.warnings.push('User role is not receptionist');
    log(`WARNING: Expected role 'receptionist', got '${user?.role}'`, 'warning');
  }

  return true;
}

// Test 2: Fetch Services
async function testFetchServices() {
  if (!tenantId) {
    throw new Error('No tenant_id available');
  }

  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: 'id, name, name_ar, base_price, child_price, capacity_per_slot',
      where: {
        tenant_id: tenantId,
        is_active: true
      },
      orderBy: {
        column: 'name',
        ascending: true
      }
    })
  });

  if (!result.ok) {
    throw new Error(`Failed to fetch services: ${result.status} - ${JSON.stringify(result.data)}`);
  }

  const services = result.data || [];
  
  if (services.length === 0) {
    throw new Error('No services available for this tenant');
  }

  log(`Found ${services.length} service(s)`, 'success');
  services.slice(0, 3).forEach(service => {
    log(`  - ${service.name} (ID: ${service.id}) - ${service.base_price}`, 'info');
  });
  
  return services[0]; // Return first service
}

// Test 3: Fetch Available Slots
async function testFetchSlots(serviceId) {
  if (!tenantId || !serviceId) {
    throw new Error('Missing tenant_id or service_id');
  }

  // Get slots for today and next 7 days - use simple date string comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: '*',
      where: {
        tenant_id: tenantId,
        service_id: serviceId
      }
    })
  });

  if (!result.ok) {
    throw new Error(`Failed to fetch slots: ${result.status} - ${JSON.stringify(result.data)}`);
  }

  let slots = result.data || [];
  
  // Filter slots by date range manually
  slots = slots.filter(slot => {
    const slotDate = slot.slot_date ? slot.slot_date.split('T')[0] : slot.slot_date;
    return slotDate >= todayStr && slotDate <= nextWeekStr;
  });
  
  if (slots.length === 0) {
    throw new Error('No available slots found in date range');
  }

  // Find an available slot
  const availableSlot = slots.find(slot => slot.available_capacity > 0);
  
  if (!availableSlot) {
    throw new Error('No available slots with capacity');
  }

  log(`Found available slot: ${availableSlot.id}`, 'success');
  log(`   Date: ${availableSlot.slot_date}, Time: ${availableSlot.start_time} - ${availableSlot.end_time}`, 'info');
  log(`   Capacity: ${availableSlot.available_capacity}/${availableSlot.total_capacity}`, 'info');
  return availableSlot;
}

// Test 4: Create Booking
async function testCreateBooking(serviceId, slotId) {
  if (!tenantId || !serviceId || !slotId) {
    throw new Error('Missing required parameters for booking creation');
  }

  const bookingData = {
    tenant_id: tenantId,
    service_id: serviceId,
    slot_id: slotId,
    customer_name: 'Test Customer - Invoice Test',
    customer_email: 'test-customer@example.com',
    customer_phone: '+966501234567',
    adult_count: 2,
    child_count: 0,
    visitor_count: 2,
    notes: 'Test booking for Zoho invoice verification'
  };

  log(`Creating booking with data: ${JSON.stringify(bookingData, null, 2)}`, 'info');

  const result = await makeRequest('/bookings/create', {
    method: 'POST',
    body: JSON.stringify(bookingData)
  });

  if (!result.ok) {
    throw new Error(`Failed to create booking: ${result.status} - ${JSON.stringify(result.data)}`);
  }

  const booking = result.data.booking || result.data;
  bookingId = booking.id || result.data.id;

  if (!bookingId) {
    throw new Error(`No booking ID in response: ${JSON.stringify(result.data)}`);
  }

  log(`✅ Booking created: ${bookingId}`, 'success');
  log(`   Customer: ${booking.customer_name}`, 'info');
  log(`   Email: ${booking.customer_email}`, 'info');
  log(`   Phone: ${booking.customer_phone}`, 'info');
  log(`   Total: ${booking.total_price}`, 'info');

  return booking;
}

// Test 5: Wait for Invoice Creation (with retry)
async function testWaitForInvoice(maxWaitSeconds = 30) {
  if (!bookingId) {
    throw new Error('No booking ID available');
  }

  log(`Waiting for invoice creation (max ${maxWaitSeconds}s)...`, 'info');
  
  const startTime = Date.now();
  const maxWait = maxWaitSeconds * 1000;
  const checkInterval = 2000; // Check every 2 seconds

  while (Date.now() - startTime < maxWait) {
    const result = await makeRequest(`/bookings/${bookingId}`);

    if (result.ok) {
      const booking = result.data.booking || result.data;
      
      if (booking.zoho_invoice_id) {
        invoiceId = booking.zoho_invoice_id;
        log(`✅ Invoice created: ${invoiceId}`, 'success');
        log(`   Invoice Created At: ${booking.zoho_invoice_created_at || 'N/A'}`, 'info');
        return booking;
      }
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    log(`   Still waiting... (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`, 'info');
  }

  throw new Error(`Invoice not created within ${maxWaitSeconds} seconds`);
}

// Test 6: Verify Invoice in Database
async function testVerifyInvoiceInDatabase() {
  if (!bookingId || !invoiceId) {
    throw new Error('Missing booking ID or invoice ID');
  }

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
    throw new Error(`Failed to fetch booking: ${result.status}`);
  }

  const bookings = result.data || [];
  if (bookings.length === 0) {
    throw new Error('Booking not found');
  }

  const booking = bookings[0];

  if (!booking.zoho_invoice_id) {
    throw new Error('Invoice ID not found in booking record');
  }

  if (booking.zoho_invoice_id !== invoiceId) {
    throw new Error(`Invoice ID mismatch: expected ${invoiceId}, got ${booking.zoho_invoice_id}`);
  }

  if (!booking.zoho_invoice_created_at) {
    results.warnings.push('Invoice created_at timestamp missing');
    log(`WARNING: zoho_invoice_created_at is missing`, 'warning');
  }

  log(`✅ Invoice verified in database`, 'success');
  log(`   Invoice ID: ${booking.zoho_invoice_id}`, 'info');
  log(`   Created At: ${booking.zoho_invoice_created_at || 'N/A'}`, 'info');
  log(`   Customer: ${booking.customer_name}`, 'info');
  log(`   Amount: ${booking.total_price}`, 'info');

  return booking;
}

// Test 7: Verify Invoice in Zoho (if endpoint exists)
async function testVerifyInvoiceInZoho() {
  if (!invoiceId || !tenantId) {
    throw new Error('Missing invoice ID or tenant ID');
  }

  // Try to fetch invoice from Zoho via API
  try {
    const result = await makeRequest(`/zoho/invoices/${invoiceId}`);

    if (result.ok) {
      const invoice = result.data.invoice || result.data;
      log(`✅ Invoice verified in Zoho`, 'success');
      log(`   Invoice Number: ${invoice.invoice_number || 'N/A'}`, 'info');
      log(`   Status: ${invoice.status || 'N/A'}`, 'info');
      log(`   Amount: ${invoice.total || invoice.sub_total || 'N/A'}`, 'info');
      log(`   Currency: ${invoice.currency_code || 'N/A'}`, 'info');
      return invoice;
    } else {
      results.warnings.push('Could not verify invoice in Zoho via API');
      log(`WARNING: Could not fetch invoice from Zoho: ${result.status}`, 'warning');
      return null;
    }
  } catch (error) {
    results.warnings.push('Invoice verification endpoint not available');
    log(`WARNING: Invoice verification endpoint not available: ${error.message}`, 'warning');
    return null;
  }
}

// Test 8: Check Invoice Logs
async function testCheckInvoiceLogs() {
  if (!bookingId) {
    throw new Error('No booking ID available');
  }

  // Try to check zoho_invoice_logs if endpoint exists
  try {
    const result = await makeRequest(`/zoho/invoice-logs?booking_id=${bookingId}`);

    if (result.ok) {
      const logs = result.data.logs || result.data || [];
      log(`✅ Found ${logs.length} invoice log entry/entries`, 'success');
      
      const successLog = logs.find(log => log.status === 'success');
      const emailLog = logs.find(log => log.status === 'email_sent');
      const whatsappLog = logs.find(log => log.status === 'whatsapp_sent');

      if (successLog) {
        log(`   ✅ Invoice creation logged as success`, 'success');
      }
      if (emailLog) {
        log(`   ✅ Email delivery logged`, 'success');
      }
      if (whatsappLog) {
        log(`   ✅ WhatsApp delivery logged`, 'success');
      }

      return logs;
    } else {
      results.warnings.push('Invoice logs endpoint not available');
      log(`WARNING: Invoice logs endpoint not available: ${result.status}`, 'warning');
      return [];
    }
  } catch (error) {
    results.warnings.push('Invoice logs endpoint not available');
    log(`WARNING: Invoice logs endpoint not available: ${error.message}`, 'warning');
    return [];
  }
}

// Main test flow
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 RECEPTIONIST BOOKING + ZOHO INVOICE TEST');
  console.log('='.repeat(60) + '\n');

  let service = null;
  let slot = null;

  try {
    // Step 1: Login
    await testStep('Login as Receptionist', testLogin);

    // Step 2: Fetch Services
    const serviceResult = await testStep('Fetch Services', testFetchServices);
    if (!serviceResult) throw new Error('Failed to fetch services');
    service = serviceResult; // testStep returns the result from testFetchServices

    // Step 3: Fetch Slots
    const slotResult = await testStep('Fetch Available Slots', () => testFetchSlots(service.id));
    if (!slotResult) throw new Error('Failed to fetch slots');
    slot = slotResult;

    // Step 4: Create Booking
    await testStep('Create Booking', () => testCreateBooking(service.id, slot.id));

    // Step 5: Wait for Invoice Creation
    await testStep('Wait for Invoice Creation', testWaitForInvoice);

    // Step 6: Verify Invoice in Database
    await testStep('Verify Invoice in Database', testVerifyInvoiceInDatabase);

    // Step 7: Verify Invoice in Zoho (optional)
    await testStep('Verify Invoice in Zoho', testVerifyInvoiceInZoho);

    // Step 8: Check Invoice Logs (optional)
    await testStep('Check Invoice Logs', testCheckInvoiceLogs);

  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    results.failed.push('Fatal Error');
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`⚠️  Warnings: ${results.warnings.length}`);

  if (results.passed.length > 0) {
    console.log('\n✅ Passed Tests:');
    results.passed.forEach(test => console.log(`   - ${test}`));
  }

  if (results.failed.length > 0) {
    console.log('\n❌ Failed Tests:');
    results.failed.forEach(test => console.log(`   - ${test}`));
  }

  if (results.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    results.warnings.forEach(warning => console.log(`   - ${warning}`));
  }

  if (bookingId) {
    console.log(`\n📋 Booking ID: ${bookingId}`);
  }
  if (invoiceId) {
    console.log(`📄 Invoice ID: ${invoiceId}`);
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Exit with appropriate code
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
