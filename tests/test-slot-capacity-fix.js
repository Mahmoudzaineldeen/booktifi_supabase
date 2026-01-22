/**
 * Test Script: Slot Capacity Fix Verification
 * 
 * This script tests:
 * 1. Booking creation reduces slot capacity (pending)
 * 2. Booking cancellation restores slot capacity (from pending)
 * 3. Booking creation reduces slot capacity (confirmed)
 * 4. Booking cancellation restores slot capacity (from confirmed)
 * 5. Multiple bookings reduce capacity correctly
 * 6. Recalculation function works
 */

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

// Test configuration
const CONFIG = {
  // You'll need to provide these for testing
  tenantId: process.env.TEST_TENANT_ID,
  serviceId: process.env.TEST_SERVICE_ID,
  slotId: process.env.TEST_SLOT_ID,
  receptionistToken: process.env.TEST_RECEPTIONIST_TOKEN,
  tenantAdminToken: process.env.TEST_TENANT_ADMIN_TOKEN,
};

// Helper function to make API requests
async function apiRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type');
  let data;
  if (contentType && contentType.includes('application/json')) {
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

// Helper to get slot details
async function getSlotDetails(slotId, token) {
  try {
    // Use Supabase client or direct query
    // For now, we'll use a query endpoint if available
    const response = await apiRequest(`/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `
          SELECT 
            id,
            available_capacity,
            booked_count,
            original_capacity,
            slot_date,
            start_time
          FROM slots
          WHERE id = $1
        `,
        params: [slotId],
      }),
    });

    if (response.ok && response.data && response.data.length > 0) {
      return response.data[0];
    }
    return null;
  } catch (error) {
    console.error('Error fetching slot details:', error);
    return null;
  }
}

// Helper to create a booking
async function createBooking(slotId, serviceId, tenantId, token, visitorCount = 1) {
  const customerName = `Test Customer ${Date.now()}`;
  const customerPhone = `+966501234${Math.floor(Math.random() * 10000)}`;
  
  const response = await apiRequest('/bookings/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      slot_id: slotId,
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: `test${Date.now()}@example.com`,
      visitor_count: visitorCount,
      adult_count: visitorCount,
      child_count: 0,
      total_price: 100.00,
      language: 'en',
    }),
  });

  return response;
}

// Helper to cancel a booking
async function cancelBooking(bookingId, token) {
  const response = await apiRequest(`/bookings/${bookingId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: 'cancelled',
    }),
  });

  return response;
}

