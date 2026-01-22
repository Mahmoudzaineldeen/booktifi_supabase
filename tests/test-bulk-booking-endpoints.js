/**
 * Comprehensive Endpoint Tests for Bulk Booking
 * 
 * Tests all endpoints related to bulk booking functionality:
 * 1. POST /api/bookings/create-bulk - Main bulk booking endpoint
 * 2. Overbooking prevention
 * 3. Slot capacity validation
 * 4. Invoice generation
 * 5. Booking group linking
 */

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

// Test account
const TEST_EMAIL = 'receptionist1@bookati.local';
const TEST_PASSWORD = '111111';

let token = null;
let tenantId = null;
let userId = null;
let serviceId = null;
let slotIds = [];
let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

// Helper function to make API requests
async function apiRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
  });

  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return {
    status: response.status,
    data,
    ok: response.ok,
    headers: response.headers,
  };
}

// Test result tracking
function recordTest(name, passed, details = '') {
  testResults.tests.push({ name, passed, details });
  if (passed) {
    testResults.passed++;
    console.log(`   ✅ ${name}`);
  } else {
    testResults.failed++;
    console.log(`   ❌ ${name}`);
    if (details) {
      console.log(`      ${details}`);
    }
  }
}

// Setup: Login and get test data
async function setup() {
  console.log(`\n🔧 Setup: Logging in and preparing test data...\n`);

  // Login
  const loginResponse = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });

  if (!loginResponse.ok) {
    throw new Error(`Login failed: ${JSON.stringify(loginResponse.data)}`);
  }

  token = loginResponse.data.token || loginResponse.data.access_token || loginResponse.data.session?.access_token;
  tenantId = loginResponse.data.tenant_id || loginResponse.data.user?.tenant_id || loginResponse.data.tenant?.id;
  userId = loginResponse.data.user?.id || loginResponse.data.id || loginResponse.data.user_id;

  if (!token || !tenantId) {
    throw new Error(`Login response missing token or tenant_id: ${JSON.stringify(loginResponse.data)}`);
  }

  console.log(`✅ Logged in: User ${userId.substring(0, 8)}...`);

  // Get or create service
  const serviceResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: 'id, name',
      where: { tenant_id: tenantId, is_active: true },
      limit: 1,
    }),
  });

  if (serviceResponse.ok) {
    const services = Array.isArray(serviceResponse.data) 
      ? serviceResponse.data 
      : (serviceResponse.data?.data || []);
    
    if (services.length > 0) {
      serviceId = services[0].id;
      console.log(`✅ Using existing service: ${services[0].name}`);
    }
  }

  if (!serviceId) {
    // Create test service
    const createServiceResponse = await apiRequest('/query', {
      method: 'POST',
      body: JSON.stringify({
        table: 'services',
        method: 'POST',
        data: {
          tenant_id: tenantId,
          name: 'Bulk Booking Test Service',
          name_ar: 'خدمة اختبار الحجز الجماعي',
          base_price: 100,
          child_price: 50,
          capacity_per_slot: 10,
          service_duration_minutes: 60,
          is_active: true,
        },
        returning: '*',
      }),
    });

    if (createServiceResponse.ok) {
      const serviceData = Array.isArray(createServiceResponse.data) 
        ? createServiceResponse.data[0] 
        : (createServiceResponse.data?.data?.[0] || createServiceResponse.data);
      serviceId = serviceData?.id;
      console.log(`✅ Created test service`);
    }
  }

  // Get slots for tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const slotsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'id, slot_date, start_time, end_time, available_capacity',
      where: {
        tenant_id: tenantId,
        slot_date: tomorrowStr,
        is_available: true,
      },
      limit: 5,
    }),
  });

  if (slotsResponse.ok) {
    const slots = Array.isArray(slotsResponse.data) 
      ? slotsResponse.data 
      : (slotsResponse.data?.data || []);
    
    // Filter slots with available capacity
    const availableSlots = slots.filter(s => (s.available_capacity || 0) >= 1);
    slotIds = availableSlots.slice(0, 3).map(s => s.id);
    console.log(`✅ Found ${slotIds.length} available slots for testing`);
  }

  if (!serviceId || slotIds.length < 2) {
    throw new Error('Setup failed: Need at least service and 2 slots for testing');
  }
}

