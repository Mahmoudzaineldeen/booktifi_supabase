import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function applyMigration() {
  const client = await pool.connect();
  
  try {
    console.log('📦 Applying booking lock migration...\n');
    
    await client.query('BEGIN');
    
    // Read migration file
    const migrationPath = path.join(__dirname, '../database/migrations/add_booking_lock_functions.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Verify functions were created
    const result = await client.query(`
      SELECT 
        routine_name,
        routine_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN (
          'acquire_booking_lock',
          'validate_booking_lock',
          'cleanup_expired_locks',
          'get_active_locks_for_slots'
        )
      ORDER BY routine_name
    `);
    
    console.log('✅ Migration applied successfully!\n');
    console.log('📋 Created functions:');
    result.rows.forEach(row => {
      console.log(`   - ${row.routine_name} (${row.routine_type})`);
    });
    
    // Verify indexes
    const indexResult = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'booking_locks'
      ORDER BY indexname
    `);
    
    console.log('\n📋 Created indexes:');
    indexResult.rows.forEach(row => {
      console.log(`   - ${row.indexname}`);
    });
    
    await client.query('COMMIT');
    
    console.log('\n✅ Booking lock mechanism is ready!');
    console.log('\n⚠️  Next steps:');
    console.log('   1. Restart backend server');
    console.log('   2. Refresh frontend');
    console.log('   3. Test booking flow');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration();

