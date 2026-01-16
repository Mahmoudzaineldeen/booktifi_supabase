#!/usr/bin/env node

/**
 * Create Missing Shifts and Slots Script
 * 
 * This script:
 * 1. Finds all services without shifts
 * 2. Creates default shifts for them (Monday-Friday, 9 AM - 6 PM)
 * 3. Generates slots for the next 60 days
 * 
 * Usage: node scripts/create-missing-shifts-and-slots.js
 */

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

async function createMissingShiftsAndSlots() {
  console.log('🔍 Finding services without shifts...\n');
  
  const client = await pool.connect();
  
  try {
    // Find all active services without shifts
    const servicesResult = await client.query(`
      SELECT 
        s.id,
        s.name,
        s.tenant_id,
        s.duration_minutes,
        s.capacity_per_slot,
        t.name as tenant_name
      FROM services s
      JOIN tenants t ON s.tenant_id = t.id
      LEFT JOIN shifts sh ON s.id = sh.service_id AND sh.is_active = true
      WHERE s.is_active = true
        AND sh.id IS NULL
      ORDER BY t.name, s.name
    `);

    if (servicesResult.rows.length === 0) {
      console.log('✅ All services have shifts!\n');
      return;
    }

    console.log(`Found ${servicesResult.rows.length} services without shifts:\n`);
    
    for (const service of servicesResult.rows) {
      console.log(`  - ${service.tenant_name} > ${service.name}`);
    }
    
    console.log('\n📅 Creating shifts and generating slots...\n');

    let shiftsCreated = 0;
    let slotsGenerated = 0;

    await client.query('BEGIN');

    for (const service of servicesResult.rows) {
      try {
        // Create default shift (Monday-Friday, 9 AM - 6 PM)
        const daysOfWeek = [1, 2, 3, 4, 5]; // Monday to Friday
        const startTime = '09:00:00';
        const endTime = '18:00:00';

        const shiftResult = await client.query(`
          INSERT INTO shifts (
            tenant_id,
            service_id,
            days_of_week,
            start_time_utc,
            end_time_utc,
            is_active
          ) VALUES ($1, $2, $3, $4, $5, true)
          RETURNING id
        `, [service.tenant_id, service.id, daysOfWeek, startTime, endTime]);

        const shiftId = shiftResult.rows[0].id;
        shiftsCreated++;

        console.log(`  ✓ Created shift for: ${service.name}`);

        // Generate slots for the next 60 days
        const today = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 60);

        const todayStr = today.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        const slotsResult = await client.query(`
          SELECT generate_slots_for_shift($1, $2::date, $3::date)
        `, [shiftId, todayStr, endDateStr]);

        const slotCount = slotsResult.rows[0].generate_slots_for_shift;
        slotsGenerated += slotCount;

        console.log(`    → Generated ${slotCount} slots`);

      } catch (error) {
        console.error(`  ✗ Error processing ${service.name}:`, error.message);
      }
    }

    await client.query('COMMIT');

    console.log('\n' + '='.repeat(60));
    console.log('✅ COMPLETE!');
    console.log('='.repeat(60));
    console.log(`  Shifts created: ${shiftsCreated}`);
    console.log(`  Slots generated: ${slotsGenerated}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function regenerateAllSlots() {
  console.log('🔄 Regenerating slots for all existing shifts...\n');
  
  const client = await pool.connect();
  
  try {
    // Find all active shifts
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
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 60);

    const todayStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    for (const shift of shiftsResult.rows) {
      try {
        const slotsResult = await client.query(`
          SELECT generate_slots_for_shift($1, $2::date, $3::date)
        `, [shift.id, todayStr, endDateStr]);

        const slotCount = slotsResult.rows[0].generate_slots_for_shift;
        totalSlots += slotCount;

        console.log(`  ✓ ${shift.tenant_name} > ${shift.service_name}: ${slotCount} slots`);

      } catch (error) {
        console.error(`  ✗ Error for ${shift.service_name}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Regenerated ${totalSlots} slots for ${shiftsResult.rows.length} shifts`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  CREATE MISSING SHIFTS AND SLOTS');
  console.log('='.repeat(60) + '\n');

  try {
    // Step 1: Create missing shifts and their slots
    await createMissingShiftsAndSlots();

    // Step 2: Regenerate slots for all existing shifts (in case they're empty)
    await regenerateAllSlots();

    console.log('✅ All done! Services should now have schedules.\n');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { createMissingShiftsAndSlots, regenerateAllSlots };

