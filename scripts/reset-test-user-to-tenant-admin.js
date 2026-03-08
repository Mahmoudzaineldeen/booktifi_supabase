#!/usr/bin/env node

/**
 * Reset test user (test@gmail.com) to tenant_admin so the RBAC validation script
 * can run with a single account. Run this if the validation script fails with
 * "Insufficient permissions to manage roles".
 *
 * Usage: node scripts/reset-test-user-to-tenant-admin.js
 * Requires: server/.env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_URL + key)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_EMAIL || 'test@gmail.com';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or Supabase key. Set in server/.env');
  process.exit(1);
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data, error } = await supabase
    .from('users')
    .update({ role: 'tenant_admin', role_id: null })
    .eq('email', EMAIL)
    .not('tenant_id', 'is', null)
    .select('id, email, role, role_id');

  if (error) {
    console.error('Update failed:', error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log(`No user found with email ${EMAIL} and tenant_id set. Nothing changed.`);
    return;
  }
  console.log('Updated to tenant_admin:', data[0]);
  console.log('You can now run: node scripts/validate-rbac-permissions.js');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
