#!/usr/bin/env node

/**
 * Diagnose Why Tickets Aren't Being Sent
 * 
 * Checks recent bookings and verifies ticket generation conditions
 */

const API_URL = 'http://localhost:3001/api';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('TICKET GENERATION DIAGNOSIS');
  console.log('='.repeat(70) + '\n');
  
  // Check server
  try {
    await fetch('http://localhost:3001/health');
    console.log('✓ Server is running\n');
  } catch (error) {
    console.error('❌ Server not running\n');
    process.exit(1);
  }
  
  // Get recent bookings
  console.log('📋 Checking recent bookings...\n');
  try {
    const res = await fetch(
      `${API_URL}/query?table=bookings&select=id,customer_name,customer_email,customer_phone,status,created_at,tenant_id&where=${encodeURIComponent(JSON.stringify({ tenant_id: TEST_TENANT_ID }))}&order=created_at&desc=true&limit=5`
    );
    
    const bookings = await res.json();
    const bookingArray = Array.isArray(bookings) ? bookings : (bookings.data || []);
    
    if (bookingArray.length === 0) {
      console.log('No bookings found.\n');
      return;
    }
    
    console.log(`Found ${bookingArray.length} recent booking(s):\n`);
    
    bookingArray.forEach((booking, index) => {
      console.log(`${index + 1}. Booking ID: ${booking.id}`);
      console.log(`   Customer: ${booking.customer_name || 'N/A'}`);
      console.log(`   Email: ${booking.customer_email || 'NOT PROVIDED ❌'}`);
      console.log(`   Phone: ${booking.customer_phone || 'NOT PROVIDED ❌'}`);
      console.log(`   Status: ${booking.status || 'N/A'}`);
      console.log(`   Created: ${booking.created_at || 'N/A'}`);
      
      // Check ticket generation conditions
      console.log('');
      console.log('   Ticket Generation Status:');
      
      if (!booking.customer_email && !booking.customer_phone) {
        console.log('   ❌ NO EMAIL OR PHONE - Tickets cannot be sent');
      } else {
        if (booking.customer_email) {
          console.log('   ✓ Has email - Email ticket should be sent');
        } else {
          console.log('   ⚠️  No email - Email ticket will be skipped');
        }
        
        if (booking.customer_phone) {
          console.log('   ✓ Has phone - WhatsApp ticket should be sent');
        } else {
          console.log('   ⚠️  No phone - WhatsApp ticket will be skipped');
        }
      }
      console.log('');
    });
    
    console.log('='.repeat(70));
    console.log('DIAGNOSIS');
    console.log('='.repeat(70));
    console.log('');
    console.log('For tickets to be sent, bookings MUST have:');
    console.log('  ✓ customer_email OR customer_phone (at least one)');
    console.log('  ✓ Booking must be created successfully');
    console.log('  ✓ Server must be running when booking is created');
    console.log('');
    console.log('='.repeat(70));
    console.log('WHAT TO CHECK IN SERVER CONSOLE');
    console.log('='.repeat(70));
    console.log('');
    console.log('When a booking is created, you should see in SERVER TERMINAL:');
    console.log('');
    console.log('📧 ========================================');
    console.log('📧 Starting ticket generation for booking <ID>...');
    console.log('   Customer: <name>');
    console.log('   Email: <email>');
    console.log('   Phone: <phone>');
    console.log('📧 ========================================');
    console.log('');
    console.log('If you DON\'T see this log:');
    console.log('  1. process.nextTick() is not executing');
    console.log('  2. Booking creation failed before ticket generation');
    console.log('  3. bookingId is not set correctly');
    console.log('');
    console.log('If you see the log but tickets aren\'t sent:');
    console.log('  1. Check for PDF generation errors');
    console.log('  2. Check for email sending errors');
    console.log('  3. Check for WhatsApp sending errors');
    console.log('  4. Verify SMTP settings (for email)');
    console.log('  5. Verify WhatsApp settings (for WhatsApp)');
    console.log('');
    console.log('='.repeat(70));
    console.log('NEXT STEPS');
    console.log('='.repeat(70));
    console.log('');
    console.log('1. Check your SERVER TERMINAL (not browser F12) for ticket logs');
    console.log('2. Look for "📧 Starting ticket generation" message');
    console.log('3. If you see errors, share them for troubleshooting');
    console.log('4. If you don\'t see the message at all, ticket generation is not running');
    console.log('');
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
