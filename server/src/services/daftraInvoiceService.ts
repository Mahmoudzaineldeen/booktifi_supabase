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
  /**
   * Optional OAuth app + portal login (or refresh token) so `invoice_pdf_url` returns a real PDF.
   * API keys alone cannot download Daftra-branded PDFs (URLs require Bearer / browser session).
   */
  pdf_oauth_client_id?: string;
  pdf_oauth_client_secret?: string;
  pdf_oauth_refresh_token?: string;
  pdf_oauth_username?: string;
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
  const pdf_oauth_client_id = typeof o.pdf_oauth_client_id === 'string' ? o.pdf_oauth_client_id.trim() : '';
  const pdf_oauth_client_secret = typeof o.pdf_oauth_client_secret === 'string' ? o.pdf_oauth_client_secret.trim() : '';
  const pdf_oauth_refresh_token = typeof o.pdf_oauth_refresh_token === 'string' ? o.pdf_oauth_refresh_token.trim() : '';
  const pdf_oauth_username = typeof o.pdf_oauth_username === 'string' ? o.pdf_oauth_username.trim() : '';
  return {
    subdomain,
    api_token,
    store_id,
    default_product_id,
    ...(Number.isFinite(invoice_layout_id) ? { invoice_layout_id } : {}),
    country_code: typeof o.country_code === 'string' ? o.country_code : 'SA',
    fallback_to_zoho: o.fallback_to_zoho === true,
    ...(pdf_oauth_client_id ? { pdf_oauth_client_id } : {}),
    ...(pdf_oauth_client_secret ? { pdf_oauth_client_secret } : {}),
    ...(pdf_oauth_refresh_token ? { pdf_oauth_refresh_token } : {}),
    ...(pdf_oauth_username ? { pdf_oauth_username } : {}),
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

function daftraOAuthTokenUrls(subdomain: string): string[] {
  // Daftra tenants vary by OAuth route; try common variants.
  return [
    `https://${subdomain}.daftra.com/v2/oauth/token`,
    `${apiBase(subdomain)}/oauth/token`,
    `${apiBase(subdomain)}/v2/oauth/token`,
  ];
}

type DaftraOAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

async function postDaftraOAuthToken(
  bareSubdomain: string,
  params: Record<string, string>,
  onError?: (message: string) => void
): Promise<DaftraOAuthTokenResponse | null> {
  const body = new URLSearchParams(params);
  const attempts: string[] = [];
  for (const url of daftraOAuthTokenUrls(bareSubdomain)) {
    try {
      const res = await axios.post(url, body.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        validateStatus: () => true,
        timeout: 30000,
      });
      if (res.status >= 200 && res.status < 300 && res.data && typeof res.data.access_token === 'string') {
        return res.data as DaftraOAuthTokenResponse;
      }
      const details = typeof res.data === 'object' ? JSON.stringify(res.data).slice(0, 300) : String(res.data || '');
      attempts.push(`${url} -> ${res.status}${details ? ` ${details}` : ''}`);
    } catch (e: any) {
      attempts.push(`${url} -> request failed: ${e?.message || 'unknown error'}`);
    }
  }
  const msg = attempts.join(' | ');
  console.warn('[DaftraOAuth] token request failed across endpoints:', msg);
  if (onError) onError(msg);
  return null;
}

/** One-shot password grant (call from settings save only; do not persist password). */
export async function exchangeDaftraPdfOauthPassword(
  subdomain: string,
  clientId: string,
  clientSecret: string,
  username: string,
  password: string
): Promise<DaftraOAuthTokenResponse> {
  const sub = normalizeSubdomain(subdomain);
  let oauthErrorDetail = '';
  const tok = await postDaftraOAuthToken(sub, {
    grant_type: 'password',
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password,
  }, (m) => {
    oauthErrorDetail = m;
  });
  if (!tok?.access_token) {
    throw new Error(
      `Daftra OAuth password grant failed. Check client id/secret, username, password, and subdomain. ${oauthErrorDetail ? `Details: ${oauthErrorDetail}` : ''}`.trim()
    );
  }
  return tok;
}

const portalAccessCache = new Map<string, { access_token: string; exp: number }>();

async function persistDaftraPdfOauthRefresh(tenantId: string, newRefresh: string): Promise<void> {
  const { data, error } = await supabase.from('tenants').select('daftra_settings').eq('id', tenantId).single();
  if (error || !data?.daftra_settings || typeof data.daftra_settings !== 'object') return;
  const cur = { ...(data.daftra_settings as Record<string, unknown>) };
  cur.pdf_oauth_refresh_token = newRefresh;
  await supabase.from('tenants').update({ daftra_settings: cur, updated_at: new Date().toISOString() }).eq('id', tenantId);
}

