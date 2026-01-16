// Script to apply adult_count and child_count migration
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
    console.log('Applying adult_count and child_count migration...\n');
    
    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251215000001_add_adult_child_to_bookings.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    await client.query('BEGIN');
    
    // Temporarily disable triggers that might cause issues
    await client.query('ALTER TABLE bookings DISABLE TRIGGER ALL');
    
    try {
      // Execute migration
      await client.query(migrationSQL);
    } finally {
      // Re-enable triggers
      await client.query('ALTER TABLE bookings ENABLE TRIGGER ALL');
    }
    
    // Verify columns were created
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'bookings' 
      AND column_name IN ('adult_count', 'child_count')
      ORDER BY column_name
    `);
    
    if (result.rows.length === 2) {
      console.log('✅ Migration applied successfully!\n');
      console.log('📋 Column details:');
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default || 'none'})`);
      });
      
      // Check if constraints exist
      const constraintResult = await client.query(`
        SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints
        WHERE table_name = 'bookings' 
        AND constraint_name IN ('bookings_adult_count_check', 'bookings_child_count_check', 'bookings_visitor_count_check')
        ORDER BY constraint_name
      `);
      
      if (constraintResult.rows.length > 0) {
        console.log('\n📋 Constraints created:');
        constraintResult.rows.forEach(row => {
          console.log(`   - ${row.constraint_name}: ${row.constraint_type}`);
        });
      }
      
      await client.query('COMMIT');
      console.log('\n✅ Adult/Child migration is complete!');
    } else {
      await client.query('ROLLBACK');
      throw new Error(`Expected 2 columns, but found ${result.rows.length}`);
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

