/**
 * Package Partial Coverage Cap Test
 *
 * Ensures that when a customer has multiple package subscriptions for the same
 * service (e.g. 9 remaining in one sub + 1 in another = 10 total), the backend
 * caps coverage by the chosen subscription's remaining (9), not by the sum (10).
 * So booking 10 visitors → 9 covered, 1 paid, total_price = 1 × base_price,
 * and the chosen subscription is decremented by 9.
 *
 * Run: node tests/test-package-partial-coverage-cap.js
 * With API: API_URL=<url> RECEPTIONIST_EMAIL=... RECEPTIONIST_PASSWORD=... node tests/test-package-partial-coverage-cap.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const API_URL = process.env.API_URL || process.env.VITE_API_URL;
const RECEPTIONIST_EMAIL = process.env.RECEPTIONIST_EMAIL || 'receptionist1@bookati.local';
const RECEPTIONIST_PASSWORD = process.env.RECEPTIONIST_PASSWORD || '111111';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_PREFIX = 'PKG_CAP_TEST_' + Date.now();
let testTenantId = null;
let testServiceId = null;
let serviceBasePrice = 100;
let testSlotId = null;
let testCustomerId = null;
let testCustomerPhone = null;
let subWith9Id = null;
let subWith1Id = null;
let pkgAId = null;
let pkgBId = null;

const results = { passed: [], failed: [] };

function log(name, passed, message = '', details = null) {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${message ? ': ' + message : ''}`);
  if (details) console.log('   ', details);
  if (passed) results.passed.push({ name, message });
  else results.failed.push({ name, message, details });
}

async function setup() {
  console.log('\n📋 Setup: tenant, service, slot, two packages (same service), customer, two subscriptions (9 + 1 remaining)\n');

  const { data: tenants } = await supabase.from('tenants').select('id').limit(1);
  if (!tenants?.length) throw new Error('No tenant found');
  testTenantId = tenants[0].id;

  const { data: services } = await supabase
    .from('services')
    .select('id, base_price')
    .eq('tenant_id', testTenantId)
    .eq('is_active', true)
    .limit(1);
  if (!services?.length) throw new Error('No active service found');
  testServiceId = services[0].id;
  serviceBasePrice = Number(services[0].base_price) || 100;

  const { data: shifts } = await supabase
    .from('shifts')
    .select('id')
    .eq('service_id', testServiceId)
    .eq('is_active', true)
    .limit(1);
  let shiftId = shifts?.[0]?.id;
  if (!shiftId) {
    const { data: newShift, error: se } = await supabase
      .from('shifts')
      .insert({ service_id: testServiceId, start_time: '09:00', end_time: '17:00', days_of_week: [1,2,3,4,5], is_active: true })
      .select('id')
      .single();
    if (se) throw se;
    shiftId = newShift.id;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const slotDate = tomorrow.toISOString().split('T')[0];
  const { data: slots } = await supabase
    .from('slots')
    .select('id')
    .eq('tenant_id', testTenantId)
    .eq('shift_id', shiftId)
    .eq('slot_date', slotDate)
    .gte('available_capacity', 10)
    .limit(1);
  if (!slots?.length) {
    const { data: newSlot, error: slotErr } = await supabase
      .from('slots')
      .insert({
        tenant_id: testTenantId,
        service_id: testServiceId,
        shift_id: shiftId,
        slot_date: slotDate,
        start_time: '10:00:00',
        end_time: '11:00:00',
        original_capacity: 20,
        total_capacity: 20,
        remaining_capacity: 20,
        available_capacity: 20,
        booked_count: 0,
        is_available: true,
      })
      .select('id')
      .single();
    if (slotErr) throw slotErr;
    testSlotId = newSlot.id;
  } else {
    testSlotId = slots[0].id;
  }

  testCustomerPhone = `+2010${String(Math.floor(100000000 + Math.random() * 900000000))}`;
  const { data: newCustomer, error: custErr } = await supabase
    .from('customers')
    .insert({
      tenant_id: testTenantId,
      name: `${TEST_PREFIX} Customer`,
      phone: testCustomerPhone,
      email: `cap-test-${Date.now()}@example.com`,
    })
    .select('id')
    .single();
  if (custErr) throw custErr;
  testCustomerId = newCustomer.id;

  const { data: pkgA, error: pkgAErr } = await supabase
    .from('service_packages')
    .insert({
      tenant_id: testTenantId,
      name: `${TEST_PREFIX} Package A`,
      name_ar: 'باقة أ',
      total_price: 500,
      is_active: true,
    })
    .select('id')
    .single();
  if (pkgAErr) throw pkgAErr;
  pkgAId = pkgA.id;

  const { data: pkgB, error: pkgBErr } = await supabase
    .from('service_packages')
    .insert({
      tenant_id: testTenantId,
      name: `${TEST_PREFIX} Package B`,
      name_ar: 'باقة ب',
      total_price: 100,
      is_active: true,
    })
    .select('id')
    .single();
  if (pkgBErr) throw pkgBErr;
  pkgBId = pkgB.id;

  await supabase.from('package_services').insert([
    { package_id: pkgAId, service_id: testServiceId, capacity_total: 9 },
    { package_id: pkgBId, service_id: testServiceId, capacity_total: 1 },
  ]);

  const { data: subA, error: subAErr } = await supabase
    .from('package_subscriptions')
    .insert({
      tenant_id: testTenantId,
      customer_id: testCustomerId,
      package_id: pkgAId,
      status: 'active',
      is_active: true,
    })
    .select('id')
    .single();
  if (subAErr) throw subAErr;
  subWith9Id = subA.id;

  const { data: subB, error: subBErr } = await supabase
    .from('package_subscriptions')
    .insert({
      tenant_id: testTenantId,
      customer_id: testCustomerId,
      package_id: pkgBId,
      status: 'active',
      is_active: true,
    })
    .select('id')
    .single();
  if (subBErr) throw subBErr;
  subWith1Id = subB.id;

  await supabase.from('package_subscription_usage').upsert(
    [
      { subscription_id: subWith9Id, service_id: testServiceId, original_quantity: 9, remaining_quantity: 9, used_quantity: 0 },
      { subscription_id: subWith1Id, service_id: testServiceId, original_quantity: 1, remaining_quantity: 1, used_quantity: 0 },
    ],
    { onConflict: 'subscription_id,service_id' }
  );

  console.log('   Tenant:', testTenantId);
  console.log('   Service:', testServiceId, 'base_price:', serviceBasePrice);
  console.log('   Slot:', testSlotId);
  console.log('   Customer:', testCustomerId, 'phone:', testCustomerPhone);
  console.log('   Sub A (9 remaining):', subWith9Id);
  console.log('   Sub B (1 remaining):', subWith1Id);
  console.log('');
}

async function test1_ResolveCapacityReturns10() {
  console.log('\n🧪 Test 1: resolveCustomerServiceCapacity returns total 10 (9+1)\n');
  const { data, error } = await supabase.rpc('resolveCustomerServiceCapacity', {
    p_customer_id: testCustomerId,
    p_service_id: testServiceId,
  });
  if (error) {
    log('resolveCustomerServiceCapacity', false, error.message, error);
    return;
  }
  const total = data?.[0]?.total_remaining_capacity ?? 0;
  const status = data?.[0]?.exhaustion_status ?? [];
  const has9 = status.some((s) => s.remaining === 9);
  const has1 = status.some((s) => s.remaining === 1);
  log('Total remaining = 10', total === 10, `got ${total}`);
  log('Exhaustion status has entry with remaining 9', has9);
  log('Exhaustion status has entry with remaining 1', has1);
}

async function test2_ApiCreateBookingCapsByChosenSub() {
  if (!API_URL) {
    console.log('\n⏭️  Test 2 skipped (no API_URL)\n');
    return;
  }
  console.log('\n🧪 Test 2: API POST /bookings/create → backend caps coverage by chosen sub (9 covered, 1 paid)\n');

  let token = null;
  try {
    const loginRes = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: RECEPTIONIST_EMAIL, password: RECEPTIONIST_PASSWORD }),
    });
    const loginData = await loginRes.json().catch(() => ({}));
    token = loginData?.token ?? loginData?.access_token ?? loginData?.session?.access_token;
    if (!token) {
      log('API login', false, 'No token in response', loginData);
      return;
    }
  } catch (e) {
    log('API login', false, e.message);
    return;
  }

  const createRes = await fetch(`${API_URL}/bookings/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      tenant_id: testTenantId,
      service_id: testServiceId,
      slot_id: testSlotId,
      customer_name: `${TEST_PREFIX} Customer`,
      customer_phone: testCustomerPhone,
      customer_email: `cap-test-${Date.now()}@example.com`,
      visitor_count: 10,
      total_price: 0,
      notes: 'Package partial coverage cap test',
    }),
  });

  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    log('POST /bookings/create', false, createRes.status + ' ' + (createData?.error || JSON.stringify(createData)));
    return;
  }

  const bookingId = createData?.id ?? createData?.booking?.id;
  if (!bookingId) {
    log('Booking created', false, 'No booking id in response', createData);
    return;
  }

  const { data: booking, error: fetchErr } = await supabase
    .from('bookings')
    .select('package_covered_quantity, paid_quantity, total_price, visitor_count, package_subscription_id')
    .eq('id', bookingId)
    .single();

  if (fetchErr || !booking) {
    log('Fetch booking', false, fetchErr?.message || 'No row');
    return;
  }

  const expectedCovered = 9;
  const expectedPaid = 1;
  const expectedPrice = expectedPaid * serviceBasePrice;

  log(
    'package_covered_quantity = 9',
    booking.package_covered_quantity === expectedCovered,
    `got ${booking.package_covered_quantity}`,
  );
  log(
    'paid_quantity = 1',
    booking.paid_quantity === expectedPaid,
    `got ${booking.paid_quantity}`,
  );
  const actualPrice = parseFloat(String(booking.total_price ?? 0));
  log(
    'total_price = 1 × base_price',
    Math.abs(actualPrice - expectedPrice) < 0.01,
    `expected ${expectedPrice}, got ${actualPrice}`,
  );
  log(
    'package_subscription_id is sub with 9',
    booking.package_subscription_id === subWith9Id,
    `expected ${subWith9Id}, got ${booking.package_subscription_id}`,
  );

  const { data: usageAfter } = await supabase
    .from('package_subscription_usage')
    .select('subscription_id, remaining_quantity, used_quantity')
    .eq('service_id', testServiceId)
    .in('subscription_id', [subWith9Id, subWith1Id]);

  const usageSub9 = usageAfter?.find((u) => u.subscription_id === subWith9Id);
  const usageSub1 = usageAfter?.find((u) => u.subscription_id === subWith1Id);
  if (usageSub9) {
    log('Sub A (9) after booking: remaining=0, used=9', usageSub9.remaining_quantity === 0 && usageSub9.used_quantity === 9, `remaining=${usageSub9.remaining_quantity}, used=${usageSub9.used_quantity}`);
  }
  if (usageSub1) {
    log('Sub B (1) unchanged: remaining=1, used=0', usageSub1.remaining_quantity === 1 && usageSub1.used_quantity === 0, `remaining=${usageSub1.remaining_quantity}, used=${usageSub1.used_quantity}`);
  }
}

async function test3_RpcDirectCappedValues() {
  console.log('\n🧪 Test 3: RPC create_booking_with_lock with 9/1 → booking and usage correct\n');

  const customerPhone2 = `+2010${String(Math.floor(100000000 + Math.random() * 900000000))}`;
  const { data: cust2 } = await supabase
    .from('customers')
    .insert({
      tenant_id: testTenantId,
      name: `${TEST_PREFIX} Customer 2`,
      phone: customerPhone2,
      email: `cap-test-2-${Date.now()}@example.com`,
    })
    .select('id')
    .single();

  const subWith9Again = await supabase
    .from('package_subscription_usage')
    .select('remaining_quantity')
    .eq('subscription_id', subWith9Id)
    .eq('service_id', testServiceId)
    .single();

  const remainingBefore = subWith9Again?.data?.remaining_quantity ?? 0;
  if (remainingBefore < 9) {
    await supabase
      .from('package_subscription_usage')
      .upsert(
        { subscription_id: subWith9Id, service_id: testServiceId, original_quantity: 9, remaining_quantity: 9, used_quantity: 0 },
        { onConflict: 'subscription_id,service_id' },
      );
  }

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('create_booking_with_lock', {
    p_slot_id: testSlotId,
    p_service_id: testServiceId,
    p_tenant_id: testTenantId,
    p_customer_name: `${TEST_PREFIX} Customer 2`,
    p_customer_phone: customerPhone2,
    p_customer_email: null,
    p_visitor_count: 10,
    p_adult_count: 10,
    p_child_count: 0,
    p_total_price: serviceBasePrice,
    p_notes: 'Cap test RPC',
    p_employee_id: null,
    p_lock_id: null,
    p_session_id: null,
    p_customer_id: cust2?.id ?? null,
    p_offer_id: null,
    p_language: 'en',
    p_package_subscription_id: subWith9Id,
    p_package_covered_quantity: 9,
    p_paid_quantity: 1,
  });

  if (rpcErr) {
    log('RPC create_booking_with_lock', false, rpcErr.message, rpcErr);
    return;
  }

  const bid = rpcResult?.id ?? rpcResult?.booking?.id;
  if (!bid) {
    log('RPC returned booking id', false, 'No id', rpcResult);
    return;
  }

  const { data: b } = await supabase.from('bookings').select('package_covered_quantity, paid_quantity, total_price').eq('id', bid).single();
  if (b) {
    log('RPC booking package_covered_quantity=9', b.package_covered_quantity === 9);
    log('RPC booking paid_quantity=1', b.paid_quantity === 1);
  }

  const { data: usage } = await supabase
    .from('package_subscription_usage')
    .select('remaining_quantity, used_quantity')
    .eq('subscription_id', subWith9Id)
    .eq('service_id', testServiceId)
    .single();
  if (usage) {
    log('Usage decremented: remaining 0 or used +9', usage.remaining_quantity === 0 || usage.used_quantity >= 9);
  }
}

async function cleanup() {
  console.log('\n🧹 Cleanup test data...\n');
  const subs = [subWith9Id, subWith1Id].filter(Boolean);
  if (subs.length) {
    await supabase.from('package_subscription_usage').delete().in('subscription_id', subs);
    await supabase.from('package_subscriptions').delete().in('id', subs);
  }
  await supabase.from('bookings').delete().like('customer_name', `${TEST_PREFIX}%`);
  if (testTenantId) {
    const { data: testCustomers } = await supabase.from('customers').select('id').like('name', `${TEST_PREFIX}%`);
    if (testCustomers?.length) {
      for (const c of testCustomers) await supabase.from('customers').delete().eq('id', c.id);
    }
  }
  if (pkgAId) await supabase.from('package_services').delete().eq('package_id', pkgAId);
  if (pkgBId) await supabase.from('package_services').delete().eq('package_id', pkgBId);
  if (pkgAId) await supabase.from('service_packages').delete().eq('id', pkgAId);
  if (pkgBId) await supabase.from('service_packages').delete().eq('id', pkgBId);
  console.log('   Done.');
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Package Partial Coverage Cap — 9+1 total, cap by chosen   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  try {
    await setup();
    await test1_ResolveCapacityReturns10();
    await test2_ApiCreateBookingCapsByChosenSub();
    await test3_RpcDirectCappedValues();
  } catch (e) {
    console.error(e);
    results.failed.push({ name: 'Setup or run', message: e.message, details: e.stack });
  } finally {
    await cleanup();
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`   Passed: ${results.passed.length}`);
  console.log(`   Failed: ${results.failed.length}`);
  console.log('══════════════════════════════════════════════════════════════\n');
  process.exit(results.failed.length > 0 ? 1 : 0);
}

run();
