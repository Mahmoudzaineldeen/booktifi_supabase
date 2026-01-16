/**
 * Script to fix phone number formats in the database
 * Converts local format (01032560826) to international format (+201032560826)
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

/**
 * Convert phone number to international format
 * @param {string} phone - Phone number in any format
 * @returns {string|null} - Phone number in international format (+XXXXXXXXXX) or null if invalid
 */
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove all spaces and dashes
  let cleaned = phone.replace(/[\s-]/g, '');

  // If already in international format (+20...), return as is
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // If starts with 00, replace with +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2);
    return cleaned;
  }

  // Egyptian numbers: 01XXXXXXXX (10 digits after 0) -> +201XXXXXXXX
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const withoutZero = cleaned.substring(1);
    if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
      return `+20${withoutZero}`;
    }
  }

  // If starts with 20 (country code without +), add +
  if (cleaned.startsWith('20') && cleaned.length >= 12) {
    return `+${cleaned}`;
  }

  // If it's already 11 digits starting with 1, 2, or 5 (Egyptian mobile), add +20
  if (cleaned.length === 10 && (cleaned.startsWith('1') || cleaned.startsWith('2') || cleaned.startsWith('5'))) {
    return `+20${cleaned}`;
  }

  // If it's 11 digits starting with 1, 2, or 5 (without leading 0), add +20
  if (cleaned.length === 11 && (cleaned.startsWith('1') || cleaned.startsWith('2') || cleaned.startsWith('5'))) {
    return `+20${cleaned}`;
  }

  // Return null if we can't determine the format
  return null;
}

async function fixPhoneNumbers() {
  console.log('\n📱 ============================================');
  console.log('📱 Fixing Phone Number Formats');
  console.log('📱 ============================================\n');

  try {
    // Get all users with phone numbers
    const result = await pool.query(`
      SELECT id, phone, email, full_name 
      FROM users 
      WHERE phone IS NOT NULL AND phone != ''
      ORDER BY created_at DESC
    `);

    console.log(`Found ${result.rows.length} users with phone numbers\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of result.rows) {
      const oldPhone = user.phone;
      const newPhone = normalizePhoneNumber(oldPhone);

      if (!newPhone) {
        console.log(`⚠️  Skipping user ${user.id} (${user.email || user.full_name}): Cannot normalize "${oldPhone}"`);
        skipped++;
        continue;
      }

      if (oldPhone === newPhone) {
        console.log(`✓ User ${user.id} (${user.email || user.full_name}): Already in correct format "${oldPhone}"`);
        skipped++;
        continue;
      }

      try {
        await pool.query(
          'UPDATE users SET phone = $1 WHERE id = $2',
          [newPhone, user.id]
        );
        console.log(`✅ Updated user ${user.id} (${user.email || user.full_name}):`);
        console.log(`   Old: "${oldPhone}"`);
        console.log(`   New: "${newPhone}"`);
        updated++;
      } catch (error) {
        console.error(`❌ Error updating user ${user.id}:`, error.message);
        errors++;
      }
    }

    console.log('\n📊 ============================================');
    console.log('📊 Summary');
    console.log('📊 ============================================');
    console.log(`Total users: ${result.rows.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log('============================================\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixPhoneNumbers();

