import { supabase } from '../../db';
import { formatTimeTo12Hour } from '../../utils/timeFormat';
import { effectivePaidQuantityForInvoice } from './invoicePaidQuantity';
import type { UnifiedBookingGroupInvoice, UnifiedBookingInvoice, UnifiedLineItem } from './unifiedInvoiceTypes';

const DEFAULT_VAT_PERCENTAGE = 15;

function roundTo2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeCurrency(code: string | undefined | null): string {
  let c = (code || 'SAR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) c = 'SAR';
  return c;
}

function buildQrDataJson(params: {
  bookingId: string;
  serviceName: string;
  serviceNameAr?: string | null;
  slotDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  tenantName?: string | null;
  tenantNameAr?: string | null;
  customerName?: string | null;
  totalPrice?: number | null;
  visitorCount?: number | null;
}): string {
  const time =
    params.startTime && params.endTime
      ? `${formatTimeTo12Hour(params.startTime)} - ${formatTimeTo12Hour(params.endTime)}`
      : null;
  const payload = {
    booking_id: params.bookingId,
    service: params.serviceName || 'Service',
    service_ar: params.serviceNameAr || null,
    date: params.slotDate || null,
    time,
    tenant: params.tenantName || null,
    tenant_ar: params.tenantNameAr || null,
    customer: params.customerName || null,
    price: params.totalPrice ?? null,
    quantity: params.visitorCount ?? null,
    type: 'booking_ticket',
    version: '1.0',
  };
  return JSON.stringify(payload);
}

async function fetchPackageRemainingNote(subscriptionId: string, serviceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('package_subscription_usage')
    .select('remaining_quantity, services(name, name_ar)')
    .eq('subscription_id', subscriptionId)
    .eq('service_id', serviceId)
    .maybeSingle();
  if (error || !data) return null;
  const rem = data.remaining_quantity;
  const svc =
    (data.services as { name?: string; name_ar?: string } | null)?.name ||
    (data.services as { name?: string; name_ar?: string } | null)?.name_ar;
  if (rem === null || rem === undefined) return null;
  return svc ? `Package usage — ${svc}: ${rem} remaining` : `Package remaining for this service: ${rem}`;
}

/**
 * Map a single booking to a unified invoice payload (shared by Zoho and Daftra).
 */
export async function mapBookingToUnifiedInvoice(bookingId: string): Promise<UnifiedBookingInvoice> {
  let result = await supabase
    .from('bookings')
    .select(
      `
      *,
      services (
        id,
        name,
        name_ar,
        description,
        description_ar,
        base_price,
        duration_minutes
      ),
      slots (
        start_time,
        end_time,
        slot_date
      ),
      tenants (
        name,
        name_ar,
        currency_code,
        address
      ),
      service_offers (
        price,
        name,
        name_ar
      )
    `
    )
    .eq('id', bookingId)
    .single();

  let bookings = result.data;
  let bookingError = result.error;

  if (bookingError && (bookingError.message?.includes('currency_code') || bookingError.code === '42703')) {
    const simple = await supabase
      .from('bookings')
      .select(
        `
        *,
        services (
          id,
          name,
          name_ar,
          description,
          description_ar,
          base_price,
          duration_minutes
        ),
        slots (
          start_time,
          end_time,
          slot_date
        ),
        service_offers (
          price,
          name,
          name_ar
        )
      `
      )
      .eq('id', bookingId)
      .single();
    bookings = simple.data;
    bookingError = simple.error;
  }

  if (bookingError || !bookings) {
    throw new Error(`Booking ${bookingId} not found or query failed: ${bookingError?.message || 'Unknown error'}`);
  }

  let tenantCurrency = (bookings as any).tenants?.currency_code;
  if (!tenantCurrency && bookings.tenant_id) {
    const { data: tenantData } = await supabase.from('tenants').select('currency_code, name, name_ar, address').eq('id', bookings.tenant_id).maybeSingle();
    tenantCurrency = tenantData?.currency_code;
    if (!(bookings as any).tenants && tenantData) {
      (bookings as any).tenants = tenantData;
    }
  }

  const currency_code = normalizeCurrency(tenantCurrency);

  const svc = bookings.services as
    | { name?: string; name_ar?: string; description?: string; description_ar?: string; base_price?: unknown; duration_minutes?: number }
    | null
    | undefined;
  const serviceName = (svc?.name_ar || svc?.name || 'Service').trim() || 'Service';
  let serviceDescription = (svc?.description_ar || svc?.description || '') as string;
  serviceDescription = serviceDescription.trim();

  const paidQty = effectivePaidQuantityForInvoice({
    paid_quantity: bookings.paid_quantity,
    visitor_count: bookings.visitor_count,
    package_covered_quantity: bookings.package_covered_quantity,
  });
  const packageCoveredQty = bookings.package_covered_quantity || 0;

  if (paidQty <= 0) {
    throw new Error('Cannot create invoice: paid quantity is 0 or total price is 0');
  }

  const totalPrice = parseFloat(bookings.total_price?.toString() || '0');
  if (totalPrice <= 0) {
    throw new Error('Invalid invoice data: paid quantity > 0 but total price = 0');
  }
  const subtotal = roundTo2(totalPrice);
  // VAT calculation
  const vat_amount = roundTo2(subtotal * (DEFAULT_VAT_PERCENTAGE / 100));
  const total = roundTo2(subtotal + vat_amount);

  const lineItems: UnifiedLineItem[] = [];
  let itemName = serviceName;
  const off = bookings.service_offers as { name?: string; name_ar?: string } | null | undefined;
  if (bookings.offer_id && off?.name) {
    const offerName = (off.name_ar || off.name).trim();
    itemName = offerName !== serviceName ? `${serviceName} - ${offerName}` : `${serviceName} (Offer)`;
  }

  let itemDescription = serviceDescription;
  if (packageCoveredQty > 0) {
    const coverageNote = ` (${packageCoveredQty} tickets covered by package)`;
    itemDescription = serviceDescription ? `${serviceDescription}${coverageNote}` : coverageNote.trim();
  }

  const qtyNote = paidQty > 1 ? ` (${paidQty} tickets)` : '';
  const unitRate = paidQty > 0 ? Math.round((totalPrice / paidQty) * 1000000) / 1000000 : totalPrice;
  lineItems.push({
    name: itemName,
    description: [itemDescription, qtyNote].filter(Boolean).join(' ').trim() || undefined,
    // Use unit-rate x quantity so Daftra prints a natural receipt grid (Qty / Price / Total).
    rate: unitRate,
    quantity: paidQty,
    unit: 'ticket',
  });

  const bookingDate = new Date(bookings.created_at);
  const slotDate = bookings.slots?.slot_date ? new Date(bookings.slots.slot_date) : bookingDate;
  const invoiceDate = new Date();
  invoiceDate.setHours(0, 0, 0, 0);
  let dueDate = slotDate;
  if (dueDate <= invoiceDate) {
    dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + 7);
  }

  const custom_fields: Record<string, unknown> = {
    booking_id: bookings.id,
    slot_date: slotDate.toISOString().split('T')[0],
  };

  let slot_time_range: string | undefined;
  if (bookings.slots?.start_time && bookings.slots?.end_time) {
    const st = String(bookings.slots.start_time);
    const et = String(bookings.slots.end_time);
    slot_time_range = `${formatTimeTo12Hour(st)} - ${formatTimeTo12Hour(et)}`;
    custom_fields.slot_time = slot_time_range;
  }

  const payMethod = (bookings as any).payment_method as string | undefined;
  const payRef = (bookings as any).transaction_reference?.toString?.()?.trim();
  let notes = bookings.notes || `Booking ID: ${bookings.id}`;
  if (payMethod === 'transfer' && payRef) {
    notes += `\nPayment: Bank transfer. Reference: ${payRef}`;
  } else if (payMethod === 'onsite' || payMethod === 'cash') {
    notes += '\nPayment: Paid on site';
  }

  const payment_summary =
    payMethod === 'transfer' && payRef
      ? `Bank transfer. Reference: ${payRef}`
      : payMethod === 'onsite' || payMethod === 'cash'
        ? 'Paid on site'
        : payMethod
          ? String(payMethod)
          : '—';

  const tenantRow = (bookings as any).tenants as { name?: string; name_ar?: string; address?: string } | undefined;

  let employeeName: string | null = null;
  if (bookings.employee_id) {
    const { data: emp } = await supabase.from('users').select('full_name').eq('id', bookings.employee_id).maybeSingle();
    employeeName = emp?.full_name || null;
  }

  let pkgRow: { id?: string; name?: string; name_ar?: string } | null = null;
  if (bookings.package_id) {
    const { data: pkg } = await supabase
      .from('service_packages')
      .select('id, name, name_ar')
      .eq('id', bookings.package_id)
      .maybeSingle();
    if (pkg) pkgRow = pkg;
  }

  let package_remaining_note: string | null = null;
  const subId = (bookings as any).package_subscription_id as string | undefined;
  if (subId && bookings.service_id) {
    package_remaining_note = await fetchPackageRemainingNote(subId, bookings.service_id);
  }

  const duration_minutes = svc?.duration_minutes ?? null;

  const qr_data_json = buildQrDataJson({
    bookingId: bookings.id,
    serviceName,
    serviceNameAr: svc?.name_ar,
    slotDate: bookings.slots?.slot_date || null,
    startTime: bookings.slots?.start_time ? String(bookings.slots.start_time) : null,
    endTime: bookings.slots?.end_time ? String(bookings.slots.end_time) : null,
    tenantName: tenantRow?.name || null,
    tenantNameAr: tenantRow?.name_ar || null,
    customerName: bookings.customer_name,
    totalPrice,
    visitorCount: bookings.visitor_count,
  });

  const internal_invoice_ref = `BK-${bookings.id}`;

  const context: UnifiedBookingInvoice['context'] = {
    booking_id: bookings.id,
    package_id: pkgRow?.id || (bookings as any).package_id || null,
    package_name: pkgRow?.name || null,
    package_subscription_id: subId || null,
    package_remaining_note,
    slot_date: bookings.slots?.slot_date || null,
    slot_time_range: slot_time_range || null,
    duration_minutes,
    employee_name: employeeName,
    branch_name: tenantRow?.name || null,
    branch_address: tenantRow?.address || null,
    tenant_name: tenantRow?.name || null,
    payment_summary,
    qr_data_json,
    offer_label: off?.name || null,
    internal_invoice_ref,
  };

  return {
    tenant_id: bookings.tenant_id,
    booking_id: bookings.id,
    customer_name: bookings.customer_name,
    customer_email: bookings.customer_email || undefined,
    customer_phone: bookings.customer_phone || undefined,
    line_items: lineItems,
    subtotal,
    vat_percentage: DEFAULT_VAT_PERCENTAGE,
    vat_amount,
    total,
    date: invoiceDate.toISOString().split('T')[0],
    due_date: dueDate.toISOString().split('T')[0],
    currency_code,
    notes,
    reference_number: payMethod === 'transfer' && payRef ? payRef : undefined,
    custom_fields,
    context,
  };
}

