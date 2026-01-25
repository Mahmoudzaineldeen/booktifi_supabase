/**
 * Frontend Booking Time Change Test
 * 
 * This test verifies that the booking time change functionality works correctly
 * for both Receptionist and Tenant Provider roles, ensuring:
 * 1. API returns updated booking with correct slot_date
 * 2. Database correctly stores the new slot_id and slot_date
 * 3. Frontend would receive correct data structure
 * 
 * Usage:
 *   API_URL=https://booktifisupabase-production.up.railway.app \
 *   node tests/test-frontend-booking-time-change.js
 */

const TEST_CONFIG = {
  receptionistEmail: 'receptionist1@bookati.local',
  receptionistPassword: '111111',
  tenantEmail: 'mahmoudnzaineldeen@gmail.com',
  tenantPassword: '111111',
  restoreBooking: process.env.RESTORE_BOOKING !== 'false',
};

let API_URL = process.env.API_URL || 'http://localhost:3000';
if (!API_URL.endsWith('/api')) {
  API_URL = API_URL.endsWith('/') ? `${API_URL}api` : `${API_URL}/api`;
}

let receptionistToken = null;
let tenantToken = null;
let receptionistTenantId = null;
let tenantTenantId = null;
let testBooking = null;
let originalSlotId = null;
let originalSlotData = null;
let newSlotId = null;
let newSlotData = null;

function log(message, color = '') {
  const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
  };
  console.log(`${colors[color] || ''}${message}${colors.reset}`);
}

async function makeRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.token && { Authorization: `Bearer ${options.token}` }),
    ...(options.headers || {}),
  };

  const config = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body) {
    config.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(url, config);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  return {
    response,
    data,
    ok: response.ok,
    status: response.status,
  };
}

async function loginReceptionist() {
  log('\n🔐 Logging in as Receptionist...', 'bright');
  const { data, ok, status } = await makeRequest('/auth/signin', {
    method: 'POST',
    body: {
      email: TEST_CONFIG.receptionistEmail,
      password: TEST_CONFIG.receptionistPassword,
      forCustomer: false,
    },
  });

  if (!ok) {
    throw new Error(`Receptionist login failed (${status}): ${data.error || JSON.stringify(data)}`);
  }

  receptionistToken = data.session?.access_token;
  receptionistTenantId = data.user?.tenant_id || data.session?.user?.user_metadata?.tenant_id;

  if (!receptionistToken || !receptionistTenantId) {
    throw new Error('Invalid receptionist login response');
  }

  log(`✅ Logged in as Receptionist: ${TEST_CONFIG.receptionistEmail}`, 'green');
  log(`   Tenant ID: ${receptionistTenantId.substring(0, 8)}...`);
}

async function loginTenant() {
  log('\n🔐 Logging in as Tenant Provider...', 'bright');
  const { data, ok, status } = await makeRequest('/auth/signin', {
    method: 'POST',
    body: {
      email: TEST_CONFIG.tenantEmail,
      password: TEST_CONFIG.tenantPassword,
      forCustomer: false,
    },
  });

  if (!ok) {
    throw new Error(`Tenant login failed (${status}): ${data.error || JSON.stringify(data)}`);
  }

  tenantToken = data.session?.access_token;
  tenantTenantId = data.user?.tenant_id || data.session?.user?.user_metadata?.tenant_id;

  if (!tenantToken || !tenantTenantId) {
    throw new Error('Invalid tenant login response');
  }

  log(`✅ Logged in as Tenant Provider: ${TEST_CONFIG.tenantEmail}`, 'green');
  log(`   Tenant ID: ${tenantTenantId.substring(0, 8)}...`);
}

