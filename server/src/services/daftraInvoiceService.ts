/**
 * Daftra invoicing (https://docs.daftara.dev/).
 * Uses POST /api2/invoices.json and POST /api2/clients.json.
 * Daftra API keys use the `apikey` header (not Authorization: Bearer) — see https://docs.daftara.dev/933385m0
 */
import axios from 'axios';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { supabase } from '../db';
import { sendEmail } from './emailApiService';
import { sendWhatsAppDocument } from './whatsappService';
import {
  mapBookingGroupToUnifiedInvoice,
  mapBookingToUnifiedInvoice,
} from './invoices/unifiedInvoiceMapper';
import { effectivePaidQuantityForInvoice } from './invoices/invoicePaidQuantity';
import type { UnifiedBookingGroupInvoice, UnifiedBookingInvoice } from './invoices/unifiedInvoiceTypes';

export type DaftraTenantSettings = {
  subdomain: string;
  api_token: string;
  store_id: number;
  default_product_id: number;
  country_code?: string;
  fallback_to_zoho?: boolean;
};

function normalizeSubdomain(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/^https?:\/\//, '');
  s = s.replace(/\.daftra\.com.*$/i, '');
  s = s.split('/')[0] || '';
  const parts = s.split('.').filter(Boolean);
  return parts[0] || '';
}

function parseDaftraSettings(raw: unknown): DaftraTenantSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const subdomain = typeof o.subdomain === 'string' ? normalizeSubdomain(o.subdomain) : '';
  const api_token = typeof o.api_token === 'string' ? o.api_token.trim() : '';
  const store_id = typeof o.store_id === 'number' ? o.store_id : parseInt(String(o.store_id || ''), 10);
  const default_product_id =
    typeof o.default_product_id === 'number' ? o.default_product_id : parseInt(String(o.default_product_id || ''), 10);
  if (!subdomain || !api_token || !Number.isFinite(store_id) || !Number.isFinite(default_product_id)) return null;
  return {
    subdomain,
    api_token,
    store_id,
    default_product_id,
    country_code: typeof o.country_code === 'string' ? o.country_code : 'SA',
    fallback_to_zoho: o.fallback_to_zoho === true,
  };
}

export async function loadDaftraSettingsForTenant(tenantId: string): Promise<DaftraTenantSettings | null> {
  const { data, error } = await supabase.from('tenants').select('daftra_settings').eq('id', tenantId).maybeSingle();
  if (error || !data?.daftra_settings) return null;
  return parseDaftraSettings(data.daftra_settings);
}

function apiBase(subdomain: string): string {
  return `https://${subdomain}.daftra.com/api2`;
}

/** Daftra: Settings → API Key must be sent as `apikey` header; Bearer returns 401 for API keys. */
function daftraAuthHeaders(apiToken: string): Record<string, string> {
  return {
    apikey: apiToken,
    Accept: 'application/json',
  };
}

/** Parse numeric store/warehouse ids from GET /api2/stores.json (shape varies by account). */
function parseDaftraStoreIds(payload: unknown): number[] {
  const ids: number[] = [];
  const push = (raw: unknown) => {
    const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
    if (Number.isFinite(n)) ids.push(n);
  };
  const walkRow = (row: unknown) => {
    if (!row || typeof row !== 'object') return;
    const r = row as Record<string, unknown>;
    const wrapped = r.Store ?? r.store;
    if (wrapped && typeof wrapped === 'object') {
      push((wrapped as Record<string, unknown>).id);
    } else {
      push(r.id);
    }
  };
  if (Array.isArray(payload)) {
    for (const row of payload) walkRow(row);
    return [...new Set(ids)];
  }
  if (payload && typeof payload === 'object') {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return parseDaftraStoreIds(data);
  }
  return [];
}

