/**
 * Backup all data for a tenant (provider) identified by admin/contact email.
 * Usage: node scripts/backup-tenant-by-email.js [email]
 * Example: node scripts/backup-tenant-by-email.js healingtouches_sa@hotmail.com
 *
 * Requires .env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY)
 * Output: backups/tenant-backup-{slug}-{YYYY-MM-DD-HHmmss}.json
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

const PROVIDER_EMAIL = (process.argv[2] || process.env.BACKUP_TENANT_EMAIL || '').trim().toLowerCase();
if (!PROVIDER_EMAIL) {
  console.error('Usage: node scripts/backup-tenant-by-email.js <provider-email>');
  console.error('Example: node scripts/backup-tenant-by-email.js healingtouches_sa@hotmail.com');
  process.exit(1);
}

async function findTenantId() {
  const { data: user } = await supabase
    .from('users')
    .select('tenant_id')
    .ilike('email', PROVIDER_EMAIL)
    .limit(1)
    .maybeSingle();

  if (user?.tenant_id) return user.tenant_id;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .ilike('contact_email', PROVIDER_EMAIL)
    .limit(1)
    .maybeSingle();

  if (tenant?.id) return tenant.id;

  console.error(`No tenant found for email: ${PROVIDER_EMAIL}`);
  process.exit(1);
}

async function selectAll(table, column, value) {
  const out = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select('*').eq(column, value).range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    page++;
  }
  return out;
}

async function selectIn(table, column, ids) {
  if (!ids.length) return [];
  const out = [];
  const chunk = 500;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data, error } = await supabase.from(table).select('*').in(column, slice);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (data) out.push(...data);
  }
  return out;
}

async function run() {
  console.log(`Resolving tenant for: ${PROVIDER_EMAIL}`);
  const tenantId = await findTenantId();

  const { data: tenantRow, error: tenantErr } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single();

  if (tenantErr || !tenantRow) {
    console.error('Tenant row not found:', tenantErr?.message);
    process.exit(1);
  }

  const slug = (tenantRow.slug || tenantId.slice(0, 8)).replace(/[^a-z0-9-_]/gi, '-');
  console.log(`Tenant: ${tenantRow.name} (${slug}), id: ${tenantId}`);

  const backup = {
    exported_at: new Date().toISOString(),
    provider_email: PROVIDER_EMAIL,
    tenant_id: tenantId,
    tenant_slug: slug,
    data: {},
  };

  const tablesByTenantId = [
    'tenants',
    'users',
    'service_categories',
    'services',
    'service_offers',
    'shifts',
    'employee_services',
    'slots',
    'customers',
    'bookings',
    'service_packages',
    'package_subscriptions',
    'tenant_features',
    'zoho_tokens',
    'zoho_invoice_logs',
    'tenant_zoho_configs',
    'reviews',
    'testimonials',
    'audit_logs',
    'payments',
    'sms_logs',
    'branches',
  ];

  for (const table of tablesByTenantId) {
    process.stdout.write(`  ${table}...`);
    try {
      if (table === 'tenants') {
        backup.data[table] = [tenantRow];
      } else {
        backup.data[table] = await selectAll(table, 'tenant_id', tenantId);
      }
      console.log(` ${backup.data[table].length}`);
    } catch (e) {
      console.log(` error: ${e.message}`);
      backup.data[table] = [];
      backup._errors = backup._errors || {};
      backup._errors[table] = e.message;
    }
  }

  const packageIds = (backup.data.service_packages || []).map((p) => p.id);
  if (packageIds.length) {
    process.stdout.write('  package_services...');
    backup.data.package_services = await selectIn('package_services', 'package_id', packageIds);
    console.log(` ${backup.data.package_services.length}`);
  } else {
    backup.data.package_services = [];
  }

  const subIds = (backup.data.package_subscriptions || []).map((s) => s.id);
  if (subIds.length) {
    process.stdout.write('  package_usage...');
    try {
      backup.data.package_usage = await selectIn('package_usage', 'subscription_id', subIds);
    } catch {
      try {
        backup.data.package_usage = await selectIn('package_subscription_usage', 'subscription_id', subIds);
      } catch (e) {
        backup.data.package_usage = [];
        backup._errors = backup._errors || {};
        backup._errors.package_usage = e.message;
      }
    }
    console.log(` ${backup.data.package_usage.length}`);
  } else {
    backup.data.package_usage = [];
  }

  const branchIds = (backup.data.branches || []).map((b) => b.id);
  if (branchIds.length) {
    try {
      process.stdout.write('  service_branches...');
      backup.data.service_branches = await selectIn('service_branches', 'branch_id', branchIds);
      console.log(` ${backup.data.service_branches.length}`);
    } catch (e) {
      backup.data.service_branches = [];
      (backup._errors = backup._errors || {}).service_branches = e.message;
      console.log(` skip: ${e.message}`);
    }
    try {
      process.stdout.write('  package_branches...');
      backup.data.package_branches = await selectIn('package_branches', 'branch_id', branchIds);
      console.log(` ${backup.data.package_branches.length}`);
    } catch (e) {
      backup.data.package_branches = [];
      (backup._errors = backup._errors || {}).package_branches = e.message;
      console.log(` skip: ${e.message}`);
    }
  } else {
    backup.data.service_branches = [];
    backup.data.package_branches = [];
  }

  const slotIds = (backup.data.slots || []).map((s) => s.id);
  if (slotIds.length) {
    try {
      process.stdout.write('  booking_locks...');
      backup.data.booking_locks = await selectIn('booking_locks', 'slot_id', slotIds);
      console.log(` ${backup.data.booking_locks.length}`);
    } catch (e) {
      backup.data.booking_locks = [];
      (backup._errors = backup._errors || {}).booking_locks = e.message;
      console.log(` skip: ${e.message}`);
    }
  } else {
    backup.data.booking_locks = [];
  }

  const outDir = join(__dirname, '..', 'backups');
  mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `tenant-backup-${slug}-${timestamp}.json`;
  const filepath = join(outDir, filename);
  writeFileSync(filepath, JSON.stringify(backup, null, 2), 'utf8');

  console.log(`\nBackup written: ${filepath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
