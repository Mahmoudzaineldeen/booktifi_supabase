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

async function checkSlots() {
  const serviceId = 'fcb65a2a-da3d-449f-8101-031f21748bcf';
  const targetDate = '2026-01-05'; // Sunday
  
  console.log(`\nChecking slots for service: ${serviceId}`);
  console.log(`Target date: ${targetDate} (Sunday, day 0)\n`);
  
  const client = await pool.connect();
  
  try {
    // Get service info
    const serviceResult = await client.query(`
      SELECT id, name, duration_minutes, capacity_per_slot
      FROM services
      WHERE id = $1
    `, [serviceId]);
    
    if (serviceResult.rows.length === 0) {
      console.log('❌ Service not found');
      return;
    }
    
    const service = serviceResult.rows[0];
    console.log(`Service: ${service.name}`);
    console.log(`Duration: ${service.duration_minutes} minutes`);
    console.log(`Capacity: ${service.capacity_per_slot}\n`);
    
    // Get shifts for this service
    const shiftsResult = await client.query(`
      SELECT id, days_of_week, start_time_utc, end_time_utc, is_active
      FROM shifts
      WHERE service_id = $1
      ORDER BY created_at
    `, [serviceId]);
    
    console.log(`Found ${shiftsResult.rows.length} shift(s):\n`);
    
    for (const shift of shiftsResult.rows) {
      console.log(`Shift ID: ${shift.id}`);
      console.log(`  Days of week: [${shift.days_of_week.join(', ')}]`);
      console.log(`  Time: ${shift.start_time_utc} - ${shift.end_time_utc}`);
      console.log(`  Active: ${shift.is_active}`);
      
      // Check if Sunday (0) is in days_of_week
      if (shift.days_of_week.includes(0)) {
        console.log(`  ✅ Includes Sunday`);
      } else {
        console.log(`  ❌ Does NOT include Sunday`);
      }
      console.log('');
    }
    
    // Get slots for the target date
    const slotsResult = await client.query(`
      SELECT 
        sl.id,
        sl.slot_date,
        sl.start_time,
        sl.end_time,
        sl.available_capacity,
        sl.booked_count,
        sl.shift_id,
        sh.days_of_week
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.slot_date = $2
      ORDER BY sl.start_time
    `, [serviceId, targetDate]);
    
    console.log(`Slots for ${targetDate}: ${slotsResult.rows.length}\n`);
    
    if (slotsResult.rows.length > 0) {
      for (const slot of slotsResult.rows) {
        console.log(`  Slot: ${slot.start_time} - ${slot.end_time}`);
        console.log(`    Capacity: ${slot.available_capacity}, Booked: ${slot.booked_count}`);
        console.log(`    Shift days: [${slot.days_of_week.join(', ')}]`);
      }
    } else {
      console.log('  No slots found for this date.');
      console.log('  This is expected if Sunday is not in the shift\'s days_of_week.');
    }
    
    // Check slots for nearby dates (Mon-Fri)
    console.log(`\nChecking slots for the week:\n`);
    
    const weekResult = await client.query(`
      SELECT 
        sl.slot_date,
        COUNT(*) as slot_count,
        MIN(sl.start_time) as first_slot,
        MAX(sl.end_time) as last_slot
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.slot_date >= $2
        AND sl.slot_date < $2::date + interval '7 days'
      GROUP BY sl.slot_date
      ORDER BY sl.slot_date
    `, [serviceId, targetDate]);
    
    for (const day of weekResult.rows) {
      const date = new Date(day.slot_date);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = dayNames[date.getDay()];
      console.log(`  ${day.slot_date} (${dayName}): ${day.slot_count} slots (${day.first_slot} - ${day.last_slot})`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSlots();


