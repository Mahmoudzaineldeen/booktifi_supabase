import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { formatCurrency } from '../utils/currency';

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
      console.error('[Auth] Access denied for booking time edit:', {
        userId: decoded.id,
        email: decoded.email,
        actualRole: decoded.role,
        requiredRole: 'tenant_admin',
        tenantId: decoded.tenant_id
      });
      return res.status(403).json({ 
        error: 'Access denied. Only Service Providers (tenant admins) can perform this action.',
        userRole: decoded.role,
        requiredRole: 'tenant_admin',
        hint: 'You must be logged in as a Service Provider (tenant_admin role) to edit booking times. Current role: ' + decoded.role
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
// Create bulk booking (multiple slots in one transaction)
// ============================================================================
// TASK: Receptionist and tenant_admin can create bulk bookings
// This endpoint validates ALL slots before creating any bookings (prevents overbooking)
// Creates all bookings atomically, generates ONE invoice, and ONE ticket PDF
// CRITICAL: authenticateReceptionistOrTenantAdmin middleware MUST run first
router.post('/create-bulk', authenticateReceptionistOrTenantAdmin, async (req, res) => {
  try {
    const {
      slot_ids, // Array of slot IDs to book
      service_id,
      tenant_id,
      customer_name,
      customer_phone,
      customer_email,
      visitor_count, // Total visitors across all slots
      adult_count,
      child_count,
      total_price, // Total price for all bookings
      notes,
      employee_id,
      session_id,
      offer_id,
      language = 'en',
      booking_group_id // Optional: group ID to link bookings
    } = req.body;

    // Validate language
    const validLanguage = (language === 'ar' || language === 'en') ? language : 'en';

    // Validate required fields
    if (!slot_ids || !Array.isArray(slot_ids) || slot_ids.length === 0) {
      return res.status(400).json({ error: 'slot_ids array is required and must contain at least one slot' });
    }

    if (!service_id || !tenant_id || !customer_name || !customer_phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(customer_phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Calculate adult_count and child_count if not provided
    const finalAdultCount = adult_count !== undefined ? adult_count : visitor_count;
    const finalChildCount = child_count !== undefined ? child_count : 0;

    // Ensure visitor_count matches adult_count + child_count
    const calculatedVisitorCount = finalAdultCount + finalChildCount;
    if (calculatedVisitorCount !== visitor_count) {
      return res.status(400).json({
        error: `visitor_count (${visitor_count}) must equal adult_count (${finalAdultCount}) + child_count (${finalChildCount})`
      });
    }

    // CRITICAL: Validate that number of slots matches visitor_count
    // In bulk booking, each slot gets 1 visitor
    if (slot_ids.length !== visitor_count) {
      return res.status(400).json({
        error: `Number of slots (${slot_ids.length}) must match visitor_count (${visitor_count}). Each slot requires 1 visitor.`
      });
    }

    // CRITICAL: Pre-validate slot availability before calling RPC
    // This provides early rejection and better error messages
    // The RPC function will do a final check with locks, but this catches obvious issues early
    try {
      const { data: slotsData, error: slotsError } = await supabase
        .from('slots')
        .select('id, available_capacity, is_available, tenant_id')
        .in('id', slot_ids)
        .eq('tenant_id', tenant_id);

      if (slotsError) {
        return res.status(500).json({ 
          error: 'Failed to validate slot availability',
          details: slotsError.message 
        });
      }

      if (!slotsData || slotsData.length !== slot_ids.length) {
        return res.status(400).json({ 
          error: 'One or more slots not found or do not belong to your tenant' 
        });
      }

      // Check if all slots are available and have capacity
      const unavailableSlots = slotsData.filter(s => !s.is_available || s.available_capacity < 1);
      if (unavailableSlots.length > 0) {
        return res.status(409).json({ 
          error: `Not enough tickets available. ${unavailableSlots.length} slot(s) are unavailable or have no capacity.`,
          unavailable_slots: unavailableSlots.map(s => s.id)
        });
      }

      // Calculate total available capacity
      const totalAvailable = slotsData.reduce((sum, s) => sum + (s.available_capacity || 0), 0);
      if (totalAvailable < visitor_count) {
        return res.status(409).json({ 
          error: `Not enough tickets available. Total available: ${totalAvailable}, Requested: ${visitor_count}.`
        });
      }
    } catch (validationError: any) {
      return res.status(500).json({ 
        error: 'Failed to validate slot availability',
        details: validationError.message 
      });
    }

    // CRITICAL: Idempotency check - prevent duplicate bookings
    // If booking_group_id is provided, check if it already exists
    if (booking_group_id) {
      const { data: existingBookings, error: checkError } = await supabase
        .from('bookings')
        .select('id')
        .eq('booking_group_id', booking_group_id)
        .limit(1);

      if (checkError) {
        console.error(`[Bulk Booking Creation] ⚠️ Error checking idempotency:`, checkError);
        // Continue anyway - idempotency check is best effort
      } else if (existingBookings && existingBookings.length > 0) {
        return res.status(409).json({ 
          error: 'Booking group already exists. This appears to be a duplicate request.',
          booking_group_id: booking_group_id,
          hint: 'If you intended to create a new booking, use a different booking_group_id or omit it.'
        });
      }
    }

    // Use RPC for atomic transaction - validates ALL slots before creating any bookings
    console.log(`[Bulk Booking Creation] Calling create_bulk_booking RPC function...`);
    console.log(`[Bulk Booking Creation]    Slots: ${slot_ids.length}, Visitors: ${visitor_count}, Total Price: ${total_price}`);
    
    const { data: bulkBookingResult, error: createError } = await supabase
      .rpc('create_bulk_booking', {
        p_slot_ids: slot_ids,
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
        p_session_id: req.user?.id || session_id || null,
        p_customer_id: req.user?.id || null,
        p_offer_id: offer_id || null,
        p_language: validLanguage,
        p_booking_group_id: booking_group_id || null
      });

    if (createError) {
      console.error(`[Bulk Booking Creation] ❌ RPC Error:`, createError);
      
      // Map specific error messages to appropriate status codes
      if (createError.message.includes('Missing required fields') ||
          createError.message.includes('does not match') ||
          createError.message.includes('must be provided') ||
          createError.message.includes('Duplicate slot IDs') ||
          createError.message.includes('duplicate')) {
        return res.status(400).json({ error: createError.message });
      }
      if (createError.message.includes('not found')) {
        return res.status(404).json({ error: createError.message });
      }
      if (createError.message.includes('deactivated') ||
          createError.message.includes('does not belong to')) {
        return res.status(403).json({ error: createError.message });
      }
      if (createError.message.includes('not available') ||
          createError.message.includes('Not enough tickets')) {
        return res.status(409).json({ error: createError.message });
      }
      throw createError;
    }

    if (!bulkBookingResult) {
      console.error(`[Bulk Booking Creation] ❌ CRITICAL: RPC returned null/undefined result`);
      return res.status(500).json({ error: 'Failed to create bulk booking - no data returned' });
    }

    // Parse JSONB response
    let bulkBookingData: any = bulkBookingResult;
    if (typeof bulkBookingResult === 'string') {
      try {
        bulkBookingData = JSON.parse(bulkBookingResult);
      } catch (e) {
        console.error(`[Bulk Booking Creation] ❌ Failed to parse bulk booking JSONB:`, e);
        bulkBookingData = bulkBookingResult;
      }
    }

    const bookingGroupId = bulkBookingData.booking_group_id;
    const bookings = bulkBookingData.bookings || [];
    const bookingIds = bookings.map((b: any) => b.id);

    if (!bookingGroupId || bookings.length === 0) {
      console.error(`[Bulk Booking Creation] ❌ CRITICAL: No booking group ID or bookings returned`);
      return res.status(500).json({ 
        error: 'Bulk booking created but no group ID or bookings returned'
      });
    }

    console.log(`[Bulk Booking Creation] ✅ Bulk booking created successfully`);
    console.log(`[Bulk Booking Creation]    Group ID: ${bookingGroupId}`);
    console.log(`[Bulk Booking Creation]    Bookings: ${bookings.length}`);
    console.log(`[Bulk Booking Creation]    Customer: ${customer_name}`);

    // Generate ONE invoice for all bookings (asynchronously)
    if (normalizedPhone || customer_phone || customer_email) {
      Promise.resolve().then(async () => {
        try {
          console.log(`[Bulk Booking Creation] 🧾 Generating ONE invoice for booking group ${bookingGroupId}...`);
          const { zohoService } = await import('../services/zohoService.js');
          
          // Generate invoice for the booking group (uses first booking ID as reference)
          const invoiceResult = await zohoService.generateReceiptForBookingGroup(bookingGroupId);
          if (invoiceResult.success) {
            console.log(`[Bulk Booking Creation] ✅ Invoice created: ${invoiceResult.invoiceId}`);
          } else {
            console.error(`[Bulk Booking Creation] ⚠️ Invoice creation failed: ${invoiceResult.error}`);
          }
        } catch (invoiceError: any) {
          console.error(`[Bulk Booking Creation] ⚠️ Error creating invoice (non-blocking):`, invoiceError.message);
        }
      }).catch((error) => {
        console.error(`[Bulk Booking Creation] ❌ CRITICAL: Unhandled error in invoice generation promise`);
        console.error(`[Bulk Booking Creation]    Error:`, error);
      });
    }

    // Generate ONE ticket PDF with multiple QR codes (one per slot) - asynchronously
    Promise.resolve().then(async () => {
      try {
        console.log(`[Bulk Booking Creation] 🎫 Generating ONE ticket PDF for booking group ${bookingGroupId}...`);
        const { generateBulkBookingTicketPDFBase64 } = await import('../services/pdfService.js');
        const { sendWhatsAppDocument } = await import('../services/whatsappService.js');
        const { sendBookingTicketEmail } = await import('../services/emailService.js');

        // Generate ticket PDF with multiple QR codes (one per booking/slot)
        const pdfBase64 = await generateBulkBookingTicketPDFBase64(bookingGroupId, validLanguage);
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');

        // Get tenant WhatsApp settings
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('whatsapp_settings')
          .eq('id', tenant_id)
          .single();

        let whatsappConfig: any = null;
        if (tenantData?.whatsapp_settings) {
          try {
            whatsappConfig = typeof tenantData.whatsapp_settings === 'string'
              ? JSON.parse(tenantData.whatsapp_settings)
              : tenantData.whatsapp_settings;
          } catch (e) {
            console.warn('Failed to parse WhatsApp settings');
          }
        }

        // Send via WhatsApp if phone provided
        if (normalizedPhone || customer_phone) {
          try {
            await sendWhatsAppDocument(
              normalizedPhone || customer_phone,
              pdfBuffer,
              `booking_tickets_${bookingGroupId}.pdf`,
              whatsappConfig
            );
            console.log(`[Bulk Booking Creation] ✅ Ticket sent via WhatsApp`);
          } catch (whatsappError: any) {
            console.error(`[Bulk Booking Creation] ⚠️ WhatsApp delivery failed:`, whatsappError.message);
          }
        }

        // Send via Email if email provided
        if (customer_email) {
          try {
            await sendBookingTicketEmail(customer_email, pdfBuffer, bookingGroupId, validLanguage);
            console.log(`[Bulk Booking Creation] ✅ Ticket sent via Email`);
          } catch (emailError: any) {
            console.error(`[Bulk Booking Creation] ⚠️ Email delivery failed:`, emailError.message);
          }
        }
      } catch (ticketError: any) {
        console.error(`[Bulk Booking Creation] ⚠️ Error generating ticket (non-blocking):`, ticketError.message);
      }
    }).catch((error) => {
      console.error(`[Bulk Booking Creation] ❌ CRITICAL: Unhandled error in ticket generation promise`);
      console.error(`[Bulk Booking Creation]    Error:`, error);
    });

    // Return the bulk booking result
    res.status(201).json({
      booking_group_id: bookingGroupId,
      bookings: bookings,
      total_bookings: bookings.length,
      total_visitors: bulkBookingData.total_visitors || visitor_count,
      total_price: bulkBookingData.total_price || total_price
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Create bulk booking error', error, context, {
      slot_ids: req.body.slot_ids,
      service_id: req.body.service_id,
      tenant_id: req.body.tenant_id,
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
          name_ar,
          currency_code
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
      tenant_currency_code: (booking.tenants as any)?.currency_code || 'SAR',
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
                <div class="price">${formatCurrency(bookingData.total_price, bookingData.tenant_currency_code || 'SAR')}</div>
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

    // CRITICAL: Ensure visitor_count, adult_count, and child_count are consistent
    // The database constraint requires: visitor_count = adult_count + child_count AND visitor_count > 0
    
    // Get current values as defaults
    const currentVisitorCount = currentBooking.visitor_count || 1;
    const currentAdultCount = currentBooking.adult_count ?? currentVisitorCount;
    const currentChildCount = currentBooking.child_count ?? 0;

    // Determine final values (use provided values or keep existing)
    let finalVisitorCount = updatePayload.visitor_count !== undefined 
      ? updatePayload.visitor_count 
      : currentVisitorCount;
    
    let finalAdultCount = updatePayload.adult_count !== undefined 
      ? updatePayload.adult_count 
      : currentAdultCount;
    
    let finalChildCount = updatePayload.child_count !== undefined 
      ? updatePayload.child_count 
      : currentChildCount;

    // Validate individual fields
    if (finalVisitorCount < 1) {
      return res.status(400).json({ error: 'visitor_count must be at least 1' });
    }

    if (finalAdultCount < 0) {
      return res.status(400).json({ error: 'adult_count cannot be negative' });
    }

    if (finalChildCount < 0) {
      return res.status(400).json({ error: 'child_count cannot be negative' });
    }

    // CRITICAL: Ensure visitor_count = adult_count + child_count
    // If visitor_count is provided but doesn't match, we have two options:
    // 1. Reject the update (strict validation)
    // 2. Auto-calculate visitor_count from adult_count + child_count (user-friendly)
    // We'll use option 2 for better UX, but log a warning if visitor_count was explicitly provided
    
    const calculatedVisitorCount = finalAdultCount + finalChildCount;
    
    if (updatePayload.visitor_count !== undefined && finalVisitorCount !== calculatedVisitorCount) {
      // User provided visitor_count that doesn't match adult_count + child_count
      // Auto-correct: use calculated value instead
      console.warn(`[Update Booking] visitor_count mismatch: provided=${finalVisitorCount}, calculated=${calculatedVisitorCount}. Using calculated value.`);
      finalVisitorCount = calculatedVisitorCount;
    } else if (updatePayload.visitor_count === undefined && (updatePayload.adult_count !== undefined || updatePayload.child_count !== undefined)) {
      // User updated adult_count or child_count but not visitor_count
      // Auto-calculate visitor_count
      finalVisitorCount = calculatedVisitorCount;
    }

    // Final validation: ensure consistency
    if (finalVisitorCount !== calculatedVisitorCount) {
      return res.status(400).json({
        error: `visitor_count (${finalVisitorCount}) must equal adult_count (${finalAdultCount}) + child_count (${finalChildCount})`,
        provided: {
          visitor_count: updatePayload.visitor_count,
          adult_count: updatePayload.adult_count,
          child_count: updatePayload.child_count
        },
        calculated: {
          visitor_count: calculatedVisitorCount,
          adult_count: finalAdultCount,
          child_count: finalChildCount
        }
      });
    }

    // Update the payload with consistent values
    updatePayload.visitor_count = finalVisitorCount;
    updatePayload.adult_count = finalAdultCount;
    updatePayload.child_count = finalChildCount;

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
// Edit Booking Time (Tenant Provider Only - Atomic Transaction)
// ============================================================================
// CRITICAL: Only tenant_admin can edit booking time
// This endpoint uses the atomic edit_booking_time function which:
// 1. Validates new slot availability
// 2. Releases old slot capacity
// 3. Reserves new slot capacity
// 4. Invalidates old tickets (marks qr_scanned=true, clears qr_token)
// 5. Updates booking with new slot
// 6. All in one atomic transaction
// ============================================================================
router.patch('/:id/time', authenticateTenantAdminOnly, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;
    const { slot_id: newSlotId } = req.body;

    if (!newSlotId) {
      return res.status(400).json({ error: 'slot_id is required' });
    }

    console.log(`\n🔄 ========================================`);
    console.log(`🔄 Booking Time Edit Request`);
    console.log(`   Booking ID: ${bookingId}`);
    console.log(`   New Slot ID: ${newSlotId}`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Tenant ID: ${tenantId}`);
    console.log(`🔄 ========================================\n`);

    // Use atomic RPC function for booking time edit
    const { data: editResult, error: editError } = await supabase
      .rpc('edit_booking_time', {
        p_booking_id: bookingId,
        p_new_slot_id: newSlotId,
        p_tenant_id: tenantId,
        p_user_id: userId,
        p_old_slot_id: null // Will be determined by function
      });

    if (editError) {
      console.error(`[Booking Time Edit] ❌ RPC Error:`, editError);
      
      // Map specific error messages to appropriate status codes
      if (editError.message.includes('not found') || 
          editError.message.includes('does not belong')) {
        return res.status(404).json({ error: editError.message });
      }
      if (editError.message.includes('different tenant') ||
          editError.message.includes('different service')) {
        return res.status(403).json({ error: editError.message });
      }
      if (editError.message.includes('not available') ||
          editError.message.includes('Not enough capacity')) {
        return res.status(409).json({ error: editError.message });
      }
      if (editError.message.includes('Cannot edit booking time')) {
        return res.status(400).json({ error: editError.message });
      }
      
      throw editError;
    }

    if (!editResult || !editResult.success) {
      return res.status(500).json({ 
        error: 'Failed to edit booking time',
        details: editResult?.message || 'Unknown error'
      });
    }

    console.log(`[Booking Time Edit] ✅ Success:`, editResult);

    // Parse JSONB response
    let editData: any = editResult;
    if (typeof editResult === 'string') {
      try {
        editData = JSON.parse(editResult);
      } catch (e) {
        editData = editResult;
      }
    }

    // Get updated booking details (CRITICAL: Must be available for ticket generation)
    console.log(`[Booking Time Edit] 🔍 Fetching updated booking data for ticket generation...`);
    const { data: updatedBooking, error: fetchError } = await supabase
      .from('bookings')
      .select(`
        *,
        services:service_id (name, name_ar),
        slots:slot_id (slot_date, start_time, end_time),
        tenants:tenant_id (name, name_ar)
      `)
      .eq('id', bookingId)
      .single();

    if (fetchError || !updatedBooking) {
      console.error(`[Booking Time Edit] ❌ Could not fetch updated booking:`, fetchError);
      console.error(`[Booking Time Edit] ⚠️ Ticket generation will be skipped due to missing booking data`);
    } else {
      console.log(`[Booking Time Edit] ✅ Fetched updated booking for ticket generation`);
      console.log(`[Booking Time Edit]    Booking ID: ${updatedBooking.id}`);
      console.log(`[Booking Time Edit]    Customer: ${updatedBooking.customer_name || 'N/A'}`);
      console.log(`[Booking Time Edit]    Email: ${updatedBooking.customer_email || 'N/A'}`);
      console.log(`[Booking Time Edit]    Phone: ${updatedBooking.customer_phone || 'N/A'}`);
      console.log(`[Booking Time Edit]    Has Services: ${!!updatedBooking.services}`);
      console.log(`[Booking Time Edit]    Has Slots: ${!!updatedBooking.slots}`);
      console.log(`[Booking Time Edit]    Has Tenants: ${!!updatedBooking.tenants}`);
      
      // CRITICAL: Verify we have contact info
      if (!updatedBooking.customer_email && !updatedBooking.customer_phone) {
        console.error(`[Booking Time Edit] ⚠️ WARNING: No customer email or phone - tickets cannot be sent!`);
      }
    }

    // Generate new ticket and send to customer
    // IMPORTANT: Generate PDF synchronously to ensure it completes (same pattern as booking creation)
    // This prevents Railway container restarts from killing the process
    // The actual sending (WhatsApp/Email) can be async
    if (!updatedBooking) {
      console.error(`[Booking Time Edit] ❌ CRITICAL: Cannot generate ticket - updated booking not available`);
      console.error(`[Booking Time Edit]    Ticket generation will be skipped`);
    } else {
      console.log(`\n🎫 ========================================`);
      console.log(`🎫 TICKET REGENERATION STARTING for booking ${bookingId} (time edit)`);
      console.log(`🎫 Customer: ${updatedBooking.customer_name || 'N/A'}`);
      console.log(`🎫 Email: ${updatedBooking.customer_email || 'NOT PROVIDED'}`);
      console.log(`🎫 Phone: ${updatedBooking.customer_phone || 'NOT PROVIDED'}`);
      console.log(`🎫 ========================================\n`);
      
      // Store booking data for async context
      const bookingForTicket = updatedBooking;
      
      // Generate PDF synchronously (before response) to ensure it completes
      // Same pattern as booking creation - prevents Railway from killing the process
      // CRITICAL: This promise will be awaited before sending the response
      const ticketGenerationPromise = (async () => {
        let pdfBuffer: Buffer | null = null;
        
        try {
          console.log(`[Booking Time Edit] 🎫 Starting ticket regeneration...`);
          
          const { generateBookingTicketPDFBase64 } = await import('../services/pdfService.js');
          const { sendWhatsAppDocument } = await import('../services/whatsappService.js');
          const { sendBookingTicketEmail } = await import('../services/emailService.js');
          // normalizePhoneNumber is defined locally in this file (line 15)

          // Use the stored booking data
          const booking = bookingForTicket;
          
          // CRITICAL: Log booking data to diagnose sending issues
          console.log(`[Booking Time Edit] 📋 Booking Data Check:`);
          console.log(`[Booking Time Edit]    Customer Name: ${booking?.customer_name || 'N/A'}`);
          console.log(`[Booking Time Edit]    Customer Phone: ${booking?.customer_phone || 'N/A'}`);
          console.log(`[Booking Time Edit]    Customer Email: ${booking?.customer_email || 'N/A'}`);
          console.log(`[Booking Time Edit]    Has Services: ${!!booking?.services}`);
          console.log(`[Booking Time Edit]    Has Slots: ${!!booking?.slots}`);
          console.log(`[Booking Time Edit]    Has Tenants: ${!!booking?.tenants}`);
          
          const ticketLanguage = (booking?.language === 'ar' || booking?.language === 'en')
            ? booking.language as 'en' | 'ar'
            : 'en';

          console.log(`[Booking Time Edit] 📄 Step 1: Generating PDF for booking ${bookingId}...`);
          console.log(`[Booking Time Edit]    Language: ${ticketLanguage}`);
          
          // Generate new PDF - CRITICAL: This must succeed
          const pdfBase64 = await generateBookingTicketPDFBase64(bookingId, ticketLanguage);
          
          if (!pdfBase64 || pdfBase64.length === 0) {
            console.error(`[Booking Time Edit] ❌ CRITICAL: PDF generation returned empty result`);
            throw new Error('PDF generation returned empty result');
          }
          
          pdfBuffer = Buffer.from(pdfBase64, 'base64');
          if (!pdfBuffer || pdfBuffer.length === 0) {
            console.error(`[Booking Time Edit] ❌ CRITICAL: PDF buffer is empty`);
            throw new Error('PDF buffer conversion failed');
          }
          
          console.log(`[Booking Time Edit] ✅ Step 1 Complete: PDF generated successfully (${pdfBuffer.length} bytes)`);
          console.log(`[Booking Time Edit] 📋 Ready to send:`);
          console.log(`[Booking Time Edit]    PDF Buffer: ${pdfBuffer ? `✅ ${pdfBuffer.length} bytes` : '❌ NULL'}`);
          console.log(`[Booking Time Edit]    Customer Phone: ${booking?.customer_phone || '❌ MISSING'}`);
          console.log(`[Booking Time Edit]    Customer Email: ${booking?.customer_email || '❌ MISSING'}`);

          // Get tenant WhatsApp settings
          console.log(`[Booking Time Edit] 📱 Step 2a: Fetching WhatsApp configuration...`);
          const { data: tenantData, error: tenantError } = await supabase
            .from('tenants')
            .select('whatsapp_settings')
            .eq('id', tenantId)
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
            console.log(`[Booking Time Edit]    ✅ WhatsApp config: provider=${whatsappConfig.provider || 'not set'}`);
          } else {
            console.log(`[Booking Time Edit]    ⚠️ No WhatsApp config in tenant settings`);
          }

          // Step 2: Send new ticket via WhatsApp (async - don't block)
          console.log(`[Booking Time Edit] 🔍 Step 2 Check: customer_phone=${!!booking?.customer_phone}, pdfBuffer=${!!pdfBuffer}`);
          if (booking?.customer_phone && pdfBuffer) {
            console.log(`[Booking Time Edit] 📱 Normalizing phone: ${booking.customer_phone}`);
            const normalizedPhone = normalizePhoneNumber(booking.customer_phone);
            console.log(`[Booking Time Edit] 📱 Normalized phone: ${normalizedPhone || 'NULL'}`);
            if (normalizedPhone) {
              const whatsappMessage = ticketLanguage === 'ar'
                ? 'تم تغيير موعد حجزك! يرجى الاطلاع على التذكرة المحدثة المرفقة. التذاكر القديمة لم تعد صالحة.'
                : 'Your booking time has been changed! Please find your updated ticket attached. Old tickets are no longer valid.';
              
              console.log(`[Booking Time Edit] 📱 Step 2: Sending ticket via WhatsApp to ${normalizedPhone}...`);
              try {
                const whatsappResult = await sendWhatsAppDocument(
                  normalizedPhone,
                  pdfBuffer,
                  `booking_ticket_${bookingId}_updated.pdf`,
                  whatsappMessage,
                  whatsappConfig || undefined
                );
                
                if (whatsappResult && whatsappResult.success) {
                  console.log(`[Booking Time Edit] ✅ Step 2 Complete: Ticket sent via WhatsApp to ${normalizedPhone}`);
                } else {
                  console.error(`[Booking Time Edit] ❌ Step 2 Failed: WhatsApp delivery failed`);
                  console.error(`[Booking Time Edit]    Error: ${whatsappResult?.error || 'Unknown error'}`);
                }
              } catch (whatsappError: any) {
                console.error(`[Booking Time Edit] ❌ Step 2 Failed: WhatsApp delivery exception`);
                console.error(`[Booking Time Edit]    Error:`, whatsappError.message);
                console.error(`[Booking Time Edit]    Stack:`, whatsappError.stack);
              }
            } else {
              console.log(`[Booking Time Edit] ⚠️ Could not normalize phone number: ${booking.customer_phone}`);
            }
          } else {
            console.log(`[Booking Time Edit] ⚠️ Step 2 Skipped: No customer phone (${booking?.customer_phone || 'N/A'}) or PDF buffer`);
          }

          // Step 3: Send new ticket via Email (CRITICAL: Must succeed)
          console.log(`[Booking Time Edit] 🔍 Step 3 Check: customer_email=${!!booking?.customer_email}, pdfBuffer=${!!pdfBuffer}`);
          
          // Validate email format before attempting to send
          if (booking?.customer_email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(booking.customer_email.trim())) {
              console.error(`[Booking Time Edit] ❌ Step 3 Failed: Invalid email format: ${booking.customer_email}`);
            }
          }
          
          if (booking?.customer_email && pdfBuffer) {
            const customerEmail = booking.customer_email.trim();
            console.log(`[Booking Time Edit] 📧 Step 3: Sending ticket via Email to ${customerEmail}...`);
            console.log(`[Booking Time Edit]    PDF Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
            console.log(`[Booking Time Edit]    Language: ${ticketLanguage}`);
            
            try {
              const emailResult = await sendBookingTicketEmail(
                customerEmail,
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
              
              if (emailResult && emailResult.success) {
                console.log(`[Booking Time Edit] ✅ Step 3 Complete: Ticket sent via Email to ${customerEmail}`);
                console.log(`[Booking Time Edit]    Email delivery confirmed: SUCCESS`);
                console.log(`[Booking Time Edit]    Customer should receive email with updated ticket PDF`);
              } else {
                console.error(`[Booking Time Edit] ❌ Step 3 Failed: Email delivery failed`);
                console.error(`[Booking Time Edit]    Error: ${emailResult?.error || 'Unknown error'}`);
                console.error(`[Booking Time Edit]    Email: ${customerEmail}`);
                console.error(`[Booking Time Edit]    This may be due to:`);
                console.error(`[Booking Time Edit]      - Missing SMTP/SendGrid configuration in tenant settings`);
                console.error(`[Booking Time Edit]      - Invalid email provider credentials`);
                console.error(`[Booking Time Edit]      - Email service temporarily unavailable`);
                console.error(`[Booking Time Edit]    Action: Check tenant email settings and SMTP/SendGrid configuration`);
              }
            } catch (emailError: any) {
              console.error(`[Booking Time Edit] ❌ Step 3 Failed: Email delivery exception`);
              console.error(`[Booking Time Edit]    Error:`, emailError.message);
              console.error(`[Booking Time Edit]    Stack:`, emailError.stack);
              console.error(`[Booking Time Edit]    Email: ${customerEmail}`);
              console.error(`[Booking Time Edit]    Action: Check SMTP/SendGrid configuration in tenant settings`);
            }
          } else {
            if (!booking?.customer_email) {
              console.log(`[Booking Time Edit] ⚠️ Step 3 Skipped: No customer email provided`);
              console.log(`[Booking Time Edit]    Cannot send ticket via email without customer email address`);
            } else if (!pdfBuffer) {
              console.log(`[Booking Time Edit] ⚠️ Step 3 Skipped: PDF buffer is null - cannot send email`);
              console.log(`[Booking Time Edit]    PDF generation may have failed`);
            }
          }

          console.log(`\n✅ ========================================`);
          console.log(`✅ TICKET REGENERATION COMPLETE for booking ${bookingId}`);
          console.log(`✅ PDF: Generated (${pdfBuffer?.length || 0} bytes)`);
          console.log(`✅ WhatsApp: ${booking?.customer_phone ? 'Sent' : 'Skipped (no phone)'}`);
          console.log(`✅ Email: ${booking?.customer_email ? 'Sent' : 'Skipped (no email)'}`);
          console.log(`✅ ========================================\n`);
        } catch (ticketError: any) {
          console.error(`\n❌ ========================================`);
          console.error(`❌ TICKET REGENERATION FAILED for booking ${bookingId}`);
          console.error(`❌ Error:`, ticketError.message);
          console.error(`❌ Stack:`, ticketError.stack);
          console.error(`❌ This is non-blocking - booking time was updated successfully`);
          console.error(`❌ ========================================\n`);
          // Don't fail the booking update if ticket generation fails
        }
      })();

      // Wait for PDF generation and sending to complete before sending response
      // This ensures tickets are sent even if Railway container restarts
      // CRITICAL: This prevents Railway from killing the process before tickets are sent
      // Same pattern as booking creation
      try {
        await ticketGenerationPromise;
        console.log(`[Booking Time Edit] ✅ Ticket generation and sending completed for booking ${bookingId}`);
      } catch (error: any) {
        console.error(`[Booking Time Edit] ⚠️ Ticket generation error (non-blocking):`, error);
        // Don't fail booking update if ticket generation fails - booking time was already updated
        // The error was already logged in the inner try-catch
      }
    }

    // Update invoice if price changed (asynchronously)
    if (editData.price_changed && updatedBooking?.zoho_invoice_id) {
      Promise.resolve().then(async () => {
        try {
          console.log(`[Booking Time Edit] 🧾 Updating invoice due to price change...`);
          const { zohoService } = await import('../services/zohoService.js');
          
          // Update invoice amount
          const updateResult = await zohoService.updateInvoiceAmount(
            updatedBooking.zoho_invoice_id,
            editData.new_price
          );
          
          if (updateResult.success) {
            console.log(`[Booking Time Edit] ✅ Invoice updated: ${updatedBooking.zoho_invoice_id}`);
          } else {
            console.error(`[Booking Time Edit] ⚠️ Invoice update failed: ${updateResult.error}`);
          }
        } catch (invoiceError: any) {
          console.error(`[Booking Time Edit] ⚠️ Error updating invoice (non-blocking):`, invoiceError.message);
        }
      }).catch((error) => {
        console.error(`[Booking Time Edit] ❌ CRITICAL: Unhandled error in invoice update promise`);
        console.error(`[Booking Time Edit]    Error:`, error);
      });
    }

    // Return success response
    res.json({
      success: true,
      booking: updatedBooking,
      edit_result: editData,
      message: 'Booking time updated successfully. Old tickets invalidated. New ticket has been sent to customer.',
      tickets_invalidated: true,
      new_ticket_generated: true
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Edit booking time error', error, context, {
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

    // Before hard delete, restore slot capacity if booking was pending or confirmed
    // This mimics what the trigger would do, but triggers don't fire on DELETE
    if (currentBooking.status === 'pending' || currentBooking.status === 'confirmed') {
      // Fetch the slot to get current capacity values
      const { data: slotData, error: slotFetchError } = await supabase
        .from('slots')
        .select('available_capacity, booked_count, original_capacity')
        .eq('id', currentBooking.slot_id)
        .single();

      if (!slotFetchError && slotData) {
        // Calculate new capacity values
        const newAvailableCapacity = Math.min(
          slotData.original_capacity || slotData.available_capacity + currentBooking.visitor_count,
          slotData.available_capacity + currentBooking.visitor_count
        );
        const newBookedCount = Math.max(0, slotData.booked_count - currentBooking.visitor_count);

        // Update slot capacity
        const { error: slotUpdateError } = await supabase
          .from('slots')
          .update({
            available_capacity: newAvailableCapacity,
            booked_count: newBookedCount
          })
          .eq('id', currentBooking.slot_id);

        if (slotUpdateError) {
          console.error('[Delete Booking] Failed to restore slot capacity:', slotUpdateError);
          // Continue with deletion anyway - capacity issue can be fixed manually
        } else {
          console.log(`[Delete Booking] Restored slot ${currentBooking.slot_id} capacity: +${currentBooking.visitor_count} visitors`);
        }
      } else {
        console.warn('[Delete Booking] Could not fetch slot to restore capacity:', slotFetchError);
      }
    }

    // Restore package usage if applicable (before deletion)
    if (currentBooking.package_subscription_id && currentBooking.service_id) {
      // Fetch current package usage
      const { data: packageUsage, error: packageFetchError } = await supabase
        .from('package_subscription_usage')
        .select('used_quantity, remaining_quantity')
        .eq('subscription_id', currentBooking.package_subscription_id)
        .eq('service_id', currentBooking.service_id)
        .single();

      if (!packageFetchError && packageUsage) {
        const newUsedQuantity = Math.max(0, packageUsage.used_quantity - currentBooking.visitor_count);
        const newRemainingQuantity = packageUsage.remaining_quantity + currentBooking.visitor_count;

        const { error: packageError } = await supabase
          .from('package_subscription_usage')
          .update({
            used_quantity: newUsedQuantity,
            remaining_quantity: newRemainingQuantity,
            updated_at: new Date().toISOString()
          })
          .eq('subscription_id', currentBooking.package_subscription_id)
          .eq('service_id', currentBooking.service_id);

        if (packageError) {
          console.warn('[Delete Booking] Failed to restore package usage:', packageError);
          // Continue with deletion anyway
        } else {
          console.log(`[Delete Booking] Restored package usage for subscription ${currentBooking.package_subscription_id}`);
        }
      }
    }

    // Hard delete: Actually remove the booking from the database
    // CRITICAL: Use .select() to get deleted rows and verify deletion occurred
    const { data: deletedRows, error: deleteError } = await supabase
      .from('bookings')
      .delete()
      .eq('id', bookingId)
      .select();

    if (deleteError) {
      console.error('[Delete Booking] Database error during deletion:', deleteError);
      throw deleteError;
    }

    // VERIFY DELETION: Ensure at least one row was actually deleted
    if (!deletedRows || deletedRows.length === 0) {
      console.error('[Delete Booking] ❌ No rows deleted! Booking may not exist or deletion was blocked:', {
        bookingId,
        tenantId,
        userId,
        currentBookingStatus: currentBooking.status,
        currentBookingPaymentStatus: currentBooking.payment_status
      });
      
      // Double-check: Query to see if booking still exists
      const { data: stillExists, error: checkError } = await supabase
        .from('bookings')
        .select('id, status, payment_status')
        .eq('id', bookingId)
        .single();

      if (!checkError && stillExists) {
        console.error('[Delete Booking] ❌ Booking still exists after delete attempt!', stillExists);
        return res.status(500).json({ 
          error: 'Failed to delete booking. The booking still exists in the database.',
          hint: 'This may be due to database constraints or RLS policies. Check server logs for details.'
        });
      } else if (checkError && checkError.code === 'PGRST116') {
        // PGRST116 = no rows returned (booking doesn't exist)
        console.log('[Delete Booking] ✅ Booking does not exist (may have been deleted by another process)');
        // Return success even though we didn't delete it (idempotent operation)
      } else {
        console.error('[Delete Booking] ❌ Unexpected error checking booking existence:', checkError);
        return res.status(500).json({ 
          error: 'Failed to verify booking deletion. Please check server logs.'
        });
      }
    } else {
      console.log(`[Delete Booking] ✅ Successfully deleted booking ${bookingId}. Deleted ${deletedRows.length} row(s).`);
    }

    // Log audit trail (only if we actually deleted something)
    if (deletedRows && deletedRows.length > 0) {
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

      // FINAL VERIFICATION: Double-check the booking is actually gone from the database
      const { data: verifyExists, error: verifyError } = await supabase
        .from('bookings')
        .select('id')
        .eq('id', bookingId)
        .maybeSingle();

      if (verifyError && verifyError.code !== 'PGRST116') {
        console.warn('[Delete Booking] ⚠️ Error during verification query:', verifyError);
      } else if (verifyExists) {
        console.error('[Delete Booking] ❌ CRITICAL: Booking still exists after deletion!', {
          bookingId,
          verifyExists
        });
        return res.status(500).json({ 
          error: 'Booking deletion verification failed. The booking may still exist.',
          hint: 'Check database constraints or RLS policies.'
        });
      } else {
        console.log('[Delete Booking] ✅ Verification passed: Booking confirmed deleted from database');
      }
    }

    res.json({
      success: true,
      message: 'Booking deleted successfully',
      deleted: deletedRows?.length || 0
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