/** Merge corrected `store_id` into tenant JSON so Settings and future loads stay in sync (no repeated warnings). */
async function persistCorrectedDaftraStoreId(tenantId: string, newStoreId: number): Promise<void> {
  const { data, error } = await supabase.from('tenants').select('daftra_settings').eq('id', tenantId).maybeSingle();
  if (error || !data?.daftra_settings || typeof data.daftra_settings !== 'object') return;
  const cur = data.daftra_settings as Record<string, unknown>;
  if (cur.store_id === newStoreId) return;
  const next = { ...cur, store_id: newStoreId };
  const { error: upErr } = await supabase.from('tenants').update({ daftra_settings: next, updated_at: new Date().toISOString() }).eq('id', tenantId);
  if (upErr) {
    console.warn(`[DaftraInvoice] Could not persist corrected store_id: ${upErr.message}`);
  } else {
    console.log(`[DaftraInvoice] Updated tenant Daftra store_id ${cur.store_id} → ${newStoreId} (was not a valid warehouse).`);
  }
}

/**
 * Invoice `store_id` must be a warehouse from /api2/stores.json. Tenants often paste product `site_id`
 * (e.g. 4375361), which Daftra rejects ("no permission for this warehouse").
 */
async function resolveDaftraInvoiceStoreId(
  settings: DaftraTenantSettings,
  tenantId?: string | null
): Promise<number> {
  const configured = settings.store_id;
  const base = apiBase(settings.subdomain);
  try {
    const res = await axios.get(`${base}/stores.json`, {
      headers: daftraAuthHeaders(settings.api_token),
      validateStatus: (s) => s === 200,
      timeout: 15000,
    });
    const allowed = parseDaftraStoreIds(res.data);
    if (allowed.length === 0) return configured;
    if (allowed.includes(configured)) return configured;
    const fallback = allowed.includes(1) ? 1 : allowed[0];
    if (fallback !== configured && tenantId) {
      await persistCorrectedDaftraStoreId(tenantId, fallback);
      settings.store_id = fallback;
    } else if (fallback !== configured) {
      console.warn(
        `[DaftraInvoice] store_id ${configured} is not an allowed warehouse; using ${fallback} (tenant id missing — cannot persist).`
      );
    }
    return fallback;
  } catch {
    return configured;
  }
}

function buildDaftraInvoiceNotes(u: UnifiedBookingInvoice): string {
  const c = u.context;
  const parts = [
    u.notes,
    '',
    '--- Structured invoice data ---',
    `Internal invoice ref: ${c.internal_invoice_ref}`,
    `Booking ID: ${c.booking_id}`,
    c.package_id ? `Package ID: ${c.package_id}` : null,
    c.package_name ? `Package name: ${c.package_name}` : null,
    c.package_remaining_note,
    `Payment: ${c.payment_summary}`,
    `Service date: ${c.slot_date || '—'}`,
    c.slot_time_range ? `Time: ${c.slot_time_range}` : null,
    c.duration_minutes != null ? `Duration (minutes): ${c.duration_minutes}` : null,
    c.employee_name ? `Staff: ${c.employee_name}` : null,
    c.branch_name ? `Branch: ${c.branch_name}` : null,
    c.branch_address ? `Location: ${c.branch_address}` : null,
    c.offer_label ? `Offer / tag: ${c.offer_label}` : null,
    '',
    'QR payload (same structure as ticket PDF):',
    c.qr_data_json,
  ];
  return parts.filter((x) => x != null && x !== '').join('\n');
}

function splitCustomerName(full: string): { first: string; last: string } {
  const t = full.trim();
  if (!t) return { first: '-', last: '-' };
  const sp = t.split(/\s+/);
  if (sp.length === 1) return { first: sp[0], last: '-' };
  return { first: sp[0], last: sp.slice(1).join(' ') };
}

function guestEmail(bookingId: string): string {
  const short = bookingId.replace(/-/g, '').slice(0, 12);
  return `guest.${short}@bookati-invoice.invalid`;
}

async function postDaftraClient(settings: DaftraTenantSettings, body: Record<string, unknown>): Promise<number> {
  const base = apiBase(settings.subdomain);
  const res = await axios.post(`${base}/clients.json`, body, {
    headers: {
      ...daftraAuthHeaders(settings.api_token),
      'Content-Type': 'application/json',
    },
    validateStatus: () => true,
  });
  const id = (res.data as any)?.id;
  if (res.status >= 200 && res.status < 300 && id != null) {
    return Number(id);
  }
  throw new Error(typeof (res.data as any)?.message === 'string' ? (res.data as any).message : JSON.stringify(res.data));
}

