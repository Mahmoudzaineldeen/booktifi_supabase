// Script to apply discount fields migration
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
    console.log('Applying discount fields migration...\n');
    
    const migrationSQL = `
-- Add original_price field for discount pricing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'original_price'
  ) THEN
    ALTER TABLE services ADD COLUMN original_price numeric(10, 2);
    RAISE NOTICE 'Added original_price column';
  ELSE
    RAISE NOTICE 'original_price column already exists';
  END IF;
END $$;

-- Add discount_percentage field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'discount_percentage'
  ) THEN
    ALTER TABLE services ADD COLUMN discount_percentage integer;
    RAISE NOTICE 'Added discount_percentage column';
  ELSE
    RAISE NOTICE 'discount_percentage column already exists';
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN services.original_price IS 'Original price before discount';
COMMENT ON COLUMN services.discount_percentage IS 'Discount percentage (0-100)';
    `;

    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');
    
  } catch (error) {
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





















