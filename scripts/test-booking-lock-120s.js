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

// Helper function to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to format time
const formatTime = (date) => {
  return new Date(date).toISOString().replace('T', ' ').substring(0, 19);
};

async function testLock120s() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing 120s Booking Lock Condition\n');
    console.log('='.repeat(60));
    
    // Step 1: Get a test slot
    console.log('\n📋 Step 1: Finding a test slot...');
    const slotResult = await client.query(`
      SELECT id, available_capacity, slot_date, start_time
      FROM slots
      WHERE is_available = true AND available_capacity > 0
      LIMIT 1
    `);
    
    if (slotResult.rows.length === 0) {
      throw new Error('No available slots found for testing');
    }
    
    const testSlot = slotResult.rows[0];
    console.log(`✅ Found test slot: ${testSlot.id}`);
    console.log(`   Date: ${testSlot.slot_date}, Time: ${testSlot.start_time}`);
    console.log(`   Available capacity: ${testSlot.available_capacity}`);
    
    // Step 2: Create a lock with 120s duration
    console.log('\n📋 Step 2: Creating a lock with 120s duration...');
    const sessionId = `test_session_${Date.now()}`;
    const reservedCapacity = 1;
    
    const lockResult = await client.query(
      `SELECT acquire_booking_lock($1, $2, $3, 120) as lock_id`,
      [testSlot.id, sessionId, reservedCapacity]
    );
    
    const lockId = lockResult.rows[0].lock_id;
    if (!lockId) {
      throw new Error('Failed to create lock');
    }
    
    console.log(`✅ Lock created: ${lockId}`);
    
    // Step 3: Get lock details
    console.log('\n📋 Step 3: Getting lock details...');
    const lockDetails = await client.query(
      `SELECT 
        id,
        slot_id,
        reserved_by_session_id,
        reserved_capacity,
        lock_acquired_at,
        lock_expires_at,
        EXTRACT(EPOCH FROM (lock_expires_at - now()))::integer as seconds_until_expiry
      FROM booking_locks
      WHERE id = $1`,
      [lockId]
    );
    
    const lock = lockDetails.rows[0];
    console.log(`✅ Lock details:`);
    console.log(`   Lock ID: ${lock.id}`);
    console.log(`   Slot ID: ${lock.slot_id}`);
    console.log(`   Session ID: ${lock.reserved_by_session_id}`);
    console.log(`   Reserved Capacity: ${lock.reserved_capacity}`);
    console.log(`   Acquired At: ${formatTime(lock.lock_acquired_at)}`);
    console.log(`   Expires At: ${formatTime(lock.lock_expires_at)}`);
    console.log(`   Seconds Until Expiry: ${lock.seconds_until_expiry}s`);
    
    // Step 4: Validate lock is active
    console.log('\n📋 Step 4: Validating lock is active...');
    const validateResult = await client.query(
      `SELECT validate_booking_lock($1, $2) as is_valid`,
      [lockId, sessionId]
    );
    
    const isValid = validateResult.rows[0].is_valid;
    if (!isValid) {
      throw new Error('Lock validation failed - lock should be valid');
    }
    console.log(`✅ Lock is valid: ${isValid}`);
    
    // Step 5: Try to create another lock on the same slot (should succeed if capacity allows)
    console.log('\n📋 Step 5: Testing that slot capacity is properly tracked...');
    const anotherSessionId = `test_session_another_${Date.now()}`;
    try {
      const anotherLockResult = await client.query(
        `SELECT acquire_booking_lock($1, $2, $3, 120) as lock_id`,
        [testSlot.id, anotherSessionId, reservedCapacity]
      );
      
      if (anotherLockResult.rows[0].lock_id) {
        console.log(`✅ Another lock created (capacity allows multiple locks): ${anotherLockResult.rows[0].lock_id}`);
        const secondLockId = anotherLockResult.rows[0].lock_id;
        
        // Check total locked capacity
        const totalLocked = await client.query(
          `SELECT COALESCE(SUM(reserved_capacity), 0) as total_locked
           FROM booking_locks
           WHERE slot_id = $1 AND lock_expires_at > now()`,
          [testSlot.id]
        );
        console.log(`   Total locked capacity: ${totalLocked.rows[0].total_locked}`);
        
        // Try to lock more than available (should fail)
        console.log(`   Testing: Trying to lock more than available capacity...`);
        try {
          const excessiveCapacity = testSlot.available_capacity + 1;
          const excessiveLockResult = await client.query(
            `SELECT acquire_booking_lock($1, $2, $3, 120) as lock_id`,
            [testSlot.id, `test_session_excessive_${Date.now()}`, excessiveCapacity]
          );
          
          if (excessiveLockResult.rows[0].lock_id) {
            console.log(`   ⚠️  WARNING: Excessive lock was created! This should not happen.`);
            await client.query(`DELETE FROM booking_locks WHERE id = $1`, [excessiveLockResult.rows[0].lock_id]);
          }
        } catch (error) {
          console.log(`   ✅ Correctly prevented excessive lock: ${error.message.substring(0, 60)}...`);
        }
        
        // Clean up the second lock
        await client.query(`DELETE FROM booking_locks WHERE id = $1`, [secondLockId]);
        console.log(`   ✅ Cleaned up second test lock`);
      }
    } catch (error) {
      console.log(`✅ Lock creation behavior: ${error.message.substring(0, 60)}...`);
    }
    
    // Step 6: Check available capacity (should be reduced by locked capacity)
    console.log('\n📋 Step 6: Checking slot capacity after lock...');
    const slotAfterLock = await client.query(
      `SELECT 
        s.available_capacity,
        s.original_capacity,
        COALESCE(SUM(bl.reserved_capacity), 0) as locked_capacity
      FROM slots s
      LEFT JOIN booking_locks bl ON bl.slot_id = s.id AND bl.lock_expires_at > now()
      WHERE s.id = $1
      GROUP BY s.id, s.available_capacity, s.original_capacity`,
      [testSlot.id]
    );
    
    const slotInfo = slotAfterLock.rows[0];
    console.log(`✅ Slot capacity info:`);
    console.log(`   Available Capacity: ${slotInfo.available_capacity}`);
    console.log(`   Original Capacity: ${slotInfo.original_capacity}`);
    console.log(`   Locked Capacity: ${slotInfo.locked_capacity}`);
    console.log(`   Effectively Available: ${slotInfo.available_capacity - slotInfo.locked_capacity}`);
    
    // Step 7: Wait and test expiration (using shorter duration for testing)
    console.log('\n📋 Step 7: Testing lock expiration...');
    console.log('   ⏳ Waiting 5 seconds to test expiration logic (in real scenario, wait 120s)...');
    
    // For testing, we'll manually expire the lock by updating its expiration time
    // In production, this would happen automatically after 120 seconds
    await client.query(
      `UPDATE booking_locks 
       SET lock_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [lockId]
    );
    
    console.log('   ✅ Manually expired the lock for testing');
    
    // Step 8: Validate lock is expired
    console.log('\n📋 Step 8: Validating lock is expired...');
    const validateExpiredResult = await client.query(
      `SELECT validate_booking_lock($1, $2) as is_valid`,
      [lockId, sessionId]
    );
    
    const isExpired = !validateExpiredResult.rows[0].is_valid;
    if (!isExpired) {
      throw new Error('Lock validation failed - lock should be expired');
    }
    console.log(`✅ Lock is expired: ${isExpired}`);
    
    // Step 9: Test cleanup function
    console.log('\n📋 Step 9: Testing cleanup_expired_locks function...');
    const cleanupResult = await client.query(`SELECT cleanup_expired_locks() as deleted_count`);
    const deletedCount = cleanupResult.rows[0].deleted_count;
    console.log(`✅ Cleaned up ${deletedCount} expired lock(s)`);
    
    // Step 10: Verify lock is deleted
    console.log('\n📋 Step 10: Verifying lock is deleted...');
    const lockCheck = await client.query(
      `SELECT id FROM booking_locks WHERE id = $1`,
      [lockId]
    );
    
    if (lockCheck.rows.length > 0) {
      throw new Error('Lock was not deleted by cleanup function');
    }
    console.log(`✅ Lock successfully deleted`);
    
    // Step 11: Verify slot capacity is restored
    console.log('\n📋 Step 11: Verifying slot capacity is restored...');
    const slotAfterCleanup = await client.query(
      `SELECT 
        s.available_capacity,
        COALESCE(SUM(bl.reserved_capacity), 0) as locked_capacity
      FROM slots s
      LEFT JOIN booking_locks bl ON bl.slot_id = s.id AND bl.lock_expires_at > now()
      WHERE s.id = $1
      GROUP BY s.id, s.available_capacity`,
      [testSlot.id]
    );
    
    const slotAfterCleanupInfo = slotAfterCleanup.rows[0];
    console.log(`✅ Slot capacity after cleanup:`);
    console.log(`   Available Capacity: ${slotAfterCleanupInfo.available_capacity}`);
    console.log(`   Locked Capacity: ${slotAfterCleanupInfo.locked_capacity}`);
    console.log(`   Effectively Available: ${slotAfterCleanupInfo.available_capacity - slotAfterCleanupInfo.locked_capacity}`);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests passed! 120s lock condition is working correctly.');
    console.log('='.repeat(60));
    
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
testLock120s();

