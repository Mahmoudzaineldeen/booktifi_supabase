/**
 * Delete all bookings for a tenant identified by provider/admin email.
 * Related rows (payments, zoho_invoice_logs, package_usage) are removed by DB CASCADE.
 *
 * Usage: node scripts/delete-tenant-bookings.js <email>
 * Example: node scripts/delete-tenant-bookings.js healingtouches_sa@hotmail.com
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

const EMAIL = (process.argv[2] || '').trim().toLowerCase();
if (!EMAIL) {
  console.error('Usage: node scripts/delete-tenant-bookings.js <tenant-provider-email>');
  process.exit(1);
}

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

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('id', tenantId)
    .single();

  if (!tenant) {
    console.error('Tenant record not found');
    process.exit(1);
  }

  const { data: bookings, error: listErr } = await supabase
    .from('bookings')
    .select('id')
    .eq('tenant_id', tenantId);

  if (listErr) {
    console.error('Failed to list bookings:', listErr.message);
    process.exit(1);
  }

  const count = bookings?.length ?? 0;
  if (count === 0) {
    console.log(`No bookings found for tenant "${tenant.name}" (${tenant.slug}).`);
    return;
  }

  const { error: deleteErr } = await supabase
    .from('bookings')
    .delete()
    .eq('tenant_id', tenantId);

  if (deleteErr) {
    console.error('Delete failed:', deleteErr.message);
    process.exit(1);
  }

  console.log(`Deleted ${count} booking(s) for tenant "${tenant.name}" (${tenant.slug}).`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