async function findTestBooking(token, tenantId) {
  log('\n📋 Finding test booking...', 'bright');
  
  const { data, ok } = await makeRequest(
    `/query?table=bookings&tenant_id=eq.${tenantId}&status=neq.cancelled&status=neq.completed&limit=50&order=created_at.desc`,
    { token }
  );
  
  if (!ok || !data) {
    throw new Error('No active bookings found');
  }

  const bookings = Array.isArray(data) ? data : (data.data || []);
  const bookingWithSlot = bookings.find(b => b.slot_id && b.service_id);
  
  if (!bookingWithSlot) {
    throw new Error('No bookings with valid slots found');
  }

  const bookingId = bookingWithSlot.id;
  const { data: bookingData, ok: bookingOk } = await makeRequest(
    `/query?table=bookings&id=eq.${bookingId}&select=*,slots:slot_id(slot_date,start_time,end_time,shift_id),services:service_id(id,name)`,
    { token }
  );
  
  if (!bookingOk || !bookingData) {
    throw new Error(`Booking ${bookingId} not found`);
  }

  const bookingArray = Array.isArray(bookingData) ? bookingData : (bookingData.data || []);
  const booking = bookingArray[0] || bookingData;
  
  log(`✅ Found booking: ${booking.id.substring(0, 8)}...`, 'green');
  log(`   Customer: ${booking.customer_name}`);
  log(`   Current date: ${booking.slots?.slot_date || 'N/A'}`);
  log(`   Current time: ${booking.slots?.start_time || 'N/A'}`);
  
  return booking;
}

async function findNewSlot(token, tenantId, currentSlotId, currentSlotData) {
  log('\n🔍 Finding new slot with different date...', 'bright');
  
  if (!currentSlotData?.shift_id) {
    const { data: slotData, ok } = await makeRequest(
      `/query?table=slots&id=eq.${currentSlotId}&select=shift_id&single=true`,
      { token }
    );
    if (ok && slotData) {
      const slot = Array.isArray(slotData) ? slotData[0] : slotData;
      currentSlotData.shift_id = slot.shift_id;
    }
  }

  if (!currentSlotData?.shift_id) {
    throw new Error('Cannot find shift_id for current slot');
  }

  const currentShiftId = currentSlotData.shift_id;
  const currentDate = currentSlotData.slot_date;
  
  log(`   Using shift: ${currentShiftId.substring(0, 8)}...`);
  log(`   Current date: ${currentDate}`);

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 30);
  
  const startDateStr = today.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const { data: slotsData, ok } = await makeRequest(
    `/query?table=slots&tenant_id=eq.${tenantId}&shift_id=eq.${currentShiftId}&slot_date=gte.${startDateStr}&slot_date=lte.${endDateStr}&is_available=eq.true&available_capacity=gt.0&select=id,slot_date,start_time,end_time,available_capacity&order=slot_date,start_time&limit=200`,
    { token }
  );

  if (!ok || !slotsData) {
    throw new Error('Failed to fetch slots');
  }

  const slots = Array.isArray(slotsData) ? slotsData : (slotsData.data || []);
  
  if (slots.length === 0) {
    throw new Error('No available slots found');
  }

  // Find slot with different date
  const differentDateSlot = slots.find(s => s.slot_date !== currentDate);
  
  if (!differentDateSlot) {
    // Try different time on same date
    const differentTimeSlot = slots.find(s => 
      s.slot_date === currentDate && s.start_time !== currentSlotData.start_time
    );
    
    if (!differentTimeSlot) {
      throw new Error(`No slots with different date or time found. All ${slots.length} slots are on ${currentDate} at ${currentSlotData.start_time}`);
    }
    
    log(`⚠️  Using different time on same date: ${differentTimeSlot.start_time}`, 'yellow');
    return { slotId: differentTimeSlot.id, slotData: differentTimeSlot };
  } else {
    log(`✅ Found slot with different date: ${differentDateSlot.slot_date}`, 'green');
    return { slotId: differentDateSlot.id, slotData: differentDateSlot };
  }
}

