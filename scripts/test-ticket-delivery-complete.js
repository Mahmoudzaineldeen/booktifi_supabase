// Comprehensive test script to verify ticket delivery via WhatsApp and Email
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

async function testCompleteTicketDelivery() {
  const client = await pool.connect();
  
  // Track test results
  let whatsappTested = false;
  let whatsappSuccess = false;
  let emailTested = false;
  let emailSuccess = false;
  
  try {
    console.log('🧪 Testing Complete Ticket Delivery (WhatsApp + Email)\n');
    console.log('='.repeat(60));
    
    // Get a recent booking or create test data
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
    console.log('\n📋 Booking Details:');
    console.log(`   Booking ID: ${booking.id}`);
    console.log(`   Customer: ${booking.customer_name}`);
    console.log(`   Phone: ${booking.customer_phone || 'NOT PROVIDED'}`);
    console.log(`   Email: ${booking.customer_email || 'NOT PROVIDED'}`);
    console.log(`   Service: ${booking.service_name}`);
    console.log(`   Date: ${booking.slot_date}`);
    console.log(`   Time: ${booking.start_time} - ${booking.end_time}`);
    console.log(`   Adults: ${booking.adult_count || booking.visitor_count}, Children: ${booking.child_count || 0}`);
    console.log(`   Total: ${parseFloat(booking.total_price || 0).toFixed(2)} SAR\n`);
    
    // Test phone and email
    const testPhone = booking.customer_phone || '+201032560826';
    const testEmail = booking.customer_email || 'kaptifidev@gmail.com';
    
    console.log('='.repeat(60));
    console.log('📄 STEP 1: Generating PDF Ticket\n');
    
    // Import PDF service
    const pdfService = await import('../server/src/services/pdfService.ts');
    const pdfBase64 = await pdfService.generateBookingTicketPDFBase64(booking.id, 'en');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    console.log(`✅ PDF generated successfully`);
    console.log(`   Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Format: PDF with QR code and barcode\n`);
    
    // Test WhatsApp delivery
    console.log('='.repeat(60));
    console.log('📱 STEP 2: Testing WhatsApp Delivery\n');
    
    if (testPhone) {
      console.log(`📤 Attempting to send ticket via WhatsApp to: ${testPhone}`);
      
      try {
        const whatsappService = await import('../server/src/services/whatsappService.ts');
        
        // Check WhatsApp configuration from environment variables
        const whatsappProvider = process.env.WHATSAPP_PROVIDER;
        const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        
        // Check WhatsApp configuration from tenant settings (database)
        const tenantWhatsappResult = await client.query(
          'SELECT whatsapp_settings FROM tenants WHERE id = $1',
          [booking.tenant_id]
        );
        
        let whatsappConfig = null;
        if (tenantWhatsappResult.rows.length > 0 && tenantWhatsappResult.rows[0].whatsapp_settings) {
          const settings = tenantWhatsappResult.rows[0].whatsapp_settings;
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
        
        console.log('\n📋 WhatsApp Configuration:');
        console.log(`   Provider (env): ${whatsappProvider || 'NOT SET'}`);
        console.log(`   Phone Number ID (env): ${whatsappPhoneNumberId ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`   Access Token (env): ${whatsappAccessToken ? '✅ SET' : '❌ NOT SET'}`);
        if (whatsappConfig) {
          console.log(`   Tenant Config: ✅ FOUND`);
          console.log(`     Provider: ${whatsappConfig.provider || 'N/A'}`);
          console.log(`     Phone Number ID: ${whatsappConfig.phoneNumberId ? '✅ SET' : '❌ NOT SET'}`);
          console.log(`     Access Token: ${whatsappConfig.accessToken ? '✅ SET' : '❌ NOT SET'}`);
        } else {
          console.log(`   Tenant Config: ❌ NOT FOUND`);
        }
        console.log('');
        
        // Try to send if configured (either via env or tenant settings)
        const isConfigured = (whatsappProvider && whatsappPhoneNumberId && whatsappAccessToken) || 
                           (whatsappConfig && whatsappConfig.phoneNumberId && whatsappConfig.accessToken);
        
        if (isConfigured) {
          whatsappTested = true;
          const whatsappResult = await whatsappService.sendWhatsAppDocument(
            testPhone,
            pdfBuffer,
            `booking_ticket_${booking.id}.pdf`,
            `Your booking ticket for ${booking.service_name}`,
            whatsappConfig || undefined
          );
          
          if (whatsappResult.success) {
            whatsappSuccess = true;
            console.log('✅ WhatsApp delivery successful!');
            console.log(`   Message ID: ${whatsappResult.messageId || 'N/A'}`);
          } else {
            console.log(`⚠️ WhatsApp delivery failed: ${whatsappResult.error || 'Unknown error'}`);
          }
        } else {
          console.log('⚠️ WhatsApp not configured. Skipping WhatsApp test.');
          console.log('   To enable WhatsApp:');
          console.log('   - Set WHATSAPP_PROVIDER, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_ACCESS_TOKEN in .env, OR');
          console.log('   - Configure WhatsApp settings in tenant settings (database)');
        }
      } catch (whatsappError) {
        whatsappTested = true;
        console.error(`❌ WhatsApp delivery error: ${whatsappError.message}`);
        if (whatsappError.stack) {
          console.error('   Stack:', whatsappError.stack.split('\n')[1]);
        }
      }
    } else {
      console.log('⚠️ No phone number available. Skipping WhatsApp test.');
    }
    
    // Test Email delivery
    console.log('\n' + '='.repeat(60));
    console.log('📧 STEP 3: Testing Email Delivery\n');
    
    if (testEmail) {
      console.log(`📤 Attempting to send ticket via Email to: ${testEmail}`);
      
      try {
        const emailService = await import('../server/src/services/emailService.ts');
        
        // Check Email configuration
        const smtpUser = process.env.SMTP_USER;
        const smtpPassword = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
        
        console.log('\n📋 Email Configuration:');
        console.log(`   SMTP Host: ${process.env.SMTP_HOST || 'smtp.gmail.com (default)'}`);
        console.log(`   SMTP Port: ${process.env.SMTP_PORT || '587 (default)'}`);
        console.log(`   SMTP User: ${smtpUser ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`   SMTP Password: ${smtpPassword ? '✅ SET' : '❌ NOT SET'}\n`);
        
        if (smtpUser && smtpPassword) {
          emailTested = true;
          const emailResult = await emailService.sendBookingTicketEmail(
            testEmail,
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
            emailSuccess = true;
            console.log('✅ Email delivery successful!');
            console.log(`📬 Check your inbox at ${testEmail}`);
            console.log('   (Also check spam folder if not found)');
          } else {
            console.error(`❌ Email delivery failed: ${emailResult.error || 'Unknown error'}`);
          }
        } else {
          console.log('⚠️ Email not configured. Skipping Email test.');
          console.log('   To enable Email, set SMTP_USER and SMTP_PASSWORD in .env');
        }
      } catch (emailError) {
        emailTested = true;
        console.error(`❌ Email delivery error: ${emailError.message}`);
        if (emailError.code) {
          console.error(`   Error code: ${emailError.code}`);
        }
        if (emailError.response) {
          console.error(`   SMTP response: ${emailError.response}`);
        }
      }
    } else {
      console.log('⚠️ No email address available. Skipping Email test.');
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY\n');
    console.log('✅ PDF Generation: SUCCESS');
    
    if (whatsappTested) {
      console.log(`📱 WhatsApp Delivery: ${whatsappSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
    } else {
      console.log('📱 WhatsApp Delivery: ⏭️  SKIPPED (not configured or no phone)');
    }
    
    if (emailTested) {
      console.log(`📧 Email Delivery: ${emailSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
    } else {
      console.log('📧 Email Delivery: ⏭️  SKIPPED (not configured or no email)');
    }
    
    console.log('\n💡 Notes:');
    console.log('   - Both delivery methods use the same PDF file');
    console.log('   - WhatsApp is sent to guests (no account)');
    console.log('   - Email is sent if customer_email is provided');
    console.log('   - Both methods work asynchronously (don\'t block booking creation)');
    console.log('   - Uses the same emailService mechanism as OTP emails');
    console.log('\n' + '='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

testCompleteTicketDelivery().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

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

async function testCompleteTicketDelivery() {
  const client = await pool.connect();
  
  // Track test results
  let whatsappTested = false;
  let whatsappSuccess = false;
  let emailTested = false;
  let emailSuccess = false;
  
  try {
    console.log('🧪 Testing Complete Ticket Delivery (WhatsApp + Email)\n');
    console.log('='.repeat(60));
    
    // Get a recent booking or create test data
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
    console.log('\n📋 Booking Details:');
    console.log(`   Booking ID: ${booking.id}`);
    console.log(`   Customer: ${booking.customer_name}`);
    console.log(`   Phone: ${booking.customer_phone || 'NOT PROVIDED'}`);
    console.log(`   Email: ${booking.customer_email || 'NOT PROVIDED'}`);
    console.log(`   Service: ${booking.service_name}`);
    console.log(`   Date: ${booking.slot_date}`);
    console.log(`   Time: ${booking.start_time} - ${booking.end_time}`);
    console.log(`   Adults: ${booking.adult_count || booking.visitor_count}, Children: ${booking.child_count || 0}`);
    console.log(`   Total: ${parseFloat(booking.total_price || 0).toFixed(2)} SAR\n`);
    
    // Test phone and email
    const testPhone = booking.customer_phone || '+201032560826';
    const testEmail = booking.customer_email || 'kaptifidev@gmail.com';
    
    console.log('='.repeat(60));
    console.log('📄 STEP 1: Generating PDF Ticket\n');
    
    // Import PDF service
    const pdfService = await import('../server/src/services/pdfService.ts');
    const pdfBase64 = await pdfService.generateBookingTicketPDFBase64(booking.id, 'en');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    console.log(`✅ PDF generated successfully`);
    console.log(`   Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Format: PDF with QR code and barcode\n`);
    
    // Test WhatsApp delivery
    console.log('='.repeat(60));
    console.log('📱 STEP 2: Testing WhatsApp Delivery\n');
    
    if (testPhone) {
      console.log(`📤 Attempting to send ticket via WhatsApp to: ${testPhone}`);
      
      try {
        const whatsappService = await import('../server/src/services/whatsappService.ts');
        
        // Check WhatsApp configuration from environment variables
        const whatsappProvider = process.env.WHATSAPP_PROVIDER;
        const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        
        // Check WhatsApp configuration from tenant settings (database)
        const tenantWhatsappResult = await client.query(
          'SELECT whatsapp_settings FROM tenants WHERE id = $1',
          [booking.tenant_id]
        );
        
        let whatsappConfig = null;
        if (tenantWhatsappResult.rows.length > 0 && tenantWhatsappResult.rows[0].whatsapp_settings) {
          const settings = tenantWhatsappResult.rows[0].whatsapp_settings;
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
        
        console.log('\n📋 WhatsApp Configuration:');
        console.log(`   Provider (env): ${whatsappProvider || 'NOT SET'}`);
        console.log(`   Phone Number ID (env): ${whatsappPhoneNumberId ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`   Access Token (env): ${whatsappAccessToken ? '✅ SET' : '❌ NOT SET'}`);
        if (whatsappConfig) {
          console.log(`   Tenant Config: ✅ FOUND`);
          console.log(`     Provider: ${whatsappConfig.provider || 'N/A'}`);
          console.log(`     Phone Number ID: ${whatsappConfig.phoneNumberId ? '✅ SET' : '❌ NOT SET'}`);
          console.log(`     Access Token: ${whatsappConfig.accessToken ? '✅ SET' : '❌ NOT SET'}`);
        } else {
          console.log(`   Tenant Config: ❌ NOT FOUND`);
        }
        console.log('');
        
        // Try to send if configured (either via env or tenant settings)
        const isConfigured = (whatsappProvider && whatsappPhoneNumberId && whatsappAccessToken) || 
                           (whatsappConfig && whatsappConfig.phoneNumberId && whatsappConfig.accessToken);
        
        if (isConfigured) {
          whatsappTested = true;
          const whatsappResult = await whatsappService.sendWhatsAppDocument(
            testPhone,
            pdfBuffer,
            `booking_ticket_${booking.id}.pdf`,
            `Your booking ticket for ${booking.service_name}`,
            whatsappConfig || undefined
          );
          
          if (whatsappResult.success) {
            whatsappSuccess = true;
            console.log('✅ WhatsApp delivery successful!');
            console.log(`   Message ID: ${whatsappResult.messageId || 'N/A'}`);
          } else {
            console.log(`⚠️ WhatsApp delivery failed: ${whatsappResult.error || 'Unknown error'}`);
          }
        } else {
          console.log('⚠️ WhatsApp not configured. Skipping WhatsApp test.');
          console.log('   To enable WhatsApp:');
          console.log('   - Set WHATSAPP_PROVIDER, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_ACCESS_TOKEN in .env, OR');
          console.log('   - Configure WhatsApp settings in tenant settings (database)');
        }
      } catch (whatsappError) {
        whatsappTested = true;
        console.error(`❌ WhatsApp delivery error: ${whatsappError.message}`);
        if (whatsappError.stack) {
          console.error('   Stack:', whatsappError.stack.split('\n')[1]);
        }
      }
    } else {
      console.log('⚠️ No phone number available. Skipping WhatsApp test.');
    }
    
    // Test Email delivery
    console.log('\n' + '='.repeat(60));
    console.log('📧 STEP 3: Testing Email Delivery\n');
    
    if (testEmail) {
      console.log(`📤 Attempting to send ticket via Email to: ${testEmail}`);
      
      try {
        const emailService = await import('../server/src/services/emailService.ts');
        
        // Check Email configuration
        const smtpUser = process.env.SMTP_USER;
        const smtpPassword = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
        
        console.log('\n📋 Email Configuration:');
        console.log(`   SMTP Host: ${process.env.SMTP_HOST || 'smtp.gmail.com (default)'}`);
        console.log(`   SMTP Port: ${process.env.SMTP_PORT || '587 (default)'}`);
        console.log(`   SMTP User: ${smtpUser ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`   SMTP Password: ${smtpPassword ? '✅ SET' : '❌ NOT SET'}\n`);
        
        if (smtpUser && smtpPassword) {
          emailTested = true;
          const emailResult = await emailService.sendBookingTicketEmail(
            testEmail,
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
            emailSuccess = true;
            console.log('✅ Email delivery successful!');
            console.log(`📬 Check your inbox at ${testEmail}`);
            console.log('   (Also check spam folder if not found)');
          } else {
            console.error(`❌ Email delivery failed: ${emailResult.error || 'Unknown error'}`);
          }
        } else {
          console.log('⚠️ Email not configured. Skipping Email test.');
          console.log('   To enable Email, set SMTP_USER and SMTP_PASSWORD in .env');
        }
      } catch (emailError) {
        emailTested = true;
        console.error(`❌ Email delivery error: ${emailError.message}`);
        if (emailError.code) {
          console.error(`   Error code: ${emailError.code}`);
        }
        if (emailError.response) {
          console.error(`   SMTP response: ${emailError.response}`);
        }
      }
    } else {
      console.log('⚠️ No email address available. Skipping Email test.');
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY\n');
    console.log('✅ PDF Generation: SUCCESS');
    
    if (whatsappTested) {
      console.log(`📱 WhatsApp Delivery: ${whatsappSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
    } else {
      console.log('📱 WhatsApp Delivery: ⏭️  SKIPPED (not configured or no phone)');
    }
    
    if (emailTested) {
      console.log(`📧 Email Delivery: ${emailSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
    } else {
      console.log('📧 Email Delivery: ⏭️  SKIPPED (not configured or no email)');
    }
    
    console.log('\n💡 Notes:');
    console.log('   - Both delivery methods use the same PDF file');
    console.log('   - WhatsApp is sent to guests (no account)');
    console.log('   - Email is sent if customer_email is provided');
    console.log('   - Both methods work asynchronously (don\'t block booking creation)');
    console.log('   - Uses the same emailService mechanism as OTP emails');
    console.log('\n' + '='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

testCompleteTicketDelivery().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
