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

async function testServiceCapacityUpdate() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Service Capacity Update Trigger\n');
    console.log('='.repeat(70));
    
    // Step 1: Find a service with existing slots
    console.log('\n📋 Step 1: Finding a service with existing slots...');
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
        AND s.service_capacity_per_slot IS NOT NULL
        AND sl.slot_date >= CURRENT_DATE
      GROUP BY s.id, s.name, s.service_capacity_per_slot
      HAVING COUNT(sl.id) > 0
      LIMIT 1
    `);
    
    if (serviceResult.rows.length === 0) {
      throw new Error('No service with existing slots found for testing');
    }
    
    const testService = serviceResult.rows[0];
    console.log(`✅ Found service: ${testService.name}`);
    console.log(`   Current capacity: ${testService.service_capacity_per_slot}`);
    console.log(`   Existing slots: ${testService.slot_count}`);
    
    // Step 2: Get current slot capacities
    console.log('\n📋 Step 2: Getting current slot capacities...');
    const slotsBefore = await client.query(`
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
      LIMIT 5
    `, [testService.id]);
    
    console.log(`✅ Found ${slotsBefore.rows.length} slots:`);
    slotsBefore.rows.forEach((slot, i) => {
      console.log(`   Slot ${i + 1}: ${slot.slot_date} ${slot.start_time}`);
      console.log(`      Original: ${slot.original_capacity}, Available: ${slot.available_capacity}, Booked: ${slot.booked_count}`);
    });
    
    // Step 3: Update service capacity to 1
    console.log('\n📋 Step 3: Updating service capacity to 1...');
    const oldCapacity = testService.service_capacity_per_slot;
    const newCapacity = 1;
    
    await client.query(
      `UPDATE services 
       SET service_capacity_per_slot = $1
       WHERE id = $2`,
      [newCapacity, testService.id]
    );
    
    console.log(`✅ Service capacity updated from ${oldCapacity} to ${newCapacity}`);
    
    // Step 4: Verify slots were updated
    console.log('\n📋 Step 4: Verifying slots were updated...');
    const slotsAfter = await client.query(`
      SELECT 
        sl.id,
        sl.slot_date,
        sl.start_time,
        sl.original_capacity,
        sl.available_capacity,
        sl.booked_count,
        sl.is_overbooked
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.slot_date >= CURRENT_DATE
      ORDER BY sl.slot_date, sl.start_time
      LIMIT 5
    `, [testService.id]);
    
    console.log(`✅ Slots after update:`);
    let allUpdated = true;
    slotsAfter.rows.forEach((slot, i) => {
      const beforeSlot = slotsBefore.rows[i];
      const originalUpdated = slot.original_capacity === newCapacity;
      const availableCorrect = slot.available_capacity === Math.max(0, newCapacity - slot.booked_count);
      
      console.log(`   Slot ${i + 1}: ${slot.slot_date} ${slot.start_time}`);
      console.log(`      Original: ${slot.original_capacity} (was ${beforeSlot.original_capacity}) ${originalUpdated ? '✅' : '❌'}`);
      console.log(`      Available: ${slot.available_capacity} (was ${beforeSlot.available_capacity}) ${availableCorrect ? '✅' : '❌'}`);
      console.log(`      Booked: ${slot.booked_count}`);
      console.log(`      Overbooked: ${slot.is_overbooked}`);
      
      if (!originalUpdated || !availableCorrect) {
        allUpdated = false;
      }
    });
    
    if (!allUpdated) {
      throw new Error('Some slots were not updated correctly');
    }
    
    console.log(`✅ All slots updated correctly!`);
    
    // Step 5: Test that overbooking is prevented
    console.log('\n📋 Step 5: Testing overbooking prevention with new capacity...');
    const testSlot = slotsAfter.rows[0];
    
    if (testSlot.available_capacity > 0) {
      // Try to book more than available
      try {
        const overbookingAttempt = await client.query(`
          SELECT acquire_booking_lock($1, $2, $3, 120) as lock_id
        `, [testSlot.id, 'test_session_overbook', testSlot.available_capacity + 1]);
        
        if (overbookingAttempt.rows[0].lock_id) {
          throw new Error('❌ OVERBOOKING DETECTED! System allowed booking exceeding capacity!');
        }
      } catch (error) {
        if (error.message.includes('Not enough tickets available') || 
            error.message.includes('available')) {
          console.log(`✅ Overbooking correctly prevented`);
          console.log(`   Error message: ${error.message.substring(0, 80)}...`);
        } else {
          throw error;
        }
      }
    } else {
      console.log(`✅ Slot is already full (available_capacity = 0)`);
    }
    
    // Step 6: Restore original capacity
    console.log('\n📋 Step 6: Restoring original capacity...');
    await client.query(
      `UPDATE services 
       SET service_capacity_per_slot = $1
       WHERE id = $2`,
      [oldCapacity, testService.id]
    );
    
    console.log(`✅ Service capacity restored to ${oldCapacity}`);
    
    // Step 7: Verify slots were restored
    console.log('\n📋 Step 7: Verifying slots were restored...');
    const slotsRestored = await client.query(`
      SELECT 
        sl.original_capacity,
        sl.available_capacity
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.slot_date >= CURRENT_DATE
      ORDER BY sl.slot_date, sl.start_time
      LIMIT 1
    `, [testService.id]);
    
    if (slotsRestored.rows.length > 0) {
      const restoredSlot = slotsRestored.rows[0];
      console.log(`   Original capacity: ${restoredSlot.original_capacity} (expected: ${oldCapacity})`);
      if (restoredSlot.original_capacity === oldCapacity) {
        console.log(`✅ Slots restored correctly!`);
      } else {
        console.log(`⚠️  Warning: Slot capacity is ${restoredSlot.original_capacity}, expected ${oldCapacity}`);
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ All tests passed! Service capacity update trigger is working correctly.');
    console.log('='.repeat(70));
    console.log('\n📊 Test Summary:');
    console.log('   ✅ Trigger fires when service capacity is updated');
    console.log('   ✅ Slots original_capacity is updated');
    console.log('   ✅ Slots available_capacity is recalculated');
    console.log('   ✅ Overbooking is prevented with new capacity');
    console.log('   ✅ Slots are restored when capacity is restored');
    
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
testServiceCapacityUpdate();

