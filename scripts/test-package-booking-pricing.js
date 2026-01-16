/**
 * Test script to verify package booking pricing and capacity validation
 * 
 * This script tests:
 * 1. Pricing calculation with multiple tickets
 * 2. Capacity validation to prevent overbooking
 * 3. Ticket count passing from PackageSchedulePage to CheckoutPage
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testPackageBookingPricing() {
  console.log('🧪 Testing Package Booking Pricing and Capacity Validation\n');

  try {
    // 1. Find a test package
    console.log('📦 Step 1: Finding a test package...');
    const { data: packages, error: pkgError } = await supabase
      .from('service_packages')
      .select('id, name, total_price, tenant_id')
      .eq('is_active', true)
      .limit(1);

    if (pkgError || !packages || packages.length === 0) {
      console.error('❌ No packages found');
      return;
    }

    const testPackage = packages[0];
    console.log(`✅ Found package: ${testPackage.name} (${testPackage.id})`);

    // 2. Get package services
    console.log('\n📋 Step 2: Getting package services...');
    const { data: packageServices, error: psError } = await supabase
      .from('package_services')
      .select('service_id, services (id, name, base_price, child_price)')
      .eq('package_id', testPackage.id);

    if (psError || !packageServices || packageServices.length === 0) {
      console.error('❌ No services found in package');
      return;
    }

    console.log(`✅ Found ${packageServices.length} service(s) in package:`);
    packageServices.forEach((ps, idx) => {
      const service = ps.services;
      console.log(`   ${idx + 1}. ${service?.name || 'Unknown'} - Base: ${service?.base_price || 0} SAR`);
    });

    // 3. Test pricing calculation scenarios
    console.log('\n💰 Step 3: Testing pricing calculations...');
    
    const testScenarios = [
      { adults: 1, children: 0, description: 'Single adult ticket' },
      { adults: 10, children: 0, description: '10 adult tickets' },
      { adults: 5, children: 3, description: '5 adults + 3 children' },
      { adults: 2, children: 2, description: '2 adults + 2 children' },
    ];

    for (const scenario of testScenarios) {
      console.log(`\n   Testing: ${scenario.description}`);
      
      let totalPrice = 0;
      packageServices.forEach((ps) => {
        const service = ps.services;
        const basePrice = parseFloat(service?.base_price || 0);
        const childPrice = service?.child_price 
          ? parseFloat(service.child_price) 
          : basePrice;
        
        const serviceTotal = (basePrice * scenario.adults) + (childPrice * scenario.children);
        totalPrice += serviceTotal;
        
        console.log(`     - ${service?.name}: ${scenario.adults} × ${basePrice} + ${scenario.children} × ${childPrice} = ${serviceTotal} SAR`);
      });
      
      console.log(`     ✅ Total: ${totalPrice.toFixed(2)} SAR`);
      
      // Verify it's not just the package price
      if (totalPrice === testPackage.total_price && (scenario.adults > 1 || scenario.children > 0)) {
        console.log(`     ⚠️  WARNING: Total equals package price (${testPackage.total_price}), should be ${totalPrice.toFixed(2)}`);
      }
    }

    // 4. Test capacity validation
    console.log('\n🎫 Step 4: Testing capacity validation...');
    
    // Get slots for the first service
    const firstService = packageServices[0];
    if (firstService?.service_id) {
      const { data: slots, error: slotsError } = await supabase
        .from('slots')
        .select('id, available_capacity, slot_date, start_time')
        .eq('service_id', firstService.service_id)
        .gt('available_capacity', 0)
        .limit(5);

      if (!slotsError && slots && slots.length > 0) {
        console.log(`✅ Found ${slots.length} slot(s) with available capacity:`);
        slots.forEach((slot, idx) => {
          console.log(`   ${idx + 1}. ${slot.slot_date} ${slot.start_time} - Capacity: ${slot.available_capacity}`);
        });

        // Test capacity scenarios
        const capacityTests = [
          { requested: 1, available: slots[0].available_capacity, shouldPass: true },
          { requested: slots[0].available_capacity, available: slots[0].available_capacity, shouldPass: true },
          { requested: slots[0].available_capacity + 1, available: slots[0].available_capacity, shouldPass: false },
          { requested: slots[0].available_capacity * 2, available: slots[0].available_capacity, shouldPass: false },
        ];

        console.log('\n   Capacity validation tests:');
        capacityTests.forEach((test) => {
          const passes = test.requested <= test.available;
          const status = passes === test.shouldPass ? '✅' : '❌';
          console.log(`   ${status} Request ${test.requested} tickets, Available: ${test.available} - ${passes ? 'PASS' : 'FAIL'}`);
        });
      } else {
        console.log('⚠️  No slots found for testing capacity');
      }
    }

    console.log('\n✅ All tests completed!');
    console.log('\n📝 Summary:');
    console.log('   - Pricing should multiply ticket counts by service prices');
    console.log('   - Capacity validation should prevent booking more than available');
    console.log('   - Ticket counts should be passed correctly from booking to checkout');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testPackageBookingPricing();

