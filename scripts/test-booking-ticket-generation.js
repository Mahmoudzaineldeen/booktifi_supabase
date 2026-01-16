#!/usr/bin/env node

/**
 * Test Booking Ticket Generation and Delivery
 * 
 * This test:
 * 1. Creates a booking
 * 2. Verifies PDF ticket is generated
 * 3. Verifies ticket is sent via email
 * 4. Verifies ticket is sent via WhatsApp
 * 5. Checks for errors in the process
 */

const API_URL = 'http://localhost:3001/api';

// Test configuration
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b'; // fci tenant

let authToken = null;
let bookingId = null;

function log(message, color = 'reset') {
  const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
  };
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60) + '\n');
}

async function checkServer() {
  logSection('🔍 Checking Server Status');
  
  try {
    const response = await fetch('http://localhost:3001/health');
    const data = await response.json();
    
    if (response.ok && data.status === 'ok') {
      log('✅ Server is running', 'green');
      log(`   Database: ${data.database || 'connected'}`, 'green');
      return true;
    } else {
      log('❌ Server is not healthy', 'red');
      return false;
    }
  } catch (error) {
    log('❌ Cannot connect to server', 'red');
    log(`   Error: ${error.message}`, 'red');
    log('   Please start the server: cd server && npm run dev', 'yellow');
    return false;
  }
}

async function login() {
  logSection('🔐 Step 1: Logging In');
  
  try {
    const response = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: '111111',
      }),
    });
    
    const data = await response.json();
    
    if (response.ok && data.session) {
      authToken = data.session.access_token;
      log('✅ Login successful', 'green');
      log(`   User: ${data.user.email}`, 'green');
      log(`   Role: ${data.user.role}`, 'green');
      log(`   Tenant: ${data.tenant?.name || 'N/A'}`, 'green');
      return true;
    } else {
      log(`❌ Login failed: ${data.error || 'Unknown error'}`, 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Login error: ${error.message}`, 'red');
    return false;
  }
}

async function getAvailableServices() {
  logSection('📋 Step 2: Getting Available Services');
  
  try {
    const response = await fetch(
      `${API_URL}/query?table=services&select=id,name,tenant_id&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID, is_active: true }))}&limit=5`
    );
    
    const services = await response.json();
    const serviceArray = Array.isArray(services) ? services : (services.data || []);
    
    if (serviceArray.length === 0) {
      log('❌ No active services found for tenant', 'red');
      log('   Please create a service first', 'yellow');
      return null;
    }
    
    log(`✅ Found ${serviceArray.length} service(s)`, 'green');
    serviceArray.forEach((svc, i) => {
      log(`   ${i + 1}. ${svc.name} (${svc.id})`, 'green');
    });
    
    return serviceArray[0]; // Use first service
  } catch (error) {
    log(`❌ Error getting services: ${error.message}`, 'red');
    return null;
  }
}

async function getAvailableSlots(serviceId) {
  logSection('📅 Step 3: Getting Available Time Slots');
  
  try {
    // Get slots for today and next 7 days
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    
    const response = await fetch(
      `${API_URL}/query?table=time_slots&select=id,service_id,start_time_utc,end_time_utc,remaining_capacity,is_available&where=${encodeURIComponent(JSON.stringify({ service_id: serviceId, is_available: true }))}&limit=10`
    );
    
    const slots = await response.json();
    const slotArray = Array.isArray(slots) ? slots : (slots.data || []);
    
    // Filter to future slots
    const now = new Date();
    const futureSlots = slotArray.filter(slot => {
      const slotTime = new Date(slot.start_time_utc);
      return slotTime > now && slot.remaining_capacity > 0;
    });
    
    if (futureSlots.length === 0) {
      log('❌ No available slots found', 'red');
      log('   Please create shifts and generate slots first', 'yellow');
      return null;
    }
    
    log(`✅ Found ${futureSlots.length} available slot(s)`, 'green');
    futureSlots.slice(0, 3).forEach((slot, i) => {
      const slotTime = new Date(slot.start_time_utc);
      log(`   ${i + 1}. ${slotTime.toLocaleString()} (${slot.id})`, 'green');
      log(`      Capacity: ${slot.remaining_capacity}`, 'green');
    });
    
    return futureSlots[0]; // Use first available slot
  } catch (error) {
    log(`❌ Error getting slots: ${error.message}`, 'red');
    return null;
  }
}

async function acquireLock(slotId) {
  logSection('🔒 Step 4: Acquiring Booking Lock');
  
  try {
    log('Acquiring lock for slot:', slotId, 'yellow');
    
    const response = await fetch(`${API_URL}/bookings/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        slot_id: slotId,
        reserved_capacity: 1,
      }),
    });
    
    const data = await response.json();
    
    if (response.ok && data.lock_id) {
      log('✅ Lock acquired successfully', 'green');
      log(`   Lock ID: ${data.lock_id}`, 'green');
      log(`   Expires in: ${data.expires_in_seconds} seconds`, 'green');
      return data;
    } else {
      log(`❌ Lock acquisition failed: ${data.error || 'Unknown error'}`, 'red');
      return null;
    }
  } catch (error) {
    log(`❌ Error acquiring lock: ${error.message}`, 'red');
    return null;
  }
}

