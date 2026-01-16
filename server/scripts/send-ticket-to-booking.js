#!/usr/bin/env node

/**
 * Send Ticket to Specific Booking
 * 
 * Manually triggers ticket generation for a specific booking.
 * 
 * Usage: node server/scripts/send-ticket-to-booking.js <booking_id> [email] [phone]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const bookingId = process.argv[2];
const overrideEmail = process.argv[3];
const overridePhone = process.argv[4];

if (!bookingId) {
  console.error('❌ Booking ID required');
  console.log('\nUsage: node server/scripts/send-ticket-to-booking.js <booking_id> [email] [phone]');
  console.log('\nExample:');
  console.log('  node server/scripts/send-ticket-to-booking.js abc123 kaptifidev@gmail.com +201032560826');
  process.exit(1);
}

async function sendTicket() {
  console.log('\n' + '='.repeat(70));
  console.log('SENDING TICKET TO BOOKING');
  console.log('='.repeat(70) + '\n');
  
  console.log(`Booking ID: ${bookingId}`);
  if (overrideEmail) console.log(`Override Email: ${overrideEmail}`);
  if (overridePhone) console.log(`Override Phone: ${overridePhone}`);
  console.log('');
  
  // Get booking
  console.log('📋 Fetching booking...');
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select(`
      id,
      customer_name,
      customer_email,
      customer_phone,
      tenant_id,
      language,
      services:service_id (name, name_ar),
      slots:slot_id (slot_date, start_time, end_time),
      tenants:tenant_id (name, name_ar)
    `)
    .eq('id', bookingId)
    .single();
  
  if (bookingError || !booking) {
    console.error(`❌ Booking not found: ${bookingError?.message || 'Unknown error'}`);
    process.exit(1);
  }
  
  console.log('✅ Booking found:');
  console.log(`   Customer: ${booking.customer_name || 'N/A'}`);
  console.log(`   Email: ${booking.customer_email || 'N/A'}`);
  console.log(`   Phone: ${booking.customer_phone || 'N/A'}`);
  console.log(`   Tenant: ${booking.tenant_id}`);
  console.log('');
  
  const email = overrideEmail || booking.customer_email;
  const phone = overridePhone || booking.customer_phone;
  const tenantId = booking.tenant_id;
  const ticketLanguage = (booking.language === 'ar' || booking.language === 'en') 
    ? booking.language 
    : 'en';
  
  if (!email && !phone) {
    console.error('❌ No email or phone available for ticket delivery');
    process.exit(1);
  }
  
  console.log('='.repeat(70));
  console.log('GENERATING AND SENDING TICKET');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Email: ${email || 'N/A'}`);
  console.log(`Phone: ${phone || 'N/A'}`);
  console.log(`Language: ${ticketLanguage}`);
  console.log('');
  
  try {
    // Import ticket generation modules
    console.log('📦 Importing modules...');
    const { generateBookingTicketPDFBase64 } = await import('../src/services/pdfService.js');
    const { sendWhatsAppDocument } = await import('../src/services/whatsappService.js');
    const { sendBookingTicketEmail } = await import('../src/services/emailService.js');
    console.log('✅ Modules imported\n');
    
    // Step 1: Generate PDF
    console.log('📄 Step 1: Generating PDF...');
    const pdfBase64 = await generateBookingTicketPDFBase64(bookingId, ticketLanguage);
    
    if (!pdfBase64 || pdfBase64.length === 0) {
      console.error('❌ CRITICAL: PDF generation failed - pdfBase64 is empty');
      process.exit(1);
    }
    
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error('❌ CRITICAL: PDF buffer conversion failed');
      process.exit(1);
    }
    
    console.log(`✅ Step 1 Complete: PDF generated successfully (${pdfBuffer.length} bytes)\n`);
    
    // Step 2: Get WhatsApp config
    console.log('📱 Step 2a: Fetching WhatsApp configuration...');
    const { data: tenantData, error: tenantError } = await supabase
      .from('tenants')
      .select('whatsapp_settings')
      .eq('id', tenantId)
      .single();
    
    let whatsappConfig = null;
    if (!tenantError && tenantData && tenantData.whatsapp_settings) {
      const settings = tenantData.whatsapp_settings;
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
      console.log(`✅ WhatsApp config found: provider=${whatsappConfig.provider || 'not set'}\n`);
    } else {
      console.log('⚠️  No WhatsApp config found\n');
    }
    
    // Step 2: Send via WhatsApp
    if (phone && pdfBuffer) {
      console.log(`📱 Step 2: Sending ticket via WhatsApp to ${phone}...`);
      try {
        const whatsappResult = await sendWhatsAppDocument(
          phone,
          pdfBuffer,
          `booking_ticket_${bookingId}.pdf`,
          ticketLanguage === 'ar'
            ? 'تم تأكيد حجزك! يرجى الاطلاع على التذكرة المرفقة.'
            : 'Your booking is confirmed! Please find your ticket attached.',
          whatsappConfig || undefined
        );
        
        if (whatsappResult && whatsappResult.success) {
          console.log(`✅ Step 2 Complete: Ticket sent via WhatsApp to ${phone}\n`);
        } else {
          console.error(`❌ Step 2 Failed: ${whatsappResult?.error || 'Unknown error'}\n`);
        }
      } catch (error) {
        console.error(`❌ Step 2 Exception: ${error.message}\n`);
      }
    } else {
      console.log('⚠️  Step 2 Skipped: No phone number or PDF buffer\n');
    }
    
    // Step 3: Send via Email
    if (email && pdfBuffer) {
      console.log(`📧 Step 3: Sending ticket via Email to ${email}...`);
      try {
        const emailResult = await sendBookingTicketEmail(
          email,
          pdfBuffer,
          bookingId,
          tenantId,
          {
            service_name: booking.services?.name || 'Service',
            service_name_ar: booking.services?.name_ar || '',
            slot_date: booking.slots?.slot_date || '',
            start_time: booking.slots?.start_time || '',
            end_time: booking.slots?.end_time || '',
            tenant_name: booking.tenants?.name || '',
            tenant_name_ar: booking.tenants?.name_ar || '',
          },
          ticketLanguage
        );
        
        if (emailResult.success) {
          console.log(`✅ Step 3 Complete: Ticket sent via Email to ${email}\n`);
        } else {
          console.error(`❌ Step 3 Failed: ${emailResult.error || 'Unknown error'}\n`);
        }
      } catch (error) {
        console.error(`❌ Step 3 Exception: ${error.message}\n`);
      }
    } else {
      console.log('⚠️  Step 3 Skipped: No email or PDF buffer\n');
    }
    
    console.log('='.repeat(70));
    console.log('✅ TICKET SENDING COMPLETE');
    console.log('='.repeat(70));
    console.log('');
    console.log('📬 Check delivery:');
    if (email) console.log(`  📧 Email: ${email}`);
    if (phone) console.log(`  📱 WhatsApp: ${phone}`);
    console.log('');
    
  } catch (error) {
    console.error('\n❌ CRITICAL ERROR:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

sendTicket().catch(error => {
  console.error('\nFatal error:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