async function ensureDaftraClient(
  settings: DaftraTenantSettings,
  u: Pick<UnifiedBookingInvoice, 'customer_name' | 'customer_email' | 'customer_phone' | 'booking_id' | 'currency_code'>
): Promise<number> {
  const primaryEmail = (
    u.customer_email && u.customer_email.includes('@') ? u.customer_email.trim() : guestEmail(u.booking_id)
  ).slice(0, 255);
  const { first, last } = splitCustomerName(u.customer_name);
  const password = `Bk_${crypto.randomBytes(12).toString('hex')}!`;

  const buildBody = (email: string) => ({
    Client: {
      type: 2,
      business_name: u.customer_name.slice(0, 100),
      first_name: first.slice(0, 255),
      last_name: last.slice(0, 255),
      email,
      password: `${password}_${email.length}`,
      phone1: (u.customer_phone || '').slice(0, 50),
      country_code: (settings.country_code || 'SA').slice(0, 3),
      default_currency_code: u.currency_code?.slice(0, 5) || 'SAR',
      notes: `Bookati booking ${u.booking_id}`,
    },
  });

  try {
    return await postDaftraClient(settings, buildBody(primaryEmail));
  } catch (firstErr: any) {
    const alt = `guest.${crypto.randomBytes(6).toString('hex')}@bookati-invoice.invalid`;
    try {
      return await postDaftraClient(settings, buildBody(alt.slice(0, 255)));
    } catch (e: any) {
      if (e?.response?.data) {
        throw new Error(`Daftra client: ${JSON.stringify(e.response.data)}`);
      }
      throw firstErr;
    }
  }
}

async function createDaftraInvoice(
  settings: DaftraTenantSettings,
  clientId: number,
  u: UnifiedBookingInvoice | UnifiedBookingGroupInvoice,
  notes: string,
  poNumber: string,
  tenantId?: string | null
): Promise<number> {
  const storeId = await resolveDaftraInvoiceStoreId(settings, tenantId);
  const base = apiBase(settings.subdomain);
  const items = u.line_items.map((li) => ({
    product_id: settings.default_product_id,
    quantity: li.quantity,
    unit_price: li.rate,
    col_3: (li.name || 'Item').slice(0, 255),
    col_4: (li.description || '').toString().slice(0, 255),
  }));

  /** Daftra parses line items only when `InvoiceItem` is a top-level key next to `Invoice` (nested `Invoice.InvoiceItem` yields "Invoice is empty"). */
  const body = {
    Invoice: {
      client_id: clientId,
      store_id: storeId,
      currency_code: u.currency_code,
      date: u.date,
      draft: 0,
      notes: notes.slice(0, 65000),
      po_number: poNumber.slice(0, 255),
    },
    InvoiceItem: items,
  };

  const res = await axios.post(`${base}/invoices.json`, body, {
    headers: {
      ...daftraAuthHeaders(settings.api_token),
      'Content-Type': 'application/json',
    },
    validateStatus: () => true,
  });

  const id = (res.data as any)?.id;
  if (res.status >= 200 && res.status < 300 && id != null) {
    return Number(id);
  }
  throw new Error(`Daftra invoice failed (${res.status}): ${JSON.stringify(res.data)}`);
}

async function tryDownloadDaftraInvoicePdf(settings: DaftraTenantSettings, invoiceId: number): Promise<Buffer | null> {
  const base = apiBase(settings.subdomain);
  const paths = [`/invoices/${invoiceId}.pdf`, `/invoice_pdf/${invoiceId}.pdf`, `/invoices/view/${invoiceId}.pdf`];
  for (const p of paths) {
    try {
      const res = await axios.get(`${base}${p}`, {
        responseType: 'arraybuffer',
        headers: { apikey: settings.api_token, Accept: 'application/pdf' },
        validateStatus: (s) => s === 200,
        timeout: 20000,
      });
      if (res.data && res.data.byteLength > 100) return Buffer.from(res.data);
    } catch {
      /* try next */
    }
  }
  return null;
}

