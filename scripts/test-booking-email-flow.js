// Script to test the actual booking email flow
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

async function testBookingEmailFlow() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Booking Email Flow\n');
    
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
    
    // Simulate the email sending logic from bookings.ts
    const customer_email = booking.customer_email;
    const testEmail = 'kaptifidev@gmail.com';
    
    console.log('📧 Testing Email Delivery Logic...\n');
    
    // Check conditions
    console.log('📋 Conditions Check:');
    console.log(`   customer_email provided: ${customer_email ? '✅ Yes' : '❌ No'}`);
    console.log(`   Using test email: ${testEmail}\n`);
    
    if (!customer_email && !testEmail) {
      console.log('⚠️ No email address available. Email will not be sent.');
      return;
    }
    
    const emailToSend = customer_email || testEmail;
    console.log(`📤 Attempting to send email to: ${emailToSend}\n`);
    
    // Import PDF service
    const pdfService = await import('../server/src/services/pdfService.ts');
    const pdfBase64 = await pdfService.generateBookingTicketPDFBase64(booking.id, 'en');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    console.log(`✅ PDF generated (${(pdfBuffer.length / 1024).toFixed(2)} KB)\n`);
    
    // Check SMTP config
    const emailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : false,
      },
    };
    
    console.log('📋 SMTP Configuration:');
    console.log(`   Host: ${emailConfig.host}`);
    console.log(`   Port: ${emailConfig.port}`);
    console.log(`   User: ${emailConfig.auth.user ? '***SET*** ✅' : '❌ NOT SET'}`);
    console.log(`   Pass: ${emailConfig.auth.pass ? '***SET*** ✅' : '❌ NOT SET'}\n`);
    
    if (!emailConfig.auth.user || !emailConfig.auth.pass) {
      console.log('❌ SMTP credentials not configured!');
      console.log('   Email will not be sent in actual booking flow.');
      return;
    }
    
    // Import nodemailer
    const serverNodeModules = join(__dirname, '..', 'server', 'node_modules');
    const nodemailerPath = join(serverNodeModules, 'nodemailer', 'lib', 'nodemailer.js');
    const nodemailer = await import(`file:///${nodemailerPath.replace(/\\/g, '/')}`);
    
    console.log('📤 Creating SMTP transporter...');
    const transporter = nodemailer.default.createTransport(emailConfig);
    
    // Verify connection
    console.log('🔍 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified!\n');
    
    // Send email (matching the actual booking flow)
    console.log('📨 Sending email (simulating booking flow)...');
    const mailOptions = {
      from: `"${booking.tenant_name || 'Bookati'}" <${emailConfig.auth.user}>`,
      to: emailToSend,
      subject: 'Booking Ticket',
      text: 'Your booking is confirmed! Please find your ticket attached.',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Your booking is confirmed!</h2>
          <p>Thank you for your booking. Please find your ticket attached.</p>
          <hr>
          <p><strong>Booking Details:</strong></p>
          <ul>
            <li>Booking ID: ${booking.id}</li>
            <li>Service: ${booking.service_name}</li>
            <li>Date: ${booking.slot_date}</li>
            <li>Time: ${booking.start_time} - ${booking.end_time}</li>
          </ul>
          <p>Please bring this ticket upon arrival.</p>
        </div>
      `,
      attachments: [{
        filename: `booking_ticket_${booking.id}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    };
    
    const emailInfo = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully!');
    console.log(`   Message ID: ${emailInfo.messageId}`);
    console.log(`   Response: ${emailInfo.response}`);
    console.log(`\n📬 Check your inbox at ${emailToSend}`);
    console.log('   (Also check spam folder if not found)');
    
    console.log('\n✅ Test completed!');
    console.log('\n💡 Note: In actual booking flow, email is sent if:');
    console.log('   1. customer_email is provided in the booking request');
    console.log('   2. SMTP credentials are configured');
    console.log('   3. Email sending happens asynchronously (does not block booking creation)');
    
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

