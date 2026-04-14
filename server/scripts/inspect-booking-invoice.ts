/**
 * Inspect one booking and its Daftra invoice payloads.
 * Usage: npx tsx scripts/inspect-booking-invoice.ts <bookingId>
 */
import axios from 'axios';
import { supabase } from '../src/db';
import { loadDaftraSettingsForTenant } from '../src/services/daftraInvoiceService';

async function main() {
  const bookingId = process.argv[2];
  if (!bookingId) {
    throw new Error('Provide booking id: npx tsx scripts/inspect-booking-invoice.ts <bookingId>');
  }

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id,tenant_id,total_price,payment_status,payment_method,daftra_invoice_id,created_at,customer_name')
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !booking) {
    throw new Error(`Booking not found: ${error?.message || bookingId}`);
  }

  console.log('Booking row:', JSON.stringify(booking, null, 2));

  if (!booking.daftra_invoice_id) {
    throw new Error('Booking has no daftra_invoice_id');
  }

  const settings = await loadDaftraSettingsForTenant(String(booking.tenant_id));
  if (!settings) {
    throw new Error('Missing Daftra settings for tenant');
  }

  const invoiceId = String(booking.daftra_invoice_id);
  const headers = { apikey: settings.api_token, Accept: 'application/json' };
  const base = `https://${settings.subdomain}.daftra.com/api2`;

  const endpoints = [
    `${base}/invoices/${invoiceId}`,
    `${base}/invoices/${invoiceId}.json`,
    `${base}/invoices.json`,
  ];

  for (const url of endpoints) {
    const res = await axios.get(url, {
      headers,
      validateStatus: () => true,
      timeout: 30000,
    });
    const payload = (res.data as any)?.data ?? res.data;
    let invoice: any = payload?.Invoice ?? payload?.invoice ?? payload;
    let items: any[] = Array.isArray(payload?.InvoiceItem) ? payload.InvoiceItem : [];

    if (url.endsWith('/invoices.json')) {
      const list = Array.isArray(payload) ? payload : Array.isArray((res.data as any)?.data) ? (res.data as any).data : [];
      const row = list.find((x: any) => String(x?.Invoice?.id ?? x?.id ?? '') === String(invoiceId));
      invoice = row?.Invoice ?? row ?? null;
      items = Array.isArray(row?.InvoiceItem) ? row.InvoiceItem : [];
    }

    const vatItem = items.find((it) => String(it?.item || '').toLowerCase().includes('vat'));
    console.log(
      JSON.stringify(
        {
          url,
          status: res.status,
          invoice_id: invoice?.id ?? null,
          summary_subtotal: invoice?.summary_subtotal ?? null,
          summary_tax1: invoice?.summary_tax1 ?? null,
          summary_total: invoice?.summary_total ?? null,
          item_count: items.length,
          vat_item: vatItem
            ? {
                item: vatItem.item,
                unit_price: vatItem.unit_price,
                subtotal: vatItem.subtotal,
              }
            : null,
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
