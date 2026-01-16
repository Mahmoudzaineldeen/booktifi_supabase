// Script to test booking ticket email using the same emailService as OTP
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function testEmailServiceTicket() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Booking Ticket Email via emailService (same as OTP)\n');
    
    // Get a recent booking
    const bookingResult = await client.query(`
      SELECT 
        b.id, b.customer_name, b.customer_phone, b.customer_email,
        b.created_at, b.tenant_id,
        sl.slot_date, sl.start_time, sl.end_time,
        b.visitor_count, b.adult_count, b.child_count, b.total_price,
        s.name as service_name, s.name_ar as service_name_ar,
        t.name as tenant_name, t.name_ar as tenant_name_ar
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN tenants t ON b.tenant_id = t.id
      JOIN slots sl ON b.slot_id = sl.id
      ORDER BY b.created_at DESC
      LIMIT 1
    `);
    
    if (bookingResult.rows.length === 0) {
      console.log('❌ No bookings found. Please create a booking first.');
      return;
    }
    
    const booking = bookingResult.rows[0];
    console.log(`📋 Using booking: ${booking.id}`);
    console.log(`   Customer: ${booking.customer_name}`);
    console.log(`   Phone: ${booking.customer_phone}`);
    console.log(`   Email: ${booking.customer_email || 'NOT PROVIDED'}`);
    console.log(`   Service: ${booking.service_name}\n`);
    
    // Import PDF service
    console.log('📄 Generating PDF...');
    const pdfService = await import('../server/src/services/pdfService.ts');
    const pdfBase64 = await pdfService.generateBookingTicketPDFBase64(booking.id, 'en');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    console.log(`✅ PDF generated (${(pdfBuffer.length / 1024).toFixed(2)} KB)\n`);
    
    // Import emailService (same as OTP)
    console.log('📧 Using emailService (same mechanism as OTP)...');
    const emailService = await import('../server/src/services/emailService.ts');
    
    const testEmail = 'kaptifidev@gmail.com';
    const emailToUse = booking.customer_email || testEmail;
    
    console.log(`📤 Sending ticket email to: ${emailToUse}\n`);
    
    const emailResult = await emailService.sendBookingTicketEmail(
      emailToUse,
      pdfBuffer,
      booking.id,
      {
        service_name: booking.service_name || '',
        service_name_ar: booking.service_name_ar || undefined,
        slot_date: booking.slot_date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        tenant_name: booking.tenant_name || undefined,
        tenant_name_ar: booking.tenant_name_ar || undefined,
      },
      'en'
    );
    
    if (emailResult.success) {
      console.log('✅ Email sent successfully using emailService!');
      console.log(`📬 Check your inbox at ${emailToUse}`);
      console.log('   (Also check spam folder if not found)');
    } else {
      console.error(`❌ Email failed: ${emailResult.error}`);
    }
    
    console.log('\n✅ Test completed!');
    console.log('\n💡 Key Points:');
    console.log('   ✅ Uses the same emailService.ts as OTP emails');
    console.log('   ✅ Uses the same SMTP transporter (created once, reused)');
    console.log('   ✅ Same error handling and logging mechanism');
    console.log('   ✅ Same configuration (SMTP_USER, SMTP_PASSWORD)');
    
  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.response) {
      console.error(`   SMTP response: ${error.response}`);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

testEmailServiceTicket().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


