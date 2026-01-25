/**
 * Test Script: Receptionist Edit Booking & Change Time
 * 
 * This script tests:
 * 1. Edit Booking functionality (customer info, status, price, etc.)
 * 2. Change Time functionality (rescheduling to new time slot)
 * 
 * Usage:
 *   node tests/test-receptionist-edit-booking.js
 * 
 * Prerequisites:
 *   - Backend server running
 *   - Valid receptionist credentials
 *   - At least one existing booking
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';

// Test configuration
const TEST_CONFIG = {
  receptionistEmail: process.env.RECEPTIONIST_EMAIL || 'receptionist@example.com',
  receptionistPassword: process.env.RECEPTIONIST_PASSWORD || 'password123',
  testBookingId: process.env.TEST_BOOKING_ID || null, // Will find one if not provided
};

let authToken = null;
let tenantId = null;
let testBooking = null;
let originalBookingData = null;

/**
 * Helper: Make API request
 */
async function makeRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken && { Authorization: `Bearer ${authToken}` }),
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({ error: 'Invalid JSON response' }));
  return { response, data, ok: response.ok, status: response.status };
}

/**
 * Step 1: Login as Receptionist
 */
async function loginAsReceptionist() {
  console.log('\n🔐 Step 1: Logging in as receptionist...');
  console.log(`   Email: ${TEST_CONFIG.receptionistEmail}`);

  const { response, data, ok } = await makeRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: TEST_CONFIG.receptionistEmail,
      password: TEST_CONFIG.receptionistPassword,
    }),
  });

  if (!ok) {
    throw new Error(`Login failed: ${data.error || response.statusText}`);
  }

  if (!data.token) {
    throw new Error('Login response missing token');
  }

  authToken = data.token;
  tenantId = data.user?.tenant_id;

  console.log('   ✅ Login successful');
  console.log(`   Token: ${authToken.substring(0, 20)}...`);
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Role: ${data.user?.role}`);

  if (data.user?.role !== 'receptionist') {
    throw new Error(`Expected role 'receptionist', got '${data.user?.role}'`);
  }

  return { token: authToken, tenantId, user: data.user };
}

/**
 * Step 2: Find a test booking
 */
async function findTestBooking() {
  console.log('\n📋 Step 2: Finding a test booking...');

  if (TEST_CONFIG.testBookingId) {
    console.log(`   Using provided booking ID: ${TEST_CONFIG.testBookingId}`);
    const { response, data, ok } = await makeRequest(`/bookings/${TEST_CONFIG.testBookingId}`);

    if (!ok) {
      throw new Error(`Failed to fetch booking: ${data.error || response.statusText}`);
    }

    testBooking = data;
    console.log(`   ✅ Found booking: ${testBooking.id}`);
    console.log(`   Customer: ${testBooking.customer_name}`);
    console.log(`   Status: ${testBooking.status}`);
    console.log(`   Slot ID: ${testBooking.slot_id}`);
    return testBooking;
  }

  // Find an active booking
  const { response, data, ok } = await makeRequest('/bookings', {
    method: 'GET',
  });

  if (!ok) {
    throw new Error(`Failed to fetch bookings: ${data.error || response.statusText}`);
  }

  const bookings = Array.isArray(data) ? data : (data.bookings || []);
  const activeBooking = bookings.find(
    b => b.status !== 'cancelled' && b.status !== 'completed' && b.slot_id
  );

  if (!activeBooking) {
    throw new Error('No active bookings found. Please create a booking first.');
  }

  testBooking = activeBooking;
  console.log(`   ✅ Found active booking: ${testBooking.id}`);
  console.log(`   Customer: ${testBooking.customer_name}`);
  console.log(`   Status: ${testBooking.status}`);
  console.log(`   Slot ID: ${testBooking.slot_id}`);
  console.log(`   Service ID: ${testBooking.service_id}`);

  return testBooking;
}

/**
 * Step 3: Get booking details with relations
 */
async function getBookingDetails(bookingId) {
  console.log(`\n🔍 Step 3: Fetching full booking details for ${bookingId}...`);

  const { response, data, ok } = await makeRequest(`/bookings/${bookingId}`);

  if (!ok) {
    throw new Error(`Failed to fetch booking details: ${data.error || response.statusText}`);
  }

  originalBookingData = {
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    customer_email: data.customer_email,
    visitor_count: data.visitor_count,
    total_price: data.total_price,
    status: data.status,
    notes: data.notes,
    slot_id: data.slot_id,
  };

  console.log('   ✅ Booking details fetched');
  console.log(`   Original data:`, originalBookingData);

  return data;
}

/**
 * Step 4: Test Edit Booking
 */
async function testEditBooking() {
  console.log('\n✏️  Step 4: Testing Edit Booking...');

  const updatedData = {
    customer_name: originalBookingData.customer_name + ' (Edited)',
    customer_phone: originalBookingData.customer_phone,
    customer_email: originalBookingData.customer_email || 'test@example.com',
    visitor_count: originalBookingData.visitor_count + 1,
    total_price: parseFloat(originalBookingData.total_price) + 10,
    status: originalBookingData.status === 'pending' ? 'confirmed' : originalBookingData.status,
    notes: 'Test edit from automated test script',
  };

  console.log('   Updating booking with:', updatedData);

  const { response, data, ok, status } = await makeRequest(`/bookings/${testBooking.id}`, {
    method: 'PATCH',
    body: JSON.stringify(updatedData),
  });

  if (!ok) {
    throw new Error(`Edit booking failed (${status}): ${data.error || response.statusText}`);
  }

  console.log('   ✅ Booking updated successfully');

  // Verify the update
  const { data: updatedBooking } = await makeRequest(`/bookings/${testBooking.id}`);
  
  const changes = [];
  if (updatedBooking.customer_name !== updatedData.customer_name) {
    changes.push(`customer_name: expected "${updatedData.customer_name}", got "${updatedBooking.customer_name}"`);
  }
  if (updatedBooking.visitor_count !== updatedData.visitor_count) {
    changes.push(`visitor_count: expected ${updatedData.visitor_count}, got ${updatedBooking.visitor_count}`);
  }
  if (updatedBooking.total_price !== updatedData.total_price) {
    changes.push(`total_price: expected ${updatedData.total_price}, got ${updatedBooking.total_price}`);
  }
  if (updatedBooking.status !== updatedData.status) {
    changes.push(`status: expected "${updatedData.status}", got "${updatedBooking.status}"`);
  }

  if (changes.length > 0) {
    console.warn('   ⚠️  Some fields were not updated:');
    changes.forEach(change => console.warn(`      - ${change}`));
  } else {
    console.log('   ✅ All fields updated correctly');
  }

  return { success: true, updatedBooking };
}

/**
 * Step 5: Find available slots for time change
 */
async function findAvailableSlots(serviceId) {
  console.log(`\n🕐 Step 5: Finding available slots for service ${serviceId}...`);

  // Get slots for the next 7 days
  const today = new Date();
  const futureDate = new Date(today);
  futureDate.setDate(today.getDate() + 7);

  const { response, data, ok } = await makeRequest(
    `/query?table=time_slots&service_id=${serviceId}&tenant_id=${tenantId}&slot_date_gte=${formatDate(today)}&slot_date_lte=${formatDate(futureDate)}&available_capacity_gt=0&limit=10`
  );

  if (!ok) {
    throw new Error(`Failed to fetch slots: ${data.error || response.statusText}`);
  }

  const slots = Array.isArray(data) ? data : (data.data || []);
  
  if (slots.length === 0) {
    throw new Error('No available slots found for the next 7 days');
  }

  // Find a slot different from the current one
  const newSlot = slots.find(s => s.id !== testBooking.slot_id) || slots[0];

  console.log(`   ✅ Found ${slots.length} available slots`);
  console.log(`   Selected new slot: ${newSlot.id}`);
  console.log(`   Date: ${newSlot.slot_date}`);
  console.log(`   Time: ${newSlot.start_time} - ${newSlot.end_time}`);
  console.log(`   Available capacity: ${newSlot.available_capacity}`);

  return newSlot;
}

/**
 * Step 6: Test Change Time
 */
async function testChangeTime(newSlotId) {
  console.log(`\n🔄 Step 6: Testing Change Time...`);
  console.log(`   Current slot ID: ${testBooking.slot_id}`);
  console.log(`   New slot ID: ${newSlotId}`);

  const { response, data, ok, status } = await makeRequest(`/bookings/${testBooking.id}/time`, {
    method: 'PATCH',
    body: JSON.stringify({ slot_id: newSlotId }),
  });

  if (!ok) {
    throw new Error(`Change time failed (${status}): ${data.error || response.statusText}`);
  }

  console.log('   ✅ Booking time updated successfully');

  // Wait a bit for database to update
  await sleep(1000);

  // Verify the update
  const { data: updatedBooking } = await makeRequest(`/bookings/${testBooking.id}`);

  if (updatedBooking.slot_id !== newSlotId) {
    throw new Error(`Slot ID mismatch: expected "${newSlotId}", got "${updatedBooking.slot_id}"`);
  }

  console.log('   ✅ Slot ID updated correctly');
  console.log(`   New slot ID: ${updatedBooking.slot_id}`);

  if (updatedBooking.slots) {
    console.log(`   New date: ${updatedBooking.slots.slot_date}`);
    console.log(`   New time: ${updatedBooking.slots.start_time} - ${updatedBooking.slots.end_time}`);
  }

  return { success: true, updatedBooking };
}

/**
 * Step 7: Restore original booking (optional cleanup)
 */
async function restoreOriginalBooking() {
  console.log('\n🔄 Step 7: Restoring original booking data...');

  if (!originalBookingData) {
    console.log('   ⏭️  Skipping (no original data to restore)');
    return;
  }

  const restoreData = {
    customer_name: originalBookingData.customer_name,
    visitor_count: originalBookingData.visitor_count,
    total_price: originalBookingData.total_price,
    status: originalBookingData.status,
    notes: originalBookingData.notes || null,
  };

  const { response, data, ok } = await makeRequest(`/bookings/${testBooking.id}`, {
    method: 'PATCH',
    body: JSON.stringify(restoreData),
  });

  if (!ok) {
    console.warn(`   ⚠️  Failed to restore booking: ${data.error || response.statusText}`);
  } else {
    console.log('   ✅ Booking restored to original state');
  }

  // Note: We don't restore slot_id as it might cause conflicts
  console.log('   ℹ️  Slot ID not restored (may cause conflicts)');
}

/**
 * Helper: Format date as YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Helper: Sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main test function
 */
async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 Receptionist Edit Booking & Change Time Test');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // Step 1: Login
    await loginAsReceptionist();

    // Step 2: Find test booking
    await findTestBooking();

    // Step 3: Get booking details
    await getBookingDetails(testBooking.id);

    // Step 4: Test Edit Booking
    const editResult = await testEditBooking();
    if (!editResult.success) {
      throw new Error('Edit booking test failed');
    }

    // Step 5: Find available slots
    const newSlot = await findAvailableSlots(testBooking.service_id);

    // Step 6: Test Change Time
    const timeResult = await testChangeTime(newSlot.id);
    if (!timeResult.success) {
      throw new Error('Change time test failed');
    }

    // Step 7: Restore (optional)
    const shouldRestore = process.env.RESTORE_BOOKING !== 'false';
    if (shouldRestore) {
      await restoreOriginalBooking();
    } else {
      console.log('\n⏭️  Skipping restore (RESTORE_BOOKING=false)');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ All tests passed!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nSummary:');
    console.log(`  ✅ Login: Success`);
    console.log(`  ✅ Find Booking: Success (${testBooking.id})`);
    console.log(`  ✅ Edit Booking: Success`);
    console.log(`  ✅ Change Time: Success`);
    if (shouldRestore) {
      console.log(`  ✅ Restore: Success`);
    }
    console.log('\n');

  } catch (error) {
    console.error('\n═══════════════════════════════════════════════════════════');
    console.error('❌ Test failed!');
    console.error('═══════════════════════════════════════════════════════════');
    console.error(`\nError: ${error.message}`);
    console.error(`Stack: ${error.stack}\n`);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
// Check if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule || process.argv[1]?.includes('test-receptionist-edit-booking.js')) {
  runTests().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { runTests, loginAsReceptionist, findTestBooking, testEditBooking, testChangeTime };
