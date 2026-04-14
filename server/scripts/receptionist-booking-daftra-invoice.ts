/**
 * E2E: Create a paid booking as receptionist context and issue Daftra invoice.
 * Also verifies invoice total is VAT-inclusive (greater than booking total_price).
 *
 * Run from server: npx tsx scripts/receptionist-booking-daftra-invoice.ts
 */
import axios from 'axios';
import { supabase } from '../src/db';
import { invoiceRoutingService } from '../src/services/invoiceRoutingService';
import { loadDaftraSettingsForTenant } from '../src/services/daftraInvoiceService';
import { resolveBookingTagForCreate } from '../src/services/tagPricingResolve';

async function main() {
  const { data: receptionist, error: userErr } = await supabase
    .from('users')
    .select('id, email, tenant_id, role')
    .eq('role', 'receptionist')
    .not('tenant_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (userErr || !receptionist) {
    console.error('No receptionist user found:', userErr?.message);
    process.exit(1);
  }

  const tenantId = String(receptionist.tenant_id);
  const userId = String(receptionist.id);

  const { data: tenant } = await supabase
    .from('tenants')
    .select('invoice_provider, name')
    .eq('id', tenantId)
    .maybeSingle();

  console.log('Receptionist:', receptionist.email, '| tenant=', tenant?.name, '| provider=', tenant?.invoice_provider);
  if (tenant?.invoice_provider !== 'daftra') {
    console.error('Tenant invoice provider is not Daftra.');
    process.exit(1);
  }

  const { data: services, error: svcErr } = await supabase
    .from('services')
    .select('id, name, name_ar, base_price')
    .eq('tenant_id', tenantId)
    .or('name.ilike.%mix%,name_ar.ilike.%mix%')
    .limit(5);

  if (svcErr || !services?.length) {
    console.error('No service matching "mix" for tenant:', svcErr?.message);
    process.exit(1);
  }

  const service = services.find((s) => /mix/i.test(s.name || '') || /mix/i.test(s.name_ar || '')) || services[0];
  const serviceId = String(service.id);
  console.log('Using service:', service.name || service.name_ar, serviceId);

  const tagRes = await resolveBookingTagForCreate(supabase, {
    tenantId,
    serviceId,
    tagIdFromClient: null,
    requireExplicitTag: false,
  });
  if (!tagRes.ok) {
    console.error('Tag resolve failed:', tagRes.error);
    process.exit(1);
  }

  const base = parseFloat(String(service.base_price ?? 0)) || 0;
  const totalPrice = Math.round((base + tagRes.appliedFee) * 100) / 100;
  if (totalPrice <= 0) {
    console.error('total_price is 0; cannot verify VAT.');
    process.exit(1);
  }

  const { data: shifts, error: shErr } = await supabase
    .from('shifts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('service_id', serviceId)
    .eq('is_active', true);
  if (shErr || !shifts?.length) {
    console.error('No active shifts for selected service:', shErr?.message);
    process.exit(1);
  }

  const shiftIds = shifts.map((s) => s.id);
  const today = new Date().toISOString().slice(0, 10);
  const { data: slots, error: slotErr } = await supabase
    .from('slots')
    .select('id, slot_date, start_time, end_time, employee_id, available_capacity, shift_id')
    .eq('tenant_id', tenantId)
    .in('shift_id', shiftIds)
    .gte('slot_date', today)
    .gt('available_capacity', 0)
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(10);

  if (slotErr || !slots?.length) {
    console.error('No available future slot:', slotErr?.message);
    process.exit(1);
  }

  const slot = slots[0];
  console.log('Using slot:', slot.id, slot.slot_date, slot.start_time, '-', slot.end_time);

  const stamp = Date.now();
  const { data: rpcRaw, error: rpcErr } = await supabase.rpc('create_booking_with_lock', {
    p_slot_id: slot.id,
    p_service_id: serviceId,
    p_tenant_id: tenantId,
    p_customer_name: `Receptionist Daftra E2E ${stamp}`,
    p_customer_phone: '+966501199887',
    p_customer_email: `receptionist-daftra-e2e-${stamp}@bookati.test`,
    p_visitor_count: 1,
    p_adult_count: 1,
    p_child_count: 0,
    p_total_price: totalPrice,
    p_notes: 'receptionist-booking-daftra-invoice.ts',
    p_employee_id: slot.employee_id || null,
    p_lock_id: null,
    p_session_id: userId,
    p_customer_id: null,
    p_offer_id: null,
    p_language: 'en',
    p_package_subscription_id: null,
    p_package_covered_quantity: 0,
    p_paid_quantity: 1,
  });

  if (rpcErr) {
    console.error('create_booking_with_lock failed:', rpcErr.message);
    process.exit(1);
  }

  let bookingId: string | null = null;
  const raw = rpcRaw as Record<string, unknown> | null;
  if (raw && typeof raw === 'object') {
    if (raw.booking && typeof raw.booking === 'object' && raw.booking !== null && 'id' in raw.booking) {
      bookingId = String((raw.booking as { id: string }).id);
    } else if ('id' in raw && raw.id) {
      bookingId = String(raw.id);
    }
  }
  if (!bookingId) {
    console.error('Could not parse booking id from RPC.');
    process.exit(1);
  }

  await supabase
    .from('bookings')
    .update({
      payment_status: 'paid_manual',
      payment_method: 'onsite',
      tag_id: tagRes.tagId,
      applied_tag_fee: tagRes.appliedFee,
      invoice_processing_status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId);

  const invoiceRes = await invoiceRoutingService.generateReceipt(bookingId);
  if (!invoiceRes.success || !invoiceRes.invoiceId) {
    console.error('Invoice generation failed:', invoiceRes);
    process.exit(1);
  }

  const settings = await loadDaftraSettingsForTenant(tenantId);
  if (!settings) {
    console.error('Missing Daftra settings after invoice generation.');
    process.exit(1);
  }

  const invoiceId = Number(invoiceRes.invoiceId);
  const fetchRes = await axios.get(`https://${settings.subdomain}.daftra.com/api2/invoices/${invoiceId}`, {
    headers: { apikey: settings.api_token, Accept: 'application/json' },
    validateStatus: () => true,
    timeout: 30000,
  });

  if (fetchRes.status < 200 || fetchRes.status >= 300) {
    console.error('Failed to fetch created Daftra invoice:', fetchRes.status);
    process.exit(1);
  }

  const envelope = (fetchRes.data as any)?.data ?? fetchRes.data;
  const invoice = envelope?.Invoice ?? envelope?.invoice ?? {};
  const daftraTotal = Number(invoice?.summary_total || 0);

  console.log('Booking total_price:', totalPrice);
  console.log('Daftra summary_total:', daftraTotal);
  console.log('Invoice id:', invoiceId);

  if (!Number.isFinite(daftraTotal) || daftraTotal <= totalPrice) {
    console.error('VAT check failed: Daftra summary_total is not greater than booking total_price.');
    process.exit(1);
  }

  console.log('OK: Receptionist flow produced a VAT-inclusive Daftra invoice.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
