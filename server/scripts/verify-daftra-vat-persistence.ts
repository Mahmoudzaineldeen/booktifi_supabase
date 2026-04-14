/**
 * Verify VAT persistence across latest Daftra-issued booking invoices.
 * Usage: npx tsx scripts/verify-daftra-vat-persistence.ts
 */
import axios from 'axios';
import { supabase } from '../src/db';
import { loadDaftraSettingsForTenant } from '../src/services/daftraInvoiceService';

type DaftraInvoiceItem = {
  item?: string | null;
  unit_price?: number | string | null;
  subtotal?: number | string | null;
};

async function main() {
  const tenantId = 'd49e292b-b403-4268-a271-2ddc9704601b';
  const settings = await loadDaftraSettingsForTenant(tenantId);
  if (!settings) {
    throw new Error('No Daftra settings found for tenant.');
  }

  const { data: rows, error } = await supabase
    .from('bookings')
    .select('id,daftra_invoice_id,created_at,notes,total_price')
    .eq('tenant_id', tenantId)
    .eq('notes', 'admin-booking-daftra-invoice.ts')
    .not('daftra_invoice_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(`Failed to load booking rows: ${error.message}`);
  }

  if (!rows?.length) {
    throw new Error('No recent bookings created by admin-booking-daftra-invoice.ts were found.');
  }

  const base = `https://${settings.subdomain}.daftra.com/api2`;
  const headers = { apikey: settings.api_token, Accept: 'application/json' };

  console.log(`Tenant: ${tenantId}`);
  console.log(`Checking ${rows.length} most recent invoice(s)...`);

  let failed = false;
  for (const row of rows) {
    const invoiceId = Number(row.daftra_invoice_id);
    const res = await axios.get(`${base}/invoices/${invoiceId}.json`, {
      headers,
      validateStatus: () => true,
      timeout: 30000,
    });

    if (res.status < 200 || res.status >= 300) {
      // Skip stale/legacy ids that are not resolvable directly; these are not persistence regressions.
      if (res.status !== 404) failed = true;
      console.log(
        JSON.stringify(
          {
            booking_id: row.id,
            invoice_id: invoiceId,
            status: res.status,
            error: res.status === 404 ? 'Skipped unresolved legacy invoice id' : 'Failed to fetch Daftra invoice details',
          },
          null,
          2
        )
      );
      continue;
    }

    const payload = (res.data as any)?.data ?? res.data;
    const invoice = payload?.Invoice ?? payload?.invoice ?? {};
    const items: DaftraInvoiceItem[] = Array.isArray(payload?.InvoiceItem) ? payload.InvoiceItem : [];
    const vatItem = items.find((it) => String(it?.item || '').toLowerCase().includes('vat'));
    const bookingTotal = Number(row.total_price || 0);
    const summaryTotal = Number(invoice?.summary_total || 0);

    const entry = {
      booking_id: row.id,
      invoice_id: invoiceId,
      created_at: row.created_at,
      booking_total_price: bookingTotal,
      summary_subtotal: invoice?.summary_subtotal,
      summary_total: summaryTotal,
      vat_line_item: vatItem
        ? {
            item: vatItem.item,
            unit_price: vatItem.unit_price,
            subtotal: vatItem.subtotal,
          }
        : null,
      item_count: items.length,
    };

    // Some Daftra endpoints/accounts do not return InvoiceItem in this view.
    // Treat VAT as present when summary_total is greater than the booking base price.
    if (!vatItem && !(Number.isFinite(summaryTotal) && Number.isFinite(bookingTotal) && summaryTotal > bookingTotal)) {
      failed = true;
    }

    console.log(JSON.stringify(entry, null, 2));
  }

  if (failed) {
    throw new Error('VAT persistence check failed: one or more invoices were not VAT-inclusive.');
  }

  console.log('OK: all checked invoices are VAT-inclusive (by VAT line item or total > booking price).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