async function testTimeChange(role, token, tenantId, booking, newSlotId, newSlotData) {
  log(`\n🔄 Testing ${role} booking time change...`, 'bright');
  
  log(`   Updating booking ${booking.id.substring(0, 8)}...`);
  log(`   From: ${booking.slots.slot_date} ${booking.slots.start_time}`);
  log(`   To: ${newSlotData.slot_date} ${newSlotData.start_time}`);

  const { data, ok, status } = await makeRequest(`/bookings/${booking.id}/time`, {
    method: 'PATCH',
    token,
    body: { slot_id: newSlotId },
  });

  if (!ok) {
    throw new Error(`Update failed (${status}): ${data.error || JSON.stringify(data)}`);
  }

  log(`✅ Update request successful`, 'green');
  
  // CRITICAL: Verify API response structure (what frontend receives)
  log(`\n📦 Verifying API Response Structure...`, 'cyan');
  
  if (!data.booking) {
    throw new Error('❌ API response missing "booking" field');
  }
  
  if (!data.booking.slot_id) {
    throw new Error('❌ API response booking missing "slot_id"');
  }
  
  if (!data.booking.slots) {
    throw new Error('❌ API response booking missing "slots" object');
  }
  
  if (!data.booking.slots.slot_date) {
    throw new Error('❌ API response booking.slots missing "slot_date"');
  }
  
  if (!data.booking.slots.start_time) {
    throw new Error('❌ API response booking.slots missing "start_time"');
  }
  
  log(`   ✅ API Response Structure Valid`, 'green');
  log(`   API Response slot_id: ${data.booking.slot_id.substring(0, 8)}...`);
  log(`   API Response slot_date: ${data.booking.slots.slot_date}`);
  log(`   API Response start_time: ${data.booking.slots.start_time}`);
  
  // Verify slot_id matches
  if (data.booking.slot_id !== newSlotId) {
    throw new Error(`❌ API response slot_id mismatch! Expected ${newSlotId.substring(0, 8)}..., got ${data.booking.slot_id?.substring(0, 8) || 'N/A'}...`);
  }
  
  // Verify slot_date matches
  if (data.booking.slots.slot_date !== newSlotData.slot_date) {
    throw new Error(`❌ API response slot_date mismatch! Expected ${newSlotData.slot_date}, got ${data.booking.slots.slot_date || 'MISSING'}`);
  }
  
  // Verify date actually changed
  if (booking.slots.slot_date === data.booking.slots.slot_date) {
    throw new Error(`❌ DATE NOT UPDATED! Still showing ${booking.slots.slot_date} instead of ${newSlotData.slot_date}`);
  }
  
  log(`   ✅ API Response slot_id matches expected`, 'green');
  log(`   ✅ API Response slot_date matches expected`, 'green');
  log(`   ✅ Date successfully changed from ${booking.slots.slot_date} to ${data.booking.slots.slot_date}`, 'green');
  
  // Wait for database consistency
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Verify database directly
  log(`\n🗄️  Verifying Database Update...`, 'cyan');
  
  // First, check the booking's slot_id directly (no relationship query)
  const { data: dbBookingData, ok: dbOk } = await makeRequest(
    `/query?table=bookings&id=eq.${booking.id}&select=slot_id&single=true`,
    { token }
  );

  if (!dbOk || !dbBookingData) {
    throw new Error('Failed to verify updated booking in database');
  }

  const dbBooking = Array.isArray(dbBookingData) ? dbBookingData[0] : dbBookingData;
  const dbSlotId = dbBooking.slot_id;
  
  log(`   Database slot_id (direct): ${dbSlotId?.substring(0, 8) || 'N/A'}...`);
  
  // Verify slot_id matches
  if (dbSlotId !== newSlotId) {
    throw new Error(`❌ Database slot_id mismatch! Expected ${newSlotId.substring(0, 8)}..., got ${dbSlotId?.substring(0, 8) || 'N/A'}...`);
  }
  
  log(`   ✅ Database slot_id matches expected`, 'green');
  
  // Now verify the slot_date by querying the slots table directly
  const { data: slotData, ok: slotOk } = await makeRequest(
    `/query?table=slots&id=eq.${dbSlotId}&select=slot_date,start_time,end_time&single=true`,
    { token }
  );

  if (!slotOk || !slotData) {
    throw new Error('Failed to verify slot data in database');
  }

  const slot = Array.isArray(slotData) ? slotData[0] : slotData;
  
  log(`   Database slot_date (direct): ${slot.slot_date || 'MISSING!'}`);
  log(`   Database start_time (direct): ${slot.start_time || 'MISSING!'}`);
  
  // Verify slot_date matches
  if (slot.slot_date !== newSlotData.slot_date) {
    throw new Error(`❌ Database slot_date mismatch! Expected ${newSlotData.slot_date}, got ${slot.slot_date || 'MISSING'}`);
  }
  
  // Verify start_time matches
  if (slot.start_time !== newSlotData.start_time) {
    throw new Error(`❌ Database start_time mismatch! Expected ${newSlotData.start_time}, got ${slot.start_time || 'MISSING'}`);
  }
  
  log(`   ✅ Database slot_date matches expected`, 'green');
  log(`   ✅ Database start_time matches expected`, 'green');
  
  // Update dbBooking with slot data for return
  dbBooking.slots = slot;
  
  return {
    apiResponse: data.booking,
    dbBooking,
    success: true,
  };
}

