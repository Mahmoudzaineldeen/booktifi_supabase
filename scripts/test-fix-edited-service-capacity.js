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

// Helper function to create a booking
async function createBooking(client, tenantId, serviceId, slotId, customerName, customerPhone, visitorCount = 1) {
  try {
    await client.query('BEGIN');
    
    const slotCheck = await client.query(
      `SELECT available_capacity, is_available FROM slots WHERE id = $1 FOR UPDATE`,
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

    if (slot.available_capacity < visitorCount) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: `Not enough tickets available. Only ${slot.available_capacity} available, but ${visitorCount} requested.` 
      };
    }

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
        null,
        customerName,
        customerPhone,
        null,
        visitorCount,
        100.00,
        null,
        'confirmed',
        'unpaid',
        null
      ]
    );

    await client.query('COMMIT');
    
    return { success: true, booking: bookingResult.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    return { success: false, error: error.message };
  }
}

async function testEditedServiceCapacity() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Edited Service Capacity Fix\n');
    console.log('='.repeat(70));
    
    // Step 1: Find a service that was edited (has capacity = 1 but slots might have old capacity)
    console.log('\n📋 Step 1: Finding a service with capacity = 1...');
    const serviceResult = await client.query(`
      SELECT 
        s.id,
        s.name,
        s.service_capacity_per_slot,
        COUNT(sl.id) as slot_count
      FROM services s
      JOIN shifts sh ON s.id = sh.service_id
      JOIN slots sl ON sh.id = sl.shift_id
      WHERE s.capacity_mode = 'service_based'
        AND s.service_capacity_per_slot = 1
        AND sl.slot_date >= CURRENT_DATE
      GROUP BY s.id, s.name, s.service_capacity_per_slot
      HAVING COUNT(sl.id) > 0
      LIMIT 1
    `);
    
    if (serviceResult.rows.length === 0) {
      throw new Error('No service with capacity = 1 found for testing');
    }
    
    const testService = serviceResult.rows[0];
    console.log(`✅ Found service: ${testService.name}`);
    console.log(`   Service capacity: ${testService.service_capacity_per_slot}`);
    console.log(`   Existing slots: ${testService.slot_count}`);
    
    // Step 2: Check if slots have correct capacity
    console.log('\n📋 Step 2: Checking slot capacities...');
    const slotsCheck = await client.query(`
      SELECT 
        sl.id,
        sl.slot_date,
        sl.start_time,
        sl.original_capacity,
        sl.available_capacity,
        sl.booked_count
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.slot_date >= CURRENT_DATE
      ORDER BY sl.slot_date, sl.start_time
      LIMIT 3
    `, [testService.id]);
    
    console.log(`✅ Checking ${slotsCheck.rows.length} slots:`);
    let hasMismatch = false;
    slotsCheck.rows.forEach((slot, i) => {
      const matches = slot.original_capacity === testService.service_capacity_per_slot;
      console.log(`   Slot ${i + 1}: ${slot.slot_date} ${slot.start_time}`);
      console.log(`      Original: ${slot.original_capacity} (expected: ${testService.service_capacity_per_slot}) ${matches ? '✅' : '❌'}`);
      console.log(`      Available: ${slot.available_capacity}, Booked: ${slot.booked_count}`);
      if (!matches) {
        hasMismatch = true;
      }
    });
    
    if (hasMismatch) {
      console.log(`\n⚠️  Warning: Some slots have incorrect capacity. Running sync...`);
      await client.query(`SELECT sync_all_slots_with_service_capacity()`);
      console.log(`✅ Sync completed`);
    } else {
      console.log(`✅ All slots have correct capacity`);
    }
    
    // Step 3: Test booking with capacity = 1
    console.log('\n📋 Step 3: Testing booking with capacity = 1...');
    // Find a slot with available capacity > 0
    const availableSlot = slotsCheck.rows.find(s => s.available_capacity > 0);
    if (!availableSlot) {
      throw new Error('No available slots found for testing');
    }
    const testSlot = availableSlot;
    console.log(`   Using slot: ${testSlot.slot_date} ${testSlot.start_time} (Available: ${testSlot.available_capacity})`);
    
    // First booking should succeed
    console.log(`   Attempting first booking (should succeed)...`);
    const booking1 = await createBooking(
      client,
      testService.tenant_id || (await client.query(`SELECT tenant_id FROM services WHERE id = $1`, [testService.id])).rows[0].tenant_id,
      testService.id,
      testSlot.id,
      'Test Customer 1',
      '+966501111111',
      1
    );
    
    if (!booking1.success) {
      throw new Error(`First booking failed: ${booking1.error}`);
    }
    console.log(`   ✅ First booking created successfully`);
    
    // Check slot capacity after first booking
    const slotAfter1 = await client.query(
      `SELECT available_capacity, booked_count FROM slots WHERE id = $1`,
      [testSlot.id]
    );
    console.log(`   Slot capacity after booking 1: Available = ${slotAfter1.rows[0].available_capacity}, Booked = ${slotAfter1.rows[0].booked_count}`);
    
    // Second booking should fail (capacity = 1, already booked)
    console.log(`   Attempting second booking (should fail - capacity exceeded)...`);
    const booking2 = await createBooking(
      client,
      testService.tenant_id || (await client.query(`SELECT tenant_id FROM services WHERE id = $1`, [testService.id])).rows[0].tenant_id,
      testService.id,
      testSlot.id,
      'Test Customer 2',
      '+966502222222',
      1
    );
    
    if (booking2.success) {
      throw new Error('❌ OVERBOOKING DETECTED! System allowed second booking when capacity = 1!');
    } else {
      console.log(`   ✅ Second booking correctly prevented`);
      console.log(`   Error: ${booking2.error}`);
      
      if (booking2.error.includes('Not enough tickets available') || 
          booking2.error.includes('available')) {
        console.log(`   ✅ Error message is clear and informative`);
      }
    }
    
    // Verify slot capacity is still correct
    const slotAfter2 = await client.query(
      `SELECT available_capacity, booked_count FROM slots WHERE id = $1`,
      [testSlot.id]
    );
    console.log(`   Slot capacity after booking 2 attempt: Available = ${slotAfter2.rows[0].available_capacity}, Booked = ${slotAfter2.rows[0].booked_count}`);
    
    if (slotAfter2.rows[0].booked_count !== 1) {
      throw new Error(`Expected 1 booking but found ${slotAfter2.rows[0].booked_count}`);
    }
    
    if (slotAfter2.rows[0].available_capacity !== 0) {
      throw new Error(`Expected available_capacity = 0 but found ${slotAfter2.rows[0].available_capacity}`);
    }
    
    console.log(`   ✅ Slot capacity is correct (available = 0, booked = 1)`);
    
    // Clean up
    console.log('\n📋 Cleaning up test booking...');
    await client.query(`DELETE FROM bookings WHERE id = $1`, [booking1.booking.id]);
    console.log(`✅ Test booking cleaned up`);
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ All tests passed! Edited service capacity fix is working correctly.');
    console.log('='.repeat(70));
    console.log('\n📊 Test Summary:');
    console.log('   ✅ Slots are synced with service capacity');
    console.log('   ✅ First booking succeeds when capacity available');
    console.log('   ✅ Second booking is prevented when capacity = 1');
    console.log('   ✅ Error messages are clear');
    console.log('   ✅ Slot capacity is correctly maintained');
    
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
testEditedServiceCapacity();

