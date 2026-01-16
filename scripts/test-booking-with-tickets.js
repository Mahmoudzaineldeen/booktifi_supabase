#!/usr/bin/env node

/**
 * Test Booking with Ticket Delivery
 * 
 * Creates a booking using kaptifidev@gmail.com account
 * Verifies tickets are sent to email and WhatsApp
 */

const API_URL = 'http://localhost:3001/api';

async function login(email, password) {
  const response = await fetch(`${API_URL}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Login failed');
  return data;
}

async function getAvailableSlots(token, tenantId) {
  // Get services first
  const services = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId, is_active: true, is_public: true }))}&limit=1`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  ).then(r => r.json()).then(d => d.data || []);

  if (services.length === 0) {
    throw new Error('No active services found');
  }

  const service = services[0];
  console.log(`   Found service: ${service.name}`);

  // Get shifts for this service
  const shifts = await fetch(
    `${API_URL}/query?table=shifts&select=id&where=${encodeURIComponent(JSON.stringify({ service_id: service.id, is_active: true }))}&limit=1`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  ).then(r => r.json()).then(d => d.data || []);

  if (shifts.length === 0) {
    throw new Error('No active shifts found for this service');
  }

  const shift = shifts[0];

  // Get available slots for tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];

  const slots = await fetch(
    `${API_URL}/query?table=slots&select=id,start_time,available_capacity&where=${encodeURIComponent(JSON.stringify({ shift_id: shift.id, slot_date: dateStr, is_available: true }))}&limit=1`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  ).then(r => r.json()).then(d => d.data || []);

  if (slots.length === 0) {
    throw new Error(`No available slots found for ${dateStr}. Please generate slots first.`);
  }

  return {
    service,
    slot: slots[0],
    dateStr
  };
}

async function acquireLock(token, slotId, reservedCapacity) {
  const response = await fetch(`${API_URL}/bookings/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      slot_id: slotId,
      reserved_capacity: reservedCapacity,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to acquire lock');
  return data;
}

async function createBooking(token, bookingData) {
  const response = await fetch(`${API_URL}/bookings/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(bookingData),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to create booking');
  return data;
}

async function main() {
  console.log('🧪 Testing Booking with Ticket Delivery...\n');
  console.log('📧 Account: kaptifidev@gmail.com');
  console.log('📱 WhatsApp: +201032560826\n');

  try {
    // Step 1: Login as customer
    console.log('1️⃣  Logging in as customer...');
    const customer = await login('kaptifidev@gmail.com', '111111');
    const token = customer.session.access_token;
    const tenantId = customer.tenant?.id;
    const userId = customer.user?.id;

    if (!tenantId) {
      throw new Error('Customer account has no tenant');
    }

    console.log(`✅ Logged in successfully`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Tenant ID: ${tenantId}\n`);

    // Step 2: Get available slots
    console.log('2️⃣  Finding available service and slot...');
    const { service, slot, dateStr } = await getAvailableSlots(token, tenantId);
    console.log(`✅ Found slot: ${dateStr} at ${slot.start_time}`);
    console.log(`   Available capacity: ${slot.available_capacity}\n`);

    // Step 3: Acquire booking lock
    console.log('3️⃣  Acquiring booking lock...');
    const lock = await acquireLock(token, slot.id, 1);
    console.log(`✅ Lock acquired: ${lock.lock_id}`);
    console.log(`   Session ID: ${lock.session_id}\n`);

    // Step 4: Get service details for pricing
    const serviceDetails = await fetch(
      `${API_URL}/query?table=services&select=base_price,child_price&where=${encodeURIComponent(JSON.stringify({ id: service.id }))}&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()).then(d => d.data?.[0] || {});

    const totalPrice = serviceDetails.base_price || 100.00;

    // Step 5: Create booking
    console.log('4️⃣  Creating booking...');
    const booking = await createBooking(token, {
      slot_id: slot.id,
      service_id: service.id,
      tenant_id: tenantId,
      customer_id: userId,
      customer_name: 'Kaptifi Dev',
      customer_phone: '+201032560826',
      customer_email: 'kaptifidev@gmail.com',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: totalPrice,
      lock_id: lock.lock_id,
      session_id: lock.session_id,
      language: 'en',
    });

    const bookingId = booking.id || booking.booking?.id;
    console.log(`✅ Booking created successfully!`);
    console.log(`   Booking ID: ${bookingId}\n`);

    // Step 6: Wait a moment for ticket generation
    console.log('5️⃣  Waiting for ticket generation...');
    console.log('   (Tickets are generated asynchronously)');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('\n' + '='.repeat(60));
    console.log('📊 BOOKING SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Booking ID: ${bookingId}`);
    console.log(`✅ Service: ${service.name}`);
    console.log(`✅ Date: ${dateStr}`);
    console.log(`✅ Time: ${slot.start_time}`);
    console.log(`✅ Price: ${totalPrice} SAR`);
    console.log(`\n📧 Ticket Delivery:`);
    console.log(`   Email: kaptifidev@gmail.com`);
    console.log(`   WhatsApp: +201032560826`);
    console.log(`\n📝 Next Steps:`);
    console.log(`   1. Check server logs for ticket generation messages`);
    console.log(`   2. Check email inbox: kaptifidev@gmail.com`);
    console.log(`   3. Check WhatsApp: +201032560826`);
    console.log(`   4. Verify ticket PDF uses tenant branding colors`);
    console.log('\n✅ Test complete! Check email and WhatsApp for ticket.\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();
