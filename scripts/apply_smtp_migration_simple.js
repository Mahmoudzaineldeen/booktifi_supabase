// Simple script to apply SMTP migration using direct database connection
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../server/.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function applyMigration() {
  console.log('📧 Applying SMTP settings migration...\n');

  const client = await pool.connect();
  
  try {
    // Check if column exists
    const checkResult = await client.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'tenants' AND column_name = 'smtp_settings'
    `);

    if (checkResult.rows.length > 0) {
      console.log('✅ Column smtp_settings already exists. Migration not needed.');
      return;
    }

    // Add column
    console.log('Adding smtp_settings column...');
    await client.query(`
      ALTER TABLE tenants ADD COLUMN smtp_settings jsonb DEFAULT NULL;
    `);

    // Add comment
    await client.query(`
      COMMENT ON COLUMN tenants.smtp_settings IS 'SMTP configuration for email sending: {smtp_host, smtp_port, smtp_user, smtp_password}';
    `);

    console.log('✅ Migration applied successfully!');
    console.log('   Column smtp_settings added to tenants table.\n');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration();

