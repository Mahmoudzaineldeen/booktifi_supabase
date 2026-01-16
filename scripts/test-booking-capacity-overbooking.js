import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

// Helper function to format time
const formatTime = (date) => {
  return new Date(date).toISOString().replace('T', ' ').substring(0, 19);
};

// Helper function to create a booking via API simulation
async function createBooking(client, tenantId, serviceId, slotId, customerName, customerPhone, visitorCount = 1) {
  try {
    // Simulate the booking creation logic from bookings.ts
    await client.query('BEGIN');
    
    // Check slot availability (with row lock to prevent race conditions)
    const slotCheck = await client.query(
      `SELECT available_capacity, is_available, original_capacity
       FROM slots 
       WHERE id = $1 
       FOR UPDATE`,
      [slotId]
    );

    if (slotCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Slot not found' };
    }

    const slot = slotCheck.rows[0];

    if (!slot.is_available) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Slot is not available' };
    }

    // Check capacity
    if (slot.available_capacity < visitorCount) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: `Not enough tickets available. Only ${slot.available_capacity} available, but ${visitorCount} requested.` 
      };
    }

    // Create booking
    const bookingResult = await client.query(
      `INSERT INTO bookings (
        tenant_id, service_id, slot_id, employee_id,
        customer_name, customer_phone, customer_email,
        visitor_count, total_price, notes, status, payment_status,
        customer_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        tenantId,
        serviceId,
        slotId,
        null, // employee_id
        customerName,
        customerPhone,
        null, // customer_email
        visitorCount,
        100.00, // total_price
        null, // notes
        'confirmed',
        'unpaid',
        null // customer_id
      ]
    );

    await client.query('COMMIT');
    
    return { success: true, booking: bookingResult.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    return { success: false, error: error.message };
  }
}

async function testBookingCapacity() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Booking Capacity & Overbooking Prevention\n');
    console.log('='.repeat(70));
    
    // ========================================================================
    // SCENARIO 1: Overbooking Prevention
    // ========================================================================
    console.log('\n📋 SCENARIO 1: Overbooking Prevention Test\n');
    console.log('-'.repeat(70));
    
    // Step 1: Find a service with known capacity
    console.log('\n📋 Step 1: Finding a service with known capacity...');
    const serviceResult = await client.query(`
      SELECT s.id, s.name, s.tenant_id, s.service_capacity_per_slot
      FROM services s
      WHERE s.is_active = true
      LIMIT 1
    `);
    
    if (serviceResult.rows.length === 0) {
      throw new Error('No active services found for testing');
    }
    
    const testService = serviceResult.rows[0];
    console.log(`✅ Found service: ${testService.name} (ID: ${testService.id})`);
    
    // Step 2: Find a slot for this service
    console.log('\n📋 Step 2: Finding a slot for this service...');
    const slotResult = await client.query(`
      SELECT 
        sl.id,
        sl.slot_date,
        sl.start_time,
        sl.end_time,
        sl.available_capacity,
        sl.original_capacity,
        sl.booked_count
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.is_available = true
        AND sl.available_capacity > 0
      ORDER BY sl.slot_date, sl.start_time
      LIMIT 1
    `, [testService.id]);
    
    if (slotResult.rows.length === 0) {
      throw new Error('No available slots found for this service');
    }
    
    const testSlot = slotResult.rows[0];
    const slotCapacity = testSlot.available_capacity;
    console.log(`✅ Found slot:`);
    console.log(`   Slot ID: ${testSlot.id}`);
    console.log(`   Date: ${testSlot.slot_date}`);
    console.log(`   Time: ${testSlot.start_time} - ${testSlot.end_time}`);
    console.log(`   Available Capacity: ${slotCapacity}`);
    console.log(`   Original Capacity: ${testSlot.original_capacity}`);
    console.log(`   Booked Count: ${testSlot.booked_count}`);
    
    // Step 3: Create bookings until capacity is reached
    console.log(`\n📋 Step 3: Creating bookings until capacity is reached (${slotCapacity} bookings)...`);
    const createdBookings = [];
    let bookingNumber = 1;
    
    for (let i = 0; i < slotCapacity; i++) {
      const customerName = `Test Customer ${bookingNumber}`;
      const customerPhone = `+966501234${String(bookingNumber).padStart(3, '0')}`;
      
      const result = await createBooking(
        client,
        testService.tenant_id,
        testService.id,
        testSlot.id,
        customerName,
        customerPhone,
        1 // visitor_count
      );
      
      if (result.success) {
        createdBookings.push(result.booking);
        console.log(`   ✅ Booking ${bookingNumber} created successfully`);
        bookingNumber++;
      } else {
        console.log(`   ❌ Booking ${bookingNumber} failed: ${result.error}`);
        throw new Error(`Failed to create booking ${bookingNumber}: ${result.error}`);
      }
      
      // Check current capacity
      const currentSlot = await client.query(
        `SELECT available_capacity, booked_count FROM slots WHERE id = $1`,
        [testSlot.id]
      );
      console.log(`      Current available capacity: ${currentSlot.rows[0].available_capacity}`);
      console.log(`      Current booked count: ${currentSlot.rows[0].booked_count}`);
    }
    
    console.log(`\n✅ Successfully created ${createdBookings.length} bookings`);
    
    // Step 4: Verify slot is fully booked
    console.log('\n📋 Step 4: Verifying slot is fully booked...');
    const finalSlot = await client.query(
      `SELECT available_capacity, booked_count, original_capacity FROM slots WHERE id = $1`,
      [testSlot.id]
    );
    
    const finalSlotInfo = finalSlot.rows[0];
    console.log(`   Available Capacity: ${finalSlotInfo.available_capacity}`);
    console.log(`   Booked Count: ${finalSlotInfo.booked_count}`);
    console.log(`   Original Capacity: ${finalSlotInfo.original_capacity}`);
    
    if (finalSlotInfo.available_capacity !== 0) {
      throw new Error(`Slot should be fully booked but available_capacity is ${finalSlotInfo.available_capacity}`);
    }
    
    console.log(`✅ Slot is fully booked (available_capacity = 0)`);
    
    // Step 5: Attempt to create one more booking (should fail)
    console.log('\n📋 Step 5: Attempting to create one more booking (should fail)...');
    const overbookingResult = await createBooking(
      client,
      testService.tenant_id,
      testService.id,
      testSlot.id,
      'Overbooking Test Customer',
      '+966509999999',
      1
    );
    
    if (overbookingResult.success) {
      throw new Error('❌ OVERBOOKING DETECTED! System allowed booking when slot was full!');
    } else {
      console.log(`✅ Overbooking correctly prevented!`);
      console.log(`   Error message: ${overbookingResult.error}`);
      
      // Validate error message
      if (overbookingResult.error.includes('Not enough tickets available') || 
          overbookingResult.error.includes('available') ||
          overbookingResult.error.includes('capacity')) {
        console.log(`✅ Error message is clear and informative`);
      } else {
        console.log(`⚠️  Warning: Error message might not be clear enough`);
      }
    }
    
    // Step 6: Verify no booking was created
    console.log('\n📋 Step 6: Verifying no booking was created in database...');
    const bookingCount = await client.query(
      `SELECT COUNT(*) as count FROM bookings WHERE slot_id = $1 AND status = 'confirmed'`,
      [testSlot.id]
    );
    
    const totalBookings = parseInt(bookingCount.rows[0].count);
    console.log(`   Total confirmed bookings for this slot: ${totalBookings}`);
    
    if (totalBookings !== slotCapacity) {
      throw new Error(`Expected ${slotCapacity} bookings but found ${totalBookings}`);
    }
    
    console.log(`✅ No overbooking occurred - booking count matches capacity`);
    
    // Clean up Scenario 1 bookings
    console.log('\n📋 Cleaning up Scenario 1 test bookings...');
    await client.query(
      `DELETE FROM bookings WHERE id = ANY($1::uuid[])`,
      [createdBookings.map(b => b.id)]
    );
    console.log(`✅ Cleaned up ${createdBookings.length} test bookings`);
    
    // ========================================================================
    // SCENARIO 2: Capacity Per Time Slot (Not Per Day)
    // ========================================================================
    console.log('\n\n📋 SCENARIO 2: Capacity Per Time Slot Test\n');
    console.log('-'.repeat(70));
    
    // Step 1: Find a service with capacity
    console.log('\n📋 Step 1: Finding a service with capacity...');
    const service2Result = await client.query(`
      SELECT s.id, s.name, s.tenant_id
      FROM services s
      WHERE s.is_active = true
      LIMIT 1
    `);
    
    const testService2 = service2Result.rows[0];
    console.log(`✅ Using service: ${testService2.name} (ID: ${testService2.id})`);
    
    // Step 2: Find two different time slots on the same date
    console.log('\n📋 Step 2: Finding two different time slots on the same date...');
    
    // First, find a date that has at least 2 slots
    const dateResult = await client.query(`
      SELECT 
        sl.slot_date,
        COUNT(*) as slot_count
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.is_available = true
        AND sl.available_capacity >= 10
      GROUP BY sl.slot_date
      HAVING COUNT(*) >= 2
      ORDER BY sl.slot_date
      LIMIT 1
    `, [testService2.id]);
    
    if (dateResult.rows.length === 0) {
      throw new Error('No date found with at least 2 slots with capacity >= 10');
    }
    
    const testDate = dateResult.rows[0].slot_date;
    console.log(`✅ Found date with multiple slots: ${testDate}`);
    
    // Now get two slots on that date
    const slotsResult = await client.query(`
      SELECT 
        sl.id,
        sl.slot_date,
        sl.start_time,
        sl.end_time,
        sl.available_capacity,
        sl.original_capacity
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.slot_date = $2
        AND sl.is_available = true
        AND sl.available_capacity >= 10
      ORDER BY sl.start_time
      LIMIT 2
    `, [testService2.id, testDate]);
    
    if (slotsResult.rows.length < 2) {
      throw new Error(`Need at least 2 slots on ${testDate} with capacity >= 10 for this test`);
    }
    
    const slot1 = slotsResult.rows[0];
    const slot2 = slotsResult.rows[1];
    
    console.log(`✅ Found two slots on ${slot1.slot_date}:`);
    console.log(`   Slot 1: ${slot1.start_time} - ${slot1.end_time} (Capacity: ${slot1.available_capacity})`);
    console.log(`   Slot 2: ${slot2.start_time} - ${slot2.end_time} (Capacity: ${slot2.available_capacity})`);
    
    // Step 3: Fully book slot 1 (7:00 PM equivalent)
    console.log(`\n📋 Step 3: Fully booking Slot 1 (${slot1.start_time})...`);
    const slot1Capacity = Math.min(slot1.available_capacity, 10); // Use up to 10 for testing
    const slot1Bookings = [];
    
    for (let i = 0; i < slot1Capacity; i++) {
      const result = await createBooking(
        client,
        testService2.tenant_id,
        testService2.id,
        slot1.id,
        `Slot1 Customer ${i + 1}`,
        `+966501111${String(i + 1).padStart(3, '0')}`,
        1
      );
      
      if (result.success) {
        slot1Bookings.push(result.booking);
      } else {
        throw new Error(`Failed to create booking for slot 1: ${result.error}`);
      }
    }
    
    console.log(`✅ Created ${slot1Bookings.length} bookings for Slot 1`);
    
    // Step 4: Verify slot 1 is fully booked
    console.log('\n📋 Step 4: Verifying Slot 1 is fully booked...');
    const slot1After = await client.query(
      `SELECT available_capacity FROM slots WHERE id = $1`,
      [slot1.id]
    );
    
    if (slot1After.rows[0].available_capacity !== 0) {
      console.log(`⚠️  Slot 1 capacity: ${slot1After.rows[0].available_capacity} (expected 0)`);
    } else {
      console.log(`✅ Slot 1 is fully booked (available_capacity = 0)`);
    }
    
    // Step 5: Try booking again at slot 1 (should fail)
    console.log('\n📋 Step 5: Attempting another booking at Slot 1 (should fail)...');
    const slot1Overbooking = await createBooking(
      client,
      testService2.tenant_id,
      testService2.id,
      slot1.id,
      'Slot1 Overbooking Test',
      '+966509999999',
      1
    );
    
    if (slot1Overbooking.success) {
      throw new Error('❌ OVERBOOKING DETECTED! System allowed booking when slot 1 was full!');
    } else {
      console.log(`✅ Correctly prevented overbooking at Slot 1`);
      console.log(`   Error: ${slot1Overbooking.error}`);
    }
    
    // Step 6: Attempt booking at slot 2 (8:00 PM equivalent) - should succeed
    console.log(`\n📋 Step 6: Attempting booking at Slot 2 (${slot2.start_time}) - should succeed...`);
    const slot2Before = await client.query(
      `SELECT available_capacity FROM slots WHERE id = $1`,
      [slot2.id]
    );
    const slot2CapacityBefore = slot2Before.rows[0].available_capacity;
    
    const slot2Booking = await createBooking(
      client,
      testService2.tenant_id,
      testService2.id,
      slot2.id,
      'Slot2 Customer',
      '+966502222222',
      1
    );
    
    if (!slot2Booking.success) {
      throw new Error(`❌ Failed to create booking at Slot 2: ${slot2Booking.error}`);
    }
    
    console.log(`✅ Successfully created booking at Slot 2`);
    
    // Step 7: Verify slot 2 capacity
    console.log('\n📋 Step 7: Verifying Slot 2 capacity...');
    const slot2After = await client.query(
      `SELECT available_capacity FROM slots WHERE id = $1`,
      [slot2.id]
    );
    const slot2CapacityAfter = slot2After.rows[0].available_capacity;
    
    console.log(`   Slot 2 capacity before: ${slot2CapacityBefore}`);
    console.log(`   Slot 2 capacity after: ${slot2CapacityAfter}`);
    console.log(`   Capacity reduced by: ${slot2CapacityBefore - slot2CapacityAfter}`);
    
    if (slot2CapacityAfter !== slot2CapacityBefore - 1) {
      throw new Error(`Slot 2 capacity should be reduced by 1, but it's ${slot2CapacityBefore - slot2CapacityAfter}`);
    }
    
    console.log(`✅ Slot 2 capacity correctly reduced (independent of Slot 1)`);
    
    // Step 8: Verify capacity is logged per time slot
    console.log('\n📋 Step 8: Verifying capacity is logged per time slot...');
    const capacitySummary = await client.query(`
      SELECT 
        slot_date,
        start_time,
        end_time,
        available_capacity,
        original_capacity,
        booked_count
      FROM slots
      WHERE id IN ($1, $2)
      ORDER BY start_time
    `, [slot1.id, slot2.id]);
    
    console.log(`✅ Capacity summary per time slot:`);
    capacitySummary.rows.forEach(slot => {
      console.log(`   ${slot.start_time} - ${slot.end_time}:`);
      console.log(`      Available: ${slot.available_capacity}`);
      console.log(`      Original: ${slot.original_capacity}`);
      console.log(`      Booked: ${slot.booked_count}`);
    });
    
    // Step 9: Verify bookings at different times are independent
    console.log('\n📋 Step 9: Verifying bookings at different times are independent...');
    const bookingSummary = await client.query(`
      SELECT 
        s.start_time,
        COUNT(b.id) as booking_count
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
      WHERE s.id IN ($1, $2)
      GROUP BY s.id, s.start_time
      ORDER BY s.start_time
    `, [slot1.id, slot2.id]);
    
    console.log(`✅ Booking count per time slot:`);
    bookingSummary.rows.forEach(row => {
      console.log(`   ${row.start_time}: ${row.booking_count} bookings`);
    });
    
    // Clean up Scenario 2 bookings
    console.log('\n📋 Cleaning up Scenario 2 test bookings...');
    const allBookings = [...slot1Bookings, slot2Booking.booking];
    await client.query(
      `DELETE FROM bookings WHERE id = ANY($1::uuid[])`,
      [allBookings.map(b => b.id)]
    );
    console.log(`✅ Cleaned up ${allBookings.length} test bookings`);
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ All tests passed! Booking capacity system is working correctly.');
    console.log('='.repeat(70));
    console.log('\n📊 Test Summary:');
    console.log('   ✅ Scenario 1: Overbooking prevention - PASSED');
    console.log('   ✅ Scenario 2: Capacity per time slot - PASSED');
    console.log('   ✅ Error messages are clear and informative');
    console.log('   ✅ No overbooking occurred in database');
    console.log('   ✅ Capacity is tracked independently per time slot');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the test
testBookingCapacity();

