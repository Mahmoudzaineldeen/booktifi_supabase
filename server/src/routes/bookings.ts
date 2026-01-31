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
    
    // STRICT: Only tenant_admin, customer_admin, and admin_user can manage payment status and delete bookings
    const allowedRoles = ['tenant_admin', 'customer_admin', 'admin_user'];
    if (!allowedRoles.includes(decoded.role)) {
      console.error('[Auth] Access denied for booking management:', {
        userId: decoded.id,
        email: decoded.email,
        actualRole: decoded.role,
        requiredRoles: allowedRoles,
        tenantId: decoded.tenant_id
      });
      return res.status(403).json({ 
        error: 'Access denied. Only authorized admin roles can perform this action.',
        userRole: decoded.role,
        requiredRoles: allowedRoles,
        hint: 'You must be logged in as an authorized admin role to perform this action. Current role: ' + decoded.role
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

// Middleware to authenticate cashier or reception (cashiers, receptionists, tenant admins, admins)
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
    
    const allowedRoles = ['cashier', 'receptionist', 'tenant_admin', 'admin_user'];
    if (!decoded.role || !allowedRoles.includes(decoded.role)) {
      return res.status(403).json({ 
        error: 'Access denied. Only cashiers and receptionists can perform this action.',
        userRole: decoded.role,
        hint: 'You must be logged in as a cashier or receptionist to perform this action.'
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

// Middleware to authenticate customer OR staff (optional auth for public bookings)
function authenticateCustomerOrStaff(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      if (token && token.trim() !== '') {
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as any;
          
          // Allow customers and all staff roles
          const allowedRoles = ['customer', 'receptionist', 'tenant_admin', 'customer_admin', 'admin_user', 'cashier', 'employee'];
          if (decoded.role && allowedRoles.includes(decoded.role)) {
            req.user = {
              id: decoded.id,
              email: decoded.email,
              role: decoded.role,
              tenant_id: decoded.tenant_id,
            };
          }
        } catch (jwtError: any) {
          // Continue without auth for public bookings
          console.warn('[Auth] Token verification failed, continuing as public:', jwtError.message);
        }
      }
    }
    // Continue even without auth (for public bookings)
    next();
  } catch (error: any) {
    // Continue even on error (for public bookings)
    next();
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
    
    // TASK 5: Allow receptionist, tenant_admin, customer_admin, or admin_user (but not cashier, not coordinator for create/edit)
    const allowedRoles = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user'];
    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).json({ 
        error: 'Access denied. Only authorized roles can create/edit bookings.',
        userRole: decoded.role,
        hint: 'Cashiers cannot create or edit bookings. Please use an authorized account.'
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

// Coordinator + receptionist/admin: view bookings and search only. Coordinator cannot create/edit/cancel.
const RECEPTIONIST_OR_COORDINATOR_VIEW_ROLES = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user', 'coordinator'];
function authenticateReceptionistOrCoordinatorForView(req: express.Request, res: express.Response, next: express.NextFunction) {
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
        return res.status(401).json({ error: 'Token has expired', hint: 'Please log in again to get a new token' });
      }
      return res.status(401).json({ error: 'Token verification failed', hint: jwtError.message || 'Please log in again' });
    }
    if (!RECEPTIONIST_OR_COORDINATOR_VIEW_ROLES.includes(decoded.role)) {
      return res.status(403).json({ 
        error: 'Access denied.',
        userRole: decoded.role,
        hint: 'Only receptionist, coordinator, or admin roles can view bookings.'
      });
    }
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'Access denied. No tenant associated with your account.' });
    }
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id };
    next();
  } catch (error: any) {
    return res.status(500).json({ error: 'Authentication error', hint: error.message });
  }
}

// Receptionist/admin can full-edit; coordinator can ONLY set status to 'confirmed'.
function authenticateReceptionistOrCoordinatorForPatch(req: express.Request, res: express.Response, next: express.NextFunction) {
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
        return res.status(401).json({ error: 'Token has expired', hint: 'Please log in again to get a new token' });
      }
      return res.status(401).json({ error: 'Token verification failed', hint: jwtError.message || 'Please log in again' });
    }
    if (!RECEPTIONIST_OR_COORDINATOR_VIEW_ROLES.includes(decoded.role)) {
      return res.status(403).json({ 
        error: 'Access denied.',
        userRole: decoded.role,
        hint: 'Only receptionist, coordinator, or admin roles can update bookings.'
      });
    }
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'Access denied. No tenant associated with your account.' });
    }
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id };
    // Coordinator: only allow PATCH when body is strictly { status: 'confirmed' }
    if (decoded.role === 'coordinator') {
      const body = req.body || {};
      const keys = Object.keys(body).filter(k => k !== 'updated_at' && k !== 'status_changed_at');
      const onlyStatus = keys.length === 1 && keys[0] === 'status' && body.status === 'confirmed';
      if (!onlyStatus) {
        return res.status(403).json({ 
          error: 'Access denied. Coordinator can only confirm bookings (set status to confirmed).',
          userRole: 'coordinator',
          hint: 'You cannot edit, cancel, or change other booking details.'
        });
      }
    }
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
// Normalize stored payment_status for transition check (awaiting_payment/refunded → unpaid)
function normalizePaymentStatusForTransition(status: string): string {
  if (status === 'awaiting_payment' || status === 'refunded') return 'unpaid';
  return status;
}

function validatePaymentStatusTransition(oldStatus: string, newStatus: string): { valid: boolean; error?: string } {
  const oldNorm = normalizePaymentStatusForTransition(oldStatus);
  const newNorm = normalizePaymentStatusForTransition(newStatus);
  // Allowed display states: Unpaid, Paid On Site, Bank Transfer. Stored: unpaid | paid | paid_manual
  const validTransitions: Record<string, string[]> = {
    'unpaid': ['paid', 'paid_manual'],
    'paid': ['unpaid'],
    'paid_manual': ['unpaid'],
  };

  const allowed = validTransitions[oldNorm] || [];
  if (!allowed.includes(newNorm)) {
    return {
      valid: false,
      error: `Invalid payment status transition. Allowed: Unpaid ↔ Paid On Site / Bank Transfer.`
    };
  }

  return { valid: true };
}

