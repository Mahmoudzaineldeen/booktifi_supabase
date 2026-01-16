import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function checkServiceSchedule() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking service schedule for "سطح المراقبة في برج خليفة"\n');
    console.log('='.repeat(70));
    
    // Find the service
    const serviceResult = await client.query(`
      SELECT s.id, s.name, s.name_ar, s.service_capacity_per_slot
      FROM services s
      WHERE s.name LIKE '%Burj Khalifa%' 
         OR s.name_ar LIKE '%برج خليفة%'
         OR s.name LIKE '%Observation Deck%'
      LIMIT 1
    `);
    
    if (serviceResult.rows.length === 0) {
      throw new Error('Service not found');
    }
    
    const service = serviceResult.rows[0];
    console.log(`✅ Found service: ${service.name} (${service.name_ar})`);
    console.log(`   Service ID: ${service.id}`);
    console.log(`   Capacity: ${service.service_capacity_per_slot}\n`);
    
    // Get shifts for this service
    const shiftsResult = await client.query(`
      SELECT 
        sh.id,
        sh.days_of_week,
        sh.start_time_utc,
        sh.end_time_utc,
        sh.is_active
      FROM shifts sh
      WHERE sh.service_id = $1
      ORDER BY sh.created_at
    `, [service.id]);
    
    console.log(`📅 Shifts found: ${shiftsResult.rows.length}\n`);
    
    if (shiftsResult.rows.length === 0) {
      console.log('❌ No shifts found for this service!');
      return;
    }
    
    // Display each shift
    shiftsResult.rows.forEach((shift, index) => {
      console.log(`Shift ${index + 1}:`);
      console.log(`  ID: ${shift.id}`);
      console.log(`  Days of week: [${shift.days_of_week.join(', ')}]`);
      console.log(`  Time: ${shift.start_time_utc} - ${shift.end_time_utc}`);
      console.log(`  Active: ${shift.is_active}`);
      
      // Map days to names
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayNamesAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const days = shift.days_of_week.map(d => `${d} (${dayNames[d]}/${dayNamesAr[d]})`).join(', ');
      console.log(`  Days: ${days}\n`);
    });
    
    // Check slots for next 7 days
    console.log('📊 Checking slots for next 7 days:\n');
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    
    const slotsResult = await client.query(`
      SELECT 
        sl.slot_date,
        EXTRACT(DOW FROM sl.slot_date)::integer as day_of_week,
        COUNT(*) as slot_count,
        SUM(sl.available_capacity) as total_available,
        SUM(sl.booked_count) as total_booked
      FROM slots sl
      JOIN shifts sh ON sl.shift_id = sh.id
      WHERE sh.service_id = $1
        AND sl.slot_date >= CURRENT_DATE
        AND sl.slot_date <= $2
      GROUP BY sl.slot_date
      ORDER BY sl.slot_date
      LIMIT 7
    `, [service.id, nextWeek.toISOString().split('T')[0]]);
    
    console.log(`Found ${slotsResult.rows.length} days with slots:\n`);
    slotsResult.rows.forEach(row => {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = dayNames[row.day_of_week];
      console.log(`  ${row.slot_date} (${dayName}, DOW=${row.day_of_week}):`);
      console.log(`    Slots: ${row.slot_count}`);
      console.log(`    Available: ${row.total_available}`);
      console.log(`    Booked: ${row.total_booked}`);
      
      // Check if this day matches any shift
      const matchingShifts = shiftsResult.rows.filter(sh => 
        sh.is_active && sh.days_of_week.includes(row.day_of_week)
      );
      if (matchingShifts.length === 0) {
        console.log(`    ⚠️  WARNING: No active shift matches this day (DOW=${row.day_of_week})!`);
      } else {
        console.log(`    ✅ Matches ${matchingShifts.length} shift(s)`);
      }
      console.log('');
    });
    
    // Check for days that should have slots but don't
    console.log('🔍 Checking for missing slots (days that should have slots but don\'t):\n');
    const shiftDays = new Set();
    shiftsResult.rows.forEach(sh => {
      if (sh.is_active) {
        sh.days_of_week.forEach(day => shiftDays.add(day));
      }
    });
    
    console.log(`Active shift days: [${Array.from(shiftDays).sort().join(', ')}]`);
    
    // Check next 14 days
    for (let i = 0; i < 14; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() + i);
      const dayOfWeek = checkDate.getDay(); // 0 = Sunday
      const dateStr = checkDate.toISOString().split('T')[0];
      
      if (shiftDays.has(dayOfWeek)) {
        const hasSlots = slotsResult.rows.some(row => row.slot_date === dateStr);
        if (!hasSlots) {
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          console.log(`  ⚠️  ${dateStr} (${dayNames[dayOfWeek]}, DOW=${dayOfWeek}): Should have slots but none found!`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ Check complete!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the check
checkServiceSchedule();







