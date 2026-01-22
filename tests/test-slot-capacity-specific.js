/**
 * Specific Slot Capacity Test
 * Tests booking creation and cancellation with receptionist1@bookati.local
 */

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

const TEST_ACCOUNT = {
  email: 'receptionist1@bookati.local',
  password: '111111',
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

// Login
async function login(email, password) {
  console.log(`🔐 Logging in as ${email}...`);
  const response = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${JSON.stringify(response.data)}`);
  }

  const token = response.data.session?.access_token || response.data.token;
  const tenantId = response.data.tenant?.id || response.data.user?.tenant_id;
  const userId = response.data.user?.id;

  console.log(`✅ Logged in successfully`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Tenant ID: ${tenantId}\n`);

  return { token, tenantId, userId, loginData: response.data };
}

// Get slot details
async function getSlotDetails(slotId, token) {
  const response = await apiRequest(`/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      table: 'slots',
      select: '*',
      where: { id: slotId },
      limit: 1,
    }),
  });

  if (!response.ok) {
    console.error('Failed to fetch slot details:', response.status, response.data);
    return null;
  }

  // Response can be array directly or wrapped in data property
  const slotData = Array.isArray(response.data) ? response.data[0] : (response.data?.data?.[0] || response.data);
  if (!slotData) {
    console.error('No slot data in response:', response.data);
    return null;
  }

  return slotData;
}

// Find available slot for tomorrow
async function findTomorrowSlot(token, tenantId) {
  console.log('🔍 Finding available slot for tomorrow...\n');

  // Get tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`   Looking for slots on: ${tomorrowStr}`);

  // Get services for this tenant (try active first, then any)
  let servicesResponse = await apiRequest(`/query?table=services&select=id,name,is_active&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId, is_active: true }))}&limit=10`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  let services = servicesResponse.data?.data || [];

  // If no active services, try any services
  if (services.length === 0) {
    console.log('   No active services found, checking for any services...');
    servicesResponse = await apiRequest(`/query?table=services&select=id,name,is_active&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId }))}&limit=10`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    services = servicesResponse.data?.data || [];
  }

  if (services.length === 0) {
    console.log('   ⚠️  No services found. Creating a test service...');
    
    // Create a test service using the insert endpoint
    const createServiceResponse = await apiRequest(`/insert/services`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        data: {
          tenant_id: tenantId,
          name: 'Test Service',
          name_ar: 'خدمة اختبار',
          base_price: 100.00,
          duration_minutes: 60,
          service_duration_minutes: 60,
          capacity_per_slot: 10,
          is_active: true,
          is_public: true,
        },
        returning: 'id,name',
      }),
    });

    if (!createServiceResponse.ok) {
      console.error('Service creation response:', createServiceResponse.status, createServiceResponse.data);
      throw new Error(`Failed to create service: ${JSON.stringify(createServiceResponse.data)}`);
    }

    const newService = createServiceResponse.data?.data?.[0] || createServiceResponse.data?.id ? createServiceResponse.data : null;
    if (!newService || !newService.id) {
      console.error('Unexpected service creation response:', createServiceResponse.data);
      throw new Error('Service created but response format unexpected');
    }
    console.log(`   ✅ Created test service: ${newService.name || 'Test Service'} (${newService.id.substring(0, 8)}...)\n`);
    services = [{ id: newService.id, name: newService.name || 'Test Service' }];
  }

  console.log(`   Found ${services.length} service(s)`);
  if (services.some(s => !s.is_active)) {
    console.log('   ⚠️  Some services are inactive');
  }

  // Try to find a slot for tomorrow
  for (const service of services) {
    console.log(`   Checking service: ${service.name} (${service.id.substring(0, 8)}...)`);

    // Try to find slots for this service
    const slotsResponse = await apiRequest(`/query?table=slots&select=*&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId, slot_date: tomorrowStr, is_available: true }))}&limit=20`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (slotsResponse.ok && slotsResponse.data?.data?.length) {
      // Filter slots with available capacity
      const availableSlots = slotsResponse.data.data.filter(s => s.available_capacity > 0);
      
      if (availableSlots.length > 0) {
        const slot = availableSlots[0];
        console.log(`   ✅ Found available slot:`);
        console.log(`      Slot ID: ${slot.id}`);
        console.log(`      Date: ${slot.slot_date}`);
        console.log(`      Time: ${slot.start_time} - ${slot.end_time}`);
        console.log(`      Available Capacity: ${slot.available_capacity}`);
        console.log(`      Booked Count: ${slot.booked_count}`);
        console.log(`      Original Capacity: ${slot.original_capacity}\n`);
        return { service, slot };
      } else {
        console.log(`   ⚠️  Service has slots but all are fully booked`);
      }
    } else {
      console.log(`   ⚠️  No slots found for tomorrow`);
    }
  }

  // If no slots for tomorrow, try any future date
  console.log(`\n   ⚠️  No slots for tomorrow, searching for any future date...`);
  
  const futureSlotsResponse = await apiRequest(`/query?table=slots&select=*&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId, is_available: true }))}&order=slot_date,start_time&limit=20`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (futureSlotsResponse.ok && futureSlotsResponse.data?.data?.length) {
    const availableSlots = futureSlotsResponse.data.data.filter(s => s.available_capacity > 0 && s.slot_date >= tomorrowStr);
    
    if (availableSlots.length > 0) {
      const slot = availableSlots[0];
      const service = services[0]; // Use first service
      console.log(`   ✅ Found available slot for future date:`);
      console.log(`      Slot ID: ${slot.id}`);
      console.log(`      Date: ${slot.slot_date}`);
      console.log(`      Time: ${slot.start_time} - ${slot.end_time}`);
      console.log(`      Available Capacity: ${slot.available_capacity}`);
      console.log(`      Booked Count: ${slot.booked_count}`);
      console.log(`      Original Capacity: ${slot.original_capacity}\n`);
      return { service, slot };
    }
  }

  // If still no slots, try to create a shift and generate slots
  console.log(`\n   ⚠️  No slots found. Attempting to create shift and generate slots...`);
  
  const service = services[0];
  
    // Create a shift
    const createShiftResponse = await apiRequest(`/insert/shifts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        data: {
          service_id: service.id,
          tenant_id: tenantId,
          start_time_utc: '09:00:00',
          end_time_utc: '17:00:00',
          days_of_week: [0, 1, 2, 3, 4, 5, 6], // All days
          is_active: true,
        },
        returning: 'id',
      }),
    });

    if (createShiftResponse.ok) {
      // Response can be either { data: [{ id: ... }] } or { id: ... }
      const shiftId = createShiftResponse.data?.data?.[0]?.id || createShiftResponse.data?.id;
      if (!shiftId) {
        console.error(`   ❌ Shift creation response format unexpected:`, createShiftResponse.data);
        throw new Error(`Failed to get shift ID from response: ${JSON.stringify(createShiftResponse.data)}`);
      }
      console.log(`   ✅ Created shift: ${shiftId.substring(0, 8)}...`);
      
      // Create a single slot manually
      console.log(`   Creating slot for ${tomorrowStr}...`);
      
      // For timestamptz, we need full timestamp: date + time
      const startTimeUtc = `${tomorrowStr}T10:00:00Z`;
      const endTimeUtc = `${tomorrowStr}T11:00:00Z`;
      
      const createSlotResponse = await apiRequest(`/insert/slots`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          data: {
            tenant_id: tenantId,
            shift_id: shiftId,
            slot_date: tomorrowStr,
            start_time: '10:00:00',
            end_time: '11:00:00',
            start_time_utc: startTimeUtc,
            end_time_utc: endTimeUtc,
            original_capacity: 10,
            available_capacity: 10,
            booked_count: 0,
            is_available: true,
          },
          returning: '*',
        }),
      });

      if (!createSlotResponse.ok) {
        console.error(`   ❌ Slot creation failed: ${createSlotResponse.status}`);
        console.error(`   Response: ${JSON.stringify(createSlotResponse.data)}`);
        throw new Error(`Failed to create slot: ${JSON.stringify(createSlotResponse.data)}`);
      }

      const slot = createSlotResponse.data?.data?.[0] || createSlotResponse.data;
      if (slot && slot.id) {
        console.log(`   ✅ Created slot for tomorrow:`);
        console.log(`      Slot ID: ${slot.id}`);
        console.log(`      Date: ${slot.slot_date}`);
        console.log(`      Time: ${slot.start_time} - ${slot.end_time}`);
        console.log(`      Available Capacity: ${slot.available_capacity}\n`);
        return { service, slot };
      } else {
        console.error(`   ❌ Slot created but unexpected response format:`, createSlotResponse.data);
        throw new Error('Slot created but response format unexpected');
      }
    } else {
      console.error(`   ❌ Shift creation failed:`, createShiftResponse.status, createShiftResponse.data);
      throw new Error(`Failed to create shift: ${JSON.stringify(createShiftResponse.data)}`);
    }

  throw new Error(`No available slots found and could not create slots. Please create slots manually via admin panel.`);
}

