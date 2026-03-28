/**
 * Routes invoice generation to Zoho or Daftra based on tenant `invoice_provider`.
 */
import { supabase } from '../db';
import { daftraInvoiceService, loadDaftraSettingsForTenant } from './daftraInvoiceService';
import { zohoService } from './zohoService';

export type InvoiceProviderId = 'zoho' | 'daftra';

export async function getInvoiceProviderForTenant(tenantId: string): Promise<InvoiceProviderId> {
  const { data } = await supabase.from('tenants').select('invoice_provider').eq('id', tenantId).maybeSingle();
  return data?.invoice_provider === 'daftra' ? 'daftra' : 'zoho';
}

/**
 * Facade for invoice backends (Zoho / Daftra). Prefer this over calling zoho/daftra services directly from routes.
 * `invoiceService` is an alias for the same object (naming aligned with InvoiceService abstraction).
 */
export const invoiceRoutingService = {
  async generateReceipt(
    bookingId: string,
    options?: { paymentMethod?: string; transactionReference?: string }
  ): Promise<{ invoiceId: string; success: boolean; error?: string }> {
    const { data: booking } = await supabase.from('bookings').select('tenant_id').eq('id', bookingId).maybeSingle();
    const tenantId = booking?.tenant_id;
    if (!tenantId) {
      return { invoiceId: '', success: false, error: 'Booking not found' };
    }

    const provider = await getInvoiceProviderForTenant(tenantId);
    console.log(`[InvoiceRouting] booking=${bookingId} tenant=${tenantId} provider=${provider}`);

    if (provider === 'daftra') {
      const daftra = await daftraInvoiceService.generateReceipt(bookingId, options);
      if (daftra.success && daftra.invoiceId) {
        console.log(`[InvoiceRouting] Daftra OK invoice_id=${daftra.invoiceId}`);
      } else if (daftra.success && !daftra.invoiceId) {
        console.log(`[InvoiceRouting] Daftra OK — no invoice id (e.g. nothing to bill)`);
      }
      if (!daftra.success) {
        const settings = await loadDaftraSettingsForTenant(tenantId);
        if (settings?.fallback_to_zoho) {
          console.warn(`[InvoiceRouting] Daftra failed (${daftra.error || 'unknown'}), falling back to Zoho`);
          const zoho = await zohoService.generateReceipt(bookingId, options);
          if (zoho.success && zoho.invoiceId) {
            console.log(`[InvoiceRouting] Zoho (fallback) OK invoice_id=${zoho.invoiceId}`);
          }
          return zoho;
        }
      }
      return daftra;
    }

    console.log(`[InvoiceRouting] Using Zoho for booking=${bookingId}`);
    return zohoService.generateReceipt(bookingId, options);
  },

  async generateReceiptForBookingGroup(bookingGroupId: string): Promise<{ invoiceId: string; success: boolean; error?: string }> {
    const { data: rows } = await supabase
      .from('bookings')
      .select('tenant_id')
      .eq('booking_group_id', bookingGroupId)
      .limit(1);

    const tenantId = rows?.[0]?.tenant_id;
    if (!tenantId) {
      return { invoiceId: '', success: false, error: 'Booking group not found' };
    }

    const provider = await getInvoiceProviderForTenant(tenantId);
    console.log(`[InvoiceRouting] group=${bookingGroupId} tenant=${tenantId} provider=${provider}`);

    if (provider === 'daftra') {
      const daftra = await daftraInvoiceService.generateReceiptForBookingGroup(bookingGroupId);
      if (daftra.success && daftra.invoiceId) {
        console.log(`[InvoiceRouting] Daftra group OK invoice_id=${daftra.invoiceId}`);
      }
      if (!daftra.success) {
        const settings = await loadDaftraSettingsForTenant(tenantId);
        if (settings?.fallback_to_zoho) {
          console.warn(`[InvoiceRouting] Daftra group failed (${daftra.error || 'unknown'}), falling back to Zoho`);
          return zohoService.generateReceiptForBookingGroup(bookingGroupId);
        }
      }
      return daftra;
    }

    return zohoService.generateReceiptForBookingGroup(bookingGroupId);
  },
};

export const invoiceService = invoiceRoutingService;