async function getSmtpFromAddress(tenantId: string): Promise<string> {
  const { data } = await supabase.from('tenants').select('smtp_settings').eq('id', tenantId).maybeSingle();
  const u = (data?.smtp_settings as any)?.smtp_user;
  return typeof u === 'string' && u.includes('@') ? u : 'noreply@bookati.local';
}

async function deliverDaftraInvoice(
  tenantId: string,
  invoiceIdNum: number,
  pdf: Buffer | null,
  qrPng: Buffer,
  customerEmail: string | undefined,
  customerPhone: string | undefined,
  caption: string
): Promise<void> {
  const { data: tenants } = await supabase.from('tenants').select('whatsapp_settings').eq('id', tenantId).single();
  const ws = tenants?.whatsapp_settings as any;
  const whatsappConfig =
    ws && ws.provider
      ? {
          provider: ws.provider,
          apiUrl: ws.api_url,
          apiKey: ws.api_key,
          phoneNumberId: ws.phone_number_id,
          accessToken: ws.access_token,
          accountSid: ws.account_sid,
          authToken: ws.auth_token,
          from: ws.from,
        }
      : undefined;

  if (customerPhone && whatsappConfig) {
    const doc = pdf && pdf.length > 100 ? pdf : qrPng;
    const name = pdf && pdf.length > 100 ? `daftra_invoice_${invoiceIdNum}.pdf` : `booking_qr_${invoiceIdNum}.png`;
    try {
      await sendWhatsAppDocument(customerPhone, doc, name, caption, whatsappConfig);
    } catch (e: any) {
      console.error(`[DaftraInvoice] WhatsApp delivery failed: ${e.message}`);
    }
  }

  if (customerEmail) {
    const from = await getSmtpFromAddress(tenantId);
    const attachments = [];
    if (pdf && pdf.length > 100) {
      attachments.push({ filename: `invoice_${invoiceIdNum}.pdf`, content: pdf, contentType: 'application/pdf' });
    }
    attachments.push({ filename: `booking_qr_${invoiceIdNum}.png`, content: qrPng, contentType: 'image/png' });
    await sendEmail(tenantId, {
      to: customerEmail,
      from,
      subject: `Invoice #${invoiceIdNum} (Daftra)`,
      html: `<p>${caption.replace(/\n/g, '<br/>')}</p>`,
      attachments,
    }).catch((e) => console.error(`[DaftraInvoice] Email failed: ${e.message}`));
  }
}

async function logInvoice(
  tenantId: string,
  bookingId: string | null,
  status: string,
  invoiceId: string | null,
  request: unknown,
  response: unknown,
  errorMessage?: string
): Promise<void> {
  if (!tenantId) return;
  try {
    await supabase.from('zoho_invoice_logs').insert({
      tenant_id: tenantId,
      booking_id: bookingId,
      zoho_invoice_id: invoiceId,
      status,
      error_message: errorMessage || null,
      request_payload: request,
      response_payload: response,
    } as any);
  } catch (e: any) {
    console.warn(`[DaftraInvoice] Log insert skipped: ${e.message}`);
  }
}

