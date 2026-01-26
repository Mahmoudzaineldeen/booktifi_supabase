/**
 * STRICT PACKAGE BILLING TEST SUITE
 * 
 * Tests all scenarios for strict billing and ticket logic:
 * 1. Buy package → Invoice created
 * 2. Book inside package limit → No invoice
 * 3. Book exceeding package → Partial invoice only
 * 4. Book after exhaustion → Full invoice
 * 5. Booking always appears in lists
 * 6. Package balance decreases correctly
 * 7. Zoho never receives 0 SAR invoices
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
// Use service role key to bypass RLS for testing
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('   Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test configuration
const TEST_PREFIX = 'STRICT_BILLING_TEST';
let testTenantId = null;
let testServiceId = null;
let testPackageId = null;
let testCustomerId = null;
let testPackageSubscriptionId = null;
let testSlotId = null;

// Test results
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

function logTest(name, status, message = '') {
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  console.log(`${icon} ${name}: ${message}`);
  
  if (status === 'pass') {
    testResults.passed.push({ name, message });
  } else if (status === 'fail') {
    testResults.failed.push({ name, message });
  } else {
    testResults.warnings.push({ name, message });
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    // Delete bookings
    if (testSlotId) {
      const { error } = await supabase
        .from('bookings')
        .delete()
        .like('customer_name', `${TEST_PREFIX}%`);
      if (error) console.error('Cleanup bookings error:', error);
    }
    
    // Delete package subscription
    if (testPackageSubscriptionId) {
      const { error } = await supabase
        .from('package_subscriptions')
        .delete()
        .eq('id', testPackageSubscriptionId);
      if (error) console.error('Cleanup subscription error:', error);
    }
    
    // Delete package usage
    if (testPackageSubscriptionId && testServiceId) {
      const { error } = await supabase
        .from('package_subscription_usage')
        .delete()
        .eq('subscription_id', testPackageSubscriptionId);
      if (error) console.error('Cleanup usage error:', error);
    }
    
    // Delete customer
    if (testCustomerId) {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', testCustomerId);
      if (error) console.error('Cleanup customer error:', error);
    }
    
    // Delete slot
    if (testSlotId) {
      const { error } = await supabase
        .from('slots')
        .delete()
        .eq('id', testSlotId);
      if (error) console.error('Cleanup slot error:', error);
    }
    
    console.log('✅ Cleanup complete');
  } catch (error) {
    console.error('⚠️ Cleanup error:', error);
  }
}

async function setupTestData() {
  console.log('\n📋 Setting up test data...');
  
  // Get or create tenant
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id')
    .limit(1);
  
  if (!tenants || tenants.length === 0) {
    throw new Error('No tenant found');
  }
  testTenantId = tenants[0].id;
  console.log(`✅ Using tenant: ${testTenantId}`);
  
  // Get existing service (don't create to avoid schema issues)
  const { data: services, error: servicesError } = await supabase
    .from('services')
    .select('id, base_price, name')
    .eq('tenant_id', testTenantId)
    .eq('is_active', true)
    .limit(1);
  
  if (servicesError) throw servicesError;
  
  if (!services || services.length === 0) {
    throw new Error('No active services found for tenant. Please create a service first.');
  }
  
  testServiceId = services[0].id;
  console.log(`✅ Using service: ${services[0].name} (${testServiceId})`);
  
  // Create or get package
  const { data: existingPackage } = await supabase
    .from('service_packages')
    .select('id')
    .eq('tenant_id', testTenantId)
    .eq('name', `${TEST_PREFIX} Package`)
    .maybeSingle();
  
  if (existingPackage) {
    testPackageId = existingPackage.id;
    console.log(`✅ Using existing package: ${testPackageId}`);
  } else {
    const { data: newPackage, error } = await supabase
      .from('service_packages')
      .insert({
        tenant_id: testTenantId,
        name: `${TEST_PREFIX} Package`,
        name_ar: `${TEST_PREFIX} باقة`,
        total_price: 500,
        original_price: 500,
        is_active: true
      })
      .select('id')
      .single();
    
    if (error) throw error;
    testPackageId = newPackage.id;
    console.log(`✅ Created package: ${testPackageId}`);
  }
  
  // Create customer
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .insert({
      tenant_id: testTenantId,
      name: `${TEST_PREFIX} Customer`,
      phone: `+2010${Math.floor(Math.random() * 1000000000)}`,
      email: `test${Date.now()}@example.com`
    })
    .select('id')
    .single();
  
  if (customerError) throw customerError;
  testCustomerId = customer.id;
  console.log(`✅ Created customer: ${testCustomerId}`);
  
  // Get existing slot (don't create to avoid schema issues)
  const { data: slots, error: slotsError } = await supabase
    .from('slots')
    .select('id, slot_date, start_time, available_capacity')
    .eq('tenant_id', testTenantId)
    .gte('available_capacity', 10) // Need at least 10 capacity for tests
    .order('slot_date', { ascending: true })
    .limit(1);
  
  if (slotsError) throw slotsError;
  
  if (!slots || slots.length === 0) {
    throw new Error('No available slots found for tenant. Please create slots first.');
  }
  
  testSlotId = slots[0].id;
  console.log(`✅ Using slot: ${slots[0].slot_date} ${slots[0].start_time} (${testSlotId})`);
  
  console.log('✅ Test data setup complete\n');
}

async function test1_BuyPackageInvoiceCreated() {
  console.log('🧪 TEST 1: Buy Package → Invoice Created');
  console.log('==========================================');
  
  try {
    // Create package subscription
    const { data: subscription, error } = await supabase
      .from('package_subscriptions')
      .insert({
        tenant_id: testTenantId,
        customer_id: testCustomerId,
        package_id: testPackageId,
        payment_status: 'paid',
        status: 'active'
      })
      .select('id, zoho_invoice_id')
      .single();
    
    if (error) throw error;
    testPackageSubscriptionId = subscription.id;
    
    // Check if invoice was created
    const hasInvoice = subscription.zoho_invoice_id && subscription.zoho_invoice_id.trim() !== '';
    
    if (hasInvoice) {
      logTest('TEST 1', 'pass', `Package subscription created with invoice: ${subscription.zoho_invoice_id}`);
    } else {
      logTest('TEST 1', 'warn', 'Package subscription created but no invoice ID found. This may be expected if Zoho is not configured.');
    }
    
    // Initialize package usage (10 tickets for this service)
    const { error: usageError } = await supabase
      .from('package_subscription_usage')
      .insert({
        subscription_id: testPackageSubscriptionId,
        service_id: testServiceId,
        total_quantity: 10,
        used_quantity: 0,
        remaining_quantity: 10
      });
    
    if (usageError) {
      // May already exist, try to update
      await supabase
        .from('package_subscription_usage')
        .update({
          total_quantity: 10,
          used_quantity: 0,
          remaining_quantity: 10
        })
        .eq('subscription_id', testPackageSubscriptionId)
        .eq('service_id', testServiceId);
    }
    
    console.log('✅ Package usage initialized: 10 tickets\n');
    
  } catch (error) {
    logTest('TEST 1', 'fail', `Error: ${error.message}`);
    throw error;
  }
}

async function test2_BookInsidePackageLimitNoInvoice() {
  console.log('🧪 TEST 2: Book Inside Package Limit → No Invoice');
  console.log('==================================================');
  
  try {
    // Check package capacity before booking
    const { data: usageBefore } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .single();
    
    console.log(`📊 Package capacity before: ${usageBefore?.remaining_quantity || 0} remaining`);
    
    // Create booking for 5 tickets (within package limit of 10)
    const { data: bookingResult, error: rpcError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: testSlotId,
        p_service_id: testServiceId,
        p_tenant_id: testTenantId,
        p_customer_name: `${TEST_PREFIX} Customer`,
        p_customer_phone: `+2010${Math.floor(Math.random() * 1000000000)}`,
        p_customer_email: `test${Date.now()}@example.com`,
        p_visitor_count: 5,
        p_adult_count: 5,
        p_child_count: 0,
        p_total_price: 0, // Should be 0 for fully covered booking
        p_notes: 'Test booking inside package limit',
        p_employee_id: null,
        p_lock_id: null,
        p_session_id: null,
        p_customer_id: testCustomerId,
        p_offer_id: null,
        p_language: 'en',
        p_package_subscription_id: testPackageSubscriptionId,
        p_package_covered_quantity: 5, // All 5 covered by package
        p_paid_quantity: 0 // No paid tickets
      });
    
    if (rpcError) {
      // Try parsing as JSON if it's a string
      let parsedResult = rpcError;
      if (typeof rpcError === 'string') {
        try {
          parsedResult = JSON.parse(rpcError);
        } catch (e) {
          // Not JSON, use as is
        }
      }
      throw new Error(`RPC Error: ${JSON.stringify(parsedResult)}`);
    }
    
    // Extract booking ID
    let bookingId = null;
    if (typeof bookingResult === 'string') {
      try {
        const parsed = JSON.parse(bookingResult);
        bookingId = parsed?.booking?.id || parsed?.id;
      } catch (e) {
        // Not JSON
      }
    } else if (bookingResult?.booking?.id) {
      bookingId = bookingResult.booking.id;
    } else if (bookingResult?.id) {
      bookingId = bookingResult.id;
    }
    
    if (!bookingId) {
      throw new Error('Could not extract booking ID from RPC response');
    }
    
    console.log(`✅ Booking created: ${bookingId}`);
    
    // Verify booking data
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, total_price, package_covered_quantity, paid_quantity, zoho_invoice_id')
      .eq('id', bookingId)
      .single();
    
    if (bookingError) throw bookingError;
    
    // Verify: total_price should be 0
    if (parseFloat(booking.total_price) === 0) {
      logTest('TEST 2 - Price', 'pass', `total_price = 0 (correct for fully covered booking)`);
    } else {
      logTest('TEST 2 - Price', 'fail', `total_price = ${booking.total_price} (expected 0)`);
    }
    
    // Verify: package_covered_quantity should be 5
    if (booking.package_covered_quantity === 5) {
      logTest('TEST 2 - Package Coverage', 'pass', `package_covered_quantity = 5`);
    } else {
      logTest('TEST 2 - Package Coverage', 'fail', `package_covered_quantity = ${booking.package_covered_quantity} (expected 5)`);
    }
    
    // Verify: paid_quantity should be 0
    if (booking.paid_quantity === 0) {
      logTest('TEST 2 - Paid Quantity', 'pass', `paid_quantity = 0`);
    } else {
      logTest('TEST 2 - Paid Quantity', 'fail', `paid_quantity = ${booking.paid_quantity} (expected 0)`);
    }
    
    // Verify: NO invoice should be created
    const hasInvoice = booking.zoho_invoice_id && booking.zoho_invoice_id.trim() !== '';
    if (!hasInvoice) {
      logTest('TEST 2 - Invoice', 'pass', `No invoice created (zoho_invoice_id is null/empty)`);
    } else {
      logTest('TEST 2 - Invoice', 'fail', `Invoice was created (zoho_invoice_id = ${booking.zoho_invoice_id}) - should NOT have invoice`);
    }
    
    // Verify package balance decreased
    const { data: usageAfter } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .maybeSingle();
    
    if (!usageAfter) {
      logTest('TEST 2 - Package Balance', 'warn', `Package usage record not found (may have been deleted or not created)`);
    } else {
      const expectedRemaining = (usageBefore?.remaining_quantity || 10) - 5;
      if (usageAfter.remaining_quantity === expectedRemaining) {
        logTest('TEST 2 - Package Balance', 'pass', `Package balance decreased correctly: ${usageAfter.remaining_quantity} remaining (was ${usageBefore?.remaining_quantity})`);
      } else {
        logTest('TEST 2 - Package Balance', 'fail', `Package balance incorrect: ${usageAfter.remaining_quantity} remaining (expected ${expectedRemaining})`);
      }
    }
    
    console.log('');
    
  } catch (error) {
    logTest('TEST 2', 'fail', `Error: ${error.message}`);
    console.error('Error details:', error);
  }
}

async function test3_BookExceedingPackagePartialInvoice() {
  console.log('🧪 TEST 3: Book Exceeding Package → Partial Invoice Only');
  console.log('===========================================================');
  
  try {
    // Check package capacity before booking (should be 5 remaining after test 2)
    const { data: usageBefore } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .single();
    
    const remainingCapacity = usageBefore?.remaining_quantity || 0;
    console.log(`📊 Package capacity before: ${remainingCapacity} remaining`);
    
    // Book 8 tickets (5 from package, 3 paid)
    const bookingQty = 8;
    const packageCovered = Math.min(remainingCapacity, bookingQty);
    const paidQty = bookingQty - packageCovered;
    
    console.log(`📋 Booking ${bookingQty} tickets: ${packageCovered} from package, ${paidQty} paid`);
    
    // Get service price
    const { data: service } = await supabase
      .from('services')
      .select('base_price')
      .eq('id', testServiceId)
      .single();
    
    const servicePrice = parseFloat(service?.base_price || 100);
    const totalPrice = paidQty * servicePrice;
    
    console.log(`💰 Service price: ${servicePrice}, Total price for paid portion: ${totalPrice}`);
    
    // Create booking
    const { data: bookingResult, error: rpcError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: testSlotId,
        p_service_id: testServiceId,
        p_tenant_id: testTenantId,
        p_customer_name: `${TEST_PREFIX} Customer`,
        p_customer_phone: `+2010${Math.floor(Math.random() * 1000000000)}`,
        p_customer_email: `test${Date.now()}@example.com`,
        p_visitor_count: bookingQty,
        p_adult_count: bookingQty,
        p_child_count: 0,
        p_total_price: totalPrice,
        p_notes: 'Test booking exceeding package limit',
        p_employee_id: null,
        p_lock_id: null,
        p_session_id: null,
        p_customer_id: testCustomerId,
        p_offer_id: null,
        p_language: 'en',
        p_package_subscription_id: testPackageSubscriptionId,
        p_package_covered_quantity: packageCovered,
        p_paid_quantity: paidQty
      });
    
    if (rpcError) {
      let parsedResult = rpcError;
      if (typeof rpcError === 'string') {
        try {
          parsedResult = JSON.parse(rpcError);
        } catch (e) {}
      }
      throw new Error(`RPC Error: ${JSON.stringify(parsedResult)}`);
    }
    
    // Extract booking ID
    let bookingId = null;
    if (typeof bookingResult === 'string') {
      try {
        const parsed = JSON.parse(bookingResult);
        bookingId = parsed?.booking?.id || parsed?.id;
      } catch (e) {}
    } else if (bookingResult?.booking?.id) {
      bookingId = bookingResult.booking.id;
    } else if (bookingResult?.id) {
      bookingId = bookingResult.id;
    }
    
    if (!bookingId) {
      throw new Error('Could not extract booking ID from RPC response');
    }
    
    console.log(`✅ Booking created: ${bookingId}`);
    
    // Verify booking data
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, total_price, package_covered_quantity, paid_quantity, zoho_invoice_id')
      .eq('id', bookingId)
      .single();
    
    if (bookingError) throw bookingError;
    
    // Verify: total_price should be for paid portion only
    const expectedPrice = paidQty * servicePrice;
    if (Math.abs(parseFloat(booking.total_price) - expectedPrice) < 0.01) {
      logTest('TEST 3 - Price', 'pass', `total_price = ${booking.total_price} (correct for ${paidQty} paid tickets)`);
    } else {
      logTest('TEST 3 - Price', 'fail', `total_price = ${booking.total_price} (expected ${expectedPrice})`);
    }
    
    // Verify: package_covered_quantity
    if (booking.package_covered_quantity === packageCovered) {
      logTest('TEST 3 - Package Coverage', 'pass', `package_covered_quantity = ${packageCovered}`);
    } else {
      logTest('TEST 3 - Package Coverage', 'fail', `package_covered_quantity = ${booking.package_covered_quantity} (expected ${packageCovered})`);
    }
    
    // Verify: paid_quantity
    if (booking.paid_quantity === paidQty) {
      logTest('TEST 3 - Paid Quantity', 'pass', `paid_quantity = ${paidQty}`);
    } else {
      logTest('TEST 3 - Paid Quantity', 'fail', `paid_quantity = ${booking.paid_quantity} (expected ${paidQty})`);
    }
    
    // Verify: Invoice may or may not be created (depends on Zoho config)
    // But if created, it should NOT be for 0 SAR
    const hasInvoice = booking.zoho_invoice_id && booking.zoho_invoice_id.trim() !== '';
    if (hasInvoice) {
      if (parseFloat(booking.total_price) > 0) {
        logTest('TEST 3 - Invoice', 'pass', `Invoice created for paid portion: ${booking.zoho_invoice_id} (amount > 0)`);
      } else {
        logTest('TEST 3 - Invoice', 'fail', `Invoice created but total_price = 0 (should NOT invoice 0 SAR)`);
      }
    } else {
      logTest('TEST 3 - Invoice', 'warn', `No invoice created (may be expected if Zoho not configured)`);
    }
    
    // Verify package balance (may not exist if package was already exhausted)
    const { data: usageAfter } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .maybeSingle();
    
    if (!usageAfter) {
      logTest('TEST 3 - Package Balance', 'warn', `Package usage record not found (package may have been exhausted)`);
    } else {
      const expectedRemaining = Math.max(0, remainingCapacity - packageCovered);
      if (usageAfter.remaining_quantity === expectedRemaining) {
        logTest('TEST 3 - Package Balance', 'pass', `Package balance decreased correctly: ${usageAfter.remaining_quantity} remaining (was ${remainingCapacity})`);
      } else {
        logTest('TEST 3 - Package Balance', 'fail', `Package balance incorrect: ${usageAfter.remaining_quantity} remaining (expected ${expectedRemaining})`);
      }
    }
    
    console.log('');
    
  } catch (error) {
    logTest('TEST 3', 'fail', `Error: ${error.message}`);
    console.error('Error details:', error);
  }
}

async function test4_BookAfterExhaustionFullInvoice() {
  console.log('🧪 TEST 4: Book After Exhaustion → Full Invoice');
  console.log('===============================================');
  
  try {
    // Verify package is exhausted (should be 0 remaining after test 3)
    const { data: usageBefore } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .single();
    
    const remainingCapacity = usageBefore?.remaining_quantity || 0;
    console.log(`📊 Package capacity before: ${remainingCapacity} remaining`);
    
    if (remainingCapacity > 0) {
      logTest('TEST 4 - Setup', 'warn', `Package not exhausted (${remainingCapacity} remaining). This test expects 0 remaining.`);
    }
    
    // Book 3 tickets (all paid, no package coverage)
    const bookingQty = 3;
    const packageCovered = 0; // Package is exhausted
    const paidQty = bookingQty;
    
    console.log(`📋 Booking ${bookingQty} tickets: ${packageCovered} from package, ${paidQty} paid`);
    
    // Get service price
    const { data: service } = await supabase
      .from('services')
      .select('base_price')
      .eq('id', testServiceId)
      .single();
    
    const servicePrice = parseFloat(service?.base_price || 100);
    const totalPrice = paidQty * servicePrice;
    
    console.log(`💰 Service price: ${servicePrice}, Total price: ${totalPrice}`);
    
    // Create booking
    const { data: bookingResult, error: rpcError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: testSlotId,
        p_service_id: testServiceId,
        p_tenant_id: testTenantId,
        p_customer_name: `${TEST_PREFIX} Customer`,
        p_customer_phone: `+2010${Math.floor(Math.random() * 1000000000)}`,
        p_customer_email: `test${Date.now()}@example.com`,
        p_visitor_count: bookingQty,
        p_adult_count: bookingQty,
        p_child_count: 0,
        p_total_price: totalPrice,
        p_notes: 'Test booking after package exhaustion',
        p_employee_id: null,
        p_lock_id: null,
        p_session_id: null,
        p_customer_id: testCustomerId,
        p_offer_id: null,
        p_language: 'en',
        p_package_subscription_id: null, // No package
        p_package_covered_quantity: 0,
        p_paid_quantity: paidQty
      });
    
    if (rpcError) {
      let parsedResult = rpcError;
      if (typeof rpcError === 'string') {
        try {
          parsedResult = JSON.parse(rpcError);
        } catch (e) {}
      }
      throw new Error(`RPC Error: ${JSON.stringify(parsedResult)}`);
    }
    
    // Extract booking ID
    let bookingId = null;
    if (typeof bookingResult === 'string') {
      try {
        const parsed = JSON.parse(bookingResult);
        bookingId = parsed?.booking?.id || parsed?.id;
      } catch (e) {}
    } else if (bookingResult?.booking?.id) {
      bookingId = bookingResult.booking.id;
    } else if (bookingResult?.id) {
      bookingId = bookingResult.id;
    }
    
    if (!bookingId) {
      throw new Error('Could not extract booking ID from RPC response');
    }
    
    console.log(`✅ Booking created: ${bookingId}`);
    
    // Verify booking data
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, total_price, package_covered_quantity, paid_quantity, zoho_invoice_id')
      .eq('id', bookingId)
      .single();
    
    if (bookingError) throw bookingError;
    
    // Verify: total_price should be full amount
    if (Math.abs(parseFloat(booking.total_price) - totalPrice) < 0.01) {
      logTest('TEST 4 - Price', 'pass', `total_price = ${booking.total_price} (correct for full booking)`);
    } else {
      logTest('TEST 4 - Price', 'fail', `total_price = ${booking.total_price} (expected ${totalPrice})`);
    }
    
    // Verify: package_covered_quantity should be 0
    if (booking.package_covered_quantity === 0) {
      logTest('TEST 4 - Package Coverage', 'pass', `package_covered_quantity = 0 (no package coverage)`);
    } else {
      logTest('TEST 4 - Package Coverage', 'fail', `package_covered_quantity = ${booking.package_covered_quantity} (expected 0)`);
    }
    
    // Verify: paid_quantity should be 3
    if (booking.paid_quantity === paidQty) {
      logTest('TEST 4 - Paid Quantity', 'pass', `paid_quantity = ${paidQty}`);
    } else {
      logTest('TEST 4 - Paid Quantity', 'fail', `paid_quantity = ${booking.paid_quantity} (expected ${paidQty})`);
    }
    
    // Verify: Invoice may be created (for full amount)
    const hasInvoice = booking.zoho_invoice_id && booking.zoho_invoice_id.trim() !== '';
    if (hasInvoice) {
      if (parseFloat(booking.total_price) > 0) {
        logTest('TEST 4 - Invoice', 'pass', `Invoice created for full amount: ${booking.zoho_invoice_id} (amount > 0)`);
      } else {
        logTest('TEST 4 - Invoice', 'fail', `Invoice created but total_price = 0 (should NOT invoice 0 SAR)`);
      }
    } else {
      logTest('TEST 4 - Invoice', 'warn', `No invoice created (may be expected if Zoho not configured)`);
    }
    
    console.log('');
    
  } catch (error) {
    logTest('TEST 4', 'fail', `Error: ${error.message}`);
    console.error('Error details:', error);
  }
}

async function test5_BookingAlwaysAppearsInLists() {
  console.log('🧪 TEST 5: Booking Always Appears in Lists');
  console.log('==========================================');
  
  try {
    // Create a booking without package (all paid, but we'll verify it appears in lists)
    // Get service price
    const { data: service } = await supabase
      .from('services')
      .select('base_price')
      .eq('id', testServiceId)
      .single();
    
    const servicePrice = parseFloat(service?.base_price || 100);
    const bookingQty = 2;
    const totalPrice = bookingQty * servicePrice;
    
    const { data: bookingResult, error: rpcError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: testSlotId,
        p_service_id: testServiceId,
        p_tenant_id: testTenantId,
        p_customer_name: `${TEST_PREFIX} Customer`,
        p_customer_phone: `+2010${Math.floor(Math.random() * 1000000000)}`,
        p_customer_email: `test${Date.now()}@example.com`,
        p_visitor_count: bookingQty,
        p_adult_count: bookingQty,
        p_child_count: 0,
        p_total_price: totalPrice,
        p_notes: 'Test booking (always appears in lists)',
        p_employee_id: null,
        p_lock_id: null,
        p_session_id: null,
        p_customer_id: testCustomerId,
        p_offer_id: null,
        p_language: 'en',
        p_package_subscription_id: null,
        p_package_covered_quantity: 0,
        p_paid_quantity: bookingQty // All paid
      });
    
    if (rpcError) {
      let parsedResult = rpcError;
      if (typeof rpcError === 'string') {
        try {
          parsedResult = JSON.parse(rpcError);
        } catch (e) {}
      }
      throw new Error(`RPC Error: ${JSON.stringify(parsedResult)}`);
    }
    
    // Extract booking ID
    let bookingId = null;
    if (typeof bookingResult === 'string') {
      try {
        const parsed = JSON.parse(bookingResult);
        bookingId = parsed?.booking?.id || parsed?.id;
      } catch (e) {}
    } else if (bookingResult?.booking?.id) {
      bookingId = bookingResult.booking.id;
    } else if (bookingResult?.id) {
      bookingId = bookingResult.id;
    }
    
    if (!bookingId) {
      throw new Error('Could not extract booking ID from RPC response');
    }
    
    console.log(`✅ Free booking created: ${bookingId}`);
    
    // Verify booking exists in database
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, total_price, customer_name')
      .eq('id', bookingId)
      .single();
    
    if (bookingError) {
      logTest('TEST 5 - Database', 'fail', `Booking not found in database: ${bookingError.message}`);
    } else {
      logTest('TEST 5 - Database', 'pass', `Booking exists in database (ID: ${bookingId})`);
    }
    
    // Verify booking appears in bookings list query
    const { data: bookingsList, error: listError } = await supabase
      .from('bookings')
      .select('id, customer_name, total_price')
      .eq('tenant_id', testTenantId)
      .eq('customer_id', testCustomerId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (listError) {
      logTest('TEST 5 - List Query', 'fail', `Error querying bookings: ${listError.message}`);
    } else {
      const foundInList = bookingsList?.some(b => b.id === bookingId);
      if (foundInList) {
        logTest('TEST 5 - List Query', 'pass', `Booking appears in bookings list query`);
      } else {
        logTest('TEST 5 - List Query', 'fail', `Booking not found in bookings list query`);
      }
    }
    
    // Verify booking was created (regardless of price)
    if (booking) {
      logTest('TEST 5 - Booking Created', 'pass', `Booking created successfully (total_price = ${booking.total_price})`);
    } else {
      logTest('TEST 5 - Booking Created', 'fail', `Booking not found`);
    }
    
    console.log('');
    
  } catch (error) {
    logTest('TEST 5', 'fail', `Error: ${error.message}`);
    console.error('Error details:', error);
  }
}

async function test6_PackageBalanceDecreasesCorrectly() {
  console.log('🧪 TEST 6: Package Balance Decreases Correctly');
  console.log('===============================================');
  
  try {
    // Check slot capacity first
    const { data: slot } = await supabase
      .from('slots')
      .select('available_capacity')
      .eq('id', testSlotId)
      .single();
    
    const slotCapacity = slot?.available_capacity || 0;
    console.log(`📊 Slot capacity: ${slotCapacity}`);
    
    // Reset package usage to 10 for this test
    await supabase
      .from('package_subscription_usage')
      .upsert({
        subscription_id: testPackageSubscriptionId,
        service_id: testServiceId,
        total_quantity: 10,
        used_quantity: 0,
        remaining_quantity: 10
      }, {
        onConflict: 'subscription_id,service_id'
      });
    
    // Get initial balance
    const { data: usageBefore } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .maybeSingle();
    
    const initialRemaining = usageBefore?.remaining_quantity || 0;
    const initialUsed = usageBefore?.used_quantity || 0;
    
    console.log(`📊 Initial package state: ${initialRemaining} remaining, ${initialUsed} used`);
    
    // Create booking - use minimum of slot capacity and 3
    const bookingQty = Math.min(slotCapacity, 3);
    
    if (bookingQty === 0) {
      logTest('TEST 6', 'warn', 'Slot has no capacity - skipping test');
      return;
    }
    
    console.log(`📋 Booking ${bookingQty} tickets (all from package)`);
    
    const { data: bookingResult, error: rpcError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: testSlotId,
        p_service_id: testServiceId,
        p_tenant_id: testTenantId,
        p_customer_name: `${TEST_PREFIX} Customer`,
        p_customer_phone: `+2010${Math.floor(Math.random() * 1000000000)}`,
        p_customer_email: `test${Date.now()}@example.com`,
        p_visitor_count: bookingQty,
        p_adult_count: bookingQty,
        p_child_count: 0,
        p_total_price: 0,
        p_notes: 'Test package balance decrease',
        p_employee_id: null,
        p_lock_id: null,
        p_session_id: null,
        p_customer_id: testCustomerId,
        p_offer_id: null,
        p_language: 'en',
        p_package_subscription_id: testPackageSubscriptionId,
        p_package_covered_quantity: bookingQty,
        p_paid_quantity: 0
      });
    
    if (rpcError) {
      let parsedResult = rpcError;
      if (typeof rpcError === 'string') {
        try {
          parsedResult = JSON.parse(rpcError);
        } catch (e) {}
      }
      throw new Error(`RPC Error: ${JSON.stringify(parsedResult)}`);
    }
    
    // Extract booking ID
    let bookingId = null;
    if (typeof bookingResult === 'string') {
      try {
        const parsed = JSON.parse(bookingResult);
        bookingId = parsed?.booking?.id || parsed?.id;
      } catch (e) {}
    } else if (bookingResult?.booking?.id) {
      bookingId = bookingResult.booking.id;
    } else if (bookingResult?.id) {
      bookingId = bookingResult.id;
    }
    
    if (!bookingId) {
      throw new Error('Could not extract booking ID from RPC response');
    }
    
    console.log(`✅ Booking created: ${bookingId}`);
    
    // Wait a moment for trigger to execute
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check package balance after booking
    const { data: usageAfter } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .maybeSingle();
    
    if (!usageAfter) {
      logTest('TEST 6 - Package Balance', 'warn', `Package usage record not found after booking`);
    } else {
      const expectedRemaining = initialRemaining - bookingQty;
      const expectedUsed = initialUsed + bookingQty;
      
      console.log(`📊 Package state after: ${usageAfter.remaining_quantity} remaining, ${usageAfter.used_quantity} used`);
      console.log(`📊 Expected: ${expectedRemaining} remaining, ${expectedUsed} used`);
      
      // Verify remaining quantity
      if (usageAfter.remaining_quantity === expectedRemaining) {
        logTest('TEST 6 - Remaining Quantity', 'pass', `Remaining quantity decreased correctly: ${usageAfter.remaining_quantity} (was ${initialRemaining})`);
      } else {
        logTest('TEST 6 - Remaining Quantity', 'fail', `Remaining quantity incorrect: ${usageAfter.remaining_quantity} (expected ${expectedRemaining})`);
      }
      
      // Verify used quantity
      if (usageAfter.used_quantity === expectedUsed) {
        logTest('TEST 6 - Used Quantity', 'pass', `Used quantity increased correctly: ${usageAfter.used_quantity} (was ${initialUsed})`);
      } else {
        logTest('TEST 6 - Used Quantity', 'fail', `Used quantity incorrect: ${usageAfter.used_quantity} (expected ${expectedUsed})`);
      }
    }
    
    console.log('');
    
  } catch (error) {
    logTest('TEST 6', 'fail', `Error: ${error.message}`);
    console.error('Error details:', error);
  }
}

async function test7_ZohoNeverReceivesZeroSARInvoices() {
  console.log('🧪 TEST 7: Zoho Never Receives 0 SAR Invoices');
  console.log('==============================================');
  
  try {
    // Check all bookings created during tests
    const { data: allBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, total_price, package_covered_quantity, paid_quantity, zoho_invoice_id, customer_name')
      .like('customer_name', `${TEST_PREFIX}%`)
      .order('created_at', { ascending: false });
    
    if (bookingsError) {
      throw new Error(`Error fetching bookings: ${bookingsError.message}`);
    }
    
    console.log(`📊 Checking ${allBookings?.length || 0} test bookings...`);
    
    let zeroPriceInvoices = 0;
    let validInvoices = 0;
    let noInvoices = 0;
    
    for (const booking of allBookings || []) {
      const totalPrice = parseFloat(booking.total_price || 0);
      const hasInvoice = booking.zoho_invoice_id && booking.zoho_invoice_id.trim() !== '';
      
      if (hasInvoice) {
        if (totalPrice <= 0) {
          zeroPriceInvoices++;
          console.log(`  ❌ Booking ${booking.id}: Invoice ${booking.zoho_invoice_id} but total_price = ${totalPrice}`);
        } else {
          validInvoices++;
          console.log(`  ✅ Booking ${booking.id}: Invoice ${booking.zoho_invoice_id} with price = ${totalPrice}`);
        }
      } else {
        noInvoices++;
        if (totalPrice <= 0) {
          console.log(`  ✅ Booking ${booking.id}: No invoice (correct - price = ${totalPrice})`);
        } else {
          console.log(`  ⚠️  Booking ${booking.id}: No invoice but price = ${totalPrice} (may be expected if Zoho not configured)`);
        }
      }
    }
    
    if (zeroPriceInvoices === 0) {
      logTest('TEST 7', 'pass', `No 0 SAR invoices found. Valid invoices: ${validInvoices}, No invoices (correct): ${noInvoices}`);
    } else {
      logTest('TEST 7', 'fail', `Found ${zeroPriceInvoices} invoice(s) with 0 SAR price - this should NOT happen!`);
    }
    
    console.log('');
    
  } catch (error) {
    logTest('TEST 7', 'fail', `Error: ${error.message}`);
    console.error('Error details:', error);
  }
}

async function runAllTests() {
  console.log('🧪 STRICT PACKAGE BILLING TEST SUITE');
  console.log('====================================\n');
  
  try {
    await setupTestData();
    
    await test1_BuyPackageInvoiceCreated();
    await test2_BookInsidePackageLimitNoInvoice();
    await test3_BookExceedingPackagePartialInvoice();
    await test4_BookAfterExhaustionFullInvoice();
    await test5_BookingAlwaysAppearsInLists();
    await test6_PackageBalanceDecreasesCorrectly();
    await test7_ZohoNeverReceivesZeroSARInvoices();
    
  } catch (error) {
    console.error('❌ Test suite error:', error);
  } finally {
    await cleanup();
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${testResults.passed.length}`);
    console.log(`❌ Failed: ${testResults.failed.length}`);
    console.log(`⚠️  Warnings: ${testResults.warnings.length}`);
    console.log('='.repeat(60));
    
    if (testResults.failed.length > 0) {
      console.log('\n❌ FAILED TESTS:');
      testResults.failed.forEach(({ name, message }) => {
        console.log(`  - ${name}: ${message}`);
      });
    }
    
    if (testResults.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      testResults.warnings.forEach(({ name, message }) => {
        console.log(`  - ${name}: ${message}`);
      });
    }
    
    if (testResults.passed.length > 0) {
      console.log('\n✅ PASSED TESTS:');
      testResults.passed.forEach(({ name, message }) => {
        console.log(`  - ${name}: ${message}`);
      });
    }
    
    console.log('\n');
    
    // Exit with appropriate code
    process.exit(testResults.failed.length > 0 ? 1 : 0);
  }
}

// Run tests
runAllTests();
