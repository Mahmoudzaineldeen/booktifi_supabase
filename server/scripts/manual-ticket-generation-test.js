#!/usr/bin/env node

/**
 * Manual Ticket Generation Test
 * 
 * This script manually triggers ticket generation for an existing booking
 * by directly calling the ticket generation functions.
 * 
 * Usage: node server/scripts/manual-ticket-generation-test.js [booking_id]
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

// Get booking ID from command line or use a test booking
const bookingId = process.argv[2] || null;

async function findTestBooking() {
  console.log('📋 Finding a booking to test...\n');
  
  // Find recent booking with email and phone
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, customer_phone, tenant_id, language')
    .not('customer_email', 'is', null)
    .not('customer_phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (error) {
    console.error('❌ Error fetching bookings:', error.message);
    return null;
  }
  
  if (!bookings || bookings.length === 0) {
    console.error('❌ No bookings found with email and phone');
    return null;
  }
  
  console.log(`✅ Found ${bookings.length} booking(s)\n`);
  const booking = bookings[0];
  
  console.log('Using booking:');
  console.log(`  ID: ${booking.id}`);
  console.log(`  Customer: ${booking.customer_name}`);
  console.log(`  Email: ${booking.customer_email}`);
  console.log(`  Phone: ${booking.customer_phone}`);
  console.log(`  Tenant: ${booking.tenant_id}\n`);
  
  return booking;
}

async function generateTicket(booking) {
  console.log('='.repeat(60));
  console.log('🎫 MANUAL TICKET GENERATION TEST');
  console.log('='.repeat(60));
  console.log('');
  
  const bookingId = booking.id;
  const customerEmail = booking.customer_email;
  const customerPhone = booking.customer_phone;
  const tenantId = booking.tenant_id;
  const ticketLanguage = (booking.language === 'ar' || booking.language === 'en') 
    ? booking.language 
    : 'en';
  
  console.log(`Booking ID: ${bookingId}`);
  console.log(`Customer Email: ${customerEmail}`);
  console.log(`Customer Phone: ${customerPhone}`);
  console.log(`Tenant ID: ${tenantId}`);
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
      return false;
    }
    
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error('❌ CRITICAL: PDF buffer conversion failed');
      return false;
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
    if (customerPhone && pdfBuffer) {
      console.log(`📱 Step 2: Sending ticket via WhatsApp to ${customerPhone}...`);
      try {
        const whatsappResult = await sendWhatsAppDocument(
          customerPhone,
          pdfBuffer,
          `booking_ticket_${bookingId}.pdf`,
          ticketLanguage === 'ar'
            ? 'تم تأكيد حجزك! يرجى الاطلاع على التذكرة المرفقة.'
            : 'Your booking is confirmed! Please find your ticket attached.',
          whatsappConfig || undefined
        );
        
        if (whatsappResult && whatsappResult.success) {
          console.log(`✅ Step 2 Complete: Ticket sent via WhatsApp\n`);
        } else {
          console.error(`❌ Step 2 Failed: ${whatsappResult?.error || 'Unknown error'}\n`);
        }
      } catch (error) {
        console.error(`❌ Step 2 Exception: ${error.message}\n`);
      }
    } else {
      console.log('⚠️  Step 2 Skipped: No phone number or PDF buffer\n');
    }
    
    // Step 3: Get booking details for email
    console.log('📧 Step 3a: Fetching booking details...');
    const { data: bookingDetails, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        id,
        services:service_id (name, name_ar),
        slots:slot_id (slot_date, start_time, end_time),
        tenants:tenant_id (name, name_ar)
      `)
      .eq('id', bookingId)
      .single();
    
    if (bookingError || !bookingDetails) {
      console.error(`❌ Failed to fetch booking details: ${bookingError?.message || 'Unknown'}\n`);
      return false;
    }
    
    console.log('✅ Booking details fetched\n');
    
    // Step 3: Send via Email
    if (customerEmail && pdfBuffer) {
      console.log(`📧 Step 3: Sending ticket via Email to ${customerEmail}...`);
      try {
        const emailResult = await sendBookingTicketEmail(
          customerEmail,
          pdfBuffer,
          bookingId,
          tenantId,
          {
            service_name: bookingDetails.services?.name || 'Service',
            service_name_ar: bookingDetails.services?.name_ar || '',
            slot_date: bookingDetails.slots?.slot_date || '',
            start_time: bookingDetails.slots?.start_time || '',
            end_time: bookingDetails.slots?.end_time || '',
            tenant_name: bookingDetails.tenants?.name || '',
            tenant_name_ar: bookingDetails.tenants?.name_ar || '',
          },
          ticketLanguage
        );
        
        if (emailResult.success) {
          console.log(`✅ Step 3 Complete: Ticket sent via Email\n`);
        } else {
          console.error(`❌ Step 3 Failed: ${emailResult.error || 'Unknown error'}\n`);
        }
      } catch (error) {
        console.error(`❌ Step 3 Exception: ${error.message}\n`);
      }
    } else {
      console.log('⚠️  Step 3 Skipped: No email or PDF buffer\n');
    }
    
    console.log('='.repeat(60));
    console.log('✅ Ticket generation test complete!');
    console.log('='.repeat(60));
    console.log('');
    console.log('📬 Check delivery:');
    console.log(`  📧 Email: ${customerEmail}`);
    console.log(`  📱 WhatsApp: ${customerPhone}`);
    console.log('');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ CRITICAL ERROR:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    return false;
  }
}

async function main() {
  console.log('\n🧪 Manual Ticket Generation Test\n');
  
  let booking = null;
  
  if (bookingId) {
    // Use provided booking ID
    const { data, error } = await supabase
      .from('bookings')
      .select('id, customer_name, customer_email, customer_phone, tenant_id, language')
      .eq('id', bookingId)
      .single();
    
    if (error || !data) {
      console.error(`❌ Booking not found: ${bookingId}`);
      process.exit(1);
    }
    
    booking = data;
  } else {
    // Find a test booking
    booking = await findTestBooking();
    if (!booking) {
      console.log('\n💡 Tip: Provide a booking ID as argument:');
      console.log('   node server/scripts/manual-ticket-generation-test.js <booking_id>\n');
      process.exit(1);
    }
  }
  
  const success = await generateTicket(booking);
  
  if (success) {
    console.log('✅ Test completed successfully\n');
  } else {
    console.log('❌ Test completed with errors\n');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('\nFatal error:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