export class DaftraInvoiceService {
  async generateReceipt(
    bookingId: string,
    options?: { paymentMethod?: string; transactionReference?: string }
  ): Promise<{ invoiceId: string; success: boolean; error?: string }> {
    try {
      let booking: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
        const { data } = await supabase
          .from('bookings')
          .select(
            'id, tenant_id, zoho_invoice_id, daftra_invoice_id, customer_email, customer_phone, customer_name, payment_status, total_price, paid_quantity, payment_method, transaction_reference'
          )
          .eq('id', bookingId)
          .maybeSingle();
        if (data) {
          booking = data;
          break;
        }
      }
      if (!booking?.tenant_id) {
        return { invoiceId: '', success: false, error: `Booking ${bookingId} not found` };
      }

      const settings = await loadDaftraSettingsForTenant(booking.tenant_id);
      if (!settings) {
        return { invoiceId: '', success: false, error: 'Daftra is not configured. Add subdomain, API token, store ID, and product ID in Settings.' };
      }

      if (booking.daftra_invoice_id) {
        return { invoiceId: String(booking.daftra_invoice_id), success: true };
      }

      const { data: paidRow } = await supabase
        .from('bookings')
        .select('paid_quantity, package_covered_quantity, visitor_count, total_price')
        .eq('id', bookingId)
        .maybeSingle();
      const paidQty = effectivePaidQuantityForInvoice({
        paid_quantity: paidRow?.paid_quantity,
        visitor_count: paidRow?.visitor_count,
        package_covered_quantity: paidRow?.package_covered_quantity,
      });
      const totalPrice = parseFloat(paidRow?.total_price?.toString() || '0');
      if (paidQty <= 0 || totalPrice <= 0) {
        return { invoiceId: '', success: true };
      }

      let unified = await mapBookingToUnifiedInvoice(bookingId);
      const payMethod = options?.paymentMethod ?? booking.payment_method;
      const payRef = (options?.transactionReference ?? booking.transaction_reference)?.toString?.()?.trim();
      if (payMethod === 'transfer' && payRef) {
        const refLine = `\nPayment: Bank transfer. Reference: ${payRef}`;
        if (!unified.notes?.includes(payRef)) unified.notes = (unified.notes || '').trim() + refLine;
        unified.reference_number = payRef;
      }

      const daftraNotes = buildDaftraInvoiceNotes(unified);
      const clientId = await ensureDaftraClient(settings, {
        customer_name: unified.customer_name,
        customer_email: unified.customer_email,
        customer_phone: unified.customer_phone,
        booking_id: unified.booking_id,
        currency_code: unified.currency_code,
      });

      const invoiceNum = await createDaftraInvoice(settings, clientId, unified, daftraNotes, unified.booking_id, booking.tenant_id);
      const invoiceIdStr = String(invoiceNum);
      console.log(`[DaftraInvoice] Created invoice in Daftra id=${invoiceIdStr} booking=${bookingId}`);

      await supabase
        .from('bookings')
        .update({
          daftra_invoice_id: invoiceIdStr,
          daftra_invoice_created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId);

      const qrPng = await QRCode.toBuffer(unified.context.qr_data_json, { type: 'png', width: 320, margin: 1 });
      const pdf = await tryDownloadDaftraInvoicePdf(settings, invoiceNum);
      const caption = `Your invoice (#${invoiceNum}) is ready.\nBooking ID: ${unified.booking_id}\n${unified.context.payment_summary}`;

      const maySend = booking.payment_status === 'paid' || booking.payment_status === 'paid_manual';
      if (maySend) {
        await deliverDaftraInvoice(
          booking.tenant_id,
          invoiceNum,
          pdf,
          qrPng,
          booking.customer_email || unified.customer_email,
          booking.customer_phone || unified.customer_phone,
          caption
        );
      }

      await logInvoice(booking.tenant_id, bookingId, 'success', invoiceIdStr, unified as any, {
        provider: 'daftra',
        daftra_invoice_id: invoiceNum,
      });
      return { invoiceId: invoiceIdStr, success: true };
    } catch (error: any) {
      console.error(`[DaftraInvoice] generateReceipt error:`, error.message);
      let tid = '';
      try {
        const { data } = await supabase.from('bookings').select('tenant_id').eq('id', bookingId).maybeSingle();
        tid = data?.tenant_id || '';
      } catch {
        /* ignore */
      }
      await logInvoice(tid, bookingId, 'failed', null, { bookingId }, { error: error.message }, error.message);
      return { invoiceId: '', success: false, error: error.message || 'Daftra invoice failed' };
    }
  }

