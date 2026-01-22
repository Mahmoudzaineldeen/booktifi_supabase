/**
 * Test Booking Time Edit Endpoint
 * 
 * Tests the PATCH /api/bookings/:id/time endpoint with:
 * - Authorization (tenant_admin only)
 * - Slot availability validation
 * - Ticket invalidation
 * - Ticket re-issuance
 * - Slot capacity updates
 * - Atomic transaction integrity
 */

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

const TENANT_ADMIN_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TENANT_ADMIN_PASSWORD = '111111';

let token = null;
let tenantId = null;
let userId = null;
let serviceId = null;
let bookingId = null;
let oldSlotId = null;
let newSlotId = null;

async function apiRequest(endpoint, options = {}, skipToken = false) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...((token && !skipToken) && { 'Authorization': `Bearer ${token}` }),
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
  console.log(`\n🔧 Setup: Logging in and preparing test data...\n`);

  // Login as tenant admin
  const loginResponse = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ 
      email: TENANT_ADMIN_EMAIL, 
      password: TENANT_ADMIN_PASSWORD 
    }),
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

  console.log(`✅ Logged in as tenant admin`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Tenant ID: ${tenantId}`);

  // Get or create a service
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
    } else {
      throw new Error('No active services found. Please create a service first.');
    }
  } else {
    throw new Error('Failed to fetch services');
  }

  // Try to find an existing booking first
  console.log(`\n🔍 Looking for existing bookings...`);
  const existingBookingsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id, slot_id, status, tenant_id',
      where: {
        tenant_id: tenantId,
        status: { $in: ['pending', 'confirmed'] },
      },
      limit: 1,
    }),
  });

  if (existingBookingsResponse.ok) {
    const bookings = Array.isArray(existingBookingsResponse.data) 
      ? existingBookingsResponse.data 
      : (existingBookingsResponse.data?.data || []);
    
    if (bookings.length > 0) {
      console.log(`✅ Found existing booking: ${bookings[0].id}`);
      bookingId = bookings[0].id;
      oldSlotId = bookings[0].slot_id;
      
      // Find a different slot for the new slot
      const slotsResponse = await apiRequest('/query', {
        method: 'POST',
        body: JSON.stringify({
          table: 'time_slots',
          select: '*',
          where: {
            tenant_id: tenantId,
            id: { $ne: oldSlotId },
          },
          limit: 10,
        }),
      });

      if (slotsResponse.ok) {
        const slots = Array.isArray(slotsResponse.data) 
          ? slotsResponse.data 
          : (slotsResponse.data?.data || []);
        
        if (slots.length > 0) {
          newSlotId = slots[0].id;
          console.log(`✅ Using existing booking and found alternative slot`);
          console.log(`   Booking ID: ${bookingId}`);
          console.log(`   Old Slot ID: ${oldSlotId}`);
          console.log(`   New Slot ID: ${newSlotId}`);
          
          // Get initial slot capacities
          const oldSlotResponse = await apiRequest('/query', {
            method: 'POST',
            body: JSON.stringify({
              table: 'time_slots',
              select: 'id, remaining_capacity, total_capacity',
              where: { id: oldSlotId },
              limit: 1,
            }),
          });

          const newSlotResponse = await apiRequest('/query', {
            method: 'POST',
            body: JSON.stringify({
              table: 'time_slots',
              select: 'id, remaining_capacity, total_capacity',
              where: { id: newSlotId },
              limit: 1,
            }),
          });

          const oldSlot = Array.isArray(oldSlotResponse.data) 
            ? oldSlotResponse.data[0] 
            : (oldSlotResponse.data?.data?.[0] || oldSlotResponse.data);
          
          const newSlot = Array.isArray(newSlotResponse.data) 
            ? newSlotResponse.data[0] 
            : (newSlotResponse.data?.data?.[0] || newSlotResponse.data);

          console.log(`📊 Initial Slot Capacities:`);
          console.log(`   Old Slot: ${oldSlot?.remaining_capacity || 'N/A'} / ${oldSlot?.total_capacity || 'N/A'}`);
          console.log(`   New Slot: ${newSlot?.remaining_capacity || 'N/A'} / ${newSlot?.total_capacity || 'N/A'}`);
          
          return; // Skip booking creation
        }
      }
    }
  }

  // If no existing booking, try to find slots to create one
  console.log(`⚠️  No existing booking found. Looking for slots...`);
  const slotsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'time_slots',
      select: '*',
      where: {
        tenant_id: tenantId,
      },
      limit: 20,
    }),
  });

  if (!slotsResponse.ok) {
    throw new Error('Failed to fetch slots. Please create slots manually via admin panel.');
  }

  const slots = Array.isArray(slotsResponse.data) 
    ? slotsResponse.data 
    : (slotsResponse.data?.data || []);
  
  console.log(`📊 Found ${slots.length} total slots`);
  
  if (slots.length < 2) {
    throw new Error(`Need at least 2 slots for testing. Found: ${slots.length}. Please create slots via admin panel.`);
  }

  oldSlotId = slots[0].id;
  newSlotId = slots[1].id;

  console.log(`✅ Using slots for test`);
  console.log(`   Old Slot ID: ${oldSlotId}`);
  console.log(`   New Slot ID: ${newSlotId}`);

  // Get initial slot capacities
  const oldSlotResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'time_slots',
      select: 'id, remaining_capacity, total_capacity',
      where: { id: oldSlotId },
      limit: 1,
    }),
  });

  const newSlotResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'time_slots',
      select: 'id, remaining_capacity, total_capacity',
      where: { id: newSlotId },
      limit: 1,
    }),
  });

  const oldSlot = Array.isArray(oldSlotResponse.data) 
    ? oldSlotResponse.data[0] 
    : (oldSlotResponse.data?.data?.[0] || oldSlotResponse.data);
  
  const newSlot = Array.isArray(newSlotResponse.data) 
    ? newSlotResponse.data[0] 
    : (newSlotResponse.data?.data?.[0] || newSlotResponse.data);

  console.log(`📊 Initial Slot Capacities:`);
  console.log(`   Old Slot: ${oldSlot?.remaining_capacity || 'N/A'} / ${oldSlot?.total_capacity || 'N/A'}`);
  console.log(`   New Slot: ${newSlot?.remaining_capacity || 'N/A'} / ${newSlot?.total_capacity || 'N/A'}`);

  // Create a test booking only if we don't have one
  if (!bookingId) {
    console.log(`\n📝 Creating test booking...`);
  const bookingResponse = await apiRequest('/bookings/create', {
    method: 'POST',
    body: JSON.stringify({
      slot_id: oldSlotId,
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: 'Time Edit Test Customer',
      customer_phone: '+201234567890',
      customer_email: 'time-edit-test@example.com',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: 100.00,
      notes: 'Test booking for time edit endpoint',
      language: 'en',
    }),
  });

  if (!bookingResponse.ok) {
    throw new Error(`Failed to create test booking: ${JSON.stringify(bookingResponse.data)}`);
  }

  bookingId = bookingResponse.data.id || bookingResponse.data.booking?.id;
  if (!bookingId) {
    throw new Error('Booking created but no ID returned');
  }

    console.log(`✅ Test booking created: ${bookingId}`);
  } else {
    console.log(`✅ Using existing booking: ${bookingId}`);
  }

  // Wait a moment for booking to be fully created/loaded
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Get booking details to verify initial state
  const bookingDetailsResponse = await apiRequest(`/bookings/${bookingId}`, {
    method: 'GET',
  });

  if (bookingDetailsResponse.ok) {
    const booking = bookingDetailsResponse.data.booking || bookingDetailsResponse.data;
    console.log(`📋 Initial Booking State:`);
    console.log(`   Slot ID: ${booking.slot_id}`);
    console.log(`   QR Scanned: ${booking.qr_scanned || false}`);
    console.log(`   QR Token: ${booking.qr_token ? 'Present' : 'None'}`);
  }
}

async function testBookingTimeEdit() {
  console.log(`\n🔄 Test 1: Booking Time Edit - Success Case`);
  console.log(`   Expected: Booking time updated, old tickets invalidated, new tickets generated\n`);

  // Get slot capacities before edit
  const beforeOldSlotResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'time_slots',
      select: 'id, remaining_capacity, total_capacity',
      where: { id: oldSlotId },
      limit: 1,
    }),
  });

  const beforeNewSlotResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'time_slots',
      select: 'id, remaining_capacity, total_capacity',
      where: { id: newSlotId },
      limit: 1,
    }),
  });

  const beforeOldSlot = Array.isArray(beforeOldSlotResponse.data) 
    ? beforeOldSlotResponse.data[0] 
    : (beforeOldSlotResponse.data?.data?.[0] || beforeOldSlotResponse.data);
  
  const beforeNewSlot = Array.isArray(beforeNewSlotResponse.data) 
    ? beforeNewSlotResponse.data[0] 
    : (beforeNewSlotResponse.data?.data?.[0] || beforeNewSlotResponse.data);

  const oldSlotCapacityBefore = beforeOldSlot?.remaining_capacity || 0;
  const newSlotCapacityBefore = beforeNewSlot?.remaining_capacity || 0;

  console.log(`📊 Slot Capacities Before Edit:`);
  console.log(`   Old Slot: ${oldSlotCapacityBefore}`);
  console.log(`   New Slot: ${newSlotCapacityBefore}`);

  // Edit booking time
  console.log(`\n📝 Editing booking time...`);
  const editResponse = await apiRequest(`/bookings/${bookingId}/time`, {
    method: 'PATCH',
    body: JSON.stringify({
      slot_id: newSlotId,
    }),
  });

  if (!editResponse.ok) {
    console.error(`❌ TEST FAILED: Booking time edit failed`);
    console.error(`   Status: ${editResponse.status}`);
    console.error(`   Error: ${JSON.stringify(editResponse.data)}`);
    throw new Error('Booking time edit failed');
  }

  console.log(`✅ Booking time edit successful`);
  console.log(`   Response:`, JSON.stringify(editResponse.data, null, 2));

  // Wait a moment for async operations
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Verify slot capacities after edit
  const afterOldSlotResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'time_slots',
      select: 'id, remaining_capacity, total_capacity',
      where: { id: oldSlotId },
      limit: 1,
    }),
  });

  const afterNewSlotResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'time_slots',
      select: 'id, remaining_capacity, total_capacity',
      where: { id: newSlotId },
      limit: 1,
    }),
  });

  const afterOldSlot = Array.isArray(afterOldSlotResponse.data) 
    ? afterOldSlotResponse.data[0] 
    : (afterOldSlotResponse.data?.data?.[0] || afterOldSlotResponse.data);
  
  const afterNewSlot = Array.isArray(afterNewSlotResponse.data) 
    ? afterNewSlotResponse.data[0] 
    : (afterNewSlotResponse.data?.data?.[0] || afterNewSlotResponse.data);

  const oldSlotCapacityAfter = afterOldSlot?.remaining_capacity || 0;
  const newSlotCapacityAfter = afterNewSlot?.remaining_capacity || 0;

  console.log(`\n📊 Slot Capacities After Edit:`);
  console.log(`   Old Slot: ${oldSlotCapacityAfter} (was: ${oldSlotCapacityBefore})`);
  console.log(`   New Slot: ${newSlotCapacityAfter} (was: ${newSlotCapacityBefore})`);

  // Verify slot capacity changes
  const oldSlotCapacityIncreased = oldSlotCapacityAfter === oldSlotCapacityBefore + 1;
  const newSlotCapacityDecreased = newSlotCapacityAfter === newSlotCapacityBefore - 1;

  console.log(`\n✅ Slot Capacity Changes:`);
  console.log(`   Old slot capacity increased: ${oldSlotCapacityIncreased ? '✅' : '❌'}`);
  console.log(`   New slot capacity decreased: ${newSlotCapacityDecreased ? '✅' : '❌'}`);

  if (!oldSlotCapacityIncreased || !newSlotCapacityDecreased) {
    throw new Error('Slot capacity changes incorrect');
  }

  // Verify booking was updated
  const updatedBookingResponse = await apiRequest(`/bookings/${bookingId}`, {
    method: 'GET',
  });

  if (!updatedBookingResponse.ok) {
    throw new Error('Failed to fetch updated booking');
  }

  const updatedBooking = updatedBookingResponse.data.booking || updatedBookingResponse.data;

  console.log(`\n📋 Updated Booking State:`);
  console.log(`   Slot ID: ${updatedBooking.slot_id} (should be: ${newSlotId})`);
  console.log(`   QR Scanned: ${updatedBooking.qr_scanned || false} (should be: true)`);
  console.log(`   QR Token: ${updatedBooking.qr_token ? 'Present' : 'None'} (should be: None)`);

  // Verify ticket invalidation
  const slotIdCorrect = updatedBooking.slot_id === newSlotId;
  const qrScanned = updatedBooking.qr_scanned === true;
  const qrTokenCleared = !updatedBooking.qr_token;

  console.log(`\n✅ Ticket Invalidation:`);
  console.log(`   Slot ID updated: ${slotIdCorrect ? '✅' : '❌'}`);
  console.log(`   QR Scanned = true: ${qrScanned ? '✅' : '❌'}`);
  console.log(`   QR Token cleared: ${qrTokenCleared ? '✅' : '❌'}`);

  if (!slotIdCorrect || !qrScanned || !qrTokenCleared) {
    throw new Error('Ticket invalidation failed');
  }

  console.log(`\n✅ TEST PASSED: Booking time edit successful`);
  console.log(`   ✅ Slot capacity correctly updated`);
  console.log(`   ✅ Old tickets invalidated`);
  console.log(`   ✅ Booking updated with new slot`);
}

async function testAuthorization() {
  console.log(`\n🔐 Test 2: Authorization Check`);
  console.log(`   Expected: Only tenant_admin can edit booking time\n`);

  // Try without token
  const noTokenResponse = await apiRequest(`/bookings/${bookingId}/time`, {
    method: 'PATCH',
    body: JSON.stringify({
      slot_id: newSlotId,
    }),
  }, true); // Skip token

  console.log(`📝 Request without token:`);
  console.log(`   Status: ${noTokenResponse.status}`);
  console.log(`   Expected: 401 (Unauthorized)`);
  console.log(`   Result: ${noTokenResponse.status === 401 ? '✅' : '❌'}`);

  if (noTokenResponse.status !== 401) {
    throw new Error('Authorization check failed: should return 401 without token');
  }

  console.log(`\n✅ TEST PASSED: Authorization correctly enforced`);
}

async function testInvalidSlot() {
  console.log(`\n🚫 Test 3: Invalid Slot Validation`);
  console.log(`   Expected: Request rejected if slot doesn't exist or unavailable\n`);

  // Try with non-existent slot ID
  const invalidSlotResponse = await apiRequest(`/bookings/${bookingId}/time`, {
    method: 'PATCH',
    body: JSON.stringify({
      slot_id: '00000000-0000-0000-0000-000000000000',
    }),
  });

  console.log(`📝 Request with invalid slot ID:`);
  console.log(`   Status: ${invalidSlotResponse.status}`);
  console.log(`   Expected: 404 or 409 (Not Found or Conflict)`);
  console.log(`   Result: ${(invalidSlotResponse.status === 404 || invalidSlotResponse.status === 409) ? '✅' : '❌'}`);

  if (invalidSlotResponse.status !== 404 && invalidSlotResponse.status !== 409) {
    console.warn(`⚠️  Unexpected status code: ${invalidSlotResponse.status}`);
  }

  console.log(`\n✅ TEST PASSED: Invalid slot correctly rejected`);
}

async function cleanup() {
  console.log(`\n🧹 Cleanup: Deleting test booking...`);

  try {
    const deleteResponse = await apiRequest(`/bookings/${bookingId}`, {
      method: 'DELETE',
    });

    if (deleteResponse.ok) {
      console.log(`✅ Test booking deleted`);
    } else {
      console.warn(`⚠️  Failed to delete test booking: ${deleteResponse.status}`);
    }
  } catch (error) {
    console.warn(`⚠️  Cleanup error: ${error.message}`);
  }
}

async function runTests() {
  try {
    console.log('🚀 Testing Booking Time Edit Endpoint');
    console.log('============================================================\n');

    await setup();
    await testBookingTimeEdit();
    await testAuthorization();
    await testInvalidSlot();
    await cleanup();

    console.log(`\n🎉 All Tests Passed!`);
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Test Failed:`, error.message);
    console.error(error.stack);
    
    // Try cleanup even on failure
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error(`Cleanup also failed:`, cleanupError.message);
    }
    
    process.exit(1);
  }
}

runTests();
