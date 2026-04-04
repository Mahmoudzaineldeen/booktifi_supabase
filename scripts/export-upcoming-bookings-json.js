/**
 * Export upcoming bookings for a tenant to JSON.
 *
 * Upcoming window:
 * - slot_date >= "today" in tenant timezone (fallback: Asia/Riyadh)
 * - no upper bound (includes up to the farthest future booking)
 *
 * Usage:
 *   node scripts/export-upcoming-bookings-json.js [tenant-email]
 *
 * Example:
 *   node scripts/export-upcoming-bookings-json.js healingtouches_sa@hotmail.com
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

function getTodayInTz(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
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

async function findTenant(email) {
  const { data: tenantByContact } = await supabase
    .from('tenants')
    .select('id,name,slug,contact_email,tenant_time_zone,announced_time_zone')
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
    .select('id,name,slug,contact_email,tenant_time_zone,announced_time_zone')
    .eq('id', userByEmail.tenant_id)
    .maybeSingle();
  return tenant || null;
}

function formatStampLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}${mi}${ss}`;
}

async function run() {
  console.log(`Resolving tenant: ${TENANT_EMAIL}`);
  const tenant = await findTenant(TENANT_EMAIL);
  if (!tenant?.id) {
    console.error(`No tenant found for email: ${TENANT_EMAIL}`);
    process.exit(1);
  }

  const tenantId = tenant.id;
  const timeZone = tenant.tenant_time_zone || tenant.announced_time_zone || 'Asia/Riyadh';
  const today = getTodayInTz(timeZone);

  console.log(`Tenant found: ${tenant.name || 'N/A'} (${tenantId})`);
  console.log(`Timezone: ${timeZone}, today: ${today}`);

  const bookings = await selectAllByEq(
    'bookings',
    'tenant_id',
    tenantId,
    'id,slot_id,employee_id,service_id,status,payment_status,total_price,customer_name,customer_phone,customer_email,visitor_count,notes,created_at,updated_at,tenant_id'
  );
  const slots = await selectAllByEq('slots', 'tenant_id', tenantId, 'id,slot_date,start_time,end_time');
  const users = await selectAllByEq('users', 'tenant_id', tenantId, 'id,full_name,full_name_ar,email');
  const services = await selectAllByEq('services', 'tenant_id', tenantId, 'id,name,name_ar');

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const serviceById = new Map(services.map((s) => [s.id, s]));

  const upcoming = bookings
    .map((b) => {
      const slot = slotById.get(b.slot_id);
      if (!slot) return null;
      if (!slot.slot_date || slot.slot_date < today) return null;
      const employee = userById.get(b.employee_id) || null;
      const service = serviceById.get(b.service_id) || null;
      return {
        booking_id: b.id,
        tenant_id: b.tenant_id,
        slot_id: b.slot_id,
        slot_date: slot.slot_date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        employee_id: b.employee_id,
        employee_name: employee?.full_name || employee?.full_name_ar || '',
        employee_email: employee?.email || '',
        service_id: b.service_id,
        service_name: service?.name || service?.name_ar || '',
        status: b.status,
        payment_status: b.payment_status,
        total_price: b.total_price,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        customer_email: b.customer_email,
        visitor_count: b.visitor_count,
        notes: b.notes,
        created_at_utc: b.created_at,
        updated_at_utc: b.updated_at,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.slot_date !== b.slot_date) return String(a.slot_date).localeCompare(String(b.slot_date));
      if (a.start_time !== b.start_time) return String(a.start_time).localeCompare(String(b.start_time));
      return String(a.booking_id).localeCompare(String(b.booking_id));
    });

  const lastUpcomingCreatedAtUtc =
    upcoming.length > 0
      ? [...upcoming].sort((a, b) => String(a.created_at_utc).localeCompare(String(b.created_at_utc))).at(-1)
          ?.created_at_utc || null
      : null;

  const payload = {
    exported_at_utc: new Date().toISOString(),
    tenant_email: TENANT_EMAIL,
    tenant_id: tenantId,
    tenant_name: tenant.name || null,
    tenant_slug: tenant.slug || null,
    tenant_timezone: timeZone,
    filter: {
      slot_date_from: today,
      slot_date_to: 'last upcoming booking date',
      meaning: 'All bookings where slot_date >= today in tenant timezone',
    },
    counts: {
      total_bookings: bookings.length,
      upcoming_bookings: upcoming.length,
    },
    last_upcoming_created_at_utc: lastUpcomingCreatedAtUtc,
    upcoming_bookings: upcoming,
  };

  const outDir = join(__dirname, '..', 'reports');
  mkdirSync(outDir, { recursive: true });
  const outFile = `upcoming_bookings_${TENANT_EMAIL.replace(/[^a-z0-9@._-]/gi, '_')}_${formatStampLocal()}.json`;
  const outPath = join(outDir, outFile);
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Upcoming bookings: ${upcoming.length}`);
  console.log(`JSON: ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
