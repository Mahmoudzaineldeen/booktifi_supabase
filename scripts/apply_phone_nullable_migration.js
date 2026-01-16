/**
 * Script to make phone column nullable in otp_requests table
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function applyMigration() {
  console.log('\n📱 ============================================');
  console.log('📱 Making phone column nullable in otp_requests');
  console.log('📱 ============================================\n');

  try {
    // Check current constraint
    const checkResult = await pool.query(`
      SELECT 
        column_name, 
        is_nullable,
        data_type
      FROM information_schema.columns 
      WHERE table_name = 'otp_requests' 
      AND column_name = 'phone'
    `);

    if (checkResult.rows.length === 0) {
      console.log('❌ phone column does not exist in otp_requests table');
      process.exit(1);
    }

    const currentNullable = checkResult.rows[0].is_nullable;
    console.log(`Current phone column nullable status: ${currentNullable}`);

    if (currentNullable === 'YES') {
      console.log('✅ phone column is already nullable. No changes needed.');
      await pool.end();
      return;
    }

    // Remove NOT NULL constraint
    await pool.query('ALTER TABLE otp_requests ALTER COLUMN phone DROP NOT NULL');
    console.log('✅ Successfully removed NOT NULL constraint from phone column');

    // Verify the change
    const verifyResult = await pool.query(`
      SELECT is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'otp_requests' 
      AND column_name = 'phone'
    `);

    if (verifyResult.rows[0].is_nullable === 'YES') {
      console.log('✅ Verification: phone column is now nullable');
    } else {
      console.log('❌ Verification failed: phone column is still NOT NULL');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();

