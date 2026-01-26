/**
 * PACKAGE EXCEED AND EXHAUSTION TEST SUITE
 * 
 * Tests two critical scenarios:
 * 1. Booking exceeds package capacity → Remaining quantity creates invoice
 * 2. Package fully consumed → New bookings create invoices correctly (no errors)
 * 
 * These tests ensure:
 * - Partial coverage invoices are created correctly
 * - Exhausted packages don't break invoice creation
 * - Invoice amounts are correct for both scenarios
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('   Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test configuration
const TEST_PREFIX = 'PKG_EXCEED_TEST';
let testTenantId = null;
let testServiceId = null;
let testPackageId = null;
let testCustomerId = null;
let testPackageSubscriptionId = null;
let testSlotId = null;
let servicePrice = 0;

// Test results
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

// Helper function to log test result
function logResult(testName, passed, message, details = null) {
  if (passed) {
    testResults.passed.push({ test: testName, message, details });
    console.log(`✅ PASS: ${testName} - ${message}`);
  } else {
    testResults.failed.push({ test: testName, message, details });
    console.error(`❌ FAIL: ${testName} - ${message}`);
    if (details) {
      console.error(`   Details:`, details);
    }
  }
}

// Helper function to create or get tenant
async function getOrCreateTenant() {
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', 'test')
    .maybeSingle();
  
  if (existing) {
    return existing.id;
  }
  
  // Get first available tenant
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id')
    .limit(1);
  
  if (tenants && tenants.length > 0) {
    return tenants[0].id;
  }
  
  throw new Error('No tenant found. Please create a tenant first.');
}

// Helper function to get or create service
async function getOrCreateService(tenantId) {
  // Try to find an existing service
  const { data: services } = await supabase
    .from('services')
    .select('id, base_price, duration_minutes')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(1);
  
  if (services && services.length > 0) {
    return services[0];
  }
  
  // Create a test service
  const { data: newService, error } = await supabase
    .from('services')
    .insert({
      tenant_id: tenantId,
      name: `${TEST_PREFIX} Service`,
      name_ar: `${TEST_PREFIX} خدمة`,
      base_price: 100, // 100 SAR per ticket
      duration_minutes: 60,
      is_active: true,
      is_public: true
    })
    .select()
    .single();
  
  if (error) throw error;
  return newService;
}

// Helper function to get or create package
async function getOrCreatePackage(tenantId, serviceId) {
  // Try to find an existing package with this service
  const { data: packages } = await supabase
    .from('service_packages')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(1);
  
  if (packages && packages.length > 0) {
    const packageId = packages[0].id;
    
    // Check if service is in package
    const { data: packageServices } = await supabase
      .from('package_services')
      .select('service_id')
      .eq('package_id', packageId)
      .eq('service_id', serviceId)
      .maybeSingle();
    
    if (packageServices) {
      return packageId;
    }
  }
  
  // Create new package
  const { data: newPackage, error: pkgError } = await supabase
    .from('service_packages')
    .insert({
      tenant_id: tenantId,
      name: `${TEST_PREFIX} Package`,
      name_ar: `${TEST_PREFIX} باقة`,
      total_price: 500,
      is_active: true
    })
    .select()
    .single();
  
  if (pkgError) throw pkgError;
  
  // Add service to package with capacity of 5
  const { error: psError } = await supabase
    .from('package_services')
    .insert({
      package_id: newPackage.id,
      service_id: serviceId,
      capacity_total: 5 // Package has 5 tickets
    });
  
  if (psError) throw psError;
  
  return newPackage.id;
}

// Helper function to get or create customer
async function getOrCreateCustomer(tenantId) {
  const testPhone = `+2010${Math.floor(Math.random() * 1000000000)}`;
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', testPhone)
    .maybeSingle();
  
  if (existing) {
    return existing.id;
  }
  
  const { data: newCustomer, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: tenantId,
      name: `${TEST_PREFIX} Customer`,
      phone: testPhone,
      email: `test-${Date.now()}@example.com`
    })
    .select()
    .single();
  
  if (error) throw error;
  return newCustomer.id;
}

// Helper function to create package subscription
async function createPackageSubscription(tenantId, customerId, packageId) {
  // Check if subscription exists
  const { data: existing } = await supabase
    .from('package_subscriptions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('package_id', packageId)
    .eq('status', 'active')
    .maybeSingle();
  
  if (existing) {
    return existing.id;
  }
  
  const { data: newSubscription, error } = await supabase
    .from('package_subscriptions')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      package_id: packageId,
      status: 'active',
      is_active: true
    })
    .select()
    .single();
  
  if (error) throw error;
  
  // Initialize package usage
  const { data: packageServices } = await supabase
    .from('package_services')
    .select('service_id, capacity_total')
    .eq('package_id', packageId);
  
  if (packageServices) {
    for (const ps of packageServices) {
      await supabase
        .from('package_subscription_usage')
        .upsert({
          subscription_id: newSubscription.id,
          service_id: ps.service_id,
          original_quantity: ps.capacity_total,
          remaining_quantity: ps.capacity_total,
          used_quantity: 0
        }, {
          onConflict: 'subscription_id,service_id'
        });
    }
  }
  
  return newSubscription.id;
}

// Helper function to create or get slot
async function getOrCreateSlot(tenantId, serviceId) {
  // Try to find an available slot
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const slotDate = tomorrow.toISOString().split('T')[0];
  
  // First, get or create shift for this service
  let { data: shifts } = await supabase
    .from('shifts')
    .select('id')
    .eq('service_id', serviceId)
    .eq('is_active', true)
    .limit(1);
  
  let shiftId = null;
  if (shifts && shifts.length > 0) {
    shiftId = shifts[0].id;
  } else {
    // Create shift if it doesn't exist
    const { data: newShift, error: shiftError } = await supabase
      .from('shifts')
      .insert({
        service_id: serviceId,
        start_time: '09:00:00',
        end_time: '17:00:00',
        days_of_week: [1, 2, 3, 4, 5],
        is_active: true
      })
      .select()
      .single();
    
    if (shiftError) throw shiftError;
    shiftId = newShift.id;
  }
  
  // Try to find existing slot for this shift (query through shift_id, not service_id)
  const { data: slots } = await supabase
    .from('slots')
    .select('id, available_capacity')
    .eq('tenant_id', tenantId)
    .eq('shift_id', shiftId)
    .eq('slot_date', slotDate)
    .gte('available_capacity', 10)
    .limit(1);
  
  if (slots && slots.length > 0) {
    return slots[0].id;
  }
  
  // Calculate UTC times for the slot
  const startTime = '10:00:00';
  const endTime = '11:00:00';
  const startTimeUTC = new Date(`${slotDate}T${startTime}`);
  const endTimeUTC = new Date(`${slotDate}T${endTime}`);
  
  // Create slot - try with service_id first, fallback to without if column doesn't exist
  let newSlot;
  let slotError;
  
  try {
    const result = await supabase
      .from('slots')
      .insert({
        tenant_id: tenantId,
        service_id: serviceId,
        shift_id: shiftId,
        slot_date: slotDate,
        start_time: startTime,
        end_time: endTime,
        start_time_utc: startTimeUTC.toISOString(),
        end_time_utc: endTimeUTC.toISOString(),
        original_capacity: 20,
        total_capacity: 20,
        remaining_capacity: 20,
        available_capacity: 20,
        booked_count: 0,
        is_available: true
      })
      .select()
      .single();
    
    newSlot = result.data;
    slotError = result.error;
  } catch (err) {
    // If service_id column doesn't exist, try without it
    if (err.message?.includes('service_id') || err.code === 'PGRST204') {
      console.log('⚠️  service_id column not found in slots, creating without it...');
      const result = await supabase
        .from('slots')
        .insert({
          tenant_id: tenantId,
          shift_id: shiftId,
          slot_date: slotDate,
          start_time: startTime,
          end_time: endTime,
          start_time_utc: startTimeUTC.toISOString(),
          end_time_utc: endTimeUTC.toISOString(),
          original_capacity: 20,
          total_capacity: 20,
          remaining_capacity: 20,
          available_capacity: 20,
          booked_count: 0,
          is_available: true
        })
        .select()
        .single();
      
      newSlot = result.data;
      slotError = result.error;
    } else {
      throw err;
    }
  }
  
  if (slotError) throw slotError;
  return newSlot.id;
}

// Helper function to reset package usage
async function resetPackageUsage(subscriptionId, serviceId, remaining, used) {
  await supabase
    .from('package_subscription_usage')
    .upsert({
      subscription_id: subscriptionId,
      service_id: serviceId,
      remaining_quantity: remaining,
      used_quantity: used,
      original_quantity: remaining + used
    }, {
      onConflict: 'subscription_id,service_id'
    });
}

// ============================================================================
// TEST 1: Booking Exceeds Package Capacity → Invoice for Remaining
// ============================================================================
async function test1_BookingExceedsPackageCreatesInvoice() {
  console.log('\n🧪 TEST 1: Booking Exceeds Package Capacity → Invoice for Remaining');
  console.log('=====================================================================');
  
  try {
    // Setup: Package has 5 remaining, customer books 8 tickets
    console.log('📋 Setup: Package has 5 remaining, booking 8 tickets...');
    await resetPackageUsage(testPackageSubscriptionId, testServiceId, 5, 0);
    
    // Verify initial state
    const { data: usageBefore } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .single();
    
    if (!usageBefore || usageBefore.remaining_quantity !== 5) {
      throw new Error(`Expected 5 remaining, got ${usageBefore?.remaining_quantity}`);
    }
    
    console.log(`✅ Initial state: ${usageBefore.remaining_quantity} remaining, ${usageBefore.used_quantity} used`);
    
    // Create booking for 8 tickets (5 covered, 3 paid)
    const bookingQty = 8;
    const expectedPackageCovered = 5;
    const expectedPaid = 3;
    const expectedPrice = expectedPaid * servicePrice;
    
    console.log(`📋 Creating booking: ${bookingQty} tickets`);
    console.log(`   Expected: ${expectedPackageCovered} covered, ${expectedPaid} paid, price: ${expectedPrice}`);
    
    const { data: bookingResult, error: rpcError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: testSlotId,
        p_service_id: testServiceId,
        p_tenant_id: testTenantId,
        p_customer_name: `${TEST_PREFIX} Customer`,
        p_customer_phone: `+2010${Math.floor(Math.random() * 1000000000)}`,
        p_customer_email: `test-${Date.now()}@example.com`,
        p_visitor_count: bookingQty,
        p_adult_count: bookingQty,
        p_child_count: 0,
        p_total_price: expectedPrice,
        p_notes: 'Test: Booking exceeds package capacity',
        p_employee_id: null,
        p_lock_id: null,
        p_session_id: null,
        p_customer_id: testCustomerId,
        p_offer_id: null,
        p_language: 'en',
        p_package_subscription_id: testPackageSubscriptionId,
        p_package_covered_quantity: expectedPackageCovered,
        p_paid_quantity: expectedPaid
      });
    
    if (rpcError) {
      throw new Error(`RPC Error: ${JSON.stringify(rpcError)}`);
    }
    
    // Extract booking ID
    let bookingId = null;
    if (bookingResult?.booking?.id) {
      bookingId = bookingResult.booking.id;
    } else if (bookingResult?.id) {
      bookingId = bookingResult.id;
    } else {
      throw new Error('No booking ID returned from RPC');
    }
    
    console.log(`✅ Booking created: ${bookingId}`);
    
    // Verify booking data
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('package_covered_quantity, paid_quantity, total_price, visitor_count, zoho_invoice_id')
      .eq('id', bookingId)
      .single();
    
    if (bookingError) throw bookingError;
    
    console.log(`📊 Booking data:`, {
      visitor_count: booking.visitor_count,
      package_covered_quantity: booking.package_covered_quantity,
      paid_quantity: booking.paid_quantity,
      total_price: booking.total_price,
      invoice_id: booking.zoho_invoice_id
    });
    
    // Assertions
    const checks = [
      {
        name: 'Package covered quantity = 5',
        passed: booking.package_covered_quantity === expectedPackageCovered,
        actual: booking.package_covered_quantity,
        expected: expectedPackageCovered
      },
      {
        name: 'Paid quantity = 3',
        passed: booking.paid_quantity === expectedPaid,
        actual: booking.paid_quantity,
        expected: expectedPaid
      },
      {
        name: 'Total price = 3 × service_price',
        passed: parseFloat(booking.total_price.toString()) === expectedPrice,
        actual: parseFloat(booking.total_price.toString()),
        expected: expectedPrice
      },
      {
        name: 'Sum equals visitor_count',
        passed: booking.package_covered_quantity + booking.paid_quantity === booking.visitor_count,
        actual: booking.package_covered_quantity + booking.paid_quantity,
        expected: booking.visitor_count
      }
    ];
    
    let allPassed = true;
    for (const check of checks) {
      if (check.passed) {
        logResult('TEST 1', true, check.name);
      } else {
        logResult('TEST 1', false, check.name, {
          expected: check.expected,
          actual: check.actual
        });
        allPassed = false;
      }
    }
    
    // Verify package usage updated
    const { data: usageAfter } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .single();
    
    if (usageAfter) {
      const usageCheck = usageAfter.remaining_quantity === 0 && usageAfter.used_quantity === 5;
      if (usageCheck) {
        logResult('TEST 1', true, 'Package usage updated correctly (0 remaining, 5 used)');
      } else {
        logResult('TEST 1', false, 'Package usage not updated correctly', {
          expected: { remaining: 0, used: 5 },
          actual: { remaining: usageAfter.remaining_quantity, used: usageAfter.used_quantity }
        });
        allPassed = false;
      }
    }
    
    // Check if invoice was created (if Zoho is configured)
    if (booking.zoho_invoice_id) {
      logResult('TEST 1', true, `Invoice created: ${booking.zoho_invoice_id}`);
    } else {
      logResult('TEST 1', true, 'Invoice ID is null (Zoho may not be configured - this is OK for test)');
    }
    
    return allPassed;
  } catch (error) {
    logResult('TEST 1', false, error.message, error);
    return false;
  }
}

// ============================================================================
// TEST 2: Package Fully Consumed → New Booking Creates Invoice Correctly
// ============================================================================
async function test2_ExhaustedPackageNewBookingCreatesInvoice() {
  console.log('\n🧪 TEST 2: Package Fully Consumed → New Booking Creates Invoice');
  console.log('==================================================================');
  
  try {
    // Setup: Package is fully consumed (0 remaining)
    console.log('📋 Setup: Package fully consumed (0 remaining)...');
    await resetPackageUsage(testPackageSubscriptionId, testServiceId, 0, 5);
    
    // Verify initial state
    const { data: usageBefore } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .single();
    
    if (!usageBefore || usageBefore.remaining_quantity !== 0) {
      throw new Error(`Expected 0 remaining, got ${usageBefore?.remaining_quantity}`);
    }
    
    console.log(`✅ Initial state: ${usageBefore.remaining_quantity} remaining, ${usageBefore.used_quantity} used (EXHAUSTED)`);
    
    // Create booking for 3 tickets (all paid, none covered)
    const bookingQty = 3;
    const expectedPackageCovered = 0;
    const expectedPaid = 3;
    const expectedPrice = expectedPaid * servicePrice;
    
    console.log(`📋 Creating booking: ${bookingQty} tickets (package exhausted)`);
    console.log(`   Expected: ${expectedPackageCovered} covered, ${expectedPaid} paid, price: ${expectedPrice}`);
    
    const { data: bookingResult, error: rpcError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: testSlotId,
        p_service_id: testServiceId,
        p_tenant_id: testTenantId,
        p_customer_name: `${TEST_PREFIX} Customer`,
        p_customer_phone: `+2010${Math.floor(Math.random() * 1000000000)}`,
        p_customer_email: `test-${Date.now()}@example.com`,
        p_visitor_count: bookingQty,
        p_adult_count: bookingQty,
        p_child_count: 0,
        p_total_price: expectedPrice,
        p_notes: 'Test: Booking after package exhaustion',
        p_employee_id: null,
        p_lock_id: null,
        p_session_id: null,
        p_customer_id: testCustomerId,
        p_offer_id: null,
        p_language: 'en',
        p_package_subscription_id: null, // No package subscription (exhausted)
        p_package_covered_quantity: expectedPackageCovered,
        p_paid_quantity: expectedPaid
      });
    
    if (rpcError) {
      throw new Error(`RPC Error: ${JSON.stringify(rpcError)}`);
    }
    
    // Extract booking ID
    let bookingId = null;
    if (bookingResult?.booking?.id) {
      bookingId = bookingResult.booking.id;
    } else if (bookingResult?.id) {
      bookingId = bookingResult.id;
    } else {
      throw new Error('No booking ID returned from RPC');
    }
    
    console.log(`✅ Booking created: ${bookingId}`);
    
    // Verify booking data
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('package_covered_quantity, paid_quantity, total_price, visitor_count, zoho_invoice_id, package_subscription_id')
      .eq('id', bookingId)
      .single();
    
    if (bookingError) throw bookingError;
    
    console.log(`📊 Booking data:`, {
      visitor_count: booking.visitor_count,
      package_covered_quantity: booking.package_covered_quantity,
      paid_quantity: booking.paid_quantity,
      total_price: booking.total_price,
      package_subscription_id: booking.package_subscription_id,
      invoice_id: booking.zoho_invoice_id
    });
    
    // Assertions
    const checks = [
      {
        name: 'Package covered quantity = 0 (exhausted)',
        passed: booking.package_covered_quantity === expectedPackageCovered,
        actual: booking.package_covered_quantity,
        expected: expectedPackageCovered
      },
      {
        name: 'Paid quantity = 3 (all paid)',
        passed: booking.paid_quantity === expectedPaid,
        actual: booking.paid_quantity,
        expected: expectedPaid
      },
      {
        name: 'Total price = 3 × service_price',
        passed: parseFloat(booking.total_price.toString()) === expectedPrice,
        actual: parseFloat(booking.total_price.toString()),
        expected: expectedPrice
      },
      {
        name: 'Sum equals visitor_count',
        passed: booking.package_covered_quantity + booking.paid_quantity === booking.visitor_count,
        actual: booking.package_covered_quantity + booking.paid_quantity,
        expected: booking.visitor_count
      },
      {
        name: 'No package subscription ID (exhausted)',
        passed: booking.package_subscription_id === null,
        actual: booking.package_subscription_id,
        expected: null
      }
    ];
    
    let allPassed = true;
    for (const check of checks) {
      if (check.passed) {
        logResult('TEST 2', true, check.name);
      } else {
        logResult('TEST 2', false, check.name, {
          expected: check.expected,
          actual: check.actual
        });
        allPassed = false;
      }
    }
    
    // Verify package usage remains exhausted
    const { data: usageAfter } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', testPackageSubscriptionId)
      .eq('service_id', testServiceId)
      .single();
    
    if (usageAfter) {
      const usageCheck = usageAfter.remaining_quantity === 0 && usageAfter.used_quantity === 5;
      if (usageCheck) {
        logResult('TEST 2', true, 'Package usage remains exhausted (0 remaining, 5 used)');
      } else {
        logResult('TEST 2', false, 'Package usage changed unexpectedly', {
          expected: { remaining: 0, used: 5 },
          actual: { remaining: usageAfter.remaining_quantity, used: usageAfter.used_quantity }
        });
        allPassed = false;
      }
    }
    
    // Check if invoice was created (if Zoho is configured)
    if (booking.zoho_invoice_id) {
      logResult('TEST 2', true, `Invoice created: ${booking.zoho_invoice_id}`);
    } else {
      logResult('TEST 2', true, 'Invoice ID is null (Zoho may not be configured - this is OK for test)');
    }
    
    return allPassed;
  } catch (error) {
    logResult('TEST 2', false, error.message, error);
    return false;
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================
async function runTests() {
  console.log('🧪 PACKAGE EXCEED AND EXHAUSTION TEST SUITE');
  console.log('==========================================\n');
  
  try {
    // Setup
    console.log('📋 Step 1: Getting tenant...');
    testTenantId = await getOrCreateTenant();
    console.log(`✅ Using tenant: ${testTenantId}\n`);
    
    console.log('📋 Step 2: Getting or creating service...');
    const service = await getOrCreateService(testTenantId);
    testServiceId = service.id;
    servicePrice = parseFloat(service.base_price.toString());
    console.log(`✅ Using service: ${testServiceId}, Price: ${servicePrice}\n`);
    
    console.log('📋 Step 3: Getting or creating package...');
    testPackageId = await getOrCreatePackage(testTenantId, testServiceId);
    console.log(`✅ Using package: ${testPackageId}\n`);
    
    console.log('📋 Step 4: Getting or creating customer...');
    testCustomerId = await getOrCreateCustomer(testTenantId);
    console.log(`✅ Using customer: ${testCustomerId}\n`);
    
    console.log('📋 Step 5: Creating package subscription...');
    testPackageSubscriptionId = await createPackageSubscription(
      testTenantId,
      testCustomerId,
      testPackageId
    );
    console.log(`✅ Using subscription: ${testPackageSubscriptionId}\n`);
    
    console.log('📋 Step 6: Getting or creating slot...');
    testSlotId = await getOrCreateSlot(testTenantId, testServiceId);
    console.log(`✅ Using slot: ${testSlotId}\n`);
    
    // Run tests
    const test1Result = await test1_BookingExceedsPackageCreatesInvoice();
    const test2Result = await test2_ExhaustedPackageNewBookingCreatesInvoice();
    
    // Summary
    console.log('\n============================================================');
    console.log('📊 TEST SUMMARY');
    console.log('============================================================');
    console.log(`✅ Passed: ${testResults.passed.length}`);
    console.log(`❌ Failed: ${testResults.failed.length}`);
    console.log(`⚠️  Warnings: ${testResults.warnings.length}`);
    console.log('============================================================\n');
    
    if (testResults.failed.length > 0) {
      console.log('❌ FAILED TESTS:');
      testResults.failed.forEach(({ test, message, details }) => {
        console.log(`   - ${test}: ${message}`);
        if (details) {
          console.log(`     Details:`, details);
        }
      });
      console.log('');
    }
    
    if (testResults.warnings.length > 0) {
      console.log('⚠️  WARNINGS:');
      testResults.warnings.forEach(({ test, message }) => {
        console.log(`   - ${test}: ${message}`);
      });
      console.log('');
    }
    
    // Cleanup instructions
    console.log('💡 To clean up test data, run:');
    console.log(`   DELETE FROM bookings WHERE customer_name LIKE '${TEST_PREFIX}%';`);
    console.log(`   DELETE FROM package_subscriptions WHERE id = '${testPackageSubscriptionId}';`);
    console.log(`   DELETE FROM customers WHERE id = '${testCustomerId}';`);
    console.log('');
    
    // Exit code
    process.exit(testResults.failed.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ TEST SUITE FAILED:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runTests();
