// Script to apply package_id migration directly
import { query } from '../server/src/db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyMigration() {
  try {
    console.log('Applying package_id migration...\n');
    
    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251216000000_add_package_id_to_bookings.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await query(migrationSQL);
    
    // Verify column was created
    const result = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'bookings' 
      AND column_name = 'package_id'
    `);
    
    if (result.rows.length > 0) {
      console.log('✓ Migration applied successfully!\n');
      console.log('Column details:');
      result.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
    } else {
      console.log('⚠ Column may already exist or migration did not create it.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error applying migration:', error.message);
    console.error(error);
    process.exit(1);
  }
}

applyMigration();

import { query } from '../server/src/db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyMigration() {
  try {
    console.log('Applying package_id migration...\n');
    
    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251216000000_add_package_id_to_bookings.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await query(migrationSQL);
    
    // Verify column was created
    const result = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'bookings' 
      AND column_name = 'package_id'
    `);
    
    if (result.rows.length > 0) {
      console.log('✓ Migration applied successfully!\n');
      console.log('Column details:');
      result.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
    } else {
      console.log('⚠ Column may already exist or migration did not create it.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error applying migration:', error.message);
    console.error(error);
    process.exit(1);
  }
}

applyMigration();


