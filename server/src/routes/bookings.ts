import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { formatCurrency } from '../utils/currency';
import {
  getEmployeeAvailabilityCached,
  setEmployeeAvailabilityCached,
  invalidateEmployeeAvailability,
  invalidateEmployeeAvailabilityForTenant,
} from '../utils/employeeAvailabilityCache';
import { formatTimeTo12Hour } from '../utils/timeFormat';
import { getPermissionsForUserByUserId } from '../permissions.js';
import { computeTagAdjustedDuration, resolveBookingTagForCreate } from '../services/tagPricingResolve.js';
import { buildEffectiveEmployeeShifts, mergeEffectiveShiftsForCalendarDay, type EffectiveShift } from '../utils/employeeShiftResolution';
import { findOverlappingBooking, resolveEmployeeForBookingTimeEdit } from '../utils/employeeBookingConflict';
import { normalizePhoneNumber } from '../utils/normalizePhoneNumber';
import {
  buildDigitFuzzyPattern,
  buildSearchDigitVariants,
  bestPhoneMatchScore,
  dedupeCustomerSearchResults,
  phoneMatchesAnyVariant,
} from '../utils/customerPhoneSearch';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/** Tickets feature disabled message - same everywhere for consistency */
const TICKETS_DISABLED_MESSAGE = 'Tickets feature disabled';

/**
 * Check tenant tickets_enabled. If disabled, send 403 and return false; otherwise return true.
 * Use at the start of ticket-related endpoints (validate-qr, get details, etc.).
 */
async function requireTicketsEnabled(tenantId: string, res: express.Response): Promise<boolean> {
  const { data: tenantRow, error } = await supabase
    .from('tenants')
    .select('tickets_enabled')
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !tenantRow) return true; // Allow on error (backward compat)
  if ((tenantRow as any).tickets_enabled === false) {
    res.status(403).json({ error: TICKETS_DISABLED_MESSAGE });
    return false;
  }
  return true;
}

type SlotWindow = {
  tenantId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  employeeId: string | null;
};

function toMinutesOfDay(timeValue: string): number {
  const parts = (timeValue || '').slice(0, 8).split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function getSlotDurationMinutes(startTime: string, endTime: string): number {
  const start = toMinutesOfDay(startTime);
  let end = toMinutesOfDay(endTime);
  if (end <= start) end += 24 * 60;
  return Math.max(1, end - start);
}

function addMinutesToTime(startTime: string, minutesToAdd: number): string {
  const total = (toMinutesOfDay(startTime) + Math.max(0, Math.round(minutesToAdd))) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

function isMissingColumnError(error: any, columnName: string): boolean {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find'));
}

function isMissingEffectiveBookingColumnError(error: any): boolean {
  const columns = ['effective_start_time', 'effective_end_time', 'effective_duration_minutes', 'required_slot_count'];
  return columns.some((c) => isMissingColumnError(error, c));
}

async function hasRequiredConsecutiveEmployeeSlots(params: {
  tenantId: string;
  employeeId: string;
  slotDate: string;
  startTime: string;
  requiredSlots: number;
}): Promise<boolean> {
  const { tenantId, employeeId, slotDate, startTime, requiredSlots } = params;
  if (requiredSlots <= 1) return true;

  const { data: slots, error } = await supabase
    .from('slots')
    .select('id, start_time, end_time, available_capacity, booked_count, is_available')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('slot_date', slotDate)
    .eq('is_available', true)
    .gt('available_capacity', 0)
    .order('start_time');

  if (error || !slots || slots.length === 0) return false;

  const byStart = new Map<string, { end_time: string }>();
  for (const slot of slots as any[]) {
    byStart.set((slot.start_time || '').slice(0, 8), { end_time: (slot.end_time || '').slice(0, 8) });
  }

  let cursorStart = startTime.slice(0, 8);
  for (let i = 0; i < requiredSlots; i++) {
    const slot = byStart.get(cursorStart);
    if (!slot) return false;
    cursorStart = slot.end_time;
  }
  return true;
}

async function reserveAdditionalConsecutiveEmployeeSlots(params: {
  tenantId: string;
  employeeId: string;
  slotDate: string;
  startTime: string;
  requiredSlots: number;
  visitorCount: number;
}): Promise<{ ok: boolean; reservedExtraSlotIds: string[]; reason?: string }> {
  const { tenantId, employeeId, slotDate, startTime, requiredSlots, visitorCount } = params;
  if (requiredSlots <= 1) return { ok: true, reservedExtraSlotIds: [] };

  const { data: slots, error } = await supabase
    .from('slots')
    .select('id, start_time, end_time, available_capacity, is_available')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('slot_date', slotDate)
    .order('start_time');
  if (error || !slots || slots.length === 0) {
    return { ok: false, reservedExtraSlotIds: [], reason: 'Failed to load consecutive slots.' };
  }

  const byStart = new Map<string, { id: string; end_time: string; available_capacity: number; booked_count: number; is_available: boolean }>();
  for (const slot of slots as any[]) {
    byStart.set((slot.start_time || '').slice(0, 8), {
      id: slot.id,
      end_time: (slot.end_time || '').slice(0, 8),
      available_capacity: Number(slot.available_capacity ?? 0),
      booked_count: Number(slot.booked_count ?? 0),
      is_available: Boolean(slot.is_available),
    });
  }

  const chain: Array<{ id: string; start: string; available_capacity: number; booked_count: number; is_available: boolean }> = [];
  let cursorStart = (startTime || '').slice(0, 8);
  for (let i = 0; i < requiredSlots; i++) {
    const slot = byStart.get(cursorStart);
    if (!slot) {
      return { ok: false, reservedExtraSlotIds: [], reason: `Missing consecutive slot at ${cursorStart}.` };
    }
    chain.push({
      id: slot.id,
      start: cursorStart,
      available_capacity: slot.available_capacity,
      booked_count: slot.booked_count,
      is_available: slot.is_available,
    });
    cursorStart = slot.end_time;
  }

  // First slot is already consumed atomically by create_booking_with_lock.
  const extraSlots = chain.slice(1);
  if (extraSlots.length === 0) return { ok: true, reservedExtraSlotIds: [] };

  for (const extra of extraSlots) {
    if (!extra.is_available || extra.available_capacity < visitorCount) {
      return { ok: false, reservedExtraSlotIds: [], reason: `Insufficient capacity for extra slot starting ${extra.start}.` };
    }
  }

  const reservedExtraSlotIds: string[] = [];
  for (const extra of extraSlots) {
    const nextAvailable = Math.max(0, Number(extra.available_capacity) - visitorCount);
    const upd = await supabase
      .from('slots')
      .update({
        available_capacity: nextAvailable,
        booked_count: Math.max(0, Number(extra.booked_count) + visitorCount),
      })
      .eq('id', extra.id)
      .eq('tenant_id', tenantId)
      .gte('available_capacity', visitorCount)
      .select('id')
      .limit(1);

    if (upd.error || !upd.data || upd.data.length === 0) {
      return { ok: false, reservedExtraSlotIds, reason: `Failed to reserve extra slot ${extra.id}.` };
    }
    reservedExtraSlotIds.push(extra.id);
  }

  return { ok: true, reservedExtraSlotIds };
}

async function loadTagSlotCountMap(tagIds: Array<string | null | undefined>): Promise<Map<string, number>> {
  const uniqueTagIds = [...new Set((tagIds || []).filter(Boolean))] as string[];
  const result = new Map<string, number>();
  if (uniqueTagIds.length === 0) return result;

  const { data: feeRows, error } = await supabase
    .from('tag_fees')
    .select('tag_id, slot_count')
    .in('tag_id', uniqueTagIds);
  if (error) return result;

  for (const row of feeRows || []) {
    const tagId = String((row as any).tag_id || '');
    if (!tagId) continue;
    const parsed = Number((row as any).slot_count);
    result.set(tagId, Number.isFinite(parsed) && parsed >= 1 ? Math.ceil(parsed) : 1);
  }
  return result;
}

function inferBookingEndFromTagSlotCount(params: {
  effectiveEnd?: string | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  tagId?: string | null;
  tagSlotCountMap?: Map<string, number>;
}): string | null {
  const { effectiveEnd, slotStart, slotEnd, tagId, tagSlotCountMap } = params;
  if (effectiveEnd) return String(effectiveEnd);
  if (!slotStart || !slotEnd) return null;

  const tagSlots = tagId ? Number(tagSlotCountMap?.get(tagId) ?? 1) : 1;
  const safeTagSlots = Number.isFinite(tagSlots) && tagSlots >= 1 ? Math.ceil(tagSlots) : 1;
  if (safeTagSlots <= 1) return String(slotEnd);

  const slotDuration = getSlotDurationMinutes(String(slotStart), String(slotEnd));
  return addMinutesToTime(String(slotStart), slotDuration * safeTagSlots);
}

async function getSlotWindowById(slotId: string): Promise<SlotWindow | null> {
  const { data: slotRow, error: slotError } = await supabase
    .from('slots')
    .select('tenant_id, slot_date, start_time, end_time, employee_id')
    .eq('id', slotId)
    .maybeSingle();
  if (slotError || !slotRow) return null;
  return {
    tenantId: (slotRow as any).tenant_id,
    slotDate: (slotRow as any).slot_date,
    startTime: (slotRow as any).start_time,
    endTime: (slotRow as any).end_time,
    employeeId: (slotRow as any).employee_id ?? null,
  };
}

async function findEmployeeBookingConflict(params: {
  tenantId: string;
  employeeId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  excludeBookingId?: string;
}) {
  const { tenantId, employeeId, slotDate, startTime, endTime, excludeBookingId } = params;
  let bookingQuery = supabase
    .from('bookings')
    .select('id, slot_id, tag_id, effective_start_time, effective_end_time, slots:slot_id(slot_date, start_time, end_time)')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .neq('status', 'cancelled');

  if (excludeBookingId) {
    bookingQuery = bookingQuery.neq('id', excludeBookingId);
  }

  let { data: existingBookings, error: existingBookingsError } = await bookingQuery;
  if (existingBookingsError && isMissingColumnError(existingBookingsError, 'effective_start_time')) {
    let fallbackQuery = supabase
      .from('bookings')
      .select('id, slot_id, tag_id, slots:slot_id(slot_date, start_time, end_time)')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .neq('status', 'cancelled');
    if (excludeBookingId) {
      fallbackQuery = fallbackQuery.neq('id', excludeBookingId);
    }
    const fallback = await fallbackQuery;
    existingBookings = fallback.data;
    existingBookingsError = fallback.error;
  }
  if (existingBookingsError) {
    throw existingBookingsError;
  }
  const tagSlotCountMap = await loadTagSlotCountMap((existingBookings || []).map((b: any) => b?.tag_id));

  const bookedWindows = (existingBookings || [])
    .map((booking: any) => {
      const slot = Array.isArray(booking.slots) ? booking.slots[0] : booking.slots;
      const slotDateValue = slot?.slot_date;
      const startValue = booking.effective_start_time || slot?.start_time;
      const endValue = inferBookingEndFromTagSlotCount({
        effectiveEnd: booking.effective_end_time,
        slotStart: slot?.start_time,
        slotEnd: slot?.end_time,
        tagId: booking?.tag_id ?? null,
        tagSlotCountMap,
      });
      if (!slotDateValue || !startValue || !endValue) return null;
      return {
        bookingId: booking.id,
        slotId: booking.slot_id,
        slotDate: slotDateValue,
        startTime: startValue,
        endTime: endValue,
      };
    })
    .filter(Boolean) as Array<{
      bookingId: string;
      slotId: string;
      slotDate: string;
      startTime: string;
      endTime: string;
    }>;

  return findOverlappingBooking(
    { slotDate, startTime, endTime },
    bookedWindows,
    excludeBookingId ? { excludeBookingId } : undefined
  );
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
        branch_id: decoded.branch_id ?? null,
      };
    }
    next();
  } catch (error) {
    // Continue without auth for public bookings
    next();
  }
}

// Middleware for booking deletion: tenant_admin/customer_admin/admin_user OR permission edit_booking/manage_bookings (RBAC)
async function authenticateTenantAdminOrBookingEditForDelete(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required', hint: 'Please provide a valid Bearer token' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token is required' });
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token has expired', hint: 'Please log in again' });
      return res.status(401).json({ error: 'Invalid token', hint: jwtError.message || 'Please log in again' });
    }
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'Access denied. No tenant associated with your account.' });
    }
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
      branch_id: decoded.branch_id ?? null,
      role_id: decoded.role_id ?? null,
    };
    const allowedRoles = ['tenant_admin', 'customer_admin', 'admin_user'];
    if (allowedRoles.includes(decoded.role)) {
      return next();
    }
    const perms = await getPermissionsForUserByUserId(supabase, decoded.id);
    if (perms.includes('edit_booking') || perms.includes('manage_bookings')) {
      return next();
    }
    return res.status(403).json({
      error: 'Access denied. You do not have permission to delete bookings.',
      userRole: decoded.role,
      hint: 'Required: tenant admin role or edit_booking / manage_bookings permission.',
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Authentication error', hint: error.message });
  }
}

// Middleware: require issue_invoices (Update payment status) permission or legacy allowed roles
async function authenticateAdminOrReceptionistForPaymentStatus(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required', hint: 'Provide a valid Bearer token' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token is required' });
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token has expired', hint: 'Please log in again' });
      return res.status(401).json({ error: 'Invalid token', hint: jwtError.message || 'Please log in again' });
    }
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'Access denied. No tenant associated with your account.' });
    }
    const allowedRoles = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user'];
    const roleAllowed = decoded.role && allowedRoles.includes(decoded.role);
    if (roleAllowed) {
      req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id, branch_id: decoded.branch_id ?? null, role_id: decoded.role_id ?? null };
      return next();
    }
    const perms = await getPermissionsForUserByUserId(supabase, decoded.id);
    if (perms.includes('issue_invoices') || perms.includes('manage_bookings')) {
      req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id, branch_id: decoded.branch_id ?? null, role_id: decoded.role_id ?? null };
      return next();
    }
    return res.status(403).json({
      error: 'You do not have permission to update payment status.',
      userRole: decoded.role,
      hint: 'Required: issue_invoices or manage_bookings (or receptionist / tenant admin role).',
    });
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
      branch_id: decoded.branch_id ?? null,
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
              branch_id: decoded.branch_id ?? null,
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
      branch_id: decoded.branch_id ?? null,
    };
    
    next();
  } catch (error: any) {
    return res.status(500).json({ error: 'Authentication error', hint: error.message });
  }
}

