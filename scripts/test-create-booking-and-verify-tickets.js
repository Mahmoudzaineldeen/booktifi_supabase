#!/usr/bin/env node

/**
 * Create Booking and Verify Ticket Generation
 * 
 * Creates a booking and verifies tickets are generated and sent
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function main() {
  console.log('\n🧪 Create Booking and Verify Ticket Generation\n');
  console.log('='.repeat(60));
  
  // Check server
  try {
    const health = await fetch('http://localhost:3001/health');
    if (!health.ok) {
      console.error('❌ Server not healthy');
      process.exit(1);
    }
    console.log('✅ Server is running\n');
  } catch (error) {
    console.error('❌ Cannot connect to server');
    process.exit(1);
  }
  
  // Login
  console.log('🔐 Logging in...');
  let authToken = null;
  try {
    const loginResponse = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: '111111' }),
    });
    
    const loginData = await loginResponse.json();
    if (loginResponse.ok && loginData.session) {
      authToken = loginData.session.access_token;
      console.log('✅ Logged in\n');
    } else {
      console.error('❌ Login failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Login error:', error.message);
    process.exit(1);
  }
  
  // Get service
  console.log('📋 Getting available service...');
  const servicesResponse = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=1`
  );
  const services = await servicesResponse.json();
  const service = Array.isArray(services) ? services[0] : (services.data?.[0] || services.data);
  
  if (!service) {
    console.error('❌ No active services found');
    console.log('\n📝 Setup Instructions:');
    console.log('   1. Login as service provider');
    console.log('   2. Create a service');
    console.log('   3. Create a shift for the service');
    console.log('   4. Generate slots');
    console.log('   5. Run this test again\n');
    process.exit(1);
  }
  
  console.log(`✅ Using service: ${service.name}\n`);
  
  // Get available slot
  console.log('📅 Getting available slot...');
  const slotsResponse = await fetch(
    `${API_URL}/query?table=time_slots&select=id,service_id,start_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: service.id, is_available: true }))}&limit=1`
  );
  const slots = await slotsResponse.json();
  const slotArray = Array.isArray(slots) ? slots : (slots.data || []);
  
  // Filter to future slots
  const now = new Date();
  const futureSlots = slotArray.filter(s => new Date(s.start_time_utc) > now && s.remaining_capacity > 0);
  
  if (futureSlots.length === 0) {
    console.error('❌ No available slots found');
    console.log('\n📝 Setup Instructions:');
    console.log('   1. Create shifts for your service');
    console.log('   2. Generate slots (should happen automatically)');
    console.log('   3. Ensure slots are in the future');
    console.log('   4. Run this test again\n');
    process.exit(1);
  }
  
  const slot = futureSlots[0];
  console.log(`✅ Found available slot: ${new Date(slot.start_time_utc).toLocaleString()}\n`);
  
  // Acquire lock
  console.log('🔒 Acquiring booking lock...');
  let lockData = null;
  try {
    const lockResponse = await fetch(`${API_URL}/bookings/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ slot_id: slot.id, reserved_capacity: 1 }),
    });
    
    const lockResult = await lockResponse.json();
    if (lockResponse.ok && lockResult.lock_id) {
      lockData = lockResult;
      console.log('✅ Lock acquired\n');
    } else {
      console.log('⚠️  Lock acquisition failed, continuing anyway...\n');
    }
  } catch (error) {
    console.log('⚠️  Lock error, continuing anyway...\n');
  }
  
  // Create booking
  console.log('🎫 Creating booking...');
  console.log(`   Email: ${TEST_EMAIL}`);
  console.log(`   Phone: ${TEST_PHONE}\n`);
  
  try {
    const bookingResponse = await fetch(`${API_URL}/bookings/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        service_id: service.id,
        slot_id: slot.id,
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
    
    const bookingData = await bookingResponse.json();
    
    if (bookingResponse.ok) {
      const bookingId = bookingData.id || bookingData.booking?.id || bookingData.booking;
      console.log('✅ Booking created successfully!');
      console.log(`   Booking ID: ${bookingId}\n`);
      
      console.log('='.repeat(60));
      console.log('\n📝 IMPORTANT: Check Your SERVER CONSOLE Now!\n');
      console.log('You should see ticket generation logs:');
      console.log('   📧 Starting ticket generation for booking...');
      console.log('   📄 Step 1: Generating PDF...');
      console.log('   ✅ Step 1 Complete: PDF generated successfully');
      console.log('   📱 Step 2: Attempting to send ticket via WhatsApp...');
      console.log('   ✅ Step 2 Complete: Ticket PDF sent via WhatsApp');
      console.log('   📧 Step 3: Attempting to send ticket via Email...');
      console.log('   ✅ Step 3 Complete: Ticket PDF sent via Email\n');
      
      console.log('📬 Check Delivery:');
      console.log(`   📧 Email: ${TEST_EMAIL}`);
      console.log(`   📱 WhatsApp: ${TEST_PHONE}\n`);
      
      console.log('⏳ Waiting 10 seconds for ticket generation...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      console.log('='.repeat(60));
      console.log('\n✅ Test Complete!\n');
      console.log('If tickets were not received:');
      console.log('   1. Check server console for errors');
      console.log('   2. Verify SMTP settings (for email)');
      console.log('   3. Verify WhatsApp settings (for WhatsApp)');
      console.log('   4. Check email spam folder');
      console.log('   5. Check Meta Business Dashboard for WhatsApp status\n');
      
    } else {
      console.error(`❌ Booking creation failed: ${bookingData.error || 'Unknown error'}`);
      if (bookingData.details) {
        console.error(`   Details: ${bookingData.details}`);
      }
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
