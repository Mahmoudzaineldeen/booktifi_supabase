/**
 * Invoice Creation Diagnostic Test
 * 
 * This test creates a booking and thoroughly diagnoses why invoices may not be generated.
 * It checks:
 * 1. Zoho configuration
 * 2. Zoho tokens
 * 3. Booking creation
 * 4. Invoice creation flow
 * 5. Database verification
 * 
 * Usage:
 *   node tests/test-invoice-diagnostic.js
 * 
 * Environment Variables:
 *   API_URL - Backend API URL (default: http://localhost:3000)
 *   TENANT_EMAIL - Tenant provider email for login
 *   TENANT_PASSWORD - Tenant provider password
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';
const TENANT_EMAIL = process.env.TENANT_EMAIL || 'mahmoudnzaineldeen@gmail.com';
const TENANT_PASSWORD = process.env.TENANT_PASSWORD || '111111';

let authToken = null;
let tenantId = null;
let bookingId = null;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
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
  log('\n🔐 Step 1: Logging in as tenant provider...', 'blue');
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
    logError(`Response: ${JSON.stringify(data, null, 2)}`);
    throw new Error('Login response missing access_token');
  }

  authToken = data.session.access_token;
  tenantId = data.user?.tenant_id || data.user?.user_metadata?.tenant_id;

  if (!tenantId) {
    logError('Login response missing tenant_id');
    logError(`Response: ${JSON.stringify(data, null, 2)}`);
    throw new Error('Login response missing tenant_id');
  }

  logSuccess(`Logged in successfully`);
  logInfo(`Tenant ID: ${tenantId}`);
  logInfo(`Token: ${authToken.substring(0, 20)}...`);
}

/**
 * Step 2: Check Zoho Configuration
 */
async function checkZohoConfig() {
  log('\n🔍 Step 2: Checking Zoho configuration...', 'blue');

  const { data, ok, status } = await makeRequest(`/query?table=tenant_zoho_configs&tenant_id=eq.${tenantId}&select=*`);

  if (!ok) {
    logError(`Failed to check Zoho config. Status: ${status}`);
    logError(`Response: ${JSON.stringify(data, null, 2)}`);
    return false;
  }

  const configs = Array.isArray(data) ? data : (data?.data || []);
  const activeConfig = configs.find(c => c.is_active === true);

  if (!activeConfig) {
    logError('❌ No active Zoho configuration found!');
    logWarning('Please configure Zoho in Settings → Zoho Integration');
    logInfo(`Found ${configs.length} config(s), but none are active`);
    return false;
  }

  logSuccess('Zoho configuration found');
  logInfo(`Config ID: ${activeConfig.id}`);
  logInfo(`Client ID: ${activeConfig.client_id ? '✅ Set' : '❌ Missing'}`);
  logInfo(`Redirect URI: ${activeConfig.redirect_uri ? '✅ Set' : '❌ Missing'}`);
  logInfo(`Is Active: ${activeConfig.is_active}`);

  if (!activeConfig.client_id || !activeConfig.redirect_uri) {
    logError('Zoho configuration is incomplete!');
    return false;
  }

  return true;
}

/**
 * Step 3: Check Zoho Tokens
 */
async function checkZohoTokens() {
  log('\n🔍 Step 3: Checking Zoho tokens...', 'blue');

  const { data, ok, status } = await makeRequest(`/query?table=zoho_tokens&tenant_id=eq.${tenantId}&select=*`);

  if (!ok) {
    logError(`Failed to check Zoho tokens. Status: ${status}`);
    logError(`Response: ${JSON.stringify(data, null, 2)}`);
    return false;
  }

  const tokens = Array.isArray(data) ? data : (data?.data || []);

  if (tokens.length === 0) {
    logError('❌ No Zoho tokens found!');
    logWarning('Please complete OAuth flow in Settings → Zoho Integration → Connect to Zoho');
    return false;
  }

  const token = tokens[0];
  logSuccess('Zoho token found');
  logInfo(`Token ID: ${token.id}`);
  logInfo(`Has Access Token: ${token.access_token ? '✅ Yes' : '❌ No'}`);
  logInfo(`Has Refresh Token: ${token.refresh_token ? '✅ Yes' : '❌ No'}`);

  if (token.expires_at) {
    const expiresAt = new Date(token.expires_at);
    const now = new Date();
    const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60);
    
    if (expiresAt <= now) {
      logError(`❌ Token expired ${Math.abs(minutesUntilExpiry)} minutes ago!`);
      logWarning('Please refresh Zoho connection in Settings');
      return false;
    } else if (minutesUntilExpiry <= 5) {
      logWarning(`Token expires in ${minutesUntilExpiry} minutes (will be auto-refreshed)`);
    } else {
      logSuccess(`Token valid (expires in ${minutesUntilExpiry} minutes)`);
    }
  } else {
    logWarning('Token has no expiration date');
  }

  return true;
}