/**
 * Bearer token for Daftra *portal* PDF URLs (invoice_pdf_url). Uses refresh_token from settings.
 */
async function getDaftraPortalAccessToken(settings: DaftraTenantSettings, tenantId: string | null): Promise<string | null> {
  const cid = settings.pdf_oauth_client_id?.trim();
  const sec = settings.pdf_oauth_client_secret?.trim();
  const rt = settings.pdf_oauth_refresh_token?.trim();
  if (!cid || !sec || !rt || !tenantId) return null;

  const cacheKey = tenantId;
  const now = Date.now();
  const cached = portalAccessCache.get(cacheKey);
  if (cached && cached.exp > now + 5000) return cached.access_token;

  const tok = await postDaftraOAuthToken(settings.subdomain, {
    grant_type: 'refresh_token',
    client_id: cid,
    client_secret: sec,
    refresh_token: rt,
  });
  if (!tok?.access_token) {
    portalAccessCache.delete(cacheKey);
    return null;
  }
  const ttlMs = Math.min(Math.max((tok.expires_in ?? 3600) * 1000 - 120_000, 60_000), 24 * 3600 * 1000);
  portalAccessCache.set(cacheKey, { access_token: tok.access_token, exp: now + ttlMs });
  if (typeof tok.refresh_token === 'string' && tok.refresh_token !== rt) {
    await persistDaftraPdfOauthRefresh(tenantId, tok.refresh_token);
    settings.pdf_oauth_refresh_token = tok.refresh_token;
  }
  return tok.access_token;
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
  const items = u.line_items.map((li) => ({
    product_id: settings.default_product_id,
    // Daftra standard item table fields.
    item: (li.name || 'Item').slice(0, 255),
    description: (li.description || '').toString().slice(0, 255),
    quantity: li.quantity,
    unit_price: li.rate,
    // Keep custom layout columns for templates that already bind to col_3/col_4.
    col_3: (li.name || 'Item').slice(0, 255),
    col_4: (li.description || '').toString().slice(0, 255),
  }));

  /** Daftra parses line items only when `InvoiceItem` is a top-level key next to `Invoice` (nested `Invoice.InvoiceItem` yields "Invoice is empty"). */
  const body = {
    Invoice: {
      client_id: clientId,
      store_id: storeId,
      ...(Number.isFinite(settings.invoice_layout_id) ? { invoice_layout_id: settings.invoice_layout_id } : {}),
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
  const itemsRaw = invoice.InvoiceItem ?? data?.InvoiceItem;
  let items: any[] = [];
  if (Array.isArray(itemsRaw)) items = itemsRaw;
  else if (itemsRaw && typeof itemsRaw === 'object') items = [itemsRaw];
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
  const doc = new PDFDocument({ margin: 14, size: [302, 820] });
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

  doc.fontSize(18).text('Invoice', { align: 'center' });
  doc.fontSize(13).text(client?.business_info_1 || subdomain, { align: 'center' });
  doc.moveDown(0.4);
  const companyLine1 = invoice?.company_name || client?.business_name || '';
  const companyLine2 = [invoice?.company_address1, invoice?.company_city].filter(Boolean).join(', ');
  if (companyLine1) doc.fontSize(9).text(String(companyLine1), { align: 'center' });
  if (companyLine2) doc.fontSize(9).text(String(companyLine2), { align: 'center' });
  doc.moveDown(1.1);

  doc.fontSize(10).text(`Invoice No`, 22, doc.y);
  doc.text(String(invoice?.no ?? invoiceId), 130, doc.y - 11);
  doc.text(`Invoice Date`, 22, doc.y + 2);
  doc.text(String(invoice?.date ?? '—'), 130, doc.y - 11);
  doc.moveDown(1.2);

  const tableLeft = 18;
  const totalWidth = 266;
  const col = {
    item: 80,
    desc: 84,
    qty: 28,
    price: 36,
    subtotal: 38,
  };
  let y = doc.y;
  doc.rect(tableLeft, y, totalWidth, 24).lineWidth(1).stroke('#111');
  let x = tableLeft;
  for (const w of [col.item, col.desc, col.qty, col.price]) {
    x += w;
    doc.moveTo(x, y).lineTo(x, y + 24).stroke('#111');
  }
  doc.fontSize(10).fillColor('#000');
  doc.text('Item name', tableLeft + 4, y + 7, { width: col.item - 8 });
  doc.text('Description', tableLeft + col.item + 4, y + 7, { width: col.desc - 8 });
  doc.text('Qty', tableLeft + col.item + col.desc + 4, y + 7, { width: col.qty - 8, align: 'center' });
  doc.text('Price', tableLeft + col.item + col.desc + col.qty + 4, y + 7, { width: col.price - 8, align: 'center' });
  doc.text('Subtotal', tableLeft + col.item + col.desc + col.qty + col.price + 2, y + 7, { width: col.subtotal - 4, align: 'center' });
  y += 24;

  const lines = items.length ? items : [{ item: 'Item', description: '', quantity: 1, unit_price: 0, subtotal: 0 }];
  for (const line of lines) {
    const qty = Number(line.quantity ?? line.qty ?? 1);
    const unit = Number(line.unit_price ?? line.price ?? 0);
    const sub = Number(line.subtotal ?? line.total ?? qty * unit);
    const rowH = 28;
    doc.rect(tableLeft, y, totalWidth, rowH).lineWidth(0.8).stroke('#111');
    let vx = tableLeft;
    for (const w of [col.item, col.desc, col.qty, col.price]) {
      vx += w;
      doc.moveTo(vx, y).lineTo(vx, y + rowH).stroke('#111');
    }
    doc.fontSize(11).text(String(line.item || line.name || line.product_name || 'Item'), tableLeft + 4, y + 8, { width: col.item - 8 });
    doc.fontSize(10).text(String(line.description || ''), tableLeft + col.item + 4, y + 8, { width: col.desc - 8 });
    doc.fontSize(10).text(String(qty), tableLeft + col.item + col.desc + 4, y + 8, { width: col.qty - 8, align: 'center' });
    doc.fontSize(10).text(fmt(unit), tableLeft + col.item + col.desc + col.qty + 4, y + 8, { width: col.price - 8, align: 'center' });
    doc.fontSize(10).text(fmt(sub), tableLeft + col.item + col.desc + col.qty + col.price + 2, y + 8, { width: col.subtotal - 4, align: 'center' });
    y += rowH;
  }

  const summaryRows = [
    ['Items Total', fmt(invoice?.summary_subtotal ?? invoice?.summary_total)],
    ['Total', fmt(invoice?.summary_total)],
    ['Paid', fmt(invoice?.summary_paid ?? 0)],
    ['Balance Due', fmt(invoice?.summary_unpaid ?? invoice?.summary_total ?? 0)],
  ];
  for (const [label, value] of summaryRows) {
    const rowH = 34;
    doc.rect(tableLeft, y, totalWidth, rowH).lineWidth(1).stroke('#111');
    doc.fontSize(13).text(label, tableLeft + 8, y + 10, { width: 150 });
    doc.fontSize(13).text(`﷼ ${value}`, tableLeft + 170, y + 10, { width: 90, align: 'right' });
    y += rowH;
  }

  y += 10;
  const cust =
    client?.business_name ||
    client?.name ||
    [invoice?.client_first_name, invoice?.client_last_name].filter(Boolean).join(' ').trim() ||
    invoice?.client_business_name ||
    '—';
  const notesText = String(invoice?.notes || '').trim();
  doc.fontSize(12);
  if (notesText) doc.text(notesText, tableLeft, y, { width: totalWidth });

  const bookingIdMatch = notesText.match(/Booking ID:\s*([^\n]+)/i);
  const qrPayload = bookingIdMatch
    ? JSON.stringify({ booking_id: bookingIdMatch[1].trim(), invoice_id: String(invoice?.no ?? invoiceId), type: 'booking_invoice' })
    : JSON.stringify({ invoice_id: String(invoice?.no ?? invoiceId), client: cust || '—', amount: invoice?.summary_total ?? 0 });
  try {
    const qr = await QRCode.toBuffer(qrPayload, { type: 'png', width: 220, margin: 1 });
    const qrY = Math.min(doc.y + 10, doc.page.height - 240);
    doc.image(qr, tableLeft + 20, qrY, { fit: [220, 220], align: 'center' });
  } catch {
    /* keep PDF generation resilient */
  }

  if (invoice?.notes) {
    doc.moveDown(0.2);
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
    const portalToken = tenantId ? await getDaftraPortalAccessToken(settings, tenantId) : null;
    if (portalToken) {
      try {
        const pdfRes = await axios.get(pdfUrl, {
          responseType: 'arraybuffer',
          headers: {
            Authorization: `Bearer ${portalToken}`,
            Accept: 'application/pdf,*/*',
          },
          validateStatus: (s) => s === 200,
          timeout: 30000,
          maxRedirects: 5,
        });
        const buf = pdfRes.data && Buffer.from(pdfRes.data);
        if (buf && buf.length > 100 && buf.subarray(0, 4).toString() === '%PDF') {
          return buf;
        }
      } catch {
        /* fall through */
      }
    }
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

      await supabase
        .from('bookings')
        .update({
          daftra_invoice_id: invoiceIdStr,
          daftra_invoice_created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId);

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
