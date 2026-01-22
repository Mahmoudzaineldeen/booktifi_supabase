/**
 * Setup Script: Create Test Data for Booking Time Edit Test
 * 
 * This script creates:
 * 1. A slot for tomorrow (if needed)
 * 2. Ensures we have at least 2 slots for testing
 */

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

const TENANT_ADMIN_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TENANT_ADMIN_PASSWORD = '111111';

let token = null;
let tenantId = null;
let serviceId = null;
let bookingId = null;
let oldSlotId = null;

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
  console.log(`\n🔧 Setup: Logging in...\n`);

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

  if (!token || !tenantId) {
    throw new Error(`Login response missing token or tenant_id`);
  }

  console.log(`✅ Logged in`);
  console.log(`   Tenant ID: ${tenantId}`);

  // Find a booking
  const bookingsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id, slot_id, service_id, status',
      where: {
        tenant_id: tenantId,
      },
      limit: 1,
    }),
  });

  if (!bookingsResponse.ok || !bookingsResponse.data) {
    throw new Error('Failed to fetch bookings');
  }

  const bookings = Array.isArray(bookingsResponse.data) 
    ? bookingsResponse.data 
    : (bookingsResponse.data?.data || []);

  if (bookings.length === 0) {
    throw new Error('No bookings found. Please create a booking first.');
  }

  const booking = bookings[0];
  bookingId = booking.id;
  oldSlotId = booking.slot_id;
  serviceId = booking.service_id;

  console.log(`✅ Found booking:`);
  console.log(`   Booking ID: ${bookingId}`);
  console.log(`   Service ID: ${serviceId}`);
  console.log(`   Current Slot ID: ${oldSlotId}`);

  return { bookingId, oldSlotId, serviceId };
}

async function findOrCreateAlternativeSlot() {
  console.log(`\n🔍 Finding or creating alternative slot...`);

  // Get current slot details
  const currentSlotResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'id, slot_date, start_time, end_time, shift_id, available_capacity',
      where: { id: oldSlotId },
      limit: 1,
    }),
  });

  if (!currentSlotResponse.ok) {
    throw new Error('Failed to fetch current slot');
  }

  const currentSlot = Array.isArray(currentSlotResponse.data) 
    ? currentSlotResponse.data[0] 
    : (currentSlotResponse.data?.data?.[0] || currentSlotResponse.data);

  if (!currentSlot) {
    throw new Error('Current slot not found');
  }

  console.log(`   Current slot: ${currentSlot.slot_date} ${currentSlot.start_time}`);

  // Get shifts for this service
  const shiftsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'shifts',
      select: 'id, days_of_week, start_time_utc, end_time_utc',
      where: { service_id: serviceId, is_active: true },
      limit: 10,
    }),
  });

  if (!shiftsResponse.ok) {
    throw new Error('Failed to fetch shifts');
  }

  const shifts = Array.isArray(shiftsResponse.data) 
    ? shiftsResponse.data 
    : (shiftsResponse.data?.data || []);

  if (shifts.length === 0) {
    throw new Error('No active shifts found for this service');
  }

  const shiftId = shifts[0].id;
  console.log(`   Using shift: ${shiftId}`);

  // Try to find existing alternative slots
  const slotsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'id, slot_date, start_time, available_capacity',
      where: {
        tenant_id: tenantId,
        shift_id: shiftId,
        is_available: true,
      },
      limit: 50,
    }),
  });

  let alternativeSlots = [];
  if (slotsResponse.ok) {
    const allSlots = Array.isArray(slotsResponse.data) 
      ? slotsResponse.data 
      : (slotsResponse.data?.data || []);
    
    alternativeSlots = allSlots.filter(slot => 
      slot.id !== oldSlotId && 
      slot.available_capacity > 0
    );
  }

  if (alternativeSlots.length > 0) {
    console.log(`✅ Found ${alternativeSlots.length} alternative slot(s)`);
    return alternativeSlots[0].id;
  }

  // No alternative slots found - try to create one for tomorrow
  console.log(`   ⚠️  No alternative slots found. Creating one for tomorrow...`);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Get shift details to create slot
  const shift = shifts[0];
  const startTime = '10:00:00';
  const endTime = '11:00:00';

  // Create slot via insert endpoint
  const createSlotResponse = await apiRequest('/insert/slots', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      shift_id: shiftId,
      slot_date: tomorrowStr,
      start_time: startTime,
      end_time: endTime,
      start_time_utc: `${tomorrowStr}T${startTime}Z`,
      end_time_utc: `${tomorrowStr}T${endTime}Z`,
      available_capacity: 10,
      original_capacity: 10,
      is_available: true,
    }),
  });

  if (!createSlotResponse.ok) {
    console.error(`   ❌ Failed to create slot: ${JSON.stringify(createSlotResponse.data)}`);
    throw new Error(`Failed to create alternative slot: ${JSON.stringify(createSlotResponse.data)}`);
  }

  const newSlot = createSlotResponse.data.data || createSlotResponse.data;
  const newSlotId = Array.isArray(newSlot) ? newSlot[0]?.id : newSlot?.id;

  if (!newSlotId) {
    throw new Error('Slot created but no ID returned');
  }

  console.log(`✅ Created alternative slot:`);
  console.log(`   Slot ID: ${newSlotId}`);
  console.log(`   Date: ${tomorrowStr}`);
  console.log(`   Time: ${startTime} - ${endTime}`);

  return newSlotId;
}

async function runSetup() {
  try {
    console.log('🚀 Setting Up Test Data for Booking Time Edit');
    console.log('============================================================\n');

    await setup();
    const newSlotId = await findOrCreateAlternativeSlot();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Setup Complete!`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Booking ID: ${bookingId}`);
    console.log(`Old Slot ID: ${oldSlotId}`);
    console.log(`New Slot ID: ${newSlotId}`);
    console.log(`\n📝 You can now run:`);
    console.log(`   node tests/test-booking-time-edit-full-flow.js`);
    console.log(`\nOr test manually via the UI:`);
    console.log(`   1. Go to Bookings page`);
    console.log(`   2. Find booking: ${bookingId}`);
    console.log(`   3. Click "Change Time"`);
    console.log(`   4. Select the new slot`);

    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Setup Failed:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runSetup();