/** Zoho adapter: unified → ZohoInvoiceData shape (imported in zohoService). */
export function unifiedToZohoPayload(u: UnifiedBookingInvoice) {
  return {
    customer_name: u.customer_name,
    customer_email: u.customer_email,
    customer_phone: u.customer_phone,
    line_items: u.line_items,
    date: u.date,
    due_date: u.due_date,
    currency_code: u.currency_code,
    notes: u.notes,
    reference_number: u.reference_number,
    custom_fields: u.custom_fields as Record<string, any>,
  };
}

/**
 * Bulk booking group → unified invoice (mirrors Zoho group aggregation).
 */
export async function mapBookingGroupToUnifiedInvoice(bookingGroupId: string): Promise<UnifiedBookingGroupInvoice> {
  const { data: bookings, error: bookingError } = await supabase
    .from('bookings')
    .select(
      `
      id,
      tenant_id,
      customer_name,
      customer_phone,
      customer_email,
      total_price,
      paid_quantity,
      package_covered_quantity,
      visitor_count,
      service_id,
      services (
        id,
        name,
        name_ar,
        description,
        description_ar,
        base_price
      ),
      slots (
        start_time,
        end_time,
        slot_date
      ),
      tenants (
        name,
        name_ar,
        currency_code
      )
    `
    )
    .eq('booking_group_id', bookingGroupId)
    .order('created_at', { ascending: true });

  if (bookingError || !bookings || bookings.length === 0) {
    throw new Error(`No bookings found for group ${bookingGroupId}`);
  }

  const firstBooking = bookings[0];
  const tenantId = firstBooking.tenant_id;
  if (!tenantId) throw new Error(`Booking group ${bookingGroupId} has no tenant_id`);

  const lineItems: UnifiedLineItem[] = [];
  const serviceGroups = new Map<string, typeof bookings>();
  for (const booking of bookings) {
    const sid = booking.service_id || 'unknown';
    if (!serviceGroups.has(sid)) serviceGroups.set(sid, []);
    serviceGroups.get(sid)!.push(booking);
  }

  for (const [, serviceBookings] of serviceGroups.entries()) {
    const fb = serviceBookings[0];
    const gsvc = fb.services as
      | { name?: string; name_ar?: string; description?: string; description_ar?: string; base_price?: unknown }
      | null
      | undefined;
    const serviceName = (gsvc?.name_ar || gsvc?.name || 'Service').trim() || 'Service';
    const serviceDescription = (gsvc?.description_ar || gsvc?.description || '').trim();

    const paidQtyForService = serviceBookings.reduce(
      (sum, b) =>
        sum +
        effectivePaidQuantityForInvoice({
          paid_quantity: b.paid_quantity,
          visitor_count: b.visitor_count,
          package_covered_quantity: b.package_covered_quantity,
        }),
      0
    );
    const packageCoveredQtyForService = serviceBookings.reduce((sum, b) => sum + (b.package_covered_quantity || 0), 0);

    if (paidQtyForService > 0) {
      const totalPriceForService = serviceBookings.reduce((sum, b) => sum + parseFloat(String(b.total_price || 0)), 0);
      const pricePerTicket =
        paidQtyForService > 0 ? Math.round((totalPriceForService / paidQtyForService) * 1000000) / 1000000 : 0;

      const slotInfo = serviceBookings
        .map((b) => {
          const sl = b.slots as { slot_date?: string; start_time?: string; end_time?: string } | null | undefined;
          const sd = sl?.slot_date;
          const st = sl?.start_time;
          const et = sl?.end_time;
          return sd && st && et ? `${sd} ${st}-${et}` : '';
        })
        .filter(Boolean)
        .join(', ');

      let itemDescription = serviceDescription || '';
      if (slotInfo) itemDescription = itemDescription ? `${itemDescription}\n${slotInfo}` : slotInfo;
      if (packageCoveredQtyForService > 0) {
        const coverageNote = ` (${packageCoveredQtyForService} tickets covered by package)`;
        itemDescription = itemDescription ? `${itemDescription}${coverageNote}` : coverageNote.trim();
      }

      lineItems.push({
        name: serviceName,
        description: itemDescription || undefined,
        rate: pricePerTicket,
        quantity: paidQtyForService,
        unit: 'ticket',
      });

      void totalPriceForService;
    }
  }

  const currency_code = normalizeCurrency((firstBooking as any).tenants?.currency_code);
  const groupSubtotal = roundTo2(
    bookings.reduce((sum, booking) => sum + parseFloat(String(booking.total_price || 0)), 0)
  );
  // VAT calculation
  const groupVatAmount = roundTo2(groupSubtotal * (DEFAULT_VAT_PERCENTAGE / 100));
  const groupTotal = roundTo2(groupSubtotal + groupVatAmount);

  return {
    tenant_id: tenantId,
    booking_group_id: bookingGroupId,
    primary_booking_id: firstBooking.id,
    customer_name: firstBooking.customer_name,
    customer_email: firstBooking.customer_email || undefined,
    customer_phone: firstBooking.customer_phone || undefined,
    line_items: lineItems,
    subtotal: groupSubtotal,
    vat_percentage: DEFAULT_VAT_PERCENTAGE,
    vat_amount: groupVatAmount,
    total: groupTotal,
    date: new Date().toISOString().split('T')[0],
    due_date: new Date().toISOString().split('T')[0],
    currency_code,
    notes: `Booking Group: ${bookingGroupId}\nTotal Bookings: ${bookings.length}`,
    booking_count: bookings.length,
  };
}
