#!/usr/bin/env node

/**
 * Test Ticket Generation with Log Analysis
 * 
 * Creates a booking and provides detailed analysis of what should appear
 * in server logs, plus checks booking status.
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('TICKET GENERATION TEST - SERVER LOG ANALYSIS');
  console.log('='.repeat(70) + '\n');
  
  // Check server
  try {
    await fetch('http://localhost:3001/health');
    console.log('✓ Server is running\n');
  } catch (error) {
    console.error('✗ Server not running\n');
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
      console.error('✗ Login failed\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Login error\n');
    process.exit(1);
  }
  
  // Check for existing bookings first
  console.log('Step 2: Checking for existing bookings...');
  const bookingsRes = await fetch(
    `${API_URL}/query?table=bookings&select=id,customer_name,customer_email,customer_phone,status,created_at&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID }))}&order=created_at&desc=true&limit=3`
  );
  const bookings = await bookingsRes.json();
  const bookingArray = Array.isArray(bookings) ? bookings : (bookings.data || []);
  
  if (bookingArray.length > 0) {
    console.log(`✓ Found ${bookingArray.length} existing booking(s)\n`);
    const testBooking = bookingArray[0];
    console.log('Most recent booking:');
    console.log(`  ID: ${testBooking.id}`);
    console.log(`  Customer: ${testBooking.customer_name || 'N/A'}`);
    console.log(`  Email: ${testBooking.customer_email || 'N/A'}`);
    console.log(`  Phone: ${testBooking.customer_phone || 'N/A'}`);
    console.log(`  Status: ${testBooking.status || 'N/A'}`);
    console.log(`  Created: ${testBooking.created_at || 'N/A'}\n`);
    
    console.log('='.repeat(70));
    console.log('SERVER LOG ANALYSIS FOR EXISTING BOOKING');
    console.log('='.repeat(70));
    console.log('');
    console.log('When this booking was created, your server console should have shown:');
    console.log('');
    console.log('📧 ========================================');
    console.log(`📧 Starting ticket generation for booking ${testBooking.id}...`);
    console.log(`   Customer: ${testBooking.customer_name || 'N/A'}`);
    console.log(`   Email: ${testBooking.customer_email || 'N/A'}`);
    console.log(`   Phone: ${testBooking.customer_phone || 'N/A'}`);
    console.log('📧 ========================================');
    console.log('');
    console.log('📄 Step 1: Generating PDF for booking...');
    console.log('✅ Step 1 Complete: PDF generated successfully (XXXXX bytes)');
    console.log('');
    console.log('📱 Step 2: Attempting to send ticket via WhatsApp...');
    console.log('✅ Step 2 Complete: Ticket PDF sent via WhatsApp');
    console.log('');
    console.log('📧 Step 3: Attempting to send ticket via Email...');
    console.log('✅ Step 3 Complete: Ticket PDF sent via Email');
    console.log('');
    console.log('='.repeat(70));
    console.log('');
    console.log('🔍 DIAGNOSTICS:');
    console.log('');
    
    if (!testBooking.customer_email && !testBooking.customer_phone) {
      console.log('⚠️  WARNING: This booking has no email or phone!');
      console.log('   Tickets cannot be sent without contact information.');
    } else {
      if (!testBooking.customer_email) {
        console.log('⚠️  No email - email ticket was not sent');
      }
      if (!testBooking.customer_phone) {
        console.log('⚠️  No phone - WhatsApp ticket was not sent');
      }
    }
    console.log('');
  }
  
  // Try to create a new booking
  console.log('Step 3: Attempting to create a new booking for testing...');
  const svcRes = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=1`
  );
  const svcs = await svcRes.json();
  const svc = Array.isArray(svcs) ? svcs[0] : (svcs.data?.[0] || svcs.data);
  
  if (!svc) {
    console.log('✗ No services found\n');
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log('To test ticket generation:');
    console.log('1. Create a booking via UI: http://localhost:5173/fci/book');
    console.log('2. Watch your SERVER CONSOLE immediately after booking');
    console.log('3. Look for the logs shown above');
    console.log('');
    return;
  }
  
  const slotRes = await fetch(
    `${API_URL}/query?table=time_slots&select=id,start_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: svc.id, is_available: true }))}&limit=10`
  );
  const slots = await slotRes.json();
  const slotArr = Array.isArray(slots) ? slots : (slots.data || []);
  const futureSlots = slotArr.filter(s => new Date(s.start_time_utc) > new Date() && s.remaining_capacity > 0);
  
  if (futureSlots.length === 0) {
    console.log('✗ No available slots\n');
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log('Cannot create test booking - no available slots.');
    console.log('');
    console.log('To test ticket generation:');
    console.log('1. Create shifts for your service');
    console.log('2. Generate slots');
    console.log('3. Create a booking via UI: http://localhost:5173/fci/book');
    console.log('4. Watch your SERVER CONSOLE immediately after booking');
    console.log('5. Look for ticket generation logs');
    console.log('');
    return;
  }
  
  const slot = futureSlots[0];
  console.log(`✓ Found available slot: ${new Date(slot.start_time_utc).toLocaleString()}\n`);
  
  // Acquire lock
  let lock = null;
  try {
    const lockRes = await fetch(`${API_URL}/bookings/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ slot_id: slot.id, reserved_capacity: 1 }),
    });
    const lockData = await lockRes.json();
    if (lockRes.ok) lock = lockData;
  } catch (e) {}
  
  // Create booking
  console.log('Step 4: Creating booking...');
  console.log(`  Email: ${TEST_EMAIL}`);
  console.log(`  Phone: ${TEST_PHONE}\n`);
  
  try {
    const bookRes = await fetch(`${API_URL}/bookings/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        service_id: svc.id,
        slot_id: slot.id,
        tenant_id: TEST_TENANT_ID,
        customer_name: 'Test Customer',
        customer_email: TEST_EMAIL,
        customer_phone: TEST_PHONE,
        visitor_count: 1,
        adult_count: 1,
        child_count: 0,
        language: 'en',
        lock_id: lock?.lock_id || null,
        session_id: lock?.session_id || null,
      }),
    });
    
    const bookData = await bookRes.json();
    
    if (bookRes.ok) {
      const bid = bookData.id || bookData.booking?.id || bookData.booking;
      console.log(`✓ Booking created: ${bid}\n`);
      
      console.log('='.repeat(70));
      console.log('⚠️  CHECK YOUR SERVER CONSOLE NOW!');
      console.log('='.repeat(70));
      console.log('');
      console.log('You should see these logs in your SERVER CONSOLE:');
      console.log('');
      console.log('📧 ========================================');
      console.log(`📧 Starting ticket generation for booking ${bid}...`);
      console.log('   Customer: Test Customer');
      console.log(`   Email: ${TEST_EMAIL}`);
      console.log(`   Phone: ${TEST_PHONE}`);
      console.log('📧 ========================================');
      console.log('');
      console.log('📄 Step 1: Generating PDF for booking...');
      console.log('✅ Step 1 Complete: PDF generated successfully (XXXXX bytes)');
      console.log('');
      console.log('📱 Step 2: Attempting to send ticket via WhatsApp...');
      console.log('✅ Step 2 Complete: Ticket PDF sent via WhatsApp');
      console.log('');
      console.log('📧 Step 3: Attempting to send ticket via Email...');
      console.log('✅ Step 3 Complete: Ticket PDF sent via Email');
      console.log('');
      console.log('='.repeat(70));
      console.log('');
      console.log('⏳ Waiting 5 seconds...');
      await new Promise(r => setTimeout(r, 5000));
      console.log('');
      console.log('📬 Check delivery:');
      console.log(`  📧 Email: ${TEST_EMAIL}`);
      console.log(`  📱 WhatsApp: ${TEST_PHONE}`);
      console.log('');
      console.log('='.repeat(70));
      console.log('TEST COMPLETE');
      console.log('='.repeat(70));
      console.log('');
      console.log('If you did NOT see the ticket logs in server console:');
      console.log('  1. Check for errors in server console');
      console.log('  2. Verify booking was created (ID above)');
      console.log('  3. Check SMTP/WhatsApp settings');
      console.log('');
    } else {
      console.error(`✗ Booking failed: ${bookData.error || 'Unknown'}\n`);
    }
  } catch (error) {
    console.error(`✗ Error: ${error.message}\n`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
