/**
 * Daftra invoicing (https://docs.daftara.dev/).
 * Uses POST /api2/invoices.json and POST /api2/clients.json.
 * Daftra API keys use the `apikey` header (not Authorization: Bearer) — see https://docs.daftara.dev/933385m0
 */
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
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
  invoice_layout_id?: number;
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
  const invoice_layout_id =
    typeof o.invoice_layout_id === 'number' ? o.invoice_layout_id : parseInt(String(o.invoice_layout_id || ''), 10);
  if (!subdomain || !api_token || !Number.isFinite(store_id) || !Number.isFinite(default_product_id)) return null;
  return {
    subdomain,
    api_token,
    store_id,
    default_product_id,
    ...(Number.isFinite(invoice_layout_id) ? { invoice_layout_id } : {}),
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

const DAFTRA_API_DEBUG = process.env.DAFTRA_DEBUG_API === '1';

function redactDaftraHeadersForLog(h: Record<string, string>): Record<string, string> {
  const o = { ...h };
  if (o.apikey) o.apikey = 'YOUR_API_KEY';
  return o;
}

function logDaftraApiDebug(kind: 'request' | 'response', payload: Record<string, unknown>): void {
  if (!DAFTRA_API_DEBUG) return;
  console.log(`[Daftra API DEBUG] ${kind}:`, JSON.stringify(payload, null, 2));
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
    const storeUrl = `${base}/stores.json`;
    const storeHeaders = daftraAuthHeaders(settings.api_token);
    logDaftraApiDebug('request', { method: 'GET', url: storeUrl, headers: redactDaftraHeadersForLog(storeHeaders) });
    const res = await axios.get(storeUrl, {
      headers: storeHeaders,
      validateStatus: (s) => s === 200,
      timeout: 15000,
    });
    logDaftraApiDebug('response', { url: storeUrl, status: res.status, body: res.data });
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
  // Keep Daftra note compact and customer-facing so printed invoices stay clean.
  const parts = [
    `Booking ID: ${c.booking_id}`,
    `Payment: ${c.payment_summary}`,
    c.slot_date ? `Date: ${c.slot_date}` : null,
    c.slot_time_range ? `Time: ${c.slot_time_range}` : null,
    c.employee_name ? `Staff: ${c.employee_name}` : null,
    c.branch_name ? `Branch: ${c.branch_name}` : null,
    c.offer_label ? `Offer: ${c.offer_label}` : null,
  ];
  return parts.filter((x) => x != null && x !== '').join('\n');
}

function formatInvoiceDateLabel(raw?: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBookingDetailsHtml(u: UnifiedBookingInvoice): string {
  const c = u.context;
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Booking ID', value: c.booking_id || '—' },
    { label: 'Payment', value: c.payment_summary || '—' },
    { label: 'Date', value: formatInvoiceDateLabel(c.slot_date || null) },
    { label: 'Time', value: c.slot_time_range || '—' },
    { label: 'Staff', value: c.employee_name || '—' },
    { label: 'Branch', value: c.branch_name || '—' },
  ];
  const tr = rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 10px 4px 0;font-weight:600;white-space:nowrap;color:#111827">${escapeHtml(r.label)}:</td><td style="padding:4px 0;color:#111827">${escapeHtml(r.value)}</td></tr>`
    )
    .join('');
  return `<div style="font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#111827"><div style="font-weight:700;font-size:13px;margin-bottom:6px">Booking Details</div><table style="border-collapse:collapse">${tr}</table></div>`;
}

async function buildDaftraHtmlNotesWithQr(
  notes: string,
  qrDataJson?: string | null,
  detailsHtml?: string
): Promise<string | undefined> {
  const textPart = escapeHtml((notes || '').trim()).replace(/\r?\n/g, '<br/>');
  const base = detailsHtml || textPart;
  if (!qrDataJson) return textPart || undefined;
  try {
    const qrPng = await QRCode.toBuffer(qrDataJson, { type: 'png', width: 260, margin: 1 });
    const qrBase64 = qrPng.toString('base64');
    const withQr = `${base}<br/><br/><div style="text-align:center"><img alt="QR" style="width:140px;height:140px" src="data:image/png;base64,${qrBase64}" /></div>`;
    // Keep payload safe for Daftra API limits while preserving valid base64 image.
    if (withQr.length > 64000) return base || undefined;
    return withQr;
  } catch {
    return base || undefined;
  }
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
  const url = `${base}/clients.json`;
  const headers = {
    ...daftraAuthHeaders(settings.api_token),
    'Content-Type': 'application/json',
  };
  logDaftraApiDebug('request', { method: 'POST', url, headers: redactDaftraHeadersForLog(headers), body });
  const res = await axios.post(url, body, {
    headers,
    validateStatus: () => true,
  });
  logDaftraApiDebug('response', { url, status: res.status, body: res.data });
  const id = (res.data as any)?.id;
  if (res.status >= 200 && res.status < 300 && id != null) {
    return Number(id);
  }
  throw new Error(typeof (res.data as any)?.message === 'string' ? (res.data as any).message : JSON.stringify(res.data));
}

