/**
 * Test retrieving invoices from Daftra API (list + optional single invoice).
 * Run: cd server && npm run daftra-retrieve-invoices-test
 */
import axios from 'axios';
import { supabase } from '../src/db';
import { loadDaftraSettingsForTenant, resolveDaftraInternalInvoiceId } from '../src/services/daftraInvoiceService';

function normalizeSubdomain(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/^https?:\/\//, '');
  s = s.replace(/\.daftra\.com.*$/i, '');
  s = s.split('/')[0] || '';
  return s.split('.').filter(Boolean)[0] || '';
}

async function main() {
  const { data: tenants, error: te } = await supabase
    .from('tenants')
    .select('id, invoice_provider, daftra_settings')
    .eq('invoice_provider', 'daftra');

  if (te) {
    console.error('Supabase error:', te.message);
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

  const tenant = withDaftra[0];
  const tenantId = tenant.id as string;
  const settings = await loadDaftraSettingsForTenant(tenantId);
  if (!settings) {
    console.error('loadDaftraSettingsForTenant returned null');
    process.exit(1);
  }

  const sub = normalizeSubdomain(String((tenant.daftra_settings as Record<string, unknown>).subdomain || ''));
  const base = `https://${sub}.daftra.com/api2`;
  const headers = { apikey: settings.api_token, Accept: 'application/json' };

  console.log('Tenant:', tenantId);
  console.log('Subdomain:', sub);
  console.log('\n--- GET /api2/invoices.json ---');

  const listRes = await axios.get(`${base}/invoices.json`, {
    headers,
    validateStatus: () => true,
    timeout: 120000,
  });

  console.log('HTTP status:', listRes.status);
  if (listRes.status !== 200) {
    console.error('Body (truncated):', JSON.stringify(listRes.data).slice(0, 500));
    process.exit(1);
  }

  const payload = listRes.data as { data?: unknown[]; result?: string };
  const rows: unknown[] = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(listRes.data)
      ? (listRes.data as unknown[])
      : [];
  console.log('Invoice rows:', rows.length);
  const sample = rows.slice(0, 5).map((row) => {
    const inv = (row as { Invoice?: Record<string, unknown> })?.Invoice ?? row;
    return {
      id: inv?.id,
      no: inv?.no,
      date: inv?.date,
      summary_total: inv?.summary_total,
    };
  });
  console.log('Sample (first 5):', JSON.stringify(sample, null, 2));

  const firstId = sample[0]?.id;
  if (firstId != null && firstId !== '') {
    const idNum = parseInt(String(firstId), 10);
    if (Number.isFinite(idNum)) {
      console.log('\n--- GET /api2/invoices/' + idNum + ' (extensionless) ---');
      const single = await axios.get(`${base}/invoices/${idNum}`, {
        headers,
        validateStatus: () => true,
        timeout: 30000,
      });
      console.log('HTTP status:', single.status);
      const inv = (single.data as any)?.data?.Invoice ?? (single.data as any)?.Invoice;
      if (inv) {
        console.log('Invoice id:', inv.id, 'no:', inv.no, 'summary_total:', inv.summary_total);
        console.log('Has invoicepdfurl:', !!inv.invoicepdfurl, '| invoice_pdf_url:', !!inv.invoice_pdf_url);
      } else {
        console.log('Body (truncated):', JSON.stringify(single.data).slice(0, 400));
      }

      const jsonRes = await axios.get(`${base}/invoices/${idNum}.json`, {
        headers,
        validateStatus: () => true,
        timeout: 30000,
      });
      console.log('GET .../invoices/' + idNum + '.json status:', jsonRes.status);
    }
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('daftra_invoice_id')
    .eq('tenant_id', tenantId)
    .not('daftra_invoice_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (booking?.daftra_invoice_id) {
    const raw = String(booking.daftra_invoice_id);
    console.log('\n--- resolveDaftraInternalInvoiceId for booking daftra_invoice_id:', raw, '---');
    try {
      const resolved = await resolveDaftraInternalInvoiceId(settings, raw);
      console.log('Resolved internal id:', resolved);
    } catch (e: any) {
      console.error('Resolve failed:', e?.message || e);
    }
  } else {
    console.log('\n(No booking with daftra_invoice_id for resolve test.)');
  }

  console.log('\nVerdict: Daftra invoice list + single fetch completed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
