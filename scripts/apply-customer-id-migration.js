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
    console.log('📦 Applying customer_id migration...\n');
    
    await client.query('BEGIN');
    
    // Read migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/20251129000000_add_customer_id_to_bookings.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Verify column was created
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name = 'customer_id'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Migration applied successfully!\n');
      console.log('📋 Column details:');
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
      
      // Verify index was created
      const indexResult = await client.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'bookings' AND indexname = 'idx_bookings_customer_id'
      `);
      
      if (indexResult.rows.length > 0) {
        console.log('\n📋 Index created:');
        console.log(`   - ${indexResult.rows[0].indexname}`);
      }
    } else {
      throw new Error('Column customer_id was not created');
    }
    
    await client.query('COMMIT');
    
    console.log('\n✅ Customer ID migration is ready!');
    console.log('\n⚠️  Next steps:');
    console.log('   1. Restart backend server');
    console.log('   2. Test booking creation with logged-in user');
    console.log('   3. Verify bookings appear in customer dashboard');
    
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







