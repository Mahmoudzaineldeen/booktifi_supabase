/**
 * E2E: Sign in as tenant admin (password verified), create a paid "mix" booking, run Daftra invoice.
 * Run from server: npx tsx scripts/admin-booking-daftra-invoice.ts
 *
 * Env: ADMIN_E2E_EMAIL (default mahmoudnzaineldeen@gmail.com), ADMIN_E2E_PASSWORD (default 111111)
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { join } from 'path';
import { supabase } from '../src/db';
import { invoiceRoutingService } from '../src/services/invoiceRoutingService';
import { resolveBookingTagForCreate } from '../src/services/tagPricingResolve';

dotenv.config({ path: join(process.cwd(), '.env') });

const EMAIL = process.env.ADMIN_E2E_EMAIL || 'mahmoudnzaineldeen@gmail.com';
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || '111111';

async function main() {
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, email, tenant_id, role, password_hash')
    .eq('email', EMAIL)
    .maybeSingle();

  if (userErr || !user) {
    console.error('User not found:', EMAIL, userErr?.message);
    process.exit(1);
  }

  const hash = user.password_hash;
  if (!hash) {
    console.error('User has no password_hash');
    process.exit(1);
  }

  const ok = await bcrypt.compare(PASSWORD, hash);
  if (!ok) {
    console.error('Invalid password for', EMAIL);
    process.exit(1);
  }
  console.log('Password OK for', EMAIL, 'role=', user.role);

  const tenantId = user.tenant_id as string;
  if (!tenantId) {
    console.error('User has no tenant_id');
    process.exit(1);
  }

  const { data: tenant } = await supabase.from('tenants').select('invoice_provider, name').eq('id', tenantId).maybeSingle();
  console.log('Tenant:', tenant?.name, '| invoice_provider=', tenant?.invoice_provider);
  if (tenant?.invoice_provider !== 'daftra') {
    console.error('Set tenant invoice provider to Daftra in Settings and save, then re-run.');
    process.exit(1);
  }

  const { data: services, error: svcErr } = await supabase
    .from('services')
    .select('id, name, name_ar, base_price, scheduling_type')
    .eq('tenant_id', tenantId)
    .or('name.ilike.%mix%,name_ar.ilike.%mix%')
    .limit(5);

  if (svcErr || !services?.length) {
    console.error('No service matching "mix" for tenant:', svcErr?.message);
    process.exit(1);
  }

  const service = services.find((s) => /mix/i.test(s.name || '') || /mix/i.test(s.name_ar || '')) || services[0];
  const serviceId = service.id as string;
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
  const tagId = tagRes.tagId;
  const tagFee = tagRes.appliedFee;

  const base = parseFloat(String(service.base_price ?? 0)) || 0;
  const totalPrice = Math.round((base + tagFee) * 100) / 100;
  if (totalPrice <= 0) {
    console.error('total_price would be 0; set base_price on service or use a priced service.');
    process.exit(1);
  }

  const { data: shifts, error: shErr } = await supabase
    .from('shifts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('service_id', serviceId)
    .eq('is_active', true);

  if (shErr || !shifts?.length) {
    console.error('No active shifts for mix service:', shErr?.message);
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
    console.error('No available future slot for mix service (via shifts):', slotErr?.message);
    process.exit(1);
  }

  const slot = slots[0];
  console.log('Using slot:', slot.id, slot.slot_date, slot.start_time, '-', slot.end_time, 'emp=', slot.employee_id || '—');

  const stamp = Date.now();
  const { data: rpcRaw, error: rpcErr } = await supabase.rpc('create_booking_with_lock', {
    p_slot_id: slot.id,
    p_service_id: serviceId,
    p_tenant_id: tenantId,
    p_customer_name: `Daftra E2E ${stamp}`,
    p_customer_phone: '+966501112233',
    p_customer_email: `daftra-e2e-${stamp}@bookati.test`,
    p_visitor_count: 1,
    p_adult_count: 1,
    p_child_count: 0,
    p_total_price: totalPrice,
    p_notes: 'admin-booking-daftra-invoice.ts',
    p_employee_id: slot.employee_id || null,
    p_lock_id: null,
    p_session_id: user.id,
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
    console.error('Could not parse booking id from RPC:', JSON.stringify(rpcRaw).slice(0, 500));
    process.exit(1);
  }

  console.log('Booking created:', bookingId);

  await supabase
    .from('bookings')
    .update({
      payment_status: 'paid_manual',
      payment_method: 'onsite',
      tag_id: tagId,
      applied_tag_fee: tagFee,
      invoice_processing_status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId);

  console.log('Calling invoiceRoutingService.generateReceipt (expect Daftra)...');
  const inv = await invoiceRoutingService.generateReceipt(bookingId);

  const { data: row } = await supabase
    .from('bookings')
    .select('daftra_invoice_id, zoho_invoice_id, payment_status, total_price')
    .eq('id', bookingId)
    .maybeSingle();

  console.log('\n--- Result ---');
  console.log('generateReceipt:', JSON.stringify(inv, null, 2));
  console.log('bookings.daftra_invoice_id:', row?.daftra_invoice_id ?? '(null)');
  console.log('bookings.zoho_invoice_id:', row?.zoho_invoice_id ?? '(null)');

  if (!inv.success || !inv.invoiceId) {
    console.error('Invoice step failed');
    process.exit(1);
  }
  if (!row?.daftra_invoice_id || String(row.daftra_invoice_id) !== String(inv.invoiceId)) {
    console.error('Expected daftra_invoice_id to match invoice id');
    process.exit(1);
  }
  console.log('\nOK: Invoice', inv.invoiceId, 'is stored as daftra_invoice_id (Daftra).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
