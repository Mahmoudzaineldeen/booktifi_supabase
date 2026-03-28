/**
 * Smoke test: Daftra invoice path (routing + store resolution + optional DB self-heal).
 * Run from server: npx tsx scripts/daftra-integration-smoke.ts
 */
import axios from 'axios';
import { supabase } from '../src/db';
import { invoiceRoutingService } from '../src/services/invoiceRoutingService';
import { loadDaftraSettingsForTenant } from '../src/services/daftraInvoiceService';

function normalizeSubdomain(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/^https?:\/\//, '');
  s = s.replace(/\.daftra\.com.*$/i, '');
  s = s.split('/')[0] || '';
  return s.split('.').filter(Boolean)[0] || '';
}

async function apiOnlyProbe(apiToken: string, sub: string): Promise<{ invoiceId?: string; err?: string }> {
  const base = `https://${sub}.daftra.com/api2`;
  const h = { apikey: apiToken, Accept: 'application/json', 'Content-Type': 'application/json' };
  const cr = await axios.post(
    `${base}/clients.json`,
    {
      Client: {
        type: 2,
        business_name: 'Smoke Test',
        first_name: 'Smoke',
        last_name: 'Test',
        email: `smoke.${Date.now()}@bookati-invoice.invalid`,
        password: 'Bk_smoke1!',
        phone1: '',
        country_code: 'SA',
        default_currency_code: 'SAR',
        notes: 'daftra-integration-smoke',
      },
    },
    { headers: h, validateStatus: () => true }
  );
  const cid = (cr.data as { id?: number })?.id;
  if (!cid) return { err: `client failed ${cr.status}: ${JSON.stringify(cr.data)}` };
  const date = new Date().toISOString().slice(0, 10);
  const body = {
    Invoice: { client_id: cid, store_id: 1, currency_code: 'SAR', date, draft: 0, notes: 'smoke' },
    InvoiceItem: [{ product_id: 1, quantity: 1, unit_price: 1 }],
  };
  const ir = await axios.post(`${base}/invoices.json`, body, { headers: h, validateStatus: () => true });
  const id = (ir.data as { id?: string | number })?.id;
  if (ir.status >= 200 && ir.status < 300 && id != null) return { invoiceId: String(id) };
  return { err: `invoice ${ir.status}: ${JSON.stringify(ir.data)}` };
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
  const dsBefore = (tenant.daftra_settings as Record<string, unknown>)?.store_id;
  console.log('Tenant:', tenantId);
  console.log('tenants.invoice_provider (DB):', tenant.invoice_provider, '(must be "daftra" for Daftra path)');
  console.log('daftra_settings.store_id (before):', dsBefore);
  console.log(
    'daftra_settings.fallback_to_zoho:',
    (tenant.daftra_settings as Record<string, unknown>)?.fallback_to_zoho === true
  );

  const settings = await loadDaftraSettingsForTenant(tenantId);
  if (!settings) {
    console.error('loadDaftraSettingsForTenant returned null');
    process.exit(1);
  }

  const sub = normalizeSubdomain(String((tenant.daftra_settings as Record<string, unknown>).subdomain || ''));
  const storesRes = await axios.get(`https://${sub}.daftra.com/api2/stores.json`, {
    headers: { apikey: settings.api_token, Accept: 'application/json' },
    validateStatus: () => true,
    timeout: 15000,
  });
  console.log('GET /api2/stores.json:', storesRes.status, storesRes.status === 200 ? 'ok' : JSON.stringify(storesRes.data).slice(0, 200));

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, tenant_id, payment_status, total_price, daftra_invoice_id, zoho_invoice_id, paid_quantity, visitor_count')
    .eq('tenant_id', tenantId)
    .in('payment_status', ['paid', 'paid_manual'])
    .is('daftra_invoice_id', null)
    .gt('total_price', 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (booking?.id) {
    console.log('\n--- invoiceRoutingService.generateReceipt ---');
    console.log('Booking:', booking.id, 'tenant_id', booking.tenant_id);
    console.log('Before: zoho_invoice_id=', booking.zoho_invoice_id ?? '(null)', '| daftra_invoice_id=', booking.daftra_invoice_id ?? '(null)');
    console.log('payment_status', booking.payment_status, 'total', booking.total_price);
    const result = await invoiceRoutingService.generateReceipt(booking.id);
    console.log('Result:', JSON.stringify(result, null, 2));

    const { data: bAfter } = await supabase
      .from('bookings')
      .select('zoho_invoice_id, daftra_invoice_id')
      .eq('id', booking.id)
      .maybeSingle();
    console.log('\n--- Verify in Supabase (source of truth) ---');
    console.log('After:  zoho_invoice_id =', bAfter?.zoho_invoice_id ?? '(null)');
    console.log('After:  daftra_invoice_id =', bAfter?.daftra_invoice_id ?? '(null)');
    if (bAfter?.daftra_invoice_id && String(result.invoiceId) === String(bAfter.daftra_invoice_id)) {
      console.log('Verdict: Invoice id is stored on bookings.daftra_invoice_id → created in Daftra.');
      console.log('(Daftra and Zoho both use numeric ids; check the correct dashboard — id', result.invoiceId, ').');
    } else if (bAfter?.zoho_invoice_id && String(result.invoiceId) === String(bAfter.zoho_invoice_id)) {
      console.log('Verdict: Invoice id is stored on bookings.zoho_invoice_id → Zoho created it (tenant provider may be zoho or Daftra failed + fallback_to_zoho).');
    } else {
      console.log('Verdict: Compare result.invoiceId to the two columns above.');
    }

    const { data: t2 } = await supabase.from('tenants').select('daftra_settings').eq('id', tenantId).maybeSingle();
    const dsAfter = (t2?.daftra_settings as Record<string, unknown> | undefined)?.store_id;
    console.log('daftra_settings.store_id (after):', dsAfter);
    if (dsBefore !== dsAfter) console.log('Self-heal: store_id was updated in tenants.daftra_settings.');
    process.exit(result.success ? 0 : 1);
  }

  console.log('\nNo unpaid-invoice booking found; running API-only probe (client + invoice, product 1, store 1)...');
  const probe = await apiOnlyProbe(settings.api_token, sub);
  if (probe.invoiceId) {
    console.log('API probe OK, Daftra invoice id:', probe.invoiceId);
    process.exit(0);
  }
  console.error('API probe failed:', probe.err);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
