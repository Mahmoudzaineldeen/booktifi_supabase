// Script to apply QR scanned columns migration
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function applyMigration() {
  const client = await pool.connect();
  
  try {
    console.log('Applying QR scanned columns migration...\n');
    
    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251215000002_add_qr_scanned_to_bookings.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    await client.query('BEGIN');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Verify columns were created
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'bookings' 
      AND column_name IN ('qr_scanned', 'qr_scanned_at', 'qr_scanned_by_user_id')
      ORDER BY column_name
    `);
    
    if (result.rows.length === 3) {
      console.log('✅ Migration applied successfully!\n');
      console.log('📋 Column details:');
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default || 'none'})`);
      });
      
      await client.query('COMMIT');
      console.log('\n✅ QR scanning migration is complete!');
    } else {
      await client.query('ROLLBACK');
      throw new Error(`Expected 3 columns, but found ${result.rows.length}`);
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error applying migration:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


