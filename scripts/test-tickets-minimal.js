#!/usr/bin/env node

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function test() {
  console.log('Testing Booking Ticket Generation...');
  console.log('');
  
  // Check server
  const health = await fetch('http://localhost:3001/health');
  if (!health.ok) {
    console.error('Server not healthy');
    return;
  }
  console.log('Server OK');
  
  // Login
  const loginRes = await fetch(`${API_URL}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: '111111' }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.session) {
    console.error('Login failed:', loginData.error);
    return;
  }
  const token = loginData.session.access_token;
  console.log('Logged in');
  
  // Get service
  const svcRes = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=1`
  );
  const svcs = await svcRes.json();
  const svc = Array.isArray(svcs) ? svcs[0] : (svcs.data?.[0] || svcs.data);
  if (!svc) {
    console.error('No services found');
    return;
  }
  console.log('Service:', svc.name);
  
  // Get slot
  const slotRes = await fetch(
    `${API_URL}/query?table=time_slots&select=id,start_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: svc.id, is_available: true }))}&limit=10`
  );
  const slots = await slotRes.json();
  const slotArr = Array.isArray(slots) ? slots : (slots.data || []);
  const futureSlots = slotArr.filter(s => new Date(s.start_time_utc) > new Date() && s.remaining_capacity > 0);
  
  if (futureSlots.length === 0) {
    console.error('No available slots');
    console.log('');
    console.log('SETUP REQUIRED:');
    console.log('1. Create shifts for service');
    console.log('2. Generate slots');
    console.log('3. Run test again');
    return;
  }
  
  const slot = futureSlots[0];
  console.log('Slot found:', new Date(slot.start_time_utc).toLocaleString());
  
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
  console.log('');
  console.log('Creating booking...');
  console.log('Email:', TEST_EMAIL);
  console.log('Phone:', TEST_PHONE);
  console.log('');
  
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
    console.log('SUCCESS: Booking created!');
    console.log('Booking ID:', bid);
    console.log('');
    console.log('='.repeat(60));
    console.log('CHECK SERVER CONSOLE NOW!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Look for these logs:');
    console.log('  📧 Starting ticket generation...');
    console.log('  📄 Step 1: Generating PDF...');
    console.log('  ✅ Step 1 Complete: PDF generated');
    console.log('  📱 Step 2: Sending via WhatsApp...');
    console.log('  ✅ Step 2 Complete: WhatsApp sent');
    console.log('  📧 Step 3: Sending via Email...');
    console.log('  ✅ Step 3 Complete: Email sent');
    console.log('');
    console.log('Check delivery:');
    console.log('  Email:', TEST_EMAIL);
    console.log('  WhatsApp:', TEST_PHONE);
    console.log('');
    console.log('Waiting 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));
    console.log('');
    console.log('Test complete!');
  } else {
    console.error('FAILED:', bookData.error || 'Unknown error');
    if (bookData.details) console.error('Details:', bookData.details);
  }
}

test().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
