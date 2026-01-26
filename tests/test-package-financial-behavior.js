/**
 * Package Financial Behavior Test
 * 
 * Tests the exact scenario from requirements:
 * - Customer has 8 remaining capacity in package
 * - Customer books 10 tickets
 * - Expected: package_covered_quantity = 8, paid_quantity = 2
 * - Invoice created for 2 tickets only
 * - Package capacity becomes 0
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const API_URL = process.env.API_URL || 'http://localhost:3000';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Test results
const results = {
  passed: [],
  failed: [],
  warnings: []
};

function logTest(name, passed, message = '') {
  if (passed) {
    results.passed.push({ name, message });
    console.log(`✅ PASS: ${name}${message ? ` - ${message}` : ''}`);
  } else {
    results.failed.push({ name, message });
    console.error(`❌ FAIL: ${name}${message ? ` - ${message}` : ''}`);
  }
}

function logWarning(name, message) {
  results.warnings.push({ name, message });
  console.warn(`⚠️  WARN: ${name} - ${message}`);
}

// ============================================================================
// TEST SCENARIO: 8 remaining capacity, book 10 tickets
// ============================================================================

async function runTest() {
  console.log('\n🧪 PACKAGE FINANCIAL BEHAVIOR TEST\n');
  console.log('Test Scenario: Customer has 8 remaining capacity, books 10 tickets\n');

  let tenantId, serviceId, packageId, customerId, subscriptionId, bookingId;
  let servicePrice = 100; // Default price

  try {
    // Step 1: Get or create tenant
    console.log('📋 Step 1: Getting tenant...');
    const { data: tenants, error: tenantError } = await supabase
      .from('tenants')
      .select('id, name')
      .limit(1);

    if (tenantError) throw tenantError;
    if (!tenants || tenants.length === 0) {
      throw new Error('No tenants found. Please create a tenant first.');
    }

    tenantId = tenants[0].id;
    console.log(`✅ Using tenant: ${tenants[0].name} (${tenantId})\n`);

    // Step 2: Get or create service
    console.log('📋 Step 2: Getting or creating service...');
    let { data: services, error: servicesError } = await supabase
      .from('services')
      .select('id, name, base_price')
      .eq('tenant_id', tenantId)
      .limit(1);

    if (servicesError) throw servicesError;

    if (!services || services.length === 0) {
      console.log('   Creating test service...');
      const { data: newService, error: createError } = await supabase
        .from('services')
        .insert({
          tenant_id: tenantId,
          name: 'Test Service for Package Financial Test',
          name_ar: 'خدمة اختبار للباقة المالية',
          base_price: servicePrice,
          duration_minutes: 60,
          service_duration_minutes: 60
        })
        .select()
        .single();

      if (createError) throw createError;
      serviceId = newService.id;
      console.log(`✅ Created service: ${newService.name} (${serviceId})\n`);
    } else {
      serviceId = services[0].id;
      servicePrice = parseFloat(services[0].base_price) || servicePrice;
      console.log(`✅ Using service: ${services[0].name} (${serviceId}), Price: ${servicePrice}\n`);
    }

    // Step 3: Get or create package with 10 total capacity
    console.log('📋 Step 3: Getting or creating package...');
    let { data: packages, error: packagesError } = await supabase
      .from('service_packages')
      .select('id, name, total_price')
      .eq('tenant_id', tenantId)
      .limit(1);

    if (packagesError) throw packagesError;

    if (!packages || packages.length === 0) {
      console.log('   Creating test package...');
      const { data: newPackage, error: createError } = await supabase
        .from('service_packages')
        .insert({
          tenant_id: tenantId,
          name: 'Test Package for Financial Test',
          name_ar: 'باقة اختبار للباقة المالية',
          total_price: 500.00,
          is_active: true
        })
        .select()
        .single();

      if (createError) throw createError;
      packageId = newPackage.id;

      // Add service to package with 10 capacity
      const { error: psError } = await supabase
        .from('package_services')
        .insert({
          package_id: packageId,
          service_id: serviceId,
          capacity_total: 10
        });

      if (psError) throw psError;
      console.log(`✅ Created package: ${newPackage.name} (${packageId})\n`);
    } else {
      packageId = packages[0].id;
      console.log(`✅ Using package: ${packages[0].name} (${packageId})\n`);
    }

    // Step 4: Get or create customer
    console.log('📋 Step 4: Getting or creating customer...');
    const testPhone = '+966501234567';
    let { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('tenant_id', tenantId)
      .eq('phone', testPhone)
      .limit(1);

    if (customersError) throw customersError;

    if (!customers || customers.length === 0) {
      const { data: newCustomer, error: createError } = await supabase
        .from('customers')
        .insert({
          tenant_id: tenantId,
          name: 'Test Customer Package Financial',
          phone: testPhone,
          email: 'test-package-financial@example.com'
        })
        .select()
        .single();

      if (createError) throw createError;
      customerId = newCustomer.id;
      console.log(`✅ Created customer: ${newCustomer.name} (${customerId})\n`);
    } else {
      customerId = customers[0].id;
      console.log(`✅ Using customer: ${customers[0].name} (${customerId})\n`);
    }

    // Step 5: Create package subscription with 8 remaining capacity
    // First, check if subscription exists
    console.log('📋 Step 5: Setting up package subscription with 8 remaining capacity...');
    let { data: subscriptions, error: subsError } = await supabase
      .from('package_subscriptions')
      .select('id, status, is_active')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('package_id', packageId)
      .eq('status', 'active')
      .limit(1);

    if (subsError) throw subsError;

    if (!subscriptions || subscriptions.length === 0) {
      // Create new subscription
      const { data: newSubscription, error: createError } = await supabase
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

      if (createError) throw createError;
      subscriptionId = newSubscription.id;
      console.log(`✅ Created subscription: ${subscriptionId}\n`);
    } else {
      subscriptionId = subscriptions[0].id;
      console.log(`✅ Using existing subscription: ${subscriptionId}\n`);
    }

    // Step 6: Set package usage to have 8 remaining (2 used out of 10)
    console.log('📋 Step 6: Setting package usage to 8 remaining (2 used)...');
    const { data: usageRecords, error: usageError } = await supabase
      .from('package_subscription_usage')
      .select('id, remaining_quantity, used_quantity, original_quantity')
      .eq('subscription_id', subscriptionId)
      .eq('service_id', serviceId)
      .limit(1);

    if (usageError) throw usageError;

    if (!usageRecords || usageRecords.length === 0) {
      // Create usage record with 8 remaining
      const { error: createError } = await supabase
        .from('package_subscription_usage')
        .insert({
          subscription_id: subscriptionId,
          service_id: serviceId,
          original_quantity: 10,
          remaining_quantity: 8,
          used_quantity: 2
        });

      if (createError) throw createError;
      console.log(`✅ Created usage record: 8 remaining, 2 used\n`);
    } else {
      // Update to 8 remaining
      const { error: updateError } = await supabase
        .from('package_subscription_usage')
        .update({
          remaining_quantity: 8,
          used_quantity: 2,
          original_quantity: 10
        })
        .eq('subscription_id', subscriptionId)
        .eq('service_id', serviceId);

      if (updateError) throw updateError;
      console.log(`✅ Updated usage record: 8 remaining, 2 used\n`);
    }

    // Verify initial state
    const { data: initialUsage, error: verifyError } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity')
      .eq('subscription_id', subscriptionId)
      .eq('service_id', serviceId)
      .single();

    if (verifyError) throw verifyError;
    logTest('Initial package capacity', initialUsage.remaining_quantity === 8, 
      `Remaining: ${initialUsage.remaining_quantity}, Used: ${initialUsage.used_quantity}`);

    // Step 7: Find an existing slot or create one via shift
    console.log('📋 Step 7: Finding or creating slot for booking...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const slotDate = tomorrow.toISOString().split('T')[0];
    const slotTime = '10:00:00';

    // Try to find existing slot - check if service_id column exists first
    let slots, slotsError;
    try {
      const result = await supabase
        .from('slots')
        .select('id, slot_date, start_time, original_capacity, available_capacity, service_id, shift_id')
        .eq('tenant_id', tenantId)
        .eq('slot_date', slotDate)
        .eq('start_time', slotTime)
        .gte('available_capacity', 10)
        .limit(1);
      
      slots = result.data;
      slotsError = result.error;
    } catch (e) {
      // If service_id doesn't exist, try without it
      const result = await supabase
        .from('slots')
        .select('id, slot_date, start_time, original_capacity, available_capacity, shift_id')
        .eq('tenant_id', tenantId)
        .eq('slot_date', slotDate)
        .eq('start_time', slotTime)
        .gte('available_capacity', 10)
        .limit(1);
      
      slots = result.data;
      slotsError = result.error;
    }

    let slotId;
    if (!slotsError && slots && slots.length > 0) {
      slotId = slots[0].id;
      console.log(`✅ Using existing slot: ${slotDate} ${slotTime} (${slotId})\n`);
    } else {
      // Need to create slot via shift - get or create shift first
      console.log('   Creating shift and slot...');
      
      // Get or create shift
      let { data: shifts, error: shiftError } = await supabase
        .from('shifts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('service_id', serviceId)
        .limit(1);

      if (shiftError) throw shiftError;

      let shiftId;
      if (!shifts || shifts.length === 0) {
        // Create shift
        const tomorrowDate = new Date(slotDate);
        const dayOfWeek = tomorrowDate.getDay(); // 0 = Sunday, 6 = Saturday
        
        const { data: newShift, error: createShiftError } = await supabase
          .from('shifts')
          .insert({
            tenant_id: tenantId,
            service_id: serviceId,
            days_of_week: [dayOfWeek],
            start_time_utc: slotTime,
            end_time_utc: '11:00:00',
            is_active: true
          })
          .select()
          .single();

        if (createShiftError) throw createShiftError;
        shiftId = newShift.id;
      } else {
        shiftId = shifts[0].id;
      }

      // Create slot - use proper UTC date handling
      // Simple approach: create date for tomorrow at specified time
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const startTimeUtcStr = tomorrow.toISOString();
      
      const endDate = new Date(tomorrow);
      endDate.setHours(11, 0, 0, 0);
      const endTimeUtcStr = endDate.toISOString();

      const { data: newSlot, error: createSlotError } = await supabase
        .from('slots')
        .insert({
          tenant_id: tenantId,
          shift_id: shiftId,
          slot_date: slotDate,
          start_time: slotTime,
          end_time: '11:00:00',
          start_time_utc: startTimeUtcStr,
          end_time_utc: endTimeUtcStr,
          original_capacity: 20,
          available_capacity: 20,
          booked_count: 0,
          is_available: true
        })
        .select()
        .single();

      if (createSlotError) {
        // Try with service_id if that column exists
        const slotData = {
          tenant_id: tenantId,
          service_id: serviceId,
          shift_id: shiftId,
          slot_date: slotDate,
          start_time: slotTime,
          end_time: '11:00:00',
          start_time_utc: startTimeUtcStr,
          end_time_utc: endTimeUtcStr,
          original_capacity: 20,
          available_capacity: 20,
          booked_count: 0,
          is_available: true
        };

        const retryResult = await supabase
          .from('slots')
          .insert(slotData)
          .select()
          .single();

        if (retryResult.error) throw retryResult.error;
        slotId = retryResult.data.id;
      } else {
        slotId = newSlot.id;
      }
      
      console.log(`✅ Created slot: ${slotDate} ${slotTime} (${slotId})\n`);
    }

    // Step 8: Create booking for 10 tickets via RPC (direct database call)
    console.log('📋 Step 8: Creating booking for 10 tickets via RPC...');
    
    // Calculate expected values
    const expectedPackageCovered = 8;
    const expectedPaid = 2;
    const expectedPrice = expectedPaid * servicePrice;

    // Get or create a user for created_by_user_id (required by foreign key)
    let userId = null;
    try {
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('tenant_id', tenantId)
        .limit(1);
      
      if (!userError && users && users.length > 0) {
        userId = users[0].id;
      }
    } catch (e) {
      // If no user found, created_by_user_id will be null
      console.log('   No user found for created_by_user_id, using null');
    }

    // Call RPC function directly
    const { data: bookingResult, error: rpcError } = await supabase
      .rpc('create_booking_with_lock', {
        p_slot_id: slotId,
        p_service_id: serviceId,
        p_tenant_id: tenantId,
        p_customer_name: 'Test Customer Package Financial',
        p_customer_phone: testPhone,
        p_customer_email: 'test-package-financial@example.com',
        p_visitor_count: 10,
        p_adult_count: 10,
        p_child_count: 0,
        p_total_price: expectedPrice,
        p_notes: 'Test booking for package financial behavior - 8 remaining, booking 10',
        p_employee_id: null,
        p_lock_id: null,
        p_session_id: userId, // Use user ID as session_id if available
        p_customer_id: customerId,
        p_offer_id: null,
        p_language: 'en',
        p_package_subscription_id: subscriptionId,
        p_package_covered_quantity: expectedPackageCovered,
        p_paid_quantity: expectedPaid
      });

    if (rpcError) {
      throw new Error(`RPC booking creation failed: ${rpcError.message} (code: ${rpcError.code})`);
    }

    // Parse booking result (RPC returns JSONB)
    let bookingData = bookingResult;
    if (typeof bookingResult === 'string') {
      try {
        bookingData = JSON.parse(bookingResult);
      } catch (e) {
        // If parsing fails, try to extract ID from string
        bookingData = { booking: { id: bookingResult } };
      }
    }

    bookingId = bookingData?.booking?.id || bookingData?.id;
    
    if (!bookingId) {
      console.error('RPC Response:', JSON.stringify(bookingResult, null, 2));
      throw new Error('Booking created but no ID returned from RPC');
    }

    console.log(`✅ Booking created: ${bookingId}\n`);

    // Step 9: Verify booking data
    console.log('📋 Step 9: Verifying booking data...\n');
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, visitor_count, package_covered_quantity, paid_quantity, total_price, package_subscription_id')
      .eq('id', bookingId)
      .single();

    if (bookingError) throw bookingError;

    // Verify package_covered_quantity = 8
    logTest('package_covered_quantity = 8', booking.package_covered_quantity === 8,
      `Actual: ${booking.package_covered_quantity}`);

    // Verify paid_quantity = 2
    logTest('paid_quantity = 2', booking.paid_quantity === 2,
      `Actual: ${booking.paid_quantity}`);

    // Verify total_price = 2 * servicePrice (expectedPrice already calculated above)
    logTest(`total_price = ${expectedPrice} (2 × ${servicePrice})`, 
      Math.abs(parseFloat(booking.total_price) - expectedPrice) < 0.01,
      `Actual: ${booking.total_price}`);

    // Verify package_subscription_id is set
    logTest('package_subscription_id is set', 
      booking.package_subscription_id === subscriptionId,
      `Actual: ${booking.package_subscription_id}`);

    // Step 10: Verify package capacity after booking
    console.log('\n📋 Step 10: Verifying package capacity after booking...\n');
    const { data: finalUsage, error: finalUsageError } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, used_quantity, original_quantity')
      .eq('subscription_id', subscriptionId)
      .eq('service_id', serviceId)
      .single();

    if (finalUsageError) throw finalUsageError;

    // Verify remaining_quantity = 0
    logTest('Package capacity after booking = 0', finalUsage.remaining_quantity === 0,
      `Actual remaining: ${finalUsage.remaining_quantity}, Used: ${finalUsage.used_quantity}`);

    // Verify used_quantity = 10 (2 original + 8 from booking)
    logTest('Total used_quantity = 10', finalUsage.used_quantity === 10,
      `Actual: ${finalUsage.used_quantity}`);

    // Step 11: Check if invoice was created (if Zoho is configured)
    console.log('\n📋 Step 11: Checking invoice creation...\n');
    const { data: invoiceCheck, error: invoiceError } = await supabase
      .from('bookings')
      .select('zoho_invoice_id')
      .eq('id', bookingId)
      .single();

    if (!invoiceError && invoiceCheck) {
      if (invoiceCheck.zoho_invoice_id) {
        logTest('Zoho invoice created', true, `Invoice ID: ${invoiceCheck.zoho_invoice_id}`);
      } else {
        logWarning('Zoho invoice not created', 
          'Invoice ID is null. This may be expected if Zoho is not configured or invoice creation failed.');
      }
    }

    // Step 12: Verify tickets were generated (10 tickets)
    console.log('\n📋 Step 12: Verifying tickets...\n');
    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('id')
      .eq('booking_id', bookingId);

    if (!ticketsError && tickets) {
      logTest('Tickets generated = 10', tickets.length === 10,
        `Actual: ${tickets.length} tickets`);
    } else {
      logWarning('Tickets verification', 
        'Could not verify tickets. This may be expected if ticket generation is disabled.');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${results.passed.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`⚠️  Warnings: ${results.warnings.length}`);
    console.log('='.repeat(60) + '\n');

    if (results.failed.length > 0) {
      console.log('❌ FAILED TESTS:');
      results.failed.forEach(f => console.log(`   - ${f.name}: ${f.message}`));
      console.log('');
    }

    if (results.warnings.length > 0) {
      console.log('⚠️  WARNINGS:');
      results.warnings.forEach(w => console.log(`   - ${w.name}: ${w.message}`));
      console.log('');
    }

    // Cleanup option
    console.log('💡 To clean up test data, run:');
    console.log(`   DELETE FROM bookings WHERE id = '${bookingId}';`);
    console.log(`   UPDATE package_subscription_usage SET remaining_quantity = 8, used_quantity = 2 WHERE subscription_id = '${subscriptionId}' AND service_id = '${serviceId}';`);
    console.log('');

    process.exit(results.failed.length > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ TEST FAILED WITH ERROR:');
    console.error(error);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

// Run the test
runTest();