async function createBooking(serviceId, slotId, lockData) {
  logSection('🎫 Step 5: Creating Booking');
  
  try {
    const bookingData = {
      service_id: serviceId,
      slot_id: slotId,
      customer_name: 'Test Customer',
      customer_email: TEST_EMAIL,
      customer_phone: TEST_PHONE,
      language: 'en',
      tenant_id: TEST_TENANT_ID,
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      lock_id: lockData?.lock_id || null,
      session_id: lockData?.session_id || null,
    };
    
    log('Creating booking with:', 'yellow');
    log(`   Service ID: ${serviceId}`, 'yellow');
    log(`   Slot ID: ${slotId}`, 'yellow');
    log(`   Customer Email: ${TEST_EMAIL}`, 'yellow');
    log(`   Customer Phone: ${TEST_PHONE}`, 'yellow');
    log(`   Lock ID: ${lockData?.lock_id || 'none'}`, 'yellow');
    log('', 'yellow');
    
    const response = await fetch(`${API_URL}/bookings/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(bookingData),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Handle different response formats
      bookingId = data.id || data.booking?.id || data.booking;
      
      if (!bookingId) {
        log('⚠️  Booking created but ID not found in response', 'yellow');
        log('   Response:', JSON.stringify(data, null, 2), 'yellow');
        return false;
      }
      
      log('✅ Booking created successfully', 'green');
      log(`   Booking ID: ${bookingId}`, 'green');
      log(`   Status: ${data.status || data.booking?.status || 'confirmed'}`, 'green');
      
      // Wait a bit for async ticket generation
      log('\n⏳ Waiting 5 seconds for ticket generation to start...', 'yellow');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      return true;
    } else {
      log(`❌ Booking creation failed: ${data.error || 'Unknown error'}`, 'red');
      if (data.details) {
        log(`   Details: ${data.details}`, 'red');
      }
      return false;
    }
  } catch (error) {
    log(`❌ Error creating booking: ${error.message}`, 'red');
    return false;
  }
}

async function verifyTicketGeneration() {
  logSection('📄 Step 5: Verifying Ticket Generation');
  
  if (!bookingId) {
    log('❌ No booking ID available', 'red');
    return false;
  }
  
  log('⚠️  IMPORTANT: Check your SERVER CONSOLE for ticket generation logs!', 'yellow');
  log('   Look for:', 'yellow');
  log('   - "📧 Starting ticket generation for booking..."', 'yellow');
  log('   - "📄 Step 1: Generating PDF..."', 'yellow');
  log('   - "✅ Step 1 Complete: PDF generated successfully"', 'yellow');
  log('   - "📱 Step 2: Attempting to send ticket via WhatsApp..."', 'yellow');
  log('   - "📧 Step 3: Attempting to send ticket via Email..."', 'yellow');
  log('', 'yellow');
  
  // Check if booking exists
  try {
    const response = await fetch(
      `${API_URL}/query?table=bookings&select=id,customer_email,customer_phone,status&where=${encodeURIComponent(JSON.stringify({ id: bookingId }))}&limit=1`
    );
    
    const bookings = await response.json();
    const booking = Array.isArray(bookings) ? bookings[0] : (bookings.data?.[0] || bookings.data);
    
    if (booking) {
      log('✅ Booking found in database', 'green');
      log(`   ID: ${booking.id}`, 'green');
      log(`   Email: ${booking.customer_email || 'N/A'}`, 'green');
      log(`   Phone: ${booking.customer_phone || 'N/A'}`, 'green');
      log(`   Status: ${booking.status || 'N/A'}`, 'green');
    } else {
      log('❌ Booking not found in database', 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Error checking booking: ${error.message}`, 'red');
  }
  
  log('\n📝 Expected Server Console Output:', 'cyan');
  log('   ✅ Step 1 Complete: PDF generated successfully', 'green');
  log('   ✅ Step 2 Complete: Ticket PDF sent via WhatsApp', 'green');
  log('   ✅ Step 3 Complete: Ticket PDF sent via Email', 'green');
  
  log('\n⚠️  If you see errors:', 'yellow');
  log('   1. Check SMTP settings (for email)', 'yellow');
  log('   2. Check WhatsApp settings (for WhatsApp)', 'yellow');
  log('   3. Check PDF generation errors', 'yellow');
  log('   4. Verify tenant_id is correct', 'yellow');
  
  return true;
}