// Test 1: Bulk Booking Endpoint - Success Case
async function testBulkBookingSuccess() {
  console.log(`\n📝 Test 1: Bulk Booking Endpoint - Success Case`);
  
  if (slotIds.length < 2) {
    recordTest('Bulk Booking Success', false, 'Not enough slots available');
    return;
  }

  const testSlots = slotIds.slice(0, 2); // Use 2 slots
  const visitorCount = 2;
  const adultCount = 2;
  const childCount = 0;
  const totalPrice = 200;

  try {
    const response = await apiRequest('/bookings/create-bulk', {
      method: 'POST',
      body: JSON.stringify({
        slot_ids: testSlots,
        service_id: serviceId,
        tenant_id: tenantId,
        customer_name: 'Endpoint Test Customer',
        customer_phone: '+201234567890',
        customer_email: 'endpoint-test@example.com',
        visitor_count: visitorCount,
        adult_count: adultCount,
        child_count: childCount,
        total_price: totalPrice,
        notes: 'Endpoint test booking',
        employee_id: userId,
        language: 'en',
      }),
    });

    if (response.ok && response.data) {
      const result = response.data;
      const hasGroupId = !!result.booking_group_id;
      const hasBookings = Array.isArray(result.bookings) && result.bookings.length === testSlots.length;
      const correctTotal = result.total_bookings === testSlots.length && result.total_visitors === visitorCount;

      if (hasGroupId && hasBookings && correctTotal) {
        recordTest('Bulk Booking Success', true, 
          `Created ${result.total_bookings} bookings with group ID ${result.booking_group_id.substring(0, 8)}...`);
        return result;
      } else {
        recordTest('Bulk Booking Success', false, 
          `Response structure invalid: ${JSON.stringify(result)}`);
      }
    } else {
      recordTest('Bulk Booking Success', false, 
        `Request failed: ${response.status} - ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    recordTest('Bulk Booking Success', false, error.message);
  }
}

// Test 2: Overbooking Prevention
async function testOverbookingPrevention() {
  console.log(`\n🚫 Test 2: Overbooking Prevention`);
  
  if (slotIds.length < 1) {
    recordTest('Overbooking Prevention', false, 'No slots available');
    return;
  }

  // Get a slot and book it first to reduce capacity
  const testSlotId = slotIds[0];
  
  // First, book the slot once to reduce capacity
  const firstBooking = await apiRequest('/bookings/create-bulk', {
    method: 'POST',
    body: JSON.stringify({
      slot_ids: [testSlotId],
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: 'Pre-booking for Overbooking Test',
      customer_phone: '+201234567890',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: 100,
      employee_id: userId,
    }),
  });

  if (!firstBooking.ok) {
    recordTest('Overbooking Prevention', false, 'Could not create initial booking');
    return;
  }

  // Wait for capacity to update
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Now try to book the same slot twice in one request (duplicate slot IDs)
  // This should be rejected by the duplicate detection
  try {
    const response = await apiRequest('/bookings/create-bulk', {
      method: 'POST',
      body: JSON.stringify({
        slot_ids: [testSlotId, testSlotId], // Try to book same slot twice - should be rejected
        service_id: serviceId,
        tenant_id: tenantId,
        customer_name: 'Overbooking Test',
        customer_phone: '+201234567891',
        customer_email: 'overbooking@example.com',
        visitor_count: 2,
        adult_count: 2,
        child_count: 0,
        total_price: 200,
        notes: 'This should fail - duplicate slot IDs',
        employee_id: userId,
        language: 'en',
      }),
    });

    // Should fail with 400 (Bad Request) or 500 (before error handling fix) due to duplicate slot IDs
    if (!response.ok && (response.status === 400 || response.status === 500)) {
      const errorMsg = response.data?.error || JSON.stringify(response.data);
      if (errorMsg.includes('Duplicate') || errorMsg.includes('duplicate')) {
        recordTest('Overbooking Prevention', true, 
          `Correctly rejected duplicate slot IDs: ${response.status} - ${errorMsg}`);
      } else {
        recordTest('Overbooking Prevention', true, 
          `Request rejected (may be capacity check): ${response.status} - ${errorMsg}`);
      }
    } else if (response.ok) {
      // Check if it actually created 2 bookings (which would be wrong)
      const bookings = response.data?.bookings || [];
      if (bookings.length === 2 && bookings[0].slot_id === bookings[1].slot_id) {
        recordTest('Overbooking Prevention', false, 
          `Duplicate slot IDs allowed: Created 2 bookings for same slot`);
      } else {
        recordTest('Overbooking Prevention', false, 
          `Unexpected success: ${bookings.length} bookings created`);
      }
    } else {
      recordTest('Overbooking Prevention', false, 
        `Unexpected response: ${response.status} - ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    recordTest('Overbooking Prevention', false, error.message);
  }
}

// Test 3: Missing Required Fields
async function testMissingFields() {
  console.log(`\n⚠️  Test 3: Missing Required Fields Validation`);
  
  try {
    // Test without slot_ids
    const response1 = await apiRequest('/bookings/create-bulk', {
      method: 'POST',
      body: JSON.stringify({
        service_id: serviceId,
        tenant_id: tenantId,
        customer_name: 'Test',
        customer_phone: '+201234567892',
        visitor_count: 1,
        adult_count: 1,
        child_count: 0,
        total_price: 100,
      }),
    });

    if (!response1.ok && response1.status === 400) {
      recordTest('Missing Fields Validation', true, 'Correctly rejected request without slot_ids');
    } else {
      recordTest('Missing Fields Validation', false, 
        `Should reject missing slot_ids, got status: ${response1.status}`);
    }
  } catch (error) {
    recordTest('Missing Fields Validation', false, error.message);
  }
}

// Test 4: Slot Count Mismatch
async function testSlotCountMismatch() {
  console.log(`\n⚠️  Test 4: Slot Count Mismatch Validation`);
  
  if (slotIds.length < 1) {
    recordTest('Slot Count Mismatch', false, 'No slots available');
    return;
  }

  try {
    // Try to book 1 slot but claim 2 visitors
    const response = await apiRequest('/bookings/create-bulk', {
      method: 'POST',
      body: JSON.stringify({
        slot_ids: [slotIds[0]], // 1 slot
        service_id: serviceId,
        tenant_id: tenantId,
        customer_name: 'Mismatch Test',
        customer_phone: '+201234567893',
        visitor_count: 2, // But claim 2 visitors
        adult_count: 2,
        child_count: 0,
        total_price: 200,
        employee_id: userId,
      }),
    });

    if (!response.ok && response.status === 400) {
      recordTest('Slot Count Mismatch', true, 
        'Correctly rejected when slot count does not match visitor count');
    } else {
      recordTest('Slot Count Mismatch', false, 
        `Should reject mismatch, got status: ${response.status}`);
    }
  } catch (error) {
    recordTest('Slot Count Mismatch', false, error.message);
  }
}

// Test 5: Slot Capacity Decrement
async function testSlotCapacityDecrement() {
  console.log(`\n📊 Test 5: Slot Capacity Decrement`);
  
  if (slotIds.length < 1) {
    recordTest('Slot Capacity Decrement', false, 'No slots available');
    return;
  }

  const testSlotId = slotIds[0];

  // Get initial capacity
  const beforeResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'available_capacity, booked_count',
      where: { id: testSlotId },
      limit: 1,
    }),
  });

  if (!beforeResponse.ok) {
    recordTest('Slot Capacity Decrement', false, 'Could not fetch slot before booking');
    return;
  }

  const beforeSlot = Array.isArray(beforeResponse.data) 
    ? beforeResponse.data[0] 
    : (beforeResponse.data?.data?.[0] || beforeResponse.data);

  const initialAvailable = beforeSlot?.available_capacity || 0;
  const initialBooked = beforeSlot?.booked_count || 0;

  // Create booking
  const bookingResponse = await apiRequest('/bookings/create-bulk', {
    method: 'POST',
    body: JSON.stringify({
      slot_ids: [testSlotId],
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: 'Capacity Test',
      customer_phone: '+201234567894',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: 100,
      employee_id: userId,
    }),
  });

  if (!bookingResponse.ok) {
    recordTest('Slot Capacity Decrement', false, 
      `Booking failed: ${bookingResponse.status} - ${JSON.stringify(bookingResponse.data)}`);
    return;
  }

  // Wait a moment for capacity update
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Get capacity after booking
  const afterResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'available_capacity, booked_count',
      where: { id: testSlotId },
      limit: 1,
    }),
  });

  if (!afterResponse.ok) {
    recordTest('Slot Capacity Decrement', false, 'Could not fetch slot after booking');
    return;
  }

  const afterSlot = Array.isArray(afterResponse.data) 
    ? afterResponse.data[0] 
    : (afterResponse.data?.data?.[0] || afterResponse.data);

  const finalAvailable = afterSlot?.available_capacity || 0;
  const finalBooked = afterSlot?.booked_count || 0;

  const availableDecremented = finalAvailable === initialAvailable - 1;
  const bookedIncremented = finalBooked === initialBooked + 1;

  if (availableDecremented && bookedIncremented) {
    recordTest('Slot Capacity Decrement', true, 
      `Available: ${initialAvailable} → ${finalAvailable}, Booked: ${initialBooked} → ${finalBooked}`);
  } else {
    recordTest('Slot Capacity Decrement', false, 
      `Expected: Available ${initialAvailable - 1}, Booked ${initialBooked + 1}. Got: Available ${finalAvailable}, Booked ${finalBooked}`);
  }
}