/**
 * Step 4: Find Available Service and Slot
 */
async function findAvailableSlot() {
  log('\n🔍 Step 4: Finding available service and slot...', 'blue');

  // Get services
  const { data: servicesData, ok: servicesOk } = await makeRequest(`/query?table=services&tenant_id=eq.${tenantId}&select=id,name&limit=1`);

  if (!servicesOk || !servicesData) {
    logError('Failed to fetch services');
    throw new Error('No services available');
  }

  const services = Array.isArray(servicesData) ? servicesData : (servicesData?.data || []);
  if (services.length === 0) {
    logError('No services found');
    throw new Error('No services available');
  }

  const service = services[0];
  logSuccess(`Found service: ${service.name} (${service.id})`);

  // Get available slots (next 7 days)
  const today = new Date();
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);

  const { data: slotsData, ok: slotsOk } = await makeRequest(
    `/query?table=slots&service_id=eq.${service.id}&slot_date=gte.${today.toISOString().split('T')[0]}&slot_date=lte.${nextWeek.toISOString().split('T')[0]}&select=id,slot_date,start_time,end_time&limit=1`
  );

  if (!slotsOk || !slotsData) {
    logError('Failed to fetch slots');
    throw new Error('No slots available');
  }

  const slots = Array.isArray(slotsData) ? slotsData : (slotsData?.data || []);
  if (slots.length === 0) {
    logError('No available slots found');
    throw new Error('No slots available');
  }

  const slot = slots[0];
  logSuccess(`Found slot: ${slot.slot_date} ${slot.start_time} - ${slot.end_time} (${slot.id})`);

  return { serviceId: service.id, slotId: slot.id };
}

/**
 * Step 5: Create Booking
 */
async function createBooking(serviceId, slotId) {
  log('\n📝 Step 5: Creating booking...', 'blue');

  const customerEmail = `test-invoice-${Date.now()}@example.com`;
  const customerPhone = '+966501234567';

  logInfo(`Customer Email: ${customerEmail}`);
  logInfo(`Customer Phone: ${customerPhone}`);

  const { response, data, ok, status } = await makeRequest('/bookings/create', {
    method: 'POST',
    body: JSON.stringify({
      slot_id: slotId,
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: 'Invoice Test Customer',
      customer_email: customerEmail,
      customer_phone: customerPhone,
      visitor_count: 2,
      adult_count: 2,
      child_count: 0,
      total_price: 100,
    }),
  });

  if (!ok) {
    logError(`Booking creation failed. Status: ${status}`);
    logError(`Response: ${JSON.stringify(data, null, 2)}`);
    throw new Error(`Booking creation failed (${status}): ${data.error || data.message || 'Unknown error'}`);
  }

  bookingId = data.id || data.booking?.id;
  if (!bookingId) {
    logError('Booking created but no booking ID returned');
    logError(`Response: ${JSON.stringify(data, null, 2)}`);
    throw new Error('Booking created but no booking ID returned');
  }

  logSuccess(`Booking created successfully`);
  logInfo(`Booking ID: ${bookingId}`);
  return bookingId;
}

/**
 * Step 6: Wait and Verify Invoice Creation
 */
