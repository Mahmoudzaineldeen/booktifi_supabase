import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

const require = createRequire(import.meta.url);
const arabicReshaperLib = require('arabic-reshaper');
const __filename = fileURLToPath(import.meta.url);
const __dirnameVisitors = dirname(__filename);

// Prefer fonts that support Arabic script well (Noto, Amiri, Tahoma, Arial Unicode)
const POSSIBLE_ARABIC_FONT_PATHS = [
  join(__dirnameVisitors, '../fonts/NotoSansArabic-Regular.ttf'),
  join(__dirnameVisitors, '../fonts/Amiri-Regular.ttf'),
  'C:/Windows/Fonts/tahoma.ttf',
  'C:/Windows/Fonts/arialuni.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

function getVisitorsPdfArabicFontPath(): string | null {
  for (const p of POSSIBLE_ARABIC_FONT_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function containsArabic(str: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(str);
}

/** Reshape Arabic for PDF: contextual forms + reverse word order (RTL). */
function reshapeArabicForPdf(text: string): string {
  if (!text || !text.trim()) return text;
  try {
    let reshaped = text;
    if (arabicReshaperLib && typeof arabicReshaperLib.convertArabic === 'function') {
      reshaped = arabicReshaperLib.convertArabic(text);
    }
    const words = reshaped.split(' ');
    return words.reverse().join(' ');
  } catch {
    return text.split(' ').reverse().join(' ');
  }
}

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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

const VISITORS_ACCESS_ROLES = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user', 'coordinator'];

function authenticateVisitorsAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token is required' });
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (e: any) {
      if (e.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token has expired' });
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (!VISITORS_ACCESS_ROLES.includes(decoded.role)) {
      return res.status(403).json({ error: 'Access denied. Only admin or receptionist can access visitors.' });
    }
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'No tenant associated with your account.' });
    }
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id };
    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Authentication error', hint: err.message });
  }
}

type BookingTypeFilter = 'all' | 'package_only' | 'paid_only';
type BookingStatusFilter = 'confirmed' | 'pending' | 'cancelled' | 'checked_in' | '';

interface ListFilters {
  name?: string;
  phone?: string;
  startDate?: string;
  endDate?: string;
  bookingType?: BookingTypeFilter;
  serviceId?: string;
  bookingStatus?: BookingStatusFilter;
}

function buildBookingTypeCondition(bookingType: BookingTypeFilter): string | null {
  if (bookingType === 'package_only') return '(coalesce(b.package_covered_quantity, 0) > 0)';
  if (bookingType === 'paid_only') return '(coalesce(b.package_covered_quantity, 0) = 0)';
  return null;
}

/** Normalize phone to digits only for matching (ignore +, -, spaces). */
function normalizePhone(s: string): string {
  return (s || '').replace(/\D/g, '');
}

/** Parse total_price from DB (number or string, avoid NaN). */
function parsePrice(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Escape ILIKE/LIKE special chars (%, _) so search is literal. */
function escapeIlike(s: string): string {
  return (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/** True if search is purely digits (avoids name conflict e.g. "11111" vs "sobia1111"). */
function isPurelyNumeric(s: string): boolean {
  return /^\d+$/.test((s || '').trim());
}

/** True if text matches search (case-insensitive, Unicode-normalized).
 * When search is purely numeric, requires exact name match so "11111" does not match "sobia1111". */
function nameMatchesSearch(text: string | null | undefined, search: string): boolean {
  if (!search || !search.trim()) return true;
  const norm = (s: string) => (s || '').trim().toLowerCase().normalize('NFC');
  const t = norm(String(text || ''));
  const q = norm(search);
  if (isPurelyNumeric(search)) return t === q;
  return t.includes(q);
}

/** Match search phone to stored phone (e.g. +201032560826 matches 01032560826). */
function phoneMatches(filterPhone: string, storedPhone: string): boolean {
  const f = normalizePhone(filterPhone);
  const s = normalizePhone(storedPhone);
  if (!f) return true;
  if (s === f) return true;
  if (s.includes(f) || f.includes(s)) return true;
  // 0-prefix vs country 20: 01032560826 vs 201032560826
  const stripLeadingZero = (x: string) => x.replace(/^0+/, '');
  if (s.endsWith(stripLeadingZero(f)) || f.endsWith(stripLeadingZero(s))) return true;
  if (s === '20' + stripLeadingZero(f) || f === '20' + stripLeadingZero(s)) return true;
  return false;
}

/** Fetch all rows from a query by paginating (avoids PostgREST row cap). */
const FETCH_PAGE_SIZE = 1000;

/** Total spent = bookings (paid only, confirmed/completed/checked_in) + package purchases. */
async function fetchPackageSpendByCustomer(tenantId: string): Promise<Record<string, number>> {
  const byCustomer: Record<string, number> = {};
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('package_subscriptions')
      .select('customer_id, service_packages(total_price)')
      .eq('tenant_id', tenantId)
      .eq('payment_status', 'paid')
      .order('id', { ascending: true })
      .range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data || [];
    for (const row of chunk as any[]) {
      const cid = row?.customer_id;
      if (!cid) continue;
      const price = parsePrice(row?.service_packages?.total_price);
      byCustomer[cid] = (byCustomer[cid] ?? 0) + price;
    }
    hasMore = chunk.length === FETCH_PAGE_SIZE;
    offset += FETCH_PAGE_SIZE;
  }
  return byCustomer;
}

async function fetchAllBookings(
  tenantId: string,
  filters: { serviceId?: string; bookingStatus?: string }
): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    let q = supabase
      .from('bookings')
      .select(`
        id,
        customer_id,
        customer_name,
        customer_phone,
        customer_email,
        total_price,
        status,
        slot_id,
        service_id,
        package_covered_quantity,
        paid_quantity,
        package_subscription_id,
        slots(slot_date, start_time, end_time)
      `)
      .eq('tenant_id', tenantId)
      .order('id', { ascending: true })
      .range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (filters.serviceId) q = q.eq('service_id', filters.serviceId);
    if (filters.bookingStatus) q = q.eq('status', filters.bookingStatus);
    const { data, error } = await q;
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    hasMore = chunk.length === FETCH_PAGE_SIZE;
    offset += FETCH_PAGE_SIZE;
  }
  return rows;
}