// Create booking
async function createBooking(token, slotId, serviceId, tenantId, visitorCount = 1) {
  console.log(`📝 Creating booking for ${visitorCount} visitor(s)...`);

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

  if (!response.ok) {
    throw new Error(`Failed to create booking: ${JSON.stringify(response.data)}`);
  }

  const bookingId = response.data.id || response.data.booking?.id;
  const bookingStatus = response.data.status || response.data.booking?.status || 'pending';

  console.log(`✅ Booking created:`);
  console.log(`   Booking ID: ${bookingId}`);
  console.log(`   Status: ${bookingStatus}\n`);

  return bookingId;
}

// Cancel booking
async function cancelBooking(bookingId, token) {
  console.log(`❌ Cancelling booking ${bookingId.substring(0, 8)}...`);

  const response = await apiRequest(`/bookings/${bookingId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: 'cancelled',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to cancel booking: ${JSON.stringify(response.data)}`);
  }

  console.log(`✅ Booking cancelled\n`);
}

// Main test function
async function runTest() {
  console.log('🚀 Starting Slot Capacity Test');
  console.log('='.repeat(60));
  console.log(`Account: ${TEST_ACCOUNT.email}`);
  console.log(`API URL: ${API_URL}\n`);

  try {
    // Step 1: Login
    const { token, tenantId, userId } = await login(TEST_ACCOUNT.email, TEST_ACCOUNT.password);

    // Step 2: Find tomorrow's slot
    const { service, slot } = await findTomorrowSlot(token, tenantId);
    const initialCapacity = slot.available_capacity;
    const initialBooked = slot.booked_count;

    console.log('📊 Initial Slot State:');
    console.log(`   Available Capacity: ${initialCapacity}`);
    console.log(`   Booked Count: ${initialBooked}`);
    console.log(`   Original Capacity: ${slot.original_capacity}\n`);

    // Step 3: Create booking
    const bookingId1 = await createBooking(token, slot.id, service.id, tenantId, 1);

    // Wait for trigger to fire
    console.log('⏳ Waiting for trigger to fire...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Check slot capacity after booking
    const slotAfterBooking = await getSlotDetails(slot.id, token);
    if (!slotAfterBooking) {
      throw new Error('Could not fetch slot details after booking');
    }

    console.log('📊 Slot State After Booking:');
    console.log(`   Available Capacity: ${slotAfterBooking.available_capacity}`);
    console.log(`   Booked Count: ${slotAfterBooking.booked_count}\n`);

    // Verify capacity decreased
    const capacityDecreased = slotAfterBooking.available_capacity === initialCapacity - 1;
    const bookedIncreased = slotAfterBooking.booked_count === initialBooked + 1;

    console.log('✅ Verification After Booking:');
    console.log(`   Capacity decreased by 1: ${capacityDecreased ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Booked count increased by 1: ${bookedIncreased ? '✅ PASS' : '❌ FAIL'}\n`);

    if (!capacityDecreased || !bookedIncreased) {
      throw new Error(`Capacity not updated correctly. Expected: ${initialCapacity - 1}, Got: ${slotAfterBooking.available_capacity}`);
    }

    // Step 5: Create another booking
    console.log('📝 Creating second booking...\n');
    const bookingId2 = await createBooking(token, slot.id, service.id, tenantId, 1);

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check capacity after second booking
    const slotAfterBooking2 = await getSlotDetails(slot.id, token);
    console.log('📊 Slot State After Second Booking:');
    console.log(`   Available Capacity: ${slotAfterBooking2.available_capacity}`);
    console.log(`   Booked Count: ${slotAfterBooking2.booked_count}\n`);

    const capacityDecreased2 = slotAfterBooking2.available_capacity === initialCapacity - 2;
    console.log(`   Capacity decreased by 2 total: ${capacityDecreased2 ? '✅ PASS' : '❌ FAIL'}\n`);

    // Step 6: Cancel first booking
    await cancelBooking(bookingId1, token);

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check capacity after cancellation
    const slotAfterCancellation = await getSlotDetails(slot.id, token);
    console.log('📊 Slot State After Cancellation:');
    console.log(`   Available Capacity: ${slotAfterCancellation.available_capacity}`);
    console.log(`   Booked Count: ${slotAfterCancellation.booked_count}\n`);

    // Verify capacity restored
    const capacityRestored = slotAfterCancellation.available_capacity === initialCapacity - 1;
    const bookedDecreased = slotAfterCancellation.booked_count === initialBooked + 1;

    console.log('✅ Verification After Cancellation:');
    console.log(`   Capacity restored by 1: ${capacityRestored ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Booked count decreased by 1: ${bookedDecreased ? '✅ PASS' : '❌ FAIL'}\n`);

    // Step 7: Cancel second booking
    await cancelBooking(bookingId2, token);

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check final capacity
    const finalSlot = await getSlotDetails(slot.id, token);
    console.log('📊 Final Slot State:');
    console.log(`   Available Capacity: ${finalSlot.available_capacity}`);
    console.log(`   Booked Count: ${finalSlot.booked_count}\n`);

    // Verify back to initial state
    const backToInitial = finalSlot.available_capacity === initialCapacity && finalSlot.booked_count === initialBooked;

    console.log('✅ Final Verification:');
    console.log(`   Capacity restored to initial: ${backToInitial ? '✅ PASS' : '❌ FAIL'}\n`);

    // Summary
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Booking creation reduces capacity: ${capacityDecreased ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Multiple bookings reduce capacity: ${capacityDecreased2 ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Booking cancellation restores capacity: ${capacityRestored ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Final state matches initial: ${backToInitial ? 'PASS' : 'FAIL'}`);
    console.log('='.repeat(60));

    if (capacityDecreased && capacityDecreased2 && capacityRestored && backToInitial) {
      console.log('\n🎉 ALL TESTS PASSED!');
      console.log('✅ Slot capacity is working correctly:\n');
      console.log('   - Capacity decreases when bookings are created');
      console.log('   - Capacity increases when bookings are cancelled');
      console.log('   - Multiple bookings work correctly');
      console.log('   - Cancellation restores capacity properly\n');
    } else {
      console.log('\n❌ SOME TESTS FAILED');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
runTest();
