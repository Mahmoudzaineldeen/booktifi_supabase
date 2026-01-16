import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function applyMigration() {
  const client = await pool.connect();
  
  try {
    console.log('📦 Applying service offers migration...\n');
    
    await client.query('BEGIN');
    
    // Read migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/20251130000000_create_service_offers.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Verify service_offers table was created
    const tableResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'service_offers'
    `);
    
    if (tableResult.rows.length > 0) {
      console.log('✅ service_offers table created successfully!');
    } else {
      console.warn('⚠️  service_offers table might already exist or was not created');
    }
    
    // Verify offer_id column was added to bookings
    const columnResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name = 'offer_id'
    `);
    
    if (columnResult.rows.length > 0) {
      console.log('✅ offer_id column added to bookings table!\n');
      console.log('📋 Column details:');
      columnResult.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
    } else {
      throw new Error('offer_id column was not created in bookings table');
    }
    
    // Verify indexes were created
    const indexResult = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename IN ('service_offers', 'bookings')
        AND indexname IN (
          'idx_service_offers_service_id',
          'idx_service_offers_tenant_id',
          'idx_service_offers_is_active',
          'idx_bookings_offer_id'
        )
      ORDER BY indexname
    `);
    
    if (indexResult.rows.length > 0) {
      console.log('\n📋 Created indexes:');
      indexResult.rows.forEach(row => {
        console.log(`   - ${row.indexname}`);
      });
    }
    
    await client.query('COMMIT');
    
    console.log('\n✅ Service offers migration is ready!');
    console.log('\n⚠️  Next steps:');
    console.log('   1. Restart backend server');
    console.log('   2. Test offer creation in admin panel');
    console.log('   3. Test booking with offer selection');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration();