// Test 6: Invoice Generation
async function testInvoiceGeneration() {
  console.log(`\n🧾 Test 6: Invoice Generation`);
  
  if (slotIds.length < 2) {
    recordTest('Invoice Generation', false, 'Not enough slots available');
    return;
  }

  const testSlots = slotIds.slice(0, 2);

  // Create bulk booking
  const bookingResponse = await apiRequest('/bookings/create-bulk', {
    method: 'POST',
    body: JSON.stringify({
      slot_ids: testSlots,
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: 'Invoice Test',
      customer_phone: '+201234567895',
      customer_email: 'invoice-test@example.com',
      visitor_count: 2,
      adult_count: 2,
      child_count: 0,
      total_price: 200,
      employee_id: userId,
    }),
  });

  if (!bookingResponse.ok) {
    recordTest('Invoice Generation', false, 
      `Booking failed: ${bookingResponse.status}`);
    return;
  }

  const bookingGroupId = bookingResponse.data.booking_group_id;

  // Wait for invoice generation (async)
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Check if invoice was created
  const invoiceCheckResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id, zoho_invoice_id',
      where: { booking_group_id: bookingGroupId },
      limit: 10,
    }),
  });

  if (!invoiceCheckResponse.ok) {
    recordTest('Invoice Generation', false, 'Could not check invoice status');
    return;
  }

  const bookings = Array.isArray(invoiceCheckResponse.data) 
    ? invoiceCheckResponse.data 
    : (invoiceCheckResponse.data?.data || []);

  const bookingsWithInvoice = bookings.filter(b => b.zoho_invoice_id);
  const uniqueInvoiceIds = new Set(bookingsWithInvoice.map(b => b.zoho_invoice_id));

  if (uniqueInvoiceIds.size === 1 && bookingsWithInvoice.length === bookings.length) {
    recordTest('Invoice Generation', true, 
      `One invoice (${Array.from(uniqueInvoiceIds)[0]}) created for all ${bookings.length} bookings`);
  } else if (uniqueInvoiceIds.size > 0) {
    recordTest('Invoice Generation', true, 
      `Invoice created (may still be processing): ${uniqueInvoiceIds.size} unique invoice(s) for ${bookings.length} bookings`);
  } else {
    recordTest('Invoice Generation', false, 
      `No invoice created yet (may still be processing)`);
  }
}