testBookingEmailFlow().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

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

async function testBookingEmailFlow() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Booking Email Flow\n');
    
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
    
    // Simulate the email sending logic from bookings.ts
    const customer_email = booking.customer_email;
    const testEmail = 'kaptifidev@gmail.com';
    
    console.log('📧 Testing Email Delivery Logic...\n');
    
    // Check conditions
    console.log('📋 Conditions Check:');
    console.log(`   customer_email provided: ${customer_email ? '✅ Yes' : '❌ No'}`);
    console.log(`   Using test email: ${testEmail}\n`);
    
    if (!customer_email && !testEmail) {
      console.log('⚠️ No email address available. Email will not be sent.');
      return;
    }
    
    const emailToSend = customer_email || testEmail;
    console.log(`📤 Attempting to send email to: ${emailToSend}\n`);
    
    // Import PDF service
    const pdfService = await import('../server/src/services/pdfService.ts');
    const pdfBase64 = await pdfService.generateBookingTicketPDFBase64(booking.id, 'en');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    console.log(`✅ PDF generated (${(pdfBuffer.length / 1024).toFixed(2)} KB)\n`);
    
    // Check SMTP config
    const emailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : false,
      },
    };
    
    console.log('📋 SMTP Configuration:');
    console.log(`   Host: ${emailConfig.host}`);
    console.log(`   Port: ${emailConfig.port}`);
    console.log(`   User: ${emailConfig.auth.user ? '***SET*** ✅' : '❌ NOT SET'}`);
    console.log(`   Pass: ${emailConfig.auth.pass ? '***SET*** ✅' : '❌ NOT SET'}\n`);
    
    if (!emailConfig.auth.user || !emailConfig.auth.pass) {
      console.log('❌ SMTP credentials not configured!');
      console.log('   Email will not be sent in actual booking flow.');
      return;
    }
    
    // Import nodemailer
    const serverNodeModules = join(__dirname, '..', 'server', 'node_modules');
    const nodemailerPath = join(serverNodeModules, 'nodemailer', 'lib', 'nodemailer.js');
    const nodemailer = await import(`file:///${nodemailerPath.replace(/\\/g, '/')}`);
    
    console.log('📤 Creating SMTP transporter...');
    const transporter = nodemailer.default.createTransport(emailConfig);
    
    // Verify connection
    console.log('🔍 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified!\n');
    
    // Send email (matching the actual booking flow)
    console.log('📨 Sending email (simulating booking flow)...');
    const mailOptions = {
      from: `"${booking.tenant_name || 'Bookati'}" <${emailConfig.auth.user}>`,
      to: emailToSend,
      subject: 'Booking Ticket',
      text: 'Your booking is confirmed! Please find your ticket attached.',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Your booking is confirmed!</h2>
          <p>Thank you for your booking. Please find your ticket attached.</p>
          <hr>
          <p><strong>Booking Details:</strong></p>
          <ul>
            <li>Booking ID: ${booking.id}</li>
            <li>Service: ${booking.service_name}</li>
            <li>Date: ${booking.slot_date}</li>
            <li>Time: ${booking.start_time} - ${booking.end_time}</li>
          </ul>
          <p>Please bring this ticket upon arrival.</p>
        </div>
      `,
      attachments: [{
        filename: `booking_ticket_${booking.id}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    };
    
    const emailInfo = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully!');
    console.log(`   Message ID: ${emailInfo.messageId}`);
    console.log(`   Response: ${emailInfo.response}`);
    console.log(`\n📬 Check your inbox at ${emailToSend}`);
    console.log('   (Also check spam folder if not found)');
    
    console.log('\n✅ Test completed!');
    console.log('\n💡 Note: In actual booking flow, email is sent if:');
    console.log('   1. customer_email is provided in the booking request');
    console.log('   2. SMTP credentials are configured');
    console.log('   3. Email sending happens asynchronously (does not block booking creation)');
    
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

testBookingEmailFlow().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


