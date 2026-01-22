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

// Middleware to authenticate tenant admin ONLY (for payment status and booking deletion)
function authenticateTenantAdminOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authorization header required',
        hint: 'Please provide a valid Bearer token in the Authorization header'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token || token.trim() === '') {
      return res.status(401).json({ error: 'Token is required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          hint: 'Please log in again to get a new token'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token',
          hint: 'The token format is invalid. Please log in again.'
        });
      }
      return res.status(401).json({ 
        error: 'Token verification failed',
        hint: jwtError.message || 'Please log in again'
      });
    }
    
    // STRICT: Only tenant_admin (Service Provider) can manage payment status and delete bookings
    if (decoded.role !== 'tenant_admin') {
      return res.status(403).json({ 
        error: 'Access denied. Only Service Providers (tenant admins) can perform this action.',
        userRole: decoded.role,
        hint: 'You must be logged in as a Service Provider to perform this action.'
      });
    }

    if (!decoded.tenant_id) {
      return res.status(403).json({ 
        error: 'Access denied. No tenant associated with your account.',
        hint: 'Please contact support to associate your account with a tenant.'
      });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
    };
    
    next();
  } catch (error: any) {
    return res.status(500).json({ error: 'Authentication error', hint: error.message });
  }
}

// Middleware to authenticate cashier only
function authenticateCashierOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authorization header required',
        hint: 'Please provide a valid Bearer token in the Authorization header'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token || token.trim() === '') {
      return res.status(401).json({ error: 'Token is required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          hint: 'Please log in again to get a new token'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token',
          hint: 'The token format is invalid. Please log in again.'
        });
      }
      return res.status(401).json({ 
        error: 'Token verification failed',
        hint: jwtError.message || 'Please log in again'
      });
    }
    
    // STRICT: Only cashiers allowed
    if (decoded.role !== 'cashier') {
      return res.status(403).json({ 
        error: 'Access denied. Only cashiers can perform this action.',
        userRole: decoded.role,
        hint: 'You must be logged in as a cashier to perform this action.'
      });
    }

    if (!decoded.tenant_id) {
      return res.status(403).json({ 
        error: 'Access denied. No tenant associated with your account.',
        hint: 'Please contact support to associate your account with a tenant.'
      });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
    };
    
    next();
  } catch (error: any) {
    return res.status(500).json({ error: 'Authentication error', hint: error.message });
  }
}

// TASK 5: Middleware to authenticate receptionist OR tenant admin (for booking creation/editing)
function authenticateReceptionistOrTenantAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authorization header required',
        hint: 'Please provide a valid Bearer token in the Authorization header'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token || token.trim() === '') {
      return res.status(401).json({ error: 'Token is required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          hint: 'Please log in again to get a new token'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token',
          hint: 'The token format is invalid. Please log in again.'
        });
      }
      return res.status(401).json({ 
        error: 'Token verification failed',
        hint: jwtError.message || 'Please log in again'
      });
    }
    
    // TASK 5: Allow receptionist OR tenant_admin (but not cashier)
    if (decoded.role !== 'receptionist' && decoded.role !== 'tenant_admin') {
      return res.status(403).json({ 
        error: 'Access denied. Only receptionists and tenant owners can create/edit bookings.',
        userRole: decoded.role,
        hint: 'Cashiers cannot create or edit bookings. Please use a receptionist or tenant owner account.'
      });
    }

    if (!decoded.tenant_id) {
      return res.status(403).json({ 
        error: 'Access denied. No tenant associated with your account.',
        hint: 'Please contact support to associate your account with a tenant.'
      });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
    };
    
    next();
  } catch (error: any) {
    return res.status(500).json({ error: 'Authentication error', hint: error.message });
  }
}

/**
 * Log booking changes to audit_logs table
 */
async function logBookingChange(
  actionType: string,
  bookingId: string,
  tenantId: string,
  userId: string,
  oldValues: any,
  newValues: any,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    await supabase
      .from('audit_logs')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        action_type: actionType,
        resource_type: 'booking',
        resource_id: bookingId,
        old_values: oldValues,
        new_values: newValues,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
    console.log(`[Audit] Logged ${actionType} for booking ${bookingId}`);
  } catch (error: any) {
    console.error(`[Audit] Failed to log booking change:`, error.message);
    // Don't throw - audit logging failure shouldn't break the operation
  }
}

/**
 * Validate payment status transition
 */
