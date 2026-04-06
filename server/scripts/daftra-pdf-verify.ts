/**
 * Verifies Daftra invoice PDF retrieval (invoicepdfurl path + fallback) and that bytes are a valid PDF.
 * Run: cd server && npx tsx scripts/daftra-pdf-verify.ts
 *
 * Requires server/.env with Supabase + a tenant with invoice_provider=daftra and daftra_settings,
 * OR will create a minimal client+invoice via Daftra API if no booking invoice id exists.
 */
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import axios from 'axios';
import { supabase } from '../src/db';
import { downloadDaftraInvoicePdfForTenant, loadDaftraSettingsForTenant } from '../src/services/daftraInvoiceService';

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeSubdomain(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/^https?:\/\//, '');
  s = s.replace(/\.daftra\.com.*$/i, '');
  s = s.split('/')[0] || '';
  return s.split('.').filter(Boolean)[0] || '';
}

async function createProbeInvoice(apiToken: string, sub: string): Promise<number | null> {
  const base = `https://${sub}.daftra.com/api2`;
  const h = { apikey: apiToken, Accept: 'application/json', 'Content-Type': 'application/json' };
  const cr = await axios.post(
    `${base}/clients.json`,
    {
      Client: {
        type: 2,
        business_name: 'PDF Verify',
        first_name: 'PDF',
        last_name: 'Verify',
        email: `pdf.verify.${Date.now()}@bookati-invoice.invalid`,
        password: 'Bk_verify1!',
        phone1: '',
        country_code: 'SA',
        default_currency_code: 'SAR',
        notes: 'daftra-pdf-verify',
      },
    },
    { headers: h, validateStatus: () => true }
  );
  const cid = (cr.data as { id?: number })?.id;
  if (!cid) {
    console.error('Probe client failed:', cr.status, cr.data);
    return null;
  }
  const date = new Date().toISOString().slice(0, 10);
  const body = {
    Invoice: { client_id: cid, store_id: 1, currency_code: 'SAR', date, draft: 0, notes: 'pdf-verify' },
    InvoiceItem: [{ product_id: 1, quantity: 1, unit_price: 1 }],
  };
  const ir = await axios.post(`${base}/invoices.json`, body, { headers: h, validateStatus: () => true });
  const id = (ir.data as { id?: string | number })?.id;
  if (ir.status >= 200 && ir.status < 300 && id != null) return Number(id);
  console.error('Probe invoice failed:', ir.status, ir.data);
  return null;
}

function assertPdfPrintable(buf: Buffer): void {
  const head = buf.subarray(0, 5).toString('ascii');
  if (head !== '%PDF-') {
    throw new Error(`Not a PDF magic header: ${head}`);
  }
  const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString('latin1');
  if (!tail.includes('%%EOF')) {
    console.warn('Warning: %%EOF not found in last 1KB — file may still be valid for some generators.');
  }
}

async function main() {
  const { data: tenants, error: te } = await supabase
    .from('tenants')
    .select('id, invoice_provider, daftra_settings')
    .eq('invoice_provider', 'daftra');

  if (te) {
    console.error('Supabase:', te.message);
    process.exit(1);
  }

  const withDaftra = (tenants || []).filter((t) => {
    const d = t.daftra_settings as Record<string, unknown> | null;
    return d?.api_token && d?.subdomain;
  });

  if (withDaftra.length === 0) {
    console.error('No tenant with invoice_provider=daftra and daftra_settings (api_token + subdomain).');
    process.exit(1);
  }

  const tenantRow = withDaftra[0];
  const tenantId = tenantRow.id as string;
  const settings = await loadDaftraSettingsForTenant(tenantId);
  if (!settings) {
    console.error('loadDaftraSettingsForTenant returned null');
    process.exit(1);
  }

  const sub = normalizeSubdomain(String((tenantRow.daftra_settings as Record<string, unknown>).subdomain || ''));

  let invoiceId: number | null = null;

  const { data: booking } = await supabase
    .from('bookings')
    .select('daftra_invoice_id')
    .eq('tenant_id', tenantId)
    .not('daftra_invoice_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (booking?.daftra_invoice_id) {
    invoiceId = parseInt(String(booking.daftra_invoice_id), 10);
    console.log('Using existing booking daftra_invoice_id:', invoiceId);
  } else {
    console.log('No booking with daftra_invoice_id; creating probe invoice via API...');
    invoiceId = await createProbeInvoice(settings.api_token, sub);
    if (!invoiceId) process.exit(1);
    console.log('Probe invoice id:', invoiceId);
  }

  console.log('Downloading PDF via downloadDaftraInvoicePdfForTenant...');
  const { pdf, source, resolvedInvoiceId } = await downloadDaftraInvoicePdfForTenant(tenantId, invoiceId);
  console.log('Resolved internal id:', resolvedInvoiceId, '| X-Invoice-Source:', source === 'daftra-remote' ? 'daftra-api' : 'bookati-local-generator');

  assertPdfPrintable(pdf);
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const n = doc.getPageCount();
  if (n < 1) {
    throw new Error('PDF has no pages');
  }
  console.log('pdf-lib: OK, page count =', n);

  const outDir = join(__dirname, '..', '.tmp');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `daftra-verify-${invoiceId}.pdf`);
  await writeFile(outPath, pdf);
  console.log('Wrote sample file:', outPath);
  console.log('Verdict: PDF retrieved and parseable (printable by standard viewers).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
