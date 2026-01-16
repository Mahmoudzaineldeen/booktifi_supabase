import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Normalize phone number to international format
 * Handles Egyptian numbers specially: +2001032560826 -> +201032560826 (removes leading 0 after +20)
 * @param phone - Phone number in any format
 * @returns Normalized phone number in E.164 format or null if invalid
 */
function normalizePhoneNumber(phone: string): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove all spaces, dashes, and parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // If already in international format with +
  if (cleaned.startsWith('+')) {
    // Special handling for Egypt: +2001032560826 -> +201032560826
    if (cleaned.startsWith('+20')) {
      const afterCode = cleaned.substring(3); // Get number after +20
      // If starts with 0, remove it (Egyptian numbers: +2001032560826 -> +201032560826)
      if (afterCode.startsWith('0') && afterCode.length >= 10) {
        const withoutZero = afterCode.substring(1);
        // Validate it's a valid Egyptian mobile number (starts with 1, 2, or 5)
        if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
          return `+20${withoutZero}`;
        }
      }
      // If already correct format (+201032560826), return as is
      return cleaned;
    }
    // For other countries, return as is
    return cleaned;
  }

  // If starts with 00, replace with +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2);
    // Apply Egypt normalization if needed
    if (cleaned.startsWith('+20')) {
      const afterCode = cleaned.substring(3);
      if (afterCode.startsWith('0') && afterCode.length >= 10) {
        const withoutZero = afterCode.substring(1);
        if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
          return `+20${withoutZero}`;
        }
      }
    }
    return cleaned;
  }

  // Egyptian numbers: 01XXXXXXXX (11 digits) -> +201XXXXXXXX
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const withoutZero = cleaned.substring(1);
    if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
      return `+20${withoutZero}`;
    }
  }

  // If starts with 20 (country code without +), add +
  if (cleaned.startsWith('20') && cleaned.length >= 12) {
    // Check if it has leading 0 after 20 (2001032560826 -> 201032560826)
    const afterCode = cleaned.substring(2);
    if (afterCode.startsWith('0') && afterCode.length >= 10) {
      const withoutZero = afterCode.substring(1);
      if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
        return `+20${withoutZero}`;
      }
    }
    return `+${cleaned}`;
  }

  // If it's 10 digits starting with 1, 2, or 5 (Egyptian mobile without 0), add +20
  if (cleaned.length === 10 && (cleaned.startsWith('1') || cleaned.startsWith('2') || cleaned.startsWith('5'))) {
    return `+20${cleaned}`;
  }

  // Return null if we can't determine the format
  return null;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        tenant_id?: string;
      };
    }
  }
}

// Middleware to authenticate (optional - for logged-in users)
function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        tenant_id: decoded.tenant_id,
      };
    }
    next();
  } catch (error) {
    // Continue without auth for public bookings
    next();
  }
}