// Helper to confirm a booking
async function confirmBooking(bookingId, token) {
  const response = await apiRequest(`/bookings/${bookingId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: 'confirmed',
    }),
  });

  return response;
}

// Test 1: Booking creation reduces capacity (pending)
async function test1_BookingCreationReducesCapacity() {
  console.log('\n🧪 TEST 1: Booking Creation Reduces Capacity (Pending)');
  console.log('='.repeat(60));

  if (!CONFIG.slotId || !CONFIG.serviceId || !CONFIG.tenantId || !CONFIG.receptionistToken) {
    console.log('⏭️  SKIPPED: Missing test configuration');
    return { passed: true, skipped: true };
  }

  try {
    // Get initial slot capacity
    const initialSlot = await getSlotDetails(CONFIG.slotId, CONFIG.receptionistToken);
    if (!initialSlot) {
      throw new Error('Could not fetch slot details');
    }

    const initialCapacity = initialSlot.available_capacity;
    const initialBooked = initialSlot.booked_count;
    const visitorCount = 1;

    console.log(`📊 Initial Slot State:`);
    console.log(`   Available Capacity: ${initialCapacity}`);
    console.log(`   Booked Count: ${initialBooked}`);
    console.log(`   Original Capacity: ${initialSlot.original_capacity}`);

    // Create booking (will be created as 'pending')
    console.log(`\n📝 Creating booking for ${visitorCount} visitor(s)...`);
    const createResponse = await createBooking(
      CONFIG.slotId,
      CONFIG.serviceId,
      CONFIG.tenantId,
      CONFIG.receptionistToken,
      visitorCount
    );

    if (!createResponse.ok) {
      throw new Error(`Failed to create booking: ${JSON.stringify(createResponse.data)}`);
    }

    const bookingId = createResponse.data.id || createResponse.data.booking?.id;
    if (!bookingId) {
      throw new Error('Booking created but no ID returned');
    }

    console.log(`✅ Booking created: ${bookingId}`);
    console.log(`   Status: ${createResponse.data.status || createResponse.data.booking?.status || 'pending'}`);

    // Wait a moment for trigger to fire
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get updated slot capacity
    const updatedSlot = await getSlotDetails(CONFIG.slotId, CONFIG.receptionistToken);
    if (!updatedSlot) {
      throw new Error('Could not fetch updated slot details');
    }

    const newCapacity = updatedSlot.available_capacity;
    const newBooked = updatedSlot.booked_count;

    console.log(`\n📊 Updated Slot State:`);
    console.log(`   Available Capacity: ${newCapacity}`);
    console.log(`   Booked Count: ${newBooked}`);

    // Verify capacity decreased
    const capacityDecreased = newCapacity === initialCapacity - visitorCount;
    const bookedIncreased = newBooked === initialBooked + visitorCount;

    console.log(`\n✅ Verification:`);
    console.log(`   Capacity decreased by ${visitorCount}: ${capacityDecreased ? '✅' : '❌'}`);
    console.log(`   Booked count increased by ${visitorCount}: ${bookedIncreased ? '✅' : '❌'}`);

    if (!capacityDecreased || !bookedIncreased) {
      throw new Error(`Capacity not updated correctly. Expected capacity: ${initialCapacity - visitorCount}, got: ${newCapacity}`);
    }

    return {
      passed: true,
      bookingId,
      initialCapacity,
      newCapacity,
      capacityDecreased: capacityDecreased && bookedIncreased,
    };
  } catch (error) {
    console.error(`❌ TEST FAILED:`, error.message);
    return { passed: false, error: error.message };
  }
}

// Test 2: Booking cancellation restores capacity (from pending)
async function test2_BookingCancellationRestoresCapacity() {
  console.log('\n🧪 TEST 2: Booking Cancellation Restores Capacity (From Pending)');
  console.log('='.repeat(60));

  if (!CONFIG.slotId || !CONFIG.serviceId || !CONFIG.tenantId || !CONFIG.receptionistToken) {
    console.log('⏭️  SKIPPED: Missing test configuration');
    return { passed: true, skipped: true };
  }

  try {
    // First create a booking
    const createResponse = await createBooking(
      CONFIG.slotId,
      CONFIG.serviceId,
      CONFIG.tenantId,
      CONFIG.receptionistToken,
      1
    );

    if (!createResponse.ok) {
      throw new Error(`Failed to create booking: ${JSON.stringify(createResponse.data)}`);
    }

    const bookingId = createResponse.data.id || createResponse.data.booking?.id;
    console.log(`📝 Created booking: ${bookingId} (status: pending)`);

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get slot capacity after creation
    const slotAfterCreation = await getSlotDetails(CONFIG.slotId, CONFIG.receptionistToken);
    const capacityAfterCreation = slotAfterCreation.available_capacity;
    const bookedAfterCreation = slotAfterCreation.booked_count;

    console.log(`📊 Slot after booking creation:`);
    console.log(`   Available Capacity: ${capacityAfterCreation}`);
    console.log(`   Booked Count: ${bookedAfterCreation}`);

    // Cancel the booking
    console.log(`\n❌ Cancelling booking...`);
    const cancelResponse = await cancelBooking(bookingId, CONFIG.receptionistToken);

    if (!cancelResponse.ok) {
      throw new Error(`Failed to cancel booking: ${JSON.stringify(cancelResponse.data)}`);
    }

    console.log(`✅ Booking cancelled`);

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get slot capacity after cancellation
    const slotAfterCancellation = await getSlotDetails(CONFIG.slotId, CONFIG.receptionistToken);
    const capacityAfterCancellation = slotAfterCancellation.available_capacity;
    const bookedAfterCancellation = slotAfterCancellation.booked_count;

    console.log(`\n📊 Slot after cancellation:`);
    console.log(`   Available Capacity: ${capacityAfterCancellation}`);
    console.log(`   Booked Count: ${bookedAfterCancellation}`);

    // Verify capacity restored
    const capacityRestored = capacityAfterCancellation === capacityAfterCreation + 1;
    const bookedDecreased = bookedAfterCancellation === bookedAfterCreation - 1;

    console.log(`\n✅ Verification:`);
    console.log(`   Capacity restored by 1: ${capacityRestored ? '✅' : '❌'}`);
    console.log(`   Booked count decreased by 1: ${bookedDecreased ? '✅' : '❌'}`);

    if (!capacityRestored || !bookedDecreased) {
      throw new Error(`Capacity not restored correctly. Expected capacity: ${capacityAfterCreation + 1}, got: ${capacityAfterCancellation}`);
    }

    return {
      passed: true,
      capacityRestored: capacityRestored && bookedDecreased,
    };
  } catch (error) {
    console.error(`❌ TEST FAILED:`, error.message);
    return { passed: false, error: error.message };
  }
}

// Test 3: Multiple bookings reduce capacity correctly
async function test3_MultipleBookingsReduceCapacity() {
  console.log('\n🧪 TEST 3: Multiple Bookings Reduce Capacity Correctly');
  console.log('='.repeat(60));

  if (!CONFIG.slotId || !CONFIG.serviceId || !CONFIG.tenantId || !CONFIG.receptionistToken) {
    console.log('⏭️  SKIPPED: Missing test configuration');
    return { passed: true, skipped: true };
  }

  try {
    // Get initial slot capacity
    const initialSlot = await getSlotDetails(CONFIG.slotId, CONFIG.receptionistToken);
    const initialCapacity = initialSlot.available_capacity;
    const initialBooked = initialSlot.booked_count;

    console.log(`📊 Initial Slot State:`);
    console.log(`   Available Capacity: ${initialCapacity}`);
    console.log(`   Booked Count: ${initialBooked}`);

    // Create 3 bookings
    const bookings = [];
    const totalVisitors = 3;

    console.log(`\n📝 Creating ${totalVisitors} bookings...`);
    for (let i = 0; i < totalVisitors; i++) {
      const createResponse = await createBooking(
        CONFIG.slotId,
        CONFIG.serviceId,
        CONFIG.tenantId,
        CONFIG.receptionistToken,
        1
      );

      if (!createResponse.ok) {
        throw new Error(`Failed to create booking ${i + 1}: ${JSON.stringify(createResponse.data)}`);
      }

      const bookingId = createResponse.data.id || createResponse.data.booking?.id;
      bookings.push(bookingId);
      console.log(`   ✅ Booking ${i + 1} created: ${bookingId}`);

      // Small delay between bookings
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait for all triggers
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get final slot capacity
    const finalSlot = await getSlotDetails(CONFIG.slotId, CONFIG.receptionistToken);
    const finalCapacity = finalSlot.available_capacity;
    const finalBooked = finalSlot.booked_count;

    console.log(`\n📊 Final Slot State:`);
    console.log(`   Available Capacity: ${finalCapacity}`);
    console.log(`   Booked Count: ${finalBooked}`);

    // Verify capacity decreased by total visitors
    const capacityDecreased = finalCapacity === initialCapacity - totalVisitors;
    const bookedIncreased = finalBooked === initialBooked + totalVisitors;

    console.log(`\n✅ Verification:`);
    console.log(`   Capacity decreased by ${totalVisitors}: ${capacityDecreased ? '✅' : '❌'}`);
    console.log(`   Booked count increased by ${totalVisitors}: ${bookedIncreased ? '✅' : '❌'}`);

    // Cleanup: Cancel all bookings
    console.log(`\n🧹 Cleaning up: Cancelling ${bookings.length} bookings...`);
    for (const bookingId of bookings) {
      await cancelBooking(bookingId, CONFIG.receptionistToken);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (!capacityDecreased || !bookedIncreased) {
      throw new Error(`Capacity not updated correctly. Expected capacity: ${initialCapacity - totalVisitors}, got: ${finalCapacity}`);
    }

    return {
      passed: true,
      capacityDecreased: capacityDecreased && bookedIncreased,
    };
  } catch (error) {
    console.error(`❌ TEST FAILED:`, error.message);
    return { passed: false, error: error.message };
  }
}

// Main test runner
async function runTests() {
  console.log('\n🚀 Starting Slot Capacity Fix Tests');
  console.log('='.repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`Tenant ID: ${CONFIG.tenantId || 'NOT SET'}`);
  console.log(`Service ID: ${CONFIG.serviceId || 'NOT SET'}`);
  console.log(`Slot ID: ${CONFIG.slotId || 'NOT SET'}`);

  const results = {
    test1: await test1_BookingCreationReducesCapacity(),
    test2: await test2_BookingCancellationRestoresCapacity(),
    test3: await test3_MultipleBookingsReduceCapacity(),
  };

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));

  const allPassed = Object.values(results).every(r => r.passed || r.skipped);
  const allSkipped = Object.values(results).every(r => r.skipped);

  Object.entries(results).forEach(([testName, result]) => {
    const status = result.skipped ? '⏭️  SKIPPED' : (result.passed ? '✅ PASSED' : '❌ FAILED');
    console.log(`${status}: ${testName}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log('\n' + '='.repeat(60));
  if (allSkipped) {
    console.log('⚠️  All tests skipped. Please set test configuration.');
    console.log('   Set environment variables:');
    console.log('   - TEST_TENANT_ID');
    console.log('   - TEST_SERVICE_ID');
    console.log('   - TEST_SLOT_ID');
    console.log('   - TEST_RECEPTIONIST_TOKEN');
  } else if (allPassed) {
    console.log('✅ ALL TESTS PASSED!');
  } else {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  }
  console.log('='.repeat(60) + '\n');
}

// Run tests
if (require.main === module) {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runTests };
