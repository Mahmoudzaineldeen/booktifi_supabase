import express from 'express';
import { supabase } from '../db';
import { logger } from '../utils/logger';
import { authenticateVisitorsAccess } from '../middleware/authenticateVisitorsAccess.js';
import { formatTimeTo12Hour } from '../utils/timeFormat.js';

const router = express.Router();
const PAGE_FETCH = 800;

const STAFF_ROLES_FOR_FILTER = [
  'employee',
  'receptionist',
  'coordinator',
  'cashier',
  'customer_admin',
  'admin_user',
  'tenant_admin',
];

/** Staff list for report filters (no manage_employees permission required). */
router.get('/filter-employees', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const forBooking = String(req.query.for || '').toLowerCase() === 'booking';
    let q = supabase.from('users').select('id, full_name, full_name_ar').eq('tenant_id', tenantId);
    if (forBooking) {
      q = q.eq('role', 'employee');
    } else {
      q = q.in('role', STAFF_ROLES_FOR_FILTER);
    }
    const { data, error } = await q.order('full_name');
    if (error) throw error;
    res.json({ employees: data ?? [] });
  } catch (e: any) {
    logger.error('Reports filter-employees error', e);
    res.status(500).json({ error: e.message || 'Failed to load employees' });
  }
});

function parsePrice(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function branchScope(req: express.Request, branchParam: string | undefined): string | null | undefined {
  const role = (req.user as any)?.role;
  if (role === 'receptionist' || role === 'cashier') {
    return (req.user as any).branch_id || null;
  }
  const b = (branchParam || '').trim();
  if (!b || b === 'all') return undefined;
  return b;
}

function paymentLabel(m: string | null | undefined): string {
  if (!m) return '';
  if (m === 'transfer') return 'Transfer';
  if (m === 'onsite') return 'On Site';
  return String(m);
}

/** How payment applies: package coverage vs paid on site vs bank transfer (aligned with app payment display). */
type BookingReportPaymentWay = 'package_covered' | 'paid_onsite' | 'bank_transfer' | 'unpaid';

function bookingReportPaymentWay(b: {
  package_covered_quantity?: number | null;
  payment_status?: string | null;
  payment_method?: string | null;
}): BookingReportPaymentWay {
  const pc = Number(b.package_covered_quantity ?? 0);
  if (pc > 0) return 'package_covered';
  const status = String(b.payment_status || '').toLowerCase();
  const method = String(b.payment_method || '').toLowerCase();
  if (status === 'unpaid' || status === 'awaiting_payment' || status === 'refunded') return 'unpaid';
  if (status === 'paid' || status === 'paid_manual') {
    return method === 'transfer' ? 'bank_transfer' : 'paid_onsite';
  }
  return 'unpaid';
}

function bookingPaymentWayExportLabel(way: BookingReportPaymentWay): string {
  switch (way) {
    case 'package_covered':
      return 'Package (covered)';
    case 'paid_onsite':
      return 'Paid on site';
    case 'bank_transfer':
      return 'Bank transfer';
    default:
      return 'Unpaid';
  }
}

function formatCreatedAtForExport(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

const PAID_BOOKING_PAYMENT_STATUSES = new Set(['paid', 'paid_manual']);

function isPaidBookingStatus(paymentStatus: unknown): boolean {
  if (paymentStatus == null) return false;
  return PAID_BOOKING_PAYMENT_STATUSES.has(String(paymentStatus).toLowerCase());
}

function bookingDateKey(b: any): string {
  return String(b?.slots?.slot_date || '');
}

function bookingStartTimeKey(b: any): string {
  return String(b?.slots?.start_time || '');
}

function sortBookingsByBookingDateAndTime(list: any[]): any[] {
  return [...list].sort((a, b) => {
    const dateA = bookingDateKey(a);
    const dateB = bookingDateKey(b);
    if (dateA !== dateB) return dateB.localeCompare(dateA); // Newer booking date first.

    const timeA = bookingStartTimeKey(a);
    const timeB = bookingStartTimeKey(b);
    if (timeA !== timeB) return timeA.localeCompare(timeB); // Earlier time first within same day.

    return String(b?.created_at || '').localeCompare(String(a?.created_at || ''));
  });
}

function buildDateKeys(startDate?: string, endDate?: string): string[] {
  if (!startDate || !endDate) return [];
  const out: string[] = [];
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out;
  let cur = start;
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

async function fetchAllBookingsTenant(tenantId: string, branchId?: string | null) {
  const out: any[] = [];
  let offset = 0;
  for (;;) {
    let q = supabase
      .from('bookings')
      .select(
        `
        id,
        tenant_id,
        customer_id,
        customer_name,
        customer_phone,
        visitor_count,
        total_price,
        status,
        payment_status,
        payment_method,
        transaction_reference,
        created_at,
        service_id,
        slot_id,
        employee_id,
        branch_id,
        package_covered_quantity,
        services:service_id(name, name_ar),
        slots:slot_id(slot_date, start_time, end_time),
        users:employee_id(full_name, full_name_ar),
        branches:branch_id(name)
      `
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_FETCH - 1);
    if (branchId) q = q.eq('branch_id', branchId);
    const { data, error } = await q;
    if (error) throw error;
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < PAGE_FETCH) break;
    offset += PAGE_FETCH;
  }
  return out;
}

async function fetchPaidSubscriptionsTenant(tenantId: string, branchId?: string | null) {
  const out: any[] = [];
  let offset = 0;
  for (;;) {
    let q = supabase
      .from('package_subscriptions')
      .select(
        `
        id,
        tenant_id,
        customer_id,
        branch_id,
        payment_status,
        payment_method,
        transaction_reference,
        subscribed_at,
        service_packages(name, name_ar, total_price),
        customers(name, phone),
        branches:branch_id(name)
      `
      )
      .eq('tenant_id', tenantId)
      .eq('payment_status', 'paid')
      .order('subscribed_at', { ascending: false })
      .range(offset, offset + PAGE_FETCH - 1);
    if (branchId) q = q.eq('branch_id', branchId);
    const { data, error } = await q;
    if (error) throw error;
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < PAGE_FETCH) break;
    offset += PAGE_FETCH;
  }
  return out;
}

function isPaidStatusForTransaction(status: unknown): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'paid' || s === 'paid_manual';
}

