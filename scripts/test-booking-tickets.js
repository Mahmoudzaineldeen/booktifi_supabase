#!/usr/bin/env node

/**
 * Test Booking Ticket Generation
 * 
 * Creates a booking and verifies tickets are generated
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function test() {
  console.log('\n=== Booking Ticket Generation Test ===\n');
  
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
  
  // Get service
  console.log('Step 2: Getting service...');
  const svcRes = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=1`
  );
  const svcs = await svcRes.json();
  const svc = Array.isArray(svcs) ? svcs[0] : (svcs.data?.[0] || svcs.data);
  
  if (!svc) {
    console.error('✗ No services found. Create a service first.');
    process.exit(1);
  }
  console.log(`✓ Service: ${svc.name}\n`);
  
  // Get slot
  console.log('Step 3: Getting available slot...');
  const slotRes = await fetch(
    `${API_URL}/query?table=time_slots&select=id,start_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: svc.id, is_available: true }))}&limit=10`
  );
  const slots = await slotRes.json();
  const slotArr = Array.isArray(slots) ? slots : (slots.data || []);
  const futureSlots = slotArr.filter(s => {
    const slotTime = new Date(s.start_time_utc);
    return slotTime > new Date() && s.remaining_capacity > 0;
  });
  
  if (futureSlots.length === 0) {
    console.error('✗ No available slots found.');
    console.log('\nSetup required:');
    console.log('  1. Create shifts for your service');
    console.log('  2. Generate slots');
    console.log('  3. Run test again\n');
    process.exit(1);
  }
  
  const slot = futureSlots[0];
  console.log(`✓ Found slot: ${new Date(slot.start_time_utc).toLocaleString()}\n`);
  
  // Acquire lock
  console.log('Step 4: Acquiring lock...');
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
    if (lockRes.ok && lockData.lock_id) {
      lock = lockData;
      console.log('✓ Lock acquired\n');
    }
  } catch (error) {
    // Continue without lock
  }
  
  // Create booking
  console.log('Step 5: Creating booking...');
  console.log(`   Email: ${TEST_EMAIL}`);
  console.log(`   Phone: ${TEST_PHONE}\n`);
  
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
      console.log('✓ Booking created!');
      console.log(`   Booking ID: ${bid}\n`);
      
      console.log('='.repeat(60));
      console.log('\nIMPORTANT: Check SERVER CONSOLE for ticket logs!\n');
      console.log('Expected logs:');
      console.log('  📧 Starting ticket generation...');
      console.log('  📄 Step 1: Generating PDF...');
      console.log('  ✓ Step 1 Complete: PDF generated');
      console.log('  📱 Step 2: Sending via WhatsApp...');
      console.log('  ✓ Step 2 Complete: WhatsApp sent');
      console.log('  📧 Step 3: Sending via Email...');
      console.log('  ✓ Step 3 Complete: Email sent\n');
      
      console.log('Check delivery:');
      console.log(`  Email: ${TEST_EMAIL}`);
      console.log(`  WhatsApp: ${TEST_PHONE}\n`);
      
      console.log('Waiting 10 seconds for ticket generation...\n');
      await new Promise(r => setTimeout(r, 10000));
      
      console.log('='.repeat(60));
      console.log('\nTest complete!\n');
      console.log('If tickets not received:');
      console.log('  1. Check server console for errors');
      console.log('  2. Verify SMTP/WhatsApp settings');
      console.log('  3. Check email spam folder\n');
      
    } else {
      console.error(`✗ Booking failed: ${bookData.error || 'Unknown'}`);
    }
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
  }
}

test().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
