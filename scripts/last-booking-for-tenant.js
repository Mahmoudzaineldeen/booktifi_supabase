/**
 * Get the last (most recent) booking for a tenant by contact email.
 * Usage: node scripts/last-booking-for-tenant.js [email]
 * Example: node scripts/last-booking-for-tenant.js healingtouches_sa@hotmail.com
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

const EMAIL = (process.argv[2] || 'healingtouches_sa@hotmail.com').trim().toLowerCase();

async function findTenantId() {
  const { data: user } = await supabase
    .from('users')
    .select('tenant_id')
    .ilike('email', EMAIL)
    .limit(1)
    .maybeSingle();
  if (user?.tenant_id) return user.tenant_id;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .ilike('contact_email', EMAIL)
    .limit(1)
    .maybeSingle();
  if (tenant?.id) return tenant.id;

  console.error(`No tenant found for email: ${EMAIL}`);
  process.exit(1);
}

async function run() {
  const tenantId = await findTenantId();

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id,
      customer_name,
      customer_phone,
      status,
      payment_status,
      total_price,
      created_at,
      slot:slots(slot_date, start_time, end_time)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Failed to fetch bookings:', error.message);
    process.exit(1);
  }

  if (!bookings?.length) {
    console.log(`No bookings found for tenant (${EMAIL}).`);
    return;
  }

  const b = bookings[0];
  const slot = Array.isArray(b.slot) ? b.slot[0] : b.slot;
  const slotDate = slot?.slot_date;
  const startTime = slot?.start_time;
  const endTime = slot?.end_time;

  console.log('Tenant:', EMAIL);
  console.log('Last booking (by created_at):');
  console.log('  Booking ID:', b.id);
  console.log('  Customer:', b.customer_name, b.customer_phone || '');
  console.log('  Status:', b.status, '| Payment:', b.payment_status);
  console.log('  Total price:', b.total_price);
  console.log('  Created at:', b.created_at);
  if (slotDate) {
    console.log('  Slot date:', slotDate);
    console.log('  Slot time:', startTime, '–', endTime);
    console.log('  Last booking time:', slotDate, startTime || '');
  }
}

run();