async function fetchLatestPaidEventAtByBooking(tenantId: string, bookingIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!Array.isArray(bookingIds) || bookingIds.length === 0) return out;

  const CHUNK = 500;
  for (let i = 0; i < bookingIds.length; i += CHUNK) {
    const ids = bookingIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('audit_logs')
      .select('resource_id, created_at, new_values')
      .eq('tenant_id', tenantId)
      .eq('resource_type', 'booking')
      .eq('action_type', 'payment_status_update')
      .in('resource_id', ids)
      .order('created_at', { ascending: false });
    if (error) throw error;

    for (const row of (data || []) as any[]) {
      const bookingId = String(row?.resource_id || '');
      if (!bookingId || out.has(bookingId)) continue;
      const newStatus = row?.new_values?.payment_status;
      if (!isPaidStatusForTransaction(newStatus)) continue;
      const ts = String(row?.created_at || '');
      if (ts) out.set(bookingId, ts);
    }
  }
  return out;
}

type TxType = 'all' | 'booking_payment' | 'package_purchase';

function buildTransactionRows(
  bookings: any[],
  subs: any[],
  bookingPaidEventAtMap: Map<string, string>,
  filters: {
    startDate?: string;
    endDate?: string;
    paymentMethod?: string;
    employeeId?: string;
    txType: TxType;
  }
) {
  const rows: any[] = [];
  const payFilter = (filters.paymentMethod || '').trim().toLowerCase();

  function rowMatchesPaymentMethod(dbMethod: string | null | undefined): boolean {
    if (!payFilter) return true;
    const db = String(dbMethod || '').toLowerCase();
    if (payFilter === 'transfer' || payFilter === 'onsite') return db === payFilter;
    const pm = paymentLabel(dbMethod);
    return db.includes(payFilter) || pm.toLowerCase().includes(payFilter);
  }

  if (filters.txType === 'all' || filters.txType === 'booking_payment') {
    for (const b of bookings) {
      if (filters.employeeId && b.employee_id !== filters.employeeId) continue;
      const createdAt = String(b.created_at || '');
      const paidEventAt = bookingPaidEventAtMap.get(String(b.id || ''));
      const transactionAt = paidEventAt || createdAt || '';
      const dateKey = transactionAt.slice(0, 10);
      if (filters.startDate && dateKey && dateKey < filters.startDate) continue;
      if (filters.endDate && dateKey && dateKey > filters.endDate) continue;
      const pm = paymentLabel(b.payment_method);
      if (!rowMatchesPaymentMethod(b.payment_method)) continue;
      const emp = (b.users?.full_name || b.users?.full_name_ar || '').trim() || null;
      rows.push({
        id: `booking:${b.id}`,
        transaction_type: 'booking_payment',
        booking_id: b.id,
        customer_name: b.customer_name || b.customers?.name || '—',
        customer_phone: b.customer_phone || null,
        amount: parsePrice(b.total_price),
        payment_method: pm || (b.payment_method ?? ''),
        payment_status: b.payment_status || '',
        date: dateKey,
        transaction_at: transactionAt || null,
        time: b.slots?.start_time ? formatTimeTo12Hour(b.slots.start_time) : '',
        service_name: b.services?.name || '',
        package_name: null as string | null,
        employee_name: emp,
        branch_name: b.branches?.name || '',
        branch_id: b.branch_id,
        transaction_reference: b.transaction_reference || '',
      });
    }
  }

  if (filters.txType === 'all' || filters.txType === 'package_purchase') {
    for (const s of subs) {
      const transactionAt = String(s.subscribed_at || '');
      const dateKey = transactionAt.slice(0, 10);
      if (filters.startDate && dateKey && dateKey < filters.startDate) continue;
      if (filters.endDate && dateKey && dateKey > filters.endDate) continue;
      const pm = paymentLabel(s.payment_method);
      if (!rowMatchesPaymentMethod(s.payment_method)) continue;
      rows.push({
        id: `package:${s.id}`,
        transaction_type: 'package_purchase',
        booking_id: null,
        customer_name: s.customers?.name || '—',
        customer_phone: s.customers?.phone || null,
        amount: parsePrice(s.service_packages?.total_price),
        payment_method: pm || (s.payment_method ?? ''),
        payment_status: s.payment_status || '',
        date: dateKey,
        transaction_at: transactionAt || null,
        time: '',
        service_name: '',
        package_name: s.service_packages?.name || '',
        employee_name: null,
        branch_name: s.branches?.name || '',
        branch_id: s.branch_id,
        transaction_reference: s.transaction_reference || '',
      });
    }
  }

  rows.sort((a, b) => String(b.transaction_at || b.date || '').localeCompare(String(a.transaction_at || a.date || '')) || String(b.id).localeCompare(String(a.id)));
  return rows;
}

