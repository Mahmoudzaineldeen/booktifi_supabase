/**
 * Export duplicate/overlap/suspicious booking pairs for a tenant to CSV.
 *
 * Rules implemented:
 * 1) DUPLICATE_EXACT_SAME_SERVICE:
 *    same employee + same date + same service + same start/end time
 * 2) DUPLICATE_TIME_OVERLAP:
 *    same employee + same date + overlapping time windows
 * 3) SUSPICIOUS_ONE_HOUR_APART:
 *    same employee + same date + start times differ by exactly 60 minutes
 *
 * Usage:
 *   node scripts/export-booking-duplicates-suspicious.js [tenant-email]
 *
 * Example:
 *   node scripts/export-booking-duplicates-suspicious.js healingtouches_sa@hotmail.com
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_*) in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TENANT_EMAIL = (process.argv[2] || 'healingtouches_sa@hotmail.com').trim().toLowerCase();

function parseTimeToMinutes(timeStr) {
  // Expected HH:mm:ss (or HH:mm)
  const parts = (timeStr || '').split(':').map((x) => Number(x));
  const h = Number.isFinite(parts[0]) ? parts[0] : 0;
  const m = Number.isFinite(parts[1]) ? parts[1] : 0;
  return h * 60 + m;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

async function selectAllByEq(table, column, value, columns = '*') {
  const out = [];
  const pageSize = 1000;
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq(column, value)
      .range(from, to);

    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    page += 1;
  }

  return out;
}

async function findTenantIdByEmail(email) {
  const { data: tenantByContact } = await supabase
    .from('tenants')
    .select('id,contact_email,name')
    .ilike('contact_email', email)
    .limit(1)
    .maybeSingle();

  if (tenantByContact?.id) return tenantByContact;

  const { data: userByEmail } = await supabase
    .from('users')
    .select('tenant_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();

  if (!userByEmail?.tenant_id) return null;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id,contact_email,name')
    .eq('id', userByEmail.tenant_id)
    .maybeSingle();

  return tenant || null;
}

function getTimeWindow(slot) {
  const start = parseTimeToMinutes(slot.start_time);
  let end = parseTimeToMinutes(slot.end_time);
  // Handle overnight slots (e.g. 23:00 -> 00:00)
  if (end <= start) end += 24 * 60;
  return { start, end };
}

function overlaps(w1, w2) {
  return w1.start < w2.end && w2.start < w1.end;
}

function sameServiceAndExactWindow(a, b) {
  return (
    a.service_id &&
    b.service_id &&
    a.service_id === b.service_id &&
    a.slot.start_time === b.slot.start_time &&
    a.slot.end_time === b.slot.end_time
  );
}

function isSuspiciousOneHourApart(w1, w2) {
  return Math.abs(w1.start - w2.start) === 60;
}

async function run() {
  console.log(`Resolving tenant: ${TENANT_EMAIL}`);
  const tenant = await findTenantIdByEmail(TENANT_EMAIL);

  if (!tenant?.id) {
    console.error(`No tenant found for email: ${TENANT_EMAIL}`);
    process.exit(1);
  }

  const tenantId = tenant.id;
  console.log(`Tenant found: ${tenant.name || 'N/A'} (${tenantId})`);

  console.log('Loading bookings...');
  const bookings = await selectAllByEq(
    'bookings',
    'tenant_id',
    tenantId,
    'id,tenant_id,slot_id,employee_id,service_id,status,payment_status,total_price,customer_name,customer_phone,customer_email,created_at'
  );
  console.log(`Bookings loaded: ${bookings.length}`);

  const slots = await selectAllByEq('slots', 'tenant_id', tenantId, 'id,slot_date,start_time,end_time');
  const users = await selectAllByEq('users', 'tenant_id', tenantId, 'id,full_name,full_name_ar');
  const services = await selectAllByEq('services', 'tenant_id', tenantId, 'id,name,name_ar');

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const serviceById = new Map(services.map((s) => [s.id, s]));

  const enriched = bookings
    .map((b) => {
      const slot = slotById.get(b.slot_id);
      if (!slot) return null;
      return { ...b, slot };
    })
    .filter(Boolean);

  const byEmployeeDate = new Map();
  for (const b of enriched) {
    if (!b.employee_id || !b.slot?.slot_date) continue;
    const key = `${b.employee_id}|${b.slot.slot_date}`;
    if (!byEmployeeDate.has(key)) byEmployeeDate.set(key, []);
    byEmployeeDate.get(key).push(b);
  }

  const rows = [];
  const seenPairCategory = new Set();

  for (const [, group] of byEmployeeDate) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        const aWindow = getTimeWindow(a.slot);
        const bWindow = getTimeWindow(b.slot);

        const exactSameService = sameServiceAndExactWindow(a, b);
        const hasOverlap = overlaps(aWindow, bWindow);
        const suspiciousHourApart = isSuspiciousOneHourApart(aWindow, bWindow);

        const categories = [];
        if (exactSameService) categories.push('DUPLICATE_EXACT_SAME_SERVICE');
        // If exact same service/time is true, overlap is naturally true.
        if (!exactSameService && hasOverlap) categories.push('DUPLICATE_TIME_OVERLAP');
        if (suspiciousHourApart) categories.push('SUSPICIOUS_ONE_HOUR_APART');

        if (!categories.length) continue;

        for (const category of categories) {
          const orderedIds = [a.id, b.id].sort();
          const dedupeKey = `${category}|${orderedIds[0]}|${orderedIds[1]}`;
          if (seenPairCategory.has(dedupeKey)) continue;
          seenPairCategory.add(dedupeKey);

          const employee = userById.get(a.employee_id);
          const serviceA = serviceById.get(a.service_id);
          const serviceB = serviceById.get(b.service_id);
          const activePair =
            a.status !== 'cancelled' && b.status !== 'cancelled' ? 'yes' : 'no';

          rows.push({
            category,
            tenant_email: TENANT_EMAIL,
            tenant_id: tenantId,
            employee_id: a.employee_id,
            employee_name: employee?.full_name || employee?.full_name_ar || '',
            slot_date: a.slot.slot_date,
            active_non_cancelled_pair: activePair,
            booking_a_id: a.id,
            booking_a_created_at_utc: a.created_at,
            booking_a_start_time: a.slot.start_time,
            booking_a_end_time: a.slot.end_time,
            booking_a_service_id: a.service_id || '',
            booking_a_service_name: serviceA?.name || serviceA?.name_ar || '',
            booking_a_status: a.status || '',
            booking_a_payment_status: a.payment_status || '',
            booking_a_total_price: a.total_price ?? '',
            booking_a_customer_name: a.customer_name || '',
            booking_a_customer_phone: a.customer_phone || '',
            booking_a_customer_email: a.customer_email || '',
            booking_b_id: b.id,
            booking_b_created_at_utc: b.created_at,
            booking_b_start_time: b.slot.start_time,
            booking_b_end_time: b.slot.end_time,
            booking_b_service_id: b.service_id || '',
            booking_b_service_name: serviceB?.name || serviceB?.name_ar || '',
            booking_b_status: b.status || '',
            booking_b_payment_status: b.payment_status || '',
            booking_b_total_price: b.total_price ?? '',
            booking_b_customer_name: b.customer_name || '',
            booking_b_customer_phone: b.customer_phone || '',
            booking_b_customer_email: b.customer_email || '',
            overlap_minutes:
              hasOverlap
                ? Math.max(0, Math.min(aWindow.end, bWindow.end) - Math.max(aWindow.start, bWindow.start))
                : 0,
            start_time_diff_minutes: Math.abs(aWindow.start - bWindow.start),
          });
        }
      }
    }
  }

  rows.sort((x, y) => {
    if (x.slot_date !== y.slot_date) return String(x.slot_date).localeCompare(String(y.slot_date));
    if (x.employee_name !== y.employee_name) return String(x.employee_name).localeCompare(String(y.employee_name));
    if (x.booking_a_start_time !== y.booking_a_start_time) {
      return String(x.booking_a_start_time).localeCompare(String(y.booking_a_start_time));
    }
    return String(x.booking_b_start_time).localeCompare(String(y.booking_b_start_time));
  });

  const headers = [
    'category',
    'tenant_email',
    'tenant_id',
    'employee_id',
    'employee_name',
    'slot_date',
    'active_non_cancelled_pair',
    'booking_a_id',
    'booking_a_created_at_utc',
    'booking_a_start_time',
    'booking_a_end_time',
    'booking_a_service_id',
    'booking_a_service_name',
    'booking_a_status',
    'booking_a_payment_status',
    'booking_a_total_price',
    'booking_a_customer_name',
    'booking_a_customer_phone',
    'booking_a_customer_email',
    'booking_b_id',
    'booking_b_created_at_utc',
    'booking_b_start_time',
    'booking_b_end_time',
    'booking_b_service_id',
    'booking_b_service_name',
    'booking_b_status',
    'booking_b_payment_status',
    'booking_b_total_price',
    'booking_b_customer_name',
    'booking_b_customer_phone',
    'booking_b_customer_email',
    'overlap_minutes',
    'start_time_diff_minutes',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    const line = headers.map((h) => csvEscape(row[h])).join(',');
    lines.push(line);
  }

  const outDir = join(__dirname, '..', 'reports');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = join(outDir, `bookings_duplicates_suspicious_${TENANT_EMAIL.replace(/[^a-z0-9@._-]/gi, '_')}_${stamp}.csv`);
  writeFileSync(outPath, lines.join('\n'), 'utf8');

  const byCategory = rows.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {});

  console.log('\nDone.');
  console.log(`CSV: ${outPath}`);
  console.log(`Rows: ${rows.length}`);
  console.log('By category:', byCategory);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
