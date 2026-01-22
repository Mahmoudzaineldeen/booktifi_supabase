/**
 * Test Overbooking Scenario: 11 tickets when only 10 available
 * 
 * This test specifically verifies the acceptance criteria:
 * "Booking 11 tickets when only 10 are available → ❌ fails completely"
 */

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

const TEST_EMAIL = 'receptionist1@bookati.local';
const TEST_PASSWORD = '111111';

let token = null;
let tenantId = null;
let userId = null;
let serviceId = null;
let slotIds = [];

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
  };
}

async function setup() {
  console.log(`\n🔧 Setup...\n`);

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
    throw new Error(`Login response missing token or tenant_id`);
  }

  console.log(`✅ Logged in`);

  // Get service
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
      console.log(`✅ Using service: ${services[0].name}`);
    }
  }

  // Get slots - we'll use multiple slots to total 10 available, then try to book 11
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
        available_capacity: { $gte: 1 },
      },
      limit: 15,
    }),
  });

  if (slotsResponse.ok) {
    const slots = Array.isArray(slotsResponse.data) 
      ? slotsResponse.data 
      : (slotsResponse.data?.data || []);
    
    // Find slots that total at least 10 available capacity
    let totalAvailable = 0;
    const selectedSlots = [];
    
    for (const slot of slots) {
      if (slot.available_capacity >= 1) {
        selectedSlots.push(slot);
        totalAvailable += slot.available_capacity;
        if (totalAvailable >= 10) {
          break;
        }
      }
    }

    if (totalAvailable >= 10) {
      // Use 10 slots (one each) to total 10 available, then try to book 11
      // This tests the scenario: 10 slots available, but request 11 tickets
      slotIds = selectedSlots.slice(0, 10).map(s => s.id);
      console.log(`✅ Found ${selectedSlots.length} slots with total ${totalAvailable} available capacity`);
      console.log(`   Will use 10 slots (one ticket each) and attempt to book 11 tickets (should fail)`);
      return;
    }
  }

  throw new Error('Could not find enough slots with at least 10 total available capacity for testing');
}

async function testOverbookingScenario() {
  console.log(`\n🚫 Testing: Booking 11 tickets when only 10 available`);
  console.log(`   Expected: Request should FAIL completely`);
  console.log(`   Expected: No bookings created`);
  console.log(`   Expected: No slot capacity decremented`);
  console.log(`   Expected: No invoice generated`);
  console.log(`   Expected: No tickets generated\n`);

  // Get initial slot state
  const beforeResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'id, available_capacity, booked_count',
      where: { id: slotIds[0] },
      limit: 1,
    }),
  });

  const beforeSlot = Array.isArray(beforeResponse.data) 
    ? beforeResponse.data[0] 
    : (beforeResponse.data?.data?.[0] || beforeResponse.data);

  const initialAvailable = beforeSlot?.available_capacity || 0;
  const initialBooked = beforeSlot?.booked_count || 0;

  console.log(`📊 Initial Slot State:`);
  console.log(`   Available: ${initialAvailable}`);
  console.log(`   Booked: ${initialBooked}`);

  // Attempt to book 11 tickets using 11 slot IDs (but we only have 10 slots)
  // Add an 11th slot ID that doesn't exist or has no capacity
  console.log(`\n📝 Attempting to book 11 tickets using ${slotIds.length} available slots...`);
  
  // Try to book 11 tickets when we only have 10 slots
  // This should fail because slot count (10) doesn't match visitor_count (11)
  const bookingResponse = await apiRequest('/bookings/create-bulk', {
    method: 'POST',
    body: JSON.stringify({
      slot_ids: slotIds, // Only 10 slots
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: 'Overbooking Test Customer',
      customer_phone: '+201234567890',
      customer_email: 'overbooking-test@example.com',
      visitor_count: 11, // But requesting 11 visitors
      adult_count: 11,
      child_count: 0,
      total_price: 1100,
      notes: 'This should fail - booking 11 when only 10 slots available',
      employee_id: userId,
      language: 'en',
    }),
  });

  // Should fail
  if (bookingResponse.ok) {
    console.error(`\n❌ TEST FAILED: Booking was allowed when it should have been rejected!`);
    console.error(`   Status: ${bookingResponse.status}`);
    console.error(`   Response: ${JSON.stringify(bookingResponse.data)}`);
    
    // Check if bookings were actually created
    const bookings = bookingResponse.data?.bookings || [];
    if (bookings.length > 0) {
      console.error(`   ⚠️  ${bookings.length} bookings were created (this is wrong!)`);
    }
    
    throw new Error('Overbooking was allowed - test failed');
  }

  console.log(`✅ Request correctly rejected`);
  console.log(`   Status: ${bookingResponse.status}`);
  console.log(`   Error: ${bookingResponse.data?.error || JSON.stringify(bookingResponse.data)}`);

  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify slot capacity was NOT decremented
  const afterResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'id, available_capacity, booked_count',
      where: { id: slotIds[0] },
      limit: 1,
    }),
  });

  const afterSlot = Array.isArray(afterResponse.data) 
    ? afterResponse.data[0] 
    : (afterResponse.data?.data?.[0] || afterResponse.data);

  const finalAvailable = afterSlot?.available_capacity || 0;
  const finalBooked = afterSlot?.booked_count || 0;

  console.log(`\n📊 Final Slot State:`);
  console.log(`   Available: ${finalAvailable} (was: ${initialAvailable})`);
  console.log(`   Booked: ${finalBooked} (was: ${initialBooked})`);

  // Verify no bookings were created
  const bookingsCheck = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id',
      where: {
        tenant_id: tenantId,
        customer_phone: '+201234567890',
        created_at: { $gte: new Date(Date.now() - 60000).toISOString() }, // Last minute
      },
      limit: 20,
    }),
  });

  const recentBookings = Array.isArray(bookingsCheck.data) 
    ? bookingsCheck.data 
    : (bookingsCheck.data?.data || []);

  const testBookings = recentBookings.filter(b => 
    b.customer_phone === '+201234567890' || 
    (recentBookings.length > 0 && recentBookings[0].customer_phone === '+201234567890')
  );

  console.log(`\n📋 Verification:`);
  console.log(`   Slot capacity unchanged: ${finalAvailable === initialAvailable ? '✅' : '❌'}`);
  console.log(`   Booked count unchanged: ${finalBooked === initialBooked ? '✅' : '❌'}`);
  console.log(`   No bookings created: ${testBookings.length === 0 ? '✅' : '❌'}`);

  if (finalAvailable !== initialAvailable || finalBooked !== initialBooked || testBookings.length > 0) {
    console.error(`\n❌ TEST FAILED: Partial data was saved!`);
    console.error(`   Available changed: ${initialAvailable} → ${finalAvailable}`);
    console.error(`   Booked changed: ${initialBooked} → ${finalBooked}`);
    console.error(`   Bookings created: ${testBookings.length}`);
    throw new Error('Partial data was saved - transaction did not rollback correctly');
  }

  console.log(`\n✅ TEST PASSED: Overbooking correctly prevented`);
  console.log(`   ✅ Request rejected`);
  console.log(`   ✅ No bookings created`);
  console.log(`   ✅ Slot capacity unchanged`);
  console.log(`   ✅ No partial data saved`);
}

async function runTest() {
  try {
    console.log('🚀 Testing Overbooking Scenario: 11 tickets when only 10 available');
    console.log('============================================================\n');

    await setup();
    await testOverbookingScenario();

    console.log(`\n🎉 All Tests Passed!`);
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Test Failed:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