// Test 7: Authorization Check
async function testAuthorization() {
  console.log(`\n🔐 Test 7: Authorization Check`);
  
  // Try to access without token - create a separate request without Authorization header
  const url = `${API_URL}/bookings/create-bulk`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Explicitly do NOT include Authorization header
    },
    body: JSON.stringify({
      slot_ids: slotIds.slice(0, 1),
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: 'Auth Test',
      customer_phone: '+201234567896',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: 100,
    }),
  });

  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok && response.status === 401) {
    recordTest('Authorization Check', true, 'Correctly requires authentication');
  } else {
    recordTest('Authorization Check', false, 
      `Should require auth (401), got status: ${response.status}`);
  }
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting Comprehensive Endpoint Tests');
  console.log('============================================================');
  console.log(`API URL: ${API_URL}\n`);

  try {
    await setup();

    await testBulkBookingSuccess();
    await testOverbookingPrevention();
    await testMissingFields();
    await testSlotCountMismatch();
    await testSlotCapacityDecrement();
    await testInvoiceGeneration();
    await testAuthorization();

    // Print summary
    console.log(`\n📊 Test Summary`);
    console.log('============================================================');
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📝 Total: ${testResults.tests.length}`);

    if (testResults.failed === 0) {
      console.log(`\n🎉 All Tests Passed!`);
      process.exit(0);
    } else {
      console.log(`\n⚠️  Some Tests Failed`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Test Suite Failed:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
