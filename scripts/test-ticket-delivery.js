// Script to test ticket PDF generation and delivery
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory (where SMTP settings are configured)
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function testTicketDelivery() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Ticket PDF Generation & Delivery\n');
    
    // Test email and phone
    const testEmail = 'kaptifidev@gmail.com';
    const testPhone = '+201032560826';
    
    console.log(`📧 Test Email: ${testEmail}`);
    console.log(`📱 Test Phone: ${testPhone}\n`);
    
    // Get a recent booking or create a test booking
    const bookingResult = await client.query(`
      SELECT 
        b.id, b.customer_name, b.customer_phone, b.customer_email,
        b.tenant_id, b.service_id, b.slot_id,
        b.visitor_count, b.adult_count, b.child_count, b.total_price,
        sl.slot_date, sl.start_time, sl.end_time,
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
    console.log(`   Service: ${booking.service_name}`);
    console.log(`   Date: ${booking.slot_date} ${booking.start_time}\n`);
    
    // Import PDF service using tsx-compatible import
    // The server uses tsx which handles .ts files
    console.log('📄 Generating PDF ticket...');
    const pdfService = await import('../server/src/services/pdfService.ts');
    const pdfBase64 = await pdfService.generateBookingTicketPDFBase64(booking.id, 'en');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    console.log(`✅ PDF generated (${(pdfBuffer.length / 1024).toFixed(2)} KB)\n`);
    
    // Test WhatsApp delivery
    console.log('📱 Testing WhatsApp delivery...');
    try {
      const { sendWhatsAppDocument } = await import('../server/src/services/whatsappService.js');
      
      // Get tenant WhatsApp settings
      const tenantResult = await client.query(
        'SELECT whatsapp_settings FROM tenants WHERE id = $1',
        [booking.tenant_id]
      );
      
      let whatsappConfig = null;
      if (tenantResult.rows.length > 0 && tenantResult.rows[0].whatsapp_settings) {
        const settings = tenantResult.rows[0].whatsapp_settings;
        whatsappConfig = {
          provider: settings.provider,
          apiUrl: settings.api_url,
          apiKey: settings.api_key,
          phoneNumberId: settings.phone_number_id,
          accessToken: settings.access_token,
          accountSid: settings.account_sid,
          authToken: settings.auth_token,
          from: settings.from,
        };
      }
      
      const whatsappResult = await sendWhatsAppDocument(
        testPhone,
        pdfBuffer,
        `booking_ticket_${booking.id}.pdf`,
        'Test: Your booking ticket is attached. This is a test message.',
        whatsappConfig || undefined
      );
      
      if (whatsappResult.success) {
        console.log(`✅ WhatsApp delivery successful to ${testPhone}`);
      } else {
        console.log(`⚠️ WhatsApp delivery failed: ${whatsappResult.error}`);
      }
    } catch (whatsappError) {
      console.log(`❌ WhatsApp error: ${whatsappError.message}`);
    }
    
    console.log('');
    
    // Test Email delivery
    console.log('📧 Testing Email delivery...');
    try {
      // Import nodemailer from server node_modules
      const serverNodeModules = join(__dirname, '..', 'server', 'node_modules');
      const nodemailerPath = join(serverNodeModules, 'nodemailer', 'lib', 'nodemailer.js');
      const nodemailer = await import(`file:///${nodemailerPath.replace(/\\/g, '/')}`);
      
      const emailConfig = {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD, // Support both names
        },
        tls: {
          // Do not fail on invalid certificates (for development/testing)
          rejectUnauthorized: false,
        },
      };
      
      if (!emailConfig.auth.user || !emailConfig.auth.pass) {
        console.log('⚠️ SMTP credentials not configured. Set SMTP_USER and SMTP_PASS in .env');
        console.log('   Skipping email test...');
      } else {
        const transporter = nodemailer.default.createTransport(emailConfig);
        
        await transporter.sendMail({
          from: emailConfig.auth.user,
          to: testEmail,
          subject: 'Test: Booking Ticket',
          text: 'This is a test email. Your booking ticket is attached.',
          html: `
            <h2>Test: Booking Ticket</h2>
            <p>This is a test email to verify ticket PDF delivery.</p>
            <p>Your booking ticket is attached as a PDF.</p>
            <hr>
            <p><strong>Booking Details:</strong></p>
            <ul>
              <li>Booking ID: ${booking.id}</li>
              <li>Service: ${booking.service_name}</li>
              <li>Date: ${booking.slot_date}</li>
              <li>Time: ${booking.start_time} - ${booking.end_time}</li>
            </ul>
          `,
          attachments: [{
            filename: `booking_ticket_${booking.id}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          }],
        });
        
        console.log(`✅ Email delivery successful to ${testEmail}`);
      }
    } catch (emailError) {
      console.log(`❌ Email error: ${emailError.message}`);
      if (emailError.code === 'EAUTH') {
        console.log('   ⚠️ Authentication failed. Check SMTP_USER and SMTP_PASS in .env');
      }
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Test error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

testTicketDelivery().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

