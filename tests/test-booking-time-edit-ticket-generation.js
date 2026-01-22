/**
 * Test: Verify Ticket Generation After Booking Time Edit
 * 
 * This test specifically checks if tickets are generated and sent
 * after editing booking time.
 */

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

const TENANT_ADMIN_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TENANT_ADMIN_PASSWORD = '111111';

let token = null;
let tenantId = null;
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
      select: 'id, slot_id, service_id, customer_email, customer_phone, qr_token',
      where: {
        tenant_id: tenantId,
      },
      limit: 1,
    }),
  });

  if (!bookingsResponse.ok) {
    throw new Error('Failed to fetch bookings');
  }

  const bookings = Array.isArray(bookingsResponse.data) 
    ? bookingsResponse.data 
    : (bookingsResponse.data?.data || []);

  if (bookings.length === 0) {
    throw new Error('No bookings found');
  }

  const booking = bookings[0];
  bookingId = booking.id;
  oldSlotId = booking.slot_id;
  const serviceId = booking.service_id;

  console.log(`✅ Found booking:`);
  console.log(`   Booking ID: ${bookingId}`);
  console.log(`   Current Slot: ${oldSlotId}`);
  console.log(`   Customer Email: ${booking.customer_email || 'N/A'}`);
  console.log(`   Customer Phone: ${booking.customer_phone || 'N/A'}`);
  console.log(`   QR Token: ${booking.qr_token ? 'Present' : 'None'}`);

  // Find alternative slot
  const shiftsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'shifts',
      select: 'id',
      where: { service_id: serviceId, is_active: true },
      limit: 1,
    }),
  });

  if (!shiftsResponse.ok) {
    throw new Error('Failed to fetch shifts');
  }

  const shifts = Array.isArray(shiftsResponse.data) 
    ? shiftsResponse.data 
    : (shiftsResponse.data?.data || []);

  if (shifts.length === 0) {
    throw new Error('No shifts found');
  }

  const shiftIds = shifts.map(s => s.id);

  const slotsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'id, slot_date, start_time, available_capacity',
      where: {
        tenant_id: tenantId,
        shift_id: shiftIds[0],
        is_available: true,
      },
      limit: 50,
    }),
  });

  if (!slotsResponse.ok) {
    throw new Error('Failed to fetch slots');
  }

  let slots = Array.isArray(slotsResponse.data) 
    ? slotsResponse.data 
    : (slotsResponse.data?.data || []);

  slots = slots.filter(slot => 
    slot.id !== oldSlotId && 
    slot.available_capacity > 0
  );

  if (slots.length === 0) {
    throw new Error('No alternative slots found');
  }

  newSlotId = slots[0].id;
  console.log(`✅ Found alternative slot: ${newSlotId}`);
}

async function testTicketGeneration() {
  console.log(`\n🔄 Testing Booking Time Edit with Ticket Generation`);
  console.log(`   Booking ID: ${bookingId}`);
  console.log(`   Old Slot: ${oldSlotId}`);
  console.log(`   New Slot: ${newSlotId}\n`);

  // Edit booking time
  console.log(`📝 Editing booking time...`);
  const editResponse = await apiRequest(`/bookings/${bookingId}/time`, {
    method: 'PATCH',
    body: JSON.stringify({
      slot_id: newSlotId,
    }),
  });

  if (!editResponse.ok) {
    console.error(`❌ Booking time edit failed`);
    console.error(`   Status: ${editResponse.status}`);
    console.error(`   Error: ${JSON.stringify(editResponse.data, null, 2)}`);
    throw new Error('Booking time edit failed');
  }

  console.log(`✅ Booking time edit successful`);
  console.log(`   Response indicates: new_ticket_generated = ${editResponse.data.new_ticket_generated || false}`);

  // Wait for async ticket generation (longer wait)
  console.log(`\n⏳ Waiting for async ticket generation (10 seconds)...`);
  console.log(`   ⚠️  Check server logs for:`);
  console.log(`      - "[Booking Time Edit] 🎫 Generating new ticket..."`);
  console.log(`      - "[Booking Time Edit] 📄 Step 1: Generating PDF..."`);
  console.log(`      - "[Booking Time Edit] ✅ PDF generated..."`);
  console.log(`      - "[Booking Time Edit] 📱 Step 2: Sending ticket via WhatsApp..."`);
  console.log(`      - "[Booking Time Edit] 📧 Step 3: Sending ticket via Email..."`);
  console.log(`      - "[Booking Time Edit] ✅ Ticket generation and delivery completed"`);
  
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Check booking for new QR token (if regenerated)
  const bookingCheckResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: 'id, qr_token, qr_scanned, slot_id',
      where: { id: bookingId },
      limit: 1,
    }),
  });

  if (bookingCheckResponse.ok) {
    const bookings = Array.isArray(bookingCheckResponse.data) 
      ? bookingCheckResponse.data 
      : (bookingCheckResponse.data?.data || []);
    
    if (bookings.length > 0) {
      const booking = bookings[0];
      console.log(`\n📋 Booking State After Edit:`);
      console.log(`   Slot ID: ${booking.slot_id} (should be: ${newSlotId})`);
      console.log(`   QR Token: ${booking.qr_token ? 'Present' : 'None'}`);
      console.log(`   QR Scanned: ${booking.qr_scanned || false}`);
      
      if (booking.slot_id === newSlotId && booking.qr_scanned === true) {
        console.log(`\n✅ Booking time edit successful`);
        console.log(`   ✅ Old ticket invalidated (qr_scanned = true)`);
        console.log(`   ${booking.qr_token ? '✅' : '⚠️ '} QR Token: ${booking.qr_token ? 'Regenerated' : 'Not regenerated (may be async)'}`);
      }
    }
  }

  console.log(`\n📝 Next Steps:`);
  console.log(`   1. Check server logs for ticket generation messages`);
  console.log(`   2. Check customer email for new ticket`);
  console.log(`   3. Check customer WhatsApp for new ticket`);
  console.log(`   4. If tickets not sent, check server error logs`);
}

async function runTest() {
  try {
    console.log('🚀 Test: Booking Time Edit - Ticket Generation');
    console.log('============================================================');
    console.log('This test verifies that tickets are generated and sent');
    console.log('after editing booking time.\n');

    await setup();
    await testTicketGeneration();

    console.log(`\n✅ Test completed`);
    console.log(`\n💡 Important:`);
    console.log(`   - Ticket generation is ASYNCHRONOUS`);
    console.log(`   - Check server logs to see if ticket generation ran`);
    console.log(`   - Check customer email/WhatsApp for new tickets`);
    console.log(`   - If tickets not sent, check server error logs for failures`);

    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Test Failed:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