// Employee: view own bookings only (for employee dashboard).
function authenticateEmployee(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }
    const token = authHeader.replace('Bearer ', '');
    if (!token || token.trim() === '') return res.status(401).json({ error: 'Token is required' });
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      return res.status(401).json({ error: jwtError.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token' });
    }
    if (decoded.role !== 'employee') {
      return res.status(403).json({ error: 'Access denied. Employee role required.', userRole: decoded.role });
    }
    if (!decoded.tenant_id) return res.status(403).json({ error: 'No tenant associated with your account.' });
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id, branch_id: decoded.branch_id ?? null };
    next();
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Authentication error' });
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
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id, branch_id: decoded.branch_id ?? null };
    next();
  } catch (error: any) {
    return res.status(500).json({ error: 'Authentication error', hint: error.message });
  }
}

// Receptionist, coordinator, cashier, or admin: for branch-scoped employees list (same as view + cashier).
const RECEPTIONIST_COORDINATOR_CASHIER_VIEW_ROLES = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user', 'coordinator', 'cashier'];
function authenticateReceptionistCoordinatorOrCashierForView(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }
    const token = authHeader.replace('Bearer ', '');
    if (!token || token.trim() === '') return res.status(401).json({ error: 'Token is required' });
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      return res.status(401).json({ error: jwtError.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token' });
    }
    if (!RECEPTIONIST_COORDINATOR_CASHIER_VIEW_ROLES.includes(decoded.role)) {
      return res.status(403).json({ error: 'Access denied.', userRole: decoded.role });
    }
    if (!decoded.tenant_id) return res.status(403).json({ error: 'No tenant associated with your account.' });
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id, branch_id: decoded.branch_id ?? null };
    next();
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Authentication error' });
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
    const PATCH_BOOKING_ROLES = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user', 'coordinator', 'employee'];
    if (!PATCH_BOOKING_ROLES.includes(decoded.role)) {
      return res.status(403).json({ 
        error: 'Access denied.',
        userRole: decoded.role,
        hint: 'Only receptionist, coordinator, employee, or admin roles can update bookings.'
      });
    }
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'Access denied. No tenant associated with your account.' });
    }
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id, branch_id: decoded.branch_id ?? null, role_id: decoded.role_id ?? null };
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
  if (oldNorm === newNorm) {
    return { valid: true }; // same status: allow updating payment_method / transaction_reference only
  }
  // Allowed display states: Unpaid, Paid On Site, Bank Transfer. Stored: unpaid | paid | paid_manual
  const validTransitions: Record<string, string[]> = {
    'unpaid': ['paid', 'paid_manual'],
    'paid': ['unpaid', 'paid_manual'],
    'paid_manual': ['unpaid', 'paid'],
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
// Employees for service (branch-scoped for receptionist/cashier/coordinator)
// MUST be before /:id routes so GET /receptionist/employees-for-service is not matched as :id
// ============================================================================
router.get('/receptionist/employees-for-service', authenticateReceptionistCoordinatorOrCashierForView, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    const branchId = req.user!.branch_id ?? null;
    const serviceId = (req.query.service_id as string) || '';
    if (!tenantId || !serviceId) {
      return res.status(400).json({ error: 'tenant_id and service_id are required' });
    }
    const { data: empServices } = await supabase
      .from('employee_services')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('service_id', serviceId);
    const employeeIds = [...new Set((empServices || []).map((r: any) => r.employee_id).filter(Boolean))];
    if (employeeIds.length === 0) {
      return res.json({ employees: [] });
    }
    let usersQuery = supabase
      .from('users')
      .select('id, full_name, full_name_ar')
      .in('id', employeeIds)
      .eq('tenant_id', tenantId)
      .eq('role', 'employee')
      .eq('is_active', true);
    if (branchId) {
      usersQuery = usersQuery.eq('branch_id', branchId);
    }
    const { data: users, error } = await usersQuery.order('full_name');
    if (error) {
      return res.status(500).json({ error: 'Failed to load employees', details: error.message });
    }
    const employees = (users || []).map((u: any) => ({
      id: u.id,
      name: u.full_name ?? '',
      name_ar: u.full_name_ar ?? '',
    }));
    return res.json({ employees });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load employees for service' });
  }
});

