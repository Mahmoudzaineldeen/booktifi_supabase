#!/usr/bin/env node

/**
 * Simple Ticket Sender - Uses API approach
 * 
 * This script finds a booking and provides instructions to manually
 * trigger ticket generation, or creates a new booking to test.
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'kaptifidev@gmail.com';
const FALLBACK_PHONE = '+201032560826';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('SEND TICKET TO kaptifidev@gmail.com');
  console.log('='.repeat(70) + '\n');
  
  // Check server
  try {
    await fetch('http://localhost:3001/health');
    console.log('✓ Server is running\n');
  } catch (error) {
    console.error('❌ Server not running\n');
    process.exit(1);
  }
  
  // Find booking
  console.log(`📋 Finding booking for ${TEST_EMAIL}...\n`);
  
  try {
    const res = await fetch(
      `${API_URL}/query?table=bookings&select=id,customer_name,customer_email,customer_phone,tenant_id,language&where=${encodeURIComponent(JSON.stringify({ customer_email: TEST_EMAIL, tenant_id: TEST_TENANT_ID }))}&order=created_at&desc=true&limit=1`
    );
    
    const bookings = await res.json();
    const bookingArray = Array.isArray(bookings) ? bookings : (bookings.data || []);
    
    if (bookingArray.length === 0) {
      console.error('❌ No booking found for this email\n');
      process.exit(1);
    }
    
    const booking = bookingArray[0];
    console.log('✅ Found booking:');
    console.log(`   ID: ${booking.id}`);
    console.log(`   Customer: ${booking.customer_name || 'N/A'}`);
    console.log(`   Email: ${booking.customer_email || 'N/A'}`);
    console.log(`   Phone: ${booking.customer_phone || 'N/A'}\n`);
    
    const email = booking.customer_email || TEST_EMAIL;
    const phone = booking.customer_phone || FALLBACK_PHONE;
    
    console.log('='.repeat(70));
    console.log('TICKET GENERATION');
    console.log('='.repeat(70));
    console.log('');
    console.log('Booking Details:');
    console.log(`  Booking ID: ${booking.id}`);
    console.log(`  Email: ${email}`);
    console.log(`  Phone: ${phone}`);
    console.log('');
    console.log('To send ticket, you need to run the server script:');
    console.log('');
    console.log(`  cd server`);
    console.log(`  node scripts/send-ticket-to-booking.js ${booking.id} ${email} ${phone}`);
    console.log('');
    console.log('OR manually trigger by creating a new booking via UI:');
    console.log('  http://localhost:5173/fci/book');
    console.log('');
    console.log('='.repeat(70));
    console.log('MANUAL INSTRUCTIONS');
    console.log('='.repeat(70));
    console.log('');
    console.log('Since the server script needs environment variables, here are options:');
    console.log('');
    console.log('Option 1: Run server script (requires .env in server directory)');
    console.log(`  1. cd server`);
    console.log(`  2. Make sure .env file exists with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
    console.log(`  3. node scripts/send-ticket-to-booking.js ${booking.id} ${email} ${phone}`);
    console.log('');
    console.log('Option 2: Create new booking via UI (will auto-generate tickets)');
    console.log('  1. Go to: http://localhost:5173/fci/book');
    console.log(`  2. Use email: ${email}`);
    console.log(`  3. Use phone: ${phone}`);
    console.log('  4. Complete booking');
    console.log('  5. Check SERVER TERMINAL (not browser F12) for ticket logs');
    console.log('');
    console.log('='.repeat(70) + '\n');
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
