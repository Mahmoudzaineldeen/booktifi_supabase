/**
 * List available slots for Isabletia and Marivick for today,
 * for tenant healingtouches_sa@hotmail.com.
 *
 * Uses the same logic as the app (bookingAvailability.ts):
 *   - is_available, available_capacity > 0
 *   - Exclude slots with active booking_locks
 *   - Only slots whose shift allows this weekday (days_of_week)
 *   - For today: only slots with start_time > current time (future only)
 *
 * Run from project root:
 *   node scripts/list-available-slots-healingtouches.js
 *
 * Requires DATABASE_URL in .env (or server/.env).
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root or server
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set in .env');
  process.exit(1);
}
// Use SSL only when explicitly requested (e.g. DATABASE_SSL=true for Supabase)
const useSsl = process.env.DATABASE_SSL === 'true';
const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

const TENANT_EMAIL = 'healingtouches_sa@hotmail.com';
const EMPLOYEE_NAMES = ['Isabletia', 'Marivick'];

function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = String(timeStr).split(':').map(Number);
  const hours = h % 12 || 12;
  const period = h >= 12 ? 'PM' : 'AM';
  return `${hours}:${String(m || 0).padStart(2, '0')} ${period}`;
}

async function main() {
  const client = await pool.connect();
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    console.log('\n=== Available slots for Isabletia & Marivick (today) ===\n');
    console.log(`Tenant email: ${TENANT_EMAIL}`);
    console.log(`Date: ${todayStr}\n`);

    // 1. Get tenant_id by contact_email
    const tenantRes = await client.query(
      `SELECT id, name FROM tenants WHERE contact_email = $1 LIMIT 1`,
      [TENANT_EMAIL]
    );
    if (tenantRes.rows.length === 0) {
      console.log('No tenant found with contact_email:', TENANT_EMAIL);
      return;
    }
    const tenant = tenantRes.rows[0];
    const tenantId = tenant.id;
    console.log(`Tenant: ${tenant.name || tenantId}\n`);

    // 2. Get employee IDs for Isabletia and Marivick (match by full_name)
    const employeeRes = await client.query(
      `SELECT id, full_name, full_name_ar FROM users
       WHERE tenant_id = $1 AND role = 'employee'
         AND (full_name ILIKE $2 OR full_name ILIKE $3 OR full_name_ar ILIKE $2 OR full_name_ar ILIKE $3)`,
      [tenantId, `%${EMPLOYEE_NAMES[0]}%`, `%${EMPLOYEE_NAMES[1]}%`]
    );
    if (employeeRes.rows.length === 0) {
      console.log('No employees found matching Isabletia or Marivick. All users with role=employee:');
      const allEmp = await client.query(
        `SELECT id, full_name, full_name_ar FROM users WHERE tenant_id = $1 AND role = 'employee'`,
        [tenantId]
      );
      allEmp.rows.forEach((u) => console.log(`  - ${u.full_name} (${u.full_name_ar || '-'})`));
      return;
    }
    const employeeIds = employeeRes.rows.map((r) => r.id);
    console.log('Employees:');
    employeeRes.rows.forEach((r) => console.log(`  - ${r.full_name} (${r.full_name_ar || '-'}) id=${r.id}`));
    console.log('');

    // 3. Get available slots (same logic as app: shift days, no locks, for today future-only)
    const slotsRes = await client.query(
      `SELECT s.id, s.slot_date, s.start_time, s.end_time, s.available_capacity, s.booked_count,
              s.employee_id, u.full_name, u.full_name_ar
       FROM slots s
       JOIN users u ON u.id = s.employee_id
       JOIN shifts sh ON sh.id = s.shift_id AND sh.is_active = true
       WHERE s.tenant_id = $1
         AND s.employee_id = ANY($2)
         AND s.slot_date = $3::date
         AND s.is_available = true
         AND s.available_capacity > 0
         AND (EXTRACT(DOW FROM s.slot_date)::integer) = ANY(sh.days_of_week)
         AND NOT EXISTS (
           SELECT 1 FROM booking_locks bl
           WHERE bl.slot_id = s.id AND bl.lock_expires_at > now()
         )
         AND (s.slot_date <> $3::date OR s.start_time > (CURRENT_TIMESTAMP)::time)
       ORDER BY s.start_time`,
      [tenantId, employeeIds, todayStr]
    );

    console.log(`=== Available slots today (${todayStr}) — matches system display ===\n`);
    if (slotsRes.rows.length === 0) {
      console.log('No available slots found (same as UI: future only, not locked, shift day matches).');
      return;
    }
    slotsRes.rows.forEach((slot, i) => {
      const timeDisplay = formatTime12h(slot.start_time);
      console.log(
        `${i + 1}. ${timeDisplay} (${slot.start_time})  |  ${slot.full_name || slot.full_name_ar || 'Unknown'}  |  ${slot.available_capacity} spot(s) left  |  slot_id: ${slot.id}`
      );
    });
    console.log(`\nTotal: ${slotsRes.rows.length} slot(s)\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
