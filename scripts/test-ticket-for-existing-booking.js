#!/usr/bin/env node

/**
 * Test Ticket Generation for Existing Booking
 * 
 * Manually triggers ticket generation for an existing booking
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function testExistingBooking() {
  console.log('\n=== Test Ticket Generation for Existing Booking ===\n');
  
  // Check server
  try {
    await fetch('http://localhost:3001/health');
    console.log('✓ Server is running\n');
  } catch (error) {
    console.error('✗ Server not running');
    process.exit(1);
  }
  
  // Login
  console.log('Step 1: Logging in...');
  let token = null;
  try {
    const res = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: '111111' }),
    });
    const data = await res.json();
    if (res.ok && data.session) {
      token = data.session.access_token;
      console.log('✓ Logged in\n');
    } else {
      console.error('✗ Login failed:', data.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Login error:', error.message);
    process.exit(1);
  }
  
  // Get recent bookings
  console.log('Step 2: Finding recent bookings...');
  const bookingsRes = await fetch(
    `${API_URL}/query?table=bookings&select=id,customer_name,customer_email,customer_phone,status,created_at&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID }))}&order=created_at&desc=true&limit=5`
  );
  const bookings = await bookingsRes.json();
  const bookingArray = Array.isArray(bookings) ? bookings : (bookings.data || []);
  
  if (bookingArray.length === 0) {
    console.error('✗ No bookings found');
    console.log('\nYou need to create a booking first.');
    console.log('Option 1: Create via UI at http://localhost:5173/fci/book');
    console.log('Option 2: Create via API (requires available slots)');
    process.exit(1);
  }
  
  console.log(`✓ Found ${bookingArray.length} booking(s)\n`);
  
  // Find a booking with email and phone
  let testBooking = bookingArray.find(b => b.customer_email && b.customer_phone);
  if (!testBooking) {
    testBooking = bookingArray[0];
  }
  
  console.log('Using booking:');
  console.log(`  ID: ${testBooking.id}`);
  console.log(`  Customer: ${testBooking.customer_name || 'N/A'}`);
  console.log(`  Email: ${testBooking.customer_email || 'N/A'}`);
  console.log(`  Phone: ${testBooking.customer_phone || 'N/A'}`);
  console.log(`  Status: ${testBooking.status || 'N/A'}`);
  console.log(`  Created: ${testBooking.created_at || 'N/A'}\n`);
  
  if (!testBooking.customer_email && !testBooking.customer_phone) {
    console.error('⚠️  Warning: This booking has no email or phone');
    console.log('Tickets cannot be sent without contact information.\n');
  }
  
  console.log('='.repeat(60));
  console.log('\n📝 IMPORTANT: Manual Ticket Generation Test\n');
  console.log('Tickets are automatically generated when bookings are created.');
  console.log('To test ticket generation:\n');
  console.log('1. Create a NEW booking via UI:');
  console.log('   http://localhost:5173/fci/book');
  console.log('   - Use email:', TEST_EMAIL);
  console.log('   - Use phone:', TEST_PHONE);
  console.log('   - Complete the booking\n');
  console.log('2. IMMEDIATELY check your SERVER CONSOLE for:');
  console.log('   📧 Starting ticket generation for booking...');
  console.log('   📄 Step 1: Generating PDF...');
  console.log('   ✅ Step 1 Complete: PDF generated');
  console.log('   📱 Step 2: Sending via WhatsApp...');
  console.log('   ✅ Step 2 Complete: WhatsApp sent');
  console.log('   📧 Step 3: Sending via Email...');
  console.log('   ✅ Step 3 Complete: Email sent\n');
  console.log('3. Check delivery:');
  console.log(`   📧 Email: ${TEST_EMAIL}`);
  console.log(`   📱 WhatsApp: ${TEST_PHONE}\n`);
  console.log('='.repeat(60));
  console.log('\n💡 Note:');
  console.log('Tickets are generated asynchronously using process.nextTick()');
  console.log('This means they are generated AFTER the booking response is sent.');
  console.log('Check server console within 1-2 seconds of booking creation.\n');
  
  // Check if we can create a new booking
  console.log('Checking if we can create a new booking for testing...\n');
  
  // Get service
  const svcRes = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=1`
  );
  const svcs = await svcRes.json();
  const svc = Array.isArray(svcs) ? svcs[0] : (svcs.data?.[0] || svcs.data);
  
  if (!svc) {
    console.log('✗ No services found - cannot create test booking\n');
    return;
  }
  
  // Get slot
  const slotRes = await fetch(
    `${API_URL}/query?table=time_slots&select=id,start_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: svc.id, is_available: true }))}&limit=10`
  );
  const slots = await slotRes.json();
  const slotArr = Array.isArray(slots) ? slots : (slots.data || []);
  const futureSlots = slotArr.filter(s => new Date(s.start_time_utc) > new Date() && s.remaining_capacity > 0);
  
  if (futureSlots.length === 0) {
    console.log('✗ No available slots - cannot create test booking');
    console.log('\nTo create slots:');
    console.log('1. Create shifts for your service');
    console.log('2. Generate slots (usually automatic)');
    console.log('3. Run this test again\n');
    return;
  }
  
  const slot = futureSlots[0];
  console.log(`✓ Found available slot: ${new Date(slot.start_time_utc).toLocaleString()}\n`);
  console.log('Would you like to create a test booking now?');
  console.log('(This will create a real booking and trigger ticket generation)\n');
  console.log('To create the booking, run:');
  console.log('  node scripts/test-booking-tickets.js\n');
}

testExistingBooking().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