// ============================================================================
// Check package exhaustion notification status
// ============================================================================
router.get('/package-exhaustion/:subscriptionId/:serviceId', authenticate, async (req, res) => {
  try {
    const { subscriptionId, serviceId } = req.params;

    if (!subscriptionId || !serviceId) {
      return res.status(400).json({ error: 'subscriptionId and serviceId are required' });
    }

    // Check if notification should be shown
    const { data: notificationData, error: notificationError } = await supabase
      .from('package_exhaustion_notifications')
      .select('id, notified_at')
      .eq('subscription_id', subscriptionId)
      .eq('service_id', serviceId)
      .maybeSingle();

    if (notificationError) {
      console.error(`[Exhaustion Check] ❌ Error:`, notificationError);
      return res.status(500).json({ 
        error: 'Failed to check exhaustion status',
        details: notificationError.message 
      });
    }

    // Check if capacity is actually exhausted
    const { data: usageData, error: usageError } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity')
      .eq('subscription_id', subscriptionId)
      .eq('service_id', serviceId)
      .maybeSingle();

    if (usageError) {
      console.error(`[Exhaustion Check] ❌ Usage Error:`, usageError);
      return res.status(500).json({ 
        error: 'Failed to check usage status',
        details: usageError.message 
      });
    }

    const isExhausted = usageData && usageData.remaining_quantity === 0;
    const alreadyNotified = notificationData !== null;

    res.json({
      is_exhausted: isExhausted,
      should_notify: isExhausted && !alreadyNotified,
      already_notified: alreadyNotified,
      notified_at: notificationData?.notified_at || null
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Exhaustion check error', error, context);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Resolve customer service capacity (package capacity check)
// ============================================================================
router.get('/capacity/:customerId/:serviceId', authenticate, async (req, res) => {
  try {
    const { customerId, serviceId } = req.params;

    if (!customerId || !serviceId) {
      return res.status(400).json({ error: 'customerId and serviceId are required' });
    }

    // Call the database function to resolve capacity
    const { data: capacityData, error: capacityError } = await supabase
      .rpc('resolveCustomerServiceCapacity', {
        p_customer_id: customerId,
        p_service_id: serviceId
      });

    if (capacityError) {
      console.error(`[Capacity Resolution] ❌ Error:`, capacityError);
      return res.status(500).json({ 
        error: 'Failed to resolve capacity',
        details: capacityError.message 
      });
    }

    if (!capacityData || capacityData.length === 0) {
      return res.json({
        total_remaining_capacity: 0,
        source_package_ids: [],
        exhaustion_status: []
      });
    }

    const result = capacityData[0];
    res.json({
      total_remaining_capacity: result.total_remaining_capacity || 0,
      source_package_ids: result.source_package_ids || [],
      exhaustion_status: result.exhaustion_status || []
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Capacity resolution error', error, context);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Ensure employee-based slots for a service/date (generates slots from employee_shifts)
// Called by availability layer when service.scheduling_type === 'employee_based'
// ============================================================================
router.post('/ensure-employee-based-slots', async (req, res) => {
  try {
    const { tenantId, serviceId, date: dateStr } = req.body;
    if (!tenantId || !serviceId || !dateStr) {
      return res.status(400).json({ error: 'tenantId, serviceId, and date are required' });
    }
    const [y, m, d] = dateStr.split('-').map(Number);
    const slotDate = new Date(y, m - 1, d);
    // Use UTC for day-of-week so behavior is consistent regardless of server timezone
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, tenant_id, scheduling_type, duration_minutes, service_duration_minutes')
      .eq('id', serviceId)
      .eq('tenant_id', tenantId)
      .single();
    if (serviceError || !service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Use employee shifts when: global scheduling_mode is employee_based OR service.scheduling_type is employee_based
    const { data: tenantFeatures } = await supabase
      .from('tenant_features')
      .select('scheduling_mode')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const globalSchedulingMode = (tenantFeatures as any)?.scheduling_mode ?? 'service_slot_based';
    const serviceSchedulingType = (service as any).scheduling_type;
    const useEmployeeBased = globalSchedulingMode === 'employee_based' || serviceSchedulingType === 'employee_based';
    if (!useEmployeeBased) {
      return res.json({ shiftIds: [] });
    }

    const durationMinutes = Math.max(1, Number((service as any).service_duration_minutes ?? (service as any).duration_minutes ?? 60) || 60);

    let { data: shifts, error: shiftsError } = await supabase
      .from('shifts')
      .select('id')
      .eq('service_id', serviceId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    if (shiftsError) {
      logger.error('ensure-employee-based-slots: shifts fetch', shiftsError);
      return res.status(500).json({ error: shiftsError.message });
    }
    let virtualShiftId: string | null = (shifts && shifts.length > 0) ? shifts[0].id : null;
    if (!virtualShiftId) {
      const { data: newShift, error: insertShiftError } = await supabase
        .from('shifts')
        .insert({
          tenant_id: tenantId,
          service_id: serviceId,
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          start_time_utc: '00:00',
          end_time_utc: '23:59',
          is_active: true,
        })
        .select('id')
        .single();
      if (insertShiftError || !newShift) {
        logger.error('ensure-employee-based-slots: create shift', insertShiftError);
        return res.status(500).json({ error: insertShiftError?.message || 'Failed to create virtual shift' });
      }
      virtualShiftId = newShift.id;
    }

    // In employee-based mode: include ALL employees assigned to this service (any shift_id).
    // When global mode is employee_based, assignments are often stored with shift_id null; older or
    // other flows may set shift_id — we include all so slots always appear for configured employees.
    const { data: employeeServices, error: esError } = await supabase
      .from('employee_services')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('service_id', serviceId);
    if (esError) {
      logger.error('ensure-employee-based-slots: employee_services fetch', esError);
      return res.status(500).json({ error: esError.message });
    }
    if (!employeeServices || employeeServices.length === 0) {
      logger.warn('ensure-employee-based-slots: no employees assigned to service', { serviceId, dateStr });
      return res.json({ shiftIds: [virtualShiftId] });
    }
    const employeeIds = [...new Set(employeeServices.map((es: any) => es.employee_id))];

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id')
      .in('id', employeeIds)
      .eq('is_active', true);
    if (usersError || !users) {
      return res.json({ shiftIds: [virtualShiftId] });
    }
    const activeEmployeeIds = new Set(users.map((u: any) => u.id));
    const { data: paused } = await supabase
      .from('users')
      .select('id, is_paused_until')
      .in('id', employeeIds);
    const availableEmployeeIds = (paused || []).filter((u: any) => {
      if (!activeEmployeeIds.has(u.id)) return false;
      const until = u.is_paused_until;
      if (!until) return true;
      const untilDate = new Date(until);
      return slotDate > untilDate;
    }).map((u: any) => u.id);
    if (availableEmployeeIds.length === 0) {
      return res.json({ shiftIds: [virtualShiftId] });
    }

    const { data: empShifts, error: empShiftsError } = await supabase
      .from('employee_shifts')
      .select('id, employee_id, start_time_utc, end_time_utc, days_of_week')
      .eq('tenant_id', tenantId)
      .in('employee_id', availableEmployeeIds)
      .eq('is_active', true);
    if (empShiftsError || !empShifts || empShifts.length === 0) {
      logger.warn('ensure-employee-based-slots: no employee_shifts for employees', { serviceId, dateStr, employeeCount: availableEmployeeIds.length });
      return res.json({ shiftIds: [virtualShiftId] });
    }
    // Normalize days_of_week: PostgreSQL can return array or string like "{0,1,2,3,4,5,6}"
    const toDaysArray = (d: any): number[] => {
      if (Array.isArray(d)) return d.map((x: any) => Number(x)).filter((n: number) => !Number.isNaN(n) && n >= 0 && n <= 6);
      if (typeof d === 'string') return d.replace(/[{}]/g, '').split(',').map((x: string) => Number(x.trim())).filter((n: number) => !Number.isNaN(n) && n >= 0 && n <= 6);
      return [];
    };
    const shiftsForDay = (empShifts as any[]).filter((es: any) => {
      const days = toDaysArray(es.days_of_week);
      return days.length > 0 && days.includes(dayOfWeek);
    });
    if (shiftsForDay.length === 0) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      logger.warn('ensure-employee-based-slots: no shifts for this day of week', { serviceId, dateStr, dayOfWeek, dayName: dayNames[dayOfWeek], employeeShiftsCount: empShifts.length });
      return res.json({ shiftIds: [virtualShiftId] });
    }

    const startTimeStr = (t: string) => (t || '').slice(0, 8);
    const toMinutes = (t: string) => {
      const parts = (t || '00:00').split(':').map(Number);
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    };
    const toTime = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    };

    let slotsCreated = 0;
    for (const es of shiftsForDay) {
      const startM = toMinutes(startTimeStr(es.start_time_utc));
      const endM = toMinutes(startTimeStr(es.end_time_utc));
      let slotStartM = startM;
      while (slotStartM + durationMinutes <= endM) {
        const slotEndM = slotStartM + durationMinutes;
        const startTime = toTime(slotStartM);
        const endTime = toTime(slotEndM);
        const { data: overlappingSlots } = await supabase
          .from('slots')
          .select('id')
          .eq('employee_id', es.employee_id)
          .eq('slot_date', dateStr)
          .lt('start_time', endTime)
          .gt('end_time', startTime);
        const overlappingSlotIds = (overlappingSlots || []).map((s: any) => s.id);
        let overlapCount = 0;
        if (overlappingSlotIds.length > 0) {
          const { count } = await supabase
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .in('slot_id', overlappingSlotIds);
          overlapCount = count ?? 0;
        }
        const { data: existingSlot } = await supabase
          .from('slots')
          .select('id')
          .eq('shift_id', virtualShiftId)
          .eq('employee_id', es.employee_id)
          .eq('slot_date', dateStr)
          .eq('start_time', startTime)
          .maybeSingle();
        if (existingSlot) {
          slotStartM += durationMinutes;
          continue;
        }
        const availableCapacity = Math.max(0, 1 - overlapCount);
        if (availableCapacity === 0) {
          slotStartM += durationMinutes;
          continue;
        }
        const startTs = `${dateStr}T${startTime}`;
        const endTs = `${dateStr}T${endTime}`;
        // Use only columns that exist on slots table: no service_id/total_capacity/remaining_capacity
        const slotRow = {
          tenant_id: tenantId,
          shift_id: virtualShiftId,
          employee_id: es.employee_id,
          slot_date: dateStr,
          start_time: startTime,
          end_time: endTime,
          start_time_utc: startTs,
          end_time_utc: endTs,
          original_capacity: 1,
          available_capacity: availableCapacity,
          booked_count: overlapCount,
          is_available: true,
          is_overbooked: false,
        };
        let { error: insertErr } = await supabase.from('slots').insert(slotRow);
        if (insertErr && (String(insertErr.message || '').includes('column') || String(insertErr.code || '').includes('undefined_column'))) {
          const withoutOverbooked = { ...slotRow };
          delete (withoutOverbooked as any).is_overbooked;
          insertErr = (await supabase.from('slots').insert(withoutOverbooked)).error;
        }
        if (insertErr) {
          logger.warn('ensure-employee-based-slots: slot insert error', { message: insertErr.message, code: insertErr.code });
        } else {
          slotsCreated += 1;
        }
        slotStartM += durationMinutes;
      }
    }

    logger.info('ensure-employee-based-slots: done', { serviceId, dateStr, slotsCreated, employeesWithShifts: shiftsForDay.length });
    return res.json({ shiftIds: [virtualShiftId] });
  } catch (error: any) {
    logger.error('ensure-employee-based-slots error', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

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
// Allows customers and staff to create bookings, but blocks customers during maintenance mode
router.post('/create', authenticateCustomerOrStaff, async (req, res) => {
  // Track if response has been sent to prevent double responses
  let responseSent = false;
  const sendResponse = (status: number, data: any) => {
    if (!responseSent) {
      responseSent = true;
      return res.status(status).json(data);
    }
    console.warn('[Booking Creation] ⚠️ Attempted to send response twice, ignoring second attempt');
  };

  try {
    // Extract only expected fields (ignore extra fields like status, payment_status, created_by_user_id, package_subscription_id)
    // These are handled automatically by the backend
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
      language = 'en', // Customer preferred language ('en' or 'ar')
      booking_group_id, // Optional: for grouping related bookings (will be ignored if not provided)
      payment_method: reqPaymentMethod, // Optional: 'onsite' (مدفوع يدوياً) or 'transfer' (حوالة)
      transaction_reference: reqTransactionRef, // Optional: required when payment_method is 'transfer'
      payment_status: reqPaymentStatusRaw, // Optional: normalized to 'unpaid' | 'paid' | 'paid_manual' (display: Unpaid, Paid On Site, Bank Transfer)
    } = req.body;
    let reqPaymentStatus = (reqPaymentStatusRaw === 'awaiting_payment' || reqPaymentStatusRaw === 'refunded') ? 'unpaid' : reqPaymentStatusRaw;
    // When frontend sends payment_method (Paid On Site / Bank Transfer) but not payment_status, treat as paid
    if ((reqPaymentMethod === 'onsite' || reqPaymentMethod === 'transfer') && (reqPaymentStatus === undefined || reqPaymentStatus === null || reqPaymentStatus === '')) {
      reqPaymentStatus = 'paid_manual';
    }
    
    // Ensure booking_group_id is either a valid UUID string or null (not undefined)
    const finalBookingGroupId = booking_group_id && typeof booking_group_id === 'string' && booking_group_id.trim() !== '' 
      ? booking_group_id.trim() 
      : null;
    
    // Log warning if unexpected fields are sent (but don't fail)
    const unexpectedFields = ['status', 'created_by_user_id', 'package_subscription_id'];
    const sentUnexpectedFields = unexpectedFields.filter(field => req.body[field] !== undefined);
    if (sentUnexpectedFields.length > 0) {
      console.warn(`[Booking Creation] ⚠️  Unexpected fields sent (will be ignored): ${sentUnexpectedFields.join(', ')}`);
      console.warn(`[Booking Creation]    These fields are calculated automatically by the backend`);
    }

    // Validate language
    const validLanguage = (language === 'ar' || language === 'en') ? language : 'en';

    // Validate required fields
    if (!slot_id || !service_id || !tenant_id || !customer_name || !customer_phone) {
      return sendResponse(400, { error: 'Missing required fields' });
    }

    // Validate payment_method + transaction_reference when staff sends payment method
    if (reqPaymentMethod === 'transfer' && (!reqTransactionRef || !String(reqTransactionRef).trim())) {
      return sendResponse(400, { error: 'transaction_reference is required when payment method is transfer (حوالة)' });
    }

    // ============================================================================
    // MAINTENANCE MODE CHECK - Block customers only
    // ============================================================================
    // Check if maintenance mode is enabled and user is a customer
    const userRole = req.user?.role;
    if (userRole === 'customer' || !userRole) {
      // For customers or unauthenticated users, check maintenance mode
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('maintenance_mode')
        .eq('id', tenant_id)
        .single();

      if (!tenantError && tenantData && tenantData.maintenance_mode === true) {
        return sendResponse(403, {
          error: 'Bookings are temporarily disabled. Please visit us in person to make a reservation.',
          code: 'BOOKING_DISABLED_MAINTENANCE'
        });
      }
    }
    // Staff roles (receptionist, tenant_admin, etc.) can always create bookings

    // Normalize phone number (handles Egyptian numbers: +2001032560826 -> +201032560826)
    const normalizedPhone = normalizePhoneNumber(customer_phone);
    if (!normalizedPhone) {
      return sendResponse(400, { error: 'Invalid phone number format' });
    }

    // Validate visitor_count
    if (visitor_count < 1) {
      return sendResponse(400, {
        error: 'visitor_count must be at least 1'
      });
    }

    // Calculate adult/child counts - use provided values or default to visitor_count for adults
    const finalAdultCount = adult_count !== undefined ? adult_count : visitor_count;
    const finalChildCount = child_count !== undefined ? child_count : 0;

    // ============================================================================
    // PACKAGE CAPACITY CHECK - Auto-apply package if capacity exists
    // ============================================================================
    let packageSubscriptionId: string | null = null;
    let finalTotalPrice = total_price || 0;
    let shouldUsePackage = false;
    let packageCoveredQty = 0;
    let paidQty = visitor_count; // Default: all tickets are paid

    // Look up customer by phone if customer_id not provided (for receptionist bookings)
    // CRITICAL: Do NOT use req.user.id - that's a user ID (users table), not customer ID (customers table)
    // The foreign key constraint references customers(id), not users(id)
    let customerIdForPackage: string | null = req.body.customer_id || null;
    
    // If no customer_id provided, look up customer by phone number
    if (!customerIdForPackage && normalizedPhone) {
      console.log('[Booking Creation] Looking up customer by phone:', normalizedPhone);
      const { data: customerData, error: customerLookupError } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', normalizedPhone)
        .eq('tenant_id', tenant_id)
        .maybeSingle();
      
      if (customerLookupError) {
        console.error('[Booking Creation] ⚠️ Error looking up customer:', customerLookupError);
        customerIdForPackage = null;
      } else if (customerData) {
        customerIdForPackage = customerData.id;
        console.log('[Booking Creation] ✅ Found customer by phone:', customerIdForPackage);
      } else {
        console.log('[Booking Creation] ℹ️ No customer found for phone:', normalizedPhone);
        customerIdForPackage = null;
      }
    }
    
    // CRITICAL: Validate customer_id exists in customers table before using it
    // If customer_id doesn't exist, set it to NULL to avoid foreign key violation
    // Blocked visitors cannot create bookings from customer side
    if (customerIdForPackage) {
      console.log('[Booking Creation] Validating customer_id exists in customers table:', customerIdForPackage);
      const { data: customerExists, error: customerCheckError } = await supabase
        .from('customers')
        .select('id, is_blocked')
        .eq('id', customerIdForPackage)
        .eq('tenant_id', tenant_id)
        .maybeSingle();
      
      if (customerCheckError) {
        console.error('[Booking Creation] ⚠️ Error checking customer existence:', customerCheckError);
        customerIdForPackage = null; // Set to null if check fails
      } else if (!customerExists) {
        console.warn('[Booking Creation] ⚠️ Customer ID does not exist in customers table:', customerIdForPackage);
        console.warn('[Booking Creation]    This ID might be from users table (not customers table)');
        console.warn('[Booking Creation]    Setting customer_id to NULL to avoid foreign key violation');
        customerIdForPackage = null; // Customer doesn't exist, set to null
      } else {
        const isBlocked = (customerExists as any).is_blocked === true;
        if (isBlocked && req.user?.role === 'customer') {
          return res.status(403).json({
            error: 'You cannot create bookings. Your account has been blocked. Please contact support.',
          });
        }
        console.log('[Booking Creation] ✅ Customer ID validated and exists:', customerIdForPackage);
      }
    } else {
      console.log('[Booking Creation] ℹ️ No customer_id - booking will be created as guest booking (customer_id = NULL)');
    }
    
    if (customerIdForPackage) {
      try {
        console.log('[Booking Creation] Checking package capacity for customer:', customerIdForPackage);
        // Resolve package capacity for this customer and service
        const { data: capacityData, error: capacityError } = await supabase
          .rpc('resolveCustomerServiceCapacity', {
            p_customer_id: customerIdForPackage,
            p_service_id: service_id
          });

        if (capacityError) {
          console.error('[Booking Creation] ⚠️ Package capacity check failed:', capacityError);
          console.error('[Booking Creation]    Error code:', capacityError.code);
          console.error('[Booking Creation]    Error message:', capacityError.message);
          // Don't fail - proceed with paid booking if package check fails
          // Continue to next block which handles no capacity data
        }

        if (!capacityError && capacityData && capacityData.length > 0) {
          const capacityResult = capacityData[0];
          const totalRemaining = capacityResult.total_remaining_capacity || 0;
          const exhaustionStatus = capacityResult.exhaustion_status || [];

          console.log(`[Booking Creation] 📊 Package capacity result:`, {
            total_remaining_capacity: totalRemaining,
            visitor_count: visitor_count,
            exhaustion_status_count: exhaustionStatus.length
          });

          // Calculate partial coverage (store in outer scope variables)
          // CRITICAL: Ensure values are always set correctly
          // packageCoveredQty = min(visitor_count, totalRemaining)
          // This means: if customer has 9 remaining and books 10, package covers 9, paid = 1
          packageCoveredQty = Math.min(visitor_count, totalRemaining);
          paidQty = visitor_count - packageCoveredQty;

          // CRITICAL: Double-check the calculation
          const recalculatedPaidQty = visitor_count - packageCoveredQty;
          if (recalculatedPaidQty !== paidQty) {
            console.error(`[Booking Creation] ❌ CRITICAL: paidQty calculation mismatch!`);
            console.error(`[Booking Creation]    Original: ${paidQty}`);
            console.error(`[Booking Creation]    Recalculated: ${recalculatedPaidQty}`);
            paidQty = recalculatedPaidQty;
            console.error(`[Booking Creation]    → Using recalculated value: ${paidQty}`);
          }

          // Validate calculation
          if (packageCoveredQty + paidQty !== visitor_count) {
            console.error(`[Booking Creation] ❌ CRITICAL: Package coverage calculation error!`);
            console.error(`[Booking Creation]    visitor_count: ${visitor_count}`);
            console.error(`[Booking Creation]    totalRemaining: ${totalRemaining}`);
            console.error(`[Booking Creation]    packageCoveredQty: ${packageCoveredQty}`);
            console.error(`[Booking Creation]    paidQty: ${paidQty}`);
            console.error(`[Booking Creation]    Sum: ${packageCoveredQty + paidQty} (expected ${visitor_count})`);
            // Fix the calculation
            paidQty = visitor_count - packageCoveredQty;
            console.error(`[Booking Creation]    → Corrected paidQty to: ${paidQty}`);
          }

          // CRITICAL: Ensure paidQty is never negative
          if (paidQty < 0) {
            console.error(`[Booking Creation] ❌ CRITICAL: paidQty is negative! Fixing...`);
            paidQty = 0;
            packageCoveredQty = visitor_count;
            console.error(`[Booking Creation]    → Corrected: packageCoveredQty=${packageCoveredQty}, paidQty=${paidQty}`);
          }

          // CRITICAL: Ensure packageCoveredQty doesn't exceed visitor_count
          if (packageCoveredQty > visitor_count) {
            console.error(`[Booking Creation] ❌ CRITICAL: packageCoveredQty exceeds visitor_count! Fixing...`);
            packageCoveredQty = visitor_count;
            paidQty = 0;
            console.error(`[Booking Creation]    → Corrected: packageCoveredQty=${packageCoveredQty}, paidQty=${paidQty}`);
          }

          console.log(`[Booking Creation] Package capacity check:`, {
            requestedQty: visitor_count,
            remainingCapacity: totalRemaining,
            packageCoveredQty,
            paidQty,
            calculation: `${packageCoveredQty} + ${paidQty} = ${packageCoveredQty + paidQty} (should be ${visitor_count})`,
            validation: packageCoveredQty + paidQty === visitor_count ? '✅ PASS' : '❌ FAIL'
          });

          // If we have any capacity, use it (even if partial)
          if (totalRemaining > 0) {
            shouldUsePackage = true;

            // Find the subscription ID to use (we can only deduct from ONE subscription per booking)
            // CRITICAL: Cap coverage by the chosen subscription's remaining, not totalRemaining across all subs.
            let effectiveRemaining = totalRemaining;
            if (exhaustionStatus.length > 0) {
              const availableSubscriptions = exhaustionStatus
                .filter((s: any) => !s.is_exhausted && s.remaining > 0)
                .sort((a: any, b: any) => b.remaining - a.remaining);

              if (availableSubscriptions.length > 0) {
                packageSubscriptionId = availableSubscriptions[0].subscription_id;
                effectiveRemaining = availableSubscriptions[0].remaining;
                if (effectiveRemaining < totalRemaining) {
                  console.log(`[Booking Creation] 📌 Capping coverage by chosen subscription remaining: ${effectiveRemaining} (total across subs was ${totalRemaining})`);
                }
                console.log(`[Booking Creation] ✅ Using package subscription: ${packageSubscriptionId} (remaining: ${effectiveRemaining})`);
              }
            }

            // Use effectiveRemaining so we never cover more than the single subscription we attach can provide
            packageCoveredQty = Math.min(visitor_count, effectiveRemaining);
            paidQty = visitor_count - packageCoveredQty;

            // Calculate price only for paid portion
            const finalPackageCovered = packageCoveredQty;
            const finalPaidQty = paidQty;
            
            if (finalPackageCovered !== packageCoveredQty || finalPaidQty !== paidQty) {
              console.error(`[Booking Creation] ❌ CRITICAL: Package coverage values changed during price calculation!`);
              console.error(`[Booking Creation]    Before: packageCovered=${packageCoveredQty}, paid=${paidQty}`);
              console.error(`[Booking Creation]    After: packageCovered=${finalPackageCovered}, paid=${finalPaidQty}`);
              packageCoveredQty = finalPackageCovered;
              paidQty = finalPaidQty;
              console.error(`[Booking Creation]    → Using corrected values: packageCovered=${packageCoveredQty}, paid=${paidQty}`);
            }
            
            if (paidQty > 0) {
              // Get service price for paid tickets
              const { data: serviceData } = await supabase
                .from('services')
                .select('base_price')
                .eq('id', service_id)
                .single();
              
              const servicePrice = serviceData?.base_price || 0;
              finalTotalPrice = paidQty * servicePrice;
              
              console.log(`[Booking Creation] ⚠️ Partial package coverage: ${packageCoveredQty} free, ${paidQty} paid (${finalTotalPrice})`);
              console.log(`[Booking Creation]    Service price: ${servicePrice}, Paid qty: ${paidQty}, Total: ${finalTotalPrice}`);
            } else {
              finalTotalPrice = 0; // Fully covered by package
              console.log(`[Booking Creation] ✅ Full package coverage: ${packageCoveredQty} tickets free`);
              console.log(`[Booking Creation]    → NO invoice will be created (fully covered by package)`);
            }
            
            // Check if chosen subscription will be exhausted after this booking
            const packageWillBeExhausted = effectiveRemaining <= packageCoveredQty;
            if (packageWillBeExhausted && packageSubscriptionId) {
              console.log(`[Booking Creation] 🔔 Package will be exhausted after this booking`);
              console.log(`[Booking Creation]    Subscription: ${packageSubscriptionId}`);
              console.log(`[Booking Creation]    Remaining before: ${effectiveRemaining}, Using: ${packageCoveredQty}`);
              console.log(`[Booking Creation]    Remaining after: ${effectiveRemaining - packageCoveredQty}`);
              
              // Create one-time exhaustion notification
              // Note: Table schema only has: id, subscription_id, service_id, notified_at
              // notified_at is auto-set by DEFAULT now() in the table
              try {
                const { error: notifError } = await supabase
                  .from('package_exhaustion_notifications')
                  .upsert({
                    subscription_id: packageSubscriptionId,
                    service_id: service_id
                  }, {
                    onConflict: 'subscription_id,service_id',
                    ignoreDuplicates: false
                  });
                
                if (notifError) {
                  console.warn(`[Booking Creation] ⚠️ Failed to create exhaustion notification:`, notifError);
                } else {
                  console.log(`[Booking Creation] ✅ Exhaustion notification created`);
                }
              } catch (notifErr: any) {
                console.warn(`[Booking Creation] ⚠️ Exception creating exhaustion notification:`, notifErr);
                // Don't fail booking if notification fails
              }
            }
          } else {
            // No capacity - full booking is paid
            packageCoveredQty = 0;
            paidQty = visitor_count;
            console.log(`[Booking Creation] ℹ️ No package capacity - full booking will be paid`);
            const exhaustedPackages = exhaustionStatus.filter((s: any) => s.is_exhausted);
            if (exhaustedPackages.length > 0) {
              console.log(`[Booking Creation] ℹ️ Package capacity exhausted for ${exhaustedPackages.length} package(s)`);
            }
          }
        }
      } catch (packageError: any) {
        // Log but don't fail - proceed with paid booking if package check fails
        console.error(`[Booking Creation] ⚠️ Package capacity check exception:`, packageError);
        console.error(`[Booking Creation]    Error type: ${packageError?.constructor?.name || 'Unknown'}`);
        console.error(`[Booking Creation]    Error message: ${packageError?.message || 'No message'}`);
        console.error(`[Booking Creation]    Error stack: ${packageError?.stack || 'No stack'}`);
        // Continue with paid booking - package check is optional
      }
    }

    // ============================================================================
    // FINAL VALIDATION: Ensure package coverage values are correct before RPC call
    // ============================================================================
    // CRITICAL: Validate that packageCoveredQty + paidQty = visitor_count
    if (packageCoveredQty + paidQty !== visitor_count) {
      console.error(`[Booking Creation] ❌ CRITICAL: Package coverage validation failed before RPC call!`);
      console.error(`[Booking Creation]    visitor_count: ${visitor_count}`);
      console.error(`[Booking Creation]    packageCoveredQty: ${packageCoveredQty}`);
      console.error(`[Booking Creation]    paidQty: ${paidQty}`);
      console.error(`[Booking Creation]    Sum: ${packageCoveredQty + paidQty} (expected ${visitor_count})`);
      // Fix the calculation
      if (packageCoveredQty > visitor_count) {
        packageCoveredQty = visitor_count;
        paidQty = 0;
      } else {
        paidQty = visitor_count - packageCoveredQty;
      }
      console.error(`[Booking Creation]    → Corrected: packageCoveredQty=${packageCoveredQty}, paidQty=${paidQty}`);
    }

    // Use RPC for transaction - handles all validation, lock checking, and booking creation
    console.log(`[Booking Creation] Calling create_booking_with_lock RPC function...`);
    console.log(`[Booking Creation]    Package: ${shouldUsePackage ? 'YES' : 'NO'}, Price: ${finalTotalPrice}`);
    console.log(`[Booking Creation]    Coverage: ${packageCoveredQty} package, ${paidQty} paid`);
    console.log(`[Booking Creation]    Validation: ${packageCoveredQty} + ${paidQty} = ${packageCoveredQty + paidQty} (visitor_count: ${visitor_count})`);
    
    // Validate all parameters before calling RPC
    const rpcParams: any = {
      p_slot_id: slot_id,
      p_service_id: service_id,
      p_tenant_id: tenant_id,
      p_customer_name: customer_name,
      p_customer_phone: normalizedPhone,
      p_customer_email: customer_email || null,
      p_visitor_count: visitor_count,
      p_adult_count: finalAdultCount,
      p_child_count: finalChildCount,
      p_total_price: finalTotalPrice,
      p_notes: notes || null,
      p_employee_id: employee_id || null,
      p_lock_id: lock_id || null,
      p_session_id: req.user?.id || session_id || null, // This is for created_by_user_id (users table)
      p_customer_id: customerIdForPackage || null, // This must be from customers table, validated above
      p_offer_id: offer_id || null,
      p_language: validLanguage,
      p_package_subscription_id: packageSubscriptionId || null,
      p_package_covered_quantity: packageCoveredQty, // Always pass explicit value (0 if no package)
      p_paid_quantity: paidQty // Always pass explicit value (0 if fully covered, >0 if partial/full paid)
    };
    
    // CRITICAL: Ensure we never pass NULL for paid_quantity (PostgreSQL might treat 0 differently)
    // Always pass explicit integer values
    if (rpcParams.p_paid_quantity === null || rpcParams.p_paid_quantity === undefined) {
      console.error(`[Booking Creation] ❌ CRITICAL: paid_quantity is null/undefined! Recalculating...`);
      rpcParams.p_paid_quantity = rpcParams.p_visitor_count - rpcParams.p_package_covered_quantity;
      console.error(`[Booking Creation]    → Corrected paid_quantity to: ${rpcParams.p_paid_quantity}`);
    }
    
    if (rpcParams.p_package_covered_quantity === null || rpcParams.p_package_covered_quantity === undefined) {
      console.error(`[Booking Creation] ❌ CRITICAL: package_covered_quantity is null/undefined! Setting to 0...`);
      rpcParams.p_package_covered_quantity = 0;
      rpcParams.p_paid_quantity = rpcParams.p_visitor_count; // If no package coverage, all are paid
      console.error(`[Booking Creation]    → Corrected package_covered_quantity to: 0, paid_quantity to: ${rpcParams.p_paid_quantity}`);
    }
    
    // CRITICAL: Final recalculation to ensure values are always correct
    // This catches any edge cases where values might have been modified
    const finalPackageCovered = rpcParams.p_package_covered_quantity;
    const finalPaidQty = rpcParams.p_visitor_count - finalPackageCovered;
    
    if (finalPaidQty !== rpcParams.p_paid_quantity) {
      console.error(`[Booking Creation] ❌ CRITICAL: Final validation failed - paid_quantity mismatch!`);
      console.error(`[Booking Creation]    RPC param paid_quantity: ${rpcParams.p_paid_quantity}`);
      console.error(`[Booking Creation]    Recalculated from visitor_count (${rpcParams.p_visitor_count}) - packageCovered (${finalPackageCovered}): ${finalPaidQty}`);
      console.error(`[Booking Creation]    → Correcting RPC param paid_quantity to: ${finalPaidQty}`);
      rpcParams.p_paid_quantity = finalPaidQty;
      // Also update the outer scope variable for consistency
      paidQty = finalPaidQty;
    }
    
    // CRITICAL: Ensure package_covered_quantity doesn't exceed visitor_count
    if (rpcParams.p_package_covered_quantity > rpcParams.p_visitor_count) {
      console.error(`[Booking Creation] ❌ CRITICAL: package_covered_quantity (${rpcParams.p_package_covered_quantity}) exceeds visitor_count (${rpcParams.p_visitor_count})!`);
      rpcParams.p_package_covered_quantity = rpcParams.p_visitor_count;
      rpcParams.p_paid_quantity = 0;
      paidQty = 0;
      packageCoveredQty = rpcParams.p_visitor_count;
      console.error(`[Booking Creation]    → Corrected: packageCovered=${rpcParams.p_package_covered_quantity}, paid=${rpcParams.p_paid_quantity}`);
    }
    
    // CRITICAL: Final validation - sum must equal visitor_count
    if (rpcParams.p_package_covered_quantity + rpcParams.p_paid_quantity !== rpcParams.p_visitor_count) {
      console.error(`[Booking Creation] ❌ CRITICAL: Final RPC param validation failed!`);
      console.error(`[Booking Creation]    package_covered_quantity: ${rpcParams.p_package_covered_quantity}`);
      console.error(`[Booking Creation]    paid_quantity: ${rpcParams.p_paid_quantity}`);
      console.error(`[Booking Creation]    visitor_count: ${rpcParams.p_visitor_count}`);
      console.error(`[Booking Creation]    Sum: ${rpcParams.p_package_covered_quantity + rpcParams.p_paid_quantity} (expected ${rpcParams.p_visitor_count})`);
      // Force correct values
      rpcParams.p_package_covered_quantity = Math.min(rpcParams.p_visitor_count, rpcParams.p_package_covered_quantity);
      rpcParams.p_paid_quantity = rpcParams.p_visitor_count - rpcParams.p_package_covered_quantity;
      paidQty = rpcParams.p_paid_quantity;
      packageCoveredQty = rpcParams.p_package_covered_quantity;
      console.error(`[Booking Creation]    → FORCED CORRECTION: packageCovered=${rpcParams.p_package_covered_quantity}, paid=${rpcParams.p_paid_quantity}`);
    }
    
    // CRITICAL: Validate package coverage parameters before RPC call
    if (rpcParams.p_package_covered_quantity + rpcParams.p_paid_quantity !== rpcParams.p_visitor_count) {
      console.error(`[Booking Creation] ❌ CRITICAL: RPC parameter validation failed!`);
      console.error(`[Booking Creation]    p_package_covered_quantity: ${rpcParams.p_package_covered_quantity}`);
      console.error(`[Booking Creation]    p_paid_quantity: ${rpcParams.p_paid_quantity}`);
      console.error(`[Booking Creation]    p_visitor_count: ${rpcParams.p_visitor_count}`);
      console.error(`[Booking Creation]    Sum: ${rpcParams.p_package_covered_quantity + rpcParams.p_paid_quantity} (expected ${rpcParams.p_visitor_count})`);
      // Fix the parameters
      if (rpcParams.p_package_covered_quantity > rpcParams.p_visitor_count) {
        rpcParams.p_package_covered_quantity = rpcParams.p_visitor_count;
        rpcParams.p_paid_quantity = 0;
      } else {
        rpcParams.p_paid_quantity = rpcParams.p_visitor_count - rpcParams.p_package_covered_quantity;
      }
      console.error(`[Booking Creation]    → Corrected RPC params: packageCovered=${rpcParams.p_package_covered_quantity}, paid=${rpcParams.p_paid_quantity}`);
    }
    
    // Validate critical parameters
    if (!rpcParams.p_slot_id || !rpcParams.p_service_id || !rpcParams.p_tenant_id) {
      console.error('[Booking Creation] ❌ CRITICAL: Missing required RPC parameters');
      return sendResponse(400, { error: 'Missing required booking parameters' });
    }
    
    // Ensure numeric values are valid
    if (isNaN(rpcParams.p_visitor_count) || rpcParams.p_visitor_count < 1) {
      console.error('[Booking Creation] ❌ CRITICAL: Invalid visitor_count');
      return sendResponse(400, { error: 'Invalid visitor count' });
    }
    
    if (isNaN(rpcParams.p_total_price) || rpcParams.p_total_price < 0) {
      console.error('[Booking Creation] ❌ CRITICAL: Invalid total_price');
      return sendResponse(400, { error: 'Invalid total price' });
    }
    
    // Log RPC parameters (sanitized)
    console.log('[Booking Creation] RPC Parameters:', {
      p_slot_id: rpcParams.p_slot_id,
      p_service_id: rpcParams.p_service_id,
      p_tenant_id: rpcParams.p_tenant_id,
      p_visitor_count: rpcParams.p_visitor_count,
      p_total_price: rpcParams.p_total_price,
      p_package_subscription_id: rpcParams.p_package_subscription_id,
      p_package_covered_quantity: rpcParams.p_package_covered_quantity,
      p_paid_quantity: rpcParams.p_paid_quantity,
      p_customer_id: rpcParams.p_customer_id ? 'provided' : 'null',
      p_session_id: rpcParams.p_session_id ? 'provided' : 'null',
      validation: `${rpcParams.p_package_covered_quantity} + ${rpcParams.p_paid_quantity} = ${rpcParams.p_package_covered_quantity + rpcParams.p_paid_quantity} (visitor_count: ${rpcParams.p_visitor_count})`
    });
    
    // CRITICAL: Log type information to catch any type coercion issues
    console.log('[Booking Creation] RPC Parameter Types:', {
      p_package_covered_quantity_type: typeof rpcParams.p_package_covered_quantity,
      p_paid_quantity_type: typeof rpcParams.p_paid_quantity,
      p_package_covered_quantity_value: rpcParams.p_package_covered_quantity,
      p_paid_quantity_value: rpcParams.p_paid_quantity,
      p_package_covered_quantity_is_null: rpcParams.p_package_covered_quantity === null,
      p_paid_quantity_is_null: rpcParams.p_paid_quantity === null,
      p_package_covered_quantity_is_undefined: rpcParams.p_package_covered_quantity === undefined,
      p_paid_quantity_is_undefined: rpcParams.p_paid_quantity === undefined
    });
    
    let booking: any = null;
    let createError: any = null;
    
    try {
      console.log('[Booking Creation] Executing RPC call...');
      const rpcResult = await supabase.rpc('create_booking_with_lock', rpcParams);
      booking = rpcResult.data;
      createError = rpcResult.error;
      console.log('[Booking Creation] RPC call completed');
    } catch (rpcException: any) {
      console.error('[Booking Creation] ❌ Exception during RPC call:', rpcException);
      console.error('[Booking Creation] Exception message:', rpcException?.message);
      console.error('[Booking Creation] Exception stack:', rpcException?.stack);
      createError = rpcException;
    }

    if (createError) {
      console.error(`[Booking Creation] ========================================`);
      console.error(`[Booking Creation] ❌ RPC ERROR DETECTED`);
      console.error(`[Booking Creation] ========================================`);
      console.error(`[Booking Creation] Error code: ${createError.code || 'N/A'}`);
      console.error(`[Booking Creation] Error message: ${createError.message || 'No message'}`);
      console.error(`[Booking Creation] Error details:`, JSON.stringify(createError, null, 2));
      console.error(`[Booking Creation] Error type: ${createError.constructor?.name || typeof createError}`);
      console.error(`[Booking Creation] ========================================`);
      
      // Check if RPC function doesn't exist
      if (createError.message?.includes('function') && createError.message?.includes('does not exist')) {
        console.error(`[Booking Creation] ❌ CRITICAL: RPC function 'create_booking_with_lock' does not exist!`);
        console.error(`[Booking Creation]    Please deploy the function from: database/create_booking_with_lock_function.sql`);
        return sendResponse(500, { 
          error: 'Booking function not deployed. Please contact administrator.',
          details: 'RPC function create_booking_with_lock is missing',
          code: createError.code
        });
      }
      
      // Map specific error messages to appropriate status codes
      const errorMessage = createError.message || 'Unknown error occurred';
      
      if (errorMessage.includes('Missing required fields') ||
          errorMessage.includes('does not match') ||
          errorMessage.includes('must be')) {
        return sendResponse(400, { 
          error: errorMessage,
          code: createError.code,
          details: 'Validation error'
        });
      }
      if (errorMessage.includes('not found')) {
        return sendResponse(404, { 
          error: errorMessage,
          code: createError.code
        });
      }
      if (errorMessage.includes('deactivated') ||
          errorMessage.includes('belongs to different session') ||
          errorMessage.includes('does not belong to')) {
        return sendResponse(403, { 
          error: errorMessage,
          code: createError.code
        });
      }
      if (errorMessage.includes('expired') ||
          errorMessage.includes('not available') ||
          errorMessage.includes('Not enough tickets')) {
        return sendResponse(409, { 
          error: errorMessage,
          code: createError.code
        });
      }
      
      // For database constraint errors, return 400 instead of 500
      if (createError.code === '23503' || errorMessage.includes('foreign key')) {
        return sendResponse(400, {
          error: 'Database constraint violation. Please check that all referenced records exist (customer, service, slot, etc.).',
          details: errorMessage,
          code: createError.code
        });
      }
      
      if (createError.code === '23502' || errorMessage.includes('not null')) {
        return sendResponse(400, {
          error: 'Missing required data. Please ensure all required fields are provided.',
          details: errorMessage,
          code: createError.code
        });
      }
      
      // For other RPC errors, return 500 with details
      // DO NOT throw - always return a response
      return sendResponse(500, {
        error: errorMessage || 'Failed to create booking',
        details: `RPC function error: ${errorMessage}`,
        code: createError.code,
        type: 'RPC_ERROR'
      });
    }

    if (!booking) {
      console.error(`[Booking Creation] ❌ CRITICAL: RPC returned null/undefined booking`);
      console.error(`[Booking Creation]    This means the function executed but returned no data`);
      return sendResponse(500, { 
        error: 'Failed to create booking - no data returned',
        details: 'The RPC function executed but did not return any booking data'
      });
    }

    console.log(`[Booking Creation] RPC Response received:`, {
      type: typeof booking,
      isString: typeof booking === 'string',
      isObject: typeof booking === 'object',
      hasId: typeof booking === 'object' && booking !== null && 'id' in booking,
      rawValue: JSON.stringify(booking).substring(0, 200)
    });

    // ============================================================================
    // VALIDATE BOOKING WAS CREATED WITH CORRECT VALUES
    // ============================================================================
    // After RPC call, verify the booking has correct package coverage values
    // This catches any issues where the RPC function might have overridden our values
    
    // Handle JSONB response - Supabase RPC may return JSONB as object or string
    // The RPC function returns: { success: true, booking: { id: ..., ... } }
    let bookingData: any = booking;
    if (typeof booking === 'string') {
      try {
        console.log(`[Booking Creation] Parsing JSONB string response...`);
        bookingData = JSON.parse(booking);
        console.log(`[Booking Creation] ✅ Parsed successfully`);
      } catch (e) {
        console.error(`[Booking Creation] ❌ Failed to parse booking JSONB:`, e);
        console.error(`[Booking Creation]    Raw response:`, booking);
        bookingData = booking;
      }
    } else if (typeof booking === 'object' && booking !== null) {
      console.log(`[Booking Creation] Response is already an object`);
    }

    // Extract booking from response structure: { success: true, booking: { id: ... } }
    // OR direct booking object: { id: ... }
    let actualBooking: any = null;
    if (bookingData?.booking) {
      // RPC returns { success: true, booking: { id: ... } }
      actualBooking = bookingData.booking;
      console.log(`[Booking Creation] Found nested booking structure (booking.booking)`);
    } else if (bookingData?.id) {
      // Direct booking object
      actualBooking = bookingData;
      console.log(`[Booking Creation] Found direct booking object`);
    }

    // ============================================================================
    // Store payment_status, payment_method, transaction_reference when provided (Admin/Receptionist)
    // When payment_status is 'unpaid' or 'awaiting_payment', invoice is skipped and created when marked paid later.
    // ============================================================================
    if (actualBooking?.id) {
      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (reqPaymentStatus === 'unpaid' || reqPaymentStatus === 'awaiting_payment' || reqPaymentStatus === 'paid' || reqPaymentStatus === 'paid_manual') {
        updatePayload.payment_status = reqPaymentStatus;
      }
      if (reqPaymentMethod === 'onsite' || reqPaymentMethod === 'transfer') {
        updatePayload.payment_method = reqPaymentMethod;
        updatePayload.transaction_reference = reqPaymentMethod === 'transfer' && reqTransactionRef ? String(reqTransactionRef).trim() : null;
      }
      if (Object.keys(updatePayload).length > 1) {
        await supabase.from('bookings').update(updatePayload).eq('id', actualBooking.id);
      }
      // Update service_rotation_state for employee-based + auto_assign (fair rotation)
      if (actualBooking.service_id && actualBooking.employee_id) {
        const { data: svc } = await supabase.from('services').select('scheduling_type, assignment_mode').eq('id', actualBooking.service_id).single();
        if ((svc as any)?.scheduling_type === 'employee_based' && (svc as any)?.assignment_mode === 'auto_assign') {
          await supabase.from('service_rotation_state').upsert(
            { service_id: actualBooking.service_id, last_assigned_employee_id: actualBooking.employee_id, updated_at: new Date().toISOString() },
            { onConflict: 'service_id' }
          );
        }
      }
    }

    // ============================================================================
    // POST-CREATION VALIDATION: Verify booking has correct package coverage values
    // ============================================================================
    if (actualBooking?.id) {
      const bookingId = actualBooking.id;
      console.log(`[Booking Creation] 🔍 Validating created booking ${bookingId}...`);
      
      // Fetch the actual booking from database to verify values
      const { data: dbBooking, error: dbError } = await supabase
        .from('bookings')
        .select('id, package_covered_quantity, paid_quantity, total_price, visitor_count')
        .eq('id', bookingId)
        .single();
      
      if (!dbError && dbBooking) {
        const dbPackageCovered = dbBooking.package_covered_quantity ?? 0;
        const dbPaidQty = dbBooking.paid_quantity ?? 0;
        const dbTotalPrice = parseFloat(dbBooking.total_price?.toString() || '0');
        const dbVisitorCount = dbBooking.visitor_count ?? 0;
        
        console.log(`[Booking Creation] 📊 Database booking values:`, {
          visitor_count: dbVisitorCount,
          package_covered_quantity: dbPackageCovered,
          paid_quantity: dbPaidQty,
          total_price: dbTotalPrice,
          sum: `${dbPackageCovered} + ${dbPaidQty} = ${dbPackageCovered + dbPaidQty} (should be ${dbVisitorCount})`
        });
        
        // Validate values match what we sent
        if (dbPackageCovered !== packageCoveredQty || dbPaidQty !== paidQty) {
          console.error(`[Booking Creation] ❌ CRITICAL: Booking values don't match what we sent!`);
          console.error(`[Booking Creation]    Expected: packageCovered=${packageCoveredQty}, paid=${paidQty}`);
          console.error(`[Booking Creation]    Actual: packageCovered=${dbPackageCovered}, paid=${dbPaidQty}`);
          console.error(`[Booking Creation]    → This indicates the RPC function may have overridden our values`);
          
          // If values are wrong, try to fix them (but this shouldn't happen)
          if (dbPackageCovered + dbPaidQty !== dbVisitorCount) {
            console.error(`[Booking Creation] ❌ CRITICAL: Booking values are also invalid (sum doesn't match visitor_count)!`);
            console.error(`[Booking Creation]    This is a database integrity issue - booking may need manual correction`);
          }
        } else {
          console.log(`[Booking Creation] ✅ Booking values match what we sent`);
        }
        
        // Validate strict billing rule
        if (dbPaidQty > 0 && dbTotalPrice <= 0) {
          console.error(`[Booking Creation] ❌ CRITICAL: paid_quantity > 0 but total_price = 0!`);
          console.error(`[Booking Creation]    This violates strict billing rules - invoice cannot be created`);
          console.error(`[Booking Creation]    paid_quantity: ${dbPaidQty}, total_price: ${dbTotalPrice}`);
        } else if (dbPaidQty <= 0 && dbTotalPrice > 0) {
          console.error(`[Booking Creation] ❌ CRITICAL: paid_quantity = 0 but total_price > 0!`);
          console.error(`[Booking Creation]    This violates strict billing rules - should not charge for package-covered bookings`);
          console.error(`[Booking Creation]    paid_quantity: ${dbPaidQty}, total_price: ${dbTotalPrice}`);
        } else {
          console.log(`[Booking Creation] ✅ Strict billing rule validation passed`);
        }
      } else {
        console.warn(`[Booking Creation] ⚠️ Could not fetch booking from database for validation:`, dbError);
      }
    } else if (bookingData?.success && bookingData?.booking) {
      // Alternative nested structure
      actualBooking = bookingData.booking;
      console.log(`[Booking Creation] Found success.booking structure`);
    }

    // Extract booking ID from the response structure
    // RPC returns: { success: true, booking: { id: ... } }
    let bookingId: string | null = null;
    
    if (actualBooking?.id) {
      bookingId = actualBooking.id;
    } else if (bookingData?.id) {
      bookingId = bookingData.id;
    } else if (bookingData?.booking?.id) {
      bookingId = bookingData.booking.id;
    }

    // ============================================================================
    // POST-CREATION VALIDATION: Verify booking has correct package coverage values
    // ============================================================================
    if (bookingId) {
      console.log(`[Booking Creation] 🔍 Validating created booking ${bookingId}...`);
      
      // Wait a moment for database to be consistent
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Fetch the actual booking from database to verify values
      const { data: dbBooking, error: dbError } = await supabase
        .from('bookings')
        .select('id, package_covered_quantity, paid_quantity, total_price, visitor_count')
        .eq('id', bookingId)
        .single();
      
      if (!dbError && dbBooking) {
        const dbPackageCovered = dbBooking.package_covered_quantity ?? 0;
        const dbPaidQty = dbBooking.paid_quantity ?? 0;
        const dbTotalPrice = parseFloat(dbBooking.total_price?.toString() || '0');
        const dbVisitorCount = dbBooking.visitor_count ?? 0;
        
        console.log(`[Booking Creation] 📊 Database booking values:`, {
          visitor_count: dbVisitorCount,
          package_covered_quantity: dbPackageCovered,
          paid_quantity: dbPaidQty,
          total_price: dbTotalPrice,
          sum: `${dbPackageCovered} + ${dbPaidQty} = ${dbPackageCovered + dbPaidQty} (should be ${dbVisitorCount})`
        });
        
        // Validate values match what we sent
        if (dbPackageCovered !== packageCoveredQty || dbPaidQty !== paidQty) {
          console.error(`[Booking Creation] ❌ CRITICAL: Booking values don't match what we sent!`);
          console.error(`[Booking Creation]    Expected: packageCovered=${packageCoveredQty}, paid=${paidQty}`);
          console.error(`[Booking Creation]    Actual: packageCovered=${dbPackageCovered}, paid=${dbPaidQty}`);
          console.error(`[Booking Creation]    → This indicates the RPC function may have overridden our values`);
          
          // If values are wrong, try to fix them (but this shouldn't happen)
          if (dbPackageCovered + dbPaidQty !== dbVisitorCount) {
            console.error(`[Booking Creation] ❌ CRITICAL: Booking values are also invalid (sum doesn't match visitor_count)!`);
            console.error(`[Booking Creation]    This is a database integrity issue - booking may need manual correction`);
          }
        } else {
          console.log(`[Booking Creation] ✅ Booking values match what we sent`);
        }
        
        // Validate strict billing rule
        if (dbPaidQty > 0 && dbTotalPrice <= 0) {
          console.error(`[Booking Creation] ❌ CRITICAL: paid_quantity > 0 but total_price = 0!`);
          console.error(`[Booking Creation]    This violates strict billing rules - invoice cannot be created`);
          console.error(`[Booking Creation]    paid_quantity: ${dbPaidQty}, total_price: ${dbTotalPrice}`);
        } else if (dbPaidQty <= 0 && dbTotalPrice > 0) {
          console.error(`[Booking Creation] ❌ CRITICAL: paid_quantity = 0 but total_price > 0!`);
          console.error(`[Booking Creation]    This violates strict billing rules - should not charge for package-covered bookings`);
          console.error(`[Booking Creation]    paid_quantity: ${dbPaidQty}, total_price: ${dbTotalPrice}`);
        } else {
          console.log(`[Booking Creation] ✅ Strict billing rule validation passed`);
        }
      } else {
        console.warn(`[Booking Creation] ⚠️ Could not fetch booking from database for validation:`, dbError);
      }
    }

    if (!bookingId) {
      console.error(`[Booking Creation] ❌ CRITICAL: Booking created but no ID found in response!`);
      console.error(`[Booking Creation]    Response type: ${typeof booking}`);
      console.error(`[Booking Creation]    Parsed data type: ${typeof bookingData}`);
      console.error(`[Booking Creation]    Parsed data:`, JSON.stringify(bookingData, null, 2));
      console.error(`[Booking Creation]    Raw response:`, JSON.stringify(booking, null, 2));
      console.error(`[Booking Creation]    Actual booking:`, JSON.stringify(actualBooking, null, 2));
      console.error(`[Booking Creation]    This will prevent ticket generation from running!`);
      return sendResponse(500, { 
        error: 'Booking created but ID not returned',
        details: 'The booking was created but the response does not contain an ID. Ticket generation cannot proceed.',
        debug: {
          responseType: typeof booking,
          parsedData: bookingData,
          actualBooking: actualBooking
        }
      });
    }

    console.log(`[Booking Creation] ✅ Booking created successfully: ${bookingId}`);
    console.log(`[Booking Creation]    Customer: ${customer_name}`);
    console.log(`[Booking Creation]    Email: ${customer_email || 'not provided'}`);
    console.log(`[Booking Creation]    Phone: ${normalizedPhone || customer_phone || 'not provided'}`);

    // Check if tickets are enabled for this tenant
    const { data: tenantSettings } = await supabase
      .from('tenants')
      .select('tickets_enabled')
      .eq('id', tenant_id)
      .single();
    
    const ticketsEnabled = tenantSettings?.tickets_enabled !== false; // Default to true if not set
    
    // Generate and send ticket PDF asynchronously (don't block response)
    // IMPORTANT: Tickets are only generated if tickets_enabled is true
    // Use setImmediate for more reliable execution than process.nextTick
    // CRITICAL: This MUST run - tickets are more important than invoices
    console.log(`\n🎫 ========================================`);
    console.log(`🎫 TICKET GENERATION CHECK for booking ${bookingId}`);
    console.log(`🎫 Tickets Enabled: ${ticketsEnabled}`);
    console.log(`🎫 Customer: ${customer_name}`);
    console.log(`🎫 Email: ${customer_email || 'NOT PROVIDED'}`);
    console.log(`🎫 Phone: ${normalizedPhone || customer_phone || 'NOT PROVIDED'}`);
    console.log(`🎫 ========================================\n`);
    
    // Only generate tickets if enabled
    if (!ticketsEnabled) {
      console.log(`🎫 Tickets are disabled for this tenant. Skipping ticket generation.`);
    }
    
    // Generate ticket PDF synchronously to ensure it completes before response
    // This prevents Railway container restarts from killing the process
    // The actual sending (WhatsApp/Email) can be async
    const ticketGenerationPromise = (async () => {
      // Early return if tickets are disabled
      if (!ticketsEnabled) {
        console.log(`🎫 Ticket generation skipped - tickets are disabled for this tenant`);
        return;
      }
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
        // Use actualBooking if available, otherwise fall back to bookingData
        const bookingLanguage = actualBooking?.language || bookingData?.language || validLanguage;
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
    // ============================================================================
    // INVOICE CREATION FLOW
    // ============================================================================
    // CRITICAL: Log invoice creation attempt BEFORE the promise
    console.log(`[Booking Creation] ========================================`);
    console.log(`[Booking Creation] 🧾 INVOICE CREATION CHECK`);
    console.log(`[Booking Creation] ========================================`);
    console.log(`[Booking Creation]    Booking ID: ${bookingId}`);
    console.log(`[Booking Creation]    Tenant ID: ${tenant_id}`);
    console.log(`[Booking Creation]    Customer Email: ${customer_email || 'NOT PROVIDED'}`);
    console.log(`[Booking Creation]    Customer Phone: ${normalizedPhone || customer_phone || 'NOT PROVIDED'}`);
    console.log(`[Booking Creation]    Has Email: ${!!customer_email}`);
    console.log(`[Booking Creation]    Has Phone: ${!!(normalizedPhone || customer_phone)}`);
    console.log(`[Booking Creation]    Will Create Invoice: ${!!(normalizedPhone || customer_phone || customer_email)}`);
    console.log(`[Booking Creation] ========================================`);
    
    // ============================================================================
    // STRICT BILLING RULE: Invoice ONLY when real money is owed
    // ============================================================================
    // CRITICAL RULES:
    // 1. Invoice MUST be created when: paidQty > 0 AND total_price > 0
    // 2. Invoice MUST NOT be created when: paidQty = 0 OR total_price = 0
    // 3. Package-covered bookings (paidQty = 0) are NEVER invoiced
    // 4. Booking is ALWAYS created regardless of payment status
    // ============================================================================
    
    // Calculate final price after package coverage
    const finalPriceAfterPackage = finalTotalPrice; // This already accounts for package coverage
    
    // STRICT CHECK: Only create invoice if there's actual money owed
    const shouldCreateInvoice = (normalizedPhone || customer_phone || customer_email) 
      && paidQty > 0 
      && finalPriceAfterPackage > 0;
    // When payment_status is unpaid/awaiting_payment, skip invoice at creation; invoice is created when marked paid later.
    const createInvoiceNow = reqPaymentStatus !== 'unpaid' && reqPaymentStatus !== 'awaiting_payment';
    
    if (shouldCreateInvoice && createInvoiceNow) {
      console.log(`[Booking Creation] ✅ Invoice creation conditions met:`);
      console.log(`[Booking Creation]    - Customer contact: ${normalizedPhone || customer_phone || customer_email ? 'YES' : 'NO'}`);
      console.log(`[Booking Creation]    - Paid quantity: ${paidQty} (must be > 0)`);
      console.log(`[Booking Creation]    - Total price: ${finalPriceAfterPackage} (must be > 0)`);
      console.log(`[Booking Creation]    - Package covered: ${packageCoveredQty}`);
      console.log(`[Booking Creation]    → Proceeding with invoice creation`);
      
      // CRITICAL: Execute invoice creation immediately and await it before sending response
      // This ensures invoice is created even if Railway container restarts
      const invoicePromise = (async () => {
        try {
          console.log(`[Booking Creation] ========================================`);
          console.log(`[Booking Creation] 🧾 INVOICE FLOW STARTED`);
          console.log(`[Booking Creation] ========================================`);
          console.log(`[Booking Creation]    Booking ID: ${bookingId}`);
          console.log(`[Booking Creation]    Tenant ID: ${tenant_id}`);
          console.log(`[Booking Creation]    Customer Email: ${customer_email || 'NOT PROVIDED'}`);
          console.log(`[Booking Creation]    Customer Phone: ${normalizedPhone || customer_phone || 'NOT PROVIDED'}`);
          console.log(`[Booking Creation]    Flow: Booking Confirmed → Create Invoice → Send via Email/WhatsApp`);
          console.log(`[Booking Creation] ========================================`);
          
          // Check if Zoho is configured for this tenant before attempting invoice creation
          console.log(`[Booking Creation] 🔍 Step 1: Checking Zoho configuration...`);
          const { data: zohoConfig, error: zohoConfigError } = await supabase
            .from('tenant_zoho_configs')
            .select('id, is_active, client_id, redirect_uri')
            .eq('tenant_id', tenant_id)
            .eq('is_active', true)
            .maybeSingle();
          
          if (zohoConfigError) {
            console.error(`[Booking Creation] ❌ Error checking Zoho config: ${zohoConfigError.message}`);
            console.error(`[Booking Creation]    Error code: ${zohoConfigError.code}`);
            console.error(`[Booking Creation]    Error details: ${JSON.stringify(zohoConfigError)}`);
          }
          
          console.log(`[Booking Creation] 🔍 Step 2: Checking Zoho tokens...`);
          const { data: zohoToken, error: zohoTokenError } = await supabase
            .from('zoho_tokens')
            .select('id, expires_at, access_token')
            .eq('tenant_id', tenant_id)
            .maybeSingle();
          
          if (zohoTokenError) {
            console.error(`[Booking Creation] ❌ Error checking Zoho token: ${zohoTokenError.message}`);
            console.error(`[Booking Creation]    Error code: ${zohoTokenError.code}`);
            console.error(`[Booking Creation]    Error details: ${JSON.stringify(zohoTokenError)}`);
          }
          
          console.log(`[Booking Creation] 📊 Configuration Check Results:`);
          console.log(`[Booking Creation]    Zoho Config exists: ${!!zohoConfig}`);
          console.log(`[Booking Creation]    Zoho Config active: ${zohoConfig?.is_active || false}`);
          console.log(`[Booking Creation]    Zoho Config has client_id: ${!!zohoConfig?.client_id}`);
          console.log(`[Booking Creation]    Zoho Token exists: ${!!zohoToken}`);
          
          if (!zohoConfig || !zohoToken) {
            const errorMsg = `Zoho Invoice not configured for tenant ${tenant_id}. Config exists: ${!!zohoConfig}, Token exists: ${!!zohoToken}`;
            console.error(`[Booking Creation] ❌ ${errorMsg}`);
            console.error(`[Booking Creation]    Config error: ${zohoConfigError?.message || 'None'}`);
            console.error(`[Booking Creation]    Token error: ${zohoTokenError?.message || 'None'}`);
            console.error(`[Booking Creation]    Invoice creation skipped. Please configure Zoho Invoice in Settings → Zoho Integration`);
            console.error(`[Booking Creation]    Steps: 1) Add Zoho credentials, 2) Complete OAuth flow, 3) Verify connection`);
            
            // Log this failure to zoho_invoice_logs for tracking
            try {
              await supabase
                .from('zoho_invoice_logs')
                .insert({
                  booking_id: bookingId,
                  tenant_id: tenant_id,
                  zoho_invoice_id: null,
                  status: 'failed',
                  error_message: errorMsg,
                  request_payload: JSON.stringify({ 
                    booking_id: bookingId, 
                    tenant_id: tenant_id,
                    has_config: !!zohoConfig,
                    has_token: !!zohoToken,
                    config_error: zohoConfigError?.message,
                    token_error: zohoTokenError?.message
                  }),
                  response_payload: JSON.stringify({ error: 'Zoho not configured' }),
                });
            } catch (logError: any) {
              console.error(`[Booking Creation] ⚠️ Failed to log invoice failure: ${logError.message}`);
            }
            
            return; // Exit early if Zoho is not configured
          }
          
          // Check if token is expired (only reject actually expired tokens)
          // getAccessToken() will auto-refresh tokens close to expiration
          if (zohoToken.expires_at) {
            const expiresAt = new Date(zohoToken.expires_at);
            const now = new Date();
            const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60);
            
            console.log(`[Booking Creation] 🔍 Step 3: Checking token status...`);
            console.log(`[Booking Creation]    Token expires at: ${expiresAt.toISOString()}`);
            console.log(`[Booking Creation]    Current time: ${now.toISOString()}`);
            console.log(`[Booking Creation]    Minutes until expiration: ${minutesUntilExpiry}`);
            
            // CRITICAL: Don't reject expired tokens here - let getAccessToken() handle refresh
            // getAccessToken() will attempt to refresh expired tokens using refresh_token
            // Only log a warning, but continue - getAccessToken() will handle it
            if (expiresAt <= now) {
              const minutesExpired = Math.abs(Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60));
              console.warn(`[Booking Creation] ⚠️ Token expired ${minutesExpired} minutes ago`);
              console.warn(`[Booking Creation]    getAccessToken() will attempt to refresh using refresh_token`);
              console.warn(`[Booking Creation]    If refresh fails, invoice creation will fail with clear error`);
              // Continue - don't exit early. Let getAccessToken() handle refresh
            } else {
              // Token is valid - getAccessToken() will handle refresh if needed
              if (minutesUntilExpiry <= 5) {
                console.warn(`[Booking Creation] ⚠️ Token expires soon (${minutesUntilExpiry} minutes) - will be auto-refreshed by getAccessToken()`);
              } else {
                console.log(`[Booking Creation] ✅ Token is valid (expires in ${minutesUntilExpiry} minutes)`);
              }
              // Continue - don't block invoice creation for valid tokens
            }
          } else {
            console.warn(`[Booking Creation] ⚠️ Zoho token has no expiration date - proceeding (getAccessToken() will handle validation)`);
          }
          
          console.log(`[Booking Creation] ✅ Zoho is configured and connected for tenant ${tenant_id}`);
          console.log(`[Booking Creation] 🔍 Step 4: Importing ZohoService...`);
          const { zohoService } = await import('../services/zohoService.js');
          console.log(`[Booking Creation] ✅ ZohoService imported successfully`);

          // Follow the exact invoice flow:
          // 1. Booking Confirmed ✓ (already done)
          // 2. Create Invoice in Zoho Invoice
          // 3. Send via Email (if email provided)
          // 4. Download PDF and Send via WhatsApp (if phone provided)
          console.log(`[Booking Creation] 🔍 Step 5: Calling zohoService.generateReceipt(${bookingId})...`);
          const startTime = Date.now();
          
          const invoiceResult = await zohoService.generateReceipt(bookingId, {
            paymentMethod: reqPaymentMethod === 'transfer' ? 'transfer' : reqPaymentMethod === 'onsite' ? 'onsite' : undefined,
            transactionReference: reqPaymentMethod === 'transfer' && reqTransactionRef ? String(reqTransactionRef).trim() : undefined,
          });
          
          const duration = Date.now() - startTime;
          console.log(`[Booking Creation] ⏱️ Invoice generation took ${duration}ms`);
          console.log(`[Booking Creation] 📊 Invoice result:`, JSON.stringify({
            success: invoiceResult.success,
            invoiceId: invoiceResult.invoiceId || 'N/A',
            error: invoiceResult.error || 'None'
          }, null, 2));
          
          if (invoiceResult.success && invoiceResult.invoiceId) {
            console.log(`[Booking Creation] ========================================`);
            console.log(`[Booking Creation] ✅ INVOICE CREATED SUCCESSFULLY`);
            console.log(`[Booking Creation] ========================================`);
            console.log(`[Booking Creation]    Invoice ID: ${invoiceResult.invoiceId}`);
            console.log(`[Booking Creation]    Booking ID: ${bookingId}`);
            console.log(`[Booking Creation]    Email delivery: ${customer_email ? 'WILL ATTEMPT' : 'SKIPPED (no email)'}`);
            console.log(`[Booking Creation]    WhatsApp delivery: ${(normalizedPhone || customer_phone) ? 'WILL ATTEMPT' : 'SKIPPED (no phone)'}`);
            console.log(`[Booking Creation] ========================================`);
            
            // CRITICAL: Verify invoice is actually stored in database
            const { data: verifyInvoice, error: verifyInvoiceError } = await supabase
              .from('bookings')
              .select('zoho_invoice_id, zoho_invoice_created_at')
              .eq('id', bookingId)
              .maybeSingle();
            
            if (!verifyInvoiceError && verifyInvoice) {
              if (verifyInvoice.zoho_invoice_id === invoiceResult.invoiceId) {
                console.log(`[Booking Creation] ✅ VERIFIED: Invoice ${invoiceResult.invoiceId} is stored in database`);
              } else {
                console.error(`[Booking Creation] ⚠️ WARNING: Invoice ID mismatch! Expected ${invoiceResult.invoiceId}, found ${verifyInvoice.zoho_invoice_id || 'NULL'}`);
              }
            } else {
              console.error(`[Booking Creation] ⚠️ Could not verify invoice storage: ${verifyInvoiceError?.message || 'Booking not found'}`);
            }
          } else {
            console.error(`[Booking Creation] ========================================`);
            console.error(`[Booking Creation] ❌ INVOICE CREATION FAILED`);
            console.error(`[Booking Creation] ========================================`);
            console.error(`[Booking Creation]    Booking ID: ${bookingId}`);
            console.error(`[Booking Creation]    Invoice ID: ${invoiceResult.invoiceId || 'NONE'}`);
            console.error(`[Booking Creation]    Success: ${invoiceResult.success}`);
            console.error(`[Booking Creation]    Error: ${invoiceResult.error || 'Unknown error'}`);
            console.error(`[Booking Creation]    This may be due to Zoho connection issues. Check server logs for details.`);
            console.error(`[Booking Creation]    Note: Ticket will still be sent even if invoice creation fails.`);
            console.error(`[Booking Creation] ========================================`);
            
            // CRITICAL: If invoice creation failed, log it clearly
            // This helps track why invoices are not being created
            console.error(`[Booking Creation] 🔴 CRITICAL: Invoice was NOT created for booking ${bookingId}`);
            console.error(`[Booking Creation]    Action Required: Check Zoho configuration and connection`);
            console.error(`[Booking Creation]    Check: Settings → Zoho Integration → Verify connection status`);
          }
        } catch (invoiceError: any) {
          console.error(`[Booking Creation] ========================================`);
          console.error(`[Booking Creation] ❌ EXCEPTION IN INVOICE CREATION`);
          console.error(`[Booking Creation] ========================================`);
          console.error(`[Booking Creation]    Booking ID: ${bookingId}`);
          console.error(`[Booking Creation]    Error Type: ${invoiceError?.constructor?.name || 'Unknown'}`);
          console.error(`[Booking Creation]    Error Message: ${invoiceError?.message || 'Unknown error'}`);
          console.error(`[Booking Creation]    Error Code: ${invoiceError?.code || 'N/A'}`);
          console.error(`[Booking Creation]    Error Stack: ${invoiceError?.stack || 'No stack trace'}`);
          
          // Check if error is about missing Zoho configuration
          if (invoiceError.message?.includes('No Zoho token found') || 
              invoiceError.message?.includes('Zoho credentials not configured') ||
              invoiceError.message?.includes('Please complete OAuth flow')) {
            console.error(`[Booking Creation]    Category: Zoho Configuration Missing`);
            console.error(`[Booking Creation]    Action: Invoice creation skipped. Please configure Zoho Invoice in Settings → Zoho Integration`);
          } else {
            console.error(`[Booking Creation]    Category: Unexpected Error`);
            console.error(`[Booking Creation]    Action: Invoice creation failed but booking was created successfully`);
          }
          console.error(`[Booking Creation] ========================================`);
          
          // Don't fail booking if invoice creation fails
        }
      })();
      
      // CRITICAL: Await invoice creation to ensure it completes before sending response
      // This prevents Railway from killing the process before invoice is created
      try {
        await invoicePromise;
        console.log(`[Booking Creation] ✅ Invoice creation promise completed for booking ${bookingId}`);
        
        // Verify invoice was actually created and stored
        const { data: verifyBooking, error: verifyError } = await supabase
          .from('bookings')
          .select('zoho_invoice_id, zoho_invoice_created_at')
          .eq('id', bookingId)
          .maybeSingle();
        
        if (!verifyError && verifyBooking) {
          if (verifyBooking.zoho_invoice_id) {
            console.log(`[Booking Creation] ✅ VERIFIED: Invoice ${verifyBooking.zoho_invoice_id} is stored in database`);
            console.log(`[Booking Creation]    Invoice created at: ${verifyBooking.zoho_invoice_created_at || 'N/A'}`);
          } else {
            console.error(`[Booking Creation] ⚠️ WARNING: Invoice creation promise completed but no invoice_id found in database!`);
            console.error(`[Booking Creation]    This indicates invoice creation may have failed silently`);
            console.error(`[Booking Creation]    Check Zoho configuration and server logs for details`);
          }
        } else {
          console.error(`[Booking Creation] ⚠️ Could not verify invoice creation: ${verifyError?.message || 'Booking not found'}`);
        }
      } catch (invoiceError: any) {
        console.error(`[Booking Creation] ❌ Invoice creation failed (non-blocking):`, invoiceError);
        console.error(`[Booking Creation]    Error type: ${invoiceError?.constructor?.name || 'Unknown'}`);
        console.error(`[Booking Creation]    Error message: ${invoiceError?.message || 'Unknown error'}`);
        console.error(`[Booking Creation]    Error stack: ${invoiceError?.stack || 'No stack trace'}`);
        // Don't fail booking if invoice creation fails - booking is already created
        // The error was already logged in the inner try-catch
      }
    } else if (shouldCreateInvoice && !createInvoiceNow) {
      console.log(`[Booking Creation] ℹ️ Invoice skipped: payment_status is ${reqPaymentStatus || 'unset'}. Invoice will be created when booking is marked as paid.`);
    } else {
      // Log why invoice was not created
      const reasons: string[] = [];
      if (!normalizedPhone && !customer_phone && !customer_email) {
        reasons.push('no customer contact (email/phone)');
      }
      if (paidQty <= 0) {
        reasons.push(`fully covered by package (paidQty = ${paidQty})`);
      }
      if (finalPriceAfterPackage <= 0) {
        reasons.push(`total price is 0 (price = ${finalPriceAfterPackage})`);
      }
      if (!createInvoiceNow) {
        reasons.push('payment_status is unpaid (invoice created when marked paid)');
      }
      
      console.log(`[Booking Creation] ⚠️ Invoice NOT created - ${reasons.join(', ')}`);
      console.log(`[Booking Creation]    This is CORRECT behavior for package-covered bookings`);
      console.log(`[Booking Creation]    Booking was created successfully (ticket rule: always create booking)`);
      console.log(`[Booking Creation]    Package coverage: ${packageCoveredQty} tickets, Paid: ${paidQty} tickets`);
    }

    // ============================================================================
    // FINAL VERIFICATION: Log booking creation success
    // ============================================================================
    console.log(`[Booking Creation] ========================================`);
    console.log(`[Booking Creation] ✅ BOOKING CREATED SUCCESSFULLY`);
    console.log(`[Booking Creation] ========================================`);
    console.log(`[Booking Creation]    Booking ID: ${bookingId}`);
    console.log(`[Booking Creation]    Customer: ${customer_name}`);
    console.log(`[Booking Creation]    Total Price: ${actualBooking?.total_price || 'N/A'}`);
    console.log(`[Booking Creation]    Package Coverage: ${actualBooking?.package_covered_quantity || 0} tickets`);
    console.log(`[Booking Creation]    Paid Quantity: ${actualBooking?.paid_quantity || 0} tickets`);
    console.log(`[Booking Creation]    Invoice Creation: ${shouldCreateInvoice ? 'COMPLETED' : 'SKIPPED (package-covered or no contact)'}`);
    console.log(`[Booking Creation]    Ticket Rule: ✅ Booking ALWAYS created (even if free)`);
    console.log(`[Booking Creation] ========================================`);

    // Return the booking with proper structure
    return sendResponse(201, { 
      id: bookingId,
      ...actualBooking,
      booking: actualBooking // Also include as 'booking' for backward compatibility
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    
    // Log detailed error information
    console.error('[Booking Creation] ========================================');
    console.error('[Booking Creation] ❌ UNHANDLED EXCEPTION');
    console.error('[Booking Creation] ========================================');
    console.error('[Booking Creation] Error type:', error?.constructor?.name || 'Unknown');
    console.error('[Booking Creation] Error message:', error?.message || 'No message');
    console.error('[Booking Creation] Error code:', error?.code || 'No code');
    console.error('[Booking Creation] Error name:', error?.name || 'Unknown');
    
    if (error?.response) {
      console.error('[Booking Creation] Error response:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      });
    }
    
    if (error?.stack) {
      console.error('[Booking Creation] Error stack:', error.stack);
    }
    
    console.error('[Booking Creation] Request body:', {
      slot_id: req.body?.slot_id,
      service_id: req.body?.service_id,
      tenant_id: req.body?.tenant_id,
      customer_name: req.body?.customer_name,
      visitor_count: req.body?.visitor_count,
      has_package: !!req.body?.package_subscription_id,
      has_booking_group_id: !!req.body?.booking_group_id
    });
    
    console.error('[Booking Creation] User:', {
      id: req.user?.id,
      role: req.user?.role,
      tenant_id: req.user?.tenant_id
    });
    
    console.error('[Booking Creation] ========================================');
    
    logger.error('Create booking error', error, context, {
      slot_id: req.body?.slot_id,
      service_id: req.body?.service_id,
      tenant_id: req.body?.tenant_id,
      lock_id: req.body?.lock_id,
    });
    
    // Provide more helpful error message
    let errorMessage = error.message || 'Internal server error';
    let errorDetails: string | undefined = undefined;
    
    // Check for common issues
    if (error.message?.includes('foreign key') || error.code === '23503') {
      errorMessage = 'Database constraint violation. Please check that all referenced records exist (customer, service, slot, etc.).';
      errorDetails = error.message;
    } else if (error.message?.includes('not null') || error.code === '23502') {
      errorMessage = 'Missing required data. Please ensure all required fields are provided.';
      errorDetails = error.message;
    } else if (error.message?.includes('unique') || error.code === '23505') {
      errorMessage = 'Duplicate entry detected. This booking may already exist.';
      errorDetails = error.message;
    } else if (error.message?.includes('RPC') || error.message?.includes('function')) {
      errorMessage = 'Database function error. Please contact administrator.';
      errorDetails = error.message;
    } else if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      errorMessage = 'Request timeout. The database operation took too long. Please try again.';
      errorDetails = error.message;
    } else if (error.message?.includes('ECONNREFUSED') || error.message?.includes('connection')) {
      errorMessage = 'Database connection error. Please contact administrator.';
      errorDetails = error.message;
    } else {
      // For unknown errors, include details in development
      errorDetails = process.env.NODE_ENV === 'development' ? error.message : undefined;
    }
    
    return sendResponse(500, { 
      error: errorMessage,
      details: errorDetails,
      code: error.code,
      type: error?.constructor?.name || 'Unknown'
    });
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
      booking_group_id, // Optional: group ID to link bookings
      payment_method: reqPaymentMethod, // Optional: 'onsite' or 'transfer'
      transaction_reference: reqTransactionRef
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

    if (reqPaymentMethod === 'transfer' && (!reqTransactionRef || !String(reqTransactionRef).trim())) {
      return res.status(400).json({ error: 'transaction_reference is required when payment method is transfer (حوالة)' });
    }

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(customer_phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Validate visitor_count
    if (visitor_count < 1) {
      return res.status(400).json({
        error: 'visitor_count must be at least 1'
      });
    }

    // Calculate adult/child counts - use provided values or default to visitor_count for adults
    const finalAdultCount = adult_count !== undefined ? adult_count : visitor_count;
    const finalChildCount = child_count !== undefined ? child_count : 0;

    // ============================================================================
    // PACKAGE CAPACITY CHECK - Auto-apply package if capacity exists
    // ============================================================================
    // Note: For bulk bookings, we check capacity per slot (each slot = 1 visitor)
    // Support partial coverage: use package for available capacity, rest is paid
    let packageSubscriptionId: string | null = null;
    let finalTotalPrice = total_price || 0;
    let shouldUsePackage = false;
    let packageCoveredQty = 0;
    let paidQty = visitor_count; // Default: all tickets are paid

    // Look up customer by phone if customer_id not provided
    // CRITICAL: Do NOT use req.user.id - that's a user ID (users table), not customer ID (customers table)
    let customerIdForPackage: string | null = req.body.customer_id || null;
    
    if (!customerIdForPackage && normalizedPhone) {
      const { data: customerData, error: customerLookupError } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', normalizedPhone)
        .eq('tenant_id', tenant_id)
        .maybeSingle();
      
      if (customerLookupError) {
        console.error('[Bulk Booking Creation] ⚠️ Error looking up customer:', customerLookupError);
        customerIdForPackage = null;
      } else if (customerData) {
        customerIdForPackage = customerData.id;
      }
    }
    
    // Validate customer_id exists in customers table
    if (customerIdForPackage) {
      const { data: customerExists } = await supabase
        .from('customers')
        .select('id')
        .eq('id', customerIdForPackage)
        .eq('tenant_id', tenant_id)
        .maybeSingle();
      
      if (!customerExists) {
        console.warn('[Bulk Booking Creation] ⚠️ Customer ID does not exist, setting to NULL');
        customerIdForPackage = null;
      }
    }

    if (customerIdForPackage) {
      try {
        // For bulk bookings, check if we have capacity for at least 1 slot
        // (Each slot in bulk booking = 1 visitor)
        const { data: capacityData, error: capacityError } = await supabase
          .rpc('resolveCustomerServiceCapacity', {
            p_customer_id: customerIdForPackage,
            p_service_id: service_id
          });

        if (!capacityError && capacityData && capacityData.length > 0) {
          const capacityResult = capacityData[0];
          const totalRemaining = capacityResult.total_remaining_capacity || 0;
          const exhaustionStatus = capacityResult.exhaustion_status || [];

          // Cap coverage by chosen subscription's remaining (we deduct from ONE subscription per booking)
          let effectiveRemaining = totalRemaining;
          if (totalRemaining > 0 && exhaustionStatus.length > 0) {
            const availableSubscriptions = exhaustionStatus
              .filter((s: any) => !s.is_exhausted && s.remaining > 0)
              .sort((a: any, b: any) => b.remaining - a.remaining);
            if (availableSubscriptions.length > 0) {
              packageSubscriptionId = availableSubscriptions[0].subscription_id;
              effectiveRemaining = availableSubscriptions[0].remaining;
              if (effectiveRemaining < totalRemaining) {
                console.log(`[Bulk Booking Creation] 📌 Capping coverage by chosen subscription remaining: ${effectiveRemaining} (total across subs was ${totalRemaining})`);
              }
              console.log(`[Bulk Booking Creation] ✅ Using package subscription: ${packageSubscriptionId} (remaining: ${effectiveRemaining})`);
            }
          }

          packageCoveredQty = Math.min(visitor_count, effectiveRemaining);
          paidQty = visitor_count - packageCoveredQty;

          console.log(`[Bulk Booking Creation] Package capacity check:`, {
            requestedQty: visitor_count,
            remainingCapacity: totalRemaining,
            effectiveRemaining,
            packageCoveredQty,
            paidQty
          });

          // If we have any capacity, use it (even if partial)
          if (totalRemaining > 0) {
            shouldUsePackage = true;

            // Calculate price only for paid portion
            if (paidQty > 0) {
              // Get service price for paid tickets
              const { data: serviceData } = await supabase
                .from('services')
                .select('base_price')
                .eq('id', service_id)
                .single();
              
              const servicePrice = serviceData?.base_price || 0;
              finalTotalPrice = paidQty * servicePrice;
              
              console.log(`[Bulk Booking Creation] ⚠️ Partial package coverage: ${packageCoveredQty} free, ${paidQty} paid (${finalTotalPrice})`);
            } else {
              finalTotalPrice = 0; // Fully covered by package
              console.log(`[Bulk Booking Creation] ✅ Full package coverage: ${packageCoveredQty} tickets free`);
              console.log(`[Bulk Booking Creation]    → NO invoice will be created (fully covered by package)`);
            }
            
            // Check if chosen subscription will be exhausted after this booking
            const packageWillBeExhausted = effectiveRemaining <= packageCoveredQty;
            if (packageWillBeExhausted && packageSubscriptionId) {
              console.log(`[Bulk Booking Creation] 🔔 Package will be exhausted after this booking`);
              console.log(`[Bulk Booking Creation]    Subscription: ${packageSubscriptionId}`);
              console.log(`[Bulk Booking Creation]    Remaining before: ${effectiveRemaining}, Using: ${packageCoveredQty}`);
              
              // Create one-time exhaustion notification
              try {
                const { error: notifError } = await supabase
                  .from('package_exhaustion_notifications')
                  .upsert({
                    subscription_id: packageSubscriptionId,
                    service_id: service_id
                    // Note: notified_at is auto-set by DEFAULT now() in the table
                    // Table schema only has: id, subscription_id, service_id, notified_at
                  }, {
                    onConflict: 'subscription_id,service_id',
                    ignoreDuplicates: false
                  });
                
                if (notifError) {
                  console.warn(`[Bulk Booking Creation] ⚠️ Failed to create exhaustion notification:`, notifError);
                } else {
                  console.log(`[Bulk Booking Creation] ✅ Exhaustion notification created`);
                }
              } catch (notifErr: any) {
                console.warn(`[Bulk Booking Creation] ⚠️ Exception creating exhaustion notification:`, notifErr);
                // Don't fail booking if notification fails
              }
            }
          } else {
            // No capacity - full booking is paid
            packageCoveredQty = 0;
            paidQty = visitor_count;
            console.log(`[Bulk Booking Creation] ℹ️ No package capacity - full booking will be paid`);
          }
        }
      } catch (packageError: any) {
        console.error(`[Bulk Booking Creation] ⚠️ Package capacity check failed:`, packageError);
      }
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
    console.log(`[Bulk Booking Creation]    Slots: ${slot_ids.length}, Visitors: ${visitor_count}, Total Price: ${finalTotalPrice}`);
    console.log(`[Bulk Booking Creation]    Coverage: ${packageCoveredQty} package, ${paidQty} paid`);
    
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
        p_total_price: finalTotalPrice, // Use calculated price (only for paid portion)
        p_notes: notes || null,
        p_employee_id: employee_id || null,
        p_session_id: req.user?.id || session_id || null,
        p_customer_id: customerIdForPackage || null,
        p_offer_id: offer_id || null,
        p_language: validLanguage,
        p_booking_group_id: booking_group_id || null,
        p_package_subscription_id: packageSubscriptionId,
        p_package_covered_quantity: packageCoveredQty,
        p_paid_quantity: paidQty
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

    // Store payment_method + transaction_reference when provided (Admin/Receptionist)
    if (bookingIds.length > 0 && (reqPaymentMethod === 'onsite' || reqPaymentMethod === 'transfer')) {
      const refValue = reqPaymentMethod === 'transfer' && reqTransactionRef ? String(reqTransactionRef).trim() : null;
      await supabase
        .from('bookings')
        .update({
          payment_method: reqPaymentMethod,
          transaction_reference: refValue,
          updated_at: new Date().toISOString()
        })
        .in('id', bookingIds);
    }

    // ============================================================================
    // STRICT BILLING RULE: Invoice ONLY when real money is owed
    // ============================================================================
    // CRITICAL: Only create invoice if there's actual money owed
    const shouldCreateBulkInvoice = (normalizedPhone || customer_phone || customer_email) 
      && paidQty > 0 
      && finalTotalPrice > 0;
    
    if (shouldCreateBulkInvoice) {
      Promise.resolve().then(async () => {
        try {
          console.log(`[Bulk Booking Creation] 🧾 Generating ONE invoice for booking group ${bookingGroupId}...`);
          console.log(`[Bulk Booking Creation]    Paid quantity: ${paidQty} (must be > 0)`);
          console.log(`[Bulk Booking Creation]    Total price: ${finalTotalPrice} (must be > 0)`);
          console.log(`[Bulk Booking Creation]    Package covered: ${packageCoveredQty}`);
          console.log(`[Bulk Booking Creation]    → Proceeding with invoice creation`);
          
          const { zohoService } = await import('../services/zohoService.js');
          
          // Generate invoice for the booking group (uses first booking ID as reference)
          // The generateReceiptForBookingGroup function will check paid_quantity internally
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
    } else {
      // Log why invoice was not created
      const reasons: string[] = [];
      if (!normalizedPhone && !customer_phone && !customer_email) {
        reasons.push('no customer contact (email/phone)');
      }
      if (paidQty <= 0) {
        reasons.push(`fully covered by package (paidQty = ${paidQty})`);
      }
      if (finalTotalPrice <= 0) {
        reasons.push(`total price is 0 (price = ${finalTotalPrice})`);
      }
      
      console.log(`[Bulk Booking Creation] ⚠️ Invoice NOT created - ${reasons.join(', ')}`);
      console.log(`[Bulk Booking Creation]    This is CORRECT behavior for package-covered bookings`);
      console.log(`[Bulk Booking Creation]    Bookings were created successfully (ticket rule: always create bookings)`);
      console.log(`[Bulk Booking Creation]    Package coverage: ${packageCoveredQty} tickets, Paid: ${paidQty} tickets`);
    }

    // Check if tickets are enabled for this tenant
    const { data: tenantSettings } = await supabase
      .from('tenants')
      .select('tickets_enabled')
      .eq('id', tenant_id)
      .single();
    
    const ticketsEnabled = tenantSettings?.tickets_enabled !== false; // Default to true if not set
    
    // Generate ONE ticket PDF with multiple QR codes (one per slot) - asynchronously
    Promise.resolve().then(async () => {
      // Early return if tickets are disabled
      if (!ticketsEnabled) {
        console.log(`[Bulk Booking Creation] 🎫 Tickets are disabled for this tenant. Skipping ticket generation.`);
        return;
      }
      
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

    // Check user role - Allow cashiers, receptionists, and tenant admins to scan QR codes
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, tenant_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Allow cashiers, receptionists, tenant admins, and admins to scan QR codes
    const allowedRoles = ['cashier', 'receptionist', 'tenant_admin', 'admin_user'];
    if (!allowedRoles.includes(userData.role)) {
      return res.status(403).json({
        error: 'Access denied. Only cashiers, receptionists, tenant admins, and admins can scan QR codes.',
        userRole: userData.role,
        hint: 'You must be logged in as a cashier, receptionist, tenant admin, or admin to scan QR codes.'
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
      return booking.visitor_count > 1 ? `${booking.visitor_count} Tickets` : '1 Ticket';
    };

    // SECURITY: Public endpoint returns ticket details only, NO status or payment info
    // Explicitly construct object to ensure no status fields leak through
    const bookingData: {
      id: string;
      customer_name: string;
      customer_phone: string;
      customer_email?: string | null;
      visitor_count: number;
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
// Update booking details (Service Provider only). Coordinator can only set status to 'confirmed'.
// ============================================================================
router.patch('/:id', authenticateReceptionistOrCoordinatorForPatch, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;
    const updateData = req.body;
    const isCoordinator = req.user!.role === 'coordinator';

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
    // Receptionist and tenant_admin can edit all booking fields including rescheduling (slot_id)
    const allowedFields = [
      'customer_name',
      'customer_phone',
      'customer_email',
      'visitor_count',
      'total_price',
      'status',
      'notes',
      'employee_id',
      'slot_id', // Receptionists and tenant admins can reschedule bookings
    ];

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

    // Validate visitor_count if provided
    if (updatePayload.visitor_count !== undefined) {
      if (updatePayload.visitor_count < 1) {
        return res.status(400).json({ error: 'visitor_count must be at least 1' });
      }
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

          // Check if tickets are enabled for this tenant
          const { data: tenantSettings } = await supabase
            .from('tenants')
            .select('tickets_enabled')
            .eq('id', tenantId)
            .single();
          
          const ticketsEnabled = tenantSettings?.tickets_enabled !== false; // Default to true if not set
          
          if (!ticketsEnabled) {
            console.log(`📄 Tickets are disabled for this tenant. Skipping ticket regeneration for rescheduled booking.`);
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
// Edit Booking Time (Receptionist and Tenant Provider - Atomic Transaction)
// ============================================================================
// Receptionists and tenant admins can edit booking time
// This endpoint uses the atomic edit_booking_time function which:
// 1. Validates new slot availability
// 2. Releases old slot capacity
// 3. Reserves new slot capacity
// 4. Invalidates old tickets (marks qr_scanned=true, clears qr_token)
// 5. Updates booking with new slot
// 6. All in one atomic transaction
// ============================================================================
router.patch('/:id/time', authenticateReceptionistOrTenantAdmin, async (req, res) => {
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

    // Parse JSONB response - handle all possible formats
    let editData: any = editResult;
    if (typeof editResult === 'string') {
      try {
        editData = JSON.parse(editResult);
        console.log(`[Booking Time Edit] ✅ Parsed JSONB string response`);
      } catch (e) {
        console.error(`[Booking Time Edit] ⚠️ Failed to parse JSONB string:`, e);
        editData = editResult;
      }
    } else if (typeof editResult === 'object' && editResult !== null) {
      // Check if response is wrapped (e.g., { data: { success: true, ... } })
      if (editResult.data && typeof editResult.data === 'object') {
        editData = editResult.data;
        console.log(`[Booking Time Edit] ✅ Extracted data from wrapped response`);
      } else {
        editData = editResult;
        console.log(`[Booking Time Edit] ✅ Response is already an object`);
      }
    }

    // Verify success - check multiple possible locations
    const isSuccess = editData?.success === true || 
                      editData?.data?.success === true || 
                      (editResult && typeof editResult === 'object' && 'success' in editResult && editResult.success === true);

    if (!isSuccess) {
      console.error(`[Booking Time Edit] ❌ RPC did not return success:`, {
        editResult,
        editData,
        hasSuccess: !!editData?.success,
        message: editData?.message || 'Unknown error'
      });
      return res.status(500).json({ 
        error: 'Failed to edit booking time',
        details: editData?.message || editResult?.message || 'Unknown error'
      });
    }

    console.log(`[Booking Time Edit] ✅ Success:`, editData);
    console.log(`[Booking Time Edit]    RPC returned success: ${isSuccess}`);
    console.log(`[Booking Time Edit]    Edit data:`, JSON.stringify(editData, null, 2));

    // Get updated booking details (CRITICAL: Must be available for ticket generation)
    // CRITICAL: Always fetch booking data - ticket generation MUST happen for all successful time edits
    console.log(`\n[Booking Time Edit] ========================================`);
    console.log(`[Booking Time Edit] 🔍 STEP: Fetching updated booking data for ticket generation...`);
    console.log(`[Booking Time Edit]    Booking ID: ${bookingId}`);
    console.log(`[Booking Time Edit]    Tenant ID: ${tenantId}`);
    console.log(`[Booking Time Edit]    User Role: ${req.user?.role || 'N/A'}`);
    console.log(`[Booking Time Edit] ========================================\n`);
    
    let updatedBooking: any = null;
    let fetchError: any = null;
    
    // Try to fetch booking with retries if needed
    for (let retry = 0; retry < 3; retry++) {
      console.log(`[Booking Time Edit] 🔍 Fetch attempt ${retry + 1}/3 for booking ${bookingId}...`);
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          services:service_id (name, name_ar),
          slots:slot_id (slot_date, start_time, end_time),
          tenants:tenant_id (name, name_ar)
        `)
        .eq('id', bookingId)
        .single();
      
      if (!error && data) {
        updatedBooking = data;
        fetchError = null;
        console.log(`[Booking Time Edit] ✅ Fetch attempt ${retry + 1} succeeded!`);
        break;
      } else {
        fetchError = error;
        console.error(`[Booking Time Edit] ❌ Fetch attempt ${retry + 1} failed:`, error);
        if (retry < 2) {
          console.log(`[Booking Time Edit] ⚠️ Retry ${retry + 1}/3: Waiting 500ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    if (fetchError || !updatedBooking) {
      console.error(`\n[Booking Time Edit] ========================================`);
      console.error(`[Booking Time Edit] ❌ CRITICAL: Could not fetch updated booking after 3 retries`);
      console.error(`[Booking Time Edit]    Booking ID: ${bookingId}`);
      console.error(`[Booking Time Edit]    Error:`, fetchError);
      console.error(`[Booking Time Edit]    This will prevent ticket generation!`);
      console.error(`[Booking Time Edit] ========================================\n`);
      // Don't skip ticket generation - try with bookingId only if needed
    } else {
      console.log(`\n[Booking Time Edit] ========================================`);
      console.log(`[Booking Time Edit] ✅ SUCCESS: Fetched updated booking for ticket generation`);
      console.log(`[Booking Time Edit]    Booking ID: ${updatedBooking.id}`);
      console.log(`[Booking Time Edit]    Customer: ${updatedBooking.customer_name || 'N/A'}`);
      console.log(`[Booking Time Edit]    Email: ${updatedBooking.customer_email || 'N/A'}`);
      console.log(`[Booking Time Edit]    Phone: ${updatedBooking.customer_phone || 'N/A'}`);
      console.log(`[Booking Time Edit]    Has Services: ${!!updatedBooking.services}`);
      console.log(`[Booking Time Edit]    Has Slots: ${!!updatedBooking.slots}`);
      console.log(`[Booking Time Edit]    Has Tenants: ${!!updatedBooking.tenants}`);
      console.log(`[Booking Time Edit]    Slot Date: ${updatedBooking.slots?.slot_date || 'N/A'}`);
      console.log(`[Booking Time Edit]    Start Time: ${updatedBooking.slots?.start_time || 'N/A'}`);
      console.log(`[Booking Time Edit] ========================================\n`);
      
      // CRITICAL: Verify we have contact info
      if (!updatedBooking.customer_email && !updatedBooking.customer_phone) {
        console.error(`[Booking Time Edit] ⚠️ WARNING: No customer email or phone - tickets cannot be sent!`);
      }
    }

    // Generate new ticket and send to customer
    // IMPORTANT: Generate PDF synchronously to ensure it completes (same pattern as booking creation)
    // This prevents Railway container restarts from killing the process
    // The actual sending (WhatsApp/Email) can be async
    // CRITICAL: Always attempt ticket generation if booking time was successfully updated
    // If booking fetch failed, try one more time or use minimal data
    if (!updatedBooking) {
      console.error(`\n[Booking Time Edit] ========================================`);
      console.error(`[Booking Time Edit] ❌ CRITICAL: Cannot generate ticket - updated booking not available`);
      console.error(`[Booking Time Edit]    Booking ID: ${bookingId}`);
      console.error(`[Booking Time Edit]    Tenant ID: ${tenantId}`);
      console.error(`[Booking Time Edit]    User Role: ${req.user?.role || 'N/A'}`);
      console.error(`[Booking Time Edit]    Attempting one final fetch before skipping...`);
      console.error(`[Booking Time Edit] ========================================\n`);
      
      // Try one more time to fetch the booking with a longer delay
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for DB to update
      
      const { data: finalBooking, error: finalError } = await supabase
        .from('bookings')
        .select(`
          *,
          services:service_id (name, name_ar),
          slots:slot_id (slot_date, start_time, end_time),
          tenants:tenant_id (name, name_ar)
        `)
        .eq('id', bookingId)
        .single();
      
      if (finalError || !finalBooking) {
        console.error(`\n[Booking Time Edit] ========================================`);
        console.error(`[Booking Time Edit] ❌ FINAL FETCH FAILED:`, finalError);
        console.error(`[Booking Time Edit]    Booking ID: ${bookingId}`);
        console.error(`[Booking Time Edit]    Error Code: ${finalError?.code || 'N/A'}`);
        console.error(`[Booking Time Edit]    Error Message: ${finalError?.message || 'N/A'}`);
        console.error(`[Booking Time Edit]    Ticket generation will be skipped - booking data unavailable`);
        console.error(`[Booking Time Edit]    This is a CRITICAL ERROR - tickets will NOT be sent to customer`);
        console.error(`[Booking Time Edit] ========================================\n`);
      } else {
        console.log(`\n[Booking Time Edit] ========================================`);
        console.log(`[Booking Time Edit] ✅ FINAL FETCH SUCCEEDED - proceeding with ticket generation`);
        console.log(`[Booking Time Edit]    Booking ID: ${finalBooking.id}`);
        console.log(`[Booking Time Edit]    Customer: ${finalBooking.customer_name || 'N/A'}`);
        console.log(`[Booking Time Edit] ========================================\n`);
        updatedBooking = finalBooking;
      }
    }
    
    // Track if tickets were actually sent
    let ticketsSent = false;
    let ticketGenerationError: any = null;
    let whatsappSentResult = false;
    let emailSentResult = false;
    
    // CRITICAL: Only proceed if we have booking data
    // Log clearly whether we're proceeding with ticket generation
    console.log(`\n[Booking Time Edit] ========================================`);
    console.log(`[Booking Time Edit] 🎯 TICKET GENERATION DECISION`);
    console.log(`[Booking Time Edit]    Has Updated Booking: ${!!updatedBooking}`);
    console.log(`[Booking Time Edit]    Booking ID: ${bookingId}`);
    console.log(`[Booking Time Edit]    Will Generate Tickets: ${!!updatedBooking ? 'YES' : 'NO'}`);
    console.log(`[Booking Time Edit] ========================================\n`);
    
    // Check if tickets are enabled for this tenant
    const { data: tenantSettings } = await supabase
      .from('tenants')
      .select('tickets_enabled')
      .eq('id', tenantId)
      .single();
    
    const ticketsEnabled = tenantSettings?.tickets_enabled !== false; // Default to true if not set
    
    if (updatedBooking) {
      console.log(`\n🎫 ========================================`);
      console.log(`🎫 TICKET REGENERATION CHECK for booking ${bookingId} (time edit)`);
      console.log(`🎫 Tickets Enabled: ${ticketsEnabled}`);
      console.log(`🎫 Customer: ${updatedBooking.customer_name || 'N/A'}`);
      console.log(`🎫 Email: ${updatedBooking.customer_email || 'NOT PROVIDED'}`);
      console.log(`🎫 Phone: ${updatedBooking.customer_phone || 'NOT PROVIDED'}`);
      console.log(`🎫 User Role: ${req.user?.role || 'N/A'}`);
      console.log(`🎫 Tenant ID: ${tenantId}`);
      console.log(`🎫 Booking ID: ${bookingId}`);
      console.log(`🎫 ========================================\n`);
      
      // Store booking data for async context
      const bookingForTicket = updatedBooking;
      
      // Generate PDF synchronously (before response) to ensure it completes
      // Same pattern as booking creation - prevents Railway from killing the process
      // CRITICAL: This promise will be awaited before sending the response
      // CRITICAL: Store tenantId in closure to ensure it's available in async context
      const ticketGenerationPromise = (async () => {
        // Early return if tickets are disabled
        if (!ticketsEnabled) {
          console.log(`[Booking Time Edit] 🎫 Tickets are disabled for this tenant. Skipping ticket regeneration.`);
          return;
        }
        let pdfBuffer: Buffer | null = null;
        
        // Store tenantId in closure for async context
        const tenantIdForTicket = tenantId;
        const userIdForTicket = userId;
        
        // Local variables to track send results (will update outer scope at end)
        let localWhatsappSent = false;
        let localEmailSent = false;
        
        try {
          console.log(`[Booking Time Edit] 🎫 Starting ticket regeneration...`);
          console.log(`[Booking Time Edit]    Tenant ID: ${tenantIdForTicket}`);
          console.log(`[Booking Time Edit]    User ID: ${userIdForTicket}`);
          console.log(`[Booking Time Edit]    User Role: ${req.user?.role || 'N/A'}`);
          
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
          
          // CRITICAL: Wait a moment for database to fully commit the booking update
          // This prevents "Booking not found" errors when PDF service tries to fetch the booking
          console.log(`[Booking Time Edit] ⏳ Waiting 1 second for database to commit booking update...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          console.log(`[Booking Time Edit] ✅ Proceeding with PDF generation...`);
          
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
          // CRITICAL: This must work for all roles (customer_admin, admin_user, etc.)
          // We're querying the database directly, not through the restricted API endpoint
          console.log(`[Booking Time Edit] 📱 Step 2a: Fetching WhatsApp configuration...`);
          console.log(`[Booking Time Edit]    Tenant ID: ${tenantId}`);
          console.log(`[Booking Time Edit]    User Role: ${req.user?.role || 'N/A'}`);
          
          let whatsappConfig: any = null;
          try {
            const { data: tenantData, error: tenantError } = await supabase
              .from('tenants')
              .select('whatsapp_settings')
              .eq('id', tenantIdForTicket)
              .single();

            if (tenantError) {
              console.error(`[Booking Time Edit] ❌ Error fetching WhatsApp settings:`, tenantError);
              console.error(`[Booking Time Edit]    Error code: ${tenantError.code || 'N/A'}`);
              console.error(`[Booking Time Edit]    Error message: ${tenantError.message}`);
              console.error(`[Booking Time Edit]    Error details:`, tenantError);
            } else if (!tenantData) {
              console.error(`[Booking Time Edit] ❌ Tenant not found for ID: ${tenantIdForTicket}`);
            } else if (!tenantData.whatsapp_settings) {
              console.log(`[Booking Time Edit] ⚠️ No WhatsApp settings configured for tenant ${tenantIdForTicket}`);
              console.log(`[Booking Time Edit]    WhatsApp sending will fail - configure in tenant settings page`);
            } else {
              const settings = tenantData.whatsapp_settings;
              
              // Handle both object and string formats
              let parsedSettings = settings;
              if (typeof settings === 'string') {
                try {
                  parsedSettings = JSON.parse(settings);
                } catch (e) {
                  console.error(`[Booking Time Edit] ❌ Failed to parse WhatsApp settings JSON:`, e);
                  parsedSettings = settings;
                }
              }
              
              whatsappConfig = {
                provider: parsedSettings.provider,
                apiUrl: parsedSettings.api_url,
                apiKey: parsedSettings.api_key,
                phoneNumberId: parsedSettings.phone_number_id,
                accessToken: parsedSettings.access_token,
                accountSid: parsedSettings.account_sid,
                authToken: parsedSettings.auth_token,
                from: parsedSettings.from,
              };
              
              console.log(`[Booking Time Edit]    ✅ WhatsApp config loaded successfully`);
              console.log(`[Booking Time Edit]    Provider: ${whatsappConfig.provider || 'not set'}`);
              console.log(`[Booking Time Edit]    Has API URL: ${!!whatsappConfig.apiUrl}`);
              console.log(`[Booking Time Edit]    Has API Key: ${!!whatsappConfig.apiKey}`);
              console.log(`[Booking Time Edit]    Has Phone Number ID: ${!!whatsappConfig.phoneNumberId}`);
              console.log(`[Booking Time Edit]    Has Access Token: ${!!whatsappConfig.accessToken}`);
              console.log(`[Booking Time Edit]    Has Account SID: ${!!whatsappConfig.accountSid}`);
              console.log(`[Booking Time Edit]    Has Auth Token: ${!!whatsappConfig.authToken}`);
            }
          } catch (configError: any) {
            console.error(`[Booking Time Edit] ❌ Exception while fetching WhatsApp config:`, configError);
            console.error(`[Booking Time Edit]    Error message: ${configError.message}`);
            console.error(`[Booking Time Edit]    Error stack: ${configError.stack}`);
            // Continue - don't fail ticket generation if config fetch fails
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
                  localWhatsappSent = true;
                  console.log(`[Booking Time Edit] ✅ Step 2 Complete: Ticket sent via WhatsApp to ${normalizedPhone}`);
                } else {
                  localWhatsappSent = false;
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
                tenantIdForTicket,
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
                localEmailSent = true;
                console.log(`[Booking Time Edit] ✅ Step 3 Complete: Ticket sent via Email to ${customerEmail}`);
                console.log(`[Booking Time Edit]    Email delivery confirmed: SUCCESS`);
                console.log(`[Booking Time Edit]    Customer should receive email with updated ticket PDF`);
              } else {
                localEmailSent = false;
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

          // Track if tickets were actually sent (will be set by send results)
          // These variables are declared in outer scope and will be updated by send operations
          
          // Update outer scope variables
          whatsappSentResult = localWhatsappSent;
          emailSentResult = localEmailSent;
          ticketsSent = localWhatsappSent || localEmailSent;
          
          console.log(`\n✅ ========================================`);
          console.log(`✅ TICKET REGENERATION COMPLETE for booking ${bookingId}`);
          console.log(`✅ PDF: Generated (${pdfBuffer?.length || 0} bytes)`);
          console.log(`✅ WhatsApp: ${localWhatsappSent ? 'Sent Successfully' : (booking?.customer_phone ? 'Failed or Skipped' : 'Skipped (no phone)')}`);
          console.log(`✅ Email: ${localEmailSent ? 'Sent Successfully' : (booking?.customer_email ? 'Failed or Skipped' : 'Skipped (no email)')}`);
          console.log(`✅ Tickets Sent: ${ticketsSent ? 'YES' : 'NO'}`);
          console.log(`✅ ========================================\n`);
        } catch (ticketError: any) {
          ticketGenerationError = ticketError;
          ticketsSent = false;
          console.error(`\n❌ ========================================`);
          console.error(`❌ TICKET REGENERATION FAILED for booking ${bookingId}`);
          console.error(`❌ Error:`, ticketError.message);
          console.error(`❌ Stack:`, ticketError.stack);
          console.error(`❌ User Role: ${req.user?.role || 'N/A'}`);
          console.error(`❌ Tenant ID: ${tenantId}`);
          console.error(`❌ Booking ID: ${bookingId}`);
          console.error(`❌ This is non-blocking - booking time was updated successfully`);
          console.error(`❌ ========================================\n`);
          // Don't fail the booking update if ticket generation fails
        }
      })();

      // Wait for PDF generation and sending to complete before sending response
      // This ensures tickets are sent even if Railway container restarts
      // CRITICAL: This prevents Railway from killing the process before tickets are sent
      // Same pattern as booking creation
      console.log(`[Booking Time Edit] ⏳ Waiting for ticket generation promise to complete...`);
      try {
        await ticketGenerationPromise;
        console.log(`[Booking Time Edit] ✅ Ticket generation promise completed`);
        if (ticketsSent) {
          console.log(`[Booking Time Edit] ✅✅✅ Ticket generation and sending completed SUCCESSFULLY for booking ${bookingId}`);
          console.log(`[Booking Time Edit]    WhatsApp Sent: ${whatsappSentResult}`);
          console.log(`[Booking Time Edit]    Email Sent: ${emailSentResult}`);
        } else {
          console.warn(`\n[Booking Time Edit] ========================================`);
          console.warn(`[Booking Time Edit] ⚠️⚠️⚠️ Ticket generation completed but NO TICKETS WERE SENT`);
          console.warn(`[Booking Time Edit]    Booking ID: ${bookingId}`);
          console.warn(`[Booking Time Edit]    WhatsApp Sent: ${whatsappSentResult}`);
          console.warn(`[Booking Time Edit]    Email Sent: ${emailSentResult}`);
          console.warn(`[Booking Time Edit]    This may be due to:`);
          console.warn(`[Booking Time Edit]      - Missing customer contact info (email/phone)`);
          console.warn(`[Booking Time Edit]      - WhatsApp/Email sending failures`);
          console.warn(`[Booking Time Edit]      - Missing WhatsApp/Email configuration`);
          console.warn(`[Booking Time Edit] ========================================\n`);
        }
      } catch (error: any) {
        ticketGenerationError = error;
        ticketsSent = false;
        console.error(`\n[Booking Time Edit] ========================================`);
        console.error(`[Booking Time Edit] ❌❌❌ TICKET GENERATION PROMISE FAILED`);
        console.error(`[Booking Time Edit]    Booking ID: ${bookingId}`);
        console.error(`[Booking Time Edit]    Error:`, error.message);
        console.error(`[Booking Time Edit]    Stack:`, error.stack);
        console.error(`[Booking Time Edit]    Tenant ID: ${tenantId}`);
        console.error(`[Booking Time Edit]    User Role: ${req.user?.role}`);
        console.error(`[Booking Time Edit] ========================================\n`);
        // Don't fail booking update if ticket generation fails - booking time was already updated
        // The error was already logged in the inner try-catch
      }
    } else {
      console.error(`[Booking Time Edit] ❌ SKIPPING TICKET GENERATION - No booking data available`);
      console.error(`[Booking Time Edit]    Booking ID: ${bookingId}`);
      console.error(`[Booking Time Edit]    Tenant ID: ${tenantId}`);
      console.error(`[Booking Time Edit]    User Role: ${req.user?.role || 'N/A'}`);
      console.error(`[Booking Time Edit]    This means tickets will NOT be sent to the customer!`);
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

    // Return success response with accurate ticket status
    console.log(`\n[Booking Time Edit] ========================================`);
    console.log(`[Booking Time Edit] 📤 PREPARING RESPONSE`);
    console.log(`[Booking Time Edit]    Booking ID: ${bookingId}`);
    console.log(`[Booking Time Edit]    Has Updated Booking: ${!!updatedBooking}`);
    console.log(`[Booking Time Edit]    Tickets Sent: ${ticketsSent}`);
    console.log(`[Booking Time Edit]    WhatsApp Sent: ${whatsappSentResult}`);
    console.log(`[Booking Time Edit]    Email Sent: ${emailSentResult}`);
    console.log(`[Booking Time Edit]    Ticket Error: ${ticketGenerationError ? ticketGenerationError.message : 'None'}`);
    console.log(`[Booking Time Edit] ========================================\n`);
    
    const ticketMessage = ticketsSent 
      ? 'Booking time updated successfully. Old tickets invalidated. New ticket has been sent to customer.'
      : updatedBooking
        ? 'Booking time updated successfully. Old tickets invalidated. New ticket generation attempted but may not have been sent (check logs for details).'
        : 'Booking time updated successfully. Old tickets invalidated. New ticket could not be generated (booking data unavailable).';
    
    res.json({
      success: true,
      booking: updatedBooking,
      edit_result: editData,
      message: ticketMessage,
      tickets_invalidated: true,
      new_ticket_generated: !!updatedBooking,
      tickets_sent: ticketsSent,
      whatsapp_sent: whatsappSentResult,
      email_sent: emailSentResult,
      ticket_error: ticketGenerationError ? ticketGenerationError.message : null
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
    const { payment_status, payment_method, transaction_reference } = req.body;
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;

    if (!payment_status) {
      return res.status(400).json({ error: 'payment_status is required' });
    }

    // Normalize: only allow Unpaid, Paid On Site, Bank Transfer (stored as unpaid | paid | paid_manual + payment_method)
    const normalized = payment_status === 'awaiting_payment' || payment_status === 'refunded' ? 'unpaid' : payment_status;
    const validStatuses = ['unpaid', 'paid', 'paid_manual'];
    if (!validStatuses.includes(normalized)) {
      return res.status(400).json({
        error: `Invalid payment_status. Allowed: unpaid, paid, paid_manual (display: Unpaid, Paid On Site, Bank Transfer).`
      });
    }
    const payment_statusToUse = normalized;

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

    const isBecomingPaid = (payment_status === 'paid' || payment_status === 'paid_manual') && oldStatus !== 'paid' && oldStatus !== 'paid_manual';
    const payMethod = payment_method === 'transfer' ? 'transfer' : (payment_method === 'onsite' ? 'onsite' : (currentBooking as any).payment_method || 'onsite');
    const refNum = (transaction_reference && String(transaction_reference).trim()) || '';

    if (isBecomingPaid && payMethod === 'transfer' && !refNum) {
      return res.status(400).json({ error: 'transaction_reference is required when payment method is transfer (حوالة)' });
    }

    const updatePayload: Record<string, any> = {
      payment_status,
      updated_at: new Date().toISOString(),
    };
    if (isBecomingPaid) {
      updatePayload.payment_method = payMethod;
      updatePayload.transaction_reference = payMethod === 'transfer' ? refNum : null;
    }

    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    await logBookingChange(
      'payment_status_update',
      bookingId,
      tenantId,
      userId,
      { payment_status: oldStatus },
      { payment_status, payment_method: payMethod, transaction_reference: refNum || undefined },
      req.ip,
      req.get('user-agent')
    );

    let zohoSyncResult: { success: boolean; error?: string; paymentId?: string } | null = null;
    let invoiceSendWarning: string | undefined;
    let invoiceId = currentBooking.zoho_invoice_id;
    const totalPrice = Number((updatedBooking || currentBooking).total_price) || 0;
    const phone = (updatedBooking || currentBooking).customer_phone || '';

    // If marking paid but no invoice yet (e.g. created as unpaid), create invoice first then record payment and send
    if (isBecomingPaid && !invoiceId && totalPrice > 0) {
      try {
        const { zohoService } = await import('../services/zohoService.js');
        const invoiceResult = await zohoService.generateReceipt(bookingId);
        if (invoiceResult.success && invoiceResult.invoiceId) {
          invoiceId = invoiceResult.invoiceId;
          const { data: refetch } = await supabase.from('bookings').select('zoho_invoice_id').eq('id', bookingId).single();
          if (refetch?.zoho_invoice_id) invoiceId = refetch.zoho_invoice_id;
        }
      } catch (e: any) {
        logger.error('Create invoice on mark paid failed (non-blocking)', { bookingId, error: e?.message });
      }
    }

    if (isBecomingPaid && invoiceId && totalPrice > 0) {
      const { zohoService } = await import('../services/zohoService.js');
      const paymentMode = payMethod === 'transfer' ? 'banktransfer' as const : 'cash' as const;
      const referenceNumber = payMethod === 'transfer' ? refNum : 'Paid On Site';

      try {
        const recordResult = await zohoService.recordCustomerPayment(
          tenantId,
          invoiceId,
          totalPrice,
          paymentMode,
          referenceNumber
        );
        zohoSyncResult = { success: recordResult.success, error: recordResult.error, paymentId: recordResult.paymentId };

        await supabase
          .from('bookings')
          .update({
            zoho_payment_id: recordResult.paymentId || null,
            zoho_sync_status: recordResult.success ? 'synced' : 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', bookingId);

        if (!recordResult.success) {
          logger.error('Zoho record payment failed (non-blocking)', { bookingId, error: recordResult.error });
        }
      } catch (e: any) {
        zohoSyncResult = { success: false, error: e?.message || 'Zoho payment record failed' };
        await supabase
          .from('bookings')
          .update({ zoho_sync_status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', bookingId);
      }

      if (phone && phone.trim()) {
        try {
          const invoiceMessage = payMethod === 'transfer'
            ? `Your booking invoice is attached. Transfer Reference: ${refNum}. Thank you for your booking!`
            : 'Your booking invoice is attached. Payment Method: Paid On Site. Thank you for your booking!';
          await zohoService.sendInvoiceViaWhatsApp(tenantId, invoiceId, phone.trim(), invoiceMessage);
        } catch (waErr: any) {
          logger.error('Send invoice via WhatsApp failed (non-blocking)', { bookingId, error: waErr?.message });
          if (waErr?.message?.includes('payment has not been completed')) {
            invoiceSendWarning = 'Invoice cannot be sent because payment has not been completed.';
          }
        }
      }
    } else if (invoiceId && !isBecomingPaid && (payment_status === 'paid' || payment_status === 'paid_manual')) {
      try {
        const { zohoService } = await import('../services/zohoService.js');
        zohoSyncResult = await zohoService.updateInvoiceStatus(tenantId, invoiceId, payment_status);
      } catch (zohoError: any) {
        zohoSyncResult = { success: false, error: zohoError.message };
      }
    }

    const responsePayload: Record<string, unknown> = {
      success: true,
      booking: updatedBooking,
      zoho_sync: zohoSyncResult || { success: false, error: invoiceId ? undefined : 'No invoice to sync' },
      message: payment_status === 'paid' || payment_status === 'paid_manual'
        ? 'Payment status updated. Invoice sent via WhatsApp when applicable.'
        : 'Payment status updated',
    };
    if (invoiceSendWarning) responsePayload.invoice_send_warning = invoiceSendWarning;
    res.json(responsePayload);
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Update payment status error', error, context, {
      booking_id: req.params.id,
      payment_status: req.body.payment_status,
    });
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Cashier/Receptionist: Mark booking as paid (only if currently unpaid). Records Zoho payment and sends invoice via WhatsApp.
router.patch('/:id/mark-paid', authenticateCashierOnly, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { payment_method, transaction_reference } = req.body;
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;

    const { data: currentBooking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !currentBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (currentBooking.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Access denied. This booking belongs to a different tenant.' });
    }

    const normalizedCurrent = normalizePaymentStatusForTransition(currentBooking.payment_status || '');
    if (normalizedCurrent !== 'unpaid') {
      return res.status(400).json({
        error: `Cannot mark as paid. Current payment status is: ${currentBooking.payment_status}. Cashiers can only mark unpaid bookings as paid.`
      });
    }

    const payMethod = payment_method === 'transfer' ? 'transfer' : (payment_method === 'onsite' ? 'onsite' : 'onsite');
    const refNum = (transaction_reference && String(transaction_reference).trim()) || '';
    if (payMethod === 'transfer' && !refNum) {
      return res.status(400).json({ error: 'transaction_reference is required when payment method is transfer (حوالة)' });
    }

    const updatePayload: Record<string, any> = {
      payment_status: 'paid_manual',
      payment_method: payMethod,
      transaction_reference: payMethod === 'transfer' ? refNum : null,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) throw updateError;

    await logBookingChange(
      'payment_status_update',
      bookingId,
      tenantId,
      userId,
      { payment_status: currentBooking.payment_status },
      { payment_status: 'paid_manual', payment_method: payMethod, transaction_reference: refNum || undefined },
      req.ip,
      req.get('user-agent')
    );

    let invoiceSendWarning: string | undefined;
    let invoiceId = currentBooking.zoho_invoice_id;
    const totalPrice = Number(updatedBooking?.total_price || currentBooking.total_price) || 0;
    const phone = (updatedBooking?.customer_phone || currentBooking.customer_phone || '').trim();

    // If no invoice yet (e.g. booking was created as unpaid), create invoice first then record payment and send
    if (!invoiceId && totalPrice > 0) {
      try {
        const { zohoService } = await import('../services/zohoService.js');
        const invoiceResult = await zohoService.generateReceipt(bookingId);
        if (invoiceResult.success && invoiceResult.invoiceId) {
          invoiceId = invoiceResult.invoiceId;
          const { data: refetch } = await supabase.from('bookings').select('zoho_invoice_id').eq('id', bookingId).single();
          if (refetch?.zoho_invoice_id) invoiceId = refetch.zoho_invoice_id;
        }
      } catch (e: any) {
        logger.error('[Mark Paid] Create invoice failed (non-blocking)', { bookingId, error: e?.message });
      }
    }

    if (invoiceId && totalPrice > 0) {
      const { zohoService } = await import('../services/zohoService.js');
      const paymentMode = payMethod === 'transfer' ? 'banktransfer' as const : 'cash' as const;
      const referenceNumber = payMethod === 'transfer' ? refNum : 'Paid On Site';

      try {
        const recordResult = await zohoService.recordCustomerPayment(
          tenantId,
          invoiceId,
          totalPrice,
          paymentMode,
          referenceNumber
        );
        await supabase
          .from('bookings')
          .update({
            zoho_payment_id: recordResult.paymentId || null,
            zoho_sync_status: recordResult.success ? 'synced' : 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', bookingId);

        if (!recordResult.success) {
          logger.error('[Mark Paid] Zoho record payment failed (non-blocking)', { bookingId, error: recordResult.error });
        }
      } catch (e: any) {
        await supabase
          .from('bookings')
          .update({ zoho_sync_status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', bookingId);
        logger.error('[Mark Paid] Zoho payment error (non-blocking):', e?.message);
      }

      if (phone) {
        try {
          const invoiceMessage = payMethod === 'transfer'
            ? `Your booking invoice is attached. Transfer Reference: ${refNum}. Thank you for your booking!`
            : 'Your booking invoice is attached. Payment Method: Paid On Site. Thank you for your booking!';
          await zohoService.sendInvoiceViaWhatsApp(tenantId, invoiceId, phone, invoiceMessage);
        } catch (waErr: any) {
          logger.error('[Mark Paid] Send invoice via WhatsApp failed (non-blocking):', waErr?.message);
          if (waErr?.message?.includes('payment has not been completed')) {
            invoiceSendWarning = 'Invoice cannot be sent because payment has not been completed.';
          }
        }
      }
    }

    const markPaidPayload: Record<string, unknown> = {
      success: true,
      message: 'Booking marked as paid. Invoice sent via WhatsApp when applicable.',
      booking: updatedBooking,
    };
    if (invoiceSendWarning) markPaidPayload.invoice_send_warning = invoiceSendWarning;
    res.json(markPaidPayload);
  } catch (error: any) {
    logger.error('Mark paid error:', error);
    res.status(500).json({ error: error.message || 'Failed to mark booking as paid' });
  }
});

// ============================================================================
// Customer search by phone (for Add Booking / Add Subscription dropdown)
// ============================================================================
// Used when Admin/Receptionist types phone: show matching customers (1–10 only).
// Query: LIKE '%digits%' LIMIT 11; if results.length > 10 we do not show dropdown.
router.get('/customer-search', authenticateReceptionistOrTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ error: 'No tenant associated' });
    }
    const phoneParam = (req.query.phone as string) || '';
    const digits = phoneParam.replace(/\D/g, '');
    if (digits.length < 5) {
      return res.status(400).json({
        error: 'Phone fragment too short',
        hint: 'Provide at least 5 digits to search customers',
      });
    }
    const pattern = `%${digits}%`;
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, phone, email')
      .eq('tenant_id', tenantId)
      .ilike('phone', pattern)
      .limit(11);

    if (error) {
      return res.status(500).json({ error: 'Failed to search customers', details: error.message });
    }
    return res.json({ customers: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Customer search failed' });
  }
});

// ============================================================================
// Search bookings (Receptionist, Coordinator, and Tenant Admin)
// ============================================================================
// CRITICAL: Only accepts ONE search parameter at a time
// Valid parameters: phone, customer_name, date, service_name, booking_id
router.get('/search', authenticateReceptionistOrCoordinatorForView, async (req, res) => {
  try {
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;
    const limit = parseInt(req.query.limit as string) || 50;

    // Extract search parameters - only ONE is allowed
    const phone = req.query.phone as string;
    const customer_name = req.query.customer_name as string;
    const date = req.query.date as string;
    const service_name = req.query.service_name as string;
    const booking_id = req.query.booking_id as string;

    // Count how many search parameters are provided
    const searchParams = [phone, customer_name, date, service_name, booking_id].filter(p => p && p.trim().length > 0);
    
    if (searchParams.length === 0) {
      return res.status(400).json({ 
        error: 'No search parameter provided',
        hint: 'Provide exactly one of: phone, customer_name, date, service_name, or booking_id'
      });
    }

    if (searchParams.length > 1) {
      return res.status(400).json({ 
        error: 'Multiple search parameters provided',
        hint: 'Provide exactly ONE search parameter: phone, customer_name, date, service_name, or booking_id'
      });
    }

    // Base query structure
    const baseSelect = `
      id,
      customer_name,
      customer_phone,
      customer_email,
      visitor_count,
      total_price,
      status,
      payment_status,
      notes,
      created_at,
      booking_group_id,
      zoho_invoice_id,
      zoho_invoice_created_at,
      services:service_id (
        id,
        name,
        name_ar
      ),
      slots:slot_id (
        id,
        slot_date,
        start_time,
        end_time
      ),
      users:employee_id (
        id,
        full_name,
        full_name_ar
      )
    `;

    let bookings: any[] = [];
    let searchType = '';

    // Handle each search type explicitly - only ONE will execute
    if (phone && phone.trim().length > 0) {
      searchType = 'phone';
      // Validate phone format (should be numeric, at least 5 digits)
      const phoneDigits = phone.replace(/\D/g, '');
      if (phoneDigits.length < 5) {
        return res.status(400).json({ 
          error: 'Phone number must be at least 5 digits',
          searchType: 'phone'
        });
      }

      // Search by phone (case-insensitive, partial match)
      const { data, error } = await supabase
        .from('bookings')
        .select(baseSelect, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .ilike('customer_phone', `%${phone.trim()}%`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      bookings = data || [];

    } else if (customer_name && customer_name.trim().length > 0) {
      searchType = 'customer_name';
      // Validate name length
      if (customer_name.trim().length < 2) {
        return res.status(400).json({ 
          error: 'Customer name must be at least 2 characters',
          searchType: 'customer_name'
        });
      }

      // Search by customer name (case-insensitive, partial match)
      const { data, error } = await supabase
        .from('bookings')
        .select(baseSelect, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .ilike('customer_name', `%${customer_name.trim()}%`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      bookings = data || [];

    } else if (date && date.trim().length > 0) {
      searchType = 'date';
      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date.trim())) {
        return res.status(400).json({ 
          error: 'Invalid date format. Use YYYY-MM-DD',
          searchType: 'date'
        });
      }

      // Search by date - find slots on that date, then bookings for those slots
      const { data: slotsOnDate, error: slotsError } = await supabase
        .from('slots')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('slot_date', date.trim())
        .limit(100);

      if (slotsError) throw slotsError;

      if (slotsOnDate && slotsOnDate.length > 0) {
        const slotIds = slotsOnDate.map(s => s.id);
        const { data, error } = await supabase
          .from('bookings')
          .select(baseSelect, { count: 'exact' })
          .eq('tenant_id', tenantId)
          .in('slot_id', slotIds)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        bookings = data || [];
      } else {
        bookings = []; // No slots on that date = no bookings
      }

    } else if (service_name && service_name.trim().length > 0) {
      searchType = 'service_name';
      // Validate service name length
      if (service_name.trim().length < 2) {
        return res.status(400).json({ 
          error: 'Service name must be at least 2 characters',
          searchType: 'service_name'
        });
      }

      // Search by service name - find services first, then bookings
      const { data: serviceMatches, error: serviceError } = await supabase
        .from('services')
        .select('id')
        .eq('tenant_id', tenantId)
        .or(`name.ilike.%${service_name.trim()}%,name_ar.ilike.%${service_name.trim()}%`)
        .limit(10);

      if (serviceError) throw serviceError;

      if (serviceMatches && serviceMatches.length > 0) {
        const serviceIds = serviceMatches.map(s => s.id);
        const { data, error } = await supabase
          .from('bookings')
          .select(baseSelect, { count: 'exact' })
          .eq('tenant_id', tenantId)
          .in('service_id', serviceIds)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        bookings = data || [];
      } else {
        bookings = []; // No matching services = no bookings
      }

    } else if (booking_id && booking_id.trim().length > 0) {
      searchType = 'booking_id';
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(booking_id.trim())) {
        return res.status(400).json({ 
          error: 'Invalid booking ID format. Must be a valid UUID',
          searchType: 'booking_id'
        });
      }

      // Search by booking ID (exact match)
      const { data, error } = await supabase
        .from('bookings')
        .select(baseSelect, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('id', booking_id.trim())
        .limit(limit);

      if (error) throw error;
      bookings = data || [];
    }

    res.json({
      bookings: bookings || [],
      count: bookings?.length || 0,
      searchType
    });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Search bookings error', error, context);
    res.status(500).json({
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

export { router as bookingRoutes };