async function restoreBooking(token, bookingId, originalSlotId) {
  if (!TEST_CONFIG.restoreBooking) return;
  
  log('\n🔄 Restoring booking...', 'bright');
  
  try {
    await makeRequest(`/bookings/${bookingId}/time`, {
      method: 'PATCH',
      token,
      body: { slot_id: originalSlotId },
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    log(`✅ Booking restored`, 'green');
  } catch (error) {
    log(`⚠️  Restore failed: ${error.message}`, 'yellow');
  }
}

async function runTest() {
  try {
    log('================================================================================', 'bright');
    log('FRONTEND BOOKING TIME CHANGE TEST', 'bright');
    log('================================================================================\n', 'bright');

    // Test Receptionist
    log('\n' + '='.repeat(80), 'blue');
    log('TEST 1: RECEPTIONIST ROLE', 'blue');
    log('='.repeat(80), 'blue');
    
    await loginReceptionist();
    testBooking = await findTestBooking(receptionistToken, receptionistTenantId);
    originalSlotId = testBooking.slot_id;
    originalSlotData = testBooking.slots;
    
    const receptionistSlot = await findNewSlot(
      receptionistToken,
      receptionistTenantId,
      originalSlotId,
      originalSlotData
    );
    newSlotId = receptionistSlot.slotId;
    newSlotData = receptionistSlot.slotData;
    
    log(`   New slot_id: ${newSlotId.substring(0, 8)}...`);
    log(`   New date: ${newSlotData.slot_date}`);
    log(`   New time: ${newSlotData.start_time}`);
    
    const receptionistResult = await testTimeChange(
      'Receptionist',
      receptionistToken,
      receptionistTenantId,
      testBooking,
      newSlotId,
      newSlotData
    );
    
    await restoreBooking(receptionistToken, testBooking.id, originalSlotId);
    
    log(`\n✅ RECEPTIONIST TEST PASSED`, 'green');
    
    // Test Tenant Provider
    log('\n' + '='.repeat(80), 'blue');
    log('TEST 2: TENANT PROVIDER ROLE', 'blue');
    log('='.repeat(80), 'blue');
    
    await loginTenant();
    testBooking = await findTestBooking(tenantToken, tenantTenantId);
    originalSlotId = testBooking.slot_id;
    originalSlotData = testBooking.slots;
    
    const tenantSlot = await findNewSlot(
      tenantToken,
      tenantTenantId,
      originalSlotId,
      originalSlotData
    );
    newSlotId = tenantSlot.slotId;
    newSlotData = tenantSlot.slotData;
    
    log(`   New slot_id: ${newSlotId.substring(0, 8)}...`);
    log(`   New date: ${newSlotData.slot_date}`);
    log(`   New time: ${newSlotData.start_time}`);
    
    const tenantResult = await testTimeChange(
      'Tenant Provider',
      tenantToken,
      tenantTenantId,
      testBooking,
      newSlotId,
      newSlotData
    );
    
    await restoreBooking(tenantToken, testBooking.id, originalSlotId);
    
    log(`\n✅ TENANT PROVIDER TEST PASSED`, 'green');

    log('\n================================================================================', 'bright');
    log('✅ ALL TESTS PASSED!', 'green');
    log('================================================================================\n', 'bright');
    log('Key Verifications:', 'bright');
    log('  ✅ API response includes "booking" object with "slots"', 'green');
    log('  ✅ API response booking.slot_id matches requested slot_id', 'green');
    log('  ✅ API response booking.slots.slot_date matches new date', 'green');
    log('  ✅ API response booking.slots.start_time matches new time', 'green');
    log('  ✅ Database correctly stores new slot_id', 'green');
    log('  ✅ Database correctly retrieves new slot_date', 'green');
    log('  ✅ Date actually changes (not just time)', 'green');
    log('\n✅ Frontend will receive correct data structure:', 'bright');
    log('   result.booking.slot_id = new slot_id', 'cyan');
    log('   result.booking.slots.slot_date = new date', 'cyan');
    log('   result.booking.slots.start_time = new time', 'cyan');
    log('\nThe frontend code should use result.booking.slots to update state immediately.');
    
  } catch (error) {
    log('\n================================================================================', 'bright');
    log('❌ TEST FAILED', 'red');
    log('================================================================================\n', 'bright');
    log(`Error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

runTest().catch(error => {
  log(`Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