function validatePaymentStatusTransition(oldStatus: string, newStatus: string): { valid: boolean; error?: string } {
  // Define valid transitions (must match database enum values)
  // Note: Allowing corrections for manual adjustments and error corrections
  const validTransitions: Record<string, string[]> = {
    'unpaid': ['paid', 'paid_manual', 'awaiting_payment', 'refunded'],
    'awaiting_payment': ['paid', 'paid_manual', 'unpaid', 'refunded'],
    'paid': ['refunded', 'unpaid', 'awaiting_payment'], // Allow corrections if payment was recorded incorrectly
    'paid_manual': ['refunded', 'unpaid', 'awaiting_payment'], // Allow corrections for manual entries
    'refunded': ['unpaid', 'awaiting_payment'], // Allow corrections if refund was processed incorrectly
  };

  const allowed = validTransitions[oldStatus] || [];
  if (!allowed.includes(newStatus)) {
    return {
      valid: false,
      error: `Invalid payment status transition: ${oldStatus} → ${newStatus}. Allowed transitions from ${oldStatus}: ${allowed.join(', ') || 'none (terminal state)'}`
    };
  }

  return { valid: true };
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
// TASK 5: Receptionist and tenant_admin can create bookings (not cashier)
router.post('/create', authenticateReceptionistOrTenantAdmin, async (req, res) => {
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
    console.log(`🎫 TICKET GENERATION STARTING for booking ${bookingId}`);
    console.log(`🎫 Customer: ${customer_name}`);
    console.log(`🎫 Email: ${customer_email || 'NOT PROVIDED'}`);
    console.log(`🎫 Phone: ${normalizedPhone || customer_phone || 'NOT PROVIDED'}`);
    console.log(`🎫 ========================================\n`);
    
    // Generate ticket PDF synchronously to ensure it completes before response
    // This prevents Railway container restarts from killing the process
    // The actual sending (WhatsApp/Email) can be async
    const ticketGenerationPromise = (async () => {
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
        // Don't re-throw - we want to continue even if ticket generation fails
      }
    })();
    
    // Wait for PDF generation and sending to complete before sending response
    // This ensures tickets are sent even if Railway container restarts
    // CRITICAL: This prevents Railway from killing the process before tickets are sent
    try {
      await ticketGenerationPromise;
      console.log(`🎫 ✅ Ticket generation and sending completed for booking ${bookingId}`);
    } catch (error: any) {
      console.error(`🎫 ⚠️ Ticket generation error (non-blocking):`, error);
      // Don't fail booking if ticket generation fails - booking is already created
      // The error was already logged in the inner try-catch
    }

    // Automatically create invoice after booking is created
    // This runs asynchronously so it doesn't block the booking response
    // Invoice is created for ALL bookings with email OR phone
    // Delivery: Email (if email provided), WhatsApp (if phone provided), or both
    // Note: Payment status is not used - invoices are created for all bookings
    // IMPORTANT: Use Promise.resolve().then() for better reliability on Railway
    // This ensures the async operation completes even if the container restarts
    if (normalizedPhone || customer_phone || customer_email) {
      // Use Promise.resolve().then() to ensure invoice creation happens after response is sent
      // This prevents container restarts from interrupting the process
      Promise.resolve().then(async () => {
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
      }).catch((error) => {
        console.error(`[Booking Creation] ❌ CRITICAL: Unhandled error in invoice generation promise`);
        console.error(`[Booking Creation]    Error:`, error);
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
/**
 * Extract booking ID from QR code content
 * Supports multiple formats:
 * 1. Raw UUID: "123e4567-e89b-12d3-a456-426614174000"
 * 2. URL format: "https://backend.com/api/bookings/123e4567-e89b-12d3-a456-426614174000/details"
 * 3. URL format (no protocol): "backend.com/api/bookings/123e4567-e89b-12d3-a456-426614174000/details"
 */
function extractBookingIdFromQR(qrContent: string): string | null {
  if (!qrContent || typeof qrContent !== 'string') {
    return null;
  }

  const trimmed = qrContent.trim();
  
  // NEW: Try to parse as JSON (structured booking data format)
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.booking_id) {
      // Validate it's a UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(parsed.booking_id)) {
        console.log('[QR Extract] Found booking_id in JSON format');
        return parsed.booking_id;
      }
    }
  } catch (e) {
    // Not JSON, continue to other formats
  }
  
  // LEGACY: If it's already a raw UUID, return it
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(trimmed)) {
    console.log('[QR Extract] Found raw UUID format');
    return trimmed;
  }

  // LEGACY: Try to extract UUID from URL
  // Pattern: /api/bookings/{uuid}/details or /bookings/{uuid}/details
  const urlMatch = trimmed.match(/\/bookings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (urlMatch && urlMatch[1]) {
    console.log('[QR Extract] Found UUID in URL format');
    return urlMatch[1];
  }

  // LEGACY: Try to find UUID anywhere in the string
  const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch && uuidMatch[0]) {
    console.log('[QR Extract] Found UUID in string');
    return uuidMatch[0];
  }

  console.log('[QR Extract] No valid booking ID found in QR content');
  return null;
}

router.post('/validate-qr', authenticate, async (req, res) => {
  try {
    const { booking_id } = req.body;
    const userId = req.user?.id;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    // Extract booking ID from QR content (supports URL or raw UUID)
    const extractedBookingId = extractBookingIdFromQR(booking_id);
    
    if (!extractedBookingId) {
      return res.status(400).json({ 
        error: 'Invalid QR code format. QR code must contain a valid booking ID or booking URL.',
        hint: 'The QR code should contain either a booking ID (UUID) or a URL pointing to booking details.'
      });
    }

    // Validate extracted booking ID is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(extractedBookingId)) {
      return res.status(400).json({ 
        error: 'Invalid booking ID format. Extracted ID is not a valid UUID.',
        extractedId: extractedBookingId
      });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check user role - TASK 5: Only cashiers can scan QR codes
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, tenant_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    // TASK 5: Strict role enforcement - Only cashiers can scan QR codes
    if (userData.role !== 'cashier') {
      return res.status(403).json({ 
        error: 'Access denied. Only cashiers can scan QR codes.',
        userRole: userData.role,
        hint: 'Receptionists and tenant owners cannot scan QR codes. Please use a cashier account.'
      });
    }

    // Use extracted booking ID for database query
    const bookingIdToUse = extractedBookingId;

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
      .eq('id', bookingIdToUse)
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
      .eq('id', bookingIdToUse);

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
      extracted_booking_id: bookingIdToUse, // Include for debugging
    });
  } catch (error: any) {
    console.error('QR validation error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Get booking details (public - for external QR scanners)
// Read-only access - no authentication required
// Supports both JSON (API) and HTML (browser) responses
// ============================================================================
router.get('/:id/details', async (req, res) => {
  try {
    const bookingId = req.params.id;

    // Validate booking_id format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID format' });
    }

    // Get booking details (read-only, no state modification)
    // SECURITY: Public endpoint does NOT return status or payment information
    // Only ticket details are returned for external scanners
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        id,
        customer_name,
        customer_phone,
        customer_email,
        visitor_count,
        adult_count,
        child_count,
        total_price,
        services!inner (
          name,
          name_ar,
          description,
          description_ar
        ),
        slots!inner (
          slot_date,
          start_time,
          end_time
        ),
        tenants!inner (
          name,
          name_ar
        )
      `)
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      // Check if request wants HTML (browser) or JSON (API)
      const userAgent = req.headers['user-agent'] || '';
      const isBrowser = userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari') || userAgent.includes('Firefox') || userAgent.includes('Edge');
      const acceptsJson = req.headers.accept?.includes('application/json');
      const acceptsHtml = req.headers.accept?.includes('text/html');
      const shouldReturnHtml = acceptsHtml || (isBrowser && !acceptsJson);
      
      if (shouldReturnHtml) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Booking Not Found</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
              .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; }
              h1 { color: #e74c3c; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Booking Not Found</h1>
              <p>The booking with ID ${bookingId} could not be found.</p>
              <p>Please verify the QR code is valid and not expired.</p>
            </div>
          </body>
          </html>
        `);
      }
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Helper function to format date as MM-DD-YYYY
    const formatDate = (dateString: string): string => {
      if (!dateString) return 'N/A';
      try {
        const date = new Date(dateString);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        return `${month}-${day}-${year}`;
      } catch {
        return dateString.substring(0, 10) || 'N/A';
      }
    };

    // Helper function to format time to 12-hour format (e.g., "8:00 PM")
    const formatTime12Hour = (timeString: string): string => {
      if (!timeString) return 'N/A';
      try {
        const [hours, minutes] = timeString.split(':');
        const hour = parseInt(hours || '0', 10);
        const min = minutes || '00';
        const period = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        return `${displayHour}:${min} ${period}`;
      } catch {
        return timeString;
      }
    };

    // Determine ticket type
    const getTicketType = (): string => {
      if (booking.adult_count > 0 && booking.child_count === 0) {
        return booking.adult_count > 1 ? `${booking.adult_count} Adults` : 'Adult';
      } else if (booking.child_count > 0 && booking.adult_count === 0) {
        return booking.child_count > 1 ? `${booking.child_count} Children` : 'Child';
      } else if (booking.adult_count > 0 && booking.child_count > 0) {
        return `${booking.adult_count} Adult${booking.adult_count > 1 ? 's' : ''}, ${booking.child_count} Child${booking.child_count > 1 ? 'ren' : ''}`;
      }
      return 'General';
    };

    // SECURITY: Public endpoint returns ticket details only, NO status or payment info
    // Explicitly construct object to ensure no status fields leak through
    const bookingData: {
      id: string;
      customer_name: string;
      customer_phone: string;
      customer_email?: string | null;
      visitor_count: number;
      adult_count: number | null;
      child_count: number | null;
      total_price: number;
      slot_date: string;
      start_time: string;
      end_time: string;
      service_name: string;
      service_name_ar?: string | null;
      service_description?: string | null;
      service_description_ar?: string | null;
      tenant_name?: string | null;
      tenant_name_ar?: string | null;
      formatted_date: string;
      formatted_start_time: string;
      formatted_end_time: string;
      ticket_type: string;
    } = {
      id: booking.id,
      customer_name: booking.customer_name,
      customer_phone: booking.customer_phone,
      customer_email: (booking as any).customer_email || null,
      visitor_count: booking.visitor_count,
      adult_count: booking.adult_count || null,
      child_count: booking.child_count || null,
      total_price: booking.total_price,
      slot_date: (booking.slots as any).slot_date,
      start_time: (booking.slots as any).start_time,
      end_time: (booking.slots as any).end_time,
      service_name: (booking.services as any).name,
      service_name_ar: (booking.services as any).name_ar || null,
      service_description: (booking.services as any).description || null,
      service_description_ar: (booking.services as any).description_ar || null,
      tenant_name: (booking.tenants as any)?.name || null,
      tenant_name_ar: (booking.tenants as any)?.name_ar || null,
      formatted_date: formatDate((booking.slots as any).slot_date),
      formatted_start_time: formatTime12Hour((booking.slots as any).start_time),
      formatted_end_time: formatTime12Hour((booking.slots as any).end_time),
      ticket_type: getTicketType(),
    };
    
    // Explicitly verify no status fields are present (defensive programming)
    if ('status' in bookingData || 'payment_status' in bookingData || 'qr_scanned' in bookingData) {
      console.error('[SECURITY] CRITICAL: Status fields detected in public booking data!');
      console.error('   This should never happen. Removing status fields...');
      delete (bookingData as any).status;
      delete (bookingData as any).payment_status;
      delete (bookingData as any).qr_scanned;
      delete (bookingData as any).qr_scanned_at;
    }

    // Check if request wants HTML (browser) or JSON (API)
    // Default to HTML if no Accept header or if it's a browser request
    // Browser requests typically have Accept: text/html or no Accept header
    // API requests typically have Accept: application/json
    const userAgent = req.headers['user-agent'] || '';
    const isBrowser = userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari') || userAgent.includes('Firefox') || userAgent.includes('Edge');
    const acceptsJson = req.headers.accept?.includes('application/json');
    const acceptsHtml = req.headers.accept?.includes('text/html');
    
    // Return HTML if:
    // 1. Explicitly accepts HTML, OR
    // 2. It's a browser (has user-agent) and doesn't explicitly request JSON
    const shouldReturnHtml = acceptsHtml || (isBrowser && !acceptsJson);
    
    if (shouldReturnHtml) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Booking Details - ${bookingData.customer_name}</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              background: #f5f7fa;
              min-height: 100vh;
              padding: 20px;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              max-width: 500px;
              width: 100%;
              background: white;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.1);
              overflow: hidden;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 25px;
              text-align: center;
            }
            .header h1 { 
              font-size: 22px; 
              margin-bottom: 8px; 
              font-weight: 600;
            }
            .content { 
              padding: 30px 25px; 
            }
            .detail-section {
              margin-bottom: 25px;
              padding-bottom: 20px;
              border-bottom: 1px solid #e8ecef;
            }
            .detail-section:last-child {
              border-bottom: none;
              margin-bottom: 0;
              padding-bottom: 0;
            }
            .detail-label {
              font-size: 11px;
              font-weight: 600;
              color: #6c757d;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 8px;
            }
            .detail-value {
              font-size: 16px;
              font-weight: 600;
              color: #212529;
              line-height: 1.5;
            }
            .event-name {
              font-size: 18px;
              font-weight: 700;
              color: #212529;
              margin-bottom: 2px;
            }
            .date-time {
              font-size: 15px;
              color: #495057;
            }
            .ticket-type {
              font-size: 15px;
              color: #495057;
            }
            .customer-name {
              font-size: 16px;
              color: #212529;
            }
            .price {
              font-size: 20px;
              font-weight: 700;
              color: #28a745;
            }
            .footer {
              background: #f8f9fa;
              padding: 15px;
              text-align: center;
              color: #6c757d;
              font-size: 11px;
            }
            .status-indicator {
              display: inline-block;
              padding: 4px 10px;
              border-radius: 12px;
              font-size: 11px;
              font-weight: 600;
              text-transform: uppercase;
              margin-top: 5px;
            }
            .status-confirmed {
              background: #d4edda;
              color: #155724;
            }
            .status-pending {
              background: #fff3cd;
              color: #856404;
            }
            .status-cancelled {
              background: #f8d7da;
              color: #721c24;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📋 Booking Ticket</h1>
            </div>
            <div class="content">
              <div class="detail-section">
                <div class="detail-label">EVENT DETAILS</div>
                <div class="event-name">${bookingData.service_name || 'Service'}</div>
              </div>
              
              <div class="detail-section">
                <div class="detail-label">DATE & TIME</div>
                <div class="date-time">${bookingData.formatted_date}</div>
                <div class="date-time">${bookingData.formatted_start_time} - ${bookingData.formatted_end_time}</div>
              </div>
              
              <div class="detail-section">
                <div class="detail-label">TICKET TYPE</div>
                <div class="ticket-type">${bookingData.ticket_type}</div>
              </div>
              
              <div class="detail-section">
                <div class="detail-label">CUSTOMER NAME</div>
                <div class="customer-name">${bookingData.customer_name}</div>
              </div>
              
              <div class="detail-section">
                <div class="detail-label">PRICE</div>
                <div class="price">${bookingData.total_price.toFixed(2)} SAR</div>
              </div>
            </div>
            <div class="footer">
              Booking ID: ${bookingData.id.substring(0, 8).toUpperCase()}...
            </div>
          </div>
        </body>
        </html>
      `);
    }

    // Return JSON for API requests
    // SECURITY: Explicitly filter out any status fields that might have leaked through
    const safeBookingData = { ...bookingData };
    delete (safeBookingData as any).status;
    delete (safeBookingData as any).payment_status;
    delete (safeBookingData as any).qr_scanned;
    delete (safeBookingData as any).qr_scanned_at;
    delete (safeBookingData as any).checked_in_at;
    delete (safeBookingData as any).checked_in_by_user_id;
    
    res.json({
      success: true,
      booking: safeBookingData,
    });
  } catch (error: any) {
    console.error('Get booking details error:', error);
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
// Update booking details (Service Provider only)
// ============================================================================
// TASK 5: Receptionist and tenant_admin can edit bookings (not cashier)
router.patch('/:id', authenticateReceptionistOrTenantAdmin, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;
    const updateData = req.body;

    // Get current booking to verify ownership and get old values
    const { data: currentBooking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !currentBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify tenant ownership
    if (currentBooking.tenant_id !== tenantId) {
      return res.status(403).json({ 
        error: 'Access denied. This booking belongs to a different tenant.' 
      });
    }

    // TASK 8: Prepare update payload (only allow specific fields)
    // TASK 5: Only tenant_admin can change slot_id (reschedule), receptionist cannot
    const allowedFields = [
      'customer_name',
      'customer_phone',
      'customer_email',
      'visitor_count',
      'adult_count',
      'child_count',
      'total_price',
      'status',
      'notes',
      'employee_id',
    ];
    
    // TASK 8: Only tenant_admin can reschedule bookings (change slot_id)
    if (req.user!.role === 'tenant_admin' && 'slot_id' in updateData) {
      allowedFields.push('slot_id');
    } else if (req.user!.role === 'receptionist' && 'slot_id' in updateData) {
      return res.status(403).json({ 
        error: 'Access denied. Only tenant owners can reschedule bookings.',
        hint: 'Receptionists cannot change booking times. Please contact a tenant owner.'
      });
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };

    // Only include allowed fields that are provided
    for (const field of allowedFields) {
      if (field in updateData) {
        updatePayload[field] = updateData[field];
      }
    }

    // Validate status if provided (must match database enum: cancelled not canceled)
    if (updatePayload.status) {
      const validStatuses = ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled'];
      if (!validStatuses.includes(updatePayload.status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }
    }

    // Validate visitor counts if provided
    if (updatePayload.visitor_count !== undefined) {
      if (updatePayload.visitor_count < 1) {
        return res.status(400).json({ error: 'visitor_count must be at least 1' });
      }
    }

    if (updatePayload.adult_count !== undefined && updatePayload.adult_count < 0) {
      return res.status(400).json({ error: 'adult_count cannot be negative' });
    }

    if (updatePayload.child_count !== undefined && updatePayload.child_count < 0) {
      return res.status(400).json({ error: 'child_count cannot be negative' });
    }

    // TASK 8: Validate slot_id change (rescheduling) - only for tenant_admin
    let slotChanged = false;
    let oldSlotId: string | null = null;
    if (updatePayload.slot_id && updatePayload.slot_id !== currentBooking.slot_id) {
      slotChanged = true;
      oldSlotId = currentBooking.slot_id;
      
      // Validate new slot exists and belongs to same service/tenant
      const { data: newSlot, error: slotError } = await supabase
        .from('time_slots')
        .select(`
          id,
          tenant_id,
          service_id,
          total_capacity,
          remaining_capacity,
          is_available,
          start_time_utc,
          end_time_utc
        `)
        .eq('id', updatePayload.slot_id)
        .single();

      if (slotError || !newSlot) {
        return res.status(404).json({ error: 'New time slot not found' });
      }

      // Verify slot belongs to same tenant and service
      if (newSlot.tenant_id !== tenantId) {
        return res.status(403).json({ error: 'New slot belongs to a different tenant' });
      }
      if (newSlot.service_id !== currentBooking.service_id) {
        return res.status(400).json({ error: 'New slot belongs to a different service. Cannot change service when rescheduling.' });
      }

      // Check slot availability and capacity
      if (!newSlot.is_available) {
        return res.status(409).json({ error: 'Selected time slot is not available' });
      }

      const requiredCapacity = updatePayload.visitor_count || currentBooking.visitor_count;
      if (newSlot.remaining_capacity < requiredCapacity) {
        return res.status(409).json({ 
          error: `Not enough capacity. Slot has ${newSlot.remaining_capacity} available, but booking requires ${requiredCapacity}`,
          available_capacity: newSlot.remaining_capacity,
          required_capacity: requiredCapacity
        });
      }

      // Check if slot is in the past
      const slotStartTime = new Date(newSlot.start_time_utc);
      const now = new Date();
      if (slotStartTime < now) {
        return res.status(400).json({ error: 'Cannot reschedule to a time slot in the past' });
      }
    }

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // TASK 9 & 10: If slot changed, invalidate old ticket and generate new one, then notify customer
    if (slotChanged && oldSlotId) {
      console.log(`\n🔄 ========================================`);
      console.log(`🔄 TASK 9 & 10: Booking rescheduled - regenerating ticket`);
      console.log(`   Booking ID: ${bookingId}`);
      console.log(`   Old Slot: ${oldSlotId}`);
      console.log(`   New Slot: ${updatePayload.slot_id}`);
      console.log(`🔄 ========================================\n`);

      // TASK 9: Invalidate old QR code by clearing qr_token and resetting qr_scanned
      await supabase
        .from('bookings')
        .update({
          qr_token: null,
          qr_scanned: false,
          qr_scanned_at: null,
          qr_scanned_by_user_id: null,
        })
        .eq('id', bookingId);

      // TASK 9 & 10: Generate new ticket and send to customer asynchronously
      Promise.resolve().then(async () => {
        try {
          // Get booking details for ticket generation
          const { data: bookingDetails } = await supabase
            .from('bookings')
            .select(`
              id,
              customer_name,
              customer_phone,
              customer_email,
              language,
              services:service_id (name, name_ar),
              slots:slot_id (slot_date, start_time, end_time),
              tenants:tenant_id (name, name_ar)
            `)
            .eq('id', bookingId)
            .single();

          if (!bookingDetails) {
            console.error('❌ Could not fetch booking details for ticket regeneration');
            return;
          }

          // Import required modules
          const { generateBookingTicketPDFBase64 } = await import('../services/pdfService.js');
          const { sendWhatsAppDocument } = await import('../services/whatsappService.js');
          const { sendBookingTicketEmail } = await import('../services/emailService.js');

          const ticketLanguage = (bookingDetails.language === 'ar' || bookingDetails.language === 'en')
            ? bookingDetails.language as 'en' | 'ar'
            : 'en';

          // Generate new PDF
          console.log(`📄 Generating new ticket PDF for rescheduled booking ${bookingId}...`);
          const pdfBase64 = await generateBookingTicketPDFBase64(bookingId, ticketLanguage);
          const pdfBuffer = Buffer.from(pdfBase64, 'base64');

          // Get tenant WhatsApp settings
          const { data: tenantData } = await supabase
            .from('tenants')
            .select('whatsapp_settings')
            .eq('id', tenantId)
            .single();

          let whatsappConfig: any = null;
          if (tenantData?.whatsapp_settings) {
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
          }

          // TASK 10: Send new ticket via WhatsApp
          const normalizedPhone = normalizePhoneNumber(bookingDetails.customer_phone);
          if (normalizedPhone && pdfBuffer) {
            const whatsappMessage = ticketLanguage === 'ar'
              ? 'تم تغيير موعد حجزك! يرجى الاطلاع على التذكرة المحدثة المرفقة.'
              : 'Your booking time has been changed! Please find your updated ticket attached.';
            
            await sendWhatsAppDocument(
              normalizedPhone,
              pdfBuffer,
              `booking_ticket_${bookingId}_updated.pdf`,
              whatsappMessage,
              whatsappConfig || undefined
            );
            console.log(`✅ New ticket sent via WhatsApp to ${normalizedPhone}`);
          }

          // TASK 10: Send new ticket via Email
          if (bookingDetails.customer_email && pdfBuffer) {
            await sendBookingTicketEmail(
              bookingDetails.customer_email,
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
            console.log(`✅ New ticket sent via Email to ${bookingDetails.customer_email}`);
          }

          console.log(`\n✅ TASK 9 & 10 Complete: New ticket generated and sent to customer\n`);
        } catch (error: any) {
          console.error('❌ Error regenerating ticket after reschedule:', error);
          // Don't fail the booking update if ticket regeneration fails
        }
      }).catch(error => {
        console.error('❌ Unhandled error in ticket regeneration promise:', error);
      });
    }

    // Log audit trail
    await logBookingChange(
      'update',
      bookingId,
      tenantId,
      userId,
      currentBooking,
      updatedBooking,
      req.ip,
      req.get('user-agent')
    );

    res.json({
      success: true,
      booking: updatedBooking,
      message: slotChanged ? 'Booking rescheduled successfully. New ticket has been sent to customer.' : 'Booking updated successfully',
      slot_changed: slotChanged,
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Update booking error', error, context, {
      booking_id: req.params.id,
    });
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Delete booking (Service Provider only)
// ============================================================================
router.delete('/:id', authenticateTenantAdminOnly, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;

    // Get current booking to verify ownership
    const { data: currentBooking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !currentBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify tenant ownership
    if (currentBooking.tenant_id !== tenantId) {
      return res.status(403).json({ 
        error: 'Access denied. This booking belongs to a different tenant.' 
      });
    }

    // Prevent deletion of paid or finalized bookings (unless explicitly allowed)
    const { allowDeletePaid } = req.query;
    if (!allowDeletePaid && (currentBooking.payment_status === 'paid' || currentBooking.payment_status === 'paid_manual')) {
      return res.status(403).json({ 
        error: 'Cannot delete paid bookings. Set allowDeletePaid=true to override.',
        hint: 'Consider canceling the booking instead of deleting it.'
      });
    }

    // Soft delete: Mark as cancelled (database enum uses 'cancelled' not 'canceled')
    // Note: If your database supports soft deletes, use that instead
    const { error: deleteError } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
        notes: currentBooking.notes 
          ? `${currentBooking.notes}\n[DELETED by Service Provider on ${new Date().toISOString()}]`
          : `[DELETED by Service Provider on ${new Date().toISOString()}]`,
      })
      .eq('id', bookingId);

    if (deleteError) {
      throw deleteError;
    }

    // Log audit trail
    await logBookingChange(
      'delete',
      bookingId,
      tenantId,
      userId,
      currentBooking,
      { status: 'cancelled', deleted_at: new Date().toISOString() },
      req.ip,
      req.get('user-agent')
    );

    res.json({
      success: true,
      message: 'Booking deleted successfully',
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Delete booking error', error, context, {
      booking_id: req.params.id,
    });
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Update payment status (Service Provider only) with Zoho synchronization
// ============================================================================
router.patch('/:id/payment-status', authenticateTenantAdminOnly, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { payment_status } = req.body;
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;

    if (!payment_status) {
      return res.status(400).json({ error: 'payment_status is required' });
    }

    // Validate payment status (must match database enum)
    const validStatuses = ['unpaid', 'paid', 'paid_manual', 'awaiting_payment', 'refunded'];
    if (!validStatuses.includes(payment_status)) {
      return res.status(400).json({
        error: `Invalid payment_status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Get current booking to verify ownership and validate transition
    const { data: currentBooking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !currentBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify tenant ownership
    if (currentBooking.tenant_id !== tenantId) {
      return res.status(403).json({ 
        error: 'Access denied. This booking belongs to a different tenant.' 
      });
    }

    // Validate state transition
    const oldStatus = currentBooking.payment_status;
    const transitionValidation = validatePaymentStatusTransition(oldStatus, payment_status);
    if (!transitionValidation.valid) {
      return res.status(400).json({ 
        error: transitionValidation.error 
      });
    }

    // Update payment status in database
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        payment_status: payment_status,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log audit trail
    await logBookingChange(
      'payment_status_update',
      bookingId,
      tenantId,
      userId,
      { payment_status: oldStatus },
      { payment_status: payment_status },
      req.ip,
      req.get('user-agent')
    );

    // CRITICAL: Sync with Zoho Invoice if invoice exists
    let zohoSyncResult: { success: boolean; error?: string } | null = null;
    if (currentBooking.zoho_invoice_id) {
      try {
        console.log(`[Booking Payment Status] Syncing with Zoho invoice ${currentBooking.zoho_invoice_id}...`);
        const { zohoService } = await import('../services/zohoService.js');
        zohoSyncResult = await zohoService.updateInvoiceStatus(
          tenantId,
          currentBooking.zoho_invoice_id,
          payment_status
        );

        if (zohoSyncResult.success) {
          console.log(`[Booking Payment Status] ✅ Zoho invoice status synced successfully`);
        } else {
          console.error(`[Booking Payment Status] ⚠️  Zoho invoice sync failed: ${zohoSyncResult.error}`);
          // Hint is already provided by zohoService for authorization errors
          // Don't fail the booking update - log the error but continue
        }
      } catch (zohoError: any) {
        console.error(`[Booking Payment Status] ⚠️  Zoho sync error:`, zohoError.message);
        zohoSyncResult = { success: false, error: zohoError.message };
        // Don't fail the booking update - Zoho sync failure shouldn't block payment status update
      }
    } else {
      console.log(`[Booking Payment Status] No Zoho invoice ID found - skipping sync`);
    }

    // Return response with sync status
    res.json({
      success: true,
      booking: updatedBooking,
      zoho_sync: zohoSyncResult || { success: false, error: 'No invoice to sync' },
      message: payment_status === 'paid'
        ? 'Payment status updated. Zoho invoice synced.'
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

// Cashier-only endpoint: Mark booking as paid (only if currently unpaid)
router.patch('/:id/mark-paid', authenticateCashierOnly, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;

    // Get current booking to verify ownership and current status
    const { data: currentBooking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !currentBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify tenant ownership
    if (currentBooking.tenant_id !== tenantId) {
      return res.status(403).json({ 
        error: 'Access denied. This booking belongs to a different tenant.' 
      });
    }

    // STRICT: Cashier can only mark as paid if currently unpaid or awaiting_payment
    if (currentBooking.payment_status !== 'unpaid' && currentBooking.payment_status !== 'awaiting_payment') {
      return res.status(400).json({ 
        error: `Cannot mark as paid. Current payment status is: ${currentBooking.payment_status}. Cashiers can only mark unpaid bookings as paid.`
      });
    }

    // Update payment status to paid_manual
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        payment_status: 'paid_manual',
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log audit trail
    await logBookingChange(
      'payment_status_update',
      bookingId,
      tenantId,
      userId,
      { payment_status: currentBooking.payment_status },
      { payment_status: 'paid_manual' },
      req.ip,
      req.get('user-agent')
    );

    // Sync with Zoho if invoice exists (non-blocking)
    if (currentBooking.zoho_invoice_id) {
      try {
        const { zohoService } = await import('../services/zohoService.js');
        await zohoService.updateInvoiceStatus(
          tenantId,
          currentBooking.zoho_invoice_id,
          'paid_manual'
        ).catch(err => {
          console.error('[Cashier Mark Paid] Zoho sync failed (non-blocking):', err.message);
        });
      } catch (zohoError: any) {
        console.error('[Cashier Mark Paid] Zoho sync error (non-blocking):', zohoError.message);
      }
    }

    res.json({
      success: true,
      message: 'Booking marked as paid successfully',
      booking: updatedBooking
    });
  } catch (error: any) {
    logger.error('Mark paid error:', error);
    res.status(500).json({ error: error.message || 'Failed to mark booking as paid' });
  }
});

export { router as bookingRoutes };