async function ensureDaftraClient(
  settings: DaftraTenantSettings,
  u: Pick<UnifiedBookingInvoice, 'customer_name' | 'customer_email' | 'customer_phone' | 'booking_id' | 'currency_code'> & {
    address_line1?: string | null;
    city?: string | null;
    state?: string | null;
    postcode?: string | null;
    business_info_1?: string | null;
    business_info_2?: string | null;
  }
): Promise<number> {
  const primaryEmail = (
    u.customer_email && u.customer_email.includes('@') ? u.customer_email.trim() : guestEmail(u.booking_id)
  ).slice(0, 255);
  const { first, last } = splitCustomerName(u.customer_name);
  const password = `Bk_${crypto.randomBytes(12).toString('hex')}!`;

  const buildBody = (email: string) => ({
    Client: {
      type: 2,
      business_name: (u.customer_name || '-').slice(0, 100),
      first_name: first.slice(0, 255),
      last_name: last.slice(0, 255),
      email,
      password: `${password}_${email.length}`,
      phone1: (u.customer_phone || '-').slice(0, 50),
      country_code: (settings.country_code || 'SA').slice(0, 3),
      default_currency_code: u.currency_code?.slice(0, 5) || 'SAR',
      notes: `Bookati booking ${u.booking_id}`,
      // Fill common printable client fields used by Daftra templates to avoid null placeholders.
      address1: (u.address_line1 || '').toString().slice(0, 255),
      city: (u.city || '').toString().slice(0, 120),
      state: (u.state || '').toString().slice(0, 120),
      postal_code: (u.postcode || '').toString().slice(0, 40),
      business_info_1: (u.business_info_1 || '').toString().slice(0, 255),
      business_info_2: (u.business_info_2 || '').toString().slice(0, 255),
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
  htmlNotes: string | undefined,
  poNumber: string,
  tenantId?: string | null
): Promise<number> {
  const storeId = await resolveDaftraInvoiceStoreId(settings, tenantId);
  const base = apiBase(settings.subdomain);
  let validProductId: number | null = null;
  if (Number.isFinite(settings.default_product_id) && settings.default_product_id > 0) {
    try {
      const productUrl = `${base}/products/${settings.default_product_id}.json`;
      const productHeaders = daftraAuthHeaders(settings.api_token);
      logDaftraApiDebug('request', { method: 'GET', url: productUrl, headers: redactDaftraHeadersForLog(productHeaders) });
      const productProbe = await axios.get(productUrl, {
        headers: productHeaders,
        validateStatus: () => true,
        timeout: 10000,
      });
      logDaftraApiDebug('response', { url: productUrl, status: productProbe.status, body: productProbe.data });
      if (productProbe.status === 200) {
        validProductId = settings.default_product_id;
      } else {
        console.warn(
          `[DaftraInvoice] default_product_id=${settings.default_product_id} is invalid for this tenant (status ${productProbe.status}); sending line items without product_id`
        );
      }
    } catch {
      console.warn(
        `[DaftraInvoice] Could not verify default_product_id=${settings.default_product_id}; sending line items without product_id`
      );
    }
  }
  const items = u.line_items
    .map((li) => {
      const qty = Number(li.quantity ?? 0);
      const unitPrice = Number(li.rate ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(unitPrice) || qty <= 0 || unitPrice <= 0) {
        return null;
      }
      return {
        ...(validProductId ? { product_id: validProductId } : {}),
        // Daftra standard item table fields.
        item: (li.name || 'Item').slice(0, 255),
        description: (li.description || '').toString().slice(0, 255),
        quantity: qty,
        unit_price: unitPrice,
        // Keep custom layout columns for templates that already bind to col_3/col_4.
        col_3: (li.name || 'Item').slice(0, 255),
        col_4: (li.description || '').toString().slice(0, 255),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const computedItemsTotal = items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
  if (items.length === 0 || !Number.isFinite(computedItemsTotal) || computedItemsTotal <= 0) {
    throw new Error('Cannot create Daftra invoice: no billable line items');
  }

  /** Daftra parses line items only when `InvoiceItem` is a top-level key next to `Invoice` (nested `Invoice.InvoiceItem` yields "Invoice is empty"). */
  const body = {
    Invoice: {
      client_id: clientId,
      store_id: storeId,
      // Do not force invoice layout here; let Daftra apply the tenant/account default template.
      currency_code: u.currency_code,
      date: u.date,
      draft: 0,
      notes: notes.slice(0, 65000),
      ...(htmlNotes ? { html_notes: htmlNotes } : {}),
      po_number: poNumber.slice(0, 255),
      // Keep template-friendly client fields mirrored on invoice when available.
      client_business_name: (u.customer_name || '-').slice(0, 255),
      client_first_name: splitCustomerName(u.customer_name).first.slice(0, 255),
      client_last_name: splitCustomerName(u.customer_name).last.slice(0, 255),
      client_email: (u.customer_email || '').slice(0, 255),
      client_phone: (u.customer_phone || '').slice(0, 50),
      client_address1: ((u as any)?.context?.branch_address || '').toString().slice(0, 255),
      client_city: '',
      client_state: '',
      client_postal_code: '',
      client_country_code: (settings.country_code || 'SA').slice(0, 3),
      // Compatibility: some Daftra tenants parse items from nested Invoice.InvoiceItem.
      // We still send top-level InvoiceItem below (documented shape) for other tenants.
      InvoiceItem: items,
    },
    InvoiceItem: items,
  };

  const invoiceUrl = `${base}/invoices.json`;
  const invoiceHeaders = {
    ...daftraAuthHeaders(settings.api_token),
    'Content-Type': 'application/json',
  };
  logDaftraApiDebug('request', { method: 'POST', url: invoiceUrl, headers: redactDaftraHeadersForLog(invoiceHeaders), body });
  const res = await axios.post(invoiceUrl, body, {
    headers: invoiceHeaders,
    validateStatus: () => true,
  });
  logDaftraApiDebug('response', { url: invoiceUrl, status: res.status, body: res.data });

  const id = (res.data as any)?.id;
  if (res.status >= 200 && res.status < 300 && id != null) {
    return Number(id);
  }
  throw new Error(`Daftra invoice failed (${res.status}): ${JSON.stringify(res.data)}`);
}

async function hasBillableContentInDaftraInvoice(
  settings: DaftraTenantSettings,
  invoiceId: number
): Promise<boolean> {
  try {
    const res = await axios.get(`${apiBase(settings.subdomain)}/invoices/${invoiceId}.json`, {
      headers: daftraAuthHeaders(settings.api_token),
      validateStatus: (s) => s === 200,
      timeout: 20000,
    });
    const { invoice, items } = normalizeDaftraInvoiceRecord(res.data);
    const total = Number(invoice?.summary_total ?? 0);
    if (Number.isFinite(total) && total > 0) return true;
    if (!Array.isArray(items) || items.length === 0) return false;
    const computed = items.reduce((sum, line) => {
      const qty = Number((line as any)?.quantity ?? (line as any)?.qty ?? 0);
      const unit = Number((line as any)?.unit_price ?? (line as any)?.price ?? 0);
      const sub = Number((line as any)?.subtotal ?? (line as any)?.total ?? qty * unit);
      const value = Number.isFinite(sub) ? sub : Number.isFinite(qty * unit) ? qty * unit : 0;
      return sum + value;
    }, 0);
    return Number.isFinite(computed) && computed > 0;
  } catch {
    // If we cannot verify current invoice content, keep existing id to avoid duplicates.
    return true;
  }
}

function mapBookingPaymentMethodToDaftra(method?: string | null): string {
  const m = (method || '').toLowerCase().trim();
  if (!m) return 'cash';
  if (m === 'onsite' || m === 'cash' || m === 'paid_onsite') return 'cash';
  if (m === 'bank_transfer' || m === 'transfer' || m === 'bank') return 'bank transfer';
  return m;
}

async function markDaftraInvoicePaid(params: {
  settings: DaftraTenantSettings;
  invoiceId: number;
  amount: number;
  paymentMethod?: string | null;
  transactionReference?: string | null;
  paidAtIso?: string | null;
}): Promise<void> {
  const { settings, invoiceId, amount, paymentMethod, transactionReference, paidAtIso } = params;
  const roundedAmount = Math.round(Number(amount || 0) * 100) / 100;
  if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) return;
  const base = apiBase(settings.subdomain);
  const paidAt = new Date(paidAtIso || Date.now());
  const fmtDate = `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, '0')}-${String(paidAt.getDate()).padStart(2, '0')} ${String(
    paidAt.getHours()
  ).padStart(2, '0')}:${String(paidAt.getMinutes()).padStart(2, '0')}:${String(paidAt.getSeconds()).padStart(2, '0')}`;

  // Fetch invoice first so we can avoid overpaying or duplicate payment records.
  let payAmount = roundedAmount;
  try {
    const invMetaUrl = `${base}/invoices/${invoiceId}.json`;
    const invMetaHeaders = { ...daftraAuthHeaders(settings.api_token) };
    logDaftraApiDebug('request', { method: 'GET', url: invMetaUrl, headers: redactDaftraHeadersForLog(invMetaHeaders) });
    const invRes = await axios.get(invMetaUrl, {
      headers: invMetaHeaders,
      validateStatus: () => true,
      timeout: 20000,
    });
    logDaftraApiDebug('response', { url: invMetaUrl, status: invRes.status, body: invRes.data });
    if (invRes.status >= 200 && invRes.status < 300) {
      const inv = (invRes.data as any)?.data?.Invoice || (invRes.data as any)?.data || invRes.data || {};
      const unpaid = Number(inv?.summary_unpaid ?? inv?.summary_total ?? 0);
      if (Number.isFinite(unpaid)) {
        if (unpaid <= 0) {
          console.log(`[DaftraInvoice] Invoice ${invoiceId} is already fully paid in Daftra; skipping payment creation`);
          return;
        }
        payAmount = Math.min(roundedAmount, unpaid);
      }
    }
  } catch {
    // Non-blocking; continue with requested amount.
  }

  if (!Number.isFinite(payAmount) || payAmount <= 0) return;

  const body = {
    InvoicePayment: {
      invoice_id: invoiceId,
      payment_method: mapBookingPaymentMethodToDaftra(paymentMethod),
      amount: payAmount,
      transaction_id: (transactionReference || '').toString().slice(0, 100) || undefined,
      date: fmtDate,
      status: 1,
      staff_id: 0,
    },
  };

  const payUrl = `${base}/invoice_payments.json`;
  const payHeaders = {
    ...daftraAuthHeaders(settings.api_token),
    'Content-Type': 'application/json',
  };
  logDaftraApiDebug('request', { method: 'POST', url: payUrl, headers: redactDaftraHeadersForLog(payHeaders), body });
  const res = await axios.post(payUrl, body, {
    headers: payHeaders,
    validateStatus: () => true,
    timeout: 30000,
  });
  logDaftraApiDebug('response', { url: payUrl, status: res.status, body: res.data });

  const ok =
    (res.status >= 200 && res.status < 300) &&
    (
      (typeof (res.data as any)?.result === 'string' && ['successful', 'success'].includes(String((res.data as any).result).toLowerCase())) ||
      typeof (res.data as any)?.code === 'number' ||
      Object.keys((res.data || {}) as Record<string, unknown>).length > 0
    );

  if (!ok) {
    throw new Error(`Daftra invoice payment failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
}

/** Flatten Daftra GET invoice JSON (shape varies: nested Invoice or flat `data`). */
function normalizeDaftraInvoiceRecord(apiBody: any): {
  invoice: Record<string, any>;
  items: any[];
  client: Record<string, any> | null;
  pdfUrl: string | null;
} {
  const data = apiBody?.data ?? apiBody;
  const invoice =
    data?.Invoice && typeof data.Invoice === 'object' && !Array.isArray(data.Invoice)
      ? data.Invoice
      : data && typeof data === 'object'
        ? data
        : {};

  const extractItems = (raw: any): any[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'object') return [];
    if (Array.isArray((raw as any).data)) return (raw as any).data;
    if (Array.isArray((raw as any).items)) return (raw as any).items;
    const vals = Object.values(raw);
    if (vals.length > 0 && vals.every((v) => v && typeof v === 'object')) return vals as any[];
    return [raw];
  };

  const itemCandidates = [
    invoice?.InvoiceItem,
    (invoice as any)?.invoice_items,
    (invoice as any)?.items,
    data?.InvoiceItem,
    data?.invoice_items,
    data?.items,
    data?.Invoice?.InvoiceItem,
    data?.Invoice?.invoice_items,
    data?.Invoice?.items,
    apiBody?.InvoiceItem,
    apiBody?.invoice_items,
    apiBody?.items,
  ];

  let items: any[] = [];
  for (const candidate of itemCandidates) {
    const extracted = extractItems(candidate);
    if (extracted.length > 0) {
      items = extracted;
      break;
    }
  }
  const client = (invoice.Client ?? data?.Client ?? null) as Record<string, any> | null;
  const pdfUrl =
    (typeof invoice.invoice_pdf_url === 'string' && invoice.invoice_pdf_url) ||
    (typeof data?.invoice_pdf_url === 'string' && data.invoice_pdf_url) ||
    null;
  return { invoice, items, client, pdfUrl };
}

/**
 * Daftra's `invoice_pdf_url` is a portal link that returns the login page for server-side requests
 * (session cookie required). Build a usable PDF from the same invoice JSON the API already returns.
 */
async function buildDaftraInvoicePdfFromApiBody(
  subdomain: string,
  apiBody: any,
  invoiceId: number
): Promise<Buffer> {
  const { invoice, items, client } = normalizeDaftraInvoiceRecord(apiBody);
  const page = { width: 313, height: 808 };
  const doc = new PDFDocument({ margin: 0, size: [page.width, page.height] });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const bufPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pickFont = (): string | null => {
    const candidates = [
      'C:\\Windows\\Fonts\\arial.ttf',
      'C:\\Windows\\Fonts\\tahoma.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* ignore */
      }
    }
    return null;
  };
  const fontPath = pickFont();
  if (fontPath) {
    doc.font(fontPath);
  }

  const fmt = (v: unknown) => {
    if (v == null || v === '') return '—';
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };
  const fmtCurrency = (v: unknown) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
    if (!Number.isFinite(n)) return '0.00';
    if (Math.abs(n) < 0.000001) return '0.00';
    if (Math.abs(n % 1) < 0.000001) return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const toStr = (v: unknown): string => (v == null ? '' : String(v).trim());
  const toNum = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
  };
  const companyRegister =
    toStr(invoice?.company_register) ||
    toStr(invoice?.company_registration_no) ||
    toStr(invoice?.company_vat_no) ||
    toStr(client?.business_info_1) ||
    toStr(subdomain);
  const companyAddress = [toStr(invoice?.company_address1), toStr(invoice?.company_address2), toStr(invoice?.company_city)]
    .filter(Boolean)
    .join(' ');
  const customerName =
    toStr(client?.business_name) ||
    toStr(client?.name) ||
    [toStr(invoice?.client_first_name), toStr(invoice?.client_last_name)].filter(Boolean).join(' ') ||
    toStr(invoice?.client_business_name);
  const customerNameAlt = toStr(client?.name_ar) || customerName;

  const tableLeft = 22;
  const totalWidth = 268;
  const contentWidth = page.width - tableLeft * 2;

  const setBaseFont = (size: number) => {
    doc.font(fontPath || 'Helvetica');
    doc.fontSize(size);
  };
  const setBold = (size: number) => {
    doc.font(fontPath ? fontPath : 'Helvetica-Bold');
    doc.fontSize(size);
  };
  const setBoldItalic = (size: number) => {
    doc.font('Helvetica-BoldOblique');
    doc.fontSize(size);
  };
  const setItalic = (size: number) => {
    doc.font('Helvetica-Oblique');
    doc.fontSize(size);
  };

  // Header block: fixed coordinates for visual parity with target layout.
  setBold(40 / 2.0);
  doc.text('Invoice', 0, 6, { align: 'center', width: page.width });
  setBaseFont(16);
  doc.text(toStr(client?.business_info_1) || toStr(subdomain), 0, 40, { align: 'center', width: page.width });
  setBaseFont(11);
  doc.text(`Company Register: ${companyRegister || '—'}`, 0, 64, { align: 'center', width: page.width });
  if (companyAddress) {
    setBaseFont(10);
    doc.text(companyAddress, 30, 80, { align: 'center', width: page.width - 60, lineGap: 1 });
  }
  if (customerName) {
    setBaseFont(12);
    doc.text(customerName, 28, 155, { width: 130 });
    if (customerNameAlt) {
      doc.text(customerNameAlt, 28, 172, { width: 130 });
    }
  }

  setBold(31 / 2.4);
  doc.text('Invoice No', 28, 220);
  setBaseFont(14);
  doc.text(String(invoice?.no ?? invoiceId), 116, 220);
  setBold(31 / 2.4);
  doc.text('Invoice Date', 28, 240);
  setBaseFont(14);
  doc.text(String(invoice?.date ?? '—'), 116, 240);

  const tableTop = 272;
  const col = {
    item: 72,
    desc: 84,
    qty: 28,
    price: 36,
    subtotal: 48,
  };
  let y = tableTop;
  const headerRowH = 22;
  doc.rect(tableLeft, y, totalWidth, headerRowH).lineWidth(1).stroke('#000');
  let x = tableLeft;
  for (const w of [col.item, col.desc, col.qty, col.price]) {
    x += w;
    doc.moveTo(x, y).lineTo(x, y + headerRowH).stroke('#000');
  }
  setBaseFont(10);
  doc.fillColor('#000');
  doc.text('Item name', tableLeft + 4, y + 6, { width: col.item - 8 });
  doc.text('Description', tableLeft + col.item + 4, y + 6, { width: col.desc - 8 });
  doc.text('Qty', tableLeft + col.item + col.desc + 4, y + 6, { width: col.qty - 8, align: 'center' });
  doc.text('Price', tableLeft + col.item + col.desc + col.qty + 4, y + 6, { width: col.price - 8, align: 'center' });
  doc.text('Subtotal', tableLeft + col.item + col.desc + col.qty + col.price + 2, y + 6, { width: col.subtotal - 4, align: 'center' });
  y += headerRowH;

  const lines = items.length ? items : [{ item: 'Item', description: '', quantity: 1, unit_price: 0, subtotal: 0 }];
  const derivedItemsTotal = items.reduce((sum, line) => {
    const qty = toNum((line as any).quantity ?? (line as any).qty ?? 0);
    const unit = toNum((line as any).unit_price ?? (line as any).price ?? 0);
    const sub = toNum((line as any).subtotal ?? (line as any).total ?? qty * unit);
    return sum + sub;
  }, 0);
  const summarySubtotal = toNum(invoice?.summary_subtotal ?? invoice?.summary_total);
  const summaryTotal = toNum(invoice?.summary_total);
  const summaryPaid = toNum(invoice?.summary_paid ?? 0);
  const summaryUnpaid = toNum(invoice?.summary_unpaid ?? invoice?.summary_total ?? 0);
  for (const line of lines) {
    const qty = Number(line.quantity ?? line.qty ?? 1);
    const unit = Number(line.unit_price ?? line.price ?? 0);
    const sub = Number(line.subtotal ?? line.total ?? qty * unit);
    const rowH = 24;
    doc.rect(tableLeft, y, totalWidth, rowH).lineWidth(0.8).stroke('#000');
    let vx = tableLeft;
    for (const w of [col.item, col.desc, col.qty, col.price]) {
      vx += w;
      doc.moveTo(vx, y).lineTo(vx, y + rowH).stroke('#000');
    }
    setBaseFont(10.5);
    doc.text(String(line.item || line.name || line.product_name || 'Item'), tableLeft + 4, y + 6, { width: col.item - 8 });
    doc.text(String(line.description || ''), tableLeft + col.item + 4, y + 6, { width: col.desc - 8 });
    setBaseFont(10);
    doc.text(String(qty), tableLeft + col.item + col.desc + 4, y + 6, { width: col.qty - 8, align: 'center' });
    doc.text(fmt(unit), tableLeft + col.item + col.desc + col.qty + 4, y + 6, { width: col.price - 8, align: 'center' });
    doc.text(fmt(sub), tableLeft + col.item + col.desc + col.qty + col.price + 2, y + 6, { width: col.subtotal - 4, align: 'center' });
    y += rowH;
  }

  const summaryRows = [
    ['Items Total', fmtCurrency(summarySubtotal > 0 ? summarySubtotal : derivedItemsTotal)],
    ['Total', fmtCurrency(summaryTotal > 0 ? summaryTotal : derivedItemsTotal)],
    ['Paid', fmtCurrency(summaryPaid)],
    ['Balance Due', fmtCurrency(summaryUnpaid > 0 ? summaryUnpaid : Math.max(0, derivedItemsTotal - summaryPaid))],
  ];
  for (const [label, value] of summaryRows) {
    const rowH = 30;
    if (label === 'Total') {
      doc.save();
      doc.rect(tableLeft, y, totalWidth, rowH).fill('#ececec');
      doc.restore();
    }
    doc.rect(tableLeft, y, totalWidth, rowH).lineWidth(1).stroke('#000');
    setBold(12);
    doc.text(label, tableLeft + 8, y + 8, { width: 150 });
    setBaseFont(12);
    doc.text(`﷼ ${value}`, tableLeft + 166, y + 8, { width: 96, align: 'right' });
    y += rowH;
  }

  y += 20;
  const cust =
    client?.business_name ||
    client?.name ||
    [invoice?.client_first_name, invoice?.client_last_name].filter(Boolean).join(' ').trim() ||
    invoice?.client_business_name ||
    '—';
  const notesText = String(invoice?.notes || '').trim();
  const lineValue = (label: string): string => {
    const m = notesText.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
    return m?.[1]?.trim() || '—';
  };
  const detailRows: Array<[string, string]> = [
    ['Booking ID', lineValue('Booking ID')],
    ['Payment', lineValue('Payment')],
    ['Date', lineValue('Date')],
    ['Time', lineValue('Time')],
    ['Staff', lineValue('Staff')],
    ['Branch', lineValue('Branch')],
  ];
  setBoldItalic(11.5);
  doc.text('Booking Details', tableLeft + 6, y);
  let detailsY = y + 24;
  const compactValue = (v: string) => (v.length > 34 ? `${v.slice(0, 34)}...` : v);
  for (const [label, value] of detailRows) {
    setBoldItalic(11);
    doc.text(`${label}:`, tableLeft + 6, detailsY, { width: 72 });
    setItalic(11);
    doc.text(compactValue(value), tableLeft + 84, detailsY, { width: totalWidth - 90, lineBreak: false });
    detailsY += 21;
  }

  const bookingIdMatch = notesText.match(/Booking ID:\s*([^\n]+)/i);
  const qrPayload = bookingIdMatch
    ? JSON.stringify({ booking_id: bookingIdMatch[1].trim(), invoice_id: String(invoice?.no ?? invoiceId), type: 'booking_invoice' })
    : JSON.stringify({ invoice_id: String(invoice?.no ?? invoiceId), client: cust || '—', amount: invoice?.summary_total ?? 0 });
  try {
    const qr = await QRCode.toBuffer(qrPayload, { type: 'png', width: 220, margin: 1 });
    const qrSize = 128;
    const bottomPadding = 8;
    let qrY = detailsY + 6;
    let qrX = (page.width - qrSize) / 2;
    const maxQrY = page.height - bottomPadding - qrSize;
    if (qrY > maxQrY) qrY = maxQrY;

    doc.image(qr, qrX, qrY, { fit: [qrSize, qrSize], align: 'center' });
  } catch {
    /* keep PDF generation resilient */
  }
  doc.end();
  return bufPromise;
}

async function tryDownloadDaftraInvoicePdf(
  settings: DaftraTenantSettings,
  invoiceId: number,
  tenantId: string | null,
  options?: { allowGeneratedFallback?: boolean; generatedOnly?: boolean }
): Promise<Buffer | null> {
  const base = apiBase(settings.subdomain);
  const headers = { ...daftraAuthHeaders(settings.api_token) };
  const allowGeneratedFallback = options?.allowGeneratedFallback !== false;
  const generatedOnly = options?.generatedOnly === true;

  let meta: any;
  try {
    const res = await axios.get(`${base}/invoices/${invoiceId}.json`, {
      headers,
      validateStatus: (s) => s === 200,
      timeout: 20000,
    });
    meta = res.data;
  } catch {
    return null;
  }

  if (!meta) return null;

  if (generatedOnly) {
    try {
      return await buildDaftraInvoicePdfFromApiBody(settings.subdomain, meta, invoiceId);
    } catch (e: any) {
      console.warn('[DaftraInvoice] Could not build PDF from invoice JSON:', e?.message);
      return null;
    }
  }

  const { pdfUrl } = normalizeDaftraInvoiceRecord(meta);
  if (pdfUrl) {
    try {
      const pdfRes = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        headers: { apikey: settings.api_token, Accept: 'application/pdf,*/*' },
        validateStatus: (s) => s === 200,
        timeout: 15000,
        maxRedirects: 5,
      });
      const buf = pdfRes.data && Buffer.from(pdfRes.data);
      if (buf && buf.length > 100 && buf.subarray(0, 4).toString() === '%PDF') {
        return buf;
      }
    } catch {
      /* portal URL often returns HTML login — fall back */
    }
  }

  // Try direct API PDF endpoints for accounts that expose raw PDF via API key.
  for (const url of [`${base}/invoices/${invoiceId}.pdf`, `${base}/invoices/${invoiceId}?format=pdf`]) {
    try {
      const pdfRes = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { ...headers, Accept: 'application/pdf,*/*' },
        validateStatus: (s) => s === 200,
        timeout: 20000,
        maxRedirects: 5,
      });
      const buf = pdfRes.data && Buffer.from(pdfRes.data);
      if (buf && buf.length > 100 && buf.subarray(0, 4).toString() === '%PDF') {
        return buf;
      }
    } catch {
      /* continue */
    }
  }

  if (!allowGeneratedFallback) {
    return null;
  }

  try {
    return await buildDaftraInvoicePdfFromApiBody(settings.subdomain, meta, invoiceId);
  } catch (e: any) {
    console.warn('[DaftraInvoice] Could not build PDF from invoice JSON:', e?.message);
    return null;
  }
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
        const existingInvoiceId = Number(booking.daftra_invoice_id);
        if (Number.isFinite(existingInvoiceId)) {
          const existingIsBillable = await hasBillableContentInDaftraInvoice(settings, existingInvoiceId);
          if (existingIsBillable) {
            return { invoiceId: String(booking.daftra_invoice_id), success: true };
          }
          console.warn(
            `[DaftraInvoice] Existing invoice ${booking.daftra_invoice_id} has no billable content; regenerating for booking ${bookingId}`
          );
        } else {
          return { invoiceId: String(booking.daftra_invoice_id), success: true };
        }
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
      const detailsHtml = buildBookingDetailsHtml(unified);
      const daftraHtmlNotes = await buildDaftraHtmlNotesWithQr(daftraNotes, unified.context.qr_data_json, detailsHtml);
      const clientId = await ensureDaftraClient(settings, {
        customer_name: unified.customer_name,
        customer_email: unified.customer_email,
        customer_phone: unified.customer_phone,
        booking_id: unified.booking_id,
        currency_code: unified.currency_code,
        address_line1: unified.context.branch_address || '',
        business_info_1: unified.context.tenant_name || '',
        business_info_2: unified.context.branch_name || '',
      });

      const invoiceNum = await createDaftraInvoice(
        settings,
        clientId,
        unified,
        daftraNotes,
        daftraHtmlNotes,
        unified.booking_id,
        booking.tenant_id
      );
      const invoiceIdStr = String(invoiceNum);
      console.log(`[DaftraInvoice] Created invoice in Daftra id=${invoiceIdStr} booking=${bookingId}`);

      if (booking.payment_status === 'paid' || booking.payment_status === 'paid_manual') {
        try {
          await markDaftraInvoicePaid({
            settings,
            invoiceId: invoiceNum,
            amount: totalPrice,
            paymentMethod: payMethod || booking.payment_method,
            transactionReference: payRef || booking.transaction_reference,
            paidAtIso: new Date().toISOString(),
          });
          console.log(`[DaftraInvoice] Paid status handling completed id=${invoiceIdStr} amount=${totalPrice}`);
        } catch (e: any) {
          console.warn(`[DaftraInvoice] Could not mark invoice paid id=${invoiceIdStr}: ${e?.message}`);
        }
      }

      // Atomic persist: only set invoice id if it is still null.
      // This prevents concurrent workers from overwriting a good invoice with another one.
      const { data: persistedRows, error: persistError } = await supabase
        .from('bookings')
        .update({
          daftra_invoice_id: invoiceIdStr,
          daftra_invoice_created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId)
        .is('daftra_invoice_id', null)
        .select('id');

      if (persistError) {
        console.warn(`[DaftraInvoice] Could not persist invoice id for booking ${bookingId}: ${persistError.message}`);
      }

      if (!persistedRows || persistedRows.length === 0) {
        const { data: latest } = await supabase
          .from('bookings')
          .select('daftra_invoice_id')
          .eq('id', bookingId)
          .maybeSingle();
        if (latest?.daftra_invoice_id) {
          console.warn(
            `[DaftraInvoice] Concurrent invoice detected for booking ${bookingId}; keeping existing invoice ${latest.daftra_invoice_id}, dropping new ${invoiceIdStr}`
          );
          return { invoiceId: String(latest.daftra_invoice_id), success: true };
        }
      }

      const qrPng = await QRCode.toBuffer(unified.context.qr_data_json, { type: 'png', width: 320, margin: 1 });
      const pdf = await tryDownloadDaftraInvoicePdf(settings, invoiceNum, booking.tenant_id);
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
      const groupQrJson = JSON.stringify({
        booking_group_id: unified.booking_group_id,
        primary_booking_id: unified.primary_booking_id,
        type: 'booking_group_ticket',
      });
      const groupHtmlNotes = await buildDaftraHtmlNotesWithQr(notes, groupQrJson);
      const clientId = await ensureDaftraClient(settings, {
        customer_name: unified.customer_name,
        customer_email: unified.customer_email,
        customer_phone: unified.customer_phone,
        booking_id: unified.primary_booking_id,
        currency_code: unified.currency_code,
        business_info_1: `Booking group ${unified.booking_group_id}`,
        business_info_2: `Primary booking ${unified.primary_booking_id}`,
      });
      const invoiceNum = await createDaftraInvoice(
        settings,
        clientId,
        unified,
        notes,
        groupHtmlNotes,
        unified.booking_group_id,
        tenantId
      );
      const invoiceIdStr = String(invoiceNum);
      const { data: first } = await supabase
        .from('bookings')
        .select('customer_email, customer_phone, payment_status')
        .eq('id', unified.primary_booking_id)
        .maybeSingle();

      if (first?.payment_status === 'paid' || first?.payment_status === 'paid_manual') {
        try {
          await markDaftraInvoicePaid({
            settings,
            invoiceId: invoiceNum,
            amount: totalAmt,
            paymentMethod: 'cash',
            paidAtIso: new Date().toISOString(),
          });
          console.log(`[DaftraInvoice] Group paid status handling completed id=${invoiceIdStr} amount=${totalAmt}`);
        } catch (e: any) {
          console.warn(`[DaftraInvoice] Could not mark group invoice paid id=${invoiceIdStr}: ${e?.message}`);
        }
      }

      // Atomic persist for group: do not overwrite already-populated invoice ids.
      const { data: persistedGroupRows, error: persistGroupError } = await supabase
        .from('bookings')
        .update({
          daftra_invoice_id: invoiceIdStr,
          daftra_invoice_created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('booking_group_id', bookingGroupId)
        .is('daftra_invoice_id', null)
        .select('id, daftra_invoice_id')
        .limit(1);

      if (persistGroupError) {
        console.warn(`[DaftraInvoice] Could not persist group invoice id for group ${bookingGroupId}: ${persistGroupError.message}`);
      }

      if (!persistedGroupRows || persistedGroupRows.length === 0) {
        const { data: existingGroup } = await supabase
          .from('bookings')
          .select('daftra_invoice_id')
          .eq('booking_group_id', bookingGroupId)
          .not('daftra_invoice_id', 'is', null)
          .limit(1)
          .maybeSingle();
        if (existingGroup?.daftra_invoice_id) {
          console.warn(
            `[DaftraInvoice] Concurrent group invoice detected for group ${bookingGroupId}; keeping existing invoice ${existingGroup.daftra_invoice_id}, dropping new ${invoiceIdStr}`
          );
          return { invoiceId: String(existingGroup.daftra_invoice_id), success: true };
        }
      }

      const uSingle = await mapBookingToUnifiedInvoice(unified.primary_booking_id).catch(() => null);
      const qrJson = uSingle?.context.qr_data_json || JSON.stringify({ booking_id: unified.primary_booking_id, type: 'booking_ticket' });
      const qrPng = await QRCode.toBuffer(qrJson, { type: 'png', width: 320, margin: 1 });
      const pdf = await tryDownloadDaftraInvoicePdf(settings, invoiceNum, tenantId);

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
  // User-triggered download uses the local renderer to ensure consistent output.
  const pdf = await tryDownloadDaftraInvoicePdf(settings, num, tenantId, { allowGeneratedFallback: true, generatedOnly: true });
  if (!pdf || pdf.length < 100) {
    throw new Error('Failed to generate local Daftra invoice PDF.');
  }
  return pdf;
}
