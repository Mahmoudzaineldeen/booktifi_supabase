/**
 * Create a disposable tenant with trial_ends_at in the past, run expire_due_tenant_trials(),
 * print results, then delete the row (unless --keep).
 *
 * Usage:
 *   node tests/scripts/create-trial-expiry-test-tenant.mjs
 *   node tests/scripts/create-trial-expiry-test-tenant.mjs --keep
 *
 * Env: SUPABASE_URL or VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '..', 'server', '.env') });

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const keep = process.argv.includes('--keep');

if (!url || !key) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).');
  process.exit(1);
}

const supabase = createClient(url, key);
const suffix = `${Date.now()}`;
const slug = `trial-expiry-script-${suffix}`.slice(0, 60);

const pastEnd = new Date(Date.now() - 3_600_000).toISOString();

const { data: tenant, error: insErr } = await supabase
  .from('tenants')
  .insert({
    name: 'Script: trial expiry test tenant',
    name_ar: 'مستأجر اختبار انتهاء التجربة',
    slug,
    industry: 'test',
    is_active: true,
    public_page_enabled: true,
    trial_ends_at: pastEnd,
    trial_status: 'active',
    trial_countdown_enabled: true,
  })
  .select('id, slug, trial_ends_at, is_active, trial_status')
  .single();

if (insErr || !tenant) {
  console.error('Insert failed:', insErr?.message || insErr);
  process.exit(1);
}

console.log('Created test tenant:', tenant);

const { data: n, error: rpcErr } = await supabase.rpc('expire_due_tenant_trials');
if (rpcErr) {
  console.error('expire_due_tenant_trials failed:', rpcErr.message);
  if (!keep) await supabase.from('tenants').delete().eq('id', tenant.id);
  process.exit(1);
}

console.log('expire_due_tenant_trials() returned count:', n);

const { data: after, error: readErr } = await supabase
  .from('tenants')
  .select('id, slug, is_active, trial_status, trial_ends_at')
  .eq('id', tenant.id)
  .single();

if (readErr) {
  console.error('Read failed:', readErr.message);
  if (!keep) await supabase.from('tenants').delete().eq('id', tenant.id);
  process.exit(1);
}

console.log('After RPC:', after);
const ok = after.is_active === false && after.trial_status === 'expired';
console.log(ok ? 'OK: tenant deactivated (is_active=false, trial_status=expired).' : 'FAIL: expected inactive + expired.');

if (!keep) {
  await supabase.from('tenants').delete().eq('id', tenant.id);
  console.log('Deleted test tenant. Pass --keep to leave it in the DB for manual UI checks.');
} else {
  console.log('Kept test tenant id:', tenant.id, '(delete from tenants when finished)');
}

process.exit(ok ? 0 : 1);
