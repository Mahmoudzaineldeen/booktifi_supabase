#!/usr/bin/env node

/**
 * Complete Ticket Generation Test
 * 
 * Creates a booking and verifies ticket generation by:
 * 1. Creating a booking
 * 2. Waiting for ticket generation
 * 3. Checking booking status
 * 4. Providing detailed diagnostics
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

let authToken = null;
let createdBookingId = null;

async function checkServer() {
  try {
    const res = await fetch('http://localhost:3001/health');
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      console.log('✓ Server is running\n');
      return true;
    }
    return false;
  } catch (error) {
    console.error('✗ Server not running');
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
      console.log('✓ Logged in\n');
      return true;
    }
    console.error('✗ Login failed:', data.error);
    return false;
  } catch (error) {
    console.error('✗ Login error:', error.message);
    return false;
  }
}

async function getServiceAndSlot() {
  // Get service
  const svcRes = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=1`
  );
  const svcs = await svcRes.json();
  const svc = Array.isArray(svcs) ? svcs[0] : (svcs.data?.[0] || svcs.data);
  
  if (!svc) {
    console.error('✗ No services found');
    return null;
  }
  console.log(`✓ Service: ${svc.name}`);
  
  // Get slot
  const slotRes = await fetch(
    `${API_URL}/query?table=time_slots&select=id,start_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: svc.id, is_available: true }))}&limit=10`
  );
  const slots = await slotRes.json();
  const slotArr = Array.isArray(slots) ? slots : (slots.data || []);
  const futureSlots = slotArr.filter(s => new Date(s.start_time_utc) > new Date() && s.remaining_capacity > 0);
  
  if (futureSlots.length === 0) {
    console.error('✗ No available slots');
    return null;
  }
  
  const slot = futureSlots[0];
  console.log(`✓ Slot: ${new Date(slot.start_time_utc).toLocaleString()}\n`);
  
  return { service: svc, slot };
}

async function acquireLock(slotId) {
  try {
    const res = await fetch(`${API_URL}/bookings/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ slot_id: slotId, reserved_capacity: 1 }),
    });
    const data = await res.json();
    if (res.ok && data.lock_id) {
      return data;
    }
  } catch (error) {
    // Continue without lock
  }
  return null;
}

async function createBooking(serviceId, slotId, lockData) {
  console.log('Creating booking...');
  console.log(`  Email: ${TEST_EMAIL}`);
  console.log(`  Phone: ${TEST_PHONE}\n`);
  
  try {
    const res = await fetch(`${API_URL}/bookings/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        service_id: serviceId,
        slot_id: slotId,
        tenant_id: TEST_TENANT_ID,
        customer_name: 'Test Customer',
        customer_email: TEST_EMAIL,
        customer_phone: TEST_PHONE,
        visitor_count: 1,
        adult_count: 1,
        child_count: 0,
        language: 'en',
        lock_id: lockData?.lock_id || null,
        session_id: lockData?.session_id || null,
      }),
    });
    
    const data = await res.json();
    
    if (res.ok) {
      const bid = data.id || data.booking?.id || data.booking;
      if (bid) {
        createdBookingId = bid;
        console.log(`✓ Booking created: ${bid}\n`);
        return true;
      } else {
        console.error('✗ Booking created but no ID returned');
        console.log('Response:', JSON.stringify(data, null, 2));
        return false;
      }
    } else {
      console.error(`✗ Booking failed: ${data.error || 'Unknown'}`);
      if (data.details) console.error(`  Details: ${data.details}`);
      return false;
    }
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    return false;
  }
}

async function verifyBooking() {
  if (!createdBookingId) {
    console.error('✗ No booking ID to verify');
    return false;
  }
  
  console.log('Verifying booking in database...');
  
  try {
    const res = await fetch(
      `${API_URL}/query?table=bookings&select=id,customer_name,customer_email,customer_phone,status,created_at&where=${encodeURIComponent(JSON.stringify({ id: createdBookingId }))}&limit=1`
    );
    const bookings = await res.json();
    const booking = Array.isArray(bookings) ? bookings[0] : (bookings.data?.[0] || bookings.data);
    
    if (booking) {
      console.log('✓ Booking found in database:');
      console.log(`  ID: ${booking.id}`);
      console.log(`  Customer: ${booking.customer_name || 'N/A'}`);
      console.log(`  Email: ${booking.customer_email || 'N/A'}`);
      console.log(`  Phone: ${booking.customer_phone || 'N/A'}`);
      console.log(`  Status: ${booking.status || 'N/A'}`);
      console.log(`  Created: ${booking.created_at || 'N/A'}\n`);
      
      // Check if email and phone are present (required for ticket sending)
      if (!booking.customer_email && !booking.customer_phone) {
        console.error('⚠️  WARNING: Booking has no email or phone!');
        console.error('   Tickets cannot be sent without contact information.\n');
        return false;
      }
      
      if (!booking.customer_email) {
        console.warn('⚠️  WARNING: No email - email ticket will not be sent');
      }
      
      if (!booking.customer_phone) {
        console.warn('⚠️  WARNING: No phone - WhatsApp ticket will not be sent');
      }
      
      return true;
    } else {
      console.error('✗ Booking not found in database');
      return false;
    }
  } catch (error) {
    console.error(`✗ Error verifying booking: ${error.message}`);
    return false;
  }
}

async function checkTicketGeneration() {
  console.log('='.repeat(60));
  console.log('TICKET GENERATION VERIFICATION');
  console.log('='.repeat(60));
  console.log('');
  
  console.log('📝 IMPORTANT: Ticket generation happens asynchronously');
  console.log('   The server processes tickets AFTER the booking response is sent.');
  console.log('   Check your SERVER CONSOLE for these logs:\n');
  
  console.log('Expected Server Console Output:');
  console.log('  📧 ========================================');
  console.log(`  📧 Starting ticket generation for booking ${createdBookingId}...`);
  console.log('     Customer: Test Customer');
  console.log(`     Email: ${TEST_EMAIL}`);
  console.log(`     Phone: ${TEST_PHONE}`);
  console.log('  📧 ========================================');
  console.log('');
  console.log('  📄 Step 1: Generating PDF for booking...');
  console.log('  ✅ Step 1 Complete: PDF generated successfully (XXXXX bytes)');
  console.log('');
  console.log('  📱 Step 2: Attempting to send ticket via WhatsApp...');
  console.log('  ✅ Step 2 Complete: Ticket PDF sent via WhatsApp');
  console.log('');
  console.log('  📧 Step 3: Attempting to send ticket via Email...');
  console.log('  ✅ Step 3 Complete: Ticket PDF sent via Email');
  console.log('');
  console.log('='.repeat(60));
  console.log('');
  
  console.log('📬 Check Delivery:');
  console.log(`  📧 Email: ${TEST_EMAIL}`);
  console.log(`     - Check inbox for "Booking Ticket" email`);
  console.log(`     - Attachment: booking_ticket_${createdBookingId}.pdf`);
  console.log(`     - Check spam folder if not in inbox`);
  console.log('');
  console.log(`  📱 WhatsApp: ${TEST_PHONE}`);
  console.log(`     - Check WhatsApp for message`);
  console.log(`     - Message: "Your booking is confirmed! Please find your ticket attached."`);
  console.log(`     - Attachment: PDF ticket`);
  console.log('');
  
  console.log('🔍 Troubleshooting:');
  console.log('');
  console.log('If you don\'t see ticket logs in server console:');
  console.log('  1. Check if booking was actually created (ID above)');
  console.log('  2. Verify booking has customer_email and customer_phone');
  console.log('  3. Check server console for ANY errors');
  console.log('  4. Verify tenant_id is correct');
  console.log('');
  console.log('If tickets are not received:');
  console.log('  1. Check server console for Step 2/3 errors');
  console.log('  2. Verify SMTP settings (for email)');
  console.log('  3. Verify WhatsApp settings (for WhatsApp)');
  console.log('  4. Check email spam folder');
  console.log('  5. Check Meta Business Dashboard for WhatsApp status');
  console.log('');
}

async function main() {
  console.log('\n=== Complete Ticket Generation Test ===\n');
  
  // Step 1: Check server
  if (!await checkServer()) {
    process.exit(1);
  }
  
  // Step 2: Login
  if (!await login()) {
    process.exit(1);
  }
  
  // Step 3: Get service and slot
  const serviceSlot = await getServiceAndSlot();
  if (!serviceSlot) {
    console.log('\n⚠️  Cannot create booking - no available slots');
    console.log('   Please create shifts and generate slots first\n');
    process.exit(1);
  }
  
  // Step 4: Acquire lock
  const lockData = await acquireLock(serviceSlot.slot.id);
  
  // Step 5: Create booking
  if (!await createBooking(serviceSlot.service.id, serviceSlot.slot.id, lockData)) {
    process.exit(1);
  }
  
  // Step 6: Wait for ticket generation
  console.log('⏳ Waiting 5 seconds for ticket generation to start...\n');
  await new Promise(r => setTimeout(r, 5000));
  
  // Step 7: Verify booking
  await verifyBooking();
  
  // Step 8: Check ticket generation
  await checkTicketGeneration();
  
  console.log('='.repeat(60));
  console.log('Test Complete!');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Booking ID: ${createdBookingId}`);
  console.log('Next: Check your SERVER CONSOLE for ticket generation logs\n');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
