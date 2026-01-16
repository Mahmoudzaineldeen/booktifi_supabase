import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'bookati',
  user: 'postgres',
  password: 'postgres'
});

async function checkFunction() {
  try {
    const result = await pool.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_name = 'get_active_locks_for_slots'
    `);
    
    console.log('Function exists:', result.rows.length > 0);
    
    if (result.rows.length === 0) {
      console.log('⚠️  Function get_active_locks_for_slots does not exist in database');
      console.log('The endpoint will use direct query instead.');
    } else {
      console.log('✅ Function exists');
    }
    
    // Test the direct query approach
    const testResult = await pool.query(`
      SELECT slot_id, lock_expires_at 
      FROM booking_locks
      WHERE slot_id = ANY($1::uuid[])
        AND lock_expires_at > now()
      LIMIT 1
    `, [[]]);
    
    console.log('✅ Direct query approach works');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkFunction();

