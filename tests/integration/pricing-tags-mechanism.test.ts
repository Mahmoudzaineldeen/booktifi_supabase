/**
 * Integration tests: pricing tags tables + resolveBookingTagForCreate against real Supabase.
 *
 * Requires: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (bypasses RLS for inserts).
 * Run: npm run test:integration:pricing-tags
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveBookingTagForCreate } from '../../server/src/services/tagPricingResolve';

function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

const cfg = getSupabaseConfig();
const describeIntegration = cfg ? describe : describe.skip;

describeIntegration('Pricing tags mechanism (Supabase integration)', () => {
  let supabase: SupabaseClient;
  let tenantId: string;
  let serviceId: string;
  let defaultTagId: string;
  let peakTagId: string;

  beforeAll(async () => {
    supabase = createClient(cfg!.url, cfg!.key);
    const slug = `tag-mechanism-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: tenant, error: te } = await supabase
      .from('tenants')
      .insert({
        name: 'Tag mechanism test',
        slug,
        industry: 'test',
        is_active: true,
        public_page_enabled: true,
      })
      .select('id')
      .single();
    if (te || !tenant) throw new Error(`tenant insert: ${te?.message}`);
    tenantId = tenant.id;

    const { data: svc, error: se } = await supabase
      .from('services')
      .insert({
        tenant_id: tenantId,
        name: 'Tagged service',
        base_price: 100,
        duration_minutes: 60,
        service_duration_minutes: 60,
        capacity_mode: 'service_based',
        capacity_per_slot: 1,
        service_capacity_per_slot: 1,
        is_active: true,
        is_public: true,
      })
      .select('id')
      .single();
    if (se || !svc) throw new Error(`service insert: ${se?.message}`);
    serviceId = svc.id;

    const { data: defTag, error: de } = await supabase
      .from('service_pricing_tags')
      .insert({
        tenant_id: tenantId,
        name: `Default-${slug.slice(-6)}`,
        description: 'integration default',
        is_default: true,
      })
      .select('id')
      .single();
    if (de || !defTag) throw new Error(`default tag (table missing?): ${de?.message}`);
    defaultTagId = defTag.id;

    const { data: peak, error: pe } = await supabase
      .from('service_pricing_tags')
      .insert({
        tenant_id: tenantId,
        name: `Peak-${slug.slice(-6)}`,
        description: 'peak hours',
        is_default: false,
      })
      .select('id')
      .single();
    if (pe || !peak) throw new Error(`peak tag: ${pe?.message}`);
    peakTagId = peak.id;

    const { error: fe } = await supabase.from('tag_fees').insert({
      tag_id: peakTagId,
      fee_name: 'Peak surcharge',
      fee_value: 25,
      description: null,
    });
    if (fe) throw new Error(`tag_fees: ${fe.message}`);

    const { error: ae } = await supabase.from('service_tag_assignments').insert([
      { service_id: serviceId, tag_id: defaultTagId },
      { service_id: serviceId, tag_id: peakTagId },
    ]);
    if (ae) throw new Error(`assignments: ${ae.message}`);
  }, 60000);

  afterAll(async () => {
    if (!tenantId) return;
    await supabase.from('bookings').delete().eq('tenant_id', tenantId);
    const { data: services } = await supabase.from('services').select('id').eq('tenant_id', tenantId);
    const sids = (services || []).map((s: { id: string }) => s.id);
    for (const sid of sids) {
      await supabase.from('service_tag_assignments').delete().eq('service_id', sid);
    }
    const { data: tags } = await supabase.from('service_pricing_tags').select('id').eq('tenant_id', tenantId);
    for (const t of tags || []) {
      await supabase.from('tag_fees').delete().eq('tag_id', (t as { id: string }).id);
    }
    await supabase.from('service_pricing_tags').delete().eq('tenant_id', tenantId);
    await supabase.from('services').delete().eq('tenant_id', tenantId);
    await supabase.from('users').delete().eq('tenant_id', tenantId);
    await supabase.from('tenants').delete().eq('id', tenantId);
  }, 60000);

  it('requireExplicitTag without tag_id → error', async () => {
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId,
      serviceId,
      tagIdFromClient: null,
      requireExplicitTag: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tag_id is required');
  });

  it('explicit default tag → appliedFee 0', async () => {
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId,
      serviceId,
      tagIdFromClient: defaultTagId,
      requireExplicitTag: true,
    });
    expect(r).toEqual({ ok: true, tagId: defaultTagId, appliedFee: 0 });
  });

  it('explicit peak tag → appliedFee from tag_fees', async () => {
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId,
      serviceId,
      tagIdFromClient: peakTagId,
      requireExplicitTag: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tagId).toBe(peakTagId);
      expect(r.appliedFee).toBe(25);
    }
  });

  it('invalid tag uuid → not available for service', async () => {
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId,
      serviceId,
      tagIdFromClient: '00000000-0000-0000-0000-00000000dead',
      requireExplicitTag: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Selected tag is not available for this service');
  });

  it('no assignments fallback: only default allowed', async () => {
    await supabase.from('service_tag_assignments').delete().eq('service_id', serviceId);
    try {
      const okDefault = await resolveBookingTagForCreate(supabase, {
        tenantId,
        serviceId,
        tagIdFromClient: defaultTagId,
        requireExplicitTag: true,
      });
      expect(okDefault).toEqual({ ok: true, tagId: defaultTagId, appliedFee: 0 });

      const badPeak = await resolveBookingTagForCreate(supabase, {
        tenantId,
        serviceId,
        tagIdFromClient: peakTagId,
        requireExplicitTag: true,
      });
      expect(badPeak.ok).toBe(false);
      if (!badPeak.ok) expect(badPeak.error).toContain('no pricing tags assigned');
    } finally {
      await supabase.from('service_tag_assignments').insert([
        { service_id: serviceId, tag_id: defaultTagId },
        { service_id: serviceId, tag_id: peakTagId },
      ]);
    }
  });
});
