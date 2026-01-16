#!/usr/bin/env node

/**
 * Send Ticket to kaptifidev@gmail.com
 * 
 * Finds a booking for kaptifidev@gmail.com and manually triggers
 * ticket generation. Falls back to +201032560826 if needed.
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'kaptifidev@gmail.com';
const FALLBACK_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function findBooking() {
  console.log(`\n📋 Finding booking for ${TEST_EMAIL}...\n`);
  
  try {
    const res = await fetch(
      `${API_URL}/query?table=bookings&select=id,customer_name,customer_email,customer_phone,tenant_id,language,status,created_at&where=${encodeURIComponent(JSON.stringify({ customer_email: TEST_EMAIL, tenant_id: TEST_TENANT_ID }))}&order=created_at&desc=true&limit=1`
    );
    
    const bookings = await res.json();
    const bookingArray = Array.isArray(bookings) ? bookings : (bookings.data || []);
    
    if (bookingArray.length === 0) {
      console.log('❌ No booking found for this email\n');
      return null;
    }
    
    const booking = bookingArray[0];
    console.log('✅ Found booking:');
    console.log(`   ID: ${booking.id}`);
    console.log(`   Customer: ${booking.customer_name || 'N/A'}`);
    console.log(`   Email: ${booking.customer_email || 'N/A'}`);
    console.log(`   Phone: ${booking.customer_phone || 'N/A'}`);
    console.log(`   Status: ${booking.status || 'N/A'}`);
    console.log(`   Created: ${booking.created_at || 'N/A'}\n`);
    
    return booking;
  } catch (error) {
    console.error(`❌ Error finding booking: ${error.message}\n`);
    return null;
  }
}

async function sendTicket(bookingId, email, phone, tenantId, language = 'en') {
  console.log('='.repeat(70));
  console.log('🎫 SENDING TICKET');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Booking ID: ${bookingId}`);
  console.log(`Email: ${email}`);
  console.log(`Phone: ${phone}`);
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`Language: ${language}`);
  console.log('');
  
  // We need to use the server's ticket generation code
  // Since we can't directly import server modules from here,
  // we'll create an API endpoint or use a server script
  
  console.log('⚠️  To send tickets, we need to use the server\'s ticket generation code.');
  console.log('   Creating a server script to handle this...\n');
  
  return false;
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('SEND TICKET TO kaptifidev@gmail.com');
  console.log('='.repeat(70));
  
  // Check server
  try {
    await fetch('http://localhost:3001/health');
    console.log('\n✓ Server is running\n');
  } catch (error) {
    console.error('\n❌ Server not running\n');
    process.exit(1);
  }
  
  // Find booking
  const booking = await findBooking();
  
  if (!booking) {
    console.log('Cannot proceed without a booking.\n');
    process.exit(1);
  }
  
  const email = booking.customer_email || TEST_EMAIL;
  const phone = booking.customer_phone || FALLBACK_PHONE;
  const tenantId = booking.tenant_id || TEST_TENANT_ID;
  const language = (booking.language === 'ar' || booking.language === 'en') 
    ? booking.language 
    : 'en';
  
  console.log('='.repeat(70));
  console.log('TICKET GENERATION DETAILS');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Using email: ${email}`);
  console.log(`Using phone: ${phone}`);
  console.log(`Using tenant: ${tenantId}`);
  console.log(`Using language: ${language}`);
  console.log('');
  
  // Try to send ticket
  const success = await sendTicket(
    booking.id,
    email,
    phone,
    tenantId,
    language
  );
  
  if (!success) {
    console.log('Creating server script to send ticket...\n');
    // We'll create a server script that can do this
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
