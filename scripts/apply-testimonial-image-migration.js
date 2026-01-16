// Script to apply testimonial image_url migration
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

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
    console.log('Applying testimonial image_url migration...');
    
    await client.query('BEGIN');
    
    // Read migration file
    const migrationPath = join(__dirname, '..', 'database', 'migrations', 'add_testimonial_image_field.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await client.query(migrationSQL);
    
    await client.query('COMMIT');
    
    console.log('✅ Migration applied successfully!');
    console.log('   - Added image_url column to reviews table');
    console.log('   - Created index for image_url');
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

