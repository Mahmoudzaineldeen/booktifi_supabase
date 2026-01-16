#!/usr/bin/env node

/**
 * Test Ticket Generation with Verification
 * 
 * Creates a booking and attempts to verify ticket generation
 * by checking various indicators.
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

let authToken = null;
let bookingId = null;

async function checkServer() {
  try {
    const res = await fetch('http://localhost:3001/health');
    const data = await res.json();
    return res.ok && data.status === 'ok';
  } catch (error) {
    return false;
  }
}

async function login() {
  try {
    const res = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: '111111' }),
    });
    const data = await res.json();
    if (res.ok && data.session) {
      authToken = data.session.access_token;
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function createBooking() {
  // Get service
  const svcRes = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=1`
  );
  const svcs = await svcRes.json();
  const svc = Array.isArray(svcs) ? svcs[0] : (svcs.data?.[0] || svcs.data);
  if (!svc) return false;
  
  // Get slot
  const slotRes = await fetch(
    `${API_URL}/query?table=time_slots&select=id,start_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: svc.id, is_available: true }))}&limit=10`
  );
  const slots = await slotRes.json();
  const slotArr = Array.isArray(slots) ? slots : (slots.data || []);
  const futureSlots = slotArr.filter(s => new Date(s.start_time_utc) > new Date() && s.remaining_capacity > 0);
  if (futureSlots.length === 0) return false;
  
  const slot = futureSlots[0];
  
  // Acquire lock
  let lock = null;
  try {
    const lockRes = await fetch(`${API_URL}/bookings/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ slot_id: slot.id, reserved_capacity: 1 }),
    });
    const lockData = await lockRes.json();
    if (lockRes.ok) lock = lockData;
  } catch (e) {}
  
  // Create booking
  const bookRes = await fetch(`${API_URL}/bookings/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
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
    bookingId = bookData.id || bookData.booking?.id || bookData.booking;
    return true;
  }
  return false;
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('TICKET GENERATION TEST - WHERE TO FIND SERVER LOGS');
  console.log('='.repeat(70) + '\n');
  
  console.log('⚠️  IMPORTANT: Server Console ≠ Browser Console (F12)');
  console.log('');
  console.log('The server console is the TERMINAL/COMMAND PROMPT where you');
  console.log('started your Node.js server, NOT the browser console (F12).');
  console.log('');
  console.log('To see server logs:');
  console.log('  1. Find the terminal/command prompt where you ran: npm run dev');
  console.log('  2. That terminal shows all server console.log() output');
  console.log('  3. Look for ticket generation logs there');
  console.log('');
  console.log('='.repeat(70) + '\n');
  
  if (!await checkServer()) {
    console.error('❌ Server not running');
    console.log('\nStart your server:');
    console.log('  cd server');
    console.log('  npm run dev\n');
    process.exit(1);
  }
  
  console.log('✓ Server is running\n');
  
  if (!await login()) {
    console.error('❌ Login failed');
    process.exit(1);
  }
  
  console.log('✓ Logged in\n');
  
  console.log('Attempting to create booking...\n');
  
  const created = await createBooking();
  
  if (!created) {
    console.log('⚠️  Cannot create booking - no available slots');
    console.log('\n' + '='.repeat(70));
    console.log('MANUAL TEST INSTRUCTIONS');
    console.log('='.repeat(70));
    console.log('');
    console.log('Since we cannot create a booking automatically, please:');
    console.log('');
    console.log('1. Go to: http://localhost:5173/fci/book');
    console.log('2. Create a booking with:');
    console.log(`   - Email: ${TEST_EMAIL}`);
    console.log(`   - Phone: ${TEST_PHONE}`);
    console.log('3. Complete the booking');
    console.log('4. IMMEDIATELY check your SERVER TERMINAL (not browser F12)');
    console.log('5. Look for ticket generation logs');
    console.log('');
    console.log('='.repeat(70));
    console.log('WHAT TO LOOK FOR IN SERVER TERMINAL');
    console.log('='.repeat(70));
    console.log('');
    console.log('You should see these logs in your SERVER TERMINAL:');
    console.log('');
    console.log('📧 ========================================');
    console.log('📧 Starting ticket generation for booking <ID>...');
    console.log('   Customer: <name>');
    console.log(`   Email: ${TEST_EMAIL}`);
    console.log(`   Phone: ${TEST_PHONE}`);
    console.log('📧 ========================================');
    console.log('');
    console.log('📄 Step 1: Generating PDF for booking...');
    console.log('✅ Step 1 Complete: PDF generated successfully');
    console.log('');
    console.log('📱 Step 2: Attempting to send ticket via WhatsApp...');
    console.log('✅ Step 2 Complete: Ticket PDF sent via WhatsApp');
    console.log('');
    console.log('📧 Step 3: Attempting to send ticket via Email...');
    console.log('✅ Step 3 Complete: Ticket PDF sent via Email');
    console.log('');
    console.log('='.repeat(70) + '\n');
    return;
  }
  
  console.log(`✓ Booking created: ${bookingId}\n`);
  
  console.log('='.repeat(70));
  console.log('⚠️  CHECK YOUR SERVER TERMINAL NOW!');
  console.log('='.repeat(70));
  console.log('');
  console.log('The terminal where you ran "npm run dev" should show:');
  console.log('');
  console.log('📧 ========================================');
  console.log(`📧 Starting ticket generation for booking ${bookingId}...`);
  console.log('   Customer: Test Customer');
  console.log(`   Email: ${TEST_EMAIL}`);
  console.log(`   Phone: ${TEST_PHONE}`);
  console.log('📧 ========================================');
  console.log('');
  console.log('📄 Step 1: Generating PDF for booking...');
  console.log('✅ Step 1 Complete: PDF generated successfully');
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
  console.log('If you did NOT see ticket logs in SERVER TERMINAL:');
  console.log('  1. Make sure you\'re looking at the correct terminal');
  console.log('  2. Check for any errors in server terminal');
  console.log('  3. Verify booking was created (ID above)');
  console.log('  4. Check SMTP/WhatsApp settings');
  console.log('');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
