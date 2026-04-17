/**
 * Integration: when free trial end time has passed, expire_due_tenant_trials() sets
 * trial_status = expired and is_active = false.
 *
 * Env is loaded in tests/setup.ts from `.env`, `.env.local`, and `server/.env` (override).
 * Needs: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).
 * Run: npm run test:integration:trial-expiry
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

const cfg = getSupabaseConfig();
const describeIntegration = cfg ? describe : describe.skip;

describeIntegration('Trial expiry deactivates tenant (Supabase integration)', () => {
  let supabase: SupabaseClient;
  let expiredTrialTenantId: string;
  let activeTrialTenantId: string;

  beforeAll(async () => {
    supabase = createClient(cfg!.url, cfg!.key);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const pastEnd = new Date(Date.now() - 3_600_000).toISOString(); // 1 hour ago
    const futureEnd = new Date(Date.now() + 7 * 86_400_000).toISOString(); // 7 days from now

    const { data: expiredRow, error: e1 } = await supabase
      .from('tenants')
      .insert({
        name: 'Trial expiry test (past)',
        name_ar: 'اختبار انتهاء التجربة',
        slug: `trial-expired-${suffix}`,
        industry: 'test',
        is_active: true,
        public_page_enabled: true,
        trial_ends_at: pastEnd,
        trial_status: 'active',
        trial_countdown_enabled: true,
      })
      .select('id')
      .single();
    if (e1 || !expiredRow) throw new Error(`insert past-trial tenant: ${e1?.message}`);
    expiredTrialTenantId = expiredRow.id;

    const { data: futureRow, error: e2 } = await supabase
      .from('tenants')
      .insert({
        name: 'Trial expiry test (future)',
        name_ar: 'اختبار تجربة مستقبلية',
        slug: `trial-future-${suffix}`,
        industry: 'test',
        is_active: true,
        public_page_enabled: true,
        trial_ends_at: futureEnd,
        trial_status: 'active',
        trial_countdown_enabled: true,
      })
      .select('id')
      .single();
    if (e2 || !futureRow) throw new Error(`insert future-trial tenant: ${e2?.message}`);
    activeTrialTenantId = futureRow.id;
  }, 60000);

  afterAll(async () => {
    if (expiredTrialTenantId) await supabase.from('tenants').delete().eq('id', expiredTrialTenantId);
    if (activeTrialTenantId) await supabase.from('tenants').delete().eq('id', activeTrialTenantId);
  }, 60000);

  it('expire_due_tenant_trials deactivates tenants whose trial_ends_at is in the past', async () => {
    const { data: before } = await supabase
      .from('tenants')
      .select('is_active, trial_status')
      .eq('id', expiredTrialTenantId)
      .single();
    expect(before?.is_active).toBe(true);
    expect(before?.trial_status).toBe('active');

    const { data: count, error: rpcErr } = await supabase.rpc('expire_due_tenant_trials');
    expect(rpcErr).toBeNull();
    expect(typeof count === 'number' ? count : Number(count)).toBeGreaterThanOrEqual(1);

    const { data: after, error: readErr } = await supabase
      .from('tenants')
      .select('is_active, trial_status')
      .eq('id', expiredTrialTenantId)
      .single();
    expect(readErr).toBeNull();
    expect(after?.is_active).toBe(false);
    expect(after?.trial_status).toBe('expired');
  });

  it('does not deactivate a tenant whose trial_ends_at is still in the future', async () => {
    await supabase.rpc('expire_due_tenant_trials');

    const { data: row, error } = await supabase
      .from('tenants')
      .select('is_active, trial_status')
      .eq('id', activeTrialTenantId)
      .single();
    expect(error).toBeNull();
    expect(row?.is_active).toBe(true);
    expect(row?.trial_status).toBe('active');
  });
});
