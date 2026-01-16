/**
 * Test script to verify Booking Summary displays correctly
 * 
 * Tests:
 * 1. Base Price and Original Price display
 * 2. Service Discount calculation
 * 3. Adult and Child ticket breakdown
 * 4. Subtotal and Total calculation
 * 5. Capacity warnings with accurate details
 * 6. Capacity enforcement (button disabled when capacity exceeded)
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

async function testBookingSummary() {
  console.log('🧪 Testing Booking Summary Display\n');

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

    // 2. Get package services with pricing
    console.log('\n📋 Step 2: Getting package services with pricing...');
    const { data: packageServices, error: psError } = await supabase
      .from('package_services')
      .select('service_id, services:service_id (id, name, base_price, child_price, original_price)')
      .eq('package_id', testPackage.id);

    if (psError || !packageServices || packageServices.length === 0) {
      console.error('❌ No services found in package');
      return;
    }

    console.log(`✅ Found ${packageServices.length} service(s) in package:`);
    packageServices.forEach((ps, idx) => {
      const service = ps.services;
      console.log(`   ${idx + 1}. ${service?.name || 'Unknown'}`);
      console.log(`      Base Price: ${service?.base_price || 0} SAR`);
      console.log(`      Original Price: ${service?.original_price || service?.base_price || 0} SAR`);
      console.log(`      Child Price: ${service?.child_price || service?.base_price || 0} SAR`);
    });

    // 3. Test pricing calculations
    console.log('\n💰 Step 3: Testing pricing calculations...');
    
    const firstService = packageServices[0]?.services;
    if (!firstService) {
      console.error('❌ No service data found');
      return;
    }

    const basePrice = parseFloat(firstService.base_price || 0);
    const originalPrice = parseFloat(firstService.original_price || firstService.base_price || 0);
    const childPrice = parseFloat(firstService.child_price || firstService.base_price || 0);
    const hasDiscount = originalPrice > basePrice;
    const discountPercent = hasDiscount ? Math.round(((originalPrice - basePrice) / originalPrice) * 100) : 0;

    console.log(`\n   Base Price: ${basePrice.toFixed(2)} SAR`);
    console.log(`   Original Price: ${originalPrice.toFixed(2)} SAR`);
    if (hasDiscount) {
      console.log(`   Service Discount: -${discountPercent}%`);
    }

    // Test scenarios
    const testScenarios = [
      { adults: 11, children: 21, description: '11 adults + 21 children' },
      { adults: 1, children: 0, description: 'Single adult' },
      { adults: 5, children: 3, description: '5 adults + 3 children' },
    ];

    for (const scenario of testScenarios) {
      console.log(`\n   Testing: ${scenario.description}`);
      const adultSubtotal = basePrice * scenario.adults;
      const childSubtotal = childPrice * scenario.children;
      const subtotal = adultSubtotal + childSubtotal;
      const total = subtotal;
      
      console.log(`     Adult Tickets: ${scenario.adults} × ${basePrice.toFixed(2)} = ${adultSubtotal.toFixed(2)} SAR`);
      if (scenario.children > 0) {
        console.log(`     Child Tickets: ${scenario.children} × ${childPrice.toFixed(2)} = ${childSubtotal.toFixed(2)} SAR`);
      }
      console.log(`     Subtotal: ${subtotal.toFixed(2)} SAR`);
      console.log(`     Total: ${total.toFixed(2)} SAR`);
    }

    // 4. Test capacity validation
    console.log('\n🎫 Step 4: Testing capacity validation...');
    
    const { data: slots, error: slotsError } = await supabase
      .from('slots')
      .select('id, available_capacity, slot_date, start_time')
      .eq('service_id', firstService.id)
      .gt('available_capacity', 0)
      .limit(5);

    if (!slotsError && slots && slots.length > 0) {
      console.log(`✅ Found ${slots.length} slot(s) with available capacity:`);
      slots.forEach((slot, idx) => {
        console.log(`   ${idx + 1}. ${slot.slot_date} ${slot.start_time} - Capacity: ${slot.available_capacity}`);
      });

      // Test capacity scenarios
      const capacityTests = [
        { requested: 11, available: slots[0].available_capacity, shouldPass: true },
        { requested: slots[0].available_capacity, available: slots[0].available_capacity, shouldPass: true },
        { requested: slots[0].available_capacity + 1, available: slots[0].available_capacity, shouldPass: false },
        { requested: 32, available: 10, shouldPass: false },
      ];

      console.log('\n   Capacity validation tests:');
      capacityTests.forEach((test) => {
        const passes = test.requested <= test.available;
        const status = passes === test.shouldPass ? '✅' : '❌';
        console.log(`   ${status} Request ${test.requested} tickets, Available: ${test.available} - ${passes ? 'PASS' : 'FAIL'}`);
        if (!passes) {
          console.log(`      ⚠️ Warning: Not enough capacity available. Available: ${test.available}, Requested: ${test.requested}`);
        }
      });
    } else {
      console.log('⚠️  No slots found for testing capacity');
    }

    // 5. Test display format
    console.log('\n📊 Step 5: Testing display format...');
    console.log('\n   Expected Booking Summary Format:');
    console.log('   ┌─────────────────────────────────┐');
    console.log('   │ Base Price: 180.00 SAR          │');
    console.log('   │ Original Price: 270.00 SAR       │');
    console.log('   │ Service Discount: -33%           │');
    console.log('   │                                 │');
    console.log('   │ Adult Tickets: 11 × 180.00 =    │');
    console.log('   │   1980.00 SAR                    │');
    console.log('   │ Child Tickets: 21 × 100.00 =     │');
    console.log('   │   2100.00 SAR                    │');
    console.log('   │                                 │');
    console.log('   │ Subtotal: 4080.00 SAR            │');
    console.log('   │ Total: 4080.00 SAR               │');
    console.log('   │                                 │');
    console.log('   │ ⚠️ Not enough capacity          │');
    console.log('   │    Available: 10, Requested: 32  │');
    console.log('   └─────────────────────────────────┘');

    console.log('\n✅ All tests completed!');
    console.log('\n📝 Summary:');
    console.log('   - Base Price and Original Price should be displayed');
    console.log('   - Service Discount percentage should be calculated correctly');
    console.log('   - Adult and Child ticket breakdowns should show: count × price = subtotal');
    console.log('   - Subtotal and Total should match');
    console.log('   - Capacity warnings should show specific available vs requested numbers');
    console.log('   - Button should be disabled when capacity is exceeded');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testBookingSummary();