// ============================================================================
// Customer search by phone (for Add Booking / Add Subscription dropdown)
// MUST be before /:id routes so GET /customer-search is not matched as :id
// ============================================================================
router.get('/customer-search', authenticateReceptionistOrTenantAdmin, async (req, res) => {
  try {
    // Prevent browser/proxy revalidation responses (304) from breaking live suggestions.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const tenantId = req.user!.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ error: 'No tenant associated' });
    }
    const phoneParam = (req.query.phone as string) || '';
    const digits = phoneParam.replace(/\D/g, '');
    const requestedLimit = Number(req.query.limit);
    const safeLimit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 200)
      : 120;
    if (digits.length < 4) {
      return res.status(400).json({
        error: 'Phone fragment too short',
        hint: 'Provide at least 4 digits to search customers (country-code-only fragments like 966 match too many rows)',
      });
    }
    const variants = buildSearchDigitVariants(digits);
    if (variants.length === 0) {
      return res.json({ customers: [] });
    }
    const fuzzyPatterns = variants.map(buildDigitFuzzyPattern);
    const orClause = fuzzyPatterns.map((pattern) => `phone.ilike.${pattern}`).join(',');
    const prefetchLimit = Math.min(1000, Math.max(safeLimit * 4, 200));
    const { data: customerRows, error: customerError } = await supabase
      .from('customers')
      .select('id, name, phone, email')
      .eq('tenant_id', tenantId)
      .or(orClause)
      .limit(prefetchLimit);

    if (customerError) {
      return res.status(500).json({ error: 'Failed to search customers', details: customerError.message });
    }

    const bookingOrClause = fuzzyPatterns.map((pattern) => `customer_phone.ilike.${pattern}`).join(',');
    const { data: bookingRows, error: bookingError } = await supabase
      .from('bookings')
      .select('customer_id, customer_name, customer_phone, customer_email, created_at')
      .eq('tenant_id', tenantId)
      .or(bookingOrClause)
      .order('created_at', { ascending: false })
      .limit(prefetchLimit);

    if (bookingError) {
      return res.status(500).json({ error: 'Failed to search bookings', details: bookingError.message });
    }

    const customerById = new Map<string, any>();
    for (const c of customerRows || []) {
      if (c?.id) customerById.set(c.id, c);
    }

    const merged: Array<{ id?: string; name: string; phone: string; email?: string | null }> = [];
    for (const c of customerRows || []) {
      merged.push({
        id: c.id,
        name: c.name || '',
        phone: c.phone || '',
        email: c.email ?? null,
      });
    }

    const bookingSeenKeys = new Set<string>();
    for (const b of bookingRows || []) {
      const phone = String((b as any)?.customer_phone || '');
      if (!phone) continue;
      if (!phoneMatchesAnyVariant(phone, variants)) continue;

      const customerId = (b as any)?.customer_id || undefined;
      if (customerId && customerById.has(customerId)) {
        continue;
      }

      const normalizedPhone = phone.replace(/\D/g, '');
      const key = customerId || normalizedPhone;
      if (!key || bookingSeenKeys.has(key)) continue;
      bookingSeenKeys.add(key);

      merged.push({
        id: customerId,
        name: String((b as any)?.customer_name || ''),
        phone,
        email: (b as any)?.customer_email ?? null,
      });
    }

    const filtered = merged.filter((c) => phoneMatchesAnyVariant(c?.phone || '', variants));
    filtered.sort((a: any, b: any) => {
      const scoreA = bestPhoneMatchScore(a?.phone || '', variants);
      const scoreB = bestPhoneMatchScore(b?.phone || '', variants);
      if (scoreA !== scoreB) return scoreA - scoreB;
      const phoneA = String(a?.phone || '').replace(/\D/g, '').length;
      const phoneB = String(b?.phone || '').replace(/\D/g, '').length;
      return phoneA - phoneB;
    });

    const deduped = dedupeCustomerSearchResults(filtered);
    return res.json({ customers: deduped.slice(0, safeLimit) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Customer search failed' });
  }
});

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
    // Use noon UTC so the calendar date (YYYY-MM-DD) maps to the same weekday everywhere:
    // e.g. 2025-02-25 is Wednesday in all timezones; midnight UTC would be Tuesday.
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();

    const MINUTES_PER_DAY = 24 * 60;
    const toMinutes = (t: string) => {
      const parts = (t || '00:00').split(':').map(Number);
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    };
    /** DB end 00:00 after PM start = end of calendar day (not minute 0). */
    const slotEndExclusiveMinutes = (startM: number, endRawM: number) =>
      endRawM === 0 && startM > 0 ? MINUTES_PER_DAY : endRawM;
    const intervalsOverlapExclusive = (
      aStart: number,
      aEndEx: number,
      bStart: number,
      bEndEx: number
    ) => aStart < bEndEx && bStart < aEndEx;
    const mergeBusyRanges = (
      target: Map<string, { startM: number; endM: number }[]>,
      source: Map<string, { startM: number; endM: number }[]>
    ) => {
      source.forEach((ranges, employeeId) => {
        if (!target.has(employeeId)) target.set(employeeId, []);
        target.get(employeeId)!.push(...ranges);
      });
    };
    const buildBusyRangesForEmployeeIds = async (employeeIdsRaw: string[]) => {
      const busyRanges = new Map<string, { startM: number; endM: number }[]>();
      const employeeIds = [...new Set((employeeIdsRaw || []).filter(Boolean))];
      if (employeeIds.length === 0) return busyRanges;

      const { data: employeeDaySlots, error: employeeDaySlotsError } = await supabase
        .from('slots')
        .select('id, employee_id, start_time, end_time')
        .eq('tenant_id', tenantId)
        .eq('slot_date', dateStr)
        .in('employee_id', employeeIds);
      if (employeeDaySlotsError) {
        logger.warn('ensure-employee-based-slots: employeeDaySlots fetch for busy map failed', {
          serviceId,
          dateStr,
          message: employeeDaySlotsError.message,
        });
        return busyRanges;
      }

      const slotMeta = new Map<string, { employee_id: string | null; start_time: string; end_time: string }>(
        (employeeDaySlots || []).map((s: any) => [
          s.id,
          {
            employee_id: s.employee_id ?? null,
            start_time: s.start_time,
            end_time: s.end_time,
          },
        ])
      );
      const slotIds = [...new Set((employeeDaySlots || []).map((s: any) => s.id).filter(Boolean))];

      const bookingsByEmployeePromise = supabase
        .from('bookings')
        .select('employee_id, slot_id, tag_id, effective_start_time, effective_end_time')
        .eq('tenant_id', tenantId)
        .in('employee_id', employeeIds)
        .neq('status', 'cancelled');

      const bookingsBySlotPromise = slotIds.length > 0
        ? supabase
            .from('bookings')
            .select('employee_id, slot_id, tag_id, effective_start_time, effective_end_time')
            .eq('tenant_id', tenantId)
            .in('slot_id', slotIds)
            .neq('status', 'cancelled')
        : Promise.resolve({ data: [], error: null } as any);

      let [{ data: bookingsByEmployee, error: bookingsByEmployeeError }, { data: bookingsBySlot, error: bookingsBySlotError }] =
        await Promise.all([bookingsByEmployeePromise, bookingsBySlotPromise]);
      if (
        (bookingsByEmployeeError && isMissingColumnError(bookingsByEmployeeError, 'effective_start_time')) ||
        (bookingsBySlotError && isMissingColumnError(bookingsBySlotError, 'effective_start_time'))
      ) {
        const fallbackEmployeePromise = supabase
          .from('bookings')
          .select('employee_id, slot_id, tag_id')
          .eq('tenant_id', tenantId)
          .in('employee_id', employeeIds)
          .neq('status', 'cancelled');
        const fallbackSlotPromise = slotIds.length > 0
          ? supabase
              .from('bookings')
              .select('employee_id, slot_id, tag_id')
              .eq('tenant_id', tenantId)
              .in('slot_id', slotIds)
              .neq('status', 'cancelled')
          : Promise.resolve({ data: [], error: null } as any);
        const [fbEmp, fbSlot] = await Promise.all([fallbackEmployeePromise, fallbackSlotPromise]);
        bookingsByEmployee = fbEmp.data;
        bookingsByEmployeeError = fbEmp.error;
        bookingsBySlot = fbSlot.data;
        bookingsBySlotError = fbSlot.error;
      }
      if (bookingsByEmployeeError) {
        logger.warn('ensure-employee-based-slots: bookingsByEmployee fetch for busy map failed', {
          serviceId,
          dateStr,
          message: bookingsByEmployeeError.message,
        });
      }
      if (bookingsBySlotError) {
        logger.warn('ensure-employee-based-slots: bookingsBySlot fetch for busy map failed', {
          serviceId,
          dateStr,
          message: bookingsBySlotError.message,
        });
      }

      const dedup = new Map<string, {
        employee_id: string | null;
        slot_id: string;
        tag_id?: string | null;
        effective_start_time?: string | null;
        effective_end_time?: string | null;
      }>();
      [...(bookingsByEmployee || []), ...(bookingsBySlot || [])].forEach((b: any) => {
        if (!b?.slot_id) return;
        const key = `${b.employee_id ?? 'null'}:${b.slot_id}:${b.effective_start_time ?? ''}:${b.effective_end_time ?? ''}`;
        if (!dedup.has(key)) {
          dedup.set(key, {
            employee_id: b.employee_id ?? null,
            slot_id: b.slot_id,
            tag_id: b.tag_id ?? null,
            effective_start_time: b.effective_start_time ?? null,
            effective_end_time: b.effective_end_time ?? null,
          });
        }
      });
      const combinedBookings = Array.from(dedup.values());
      const tagSlotCountMap = await loadTagSlotCountMap(combinedBookings.map((b) => b.tag_id));

      const missingSlotIds = [...new Set(combinedBookings.map((b) => b.slot_id).filter((id) => !slotMeta.has(id)))];
      if (missingSlotIds.length > 0) {
        const { data: missingSlots } = await supabase
          .from('slots')
          .select('id, employee_id, start_time, end_time')
          .in('id', missingSlotIds)
          .eq('slot_date', dateStr);
        (missingSlots || []).forEach((s: any) => {
          slotMeta.set(s.id, {
            employee_id: s.employee_id ?? null,
            start_time: s.start_time,
            end_time: s.end_time,
          });
        });
      }

      const employeeSet = new Set(employeeIds);
      combinedBookings.forEach((b) => {
        const slot = slotMeta.get(b.slot_id);
        const startRaw = (b.effective_start_time || slot?.start_time || '').slice(0, 8);
        const inferredEnd = inferBookingEndFromTagSlotCount({
          effectiveEnd: b.effective_end_time ?? null,
          slotStart: slot?.start_time ?? null,
          slotEnd: slot?.end_time ?? null,
          tagId: b.tag_id ?? null,
          tagSlotCountMap,
        });
        const endRaw = String(inferredEnd || '').slice(0, 8);
        if (!startRaw || !endRaw) return;
        const effectiveEmployeeId = b.employee_id || slot.employee_id;
        if (!effectiveEmployeeId || !employeeSet.has(effectiveEmployeeId)) return;
        const startM = toMinutes(startRaw);
        const endRawM = toMinutes(endRaw);
        const endM = slotEndExclusiveMinutes(startM, endRawM);
        if (!busyRanges.has(effectiveEmployeeId)) busyRanges.set(effectiveEmployeeId, []);
        busyRanges.get(effectiveEmployeeId)!.push({ startM, endM });
      });

      return busyRanges;
    };

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

    // Short-term cache: return cached result for same service/date (avoids N+1 and recomputation)
    const cached = getEmployeeAvailabilityCached<{ shiftIds: string[]; slots?: any[]; employees?: any[] }>(tenantId, serviceId, dateStr);
    if (cached && Array.isArray(cached.shiftIds) && cached.shiftIds.length > 0) {
      logger.info('ensure-employee-based-slots: cache hit', { serviceId, dateStr });
      // Global time lock: on cache hit still filter out slots where employee is busy (bookings may have been created since cache)
      const cachedSlots = cached.slots || [];
      if (cachedSlots.length > 0) {
        const employeeIdsFromCache = [...new Set(cachedSlots.map((s: any) => s.employee_id).filter(Boolean))];
        const cacheBusyRanges = await buildBusyRangesForEmployeeIds(employeeIdsFromCache);
        const filteredSlots = cachedSlots.filter((s: any) => {
          if (!s.employee_id) return true;
          const busyRanges = cacheBusyRanges.get(s.employee_id) || [];
          const sStart = (s.start_time || '').slice(0, 8);
          const sEnd = (s.end_time || '').slice(0, 8);
          const slotStartM = toMinutes(sStart);
          const slotEndEx = slotEndExclusiveMinutes(slotStartM, toMinutes(sEnd));
          const isBusy = busyRanges.some((r: { startM: number; endM: number }) =>
            intervalsOverlapExclusive(slotStartM, slotEndEx, r.startM, r.endM)
          );
          return !isBusy;
        });
        const out = { ...cached, slots: filteredSlots };
        if (cached.employees && Array.isArray(cached.employees)) {
          const byEmployee = new Map<string, any[]>();
          filteredSlots.forEach((s: any) => {
            if (!s.employee_id) return;
            if (!byEmployee.has(s.employee_id)) byEmployee.set(s.employee_id, []);
            byEmployee.get(s.employee_id)!.push(s);
          });
          out.employees = Array.from(byEmployee.entries()).map(([id, slots]) => ({
            id,
            name: (slots[0]?.users as any)?.full_name || (slots[0]?.users as any)?.full_name_ar || '',
            available_slots: slots,
          }));
        }
        return res.json(out);
      }
      return res.json(cached);
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
      .select('id, branch_id')
      .in('id', employeeIds)
      .eq('is_active', true);
    if (usersError || !users) {
      return res.json({ shiftIds: [virtualShiftId] });
    }
    const activeEmployeeIds = new Set(users.map((u: any) => u.id));
    const employeeBranchId = new Map<string, string | null>();
    users.forEach((u: any) => { employeeBranchId.set(u.id, u.branch_id ?? null); });
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

    // Fetch employee_shifts (custom) for all available employees — when present, they override branch_shifts (see branch_shifts migration).
    const { data: empShifts, error: empShiftsError } = await supabase
      .from('employee_shifts')
      .select('id, employee_id, start_time_utc, end_time_utc, days_of_week')
      .eq('tenant_id', tenantId)
      .in('employee_id', availableEmployeeIds)
      .eq('is_active', true);
    if (empShiftsError) {
      logger.error('ensure-employee-based-slots: employee_shifts fetch', empShiftsError);
      return res.status(500).json({ error: empShiftsError.message });
    }

    const employeesWithBranch = availableEmployeeIds.filter((eid: string) => Boolean(employeeBranchId.get(eid)));
    const branchIds = [...new Set(employeesWithBranch.map((eid: string) => employeeBranchId.get(eid)).filter(Boolean))];
    let branchShiftsList: any[] = [];
    if (branchIds.length > 0) {
      const { data: bShifts } = await supabase
        .from('branch_shifts')
        .select('id, branch_id, days_of_week, start_time, end_time')
        .in('branch_id', branchIds);
      branchShiftsList = bShifts || [];
      logger.info('ensure-employee-based-slots: resolving shifts (custom overrides branch when present)', {
        serviceId,
        dateStr,
        employeesWithBranch: employeesWithBranch.length,
        branchIds,
        branchShiftsCount: branchShiftsList.length,
      });
    }

    const effectiveShifts: EffectiveShift[] = buildEffectiveEmployeeShifts({
      availableEmployeeIds,
      employeeBranchId,
      branchShiftsList,
      empShifts: empShifts || [],
    });

    let shiftsForDay = effectiveShifts.filter((es: EffectiveShift) => es.days_of_week.includes(dayOfWeek));
    // Union overlapping windows when multiple branch/custom rows apply the same day (e.g. Mon–Sun long + redundant Wed-only short).
    shiftsForDay = mergeEffectiveShiftsForCalendarDay(shiftsForDay, dayOfWeek);
    if (shiftsForDay.length === 0) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      logger.warn('ensure-employee-based-slots: no shifts for this day of week', { serviceId, dateStr, dayOfWeek, dayName: dayNames[dayOfWeek], effectiveShiftsCount: effectiveShifts.length });
      return res.json({ shiftIds: [virtualShiftId] });
    }

    // --- Bulk queries: no DB calls inside loops (fixes N+1) ---
    const employeeIdsFromShifts = [...new Set((shiftsForDay as any[]).map((es: any) => es.employee_id))];

    // 1) All slots for these employees on this date (any shift) — for overlap + booking count
    // IMPORTANT: paginate to avoid PostgREST default 1000-row truncation.
    const PAGE_SIZE = 1000;
    const allSlotsForDate: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = from + PAGE_SIZE - 1;
      const { data: page, error: allSlotsErr } = await supabase
        .from('slots')
        .select('id, employee_id, start_time, end_time')
        .eq('tenant_id', tenantId)
        .in('employee_id', employeeIdsFromShifts)
        .eq('slot_date', dateStr)
        .range(from, to);
      if (allSlotsErr) {
        logger.error('ensure-employee-based-slots: allSlotsForDate fetch', allSlotsErr);
        return res.status(500).json({ error: allSlotsErr.message });
      }
      if (!page || page.length === 0) break;
      allSlotsForDate.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    // 2) Booking counts per slot_id (non-cancelled only)
    const slotIdsForBookings = allSlotsForDate.map((s: any) => s.id);
    let bookingCountBySlotId: Record<string, number> = {};
    // Global employee time lock: busy ranges per employee (any service) for this date
    const globalBusyRangesByEmployee = new Map<string, { startM: number; endM: number }[]>();
    if (slotIdsForBookings.length > 0) {
      let { data: bookingsList, error: bookingsListError } = await supabase
        .from('bookings')
        .select('slot_id, employee_id, tag_id, effective_start_time, effective_end_time')
        .in('slot_id', slotIdsForBookings)
        .neq('status', 'cancelled');
      if (bookingsListError && isMissingColumnError(bookingsListError, 'effective_start_time')) {
        const fallback = await supabase
          .from('bookings')
          .select('slot_id, employee_id, tag_id')
          .in('slot_id', slotIdsForBookings)
          .neq('status', 'cancelled');
        bookingsList = fallback.data;
      }
      const bookingsListTagSlots = await loadTagSlotCountMap((bookingsList || []).map((b: any) => b?.tag_id));
      (bookingsList || []).forEach((b: any) => {
        if (b.slot_id) bookingCountBySlotId[b.slot_id] = (bookingCountBySlotId[b.slot_id] || 0) + 1;
        if (b.employee_id && b.slot_id) {
          const slot = allSlotsForDate.find((s: any) => s.id === b.slot_id);
          const startValue = (b as any).effective_start_time || slot?.start_time;
          const endValue = inferBookingEndFromTagSlotCount({
            effectiveEnd: (b as any).effective_end_time,
            slotStart: slot?.start_time,
            slotEnd: slot?.end_time,
            tagId: (b as any).tag_id ?? null,
            tagSlotCountMap: bookingsListTagSlots,
          });
          if (startValue != null && endValue != null) {
            const startParts = String(startValue).slice(0, 8).split(':').map(Number);
            const endParts = String(endValue).slice(0, 8).split(':').map(Number);
            const startM = (startParts[0] || 0) * 60 + (startParts[1] || 0);
            const endRawM = (endParts[0] || 0) * 60 + (endParts[1] || 0);
            const endM = slotEndExclusiveMinutes(startM, endRawM);
            if (!globalBusyRangesByEmployee.has(b.employee_id)) globalBusyRangesByEmployee.set(b.employee_id, []);
            globalBusyRangesByEmployee.get(b.employee_id)!.push({ startM, endM });
          }
        }
      });
    }
    // Also fetch bookings for these employees on this date that reference slots NOT in allSlotsForDate (e.g. other services we haven't loaded yet)
    let { data: otherBookings, error: otherBookingsError } = await supabase
      .from('bookings')
      .select('employee_id, slot_id, tag_id, effective_start_time, effective_end_time')
      .eq('tenant_id', tenantId)
      .in('employee_id', employeeIdsFromShifts)
      .neq('status', 'cancelled');
    if (otherBookingsError && isMissingColumnError(otherBookingsError, 'effective_start_time')) {
      const fallback = await supabase
        .from('bookings')
        .select('employee_id, slot_id, tag_id')
        .eq('tenant_id', tenantId)
        .in('employee_id', employeeIdsFromShifts)
        .neq('status', 'cancelled');
      otherBookings = fallback.data;
    }
    const otherBookingsTagSlots = await loadTagSlotCountMap((otherBookings || []).map((b: any) => b?.tag_id));
    const otherSlotIds = [...new Set((otherBookings || []).map((b: any) => b.slot_id).filter(Boolean))].filter((id: string) => !slotIdsForBookings.includes(id));
    if (otherSlotIds.length > 0) {
      const { data: otherSlots } = await supabase
        .from('slots')
        .select('id, start_time, end_time')
        .in('id', otherSlotIds)
        .eq('slot_date', dateStr);
      const otherSlotsMap = new Map((otherSlots || []).map((s: any) => [s.id, s]));
      (otherBookings || []).forEach((b: any) => {
        if (!b.employee_id || !b.slot_id) return;
        const slot = otherSlotsMap.get(b.slot_id);
        const startValue = (b as any).effective_start_time || slot?.start_time;
        const endValue = inferBookingEndFromTagSlotCount({
          effectiveEnd: (b as any).effective_end_time,
          slotStart: slot?.start_time,
          slotEnd: slot?.end_time,
          tagId: (b as any).tag_id ?? null,
          tagSlotCountMap: otherBookingsTagSlots,
        });
        if (!startValue || !endValue) return;
        const startParts = String(startValue).slice(0, 8).split(':').map(Number);
        const endParts = String(endValue).slice(0, 8).split(':').map(Number);
        const startM = (startParts[0] || 0) * 60 + (startParts[1] || 0);
        const endRawM = (endParts[0] || 0) * 60 + (endParts[1] || 0);
        const endM = slotEndExclusiveMinutes(startM, endRawM);
        if (!globalBusyRangesByEmployee.has(b.employee_id)) globalBusyRangesByEmployee.set(b.employee_id, []);
        globalBusyRangesByEmployee.get(b.employee_id)!.push({ startM, endM });
      });
    }
    // Robust pass: derive busy map again from day slots + bookings to avoid missing
    // legacy rows where booking.employee_id is null or when response includes stale employee slots.
    const robustBusyRangesByEmployee = await buildBusyRangesForEmployeeIds(employeeIdsFromShifts);
    mergeBusyRanges(globalBusyRangesByEmployee, robustBusyRangesByEmployee);

    // 3) Existing employee-based slots (virtual shift, this date) — remove slots with no bookings so we can regenerate from current branch shifts only
    const existingSlots: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = from + PAGE_SIZE - 1;
      const { data: page, error: existingErr } = await supabase
        .from('slots')
        .select('id, employee_id, start_time')
        .eq('shift_id', virtualShiftId)
        .in('employee_id', employeeIdsFromShifts)
        .eq('slot_date', dateStr)
        .range(from, to);
      if (existingErr) {
        logger.error('ensure-employee-based-slots: existingSlots fetch', existingErr);
        return res.status(500).json({ error: existingErr.message });
      }
      if (!page || page.length === 0) break;
      existingSlots.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    const existingSlotKeys = new Set(existingSlots.map((s: any) => `${s.employee_id}:${s.start_time}`));
    const slotIdsWithBookings = new Set(Object.keys(bookingCountBySlotId));
    const toDelete = existingSlots.filter((s: any) => !slotIdsWithBookings.has(s.id));
    const slotIdsToDelete = toDelete.map((s: any) => s.id);
    if (slotIdsToDelete.length > 0) {
      await supabase.from('slots').delete().in('id', slotIdsToDelete);
      toDelete.forEach((s: any) => existingSlotKeys.delete(`${s.employee_id}:${s.start_time}`));
    }

    const startTimeStr = (t: string) => (t || '').slice(0, 8);
    const toTime = (mins: number) => {
      const normalized = mins >= MINUTES_PER_DAY ? mins % MINUTES_PER_DAY : mins;
      const h = Math.floor(normalized / 60);
      const m = normalized % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    };

    logger.info('ensure-employee-based-slots: shift resolution', {
      dateStr,
      dayOfWeek,
      durationMinutes,
      serviceId,
      shiftsForDay: (shiftsForDay as any[]).map((es: any) => ({
        employee_id: es.employee_id,
        start: es.start_time_utc,
        end: es.end_time_utc,
      })),
    });

    // --- Build availability in memory: for each (shift, time window) compute overlap count and decide insert ---
    type SlotRow = {
      tenant_id: string;
      shift_id: string;
      employee_id: string;
      slot_date: string;
      start_time: string;
      end_time: string;
      start_time_utc: string;
      end_time_utc: string;
      original_capacity: number;
      available_capacity: number;
      booked_count: number;
      is_available: boolean;
      is_overbooked?: boolean;
    };
    const rowsToInsert: SlotRow[] = [];

    for (const es of shiftsForDay as any[]) {
      const startM = toMinutes(startTimeStr(es.start_time_utc));
      const endM = toMinutes(startTimeStr(es.end_time_utc));
      const isOvernight = endM <= startM;
      const ranges: { start: number; end: number }[] = isOvernight
        ? [
            { start: startM, end: MINUTES_PER_DAY },
            { start: 0, end: endM },
          ]
        : [{ start: startM, end: endM }];

      for (const range of ranges) {
        let slotStartM = range.start;
        while (slotStartM + durationMinutes <= range.end) {
          const slotEndM = slotStartM + durationMinutes;
          const startTime = toTime(slotStartM);
          const endTime = toTime(slotEndM);
          const key = `${es.employee_id}:${startTime}`;
          if (existingSlotKeys.has(key)) {
            slotStartM += durationMinutes;
            continue;
          }
          // Global employee time lock: employee must not be booked in this time range in ANY service
          const busyRanges = globalBusyRangesByEmployee.get(es.employee_id) || [];
          const isBusyGlobally = busyRanges.some(
            (r: { startM: number; endM: number }) => r.startM < slotEndM && r.endM > slotStartM
          );
          if (isBusyGlobally) {
            slotStartM += durationMinutes;
            continue;
          }
          // Overlapping slots (same employee, time overlap) — minute-based (strings break at midnight)
          const overlapping = allSlotsForDate.filter((s: any) => {
            if (s.employee_id !== es.employee_id) return false;
            const sStartM = toMinutes((s.start_time || '').slice(0, 8));
            const sEndRaw = toMinutes((s.end_time || '').slice(0, 8));
            const sEndM = slotEndExclusiveMinutes(sStartM, sEndRaw);
            const candStartM = slotStartM;
            const candEndM = slotEndM;
            return intervalsOverlapExclusive(candStartM, candEndM, sStartM, sEndM);
          });
          let overlapCount = 0;
          overlapping.forEach((s: any) => {
            overlapCount += bookingCountBySlotId[s.id] || 0;
          });
          const availableCapacity = Math.max(0, 1 - overlapCount);
          if (availableCapacity === 0) {
            slotStartM += durationMinutes;
            continue;
          }
          const startTs = `${dateStr}T${startTime}`;
          const endTs = `${dateStr}T${endTime}`;
          const slotRow: SlotRow = {
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
          rowsToInsert.push(slotRow);
          slotStartM += durationMinutes;
        }
      }
    }

    const beforeDedupe = rowsToInsert.length;
    const seenSlotKeys = new Set<string>();
    const dedupedRows: SlotRow[] = [];
    for (const row of rowsToInsert) {
      const k = `${row.employee_id}:${row.start_time}`;
      if (seenSlotKeys.has(k)) continue;
      seenSlotKeys.add(k);
      dedupedRows.push(row);
    }
    if (beforeDedupe !== dedupedRows.length) {
      logger.warn('ensure-employee-based-slots: deduped duplicate slot rows', {
        dateStr,
        serviceId,
        before: beforeDedupe,
        after: dedupedRows.length,
      });
    }
    rowsToInsert.length = 0;
    rowsToInsert.push(...dedupedRows);

    logger.info('ensure-employee-based-slots: generated slot rows (pre-insert)', {
      dateStr,
      serviceId,
      durationMinutes,
      count: rowsToInsert.length,
      sampleStarts: rowsToInsert.slice(0, 12).map((r) => r.start_time),
    });

    // --- Bulk insert (no DB calls inside loops) ---
    let slotsCreated = 0;
    for (let i = 0; i < rowsToInsert.length; i += 50) {
      const batch = rowsToInsert.slice(i, i + 50);
      const rowsWithoutOverbooked = batch.map((r) => {
        const { is_overbooked, ...rest } = r as SlotRow & { is_overbooked?: boolean };
        return rest;
      });
      const { error: insertErr } = await supabase.from('slots').insert(rowsWithoutOverbooked);
      if (insertErr) {
        logger.warn('ensure-employee-based-slots: bulk slot insert error', { message: insertErr.message, code: insertErr.code, batchSize: batch.length });
        // Resilience guard: if one row conflicts or is malformed, do not lose the whole batch.
        // Retry row-by-row so valid rows still get inserted.
        for (const row of rowsWithoutOverbooked) {
          const { error: rowErr } = await supabase.from('slots').insert(row);
          if (!rowErr) {
            slotsCreated += 1;
            continue;
          }
          // Duplicate rows are non-fatal (already present from prior generation).
          if ((rowErr as any)?.code === '23505') {
            continue;
          }
          logger.warn('ensure-employee-based-slots: row insert error after batch failure', {
            message: rowErr.message,
            code: (rowErr as any)?.code,
            employee_id: (row as any).employee_id,
            slot_date: (row as any).slot_date,
            start_time: (row as any).start_time,
            end_time: (row as any).end_time,
          });
        }
      } else {
        slotsCreated += batch.length;
      }
    }

    logger.info('ensure-employee-based-slots: done', { serviceId, dateStr, slotsCreated, employeesWithShifts: shiftsForDay.length });

    // --- Optional: return slots + employees for frontend (reduces round-trips) ---
    const slotsFromDb: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = from + PAGE_SIZE - 1;
      const { data: page, error: slotsRespErr } = await supabase
        .from('slots')
        .select('id, slot_date, start_time, end_time, available_capacity, booked_count, employee_id, shift_id, users:employee_id(full_name, full_name_ar)')
        .eq('shift_id', virtualShiftId)
        .eq('slot_date', dateStr)
        .eq('is_available', true)
        .order('start_time')
        .range(from, to);
      if (slotsRespErr) {
        logger.error('ensure-employee-based-slots: slotsFromDb fetch', slotsRespErr);
        return res.status(500).json({ error: slotsRespErr.message });
      }
      if (!page || page.length === 0) break;
      slotsFromDb.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    // Global time lock: do not return slots where employee is busy in that time (any service)
    // Safety: dedupe by employee/time window for response payload.
    // Pick the row with highest available capacity (then lowest booked_count) to avoid
    // inflated "spots left" in UI when historical duplicate rows exist.
    const dedupedSlotsMap = new Map<string, any>();
    for (const s of slotsFromDb) {
      const key = `${s.employee_id ?? ''}|${s.start_time}|${s.end_time}`;
      const prev = dedupedSlotsMap.get(key);
      if (!prev) {
        dedupedSlotsMap.set(key, s);
        continue;
      }
      const prevAvail = Number(prev.available_capacity ?? 0);
      const currAvail = Number(s.available_capacity ?? 0);
      const prevBooked = Number(prev.booked_count ?? 0);
      const currBooked = Number(s.booked_count ?? 0);
      if (currAvail > prevAvail || (currAvail === prevAvail && currBooked < prevBooked)) {
        dedupedSlotsMap.set(key, s);
      }
    }
    const dedupedSlotsFromDb = Array.from(dedupedSlotsMap.values()).sort((a: any, b: any) =>
      String(a.start_time || '').localeCompare(String(b.start_time || ''))
    );
    if (dedupedSlotsFromDb.length !== slotsFromDb.length) {
      logger.warn('ensure-employee-based-slots: duplicate rows deduped for response', {
        serviceId,
        dateStr,
        before: slotsFromDb.length,
        after: dedupedSlotsFromDb.length,
      });
    }

    const responseEmployeeIds = [...new Set(dedupedSlotsFromDb.map((s: any) => s.employee_id).filter(Boolean))];
    const responseBusyRangesByEmployee = await buildBusyRangesForEmployeeIds(responseEmployeeIds as string[]);
    mergeBusyRanges(responseBusyRangesByEmployee, globalBusyRangesByEmployee);
    const slotsForResponse = dedupedSlotsFromDb.filter((s: any) => {
      if (!s.employee_id) return true;
      const busyRanges = responseBusyRangesByEmployee.get(s.employee_id) || [];
      const sStart = (s.start_time || '').slice(0, 8);
      const sEnd = (s.end_time || '').slice(0, 8);
      const slotStartM = toMinutes(sStart);
      const slotEndEx = slotEndExclusiveMinutes(slotStartM, toMinutes(sEnd));
      const isBusy = busyRanges.some((r: { startM: number; endM: number }) =>
        intervalsOverlapExclusive(slotStartM, slotEndEx, r.startM, r.endM)
      );
      return !isBusy;
    });
    const payload: { shiftIds: string[]; slots?: any[]; employees?: { id: string; name: string; available_slots: any[] }[] } = {
      shiftIds: [virtualShiftId],
      slots: slotsForResponse.length > 0 ? slotsForResponse : undefined,
    };
    if (slotsForResponse.length > 0) {
      const byEmployee = new Map<string, any[]>();
      slotsForResponse.forEach((s: any) => {
        const eid = s.employee_id;
        if (!eid) return;
        if (!byEmployee.has(eid)) byEmployee.set(eid, []);
        byEmployee.get(eid)!.push(s);
      });
      payload.employees = Array.from(byEmployee.entries()).map(([id, slots]) => ({
        id,
        name: (slots[0]?.users as any)?.full_name || (slots[0]?.users as any)?.full_name_ar || '',
        available_slots: slots,
      }));
    }

    setEmployeeAvailabilityCached(tenantId, serviceId, dateStr, payload);
    return res.json(payload);
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

  let bookingTagIdForDb: string | null = null;
  let bookingAppliedTagFeeForDb = 0;
  let bookingEffectiveDurationMinutes = 0;
  let bookingRequiredSlotCount = 1;
  let bookingEffectiveStartTime: string | null = null;
  let bookingEffectiveEndTime: string | null = null;

  try {
    // RBAC: staff (non-customer) must have create_booking permission (resolve from DB so role changes take effect)
    const userRole = req.user?.role;
    if (userRole && userRole !== 'customer' && req.user?.id) {
      const perms = await getPermissionsForUserByUserId(supabase, req.user.id);
      if (!perms.includes('create_booking')) {
        return sendResponse(403, { error: 'You do not have permission to create bookings.' });
      }
    }

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
      consume_from_package: reqConsumeFromPackageRaw, // Optional: when false, force paid booking even if package has capacity
    } = req.body;
    const consumeFromPackage = reqConsumeFromPackageRaw !== false;
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

    // Resolve pricing tag/time impact before time-window validations.
    const isStaffBooking = !!(userRole && userRole !== 'customer');
    const tagRes = await resolveBookingTagForCreate(supabase, {
      tenantId: tenant_id,
      serviceId: service_id,
      tagIdFromClient: req.body.tag_id,
      requireExplicitTag: isStaffBooking,
    });
    if (tagRes.ok === false) {
      return sendResponse(tagRes.status, { error: tagRes.error });
    }
    bookingTagIdForDb = tagRes.tagId;

    // Guard against cross-service double-booking for the same employee/time.
    const selectedSlot = await getSlotWindowById(slot_id);
    if (!selectedSlot) {
      return sendResponse(404, { error: 'Selected slot not found' });
    }
    if (selectedSlot.tenantId !== tenant_id) {
      return sendResponse(403, { error: 'Selected slot does not belong to this tenant' });
    }
    const baseDurationMinutes = getSlotDurationMinutes(selectedSlot.startTime, selectedSlot.endTime);
    const durationMeta = computeTagAdjustedDuration(baseDurationMinutes, tagRes.slotCount);
    bookingEffectiveDurationMinutes = durationMeta.finalDurationMinutes;
    bookingRequiredSlotCount = durationMeta.requiredSlots;
    bookingEffectiveStartTime = selectedSlot.startTime;
    bookingEffectiveEndTime = addMinutesToTime(selectedSlot.startTime, bookingEffectiveDurationMinutes);
    const effectiveEmployeeIdForCreate = employee_id || selectedSlot.employeeId;
    if (effectiveEmployeeIdForCreate && bookingRequiredSlotCount > 1) {
      const hasConsecutive = await hasRequiredConsecutiveEmployeeSlots({
        tenantId: tenant_id,
        employeeId: effectiveEmployeeIdForCreate,
        slotDate: selectedSlot.slotDate,
        startTime: selectedSlot.startTime,
        requiredSlots: bookingRequiredSlotCount,
      });
      if (!hasConsecutive) {
        return sendResponse(409, {
          error: 'Not enough consecutive availability for selected tag duration.',
          code: 'INSUFFICIENT_CONSECUTIVE_SLOTS',
          required_slots: bookingRequiredSlotCount,
        });
      }
    }
    if (effectiveEmployeeIdForCreate) {
      const employeeConflict = await findEmployeeBookingConflict({
        tenantId: tenant_id,
        employeeId: effectiveEmployeeIdForCreate,
        slotDate: selectedSlot.slotDate,
        startTime: selectedSlot.startTime,
        endTime: bookingEffectiveEndTime,
      });
      if (employeeConflict) {
        return sendResponse(409, {
          error: 'Selected employee is already booked in another assigned service at this time.',
          code: 'EMPLOYEE_TIME_CONFLICT',
          conflict: {
            booking_id: employeeConflict.bookingId,
            slot_id: employeeConflict.slotId,
            slot_date: employeeConflict.slotDate,
            start_time: employeeConflict.startTime,
            end_time: employeeConflict.endTime,
          },
        });
      }
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
    if (customerIdForPackage && consumeFromPackage) {
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

    // ============================================================================
    // Pricing tag fee snapshot
    // ============================================================================
    bookingAppliedTagFeeForDb = paidQty > 0 ? tagRes.appliedFee : 0;
    finalTotalPrice = Number(finalTotalPrice) + bookingAppliedTagFeeForDb;

    // Use RPC for transaction - handles all validation, lock checking, and booking creation
    if (!consumeFromPackage) {
      console.log('[Booking Creation] Package consumption explicitly disabled by client.');
      packageSubscriptionId = null;
      packageCoveredQty = 0;
      paidQty = visitor_count;
      shouldUsePackage = false;
      // Force full paid pricing when package usage is disabled.
      // Use client total first; if missing/zero, fallback to service base price.
      let fullPaidBaseTotal = Number(total_price ?? 0);
      if (!Number.isFinite(fullPaidBaseTotal) || fullPaidBaseTotal <= 0) {
        const { data: fallbackService } = await supabase
          .from('services')
          .select('base_price')
          .eq('id', service_id)
          .single();
        const fallbackUnitPrice = Number(fallbackService?.base_price || 0);
        fullPaidBaseTotal = fallbackUnitPrice * visitor_count;
        console.warn(`[Booking Creation] ⚠️ total_price missing/zero with consume_from_package=false; using fallback base price`, {
          service_id,
          fallbackUnitPrice,
          visitor_count,
          fullPaidBaseTotal
        });
      }
      bookingAppliedTagFeeForDb = paidQty > 0 ? tagRes.appliedFee : 0;
      finalTotalPrice = Number(fullPaidBaseTotal) + Number(bookingAppliedTagFeeForDb || 0);
    }

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
          errorMessage.includes('Not enough tickets') ||
          errorMessage.includes('already booked in overlapping time window')) {
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
      if (req.user?.branch_id) {
        updatePayload.branch_id = req.user.branch_id;
      } else if (actualBooking.service_id) {
        const { data: firstBranch } = await supabase.from('service_branches').select('branch_id').eq('service_id', actualBooking.service_id).limit(1).maybeSingle();
        if (firstBranch?.branch_id) updatePayload.branch_id = firstBranch.branch_id;
      }
      if (bookingTagIdForDb) {
        updatePayload.tag_id = bookingTagIdForDb;
        updatePayload.applied_tag_fee = bookingAppliedTagFeeForDb;
      }
      if (bookingEffectiveStartTime && bookingEffectiveEndTime) {
        updatePayload.effective_start_time = bookingEffectiveStartTime;
        updatePayload.effective_end_time = bookingEffectiveEndTime;
        updatePayload.effective_duration_minutes = bookingEffectiveDurationMinutes;
        updatePayload.required_slot_count = bookingRequiredSlotCount;
      }
      if (Object.keys(updatePayload).length > 1) {
        const firstUpdate = await supabase.from('bookings').update(updatePayload).eq('id', actualBooking.id);
        if (firstUpdate.error && isMissingEffectiveBookingColumnError(firstUpdate.error)) {
          const { effective_start_time, effective_end_time, effective_duration_minutes, required_slot_count, ...fallbackPayload } = updatePayload as any;
          const fallbackUpdate = await supabase.from('bookings').update(fallbackPayload).eq('id', actualBooking.id);
          if (fallbackUpdate.error) {
            console.warn('[Booking Creation] ⚠️ Failed to update booking fallback payload', {
              bookingId: actualBooking.id,
              message: fallbackUpdate.error.message,
            });
          }
        }
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

    if (bookingRequiredSlotCount > 1 && effectiveEmployeeIdForCreate && selectedSlot?.slotDate) {
      const reserveRes = await reserveAdditionalConsecutiveEmployeeSlots({
        tenantId: tenant_id,
        employeeId: effectiveEmployeeIdForCreate,
        slotDate: selectedSlot.slotDate,
        startTime: selectedSlot.startTime,
        requiredSlots: bookingRequiredSlotCount,
        visitorCount: visitor_count,
      });
      if (!reserveRes.ok) {
        console.warn('[Booking Creation] ⚠️ Failed to reserve all extra slots for tag duration', {
          bookingId,
          requiredSlots: bookingRequiredSlotCount,
          reason: reserveRes.reason,
          reservedExtraSlotIds: reserveRes.reservedExtraSlotIds,
        });
      } else if (reserveRes.reservedExtraSlotIds.length > 0) {
        console.log('[Booking Creation] ✅ Reserved extra consecutive slots for tag duration', {
          bookingId,
          reservedExtraSlotIds: reserveRes.reservedExtraSlotIds,
        });
      }
    }

    console.log(`[Booking Creation] ✅ Booking created successfully: ${bookingId}`);
    console.log(`[Booking Creation]    Customer: ${customer_name}`);
    console.log(`[Booking Creation]    Email: ${customer_email || 'not provided'}`);
    console.log(`[Booking Creation]    Phone: ${normalizedPhone || customer_phone || 'not provided'}`);

    // Invoice in background: set pending so UI can show "Invoice is being prepared" (worker will process)
    // We enqueue a fallback queue job here because some deployments may still have
    // an older DB trigger that only handles payment_status='paid' (not 'paid_manual').
    const finalPriceAfterPackage = finalTotalPrice;
    const shouldCreateInvoice = (normalizedPhone || customer_phone || customer_email) && paidQty > 0 && finalPriceAfterPackage > 0;
    const createInvoiceNow = reqPaymentStatus !== 'unpaid' && reqPaymentStatus !== 'awaiting_payment';
    if (bookingId && shouldCreateInvoice && createInvoiceNow) {
      try {
        await supabase.from('bookings').update({ invoice_processing_status: 'pending' }).eq('id', bookingId);
        // Idempotent fallback enqueue: avoid duplicates if trigger already queued it.
        const { data: existingPendingJob } = await supabase
          .from('queue_jobs')
          .select('id')
          .eq('job_type', 'zoho_receipt')
          .in('status', ['pending', 'processing'])
          .contains('payload', { booking_id: bookingId })
          .limit(1)
          .maybeSingle();

        if (!existingPendingJob) {
          const { error: queueInsertError } = await supabase
            .from('queue_jobs')
            .insert({
              job_type: 'zoho_receipt',
              payload: {
                booking_id: bookingId,
                tenant_id,
                attempt: 0,
              },
              status: 'pending',
            });
          if (queueInsertError) {
            console.warn(`[Booking Creation] ⚠️ Failed to enqueue fallback invoice job for booking ${bookingId}:`, queueInsertError);
          } else {
            console.log(`[Booking Creation] ✅ Enqueued fallback invoice job for booking ${bookingId}`);
          }
        } else {
          console.log(`[Booking Creation] ℹ️ Invoice job already queued for booking ${bookingId}`);
        }
      } catch (_) { /* non-blocking */ }
    }

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
    
    // Ticket + invoice: run in background so booking response returns instantly (no blocking)
    ticketGenerationPromise.catch((error: any) => {
      console.error(`🎫 ⚠️ Ticket generation error (non-blocking):`, error?.message || error);
    });

    // Invoice is queued by DB trigger (paid/paid_manual) and processed by zohoReceiptWorker — no blocking here
    // This runs asynchronously so it doesn't block the booking response
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
    console.log(`[Booking Creation]    Invoice Creation: ${shouldCreateInvoice && createInvoiceNow ? 'QUEUED (background)' : shouldCreateInvoice ? 'SKIPPED (will run when marked paid)' : 'SKIPPED (package-covered or no contact)'}`);
    console.log(`[Booking Creation]    Ticket Rule: ✅ Booking ALWAYS created (even if free)`);
    console.log(`[Booking Creation] ========================================`);

    // Invalidate employee-based availability cache so next load reflects this booking (employee-based mode only)
    try {
      const slotId = req.body?.slot_id;
      const serviceId = req.body?.service_id;
      if (tenant_id && serviceId && slotId) {
        const { data: slotRow } = await supabase.from('slots').select('slot_date').eq('id', slotId).single();
        if ((slotRow as any)?.slot_date) {
          invalidateEmployeeAvailability(tenant_id, serviceId, (slotRow as any).slot_date);
        }
      }
    } catch (_) { /* non-blocking */ }

    // Return the booking with proper structure (include invoice_processing_status so UI can show "Invoice is being prepared")
    const responsePayload: any = {
      id: bookingId,
      ...actualBooking,
      booking: actualBooking,
    };
    if (shouldCreateInvoice && createInvoiceNow && bookingId) {
      responsePayload.invoice_processing_status = 'pending';
    }
    return sendResponse(201, responsePayload);
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
  let bulkTagId: string | null = null;
  let bulkAppliedFeeTotal = 0;
  let bulkEffectiveDurationMinutes = 0;
  let bulkRequiredSlotCount = 1;

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
      transaction_reference: reqTransactionRef,
      consume_from_package: reqConsumeFromPackageRaw
    } = req.body;
    const consumeFromPackage = reqConsumeFromPackageRaw !== false;

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
    if (customerIdForPackage && consumeFromPackage) {
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

    if (!consumeFromPackage) {
      console.log('[Bulk Booking Creation] Package consumption explicitly disabled by client.');
      packageSubscriptionId = null;
      packageCoveredQty = 0;
      paidQty = visitor_count;
      shouldUsePackage = false;
      // Force full paid pricing when package usage is disabled.
      // Use client total first; if missing/zero, fallback to service base price.
      let fullPaidBaseTotal = Number(total_price ?? 0);
      if (!Number.isFinite(fullPaidBaseTotal) || fullPaidBaseTotal <= 0) {
        const { data: fallbackService } = await supabase
          .from('services')
          .select('base_price')
          .eq('id', service_id)
          .single();
        const fallbackUnitPrice = Number(fallbackService?.base_price || 0);
        fullPaidBaseTotal = fallbackUnitPrice * visitor_count;
        console.warn(`[Bulk Booking Creation] ⚠️ total_price missing/zero with consume_from_package=false; using fallback base price`, {
          service_id,
          fallbackUnitPrice,
          visitor_count,
          fullPaidBaseTotal
        });
      }
      finalTotalPrice = Number(fullPaidBaseTotal);
    }

    const bulkTagRes = await resolveBookingTagForCreate(supabase, {
      tenantId: tenant_id,
      serviceId: service_id,
      tagIdFromClient: req.body.tag_id,
      requireExplicitTag: true,
    });
    if (bulkTagRes.ok === false) {
      return res.status(bulkTagRes.status).json({ error: bulkTagRes.error });
    }
    bulkTagId = bulkTagRes.tagId;
    bulkAppliedFeeTotal = paidQty > 0 ? bulkTagRes.appliedFee : 0;
    finalTotalPrice = Number(finalTotalPrice) + bulkAppliedFeeTotal;

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
        .select('id, tenant_id, slot_date, start_time, end_time, employee_id, available_capacity, is_available')
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

      const firstSlotForDuration = slotsData[0] as any;
      const bulkBaseDuration = getSlotDurationMinutes(firstSlotForDuration.start_time, firstSlotForDuration.end_time);
      const bulkDurationMeta = computeTagAdjustedDuration(bulkBaseDuration, bulkTagRes.slotCount);
      bulkEffectiveDurationMinutes = bulkDurationMeta.finalDurationMinutes;
      bulkRequiredSlotCount = bulkDurationMeta.requiredSlots;

      const requestedEmployeeWindows = slotsData
        .map((s: any) => ({
          slotId: s.id as string,
          slotDate: s.slot_date as string,
          startTime: s.start_time as string,
          endTime: addMinutesToTime(s.start_time as string, bulkEffectiveDurationMinutes),
          employeeId: (employee_id || s.employee_id || null) as string | null,
        }))
        .filter((s: any) => Boolean(s.employeeId && s.slotDate && s.startTime && s.endTime));

      for (const slotWindow of requestedEmployeeWindows) {
        if (bulkRequiredSlotCount <= 1) break;
        const hasConsecutive = await hasRequiredConsecutiveEmployeeSlots({
          tenantId: tenant_id,
          employeeId: slotWindow.employeeId!,
          slotDate: slotWindow.slotDate,
          startTime: slotWindow.startTime,
          requiredSlots: bulkRequiredSlotCount,
        });
        if (!hasConsecutive) {
          return res.status(409).json({
            error: 'Not enough consecutive availability for selected tag duration.',
            code: 'INSUFFICIENT_CONSECUTIVE_SLOTS',
            required_slots: bulkRequiredSlotCount,
            requested_slot_id: slotWindow.slotId,
          });
        }
      }

      // Prevent internal overlap in this same bulk request for the same employee.
      for (let i = 0; i < requestedEmployeeWindows.length; i++) {
        const a = requestedEmployeeWindows[i];
        for (let j = i + 1; j < requestedEmployeeWindows.length; j++) {
          const b = requestedEmployeeWindows[j];
          if (a.employeeId !== b.employeeId) continue;
          const overlap = findOverlappingBooking(
            { slotDate: a.slotDate, startTime: a.startTime, endTime: a.endTime },
            [{ slotDate: b.slotDate, startTime: b.startTime, endTime: b.endTime }]
          );
          if (overlap) {
            return res.status(409).json({
              error: 'Bulk booking contains overlapping time slots for the same employee.',
              code: 'EMPLOYEE_TIME_CONFLICT',
              conflict: {
                employee_id: a.employeeId,
                first_slot_id: a.slotId,
                second_slot_id: b.slotId,
              },
            });
          }
        }
      }

      // Prevent overlap with already-booked slots (any service) for each requested employee/time.
      for (const slotWindow of requestedEmployeeWindows) {
        const existingConflict = await findEmployeeBookingConflict({
          tenantId: tenant_id,
          employeeId: slotWindow.employeeId!,
          slotDate: slotWindow.slotDate,
          startTime: slotWindow.startTime,
          endTime: slotWindow.endTime,
        });
        if (existingConflict) {
          return res.status(409).json({
            error: 'Selected employee is already booked in another assigned service at this time.',
            code: 'EMPLOYEE_TIME_CONFLICT',
            conflict: {
              employee_id: slotWindow.employeeId,
              requested_slot_id: slotWindow.slotId,
              booking_id: existingConflict.bookingId,
              slot_id: existingConflict.slotId,
              slot_date: existingConflict.slotDate,
              start_time: existingConflict.startTime,
              end_time: existingConflict.endTime,
            },
          });
        }
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
          createError.message.includes('Not enough tickets') ||
          createError.message.includes('already booked in overlapping time window')) {
        return res.status(409).json({ error: createError.message });
      }
      // Return 500 with message so client sees DB/RPC errors (e.g. payment_status enum or created_by_user_id FK)
      return res.status(500).json({
        error: createError.message || 'Bulk booking failed',
        hint: (createError.message && (createError.message.includes('payment_status') || createError.message.includes('created_by_user_id') || createError.message.includes('foreign key')))
          ? 'Apply migration 20260225100000_fix_bulk_booking_payment_status_cast.sql on your database.'
          : undefined,
      });
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

    // Invalidate employee-based availability cache for each (service_id, date) affected (employee-based mode only)
    try {
      const slotIds = [...new Set((bookings as any[]).map((b: any) => b.slot_id).filter(Boolean))];
      if (slotIds.length > 0 && tenant_id) {
        const { data: slotRows } = await supabase.from('slots').select('id, slot_date').in('id', slotIds);
        const slotDateById = new Map((slotRows || []).map((s: any) => [s.id, s.slot_date]));
        const invalidated = new Set<string>();
        for (const b of bookings as any[]) {
          if (!b.service_id) continue;
          const dateStr = slotDateById.get(b.slot_id);
          if (!dateStr) continue;
          const key = `${b.service_id}:${dateStr}`;
          if (invalidated.has(key)) continue;
          invalidated.add(key);
          invalidateEmployeeAvailability(tenant_id, b.service_id, dateStr);
        }
      }
    } catch (_) { /* non-blocking */ }

    // Store payment_method + transaction_reference + payment_status when provided; set branch_id for income tracking
    if (bookingIds.length > 0) {
      const bulkUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
      if (reqPaymentMethod === 'onsite' || reqPaymentMethod === 'transfer') {
        bulkUpdate.payment_method = reqPaymentMethod;
        bulkUpdate.transaction_reference = reqPaymentMethod === 'transfer' && reqTransactionRef ? String(reqTransactionRef).trim() : null;
        bulkUpdate.payment_status = 'paid_manual'; // Mark all bulk bookings as paid when user selected Paid On Site or Bank Transfer
      }
      if (req.user?.branch_id) bulkUpdate.branch_id = req.user.branch_id;
      await supabase.from('bookings').update(bulkUpdate).in('id', bookingIds);
    }

    if (bookingIds.length > 0 && bulkTagId) {
      const { data: bRows } = await supabase
        .from('bookings')
        .select('id, paid_quantity, slot_id, employee_id, slots:slot_id(slot_date, start_time)')
        .in('id', bookingIds)
        .order('created_at', { ascending: true });
      const paidIds = (bRows || []).filter((b: any) => Number(b.paid_quantity ?? 0) > 0).map((b: any) => b.id);
      const feeByBookingId = new Map<string, number>();
      const n = paidIds.length;
      if (n > 0) {
        const total = bulkAppliedFeeTotal;
        let allocated = 0;
        for (let i = 0; i < n; i++) {
          const id = paidIds[i];
          const isLast = i === n - 1;
          const part = isLast ? Math.round((total - allocated) * 100) / 100 : Math.round((total / n) * 100) / 100;
          allocated = Math.round((allocated + part) * 100) / 100;
          feeByBookingId.set(id, part);
        }
      }
      for (const row of bRows || []) {
        const slot = Array.isArray((row as any).slots) ? (row as any).slots[0] : (row as any).slots;
        const startTime = slot?.start_time ? String(slot.start_time) : null;
        const updatePayload: Record<string, unknown> = {
          tag_id: bulkTagId,
          applied_tag_fee: feeByBookingId.get((row as any).id) ?? 0,
          effective_duration_minutes: bulkEffectiveDurationMinutes,
          required_slot_count: bulkRequiredSlotCount,
        };
        if (startTime) {
          updatePayload.effective_start_time = startTime;
          updatePayload.effective_end_time = addMinutesToTime(startTime, bulkEffectiveDurationMinutes);
        }
        const upd = await supabase.from('bookings').update(updatePayload).eq('id', (row as any).id);
        if (upd.error && isMissingEffectiveBookingColumnError(upd.error)) {
          const { effective_start_time, effective_end_time, effective_duration_minutes, required_slot_count, ...fallbackPayload } = updatePayload as any;
          const fallbackUpdate = await supabase.from('bookings').update(fallbackPayload).eq('id', (row as any).id);
          if (fallbackUpdate.error) {
            console.warn('[Bulk Booking Creation] ⚠️ Failed to update booking fallback payload', {
              bookingId: (row as any).id,
              message: fallbackUpdate.error.message,
            });
          }
        }
        if (bulkRequiredSlotCount > 1 && (row as any).employee_id && slot?.slot_date && startTime) {
          const reserveRes = await reserveAdditionalConsecutiveEmployeeSlots({
            tenantId: tenant_id,
            employeeId: String((row as any).employee_id),
            slotDate: String(slot.slot_date),
            startTime,
            requiredSlots: bulkRequiredSlotCount,
            visitorCount: 1,
          });
          if (!reserveRes.ok) {
            console.warn('[Bulk Booking Creation] ⚠️ Failed to reserve extra slots for booking row', {
              bookingId: (row as any).id,
              reason: reserveRes.reason,
              reservedExtraSlotIds: reserveRes.reservedExtraSlotIds,
            });
          }
        }
      }
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
          
          const { invoiceRoutingService } = await import('../services/invoiceRoutingService.js');
          
          // Generate invoice for the booking group (uses first booking ID as reference)
          // The generateReceiptForBookingGroup function will check paid_quantity internally
          const invoiceResult = await invoiceRoutingService.generateReceiptForBookingGroup(bookingGroupId);
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

    // Tickets feature must be enabled for this tenant
    if (!(await requireTicketsEnabled(userData.tenant_id, res))) return;

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
        tenant_id,
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
          currency_code,
          tickets_enabled
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

    // Tickets feature must be enabled for this tenant (block ticket/view access when disabled)
    const tenantsRow = (booking as any).tenants;
    if (tenantsRow && tenantsRow.tickets_enabled === false) {
      const userAgent = req.headers['user-agent'] || '';
      const isBrowser = userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari') || userAgent.includes('Firefox') || userAgent.includes('Edge');
      const acceptsJson = req.headers.accept?.includes('application/json');
      if (isBrowser && !acceptsJson) {
        return res.status(403).send(`
          <!DOCTYPE html>
          <html>
          <head><title>Tickets Unavailable</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>body{font-family:Arial,sans-serif;text-align:center;padding:50px;background:#f5f5f5}.container{background:white;padding:30px;border-radius:10px;max-width:500px;margin:0 auto}h1{color:#e67e22}</style>
          </head>
          <body>
            <div class="container">
              <h1>Tickets are currently unavailable</h1>
              <p>Please contact us for more information.</p>
            </div>
          </body>
          </html>
        `);
      }
      return res.status(403).json({ error: TICKETS_DISABLED_MESSAGE });
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
      formatted_start_time: formatTimeTo12Hour((booking.slots as any).start_time || ''),
      formatted_end_time: formatTimeTo12Hour((booking.slots as any).end_time || ''),
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

    // RBAC: enforce permissions from DB so role/category changes take effect without re-login
    const perms = await getPermissionsForUserByUserId(supabase, userId);
    const isCancelling = updateData && (updateData.status === 'cancelled' || (typeof updateData.status === 'string' && updateData.status.trim() === 'cancelled'));
    const onlyConfirming = req.user!.role === 'coordinator' && updateData && Object.keys(updateData).filter(k => !['status', 'updated_at', 'status_changed_at'].includes(k)).length === 0 && updateData.status === 'confirmed';
    const onlyEmployeeCompleting = req.user!.role === 'employee' && updateData && Object.keys(updateData).filter(k => !['status', 'updated_at', 'status_changed_at'].includes(k)).length === 0 && updateData.status === 'completed';
    if (isCancelling) {
      if (!perms.includes('cancel_booking') && !perms.includes('manage_bookings')) {
        return res.status(403).json({ error: 'You do not have permission to cancel bookings.' });
      }
    } else if (!onlyConfirming && !onlyEmployeeCompleting) {
      if (!perms.includes('edit_booking') && !perms.includes('manage_bookings')) {
        return res.status(403).json({ error: 'You do not have permission to edit bookings.' });
      }
    }
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

    // Employee: may only set status to 'completed' for bookings assigned to them
    const isEmployee = req.user!.role === 'employee';
    if (isEmployee) {
      if (currentBooking.employee_id !== userId) {
        return res.status(403).json({ error: 'Access denied. You can only complete your own assigned bookings.' });
      }
      const body = req.body || {};
      const keys = Object.keys(body).filter(k => k !== 'updated_at' && k !== 'status_changed_at');
      const onlyCompleted = keys.length === 1 && keys[0] === 'status' && body.status === 'completed';
      if (!onlyCompleted) {
        return res.status(403).json({
          error: 'Access denied. Employees can only mark bookings as completed.',
          hint: 'Send { status: "completed" } only.'
        });
      }
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
      'service_id',
      'tag_id',
      'applied_tag_fee',
      'package_subscription_id',
      'package_covered_quantity',
      'paid_quantity',
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

    // Explicitly apply status when client sends it (e.g. cancelled) so it is never dropped
    if (typeof updateData.status === 'string' && updateData.status.trim() !== '') {
      updatePayload.status = updateData.status.trim();
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

    // Validate service_id change (must belong to same tenant)
    if (updatePayload.service_id && updatePayload.service_id !== currentBooking.service_id) {
      const { data: targetService, error: targetServiceError } = await supabase
        .from('services')
        .select('id, tenant_id, is_active')
        .eq('id', updatePayload.service_id)
        .maybeSingle();
      if (targetServiceError || !targetService) {
        return res.status(404).json({ error: 'Selected service not found' });
      }
      if ((targetService as any).tenant_id !== tenantId) {
        return res.status(403).json({ error: 'Selected service belongs to a different tenant' });
      }
      if ((targetService as any).is_active === false) {
        return res.status(400).json({ error: 'Selected service is not active' });
      }
    }

    // Validate tag_id change (must be assigned to effective service within same tenant)
    const effectiveServiceId = updatePayload.service_id || currentBooking.service_id;
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'tag_id')) {
      if (!updatePayload.tag_id) {
        updatePayload.tag_id = null;
        updatePayload.applied_tag_fee = 0;
      } else {
        const { data: assignedRows, error: assignedRowsError } = await supabase
          .from('service_tag_assignments')
          .select('service_id, tag_id')
          .eq('service_id', effectiveServiceId)
          .limit(100);
        if (assignedRowsError || !assignedRows?.length) {
          return res.status(404).json({ error: 'Selected pricing tag is not assigned to this service' });
        }
        const assignedTagIds = new Set(
          assignedRows
            .map((row: any) => String(row?.tag_id || ''))
            .filter(Boolean),
        );
        if (!assignedTagIds.has(String(updatePayload.tag_id))) {
          return res.status(404).json({ error: 'Selected pricing tag is not assigned to this service' });
        }
        const { data: matchedFee, error: matchedFeeError } = await supabase
          .from('tag_fees')
          .select('tag_id, fee_value')
          .eq('tag_id', updatePayload.tag_id)
          .maybeSingle();
        if (matchedFeeError) {
          return res.status(500).json({ error: 'Failed to resolve pricing tag fee' });
        }
        if (!Object.prototype.hasOwnProperty.call(updatePayload, 'applied_tag_fee')) {
          updatePayload.applied_tag_fee = Math.max(0, Number((matchedFee as any)?.fee_value ?? 0));
        }
      }
    }

    // Normalize numeric pricing/package fields
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'applied_tag_fee')) {
      updatePayload.applied_tag_fee = Math.max(0, Number(updatePayload.applied_tag_fee) || 0);
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'package_covered_quantity')) {
      updatePayload.package_covered_quantity = Math.max(0, Math.floor(Number(updatePayload.package_covered_quantity) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'paid_quantity')) {
      updatePayload.paid_quantity = Math.max(0, Math.floor(Number(updatePayload.paid_quantity) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'package_subscription_id')) {
      updatePayload.package_subscription_id = updatePayload.package_subscription_id || null;
    }

    // Satisfy bookings_package_price_check: (package_covered_quantity < visitor_count) OR (total_price = 0)
    // When setting a non-zero total_price, ensure the booking is not fully package-covered.
    const newTotalPrice = updatePayload.total_price !== undefined ? Number(updatePayload.total_price) : undefined;
    const visitorCount = updatePayload.visitor_count ?? currentBooking.visitor_count;
    const nextPackageCovered = updatePayload.package_covered_quantity !== undefined
      ? Number(updatePayload.package_covered_quantity || 0)
      : Number(currentBooking.package_covered_quantity || 0);
    if (newTotalPrice !== undefined && newTotalPrice > 0 && visitorCount > 0 && nextPackageCovered >= visitorCount) {
      updatePayload.package_covered_quantity = 0;
      updatePayload.paid_quantity = visitorCount;
    }

    // When price is edited to a new non-zero value, we regenerate the invoice (void old if any, create new, record payment, send).
    // Do not clear zoho_invoice_id here so regenerateInvoiceForBooking can void the old invoice.
    const priceChanged = newTotalPrice !== undefined && Number(currentBooking.total_price) !== newTotalPrice && newTotalPrice > 0;

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

    // Invalidate employee-based availability cache after any booking update.
    // This covers employee re-assignment, service/slot/date changes, and cancellations.
    try {
      const oldServiceId = currentBooking.service_id || null;
      const newServiceId = (updatedBooking as any)?.service_id || oldServiceId;
      const slotIdsForDates = Array.from(
        new Set(
          [currentBooking.slot_id, (updatedBooking as any)?.slot_id]
            .filter(Boolean)
            .map((id) => String(id))
        )
      );
      const slotDateById = new Map<string, string>();
      if (slotIdsForDates.length > 0) {
        const { data: slotRows } = await supabase
          .from('slots')
          .select('id, slot_date')
          .in('id', slotIdsForDates);
        for (const row of slotRows || []) {
          if ((row as any)?.id && (row as any)?.slot_date) {
            slotDateById.set(String((row as any).id), String((row as any).slot_date));
          }
        }
      }
      const oldDate = currentBooking.slot_id ? slotDateById.get(String(currentBooking.slot_id)) : null;
      const newDate = (updatedBooking as any)?.slot_id ? slotDateById.get(String((updatedBooking as any).slot_id)) : null;

      if (oldServiceId) {
        if (oldDate) invalidateEmployeeAvailability(tenantId, oldServiceId, oldDate);
        else invalidateEmployeeAvailability(tenantId, oldServiceId);
      }
      if (newServiceId && (newServiceId !== oldServiceId || newDate !== oldDate)) {
        if (newDate) invalidateEmployeeAvailability(tenantId, newServiceId, newDate);
        else invalidateEmployeeAvailability(tenantId, newServiceId);
      }
    } catch (_) { /* non-blocking */ }

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

    // When price was edited to a new non-zero value: regenerate invoice (void old if any, create new with new amount, record payment, send)
    // Skip invoice regeneration when booking was just set to cancelled
    const wasCancelled = updatePayload.status === 'cancelled';
    if (priceChanged && updatedBooking && Number(updatedBooking.total_price) > 0 && !wasCancelled) {
      setImmediate(async () => {
        try {
          const { zohoService } = await import('../services/zohoService.js');
          logger.info('Booking price edited: regenerating invoice and sending', { bookingId });
          const result = await zohoService.regenerateInvoiceForBooking(bookingId);
          if (result.success) {
            await supabase
              .from('bookings')
              .update({ zoho_sync_status: 'synced', updated_at: new Date().toISOString() })
              .eq('id', bookingId);
            logger.info('Invoice regenerated and sent after price edit', { bookingId, invoiceId: result.invoiceId });
          } else {
            await supabase
              .from('bookings')
              .update({ zoho_sync_status: 'pending', updated_at: new Date().toISOString() })
              .eq('id', bookingId);
            logger.warn('Invoice regeneration after price edit failed (non-blocking)', { bookingId, error: result.error });
          }
        } catch (e: any) {
          await supabase
            .from('bookings')
            .update({ zoho_sync_status: 'pending', updated_at: new Date().toISOString() })
            .eq('id', bookingId);
          logger.error('Invoice regeneration after price edit error (non-blocking)', { bookingId, error: e?.message });
        }
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
      message: slotChanged
        ? 'Booking rescheduled successfully. New ticket has been sent to customer.'
        : priceChanged && Number(updatedBooking?.total_price) > 0
          ? 'Booking updated. Invoice is being regenerated with the new amount and will be sent shortly.'
          : 'Booking updated successfully',
      slot_changed: slotChanged,
      invoice_created: priceChanged && Number(updatedBooking?.total_price) > 0,
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

    const { data: currentBookingForConflict, error: currentBookingFetchError } = await supabase
      .from('bookings')
      .select('id, tenant_id, employee_id, service_id, slot_id')
      .eq('id', bookingId)
      .single();
    if (currentBookingFetchError || !currentBookingForConflict) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    if ((currentBookingForConflict as any).tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Booking belongs to a different tenant' });
    }

    const newSlotForConflict = await getSlotWindowById(newSlotId);
    if (!newSlotForConflict) {
      return res.status(404).json({ error: 'Selected new slot not found' });
    }
    if (newSlotForConflict.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Selected new slot belongs to a different tenant' });
    }

    const effectiveEmployeeIdForEdit = resolveEmployeeForBookingTimeEdit({
      newSlotEmployeeId: newSlotForConflict.employeeId,
      currentBookingEmployeeId: (currentBookingForConflict as any).employee_id,
    });
    if (effectiveEmployeeIdForEdit) {
      const editConflict = await findEmployeeBookingConflict({
        tenantId,
        employeeId: effectiveEmployeeIdForEdit,
        slotDate: newSlotForConflict.slotDate,
        startTime: newSlotForConflict.startTime,
        endTime: newSlotForConflict.endTime,
        excludeBookingId: bookingId,
      });
      if (editConflict) {
        return res.status(409).json({
          error: 'Selected employee is already booked in another assigned service at this time.',
          code: 'EMPLOYEE_TIME_CONFLICT',
          conflict: {
            booking_id: editConflict.bookingId,
            slot_id: editConflict.slotId,
            slot_date: editConflict.slotDate,
            start_time: editConflict.startTime,
            end_time: editConflict.endTime,
          },
        });
      }
    }

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
          editError.message.includes('Not enough capacity') ||
          editError.message.includes('already booked in overlapping time window')) {
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
          slots:slot_id (slot_date, start_time, end_time, employee_id),
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
          slots:slot_id (slot_date, start_time, end_time, employee_id),
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

    // Invalidate employee-based availability cache for both old/new service+date.
    // This prevents stale "employee is busy" state after reassignment/reschedule.
    try {
      const oldServiceId = (currentBookingForConflict as any)?.service_id || null;
      const newServiceId = (updatedBooking as any)?.service_id || oldServiceId;

      let oldDate: string | null = null;
      const oldSlotId = (currentBookingForConflict as any)?.slot_id || null;
      if (oldSlotId) {
        const { data: oldSlotRow } = await supabase
          .from('slots')
          .select('slot_date')
          .eq('id', oldSlotId)
          .maybeSingle();
        oldDate = ((oldSlotRow as any)?.slot_date as string | undefined) || null;
      }
      const newDate = ((updatedBooking as any)?.slots?.slot_date as string | undefined) || oldDate;

      if (oldServiceId) {
        if (oldDate) invalidateEmployeeAvailability(tenantId, oldServiceId, oldDate);
        else invalidateEmployeeAvailability(tenantId, oldServiceId);
      }
      if (newServiceId && (newServiceId !== oldServiceId || newDate !== oldDate)) {
        if (newDate) invalidateEmployeeAvailability(tenantId, newServiceId, newDate);
        else invalidateEmployeeAvailability(tenantId, newServiceId);
      }
    } catch (_) { /* non-blocking */ }

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
router.delete('/:id', authenticateTenantAdminOrBookingEditForDelete, async (req, res) => {
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
    let slotDateForCache: string | null = null;
    if (currentBooking.status === 'pending' || currentBooking.status === 'confirmed') {
      // Fetch the slot to get current capacity values (and slot_date for cache invalidation)
      const { data: slotData, error: slotFetchError } = await supabase
        .from('slots')
        .select('available_capacity, booked_count, original_capacity, slot_date')
        .eq('id', currentBooking.slot_id)
        .single();

      if (!slotFetchError && slotData) {
        if ((slotData as any).slot_date) slotDateForCache = (slotData as any).slot_date;
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

    // Invalidate employee-based availability cache for this service/date (employee-based mode only)
    try {
      if (currentBooking.service_id && tenantId) {
        let dateStr = slotDateForCache ?? null;
        if (!dateStr) {
          const { data: s } = await supabase.from('slots').select('slot_date').eq('id', currentBooking.slot_id).single();
          dateStr = (s as any)?.slot_date ?? null;
        }
        if (dateStr) invalidateEmployeeAvailability(tenantId, currentBooking.service_id, dateStr);
      }
    } catch (_) { /* non-blocking */ }

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
router.patch('/:id/payment-status', authenticateAdminOrReceptionistForPaymentStatus, async (req, res) => {
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

    if ((payment_status === 'paid' || payment_status === 'paid_manual') && payMethod === 'transfer' && !refNum) {
      return res.status(400).json({ error: 'transaction_reference is required when payment method is transfer (حوالة)' });
    }

    const updatePayload: Record<string, any> = {
      payment_status,
      updated_at: new Date().toISOString(),
    };
    if (payment_status === 'paid' || payment_status === 'paid_manual') {
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

    const { getInvoiceProviderForTenant } = await import('../services/invoiceRoutingService.js');
    const invoiceProvider = await getInvoiceProviderForTenant(tenantId);
    let zohoSyncResult: { success: boolean; error?: string; paymentId?: string; pending?: boolean; message?: string } | null =
      invoiceProvider === 'zoho' ? null : { success: true };
    let invoiceSendWarning: string | undefined;
    let invoiceId = currentBooking.zoho_invoice_id || (currentBooking as any).daftra_invoice_id;
    const totalPrice = Number((updatedBooking || currentBooking).total_price) || 0;
    const phone = (updatedBooking || currentBooking).customer_phone || '';

    const isPaidOrPaidManual = payment_status === 'paid' || payment_status === 'paid_manual';
    const paymentMethodOrRefChanged =
      (currentBooking.payment_method !== payMethod) ||
      (refNum !== ((currentBooking.transaction_reference || '').trim()));
    /** Invoice id for the active provider only (avoid treating a legacy id as “has invoice” for the wrong backend). */
    const primaryInvoiceIdForProvider =
      invoiceProvider === 'daftra'
        ? (currentBooking as any).daftra_invoice_id
        : currentBooking.zoho_invoice_id;
    const shouldRegenerateInvoice =
      isPaidOrPaidManual &&
      totalPrice > 0 &&
      !!primaryInvoiceIdForProvider &&
      paymentMethodOrRefChanged;
    const shouldCreateInvoiceAndRecordPayment =
      isPaidOrPaidManual &&
      totalPrice > 0 &&
      (isBecomingPaid || (payMethod === 'transfer' && refNum)) &&
      !shouldRegenerateInvoice;

    let invoiceCreateError: string | undefined;
    if (shouldRegenerateInvoice) {
      // Run regeneration in background (Zoho + Daftra) so the HTTP response returns quickly.
      if (invoiceProvider === 'zoho') {
        zohoSyncResult = { success: true, pending: true, message: 'Invoice is being regenerated and will be sent when ready.' };
      }
      setImmediate(async () => {
        try {
          const { invoiceRoutingService } = await import('../services/invoiceRoutingService.js');
          const regenResult = await invoiceRoutingService.regenerateInvoiceForBooking(bookingId);
          if (invoiceProvider === 'zoho') {
            if (regenResult.success) {
              await supabase
                .from('bookings')
                .update({ zoho_sync_status: 'synced', updated_at: new Date().toISOString() })
                .eq('id', bookingId);
            } else {
              await supabase
                .from('bookings')
                .update({ zoho_sync_status: 'pending', updated_at: new Date().toISOString() })
                .eq('id', bookingId);
              logger.error('Background invoice regeneration failed', { bookingId, error: regenResult.error });
            }
          } else if (invoiceProvider === 'daftra' && !regenResult.success) {
            logger.error('Background Daftra invoice regeneration failed', { bookingId, error: regenResult.error });
          }
        } catch (e: any) {
          if (invoiceProvider === 'zoho') {
            await supabase
              .from('bookings')
              .update({ zoho_sync_status: 'pending', updated_at: new Date().toISOString() })
              .eq('id', bookingId);
          }
          logger.error('Background invoice regeneration threw', { bookingId, error: e?.message });
        }
      });
    }
    if (!invoiceId && totalPrice > 0 && shouldCreateInvoiceAndRecordPayment) {
      try {
        const { invoiceRoutingService } = await import('../services/invoiceRoutingService.js');
        const invoiceResult = await invoiceRoutingService.generateReceipt(bookingId);
        if (invoiceResult.success && invoiceResult.invoiceId) {
          invoiceId = invoiceResult.invoiceId;
          const { data: refetch } = await supabase
            .from('bookings')
            .select('zoho_invoice_id, daftra_invoice_id')
            .eq('id', bookingId)
            .single();
          if (refetch?.zoho_invoice_id) invoiceId = refetch.zoho_invoice_id;
          else if (refetch?.daftra_invoice_id) invoiceId = refetch.daftra_invoice_id;
        } else {
          invoiceCreateError = invoiceResult.error || 'Invoice creation failed';
        }
      } catch (e: any) {
        invoiceCreateError = e?.message || 'Invoice creation failed';
        logger.error('Create invoice on mark paid failed (non-blocking)', { bookingId, error: invoiceCreateError });
      }
    }

    if (invoiceProvider === 'zoho' && shouldCreateInvoiceAndRecordPayment && invoiceId && totalPrice > 0) {
      const { zohoService } = await import('../services/zohoService.js');
      const { data: idRow } = await supabase
        .from('bookings')
        .select('zoho_invoice_id')
        .eq('id', bookingId)
        .maybeSingle();
      const zohoInvoiceIdOnly = idRow?.zoho_invoice_id;

      if (zohoInvoiceIdOnly) {
        const paymentMode = payMethod === 'transfer' ? ('banktransfer' as const) : ('cash' as const);
        const referenceNumber = payMethod === 'transfer' ? refNum : 'Paid On Site';

        try {
          const recordResult = await zohoService.recordCustomerPayment(
            tenantId,
            zohoInvoiceIdOnly,
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
            await zohoService.sendInvoiceViaWhatsApp(tenantId, zohoInvoiceIdOnly, phone.trim(), invoiceMessage);
          } catch (waErr: any) {
            logger.error('Send invoice via WhatsApp failed (non-blocking)', { bookingId, error: waErr?.message });
            if (waErr?.message?.includes('payment has not been completed')) {
              invoiceSendWarning = 'Invoice cannot be sent because payment has not been completed.';
            }
          }
        }
      }
    } else if (
      invoiceProvider === 'zoho' &&
      invoiceId &&
      !shouldCreateInvoiceAndRecordPayment &&
      !shouldRegenerateInvoice &&
      isPaidOrPaidManual
    ) {
      try {
        const { zohoService } = await import('../services/zohoService.js');
        const { data: zRow } = await supabase.from('bookings').select('zoho_invoice_id').eq('id', bookingId).maybeSingle();
        if (zRow?.zoho_invoice_id) {
          zohoSyncResult = await zohoService.updateInvoiceStatus(tenantId, zRow.zoho_invoice_id, payment_status);
        }
      } catch (zohoError: any) {
        zohoSyncResult = { success: false, error: zohoError.message };
      }
    }

    const zohoSyncPayload = invoiceProvider === 'zoho'
      ? (zohoSyncResult ?? (shouldCreateInvoiceAndRecordPayment && !invoiceId
          ? { success: false as const, error: invoiceCreateError || 'Invoice could not be created. Check Zoho configuration in Settings → Zoho Integration (Connect Zoho and complete OAuth).' }
          : { success: false as const, error: invoiceId ? 'Zoho sync failed. Check Settings → Zoho Integration.' : 'No invoice to sync. Create an invoice first or check Zoho setup in Settings.' }))
      : null;
    const isPendingRegen =
      shouldRegenerateInvoice &&
      (invoiceProvider === 'zoho'
        ? (zohoSyncPayload as { pending?: boolean } | null)?.pending === true
        : true);
    const responsePayload: Record<string, unknown> = {
      success: true,
      booking: updatedBooking,
      message: isPendingRegen
        ? 'Payment updated. Invoice is being regenerated and will be sent shortly.'
        : payment_status === 'paid' || payment_status === 'paid_manual'
          ? 'Payment status updated. Invoice sent via WhatsApp when applicable.'
          : 'Payment status updated',
    };
    if (invoiceProvider === 'zoho' && zohoSyncPayload) {
      responsePayload.zoho_sync = zohoSyncPayload;
    }
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
    let invoiceId = currentBooking.zoho_invoice_id || (currentBooking as any).daftra_invoice_id;
    const totalPrice = Number(updatedBooking?.total_price || currentBooking.total_price) || 0;
    const phone = (updatedBooking?.customer_phone || currentBooking.customer_phone || '').trim();

    // If no invoice yet (e.g. booking was created as unpaid), create invoice first then record payment and send
    if (!invoiceId && totalPrice > 0) {
      try {
        const { invoiceRoutingService } = await import('../services/invoiceRoutingService.js');
        const invoiceResult = await invoiceRoutingService.generateReceipt(bookingId);
        if (invoiceResult.success && invoiceResult.invoiceId) {
          invoiceId = invoiceResult.invoiceId;
          const { data: refetch } = await supabase
            .from('bookings')
            .select('zoho_invoice_id, daftra_invoice_id')
            .eq('id', bookingId)
            .single();
          if (refetch?.zoho_invoice_id) invoiceId = refetch.zoho_invoice_id;
          else if (refetch?.daftra_invoice_id) invoiceId = refetch.daftra_invoice_id;
        }
      } catch (e: any) {
        logger.error('[Mark Paid] Create invoice failed (non-blocking)', { bookingId, error: e?.message });
      }
    }

    const { getInvoiceProviderForTenant } = await import('../services/invoiceRoutingService.js');
    const invoiceProvider = await getInvoiceProviderForTenant(tenantId);

    if (invoiceProvider === 'zoho' && invoiceId && totalPrice > 0) {
      const { zohoService } = await import('../services/zohoService.js');
      const { data: zohoRow } = await supabase.from('bookings').select('zoho_invoice_id').eq('id', bookingId).maybeSingle();
      const zohoOnly = zohoRow?.zoho_invoice_id;

      if (zohoOnly) {
        const paymentMode = payMethod === 'transfer' ? ('banktransfer' as const) : ('cash' as const);
        const referenceNumber = payMethod === 'transfer' ? refNum : 'Paid On Site';

        try {
          const recordResult = await zohoService.recordCustomerPayment(
            tenantId,
            zohoOnly,
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
            await zohoService.sendInvoiceViaWhatsApp(tenantId, zohoOnly, phone, invoiceMessage);
          } catch (waErr: any) {
            logger.error('[Mark Paid] Send invoice via WhatsApp failed (non-blocking):', waErr?.message);
            if (waErr?.message?.includes('payment has not been completed')) {
              invoiceSendWarning = 'Invoice cannot be sent because payment has not been completed.';
            }
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
// Employee: get my assigned bookings (optional date or date range filter)
// ============================================================================
const EMPLOYEE_BOOKINGS_SELECT = `
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
  service_id,
  slot_id,
  employee_id,
  services:service_id (id, name, name_ar),
  slots:slot_id (id, slot_date, start_time, end_time),
  users:employee_id (id, full_name, full_name_ar)
`;
router.get('/employee', authenticateEmployee, async (req, res) => {
  try {
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;
    const date = (req.query.date as string) || '';
    const from_date = (req.query.from_date as string) || '';
    const to_date = (req.query.to_date as string) || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);

    const { data: rows, error } = await supabase
      .from('bookings')
      .select(EMPLOYEE_BOOKINGS_SELECT)
      .eq('tenant_id', tenantId)
      .eq('employee_id', userId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.warn('Employee bookings fetch error', { error: error.message, userId, tenantId });
      return res.status(500).json({ error: error.message || 'Failed to fetch bookings' });
    }

    let bookings = (rows || []).map((b: any) => ({
      ...b,
      slot_date: b.slots?.slot_date || null,
    }));

    // Optional server-side date filter
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (date && dateRegex.test(date.trim())) {
      bookings = bookings.filter((b: any) => {
        const d = b.slot_date || (b.slots && b.slots.slot_date);
        const norm = d ? (String(d).split('T')[0]) : '';
        return norm === date.trim();
      });
    } else if (from_date && dateRegex.test(from_date.trim()) && to_date && dateRegex.test(to_date.trim())) {
      const from = from_date.trim();
      const to = to_date.trim();
      bookings = bookings.filter((b: any) => {
        const d = b.slot_date || (b.slots && b.slots.slot_date);
        const norm = d ? (String(d).split('T')[0]) : '';
        return norm >= from && norm <= to;
      });
    }

    return res.json({ bookings });
  } catch (err: any) {
    logger.error('Employee bookings error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ============================================================================
// Search bookings (Receptionist, Coordinator, and Tenant Admin)
// ============================================================================
// CRITICAL: Only accepts ONE search parameter at a time
// Valid parameters: phone, customer_name, date, service_name, booking_id, customer_id
router.get('/search', authenticateReceptionistOrCoordinatorForView, async (req, res) => {
  try {
    const userId = req.user!.id;
    const tenantId = req.user!.tenant_id!;
    const branchId = req.user!.branch_id || null;
    const limit = parseInt(req.query.limit as string) || 50;

    // Extract search parameters - only ONE is allowed
    const phone = req.query.phone as string;
    const customer_name = req.query.customer_name as string;
    const date = req.query.date as string;
    const service_name = req.query.service_name as string;
    const booking_id = req.query.booking_id as string;
    const customer_id = req.query.customer_id as string;
    const employee_name = req.query.employee_name as string;

    // Count how many search parameters are provided
    const searchParams = [phone, customer_name, date, service_name, booking_id, customer_id, employee_name].filter(p => p && p.trim().length > 0);
    
    if (searchParams.length === 0) {
      return res.status(400).json({ 
        error: 'No search parameter provided',
        hint: 'Provide at least one of: phone, customer_name, date, service_name, booking_id, customer_id, or employee_name. You can combine employee_name with date.'
      });
    }

    const hasEmployeeAndDate = (employee_name && employee_name.trim().length >= 2) && (date && date.trim().length > 0);
    if (searchParams.length > 1 && !hasEmployeeAndDate) {
      return res.status(400).json({ 
        error: 'Multiple search parameters provided',
        hint: 'Provide exactly ONE search parameter, or combine employee_name with date (e.g. employee_name=Marivick&date=2026-03-02)'
      });
    }

    // Base query structure (include all fields needed for list/card display)
    const baseSelect = `
      id,
      customer_name,
      customer_phone,
      customer_email,
      visitor_count,
      total_price,
      status,
      payment_status,
      payment_method,
      notes,
      created_at,
      booking_group_id,
      zoho_invoice_id,
      zoho_invoice_created_at,
      daftra_invoice_id,
      daftra_invoice_created_at,
      invoice_processing_status,
      invoice_last_error,
      package_covered_quantity,
      paid_quantity,
      tag_id,
      service_id,
      slot_id,
      employee_id,
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

    // Combined filter: employee_name + date (bookings for that employee on that date)
    if (hasEmployeeAndDate) {
      try {
        searchType = 'employee_name+date';
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date.trim())) {
          return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD', searchType: 'date' });
        }
        const { data: userMatches, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('tenant_id', tenantId)
          .or(`full_name.ilike.%${employee_name.trim()}%,full_name_ar.ilike.%${employee_name.trim()}%`)
          .limit(50);
        if (userError) {
          logger.warn('Search employee_name+date: user lookup failed', { error: userError.message });
          return res.status(500).json({ error: userError.message || 'User lookup failed' });
        }
        const employeeIds = (userMatches || []).map((u: { id: string }) => u.id).filter(Boolean);
        if (employeeIds.length === 0) {
          return res.json({ bookings: [], count: 0, searchType });
        }
        const { data: slotsOnDate, error: slotsError } = await supabase
          .from('slots')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('slot_date', date.trim())
          .limit(500);
        if (slotsError) {
          logger.warn('Search employee_name+date: slots lookup failed', { error: slotsError.message });
          return res.status(500).json({ error: slotsError.message || 'Slots lookup failed' });
        }
        const slotIds = (slotsOnDate || []).map((s: { id: string }) => s.id).filter(Boolean);
        if (slotIds.length === 0) {
          return res.json({ bookings: [], count: 0, searchType });
        }
        let combinedQuery = supabase
          .from('bookings')
          .select(baseSelect, { count: 'exact' })
          .eq('tenant_id', tenantId)
          .in('employee_id', employeeIds)
          .in('slot_id', slotIds);
        if (branchId) {
          combinedQuery = combinedQuery.eq('branch_id', branchId);
        }
        let result = await combinedQuery.order('created_at', { ascending: false }).limit(limit);
        if (result.error && branchId && (result.error.message?.includes('branch_id') || result.error.code === 'PGRST204')) {
          combinedQuery = supabase
            .from('bookings')
            .select(baseSelect, { count: 'exact' })
            .eq('tenant_id', tenantId)
            .in('employee_id', employeeIds)
            .in('slot_id', slotIds);
          result = await combinedQuery.order('created_at', { ascending: false }).limit(limit);
        }
        if (result.error) {
          logger.warn('Search employee_name+date: bookings query failed', { error: result.error.message, code: result.error.code });
          return res.status(500).json({ error: result.error.message || 'Bookings query failed' });
        }
        return res.json({ bookings: result.data || [], count: (result.data || []).length, searchType });
      } catch (err: any) {
        logger.warn('Search employee_name+date: exception', { error: err?.message || err });
        return res.status(500).json({ error: err?.message || 'Search failed' });
      }
    }

    // Handle each search type explicitly - only ONE will execute
    if (phone && phone.trim().length > 0) {
      searchType = 'phone';
      // Validate phone format (should be numeric, at least 3 digits)
      const phoneDigits = phone.replace(/\D/g, '');
      if (phoneDigits.length < 3) {
        return res.status(400).json({ 
          error: 'Phone number must be at least 3 digits',
          searchType: 'phone'
        });
      }

      // Search by phone (case-insensitive, partial match)
      let phoneQuery = supabase.from('bookings').select(baseSelect, { count: 'exact' }).eq('tenant_id', tenantId);
      if (branchId) phoneQuery = phoneQuery.eq('branch_id', branchId);
      const { data, error } = await phoneQuery
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
      let nameQuery = supabase.from('bookings').select(baseSelect, { count: 'exact' }).eq('tenant_id', tenantId);
      if (branchId) nameQuery = nameQuery.eq('branch_id', branchId);
      const { data, error } = await nameQuery
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
        let dateQuery = supabase.from('bookings').select(baseSelect, { count: 'exact' }).eq('tenant_id', tenantId);
        if (branchId) dateQuery = dateQuery.eq('branch_id', branchId);
        const { data, error } = await dateQuery
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
        let serviceQuery = supabase.from('bookings').select(baseSelect, { count: 'exact' }).eq('tenant_id', tenantId);
        if (branchId) serviceQuery = serviceQuery.eq('branch_id', branchId);
        const { data, error } = await serviceQuery
          .in('service_id', serviceIds)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        bookings = data || [];
      } else {
        bookings = []; // No matching services = no bookings
      }

    } else if (booking_id != null && String(booking_id).trim().length > 0) {
      searchType = 'booking_id';
      const trimmedId = String(booking_id).trim();
      const hexOnlyStr = trimmedId.replace(/[^0-9a-f]/gi, '');
      const fullUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isFullUuid = fullUuidRegex.test(trimmedId);
      const isShortHex = /^[0-9a-f]+$/i.test(hexOnlyStr) && hexOnlyStr.length >= 4;

      if (isFullUuid) {
        // Full UUID: exact match
        let idQuery = supabase.from('bookings').select(baseSelect, { count: 'exact' }).eq('tenant_id', tenantId);
        if (branchId) idQuery = idQuery.eq('branch_id', branchId);
        const { data, error } = await idQuery.eq('id', trimmedId).limit(limit);
        if (error) throw error;
        bookings = data || [];
      } else if (isShortHex) {
        // Short ID / prefix (e.g. 48AC5182): search by UUID prefix via RPC
        const { data: idRows, error: rpcError } = await supabase.rpc('search_booking_ids_by_id_prefix', {
          p_tenant_id: tenantId,
          p_branch_id: branchId,
          p_id_prefix: trimmedId,
          p_limit: limit
        });
        if (rpcError) {
          logger.warn('Booking ID prefix search RPC failed (apply migration 20260301100000_search_bookings_by_id_prefix.sql if missing)', { error: rpcError.message });
          throw rpcError;
        }
        const ids = (idRows || []).map((r: { id: string }) => r.id).filter(Boolean);
        if (ids.length > 0) {
          let prefixQuery = supabase.from('bookings').select(baseSelect).eq('tenant_id', tenantId).in('id', ids);
          if (branchId) prefixQuery = prefixQuery.eq('branch_id', branchId);
          const { data: data2, error } = await prefixQuery.order('created_at', { ascending: false }).limit(limit);
          if (error) throw error;
          bookings = data2 || [];
        } else {
          bookings = [];
        }
      } else {
        return res.status(400).json({
          error: 'Invalid booking ID. Use a full UUID or at least 4 hex characters (e.g. 48AC5182).',
          searchType: 'booking_id'
        });
      }

    } else if (customer_id && customer_id.trim().length > 0) {
      searchType = 'customer_id';
      // Validate UUID format for customer_id
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(customer_id.trim())) {
        return res.status(400).json({ 
          error: 'Invalid customer ID format. Must be a valid UUID',
          searchType: 'customer_id'
        });
      }

      // Search by customer ID (exact match on bookings.customer_id)
      let custIdQuery = supabase.from('bookings').select(baseSelect, { count: 'exact' }).eq('tenant_id', tenantId).eq('customer_id', customer_id.trim());
      if (branchId) custIdQuery = custIdQuery.eq('branch_id', branchId);
      const { data, error } = await custIdQuery.order('created_at', { ascending: false }).limit(limit);

      if (error) throw error;
      bookings = data || [];

    } else if (employee_name && employee_name.trim().length > 0) {
      searchType = 'employee_name';
      if (employee_name.trim().length < 2) {
        return res.status(400).json({
          error: 'Employee name must be at least 2 characters',
          searchType: 'employee_name'
        });
      }

      // Search by employee name: find users (staff) whose full_name or full_name_ar matches, then bookings with that employee_id
      const { data: userMatches, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('tenant_id', tenantId)
        .or(`full_name.ilike.%${employee_name.trim()}%,full_name_ar.ilike.%${employee_name.trim()}%`)
        .limit(50);

      if (userError) throw userError;

      if (userMatches && userMatches.length > 0) {
        const employeeIds = userMatches.map((u: { id: string }) => u.id);
        let empQuery = supabase.from('bookings').select(baseSelect, { count: 'exact' }).eq('tenant_id', tenantId).in('employee_id', employeeIds);
        if (branchId) empQuery = empQuery.eq('branch_id', branchId);
        const { data, error } = await empQuery.order('created_at', { ascending: false }).limit(limit);

        if (error) throw error;
        bookings = data || [];
      } else {
        bookings = [];
      }
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
