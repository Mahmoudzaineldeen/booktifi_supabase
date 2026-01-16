// Script to apply package_id migration
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function applyMigration() {
  const client = await pool.connect();
  
  try {
    console.log('Applying package_id migration...\n');
    
    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251216000000_add_package_id_to_bookings.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    await client.query('BEGIN');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Verify column was created
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'bookings' 
      AND column_name = 'package_id'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Migration applied successfully!\n');
      console.log('📋 Column details:');
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default || 'none'})`);
      });
      
      await client.query('COMMIT');
      console.log('\n✅ Package ID migration is complete!');
    } else {
      await client.query('ROLLBACK');
      throw new Error('Column package_id was not created');
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error applying migration:', error.message);
    console.error(error);
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

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function applyMigration() {
  const client = await pool.connect();
  
  try {
    console.log('Applying package_id migration...\n');
    
    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251216000000_add_package_id_to_bookings.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    await client.query('BEGIN');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Verify column was created
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'bookings' 
      AND column_name = 'package_id'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Migration applied successfully!\n');
      console.log('📋 Column details:');
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default || 'none'})`);
      });
      
      await client.query('COMMIT');
      console.log('\n✅ Package ID migration is complete!');
    } else {
      await client.query('ROLLBACK');
      throw new Error('Column package_id was not created');
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error applying migration:', error.message);
    console.error(error);
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
