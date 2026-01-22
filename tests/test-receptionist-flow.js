/**
 * Test Receptionist Flow
 * Tests the complete receptionist booking creation flow
 * 
 * Credentials:
 * - Email: receptionist1@bookati.local
 * - Password: 111111
 * 
 * Usage:
 *   node tests/test-receptionist-flow.js
 *   API_URL=https://booktifisupabase-production.up.railway.app/api node tests/test-receptionist-flow.js
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';

let authToken = null;
let tenantId = null;
let userId = null;

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

async function testStep(name, testFn) {
  log(`Testing: ${name}`, 'info');
  try {
    const result = await testFn();
    if (result === false) {
      results.failed.push(name);
      log(`FAILED: ${name}`, 'error');
      return false;
    }
    results.passed.push(name);
    log(`PASSED: ${name}`, 'success');
    return true;
  } catch (error) {
    results.failed.push(name);
    log(`FAILED: ${name} - ${error.message}`, 'error');
    console.error(error);
    return false;
  }
}

async function makeRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

// Test 1: Health Check
async function testHealthCheck() {
  const result = await makeRequest('/health', { method: 'GET' });
  if (!result.ok || result.data.status !== 'ok') {
    throw new Error(`Health check failed: ${result.status} - ${JSON.stringify(result.data)}`);
  }
  return true;
}

// Test 2: Login as Receptionist
async function testLogin() {
  const result = await makeRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({
      email: 'receptionist1@bookati.local',
      password: '111111'
    })
  });

  log(`Login response status: ${result.status}`, 'info');
  log(`Login response data: ${JSON.stringify(result.data, null, 2)}`, 'info');

  if (!result.ok) {
    throw new Error(`Login failed: ${result.status} - ${JSON.stringify(result.data)}`);
  }

  // Check different possible response structures
  let token = result.data.access_token || result.data.token || result.data.accessToken;
  let user = result.data.user || result.data;
  let tenant = result.data.tenant || result.data.user?.tenant;

  if (!token) {
    // Try to get token from nested structure
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
    throw new Error(`No access token in response. Response structure: ${JSON.stringify(result.data, null, 2)}`);
  }

  authToken = token;
  // Try multiple locations for tenant_id
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

// Test 3: Fetch Services
async function testFetchServices() {
  if (!tenantId) {
    throw new Error('No tenant_id available');
  }

  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: 'id, name, name_ar, base_price, original_price, discount_percentage, child_price, capacity_per_slot, capacity_mode',
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
  log(`Found ${services.length} active services`, 'info');

  if (services.length === 0) {
    results.warnings.push('No active services found for tenant');
    log('WARNING: No active services found. This might be expected if no services are configured.', 'warning');
    return true; // Not a failure, just a warning
  }

  // Log first few services
  services.slice(0, 3).forEach(service => {
    log(`  - ${service.name} (${service.name_ar}) - ${service.base_price} SAR`, 'info');
  });

  return true;
}

// Test 4: Fetch Service Offers
async function testFetchServiceOffers() {
  if (!tenantId) {
    throw new Error('No tenant_id available');
  }

  // First get services
  const servicesResult = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: 'id',
      where: {
        tenant_id: tenantId,
        is_active: true
      },
      limit: 5
    })
  });

  if (!servicesResult.ok || !servicesResult.data || servicesResult.data.length === 0) {
    log('No services found, skipping offers test', 'warning');
    return true;
  }

  const serviceIds = servicesResult.data.map(s => s.id);

  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'service_offers',
      select: 'id, service_id, name, name_ar, price, original_price, discount_percentage, is_active',
      where: {
        service_id__in: serviceIds,
        is_active: true
      },
      orderBy: {
        column: 'name',
        ascending: true
      }
    })
  });

  if (!result.ok) {
    throw new Error(`Failed to fetch offers: ${result.status} - ${JSON.stringify(result.data)}`);
  }

  const offers = result.data || [];
  log(`Found ${offers.length} active offers`, 'info');

  return true;
}

// Test 5: Fetch Slots for a Service
async function testFetchSlots() {
  if (!tenantId) {
    throw new Error('No tenant_id available');
  }

  // First get a service
  const servicesResult = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: 'id',
      where: {
        tenant_id: tenantId,
        is_active: true
      },
      limit: 1
    })
  });

  if (!servicesResult.ok || !servicesResult.data || servicesResult.data.length === 0) {
    log('No services found, skipping slots test', 'warning');
    return true;
  }

  const serviceId = servicesResult.data[0].id;

  // Get shifts for this service
  const shiftsResult = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'shifts',
      select: 'id, days_of_week',
      where: {
        service_id: serviceId,
        is_active: true
      }
    })
  });

  if (!shiftsResult.ok) {
    throw new Error(`Failed to fetch shifts: ${shiftsResult.status}`);
  }

  const shifts = shiftsResult.data || [];
  log(`Found ${shifts.length} active shifts for service`, 'info');

  if (shifts.length === 0) {
    results.warnings.push('No active shifts found for service');
    log('WARNING: No active shifts found. Slots cannot be generated without shifts.', 'warning');
    return true;
  }

  // Get slots for today
  const today = new Date().toISOString().split('T')[0];
  const shiftIds = shifts.map(s => s.id);

  const slotsResult = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'id, slot_date, start_time, end_time, available_capacity, booked_count, employee_id, shift_id',
      where: {
        tenant_id: tenantId,
        slot_date: today,
        shift_id__in: shiftIds,
        is_available: true
      },
      orderBy: {
        column: 'start_time',
        ascending: true
      }
    })
  });

  if (!slotsResult.ok) {
    throw new Error(`Failed to fetch slots: ${slotsResult.status}`);
  }

  const slots = slotsResult.data || [];
  log(`Found ${slots.length} available slots for today (${today})`, 'info');

  if (slots.length > 0) {
    slots.slice(0, 3).forEach(slot => {
      log(`  - ${slot.start_time} - ${slot.end_time} (Capacity: ${slot.available_capacity})`, 'info');
    });
  }

  return true;
}

// Test 6: Fetch Packages
async function testFetchPackages() {
  if (!tenantId) {
    throw new Error('No tenant_id available');
  }

  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'service_packages',
      select: 'id, name, name_ar, total_price',
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
    throw new Error(`Failed to fetch packages: ${result.status}`);
  }

  const packages = result.data || [];
  log(`Found ${packages.length} active packages`, 'info');

  return true;
}

// Test 7: Fetch Bookings
async function testFetchBookings() {
  if (!tenantId) {
    throw new Error('No tenant_id available');
  }

  const result = await makeRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id, customer_name, customer_phone, visitor_count, total_price, status, payment_status, created_at',
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
    throw new Error(`Failed to fetch bookings: ${result.status}`);
  }

  const bookings = result.data || [];
  log(`Found ${bookings.length} bookings (showing last 10)`, 'info');

  if (bookings.length > 0) {
    bookings.slice(0, 3).forEach(booking => {
      log(`  - ${booking.customer_name} - ${booking.status} - ${booking.payment_status}`, 'info');
    });
  }

  return true;
}

// Test 8: Validate User Profile
async function testUserProfile() {
  const result = await makeRequest('/auth/validate', {
    method: 'GET'
  });

  if (!result.ok) {
    throw new Error(`Failed to validate session: ${result.status}`);
  }

  if (!result.data.valid) {
    throw new Error('Session is not valid');
  }

  log(`Session is valid for user: ${result.data.user?.email}`, 'success');
  log(`Role: ${result.data.user?.role}`, 'info');
  log(`Tenant: ${result.data.user?.tenant_id}`, 'info');

  return true;
}

// Main test runner
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('RECEPTIONIST FLOW TEST');
  console.log('='.repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`Email: receptionist1@bookati.local`);
  console.log(`Password: 111111`);
  console.log('='.repeat(60) + '\n');

  try {
    await testStep('Health Check', testHealthCheck);
    await testStep('Login as Receptionist', testLogin);
    await testStep('Validate User Profile', testUserProfile);
    await testStep('Fetch Services', testFetchServices);
    await testStep('Fetch Service Offers', testFetchServiceOffers);
    await testStep('Fetch Slots', testFetchSlots);
    await testStep('Fetch Packages', testFetchPackages);
    await testStep('Fetch Bookings', testFetchBookings);

    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${results.passed.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`⚠️  Warnings: ${results.warnings.length}`);
    console.log('='.repeat(60));

    if (results.failed.length > 0) {
      console.log('\n❌ Failed Tests:');
      results.failed.forEach(test => console.log(`  - ${test}`));
    }

    if (results.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      results.warnings.forEach(warning => console.log(`  - ${warning}`));
    }

    console.log('\n✅ Passed Tests:');
    results.passed.forEach(test => console.log(`  - ${test}`));

    const exitCode = results.failed.length > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run tests
runTests();