/**
 * GET /api/visitors
 * List visitors (customers + guest bookers) with filters and pagination.
 * Booking type from backend: PACKAGE = package_covered_quantity > 0, else PAID.
 */
router.get('/', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const filters: ListFilters = {
      name: (req.query.name as string)?.trim() || undefined,
      phone: (req.query.phone as string)?.trim() || undefined,
      startDate: (req.query.startDate as string)?.trim() || undefined,
      endDate: (req.query.endDate as string)?.trim() || undefined,
      bookingType: (req.query.bookingType as BookingTypeFilter) || 'all',
      serviceId: (req.query.serviceId as string)?.trim() || undefined,
      bookingStatus: (req.query.bookingStatus as BookingStatusFilter) || '',
    };

    // 1) Fetch ALL customers for tenant (paginate to avoid PostgREST row cap)
    const customersRaw: any[] = [];
    let custOffset = 0;
    let custHasMore = true;
    while (custHasMore) {
      const cq = supabase
        .from('customers')
        .select('id, name, phone, email, is_blocked, created_at')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(custOffset, custOffset + FETCH_PAGE_SIZE - 1);
      const { data: chunk, error: custError } = await cq;
      if (custError) throw custError;
      const list = chunk || [];
      customersRaw.push(...list);
      custHasMore = list.length === FETCH_PAGE_SIZE;
      custOffset += FETCH_PAGE_SIZE;
    }

    let customers = customersRaw;
    if (filters.name && filters.name.trim()) {
      customers = customers.filter((c: any) => nameMatchesSearch(c.name, filters.name!));
    }
    if (filters.phone && filters.phone.trim()) {
      customers = customers.filter((c: any) => phoneMatches(filters.phone!, c.phone || ''));
    }

    // 2) Fetch ALL bookings for tenant (paginate to avoid row cap)
    const bookings = (await fetchAllBookings(tenantId, {
      serviceId: filters.serviceId,
      bookingStatus: filters.bookingStatus || undefined,
    })) as any[];
    const slotDates: Record<string, { slot_date: string }> = {};
    bookings.forEach((b: any) => {
      if (b.slot_id && (b.slots?.slot_date != null)) slotDates[b.slot_id] = { slot_date: b.slots.slot_date };
    });

    const applyDateFilter = (b: any) => {
      if (!filters.startDate && !filters.endDate) return true;
      const slotDate = b.slots?.slot_date || slotDates[b.slot_id]?.slot_date;
      if (!slotDate) return true;
      if (filters.startDate && slotDate < filters.startDate) return false;
      if (filters.endDate && slotDate > filters.endDate) return false;
      return true;
    };

    const applyBookingTypeFilter = (b: any) => {
      const pc = b.package_covered_quantity ?? 0;
      if (filters.bookingType === 'package_only') return pc > 0;
      if (filters.bookingType === 'paid_only') return pc === 0;
      return true;
    };

    const filteredBookings = bookings.filter((b) => applyDateFilter(b) && applyBookingTypeFilter(b));

    const SPENT_STATUSES = new Set(['confirmed', 'completed', 'checked_in']);
    const isCountedForSpent = (status: string) => status && SPENT_STATUSES.has(String(status).toLowerCase());

    // Package purchase spend (total spent = bookings + package purchases)
    const packageSpendByCustomer = await fetchPackageSpendByCustomer(tenantId);

    // Aggregate by customer_id (and by guest phone for customer_id null)
    const byCustomerId: Record<string, { total: number; spent: number; packageCount: number; paidCount: number; lastDate: string | null }> = {};
    const byGuestPhone: Record<string, { name: string; email: string | null; total: number; spent: number; packageCount: number; paidCount: number; lastDate: string | null }> = {};

    for (const b of filteredBookings) {
      const slotDate = b.slots?.slot_date || slotDates[b.slot_id]?.slot_date || null;
      const pc = b.package_covered_quantity ?? 0;
      const isPackage = pc > 0;
      const amount = parsePrice(b.total_price);
      // Total Spent = paid only; only confirmed/completed/checked_in
      const addToSpent = !isPackage && isCountedForSpent(b.status) ? amount : 0;

      if (b.customer_id) {
        if (!byCustomerId[b.customer_id]) {
          byCustomerId[b.customer_id] = { total: 0, spent: 0, packageCount: 0, paidCount: 0, lastDate: null };
        }
        const agg = byCustomerId[b.customer_id];
        agg.total += 1;
        agg.spent += addToSpent;
        if (isPackage) agg.packageCount += 1; else agg.paidCount += 1;
        if (slotDate && (!agg.lastDate || slotDate > agg.lastDate)) agg.lastDate = slotDate;
      } else {
        const phone = (b.customer_phone || '').trim();
        if (!phone) continue;
        if (!byGuestPhone[phone]) {
          byGuestPhone[phone] = {
            name: b.customer_name || '',
            email: b.customer_email || null,
            total: 0,
            spent: 0,
            packageCount: 0,
            paidCount: 0,
            lastDate: null,
          };
        }
        const agg = byGuestPhone[phone];
        agg.total += 1;
        agg.spent += addToSpent;
        if (isPackage) agg.packageCount += 1; else agg.paidCount += 1;
        if (slotDate && (!agg.lastDate || slotDate > agg.lastDate)) agg.lastDate = slotDate;
      }
    }

    // Add package purchase spend to each customer's spent (total spent = bookings + packages)
    for (const cid of Object.keys(byCustomerId)) {
      byCustomerId[cid].spent += packageSpendByCustomer[cid] ?? 0;
    }

    const visitorRows: any[] = [];

    for (const c of customers || []) {
      const agg = byCustomerId[c.id];
      const guestEntry = Object.entries(byGuestPhone).find(([ph]) => phoneMatches(ph, c.phone || ''));
      const guest = guestEntry ? guestEntry[1] : null;
      const totalBookings = (agg?.total ?? 0) + (guest?.total ?? 0);
      const totalSpent = (agg?.spent ?? 0) + (guest?.spent ?? 0);
      const packageCount = (agg?.packageCount ?? 0) + (guest?.packageCount ?? 0);
      const paidCount = (agg?.paidCount ?? 0) + (guest?.paidCount ?? 0);
      const lastDate = [agg?.lastDate, guest?.lastDate].filter(Boolean).sort().pop() as string | null;
      if (filters.bookingType || filters.serviceId || filters.bookingStatus || filters.startDate || filters.endDate) {
        if (totalBookings === 0) continue;
      }
      visitorRows.push({
        id: c.id,
        type: 'customer',
        customer_name: c.name,
        phone: c.phone,
        email: c.email || null,
        total_bookings: totalBookings,
        total_spent: totalSpent,
        package_bookings_count: packageCount,
        paid_bookings_count: paidCount,
        last_booking_date: lastDate ?? agg?.lastDate ?? guest?.lastDate ?? null,
        status: c.is_blocked ? 'blocked' : 'active',
      });
    }

    for (const [phone, agg] of Object.entries(byGuestPhone)) {
      const isCustomerPhone = (customers || []).some((c: any) => phoneMatches(phone, c.phone || ''));
      if (isCustomerPhone) continue;
      if (agg.total === 0) continue;
      if (filters.phone && filters.phone.trim() && !phoneMatches(filters.phone, phone)) continue;
      if (filters.name && filters.name.trim() && !nameMatchesSearch(agg.name, filters.name)) continue;
      visitorRows.push({
        id: `guest-${encodeURIComponent(phone)}`,
        type: 'guest',
        customer_name: agg.name,
        phone,
        email: agg.email,
        total_bookings: agg.total,
        total_spent: agg.spent,
        package_bookings_count: agg.packageCount,
        paid_bookings_count: agg.paidCount,
        last_booking_date: agg.lastDate,
        status: 'active',
      });
    }

    const total = visitorRows.length;
    const sorted = visitorRows.sort((a, b) => (b.last_booking_date || '').localeCompare(a.last_booking_date || ''));
    const paged = sorted.slice(offset, offset + limit);

    // Stats from FULL filtered set — totals must match sum of visitor rows
    const totalBookings = filteredBookings.length;
    const totalPackageBookings = filteredBookings.filter((b: any) => (b.package_covered_quantity ?? 0) > 0).length;
    const totalPaidBookings = filteredBookings.filter((b: any) => (b.package_covered_quantity ?? 0) === 0).length;
    const totalSpent = visitorRows.reduce((s: number, r: any) => s + parsePrice(r.total_spent), 0);
    const totalCustomers = visitorRows.filter((r: any) => r.type === 'customer').length;

    const summary = {
      totalBookings,
      totalPackageBookings,
      totalPaidBookings,
      totalSpent,
      totalCustomers,
    };

    res.json({
      data: paged,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
      summary,
    });
  } catch (err: any) {
    logger.error('Visitors list error', err, { tenantId: req.user?.tenant_id });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * GET /api/visitors/export/:format
 * Export visitors (PDF/Excel/CSV) respecting current filters. Must be before /:id.
 */
router.get('/export/:format', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const format = (req.params.format || 'csv').toLowerCase();
    if (!['pdf', 'xlsx', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'Format must be pdf, xlsx, or csv' });
    }

    const filters: ListFilters = {
      name: (req.query.name as string)?.trim() || undefined,
      phone: (req.query.phone as string)?.trim() || undefined,
      startDate: (req.query.startDate as string)?.trim() || undefined,
      endDate: (req.query.endDate as string)?.trim() || undefined,
      bookingType: (req.query.bookingType as BookingTypeFilter) || 'all',
      serviceId: (req.query.serviceId as string)?.trim() || undefined,
      bookingStatus: (req.query.bookingStatus as BookingStatusFilter) || '',
    };
    let includeTotals = /^(1|true|yes)$/i.test(String(req.query.includeTotals ?? 'true').trim());
    let includeVisitorDetails = /^(1|true|yes)$/i.test(String(req.query.includeVisitorDetails ?? 'true').trim());
    // Ensure at least one section is included so the file is never empty
    if (!includeTotals && !includeVisitorDetails) {
      includeTotals = true;
      includeVisitorDetails = true;
    }

    // Fetch ALL customers (paginate)
    const filteredCustomersRaw: any[] = [];
    let expCustOffset = 0;
    let expCustHasMore = true;
    while (expCustHasMore) {
      const cq = supabase.from('customers').select('id, name, phone, email, is_blocked').eq('tenant_id', tenantId).order('id', { ascending: true }).range(expCustOffset, expCustOffset + FETCH_PAGE_SIZE - 1);
      const { data: chunk } = await cq;
      const list = chunk || [];
      filteredCustomersRaw.push(...list);
      expCustHasMore = list.length === FETCH_PAGE_SIZE;
      expCustOffset += FETCH_PAGE_SIZE;
    }
    let filteredCustomers = filteredCustomersRaw;
    if (filters.name && filters.name.trim()) {
      filteredCustomers = filteredCustomers.filter((c: any) => nameMatchesSearch(c.name, filters.name!));
    }
    if (filters.phone && filters.phone.trim()) {
      filteredCustomers = filteredCustomers.filter((c: any) => phoneMatches(filters.phone!, c.phone || ''));
    }

    // Fetch ALL bookings (paginate)
    const allBookingsExport = await fetchAllBookings(tenantId, {
      serviceId: filters.serviceId,
      bookingStatus: filters.bookingStatus || undefined,
    });
    const bookings = allBookingsExport as any[];
    const slotDates: Record<string, string> = {};
    bookings.forEach((b: any) => {
      if (b.slot_id && (b.slots?.slot_date != null)) slotDates[b.slot_id] = b.slots.slot_date;
    });
    const applyDateFilter = (b: any) => {
      if (!filters.startDate && !filters.endDate) return true;
      const d = b.slots?.slot_date ?? slotDates[b.slot_id];
      if (!d) return true;
      if (filters.startDate && d < filters.startDate) return false;
      if (filters.endDate && d > filters.endDate) return false;
      return true;
    };
    const applyTypeFilter = (b: any) => {
      const pc = b.package_covered_quantity ?? 0;
      if (filters.bookingType === 'package_only') return pc > 0;
      if (filters.bookingType === 'paid_only') return pc === 0;
      return true;
    };
    const filteredBookings = bookings.filter((b) => applyDateFilter(b) && applyTypeFilter(b));

    const packageSpendByCustomerExport = await fetchPackageSpendByCustomer(tenantId);
    const isCountedForSpentExport = (status: string) => status && ['confirmed', 'completed', 'checked_in'].includes(String(status).toLowerCase());
    const byCustomerId: Record<string, { total: number; spent: number; packageCount: number; paidCount: number; lastDate: string | null }> = {};
    const byGuestPhone: Record<string, { name: string; email: string | null; total: number; spent: number; packageCount: number; paidCount: number; lastDate: string | null }> = {};
    for (const b of filteredBookings) {
      const slotDate = b.slots?.slot_date ?? slotDates[b.slot_id] ?? null;
      const pc = b.package_covered_quantity ?? 0;
      const isPackage = pc > 0;
      const amount = parsePrice(b.total_price);
      const addToSpent = !isPackage && isCountedForSpentExport(b.status) ? amount : 0;
      if (b.customer_id) {
        if (!byCustomerId[b.customer_id]) byCustomerId[b.customer_id] = { total: 0, spent: 0, packageCount: 0, paidCount: 0, lastDate: null };
        const agg = byCustomerId[b.customer_id];
        agg.total += 1;
        agg.spent += addToSpent;
        if (isPackage) agg.packageCount += 1; else agg.paidCount += 1;
        if (slotDate && (!agg.lastDate || slotDate > agg.lastDate)) agg.lastDate = slotDate;
      } else {
        const phone = (b.customer_phone || '').trim();
        if (!phone) continue;
        if (!byGuestPhone[phone]) byGuestPhone[phone] = { name: b.customer_name || '', email: b.customer_email || null, total: 0, spent: 0, packageCount: 0, paidCount: 0, lastDate: null };
        const agg = byGuestPhone[phone];
        agg.total += 1;
        agg.spent += addToSpent;
        if (isPackage) agg.packageCount += 1; else agg.paidCount += 1;
        if (slotDate && (!agg.lastDate || slotDate > agg.lastDate)) agg.lastDate = slotDate;
      }
    }

    for (const cid of Object.keys(byCustomerId)) {
      byCustomerId[cid].spent += packageSpendByCustomerExport[cid] ?? 0;
    }

    const rows: any[] = [];
    for (const c of filteredCustomers || []) {
      const agg = byCustomerId[c.id];
      const guestEntry = Object.entries(byGuestPhone).find(([ph]) => phoneMatches(ph, c.phone || ''));
      const guest = guestEntry ? guestEntry[1] : null;
      const totalBookings = (agg?.total ?? 0) + (guest?.total ?? 0);
      const totalSpent = (agg?.spent ?? 0) + (guest?.spent ?? 0);
      const packageCount = (agg?.packageCount ?? 0) + (guest?.packageCount ?? 0);
      const paidCount = (agg?.paidCount ?? 0) + (guest?.paidCount ?? 0);
      const lastDate = [agg?.lastDate, guest?.lastDate].filter(Boolean).sort().pop() as string | null;
      if (filters.bookingType || filters.serviceId || filters.bookingStatus || filters.startDate || filters.endDate) {
        if (totalBookings === 0) continue;
      }
      rows.push({
        customer_name: c.name,
        phone: c.phone,
        email: c.email || null,
        total_bookings: totalBookings,
        total_spent: totalSpent,
        package_bookings_count: packageCount,
        paid_bookings_count: paidCount,
        last_booking_date: lastDate ?? agg?.lastDate ?? guest?.lastDate ?? null,
        status: (c as any).is_blocked ? 'Blocked' : 'Active',
      });
    }
    for (const [phone, agg] of Object.entries(byGuestPhone)) {
      const isCustomerPhone = (filteredCustomers || []).some((c: any) => phoneMatches(phone, c.phone || ''));
      if (isCustomerPhone) continue;
      if (filters.phone && filters.phone.trim() && !phoneMatches(filters.phone, phone)) continue;
      if (filters.name && filters.name.trim() && !nameMatchesSearch(agg.name, filters.name)) continue;
      rows.push({
        customer_name: agg.name,
        phone,
        email: agg.email,
        total_bookings: agg.total,
        total_spent: agg.spent,
        package_bookings_count: agg.packageCount,
        paid_bookings_count: agg.paidCount,
        last_booking_date: agg.lastDate,
        status: 'Active',
      });
    }

    const totalVisitors = rows.length;
    const totalBookings = rows.reduce((s: number, r: any) => s + (Number(r.total_bookings) || 0), 0);
    const totalPackageBookings = rows.reduce((s: number, r: any) => s + (Number(r.package_bookings_count) || 0), 0);
    const totalPaidBookings = rows.reduce((s: number, r: any) => s + (Number(r.paid_bookings_count) || 0), 0);
    const totalSpent = rows.reduce((s: number, r: any) => s + parsePrice(r.total_spent), 0);

    if (format === 'csv') {
      const lines: string[] = [];
      if (includeTotals) {
        lines.push('"Summary"');
        lines.push(`"Total Visitors",${totalVisitors}`);
        lines.push(`"Total Bookings",${totalBookings}`);
        lines.push(`"Package Bookings",${totalPackageBookings}`);
        lines.push(`"Paid Bookings",${totalPaidBookings}`);
        lines.push(`"Total Spent",${totalSpent}`);
        lines.push('');
      }
      if (includeVisitorDetails) {
        const header = 'Customer Name,Phone,Email,Total Bookings,Total Spent,Package Bookings,Paid Bookings,Last Booking Date,Status';
        const csvRows = rows.map((r) =>
          [r.customer_name, r.phone, r.email, r.total_bookings, r.total_spent, r.package_bookings_count, r.paid_bookings_count, r.last_booking_date || '', r.status].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
        );
        lines.push(header);
        lines.push(...csvRows);
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="visitors-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(lines.join('\r\n'));
    }

    if (format === 'xlsx') {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        if (includeTotals) {
          const summaryData = [
            { Metric: 'Total Visitors', Value: totalVisitors },
            { Metric: 'Total Bookings', Value: totalBookings },
            { Metric: 'Package Bookings', Value: totalPackageBookings },
            { Metric: 'Paid Bookings', Value: totalPaidBookings },
            { Metric: 'Total Spent', Value: totalSpent },
          ];
          const wsSummary = XLSX.utils.json_to_sheet(summaryData);
          XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
        }
        if (includeVisitorDetails) {
          const colHeaders = ['Customer Name', 'Phone', 'Email', 'Total Bookings', 'Total Spent', 'Package Bookings', 'Paid Bookings', 'Last Booking Date', 'Status'];
          if (rows.length > 0) {
            const ws = XLSX.utils.json_to_sheet(rows.map((r: any) => ({
              'Customer Name': r.customer_name,
              'Phone': r.phone,
              'Email': r.email ?? '',
              'Total Bookings': r.total_bookings,
              'Total Spent': r.total_spent,
              'Package Bookings': r.package_bookings_count,
              'Paid Bookings': r.paid_bookings_count,
              'Last Booking Date': r.last_booking_date ?? '',
              'Status': r.status,
            })));
            XLSX.utils.book_append_sheet(wb, ws, 'Visitors');
          } else {
            const ws = XLSX.utils.aoa_to_sheet([colHeaders]);
            XLSX.utils.book_append_sheet(wb, ws, 'Visitors');
          }
        }
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="visitors-${new Date().toISOString().slice(0, 10)}.xlsx"`);
        return res.send(buf);
      } catch (e) {
        return res.status(500).json({ error: 'Excel export requires xlsx package. Use CSV or PDF.' });
      }
    }

    if (format === 'pdf') {
      try {
        const pdfkit = await import('pdfkit');
        const PDFDocument = (pdfkit as any).default ?? pdfkit;
        const arabicFontPath = getVisitorsPdfArabicFontPath();
        const doc = new PDFDocument({
          margin: 50,
          ...(arabicFontPath ? { features: ['rtla', 'calt'], lang: 'ar' } : {}),
        });

        let arabicFontRegistered = false;
        if (arabicFontPath) {
          try {
            const fontBuffer = readFileSync(arabicFontPath);
            doc.registerFont('ArabicFont', fontBuffer);
            arabicFontRegistered = true;
          } catch (e: any) {
            logger.warn('Visitors PDF: could not load Arabic font', { path: arabicFontPath, err: e?.message });
          }
        }

        const chunks: Buffer[] = [];
        const pdfPromise = new Promise<Buffer>((resolve, reject) => {
          doc.on('data', (chunk: Buffer) => chunks.push(chunk));
          doc.on('end', () => resolve(Buffer.concat(chunks)));
          doc.on('error', reject);
        });

        const formatNum = (n: number) => Number.isFinite(n) ? Number(n).toFixed(2) : '0.00';
        const totalSpentFormatted = formatNum(totalSpent);
        const lineWidth = 500;

        doc.fontSize(18).text('Visitors Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10);
        if (includeTotals) {
          doc.text(`Total Visitors: ${totalVisitors}`);
          doc.text(`Total Bookings: ${totalBookings}`);
          doc.text(`Package Bookings: ${totalPackageBookings}`);
          doc.text(`Paid Bookings: ${totalPaidBookings}`);
          doc.text(`Total Spent: ${totalSpentFormatted}`);
          doc.moveDown();
        }
        if (includeVisitorDetails) {
          for (const r of rows) {
            const rawName = String(r.customer_name ?? '').replace(/\|/g, ',');
            const phone = String(r.phone ?? '');
            const bookings = Number(r.total_bookings) ?? 0;
            const spentFormatted = formatNum(Number(r.total_spent) ?? 0);
            const status = String(r.status ?? '');
            const restOfLine = ` | Phone: ${phone} | Bookings: ${bookings} | Spent: ${spentFormatted} | Status: ${status}`;

            if (arabicFontRegistered && containsArabic(rawName)) {
              // Use reshaped Arabic for correct joining; fall back to raw if reshaped is empty
              const nameForPdf = reshapeArabicForPdf(rawName).trim() || rawName;
              doc
                .font('Helvetica')
                .text('Name: ', { width: lineWidth, continued: true })
                .font('ArabicFont')
                .text(nameForPdf, { width: lineWidth, continued: true, features: ['rtla'] })
                .font('Helvetica')
                .text(restOfLine, { width: lineWidth });
            } else {
              doc.font('Helvetica').text(`Name: ${rawName}${restOfLine}`, { width: lineWidth });
            }
            doc.moveDown(0.5);
          }
        }
        doc.end();

        const pdfBuffer = await pdfPromise;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="visitors-${new Date().toISOString().slice(0, 10)}.pdf"`);
        return res.send(pdfBuffer);
      } catch (e: any) {
        logger.error('Visitors PDF export error', e);
        return res.status(500).json({ error: e?.message || 'PDF export failed. Use CSV or Excel.' });
      }
    }

    res.status(400).json({ error: 'Invalid format' });
  } catch (err: any) {
    logger.error('Visitors export error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * GET /api/visitors/:id
 * Visitor detail: info + booking history. :id is customer uuid or "guest-{phone}".
 */
router.get('/:id', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const id = req.params.id;

    if (id.startsWith('guest-')) {
      const phone = decodeURIComponent(id.replace(/^guest-/, ''));
      const { data: bookings } = await supabase
        .from('bookings')
        .select(`
          id, customer_name, customer_phone, customer_email, total_price, status, visitor_count,
          package_covered_quantity, paid_quantity, package_subscription_id, created_at, created_by_user_id,
          service_id, slot_id,
          services:service_id(name, name_ar),
          slots:slot_id(slot_date, start_time, end_time)
        `)
        .eq('tenant_id', tenantId)
        .is('customer_id', null)
        .eq('customer_phone', phone)
        .order('created_at', { ascending: false });

      const list = (bookings || []) as any[];
      const totalSpent = list.reduce((s, b) => {
        const pc = b.package_covered_quantity ?? 0;
        if (pc > 0) return s;
        const st = String(b.status || '').toLowerCase();
        if (!['confirmed', 'completed', 'checked_in'].includes(st)) return s;
        return s + parsePrice(b.total_price);
      }, 0);
      const packageCount = list.filter((b) => (b.package_covered_quantity ?? 0) > 0).length;
      const paidCount = list.length - packageCount;
      const lastBooking = list.length ? list[0] : null;

      return res.json({
        visitor: {
          id,
          type: 'guest',
          customer_name: lastBooking?.customer_name || '',
          phone,
          email: lastBooking?.customer_email || null,
          total_bookings: list.length,
          total_spent: totalSpent,
          package_bookings_count: packageCount,
          paid_bookings_count: paidCount,
          last_booking_date: lastBooking?.slots?.slot_date || null,
          status: 'active',
          active_packages: [],
        },
        bookings: list.map((b) => ({
          id: b.id,
          service_name: b.services?.name || '',
          date: b.slots?.slot_date,
          time: b.slots?.start_time,
          visitors_count: b.visitor_count,
          booking_type: (b.package_covered_quantity ?? 0) > 0 ? 'PACKAGE' : 'PAID',
          amount_paid: b.total_price,
          status: b.status,
          created_by: b.created_by_user_id ? 'staff' : 'customer',
        })),
      });
    }

    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .select('id, name, phone, email, is_blocked')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();
    if (custErr || !customer) {
      return res.status(404).json({ error: 'Visitor not found' });
    }

    const { data: bookings } = await supabase
      .from('bookings')
      .select(`
        id, customer_name, total_price, status, visitor_count,
        package_covered_quantity, paid_quantity, package_subscription_id, created_at, created_by_user_id,
        service_id, slot_id,
        services:service_id(name, name_ar),
        slots:slot_id(slot_date, start_time, end_time)
      `)
      .eq('tenant_id', tenantId)
      .eq('customer_id', id)
      .order('created_at', { ascending: false });

    const list = (bookings || []) as any[];
    let totalSpent = list.reduce((s, b) => {
      const pc = (b as any).package_covered_quantity ?? 0;
      if (pc > 0) return s;
      const st = String((b as any).status || '').toLowerCase();
      if (!['confirmed', 'completed', 'checked_in'].includes(st)) return s;
      return s + parsePrice((b as any).total_price);
    }, 0);
    const { data: paidSubs } = await supabase
      .from('package_subscriptions')
      .select('service_packages(total_price)')
      .eq('customer_id', id)
      .eq('tenant_id', tenantId)
      .eq('payment_status', 'paid');
    const packageSpent = (paidSubs || []).reduce((s: number, row: any) => s + parsePrice(row?.service_packages?.total_price), 0);
    totalSpent += packageSpent;
    const packageCount = list.filter((b) => ((b as any).package_covered_quantity ?? 0) > 0).length;
    const paidCount = list.length - packageCount;
    const lastBooking = list.length ? list[0] : null;

    const { data: subs } = await supabase
      .from('package_subscriptions')
      .select(`
        id, package_id, status, service_packages(name, name_ar),
        package_subscription_usage(service_id, remaining_quantity, original_quantity, services(name))
      `)
      .eq('customer_id', id)
      .eq('tenant_id', tenantId)
      .in('status', ['active']);

    const activePackages = (subs || []).map((s: any) => ({
      package_name: s.service_packages?.name,
      usage: s.package_subscription_usage || [],
    }));

    res.json({
      visitor: {
        id: customer.id,
        type: 'customer',
        customer_name: customer.name,
        phone: customer.phone,
        email: customer.email || null,
        total_bookings: list.length,
        total_spent: totalSpent,
        package_bookings_count: packageCount,
        paid_bookings_count: paidCount,
        last_booking_date: lastBooking?.slots?.slot_date || null,
        status: (customer as any).is_blocked ? 'blocked' : 'active',
        active_packages: activePackages,
      },
      bookings: list.map((b: any) => ({
        id: b.id,
        service_name: b.services?.name || '',
        date: b.slots?.slot_date,
        time: b.slots?.start_time,
        visitors_count: b.visitor_count,
        booking_type: (b.package_covered_quantity ?? 0) > 0 ? 'PACKAGE' : 'PAID',
        amount_paid: b.total_price,
        status: b.status,
        created_by: b.created_by_user_id ? 'staff' : 'customer',
      })),
    });
  } catch (err: any) {
    logger.error('Visitor detail error', err, { id: req.params.id });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * PATCH /api/visitors/:id/block
 * Block visitor (customers only; guest cannot be blocked by id).
 */
router.patch('/:id/block', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const id = req.params.id;
    if (id.startsWith('guest-')) {
      return res.status(400).json({ error: 'Guest visitors cannot be blocked. They have no customer record.' });
    }
    const { data, error } = await supabase
      .from('customers')
      .update({ is_blocked: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, is_blocked')
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Visitor not found' });
    res.json({ success: true, is_blocked: true });
  } catch (err: any) {
    logger.error('Block visitor error', err, { id: req.params.id });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * PATCH /api/visitors/:id/unblock
 */
router.patch('/:id/unblock', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const id = req.params.id;
    if (id.startsWith('guest-')) {
      return res.status(400).json({ error: 'Guest visitors have no block status.' });
    }
    const { data, error } = await supabase
      .from('customers')
      .update({ is_blocked: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, is_blocked')
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Visitor not found' });
    res.json({ success: true, is_blocked: false });
  } catch (err: any) {
    logger.error('Unblock visitor error', err, { id: req.params.id });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export { router as visitorRoutes };
