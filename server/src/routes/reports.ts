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

type TxType = 'all' | 'booking_payment' | 'package_purchase';

function buildTransactionRows(
  bookings: any[],
  subs: any[],
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
      const slotDate = b.slots?.slot_date || '';
      const sortKey = slotDate || (b.created_at || '').slice(0, 10);
      if (filters.startDate && sortKey && sortKey < filters.startDate) continue;
      if (filters.endDate && sortKey && sortKey > filters.endDate) continue;
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
        date: sortKey,
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
      const sortKey = (s.subscribed_at || '').slice(0, 10);
      if (filters.startDate && sortKey && sortKey < filters.startDate) continue;
      if (filters.endDate && sortKey && sortKey > filters.endDate) continue;
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
        date: sortKey,
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

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
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
    const merged = buildTransactionRows(bookings, subs, {
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
    const merged = buildTransactionRows(bookings, subs, {
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
