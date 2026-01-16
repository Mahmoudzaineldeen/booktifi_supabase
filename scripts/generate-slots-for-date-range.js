#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../server/.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function generateSlotsForDateRange(startDate, endDate) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  GENERATE SLOTS FOR DATE RANGE');
  console.log('='.repeat(60));
  console.log(`\nStart Date: ${startDate}`);
  console.log(`End Date: ${endDate}\n`);
  
  const client = await pool.connect();
  
  try {
    // Get all active shifts
    const shiftsResult = await client.query(`
      SELECT 
        sh.id,
        sh.service_id,
        s.name as service_name,
        t.name as tenant_name
      FROM shifts sh
      JOIN services s ON sh.service_id = s.id
      JOIN tenants t ON sh.tenant_id = t.id
      WHERE sh.is_active = true
      ORDER BY t.name, s.name
    `);

    if (shiftsResult.rows.length === 0) {
      console.log('No active shifts found.\n');
      return;
    }

    console.log(`Found ${shiftsResult.rows.length} active shifts\n`);

    let totalSlots = 0;

    for (const shift of shiftsResult.rows) {
      try {
        const slotsResult = await client.query(`
          SELECT generate_slots_for_shift($1, $2::date, $3::date)
        `, [shift.id, startDate, endDate]);

        const slotCount = slotsResult.rows[0].generate_slots_for_shift;
        totalSlots += slotCount;

        console.log(`  ✓ ${shift.tenant_name} > ${shift.service_name}: ${slotCount} slots`);

      } catch (error) {
        console.error(`  ✗ Error for ${shift.service_name}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Generated ${totalSlots} slots for ${shiftsResult.rows.length} shifts`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('\nUsage: node generate-slots-for-date-range.js START_DATE END_DATE');
  console.log('Example: node generate-slots-for-date-range.js 2026-01-01 2026-12-31\n');
  process.exit(1);
}

const startDate = args[0];
const endDate = args[1];

// Validate dates
const startDateObj = new Date(startDate);
const endDateObj = new Date(endDate);

if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
  console.error('\n❌ Invalid date format. Use YYYY-MM-DD format.\n');
  process.exit(1);
}

if (startDateObj > endDateObj) {
  console.error('\n❌ Start date must be before end date.\n');
  process.exit(1);
}

generateSlotsForDateRange(startDate, endDate).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