router.get('/transactions', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const branchId = branchScope(req, req.query.branch_id as string);
    const startDate = (req.query.startDate as string)?.trim() || undefined;
    const endDate = (req.query.endDate as string)?.trim() || undefined;
    const paymentMethod = (req.query.payment_method as string)?.trim() || undefined;
    const employeeId = (req.query.employee_id as string)?.trim() || undefined;
    const txType = ((req.query.transaction_type as string)?.trim() || 'all') as TxType;

    const [bookings, subs] = await Promise.all([
      fetchAllBookingsTenant(tenantId, branchId),
      fetchPaidSubscriptionsTenant(tenantId, branchId),
    ]);
    const bookingPaidEventDateMap = await fetchLatestPaidEventAtByBooking(
      tenantId,
      bookings.map((b: any) => String(b.id || '')).filter(Boolean)
    );
    const merged = buildTransactionRows(bookings, subs, bookingPaidEventDateMap, {
      startDate,
      endDate,
      paymentMethod,
      employeeId,
      txType: ['booking_payment', 'package_purchase', 'all'].includes(txType) ? txType : 'all',
    });
    const total = merged.length;
    const offset = (page - 1) * limit;
    const slice = merged.slice(offset, offset + limit);
    res.json({
      data: slice,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: offset + limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (e: any) {
    logger.error('Reports transactions list error', e);
    res.status(500).json({ error: e.message || 'Failed to load transactions' });
  }
});

router.get('/bookings', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const branchId = branchScope(req, req.query.branch_id as string);
    const startDate = (req.query.startDate as string)?.trim() || undefined;
    const endDate = (req.query.endDate as string)?.trim() || undefined;
    const serviceId = (req.query.service_id as string)?.trim() || undefined;
    const status = (req.query.status as string)?.trim() || undefined;
    const employeeId = (req.query.employee_id as string)?.trim() || undefined;

    const all = await fetchAllBookingsTenant(tenantId, branchId);
    let list = all;
    if (serviceId) list = list.filter((b) => b.service_id === serviceId);
    if (status) list = list.filter((b) => String(b.status) === status);
    if (employeeId) list = list.filter((b) => b.employee_id === employeeId);
    list = list.filter((b) => {
      const d = b.slots?.slot_date || '';
      if (startDate && d && d < startDate) return false;
      if (endDate && d && d > endDate) return false;
      return true;
    });
    list = sortBookingsByBookingDateAndTime(list);

    const total = list.length;
    const offset = (page - 1) * limit;
    const slice = list.slice(offset, offset + limit).map((b) => {
      const payment_way = bookingReportPaymentWay(b);
      return {
        id: b.id,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        visitor_count: b.visitor_count,
        total_price: parsePrice(b.total_price),
        status: b.status,
        payment_status: b.payment_status,
        payment_method: paymentLabel(b.payment_method),
        payment_way,
        created_at: b.created_at ?? null,
        slot_date: b.slots?.slot_date,
        start_time: b.slots?.start_time,
        service_name: b.services?.name,
        service_name_ar: b.services?.name_ar,
        employee_name: (b.users?.full_name || b.users?.full_name_ar || '').trim() || null,
        branch_name: b.branches?.name || '',
        package_covered_quantity: b.package_covered_quantity ?? 0,
      };
    });

    res.json({
      data: slice,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: offset + limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (e: any) {
    logger.error('Reports bookings list error', e);
    res.status(500).json({ error: e.message || 'Failed to load bookings report' });
  }
});

function csvEscape(v: unknown) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

async function sendTransactionsExport(res: express.Response, format: string, rows: any[]) {
  if (format === 'csv') {
    const header = [
      'Transaction ID',
      'Type',
      'Date',
      'Customer',
      'Phone',
      'Amount',
      'Payment Method',
      'Payment Status',
      'Booking ID',
      'Package',
      'Service',
      'Employee',
      'Branch',
      'Transaction Ref',
    ];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.id,
          r.transaction_type,
          r.date,
          r.customer_name,
          r.customer_phone,
          r.amount,
          r.payment_method,
          r.payment_status,
          r.booking_id || '',
          r.package_name || '',
          r.service_name || '',
          r.employee_name || '',
          r.branch_name || '',
          r.transaction_reference || '',
        ]
          .map(csvEscape)
          .join(',')
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send('\uFEFF' + lines.join('\r\n'));
  }

  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const aoa = [
      [
        'Transaction ID',
        'Type',
        'Date',
        'Customer',
        'Phone',
        'Amount',
        'Payment Method',
        'Booking ID',
        'Package',
        'Employee',
        'Branch',
      ],
      ...rows.map((r) => [
        r.id,
        r.transaction_type,
        r.date,
        r.customer_name,
        r.customer_phone,
        r.amount,
        r.payment_method,
        r.booking_id || '',
        r.package_name || '',
        r.employee_name || '',
        r.branch_name || '',
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.send(buf);
  }

  if (format === 'pdf') {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.fontSize(14).text('Transactions Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(8);
    rows.slice(0, 200).forEach((r) => {
      doc.text(
        `${r.id} | ${r.transaction_type} | ${r.date} | ${r.customer_name} | ${r.amount} | ${r.payment_method} | ${r.booking_id || '-'} | ${r.package_name || '-'} | ${r.employee_name || '-'} | ${r.branch_name || ''}`,
        { width: 760 }
      );
      doc.moveDown(0.2);
    });
    if (rows.length > 200) doc.moveDown().fontSize(9).text(`… and ${rows.length - 200} more rows (export CSV or Excel for full data).`);
    doc.end();
    const pdfBuffer = await done;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.pdf"`);
    return res.send(pdfBuffer);
  }

  return res.status(400).json({ error: 'Invalid format' });
}

router.get('/transactions/export/:format', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const format = (req.params.format || 'csv').toLowerCase();
    if (!['csv', 'xlsx', 'pdf'].includes(format)) return res.status(400).json({ error: 'Invalid format' });

    const branchId = branchScope(req, req.query.branch_id as string);
    const startDate = (req.query.startDate as string)?.trim() || undefined;
    const endDate = (req.query.endDate as string)?.trim() || undefined;
    const paymentMethod = (req.query.payment_method as string)?.trim() || undefined;
    const employeeId = (req.query.employee_id as string)?.trim() || undefined;
    const txType = ((req.query.transaction_type as string)?.trim() || 'all') as TxType;

    const [bookings, subs] = await Promise.all([
      fetchAllBookingsTenant(tenantId, branchId),
      fetchPaidSubscriptionsTenant(tenantId, branchId),
    ]);
    const bookingPaidEventDateMap = await fetchLatestPaidEventAtByBooking(
      tenantId,
      bookings.map((b: any) => String(b.id || '')).filter(Boolean)
    );
    const merged = buildTransactionRows(bookings, subs, bookingPaidEventDateMap, {
      startDate,
      endDate,
      paymentMethod,
      employeeId,
      txType: ['booking_payment', 'package_purchase', 'all'].includes(txType) ? txType : 'all',
    });
    return sendTransactionsExport(res, format, merged);
  } catch (e: any) {
    logger.error('Reports transactions export error', e);
    res.status(500).json({ error: e.message || 'Export failed' });
  }
});

router.get('/dashboard-summary', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const branchId = branchScope(req, req.query.branch_id as string);
    const startDate = (req.query.startDate as string)?.trim() || undefined;
    const endDate = (req.query.endDate as string)?.trim() || undefined;

    const [allBookings, paidSubs] = await Promise.all([
      fetchAllBookingsTenant(tenantId, branchId),
      fetchPaidSubscriptionsTenant(tenantId, branchId),
    ]);

    const filteredBookings = allBookings.filter((b) => {
      const d = bookingDateKey(b);
      if (startDate && d && d < startDate) return false;
      if (endDate && d && d > endDate) return false;
      return true;
    });

    const totalBookings = filteredBookings.length;
    const paidBookings = filteredBookings.filter((b) => isPaidBookingStatus(b?.payment_status)).length;
    const unpaidBookings = Math.max(0, totalBookings - paidBookings);
    const completedBookings = filteredBookings.filter((b) => String(b.status || '').toLowerCase() === 'completed').length;
    const paidBookingRevenue = filteredBookings.reduce((sum, b) => {
      const isPackage = Number(b?.package_covered_quantity ?? 0) > 0;
      if (isPackage) return sum;
      if (!isPaidBookingStatus(b?.payment_status)) return sum;
      return sum + parsePrice(b?.total_price);
    }, 0);
    const unpaidBookingRevenue = filteredBookings.reduce((sum, b) => {
      const isPackage = Number(b?.package_covered_quantity ?? 0) > 0;
      if (isPackage) return sum;
      if (isPaidBookingStatus(b?.payment_status)) return sum;
      return sum + parsePrice(b?.total_price);
    }, 0);
    const bookingRevenue = filteredBookings.reduce((sum, b) => {
      const isPackage = Number(b?.package_covered_quantity ?? 0) > 0;
      if (isPackage) return sum;
      return sum + parsePrice(b?.total_price);
    }, 0);

    const packageSubsInRange = paidSubs.filter((s) => {
      const d = String((s?.subscribed_at || '').slice(0, 10));
      if (startDate && d && d < startDate) return false;
      if (endDate && d && d > endDate) return false;
      return true;
    });

    const packageSubscriptions = packageSubsInRange.length;
    const packageRevenue = packageSubsInRange.reduce((sum, s) => sum + parsePrice(s?.service_packages?.total_price), 0);
    const averageBookingValue = totalBookings > 0 ? bookingRevenue / totalBookings : 0;

    const dateKeys = buildDateKeys(startDate, endDate);
    const serviceMap = new Map<string, {
      id: string;
      name: string;
      name_ar: string;
      bookings: number;
      revenue: number;
      paidRevenue: number;
      unpaidRevenue: number;
      dailyData: Map<string, { bookings: number; revenue: number }>;
    }>();

    for (const b of filteredBookings) {
      const serviceId = String(b?.service_id || '');
      if (!serviceId) continue;
      const date = bookingDateKey(b);
      const serviceName = String(b?.services?.name || '');
      const serviceNameAr = String(b?.services?.name_ar || '');
      // Keep chart behavior aligned with previous dashboard:
      // revenue distribution uses booking totals by service (not only paid subset).
      const revenue = parsePrice(b?.total_price);
      const isPackage = Number(b?.package_covered_quantity ?? 0) > 0;
      const isPaid = isPaidBookingStatus(b?.payment_status);
      const paidRevenue = !isPackage && isPaid ? revenue : 0;
      const unpaidRevenue = !isPackage && !isPaid ? revenue : 0;

      if (!serviceMap.has(serviceId)) {
        serviceMap.set(serviceId, {
          id: serviceId,
          name: serviceName,
          name_ar: serviceNameAr,
          bookings: 0,
          revenue: 0,
          paidRevenue: 0,
          unpaidRevenue: 0,
          dailyData: new Map<string, { bookings: number; revenue: number }>(),
        });
      }
      const agg = serviceMap.get(serviceId)!;
      agg.bookings += 1;
      agg.revenue += revenue;
      agg.paidRevenue += paidRevenue;
      agg.unpaidRevenue += unpaidRevenue;

      if (date) {
        const row = agg.dailyData.get(date) || { bookings: 0, revenue: 0 };
        row.bookings += 1;
        row.revenue += revenue;
        agg.dailyData.set(date, row);
      }
    }

    const servicePerformance = Array.from(serviceMap.values())
      .map((s) => ({
        id: s.id,
        name: s.name,
        name_ar: s.name_ar,
        bookings: s.bookings,
        revenue: s.revenue,
        paidRevenue: s.paidRevenue,
        unpaidRevenue: s.unpaidRevenue,
        dailyData: (dateKeys.length ? dateKeys : Array.from(s.dailyData.keys()).sort()).map((d) => {
          const row = s.dailyData.get(d);
          return { date: d, bookings: row?.bookings ?? 0, revenue: row?.revenue ?? 0 };
        }),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return res.json({
      summary: {
        totalBookings,
        paidBookings,
        unpaidBookings,
        bookingRevenue,
        paidBookingRevenue,
        unpaidBookingRevenue,
        packageSubscriptions,
        packageRevenue,
        completedBookings,
        averageBookingValue,
        totalRevenueCombined: bookingRevenue + packageRevenue,
      },
      servicePerformance,
    });
  } catch (e: any) {
    logger.error('Reports dashboard summary error', e);
    return res.status(500).json({ error: e.message || 'Failed to load dashboard summary' });
  }
});

router.get('/bookings/export/:format', authenticateVisitorsAccess, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const format = (req.params.format || 'csv').toLowerCase();
    if (!['csv', 'xlsx', 'pdf'].includes(format)) return res.status(400).json({ error: 'Invalid format' });

    const branchId = branchScope(req, req.query.branch_id as string);
    const startDate = (req.query.startDate as string)?.trim() || undefined;
    const endDate = (req.query.endDate as string)?.trim() || undefined;
    const serviceId = (req.query.service_id as string)?.trim() || undefined;
    const status = (req.query.status as string)?.trim() || undefined;
    const employeeId = (req.query.employee_id as string)?.trim() || undefined;

    const all = await fetchAllBookingsTenant(tenantId, branchId);
    let list = all;
    if (serviceId) list = list.filter((b) => b.service_id === serviceId);
    if (status) list = list.filter((b) => String(b.status) === status);
    if (employeeId) list = list.filter((b) => b.employee_id === employeeId);
    list = list.filter((b) => {
      const d = b.slots?.slot_date || '';
      if (startDate && d && d < startDate) return false;
      if (endDate && d && d > endDate) return false;
      return true;
    });
    list = sortBookingsByBookingDateAndTime(list);

    const rows = list.map((b) => {
      const payment_way = bookingReportPaymentWay(b);
      return {
        id: b.id,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        slot_date: b.slots?.slot_date,
        start_time: b.slots?.start_time ? formatTimeTo12Hour(b.slots.start_time) : '',
        service_name: b.services?.name,
        status: b.status,
        payment_status: b.payment_status,
        payment_method: paymentLabel(b.payment_method),
        payment_way,
        payment_way_label: bookingPaymentWayExportLabel(payment_way),
        created_at: b.created_at ?? null,
        created_at_export: formatCreatedAtForExport(b.created_at),
        total_price: parsePrice(b.total_price),
        visitor_count: b.visitor_count,
        employee_name: (b.users?.full_name || b.users?.full_name_ar || '').trim() || '',
        branch_name: b.branches?.name || '',
        package_covered_quantity: b.package_covered_quantity ?? 0,
      };
    });

    if (format === 'csv') {
      const header = [
        'Booking ID',
        'Slot date',
        'Slot time',
        'Booking created (UTC)',
        'Customer',
        'Phone',
        'Service',
        'Status',
        'Payment way',
        'Amount',
        'Visitors',
        'Employee',
        'Branch',
      ];
      const lines = [
        header.join(','),
        ...rows.map((r) =>
          [
            r.id,
            r.slot_date,
            r.start_time,
            r.created_at_export,
            r.customer_name,
            r.customer_phone,
            r.service_name,
            r.status,
            r.payment_way_label,
            r.total_price,
            r.visitor_count,
            r.employee_name,
            r.branch_name,
          ]
            .map(csvEscape)
            .join(',')
        ),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bookings-report-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send('\uFEFF' + lines.join('\r\n'));
    }

    if (format === 'xlsx') {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const aoa = [
        [
          'Booking ID',
          'Slot date',
          'Slot time',
          'Booking created (UTC)',
          'Customer',
          'Phone',
          'Service',
          'Status',
          'Payment way',
          'Amount',
          'Visitors',
          'Employee',
          'Branch',
        ],
        ...rows.map((r) => [
          r.id,
          r.slot_date,
          r.start_time,
          r.created_at_export,
          r.customer_name,
          r.customer_phone,
          r.service_name,
          r.status,
          r.payment_way_label,
          r.total_price,
          r.visitor_count,
          r.employee_name,
          r.branch_name,
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="bookings-report-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      return res.send(buf);
    }

    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.fontSize(14).text('Bookings Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(8);
    rows.slice(0, 200).forEach((r) => {
      doc.text(
        `${r.id} | ${r.slot_date} | ${r.start_time} | ${r.created_at_export} | ${r.customer_name} | ${r.service_name} | ${r.status} | ${r.payment_way_label} | ${r.total_price} | ${r.visitor_count} | ${r.employee_name || '—'} | ${r.branch_name}`,
        { width: 760 }
      );
      doc.moveDown(0.2);
    });
    if (rows.length > 200) doc.moveDown().text(`… and ${rows.length - 200} more rows.`);
    doc.end();
    const pdfBuffer = await done;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bookings-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
    return res.send(pdfBuffer);
  } catch (e: any) {
    logger.error('Reports bookings export error', e);
    res.status(500).json({ error: e.message || 'Export failed' });
  }
});

export { router as reportRoutes };
