/**
 * Apply migration to fix bookings.customer_id foreign key constraint
 * 
 * This fixes the foreign key to reference customers(id) instead of users(id)
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    process.env.SUPABASE_DB_URL || 
    'postgresql://postgres:postgres@localhost:54322/postgres',
});

async function applyMigration() {
  const client = await pool.connect();
  
  try {
    console.log('📦 Applying fix for bookings.customer_id foreign key constraint...\n');
    
    await client.query('BEGIN');
    
    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20260131000008_fix_bookings_customer_id_fkey.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Verify constraint was fixed
    const result = await client.query(`
      SELECT 
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'bookings'
        AND kcu.column_name = 'customer_id'
    `);
    
    if (result.rows.length > 0) {
      const constraint = result.rows[0];
      console.log('✅ Migration applied successfully!\n');
      console.log('📋 Constraint details:');
      console.log(`   - Constraint: ${constraint.constraint_name}`);
      console.log(`   - Column: ${constraint.column_name}`);
      console.log(`   - References: ${constraint.foreign_table_name}.${constraint.foreign_column_name}`);
      
      if (constraint.foreign_table_name === 'customers') {
        console.log('\n✅ Foreign key correctly references customers table!');
      } else {
        console.log(`\n⚠️  Warning: Foreign key references ${constraint.foreign_table_name} instead of customers`);
      }
    } else {
      console.log('⚠️  No foreign key constraint found on bookings.customer_id');
      console.log('   (This may be expected if the column is nullable and no constraint was set)');
    }
    
    await client.query('COMMIT');
    
    console.log('\n✅ Migration complete!');
    console.log('\n💡 You can now run your test again:');
    console.log('   node tests/test-package-financial-behavior.js');
    
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
