import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

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

    // 1) Customers with booking aggregates (bookings joined so we can filter by date/type/service/status)
    let customersQuery = supabase
      .from('customers')
      .select('id, name, phone, email, is_blocked, created_at')
      .eq('tenant_id', tenantId);

    if (filters.name) {
      customersQuery = customersQuery.ilike('name', `%${filters.name}%`);
    }
    if (filters.phone) {
      customersQuery = customersQuery.ilike('phone', `%${filters.phone}%`);
    }

    const { data: customers, error: custError } = await customersQuery;
    if (custError) throw custError;

    const customerIds = (customers || []).map((c: any) => c.id);

    // 2) Bookings for these customers (and we'll also get guest bookings)
    let bookingsQuery = supabase
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
      .eq('tenant_id', tenantId);

    if (filters.serviceId) bookingsQuery = bookingsQuery.eq('service_id', filters.serviceId);
    if (filters.bookingStatus) bookingsQuery = bookingsQuery.eq('status', filters.bookingStatus);

    const { data: allBookings, error: bookError } = await bookingsQuery;
    if (bookError) throw bookError;

    const bookings = (allBookings || []) as any[];
    const slotIds = [...new Set(bookings.map((b) => b.slot_id).filter(Boolean))] as string[];
    let slotDates: Record<string, { slot_date: string }> = {};
    if (slotIds.length > 0) {
      const { data: slotsData } = await supabase.from('slots').select('id, slot_date').in('id', slotIds);
      (slotsData || []).forEach((s: any) => { slotDates[s.id] = { slot_date: s.slot_date }; });
    }

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

    // Aggregate by customer_id (and by guest phone for customer_id null)
    const byCustomerId: Record<string, { total: number; spent: number; packageCount: number; paidCount: number; lastDate: string | null }> = {};
    const byGuestPhone: Record<string, { name: string; email: string | null; total: number; spent: number; packageCount: number; paidCount: number; lastDate: string | null }> = {};

    for (const b of filteredBookings) {
      const slotDate = b.slots?.slot_date || slotDates[b.slot_id]?.slot_date || null;
      const pc = b.package_covered_quantity ?? 0;
      const isPackage = pc > 0;
      const amount = Number(b.total_price) || 0;

      if (b.customer_id) {
        if (!byCustomerId[b.customer_id]) {
          byCustomerId[b.customer_id] = { total: 0, spent: 0, packageCount: 0, paidCount: 0, lastDate: null };
        }
        const agg = byCustomerId[b.customer_id];
        agg.total += 1;
        agg.spent += amount;
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
        agg.spent += amount;
        if (isPackage) agg.packageCount += 1; else agg.paidCount += 1;
        if (slotDate && (!agg.lastDate || slotDate > agg.lastDate)) agg.lastDate = slotDate;
      }
    }

    const customerPhonesInDb = new Set((customers || []).map((c: any) => c.phone));
    const visitorRows: any[] = [];

    for (const c of customers || []) {
      const agg = byCustomerId[c.id];
      if (filters.bookingType || filters.serviceId || filters.bookingStatus || filters.startDate || filters.endDate) {
        if (!agg || agg.total === 0) continue;
      }
      visitorRows.push({
        id: c.id,
        type: 'customer',
        customer_name: c.name,
        phone: c.phone,
        email: c.email || null,
        total_bookings: agg?.total ?? 0,
        total_spent: agg?.spent ?? 0,
        package_bookings_count: agg?.packageCount ?? 0,
        paid_bookings_count: agg?.paidCount ?? 0,
        last_booking_date: agg?.lastDate ?? null,
        status: c.is_blocked ? 'blocked' : 'active',
      });
    }

    for (const [phone, agg] of Object.entries(byGuestPhone)) {
      if (customerPhonesInDb.has(phone)) continue;
      if (agg.total === 0) continue;
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

    let customersQuery = supabase.from('customers').select('id, name, phone, email, is_blocked').eq('tenant_id', tenantId);
    if (filters.name) customersQuery = customersQuery.ilike('name', `%${filters.name}%`);
    if (filters.phone) customersQuery = customersQuery.ilike('phone', `%${filters.phone}%`);
    const { data: filteredCustomers } = await customersQuery;

    let bookingsQuery = supabase
      .from('bookings')
      .select('id, customer_id, customer_phone, customer_name, customer_email, total_price, status, slot_id, service_id, package_covered_quantity, paid_quantity')
      .eq('tenant_id', tenantId);
    if (filters.serviceId) bookingsQuery = bookingsQuery.eq('service_id', filters.serviceId);
    if (filters.bookingStatus) bookingsQuery = bookingsQuery.eq('status', filters.bookingStatus);
    const { data: allBookings } = await bookingsQuery;

    const bookings = (allBookings || []) as any[];
    const slotIds = [...new Set(bookings.map((b) => b.slot_id).filter(Boolean))];
    let slotDates: Record<string, string> = {};
    if (slotIds.length > 0) {
      const { data: slotsData } = await supabase.from('slots').select('id, slot_date').in('id', slotIds);
      (slotsData || []).forEach((s: any) => { slotDates[s.id] = s.slot_date; });
    }
    const applyDateFilter = (b: any) => {
      if (!filters.startDate && !filters.endDate) return true;
      const d = slotDates[b.slot_id];
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

    const byCustomerId: Record<string, { total: number; spent: number; packageCount: number; paidCount: number; lastDate: string | null }> = {};
    const byGuestPhone: Record<string, { name: string; email: string | null; total: number; spent: number; packageCount: number; paidCount: number; lastDate: string | null }> = {};
    for (const b of filteredBookings) {
      const slotDate = slotDates[b.slot_id] || null;
      const pc = b.package_covered_quantity ?? 0;
      const isPackage = pc > 0;
      const amount = Number(b.total_price) || 0;
      if (b.customer_id) {
        if (!byCustomerId[b.customer_id]) byCustomerId[b.customer_id] = { total: 0, spent: 0, packageCount: 0, paidCount: 0, lastDate: null };
        const agg = byCustomerId[b.customer_id];
        agg.total += 1;
        agg.spent += amount;
        if (isPackage) agg.packageCount += 1; else agg.paidCount += 1;
        if (slotDate && (!agg.lastDate || slotDate > agg.lastDate)) agg.lastDate = slotDate;
      } else {
        const phone = (b.customer_phone || '').trim();
        if (!phone) continue;
        if (!byGuestPhone[phone]) byGuestPhone[phone] = { name: b.customer_name || '', email: b.customer_email || null, total: 0, spent: 0, packageCount: 0, paidCount: 0, lastDate: null };
        const agg = byGuestPhone[phone];
        agg.total += 1;
        agg.spent += amount;
        if (isPackage) agg.packageCount += 1; else agg.paidCount += 1;
        if (slotDate && (!agg.lastDate || slotDate > agg.lastDate)) agg.lastDate = slotDate;
      }
    }

    const customerPhonesInDb = new Set((filteredCustomers || []).map((c: any) => c.phone));
    const rows: any[] = [];
    for (const c of filteredCustomers || []) {
      const agg = byCustomerId[c.id];
      if (filters.bookingType || filters.serviceId || filters.bookingStatus || filters.startDate || filters.endDate) {
        if (!agg || agg.total === 0) continue;
      }
      rows.push({
        customer_name: c.name,
        phone: c.phone,
        email: c.email || null,
        total_bookings: agg?.total ?? 0,
        total_spent: agg?.spent ?? 0,
        package_bookings_count: agg?.packageCount ?? 0,
        paid_bookings_count: agg?.paidCount ?? 0,
        last_booking_date: agg?.lastDate ?? null,
        status: (c as any).is_blocked ? 'Blocked' : 'Active',
      });
    }
    for (const [phone, agg] of Object.entries(byGuestPhone)) {
      if (customerPhonesInDb.has(phone)) continue;
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

    if (format === 'csv') {
      const header = 'Customer Name,Phone,Email,Total Bookings,Total Spent,Package Bookings,Paid Bookings,Last Booking Date,Status';
      const csvRows = rows.map((r) =>
        [r.customer_name, r.phone, r.email, r.total_bookings, r.total_spent, r.package_bookings_count, r.paid_bookings_count, r.last_booking_date || '', r.status].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="visitors-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send([header, ...csvRows].join('\r\n'));
    }

    if (format === 'xlsx') {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Visitors');
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
        const PDFDocument = await import('pdfkit');
        const doc = new (PDFDocument as any)({ margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="visitors-${new Date().toISOString().slice(0, 10)}.pdf"`);
        doc.pipe(res);
        doc.fontSize(18).text('Visitors Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10);
        for (const r of rows) {
          doc.text(`Name: ${r.customer_name} | Phone: ${r.phone} | Bookings: ${r.total_bookings} | Spent: ${r.total_spent} | Status: ${r.status}`);
          doc.moveDown(0.5);
        }
        doc.end();
        return;
      } catch (e) {
        return res.status(500).json({ error: 'PDF export failed. Use CSV or Excel.' });
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
      const totalSpent = list.reduce((s, b) => s + (Number(b.total_price) || 0), 0);
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
    const totalSpent = list.reduce((s, b) => s + (Number(b.total_price) || 0), 0);
    const packageCount = list.filter((b) => (b.package_covered_quantity ?? 0) > 0).length;
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
