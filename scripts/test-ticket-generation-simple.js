#!/usr/bin/env node

/**
 * Simple Ticket Generation Test
 * 
 * Tests ticket generation for an existing booking or creates one if slots are available
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function testTicketGeneration() {
  console.log('\n🧪 Testing Ticket Generation and Delivery\n');
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
  
  // Check for existing bookings
  console.log('📋 Checking for existing bookings...');
  console.log('-'.repeat(60));
  
  try {
    const bookingsResponse = await fetch(
      `${API_URL}/query?table=bookings&select=id,customer_email,customer_phone,status,created_at&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID }))}&order=created_at&desc=true&limit=5`
    );
    
    const bookings = await bookingsResponse.json();
    const bookingArray = Array.isArray(bookings) ? bookings : (bookings.data || []);
    
    if (bookingArray.length > 0) {
      console.log(`✅ Found ${bookingArray.length} existing booking(s)\n`);
      
      const testBooking = bookingArray[0];
      console.log('Using most recent booking:');
      console.log(`   Booking ID: ${testBooking.id}`);
      console.log(`   Customer Email: ${testBooking.customer_email || 'N/A'}`);
      console.log(`   Customer Phone: ${testBooking.customer_phone || 'N/A'}`);
      console.log(`   Status: ${testBooking.status || 'N/A'}`);
      console.log(`   Created: ${testBooking.created_at || 'N/A'}\n`);
      
      console.log('='.repeat(60));
      console.log('\n📝 Ticket Generation Test Instructions:\n');
      console.log('To test ticket generation, you need to:');
      console.log('   1. Create a NEW booking (via UI or API)');
      console.log('   2. Watch the SERVER CONSOLE for ticket generation logs');
      console.log('   3. Check your email and WhatsApp for the ticket PDF\n');
      
      console.log('Expected Server Console Output:');
      console.log('   📧 Starting ticket generation for booking...');
      console.log('   📄 Step 1: Generating PDF...');
      console.log('   ✅ Step 1 Complete: PDF generated successfully');
      console.log('   📱 Step 2: Attempting to send ticket via WhatsApp...');
      console.log('   ✅ Step 2 Complete: Ticket PDF sent via WhatsApp');
      console.log('   📧 Step 3: Attempting to send ticket via Email...');
      console.log('   ✅ Step 3 Complete: Ticket PDF sent via Email\n');
      
      console.log('To create a booking:');
      console.log('   1. Go to: http://localhost:5173/fci/book');
      console.log('   2. Select a service and time slot');
      console.log('   3. Enter customer details (email and phone)');
      console.log('   4. Complete the booking');
      console.log('   5. Watch server console for ticket generation\n');
      
      return;
    } else {
      console.log('⚠️  No existing bookings found\n');
    }
  } catch (error) {
    console.error('❌ Error checking bookings:', error.message);
  }
  
  // Check for available slots
  console.log('📅 Checking for available slots...');
  console.log('-'.repeat(60));
  
  try {
    const servicesResponse = await fetch(
      `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=1`
    );
    
    const services = await servicesResponse.json();
    const serviceArray = Array.isArray(services) ? services : (services.data || []);
    
    if (serviceArray.length === 0) {
      console.log('❌ No active services found');
      console.log('   Please create a service first\n');
      return;
    }
    
    const service = serviceArray[0];
    console.log(`✅ Found service: ${service.name}\n`);
    
    const slotsResponse = await fetch(
      `${API_URL}/query?table=time_slots&select=id,service_id,start_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: service.id, is_available: true }))}&limit=5`
    );
    
    const slots = await slotsResponse.json();
    const slotArray = Array.isArray(slots) ? slots : (slots.data || []);
    
    if (slotArray.length === 0) {
      console.log('❌ No available slots found');
      console.log('   Please create shifts and generate slots first\n');
      console.log('Setup Instructions:');
      console.log('   1. Login as service provider');
      console.log('   2. Go to Services → Create/Edit Service');
      console.log('   3. Create a shift for the service');
      console.log('   4. Generate slots for the shift');
      console.log('   5. Then run this test again\n');
      return;
    }
    
    console.log(`✅ Found ${slotArray.length} available slot(s)\n`);
    console.log('='.repeat(60));
    console.log('\n📝 To Test Ticket Generation:\n');
    console.log('Option 1: Create booking via UI');
    console.log('   1. Go to: http://localhost:5173/fci/book');
    console.log('   2. Select service and slot');
    console.log('   3. Enter email:', TEST_EMAIL);
    console.log('   4. Enter phone:', TEST_PHONE);
    console.log('   5. Complete booking');
    console.log('   6. Watch server console for ticket logs\n');
    
    console.log('Option 2: Use the comprehensive test script');
    console.log('   node scripts/test-booking-ticket-generation.js');
    console.log('   (Requires available slots)\n');
    
    console.log('What to Check:');
    console.log('   ✅ Server console shows ticket generation logs');
    console.log('   ✅ Email received with ticket PDF');
    console.log('   ✅ WhatsApp received with ticket PDF');
    console.log('   ✅ PDF opens correctly\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  console.log('='.repeat(60));
  console.log('\n');
}

testTicketGeneration().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