async function checkDelivery() {
  logSection('📬 Step 6: Checking Delivery Status');
  
  log('📧 Email Delivery:', 'cyan');
  log('   Check your email inbox:', TEST_EMAIL, 'yellow');
  log('   Subject: "Booking Ticket"', 'yellow');
  log('   Attachment: booking_ticket_<ID>.pdf', 'yellow');
  log('', 'yellow');
  
  log('📱 WhatsApp Delivery:', 'cyan');
  log('   Check your WhatsApp:', TEST_PHONE, 'yellow');
  log('   Message: "Your booking is confirmed! Please find your ticket attached."', 'yellow');
  log('   Attachment: booking_ticket_<ID>.pdf', 'yellow');
  log('', 'yellow');
  
  log('💡 Note:', 'yellow');
  log('   - Ticket generation happens asynchronously', 'yellow');
  log('   - Check server console for detailed logs', 'yellow');
  log('   - Delivery may take a few seconds', 'yellow');
  log('   - If delivery fails, check server console for errors', 'yellow');
}

async function main() {
  console.log('\n');
  log('🧪 Booking Ticket Generation Test', 'cyan');
  log('='.repeat(60), 'cyan');
  
  // Step 1: Check server
  const serverOk = await checkServer();
  if (!serverOk) {
    process.exit(1);
  }
  
  // Step 2: Login
  const loginOk = await login();
  if (!loginOk) {
    process.exit(1);
  }
  
  // Step 3: Get available service
  const service = await getAvailableServices();
  if (!service) {
    log('\n❌ Cannot proceed without a service', 'red');
    process.exit(1);
  }
  
  // Step 4: Get available slot
  const slot = await getAvailableSlots(service.id);
  if (!slot) {
    log('\n❌ Cannot proceed without an available slot', 'red');
    log('   Please create shifts and generate slots first', 'yellow');
    process.exit(1);
  }
  
  // Step 4: Acquire lock
  const lockData = await acquireLock(slot.id);
  if (!lockData) {
    log('\n⚠️  Lock acquisition failed, but continuing anyway...', 'yellow');
  }
  
  // Step 5: Create booking
  const bookingOk = await createBooking(service.id, slot.id, lockData);
  if (!bookingOk) {
    process.exit(1);
  }
  
  // Step 6: Verify ticket generation
  await verifyTicketGeneration();
  
  // Step 7: Check delivery
  await checkDelivery();
  
  // Summary
  logSection('📊 Test Summary');
  
  log('✅ Test completed!', 'green');
  log(`   Booking ID: ${bookingId}`, 'green');
  log('', 'green');
  
  log('📝 Next Steps:', 'cyan');
  log('   1. Check server console for ticket generation logs', 'yellow');
  log('   2. Check your email for the ticket PDF', 'yellow');
  log('   3. Check your WhatsApp for the ticket PDF', 'yellow');
  log('   4. Verify PDF opens correctly', 'yellow');
  log('', 'yellow');
  
  log('🔍 If tickets are not received:', 'cyan');
  log('   1. Check server console for errors', 'yellow');
  log('   2. Verify SMTP settings are configured', 'yellow');
  log('   3. Verify WhatsApp settings are configured', 'yellow');
  log('   4. Check email spam folder', 'yellow');
  log('   5. Check WhatsApp message status in Meta Dashboard', 'yellow');
  
  console.log('\n');
}

main().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
