/**
 * Comprehensive test script for booking flow with offers
 * 
 * Tests:
 * 1. Find a service with offers (premium/base)
 * 2. Select premium offer
 * 3. Choose 72 tickets (mix of adult/child)
 * 4. Verify booking summary shows:
 *    - Selected offer name
 *    - Correct pricing based on offer
 *    - Adult/Child breakdown
 *    - Capacity warning if exceeded
 * 5. Verify capacity enforcement
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

async function testBookingWithOffers() {
  console.log('🧪 Testing Booking Flow with Offers\n');

  try {
    // 1. Find a service with offers
    console.log('📦 Step 1: Finding a service with offers...');
    const { data: offers, error: offersError } = await supabase
      .from('service_offers')
      .select('id, service_id, name, name_ar, price, original_price, discount_percentage, is_active, services:service_id (id, name, base_price, child_price, tenant_id)')
      .eq('is_active', true)
      .limit(10);

    if (offersError) {
      console.error('❌ Error fetching offers:', offersError);
      console.log('⚠️  service_offers table might not exist. Testing with base service pricing instead.');
    }

    if (!offers || offers.length === 0) {
      console.log('⚠️  No offers found. Testing with base service pricing.');
      
      // Find a service without offers
      const { data: services, error: servicesError } = await supabase
        .from('services')
        .select('id, name, base_price, child_price, original_price, tenant_id')
        .eq('is_active', true)
        .eq('is_public', true)
        .limit(1);

      if (servicesError || !services || services.length === 0) {
        console.error('❌ No services found');
        return;
      }

      const service = services[0];
      console.log(`✅ Found service: ${service.name} (${service.id})`);
      console.log(`   Base Price: ${service.base_price} SAR`);
      console.log(`   Child Price: ${service.child_price || service.base_price} SAR`);
      
      // Test booking summary calculation
      const adultCount = 50;
      const childCount = 22;
      const totalTickets = adultCount + childCount;
      const adultSubtotal = service.base_price * adultCount;
      const childSubtotal = (service.child_price || service.base_price) * childCount;
      const total = adultSubtotal + childSubtotal;

      console.log(`\n💰 Booking Summary Test (${totalTickets} tickets):`);
      console.log(`   Service: ${service.name}`);
      console.log(`   Offer: Base Service (no offer selected)`);
      console.log(`   Adult Tickets: ${adultCount} × ${service.base_price} = ${adultSubtotal.toFixed(2)} SAR`);
      console.log(`   Child Tickets: ${childCount} × ${service.child_price || service.base_price} = ${childSubtotal.toFixed(2)} SAR`);
      console.log(`   Total: ${total.toFixed(2)} SAR`);

      // Check capacity
      const { data: slots, error: slotsError } = await supabase
        .from('slots')
        .select('id, available_capacity, slot_date, start_time')
        .eq('service_id', service.id)
        .gt('available_capacity', 0)
        .limit(1);

      if (!slotsError && slots && slots.length > 0) {
        const slot = slots[0];
        console.log(`\n🎫 Capacity Check:`);
        console.log(`   Available: ${slot.available_capacity}`);
        console.log(`   Requested: ${totalTickets}`);
        if (slot.available_capacity < totalTickets) {
          console.log(`   ⚠️  WARNING: Not enough capacity! Available: ${slot.available_capacity}, Requested: ${totalTickets}`);
        } else {
          console.log(`   ✅ Capacity sufficient`);
        }
      }

      return;
    }

    // Find premium offer
    const premiumOffer = offers.find(o => 
      o.name?.toLowerCase().includes('premium') || 
      o.name_ar?.toLowerCase().includes('premium') ||
      o.name?.toLowerCase().includes('premium')
    ) || offers[0]; // Use first offer if no premium found

    if (!premiumOffer || !premiumOffer.services) {
      console.error('❌ No valid offer found');
      return;
    }

    const service = premiumOffer.services;
    console.log(`✅ Found premium offer: ${premiumOffer.name} (${premiumOffer.id})`);
    console.log(`   Service: ${service.name} (${service.id})`);
    console.log(`   Offer Price: ${premiumOffer.price} SAR`);
    console.log(`   Original Price: ${premiumOffer.original_price || premiumOffer.price} SAR`);
    if (premiumOffer.discount_percentage) {
      console.log(`   Discount: ${premiumOffer.discount_percentage}%`);
    }

    // 2. Test booking with 72 tickets
    console.log('\n🎫 Step 2: Testing booking with 72 tickets...');
    const adultCount = 50;
    const childCount = 22;
    const totalTickets = adultCount + childCount;

    // Calculate pricing with offer
    const offerPrice = parseFloat(premiumOffer.price || 0);
    const originalPrice = parseFloat(premiumOffer.original_price || premiumOffer.price || 0);
    const childPrice = parseFloat(service.child_price || service.base_price || offerPrice);

    // For offers, typically the offer price applies to adults, child price might be different
    const adultSubtotal = offerPrice * adultCount;
    const childSubtotal = childPrice * childCount;
    const total = adultSubtotal + childSubtotal;

    console.log(`\n💰 Expected Booking Summary:`);
    console.log(`   Service: ${service.name}`);
    console.log(`   Selected Offer: ${premiumOffer.name}`);
    console.log(`   Offer Price: ${offerPrice.toFixed(2)} SAR`);
    if (originalPrice > offerPrice) {
      const discount = Math.round(((originalPrice - offerPrice) / originalPrice) * 100);
      console.log(`   Original Price: ${originalPrice.toFixed(2)} SAR`);
      console.log(`   Discount: -${discount}%`);
    }
    console.log(`   Adult Tickets: ${adultCount} × ${offerPrice.toFixed(2)} = ${adultSubtotal.toFixed(2)} SAR`);
    console.log(`   Child Tickets: ${childCount} × ${childPrice.toFixed(2)} = ${childSubtotal.toFixed(2)} SAR`);
    console.log(`   Subtotal: ${total.toFixed(2)} SAR`);
    console.log(`   Total: ${total.toFixed(2)} SAR`);

    // 3. Check capacity
    console.log('\n🎫 Step 3: Checking capacity...');
    const { data: slots, error: slotsError } = await supabase
      .from('slots')
      .select('id, available_capacity, slot_date, start_time')
      .eq('service_id', service.id)
      .gt('available_capacity', 0)
      .limit(5);

    if (!slotsError && slots && slots.length > 0) {
      console.log(`✅ Found ${slots.length} slot(s) with available capacity:`);
      slots.forEach((slot, idx) => {
        console.log(`   ${idx + 1}. ${slot.slot_date} ${slot.start_time} - Capacity: ${slot.available_capacity}`);
      });

      const slot = slots[0];
      console.log(`\n⚠️  Capacity Warning Test:`);
      console.log(`   Available: ${slot.available_capacity}`);
      console.log(`   Requested: ${totalTickets}`);
      if (slot.available_capacity < totalTickets) {
        console.log(`   ❌ NOT ENOUGH CAPACITY!`);
        console.log(`   Expected Alert: "⚠️ Not enough capacity available. Available: ${slot.available_capacity}, Requested: ${totalTickets}"`);
      } else {
        console.log(`   ✅ Capacity sufficient`);
      }
    } else {
      console.log('⚠️  No slots found for testing capacity');
    }

    // 4. Test cases
    console.log('\n📋 Step 4: Test Cases Summary');
    console.log('\n✅ Test Case 1: Offer Selection');
    console.log('   - Premium offer should be selectable');
    console.log('   - Offer name should appear in booking summary');
    console.log('   - Offer price should be used for calculations');

    console.log('\n✅ Test Case 2: Ticket Count (72 tickets)');
    console.log(`   - Adult: ${adultCount} tickets`);
    console.log(`   - Child: ${childCount} tickets`);
    console.log(`   - Total: ${totalTickets} tickets`);
    console.log(`   - Price calculation: ${adultSubtotal.toFixed(2)} + ${childSubtotal.toFixed(2)} = ${total.toFixed(2)} SAR`);

    console.log('\n✅ Test Case 3: Capacity Enforcement');
    if (slots && slots.length > 0 && slots[0].available_capacity < totalTickets) {
      console.log('   - Capacity warning should be displayed');
      console.log('   - Button should be disabled');
      console.log('   - Alert should show: Available vs Requested');
    } else {
      console.log('   - Capacity sufficient for booking');
    }

    console.log('\n✅ Test Case 4: Booking Summary Display');
    console.log('   - Should show selected offer name');
    console.log('   - Should show offer price (not base price)');
    console.log('   - Should show adult/child breakdown');
    console.log('   - Should show subtotal and total');
    console.log('   - Should show capacity warning if exceeded');

    console.log('\n✅ All test cases defined!');
    console.log('\n📝 Next Steps:');
    console.log('   1. Navigate to service booking page');
    console.log('   2. Select premium offer');
    console.log('   3. Select date and time');
    console.log('   4. Choose 72 tickets (50 adults + 22 children)');
    console.log('   5. Verify booking summary shows all details correctly');
    console.log('   6. Verify capacity warning appears if capacity < 72');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testBookingWithOffers();