async function verifyInvoiceCreation() {
  log('\n⏳ Step 6: Waiting for invoice creation (10 seconds)...', 'blue');
  
  // Wait for invoice creation to complete
  await new Promise(resolve => setTimeout(resolve, 10000));

  log('\n🔍 Step 7: Verifying invoice creation...', 'blue');

  // Check booking for invoice
  const { data, ok, status } = await makeRequest(`/query?table=bookings&id=eq.${bookingId}&select=id,zoho_invoice_id,zoho_invoice_created_at,customer_email,customer_phone,total_price`);

  if (!ok) {
    logError(`Failed to check booking. Status: ${status}`);
    logError(`Response: ${JSON.stringify(data, null, 2)}`);
    return false;
  }

  const bookings = Array.isArray(data) ? data : (data?.data || []);
  const booking = bookings[0];

  if (!booking) {
    logError('Booking not found!');
    return false;
  }

  logInfo(`Booking ID: ${booking.id}`);
  logInfo(`Customer Email: ${booking.customer_email || 'NOT PROVIDED'}`);
  logInfo(`Customer Phone: ${booking.customer_phone || 'NOT PROVIDED'}`);
  logInfo(`Total Price: ${booking.total_price}`);

  if (booking.zoho_invoice_id) {
    logSuccess(`✅ INVOICE CREATED SUCCESSFULLY!`);
    logInfo(`Invoice ID: ${booking.zoho_invoice_id}`);
    logInfo(`Invoice Created At: ${booking.zoho_invoice_created_at || 'N/A'}`);
    return true;
  } else {
    logError('❌ NO INVOICE CREATED!');
    logWarning('Invoice ID is NULL in database');
    
    // Check zoho_invoice_logs for errors
    log('\n🔍 Checking zoho_invoice_logs for errors...', 'blue');
    const { data: logsData, ok: logsOk } = await makeRequest(`/query?table=zoho_invoice_logs&booking_id=eq.${bookingId}&select=*&order=created_at.desc&limit=5`);

    if (logsOk && logsData) {
      const logs = Array.isArray(logsData) ? logsData : (logsData?.data || []);
      if (logs.length > 0) {
        logWarning(`Found ${logs.length} log entry/entries:`);
        logs.forEach((logEntry, index) => {
          log(`\n  Log ${index + 1}:`, 'yellow');
          log(`    Status: ${logEntry.status}`);
          log(`    Error: ${logEntry.error_message || 'None'}`);
          log(`    Invoice ID: ${logEntry.zoho_invoice_id || 'NULL'}`);
          if (logEntry.response_payload) {
            try {
              const payload = JSON.parse(logEntry.response_payload);
              log(`    Response: ${JSON.stringify(payload, null, 4)}`);
            } catch (e) {
              log(`    Response: ${logEntry.response_payload.substring(0, 200)}`);
            }
          }
        });
      } else {
        logWarning('No logs found - invoice creation may not have been attempted');
      }
    }

    return false;
  }
}

/**
 * Main test flow
 */
async function runDiagnostic() {
  try {
    log('\n═══════════════════════════════════════════════════════════', 'cyan');
    log('🧾 INVOICE CREATION DIAGNOSTIC TEST', 'cyan');
    log('═══════════════════════════════════════════════════════════', 'cyan');

    // Step 1: Login
    await loginAsTenant();

    // Step 2: Check Zoho Config
    const hasConfig = await checkZohoConfig();
    if (!hasConfig) {
      logError('\n❌ DIAGNOSIS: Zoho is not configured. Please configure Zoho in Settings → Zoho Integration');
      process.exit(1);
    }

    // Step 3: Check Zoho Tokens
    const hasTokens = await checkZohoTokens();
    if (!hasTokens) {
      logError('\n❌ DIAGNOSIS: Zoho tokens are missing or expired. Please complete OAuth flow in Settings → Zoho Integration');
      process.exit(1);
    }

    // Step 4: Find Available Slot
    const { serviceId, slotId } = await findAvailableSlot();

    // Step 5: Create Booking
    await createBooking(serviceId, slotId);

    // Step 6 & 7: Wait and Verify
    const invoiceCreated = await verifyInvoiceCreation();

    // Final Summary
    log('\n═══════════════════════════════════════════════════════════', 'cyan');
    if (invoiceCreated) {
      logSuccess('✅ TEST PASSED: Invoice was created successfully!');
    } else {
      logError('❌ TEST FAILED: Invoice was NOT created!');
      logWarning('\nPossible causes:');
      logWarning('1. Invoice creation promise may not be executing');
      logWarning('2. Zoho API may be rejecting the request');
      logWarning('3. Database update may be failing');
      logWarning('4. Check server logs for detailed error messages');
    }
    log('═══════════════════════════════════════════════════════════', 'cyan');

    process.exit(invoiceCreated ? 0 : 1);
  } catch (error) {
    logError(`\n❌ TEST FAILED WITH EXCEPTION: ${error.message}`);
    logError(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

// Run the diagnostic
runDiagnostic();