// ============================================================================
// Acquire booking lock (called when user proceeds to checkout)
// ============================================================================
router.post('/lock', authenticate, async (req, res) => {
  try {
    const { slot_id, reserved_capacity = 1 } = req.body;

    if (!slot_id) {
      return res.status(400).json({ error: 'slot_id is required' });
    }

    if (!reserved_capacity || reserved_capacity < 1) {
      return res.status(400).json({ error: 'reserved_capacity must be at least 1' });
    }

    // Generate session ID (use user ID if logged in, otherwise generate unique session)
    const sessionId = req.user?.id || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Call database function to acquire lock atomically
    const { data: lockData, error: lockError } = await supabase
      .rpc('acquire_booking_lock', {
        p_slot_id: slot_id,
        p_session_id: sessionId,
        p_reserved_capacity: reserved_capacity,
        p_lock_duration_seconds: 120
      });

    if (lockError) {
      throw lockError;
    }

    const lockId = lockData;

    if (!lockId) {
      return res.status(500).json({ error: 'Failed to acquire lock' });
    }

    // Get lock expiration time
    const { data: lockInfo, error: lockInfoError } = await supabase
      .from('booking_locks')
      .select('lock_expires_at')
      .eq('id', lockId)
      .single();

    if (lockInfoError) {
      throw lockInfoError;
    }

    res.json({
      lock_id: lockId,
      session_id: sessionId,
      reserved_capacity,
      expires_at: lockInfo.lock_expires_at,
      expires_in_seconds: 120
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Lock acquisition error', error, context, {
      slot_id: req.body.slot_id,
      reserved_capacity: req.body.reserved_capacity,
    });

    // Handle specific error cases
    if (error.message.includes('not available') ||
        error.message.includes('already locked') ||
        error.message.includes('Not enough tickets')) {
      return res.status(409).json({
        error: error.message || 'Slot is not available or already locked'
      });
    }

    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Validate lock is still active (called periodically during checkout)
// ============================================================================
router.get('/lock/:lock_id/validate', authenticate, async (req, res) => {
  try {
    const { lock_id } = req.params;
    const sessionId = req.user?.id || req.query.session_id as string;

    if (!sessionId) {
      return res.status(400).json({ error: 'session_id required' });
    }

    const { data: isValid, error: validateError } = await supabase
      .rpc('validate_booking_lock', {
        p_lock_id: lock_id,
        p_session_id: sessionId
      });

    if (validateError) {
      throw validateError;
    }

    if (!isValid) {
      return res.status(409).json({
        valid: false,
        error: 'Lock expired or invalid. These tickets are no longer available.'
      });
    }

    // Get remaining time
    const { data: lockInfo, error: lockInfoError } = await supabase
      .from('booking_locks')
      .select('lock_expires_at')
      .eq('id', lock_id)
      .single();

    if (lockInfoError || !lockInfo) {
      return res.status(404).json({ valid: false, error: 'Lock not found' });
    }

    // Calculate seconds remaining using JavaScript date math
    const expiresAt = new Date(lockInfo.lock_expires_at);
    const now = new Date();
    const secondsRemaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

    res.json({
      valid: true,
      expires_at: lockInfo.lock_expires_at,
      seconds_remaining: secondsRemaining
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Validate lock error', error, context, {
      lock_id: req.params.lock_id,
    });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Release lock (if user abandons checkout)
// ============================================================================
router.post('/lock/:lock_id/release', authenticate, async (req, res) => {
  try {
    const { lock_id } = req.params;
    const sessionId = req.user?.id || req.body.session_id;

    if (!sessionId) {
      return res.status(400).json({ error: 'session_id required' });
    }

    const { data, error } = await supabase
      .from('booking_locks')
      .delete()
      .eq('id', lock_id)
      .eq('reserved_by_session_id', sessionId)
      .select('id');

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Lock not found or does not belong to session' });
    }

    res.json({ message: 'Lock released successfully' });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Release lock error', error, context, {
      lock_id: req.params.lock_id,
    });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Create booking with lock validation
// ============================================================================
router.post('/create', authenticate, async (req, res) => {
  try {
    const {
      slot_id,
      service_id,
      tenant_id,
      customer_name,
      customer_phone,
      customer_email,
      visitor_count = 1,
      adult_count,
      child_count,
      total_price,
      notes,
      employee_id,
      lock_id,
      session_id,
      offer_id, // Optional: ID of selected service offer
      language = 'en' // Customer preferred language ('en' or 'ar')
    } = req.body;

    // Validate language
    const validLanguage = (language === 'ar' || language === 'en') ? language : 'en';

    // Validate required fields
    if (!slot_id || !service_id || !tenant_id || !customer_name || !customer_phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Normalize phone number (handles Egyptian numbers: +2001032560826 -> +201032560826)
    const normalizedPhone = normalizePhoneNumber(customer_phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Calculate adult_count and child_count if not provided (backward compatibility)
    const finalAdultCount = adult_count !== undefined ? adult_count : visitor_count;
    const finalChildCount = child_count !== undefined ? child_count : 0;

    // Ensure visitor_count matches adult_count + child_count
    const calculatedVisitorCount = finalAdultCount + finalChildCount;
    if (calculatedVisitorCount !== visitor_count) {
      return res.status(400).json({
        error: `visitor_count (${visitor_count}) must equal adult_count (${finalAdultCount}) + child_count (${finalChildCount})`
      });
    }

    // Use RPC for transaction - handles all validation, lock checking, and booking creation
    console.log(`[Booking Creation] Calling create_booking_with_lock RPC function...`);
    const { data: booking, error: createError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: slot_id,
        p_service_id: service_id,
        p_tenant_id: tenant_id,
        p_customer_name: customer_name,
        p_customer_phone: normalizedPhone,
        p_customer_email: customer_email || null,
        p_visitor_count: visitor_count,
        p_adult_count: finalAdultCount,
        p_child_count: finalChildCount,
        p_total_price: total_price,
        p_notes: notes || null,
        p_employee_id: employee_id || null,
        p_lock_id: lock_id || null,
        p_session_id: req.user?.id || session_id || null,
        p_customer_id: req.user?.id || null,
        p_offer_id: offer_id || null,
        p_language: validLanguage
      });

    if (createError) {
      console.error(`[Booking Creation] ❌ RPC Error:`, createError);
      console.error(`[Booking Creation]    Error code: ${createError.code || 'N/A'}`);
      console.error(`[Booking Creation]    Error message: ${createError.message}`);
      console.error(`[Booking Creation]    Error details:`, createError);
      
      // Check if RPC function doesn't exist
      if (createError.message?.includes('function') && createError.message?.includes('does not exist')) {
        console.error(`[Booking Creation] ❌ CRITICAL: RPC function 'create_booking_with_lock' does not exist!`);
        console.error(`[Booking Creation]    Please deploy the function from: database/create_booking_with_lock_function.sql`);
        return res.status(500).json({ 
          error: 'Booking function not deployed. Please contact administrator.',
          details: 'RPC function create_booking_with_lock is missing'
        });
      }
      
      // Map specific error messages to appropriate status codes
      if (createError.message.includes('Missing required fields') ||
          createError.message.includes('does not match')) {
        return res.status(400).json({ error: createError.message });
      }
      if (createError.message.includes('not found')) {
        return res.status(404).json({ error: createError.message });
      }
      if (createError.message.includes('deactivated') ||
          createError.message.includes('belongs to different session') ||
          createError.message.includes('does not belong to')) {
        return res.status(403).json({ error: createError.message });
      }
      if (createError.message.includes('expired') ||
          createError.message.includes('not available') ||
          createError.message.includes('Not enough tickets')) {
        return res.status(409).json({ error: createError.message });
      }
      throw createError;
    }

    if (!booking) {
      console.error(`[Booking Creation] ❌ CRITICAL: RPC returned null/undefined booking`);
      console.error(`[Booking Creation]    This means the function executed but returned no data`);
      return res.status(500).json({ error: 'Failed to create booking - no data returned' });
    }

    console.log(`[Booking Creation] RPC Response received:`, {
      type: typeof booking,
      isString: typeof booking === 'string',
      isObject: typeof booking === 'object',
      hasId: typeof booking === 'object' && booking !== null && 'id' in booking,
      rawValue: JSON.stringify(booking).substring(0, 200)
    });

    // Handle JSONB response - Supabase RPC may return JSONB as object or string
    let bookingData: any = booking;
    if (typeof booking === 'string') {
      try {
        console.log(`[Booking Creation] Parsing JSONB string response...`);
        bookingData = JSON.parse(booking);
        console.log(`[Booking Creation] ✅ Parsed successfully, booking ID: ${bookingData?.id || 'NOT FOUND'}`);
      } catch (e) {
        console.error(`[Booking Creation] ❌ Failed to parse booking JSONB:`, e);
        console.error(`[Booking Creation]    Raw response:`, booking);
        bookingData = booking;
      }
    } else if (typeof booking === 'object' && booking !== null) {
      console.log(`[Booking Creation] Response is already an object, booking ID: ${bookingData?.id || 'NOT FOUND'}`);
    }

    // Ensure booking has an ID
    const bookingId = bookingData?.id;
    if (!bookingId) {
      console.error(`[Booking Creation] ❌ CRITICAL: Booking created but no ID found in response!`);
      console.error(`[Booking Creation]    Response type: ${typeof booking}`);
      console.error(`[Booking Creation]    Parsed data type: ${typeof bookingData}`);
      console.error(`[Booking Creation]    Parsed data:`, JSON.stringify(bookingData, null, 2));
      console.error(`[Booking Creation]    Raw response:`, JSON.stringify(booking, null, 2));
      console.error(`[Booking Creation]    This will prevent ticket generation from running!`);
      return res.status(500).json({ 
        error: 'Booking created but ID not returned',
        details: 'The booking was created but the response does not contain an ID. Ticket generation cannot proceed.'
      });
    }

    console.log(`[Booking Creation] ✅ Booking created successfully: ${bookingId}`);
    console.log(`[Booking Creation]    Customer: ${customer_name}`);
    console.log(`[Booking Creation]    Email: ${customer_email || 'not provided'}`);
    console.log(`[Booking Creation]    Phone: ${normalizedPhone || customer_phone || 'not provided'}`);

    // Generate and send ticket PDF asynchronously (don't block response)
    // IMPORTANT: Tickets are ALWAYS generated and sent, regardless of invoice status
    // Use setImmediate for more reliable execution than process.nextTick
    // CRITICAL: This MUST run - tickets are more important than invoices
    console.log(`\n🎫 ========================================`);
    console.log(`🎫 TICKET GENERATION SCHEDULED for booking ${bookingId}`);
    console.log(`🎫 This will run asynchronously after response is sent`);
    console.log(`🎫 ========================================\n`);
    
    setImmediate(async () => {
      let pdfBuffer: Buffer | null = null;

      try {
        console.log(`\n📧 ========================================`);
        console.log(`📧 Starting ticket generation for booking ${bookingId}...`);
        console.log(`   Customer: ${customer_name}`);
        console.log(`   Email: ${customer_email || 'not provided'}`);
        console.log(`   Phone: ${normalizedPhone || customer_phone || 'not provided'}`);
        console.log(`📧 ========================================\n`);

        // Import required modules
        const { generateBookingTicketPDFBase64 } = await import('../services/pdfService.js');
        const { sendWhatsAppDocument } = await import('../services/whatsappService.js');
        const { sendBookingTicketEmail } = await import('../services/emailService.js');

        // Get language from booking (stored when booking was created)
        // If booking is JSONB, access language property
        const bookingLanguage = bookingData?.language || validLanguage;
        const ticketLanguage = (bookingLanguage === 'ar' || bookingLanguage === 'en')
          ? bookingLanguage as 'en' | 'ar'
          : 'en';

        console.log(`📄 Language for ticket: ${ticketLanguage} (from booking.language: ${bookingLanguage})`);

        // Generate PDF - CRITICAL: This must succeed
        console.log(`📄 Step 1: Generating PDF for booking ${bookingId}...`);
        const pdfBase64 = await generateBookingTicketPDFBase64(bookingId, ticketLanguage);

        if (!pdfBase64 || pdfBase64.length === 0) {
          console.error('❌ CRITICAL ERROR: Failed to generate PDF - pdfBase64 is empty or null');
          console.error('   This is a critical error - ticket cannot be sent without PDF');
          console.error('   Booking ID:', bookingId);
          console.error('   Language:', ticketLanguage);
          // Don't return - try to continue and log the error clearly
          throw new Error('PDF generation failed - pdfBase64 is empty');
        }

        pdfBuffer = Buffer.from(pdfBase64, 'base64');
        if (!pdfBuffer || pdfBuffer.length === 0) {
          console.error('❌ CRITICAL ERROR: Failed to convert PDF base64 to buffer - buffer is empty');
          console.error('   This is a critical error - ticket cannot be sent without PDF');
          throw new Error('PDF buffer conversion failed - buffer is empty');
        }

        console.log(`✅ Step 1 Complete: PDF generated successfully (${pdfBuffer.length} bytes)`);

        // Get tenant WhatsApp settings
        console.log(`📱 Step 2a: Fetching WhatsApp configuration...`);
        const { data: tenantData, error: tenantError } = await supabase
          .from('tenants')
          .select('whatsapp_settings')
          .eq('id', tenant_id)
          .single();

        let whatsappConfig: any = null;
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
          console.log(`   ✅ WhatsApp config from tenant: provider=${whatsappConfig.provider || 'not set'}`);
        } else {
          console.log(`   ⚠️ No WhatsApp config in tenant settings`);
          console.log(`   ⚠️ WhatsApp sending will fail - configure in tenant settings`);
        }

        // Send PDF via WhatsApp if phone number is provided (for all users, not just guests)
        if (customer_phone && pdfBuffer) {
          const phoneToUse = normalizedPhone || customer_phone;
          console.log(`📱 Step 2: Attempting to send ticket via WhatsApp to ${phoneToUse}...`);
          try {
            const whatsappResult = await sendWhatsAppDocument(
              phoneToUse,
              pdfBuffer,
              `booking_ticket_${bookingId}.pdf`,
              ticketLanguage === 'ar'
                ? 'تم تأكيد حجزك! يرجى الاطلاع على التذكرة المرفقة.'
                : 'Your booking is confirmed! Please find your ticket attached.',
              whatsappConfig || undefined
            );

            if (whatsappResult && whatsappResult.success) {
              console.log(`✅ Step 2 Complete: Ticket PDF sent via WhatsApp to ${phoneToUse}`);
            } else {
              console.error(`❌ Step 2 Failed: Could not send PDF via WhatsApp to ${phoneToUse}`);
              console.error(`   Error: ${whatsappResult?.error || 'Unknown error'}`);
              console.error('   WhatsApp config check:', {
                hasConfig: !!whatsappConfig,
                provider: whatsappConfig?.provider || 'not set',
                hasAccessToken: !!whatsappConfig?.accessToken,
                hasPhoneNumberId: !!whatsappConfig?.phoneNumberId,
                tenantId: tenant_id,
                message: 'Configure WhatsApp settings in tenant settings page'
              });
            }
          } catch (whatsappError: any) {
            console.error('❌ Step 2 Exception: Error sending PDF via WhatsApp:', whatsappError);
            console.error('   WhatsApp error details:', {
              phone: phoneToUse,
              error: whatsappError.message,
              name: whatsappError.name,
              stack: whatsappError.stack
            });
            // Continue - don't fail booking if WhatsApp fails
          }
        } else {
          if (!customer_phone) {
            console.log('⚠️ Step 2 Skipped: No phone number provided - skipping WhatsApp send');
          } else {
            console.log('⚠️ Step 2 Skipped: PDF buffer is null - cannot send via WhatsApp');
          }
        }

        // Send PDF via Email if email is provided (for all users, not just logged-in)
        if (customer_email && pdfBuffer) {
          console.log(`📧 Step 3: Attempting to send ticket via Email to ${customer_email}...`);
          try {
            // Get booking details for email
            const { data: bookingDetails } = await supabase
              .from('bookings')
              .select(`
                id,
                services:service_id (name, name_ar),
                slots:slot_id (slot_date, start_time, end_time),
                tenants:tenant_id (name, name_ar)
              `)
              .eq('id', bookingId)
              .single();

            if (bookingDetails) {
              const emailResult = await sendBookingTicketEmail(
                customer_email,
                pdfBuffer,
                bookingId,
                tenant_id,
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
                console.log(`✅ Step 3 Complete: Ticket PDF sent via Email to ${customer_email}`);
              } else {
                console.error(`❌ Step 3 Failed: Could not send PDF via Email to ${customer_email}`);
                console.error(`   Error: ${emailResult.error || 'Unknown error'}`);
                console.error('   This may be due to missing SMTP configuration in tenant settings.');
              }
            } else {
              console.error(`❌ Step 3 Failed: Could not fetch booking details for email`);
            }
          } catch (emailError: any) {
            console.error('❌ Step 3 Exception: Failed to send PDF via Email:', emailError);
            console.error('   Email error details:', {
              email: customer_email,
              error: emailError.message,
              stack: emailError.stack
            });
            // Continue - don't fail booking if email fails
          }
        } else {
          if (!customer_email) {
            console.log('⚠️ Step 3 Skipped: No email provided - skipping Email send');
          } else {
            console.log('⚠️ Step 3 Skipped: PDF buffer is null - cannot send via Email');
          }
        }

        // Log final status
        console.log(`\n📧 ========================================`);
        if (!customer_email && !customer_phone) {
          console.warn(`⚠️ No email or phone provided for booking ${bookingId}. Ticket not sent.`);
        } else {
          console.log(`✅ Ticket sending process completed for booking ${bookingId}`);
        }
        console.log(`📧 ========================================\n`);
      } catch (pdfError: any) {
        console.error('\n❌ ========================================');
        console.error('❌ CRITICAL ERROR: Failed to generate/send ticket PDF');
        console.error('❌ ========================================');
        console.error('PDF error details:', {
          bookingId: bookingId,
          customerName: customer_name,
          customerEmail: customer_email || 'not provided',
          customerPhone: customer_phone || 'not provided',
          error: pdfError.message,
          name: pdfError.name,
          stack: pdfError.stack
        });
        console.error('❌ ========================================\n');
        // Don't fail booking if PDF generation fails, but log the error clearly
      }
    });

    // Automatically create invoice after booking is created
    // This runs asynchronously so it doesn't block the booking response
    // Invoice is created for ALL bookings with email OR phone
    // Delivery: Email (if email provided), WhatsApp (if phone provided), or both
    // Note: Payment status is not used - invoices are created for all bookings
    if (normalizedPhone || customer_phone || customer_email) {
      setImmediate(async () => {
        try {
          console.log(`[Booking Creation] 🧾 Invoice Flow Started for booking ${bookingId}`);
          console.log(`[Booking Creation] 📋 Flow: Booking Confirmed → Create Invoice → Send via Email/WhatsApp`);
          console.log(`[Booking Creation]    Customer Email: ${customer_email || 'NOT PROVIDED'}`);
          console.log(`[Booking Creation]    Customer Phone: ${normalizedPhone || customer_phone || 'NOT PROVIDED'}`);
          const { zohoService } = await import('../services/zohoService.js');

          // Follow the exact invoice flow:
          // 1. Booking Confirmed ✓ (already done)
          // 2. Create Invoice in Zoho Invoice
          // 3. Send via Email (if email provided)
          // 4. Download PDF and Send via WhatsApp (if phone provided)
          const invoiceResult = await zohoService.generateReceipt(bookingId);
          if (invoiceResult.success) {
            console.log(`[Booking Creation] ✅ Invoice created automatically: ${invoiceResult.invoiceId}`);
            console.log(`[Booking Creation]    Email delivery: ${customer_email ? 'WILL ATTEMPT' : 'SKIPPED (no email)'}`);
            console.log(`[Booking Creation]    WhatsApp delivery: ${(normalizedPhone || customer_phone) ? 'WILL ATTEMPT' : 'SKIPPED (no phone)'}`);
          } else {
            console.error(`[Booking Creation] ⚠️ Invoice creation failed: ${invoiceResult.error}`);
            console.error(`[Booking Creation]    This may be due to Zoho connection issues. Check server logs for details.`);
            console.error(`[Booking Creation]    Note: Ticket will still be sent even if invoice creation fails.`);
          }
        } catch (invoiceError: any) {
          console.error(`[Booking Creation] ⚠️ Error creating invoice (non-blocking):`, invoiceError.message);
          console.error(`[Booking Creation]    Error stack:`, invoiceError.stack);
          // Don't fail booking if invoice creation fails
        }
      });
    } else {
      console.log(`[Booking Creation] ⚠️ Invoice not created (no customer email or phone provided)`);
      console.log(`[Booking Creation]    At least one contact method (email or phone) is required for invoice delivery`);
    }

    // Return the booking with proper structure
    res.status(201).json({ 
      id: bookingId,
      ...bookingData,
      booking: bookingData // Also include as 'booking' for backward compatibility
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Create booking error', error, context, {
      slot_id: req.body.slot_id,
      service_id: req.body.service_id,
      tenant_id: req.body.tenant_id,
      lock_id: req.body.lock_id,
    });
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Validate QR code (for cashiers/receptionists)
// ============================================================================
router.post('/validate-qr', authenticate, async (req, res) => {
  try {
    const { booking_id } = req.body;
    const userId = req.user?.id;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check user role (cashier or receptionist)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, tenant_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (userData.role !== 'cashier' && userData.role !== 'receptionist' && userData.role !== 'tenant_admin') {
      return res.status(403).json({ error: 'Only cashiers, receptionists, and admins can validate QR codes' });
    }

    // Get booking details with nested select for joins
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        id,
        tenant_id,
        customer_name,
        customer_phone,
        visitor_count,
        adult_count,
        child_count,
        total_price,
        qr_scanned,
        qr_scanned_at,
        qr_scanned_by_user_id,
        status,
        payment_status,
        services!inner (
          name,
          name_ar
        ),
        slots!inner (
          slot_date,
          start_time,
          end_time
        )
      `)
      .eq('id', booking_id)
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Check if booking belongs to same tenant
    if (booking.tenant_id !== userData.tenant_id) {
      return res.status(403).json({ error: 'Booking does not belong to your tenant' });
    }

    // Check if QR already scanned
    if (booking.qr_scanned) {
      return res.status(409).json({
        error: 'QR code has already been scanned',
        booking: {
          id: booking.id,
          customer_name: booking.customer_name,
          qr_scanned_at: booking.qr_scanned_at,
          qr_scanned_by_user_id: booking.qr_scanned_by_user_id,
        },
      });
    }

    // Mark QR as scanned
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        qr_scanned: true,
        qr_scanned_at: new Date().toISOString(),
        qr_scanned_by_user_id: userId,
        status: 'checked_in',
        checked_in_at: new Date().toISOString(),
        checked_in_by_user_id: userId
      })
      .eq('id', booking_id);

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      message: 'QR code validated successfully',
      booking: {
        id: booking.id,
        customer_name: booking.customer_name,
        customer_phone: booking.customer_phone,
        service_name: (booking.services as any).name,
        service_name_ar: (booking.services as any).name_ar,
        slot_date: (booking.slots as any).slot_date,
        start_time: (booking.slots as any).start_time,
        end_time: (booking.slots as any).end_time,
        visitor_count: booking.visitor_count,
        adult_count: booking.adult_count,
        child_count: booking.child_count,
        total_price: booking.total_price,
        status: 'checked_in',
        payment_status: booking.payment_status,
        qr_scanned: true,
        qr_scanned_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('QR validation error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Get active locks for slots (for frontend to filter unavailable slots)
// Supports both GET (for backward compatibility) and POST (for large requests)
// ============================================================================
router.get('/locks', async (req, res) => {
  try {
    const { slot_ids } = req.query;

    if (!slot_ids) {
      return res.status(400).json({ error: 'slot_ids required (comma-separated)' });
    }

    const slotIdArray = (slot_ids as string).split(',').filter(id => id.trim());

    if (slotIdArray.length === 0) {
      return res.json([]);
    }

    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of slotIdArray) {
      if (!uuidRegex.test(id)) {
        return res.status(400).json({ error: `Invalid UUID format: ${id}` });
      }
    }

    // Use .in() instead of ANY($1::uuid[])
    const { data, error } = await supabase
      .from('booking_locks')
      .select('slot_id, lock_expires_at')
      .in('slot_id', slotIdArray)
      .gt('lock_expires_at', new Date().toISOString());

    if (error) {
      throw error;
    }

    res.json(data || []);
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Get locks error', error, context, {
      slot_ids: req.query.slot_ids,
    });
    res.status(500).json({
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// POST endpoint for large requests (avoids 431 error)
router.post('/locks', async (req, res) => {
  try {
    const { slot_ids } = req.body;

    if (!slot_ids) {
      return res.status(400).json({ error: 'slot_ids required (array or comma-separated string)' });
    }

    // Handle both array and comma-separated string
    const slotIdArray = Array.isArray(slot_ids)
      ? slot_ids.filter(id => id && id.trim())
      : (slot_ids as string).split(',').filter(id => id.trim());

    if (slotIdArray.length === 0) {
      return res.json([]);
    }

    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of slotIdArray) {
      if (!uuidRegex.test(id)) {
        return res.status(400).json({ error: `Invalid UUID format: ${id}` });
      }
    }

    // Use .in() instead of ANY($1::uuid[])
    const { data, error } = await supabase
      .from('booking_locks')
      .select('slot_id, lock_expires_at')
      .in('slot_id', slotIdArray)
      .gt('lock_expires_at', new Date().toISOString());

    if (error) {
      throw error;
    }

    res.json(data || []);
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Post locks error', error, context, {
      slot_ids_count: Array.isArray(req.body.slot_ids) ? req.body.slot_ids.length : 'unknown',
    });
    res.status(500).json({
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ============================================================================
// Update payment status (triggers Zoho receipt generation if status = 'paid')
// ============================================================================
router.patch('/:id/payment-status', authenticate, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { payment_status } = req.body;
    const userId = req.user?.id;

    if (!payment_status) {
      return res.status(400).json({ error: 'payment_status is required' });
    }

    // Validate payment status
    const validStatuses = ['unpaid', 'paid', 'paid_manual', 'awaiting_payment', 'refunded'];
    if (!validStatuses.includes(payment_status)) {
      return res.status(400).json({
        error: `Invalid payment_status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Check if booking exists and user has permission
    const { data: bookingCheck, error: checkError } = await supabase
      .from('bookings')
      .select(`
        *,
        users!left (
          tenant_id,
          role
        )
      `)
      .eq('id', bookingId)
      .eq('users.id', userId)
      .single();

    if (checkError || !bookingCheck) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const userTenantId = (bookingCheck.users as any)?.tenant_id;
    const userRole = (bookingCheck.users as any)?.role;

    // Check permissions (tenant admin, receptionist, or cashier can update)
    if (userTenantId !== bookingCheck.tenant_id && userRole !== 'solution_owner') {
      return res.status(403).json({ error: 'You do not have permission to update this booking' });
    }

    // Update payment status
    // The database trigger will automatically queue Zoho receipt generation if status = 'paid'
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        payment_status: payment_status,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId);

    if (updateError) {
      throw updateError;
    }

    const { data: updatedBooking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    res.json({
      success: true,
      booking: updatedBooking,
      message: payment_status === 'paid'
        ? 'Payment status updated. Receipt generation queued.'
        : 'Payment status updated',
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Update payment status error', error, context, {
      booking_id: req.params.id,
      payment_status: req.body.payment_status,
    });
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export { router as bookingRoutes };