  async generateReceiptForBookingGroup(bookingGroupId: string): Promise<{ invoiceId: string; success: boolean; error?: string }> {
    try {
      const { data: rowList } = await supabase
        .from('bookings')
        .select('id, tenant_id, daftra_invoice_id')
        .eq('booking_group_id', bookingGroupId)
        .limit(1);
      const tenantId = rowList?.[0]?.tenant_id;
      if (!tenantId) return { invoiceId: '', success: false, error: 'Group not found' };

      const settings = await loadDaftraSettingsForTenant(tenantId);
      if (!settings) {
        return { invoiceId: '', success: false, error: 'Daftra is not configured for this tenant.' };
      }

      const { data: all } = await supabase.from('bookings').select('daftra_invoice_id').eq('booking_group_id', bookingGroupId);
      const existing = all?.find((b) => b.daftra_invoice_id);
      if (existing?.daftra_invoice_id) {
        return { invoiceId: String(existing.daftra_invoice_id), success: true };
      }

      const unified = await mapBookingGroupToUnifiedInvoice(bookingGroupId);
      const paidCheck = await supabase
        .from('bookings')
        .select('paid_quantity, package_covered_quantity, visitor_count, total_price')
        .eq('booking_group_id', bookingGroupId);
      const totalPaid = (paidCheck.data || []).reduce(
        (s, b) =>
          s +
          effectivePaidQuantityForInvoice({
            paid_quantity: b.paid_quantity,
            visitor_count: b.visitor_count,
            package_covered_quantity: b.package_covered_quantity,
          }),
        0
      );
      const totalAmt = (paidCheck.data || []).reduce((s, b) => s + parseFloat(String(b.total_price || 0)), 0);
      if (totalPaid <= 0 || totalAmt <= 0) {
        return { invoiceId: '', success: true };
      }

      const notes =
        `${unified.notes}\n\n---\nBooking group ${unified.booking_group_id}\nPrimary booking: ${unified.primary_booking_id}`;
      const clientId = await ensureDaftraClient(settings, {
        customer_name: unified.customer_name,
        customer_email: unified.customer_email,
        customer_phone: unified.customer_phone,
        booking_id: unified.primary_booking_id,
        currency_code: unified.currency_code,
      });
      const invoiceNum = await createDaftraInvoice(settings, clientId, unified, notes, unified.booking_group_id, tenantId);
      const invoiceIdStr = String(invoiceNum);

      await supabase
        .from('bookings')
        .update({
          daftra_invoice_id: invoiceIdStr,
          daftra_invoice_created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('booking_group_id', bookingGroupId);

      const { data: first } = await supabase
        .from('bookings')
        .select('customer_email, customer_phone, payment_status')
        .eq('id', unified.primary_booking_id)
        .maybeSingle();

      const uSingle = await mapBookingToUnifiedInvoice(unified.primary_booking_id).catch(() => null);
      const qrJson = uSingle?.context.qr_data_json || JSON.stringify({ booking_id: unified.primary_booking_id, type: 'booking_ticket' });
      const qrPng = await QRCode.toBuffer(qrJson, { type: 'png', width: 320, margin: 1 });
      const pdf = await tryDownloadDaftraInvoicePdf(settings, invoiceNum);

      if (first?.payment_status === 'paid' || first?.payment_status === 'paid_manual') {
        await deliverDaftraInvoice(
          tenantId,
          invoiceNum,
          pdf,
          qrPng,
          first.customer_email || unified.customer_email,
          first.customer_phone || unified.customer_phone,
          `Your group invoice (#${invoiceNum}) is ready.\nGroup: ${bookingGroupId}`
        );
      }

      return { invoiceId: invoiceIdStr, success: true };
    } catch (error: any) {
      console.error(`[DaftraInvoice] group error:`, error.message);
      return { invoiceId: '', success: false, error: error.message };
    }
  }
}

export const daftraInvoiceService = new DaftraInvoiceService();

/** Download invoice PDF from Daftra (for API route / staff UI). */
export async function downloadDaftraInvoicePdfForTenant(tenantId: string, invoiceId: string | number): Promise<Buffer> {
  const settings = await loadDaftraSettingsForTenant(tenantId);
  if (!settings) {
    throw new Error('Daftra is not configured for this tenant');
  }
  const num = typeof invoiceId === 'string' ? parseInt(invoiceId, 10) : invoiceId;
  if (!Number.isFinite(num)) {
    throw new Error('Invalid Daftra invoice id');
  }
  const pdf = await tryDownloadDaftraInvoicePdf(settings, num);
  if (!pdf || pdf.length < 100) {
    throw new Error('Daftra did not return a PDF for this invoice (check Daftra invoice id and API permissions)');
  }
  return pdf;
}
