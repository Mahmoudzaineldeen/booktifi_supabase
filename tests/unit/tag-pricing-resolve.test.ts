/**
 * Unit tests for resolveBookingTagForCreate (pricing tag validation + fee snapshot).
 * Uses a sequential mock Supabase client — no database required.
 */
import { describe, it, expect } from 'vitest';
import { resolveBookingTagForCreate } from '../../server/src/services/tagPricingResolve';

type MockRow = { data: any; error: any };

/** Each DB round-trip consumes the next row from the queue (order must match the resolver). */
function createSequentialMock(queue: MockRow[]) {
  let i = 0;
  const next = (): MockRow => {
    if (i >= queue.length) {
      return { data: null, error: { message: `Unexpected extra query (index ${i})` } };
    }
    return queue[i++];
  };

  const builder = (): any => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = () => Promise.resolve(next());
    b.then = (resolve: (v: MockRow) => unknown) => Promise.resolve(next()).then(resolve);
    return b;
  };

  return {
    from: () => builder(),
  } as any;
}

const TENANT = 'tenant-1';
const SVC = 'service-1';
const DEFAULT_TAG = 'tag-default';
const PEAK_TAG = 'tag-peak';

describe('resolveBookingTagForCreate', () => {
  it('returns 400 when service is missing', async () => {
    const supabase = createSequentialMock([{ data: null, error: null }]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      requireExplicitTag: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Service not found');
  });

  it('returns 400 when service belongs to another tenant', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: 'other-tenant' }, error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      requireExplicitTag: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Service does not belong to tenant');
  });

  it('returns 500 when default pricing tag is missing', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: null, error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      requireExplicitTag: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.error).toContain('Default pricing tag');
    }
  });

  it('requireExplicitTag: fails when tag_id omitted', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: { id: DEFAULT_TAG }, error: null },
      { data: [{ tag_id: DEFAULT_TAG }], error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      tagIdFromClient: null,
      requireExplicitTag: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tag_id is required');
  });

  it('no assignments: uses default when tag omitted; fee 0', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: { id: DEFAULT_TAG }, error: null },
      { data: [], error: null },
      { data: { id: DEFAULT_TAG, tenant_id: TENANT, is_default: true }, error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      requireExplicitTag: false,
    });
    expect(r).toEqual({ ok: true, tagId: DEFAULT_TAG, appliedFee: 0, slotCount: 1 });
  });

  it('no assignments: rejects non-default tag_id', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: { id: DEFAULT_TAG }, error: null },
      { data: [], error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      tagIdFromClient: PEAK_TAG,
      requireExplicitTag: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no pricing tags assigned');
  });

  it('with assignments: rejects tag not linked to service', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: { id: DEFAULT_TAG }, error: null },
      { data: [{ tag_id: DEFAULT_TAG }], error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      tagIdFromClient: PEAK_TAG,
      requireExplicitTag: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Selected tag is not available for this service');
  });

  it('with assignments: default tag explicit → appliedFee 0 (no tag_fees query)', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: { id: DEFAULT_TAG }, error: null },
      { data: [{ tag_id: DEFAULT_TAG }, { tag_id: PEAK_TAG }], error: null },
      { data: { id: DEFAULT_TAG, tenant_id: TENANT, is_default: true }, error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      tagIdFromClient: DEFAULT_TAG,
      requireExplicitTag: true,
    });
    expect(r).toEqual({ ok: true, tagId: DEFAULT_TAG, appliedFee: 0, slotCount: 1 });
  });

  it('with assignments: non-default with fee row → appliedFee and slotCount from DB', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: { id: DEFAULT_TAG }, error: null },
      { data: [{ tag_id: DEFAULT_TAG }, { tag_id: PEAK_TAG }], error: null },
      { data: { id: PEAK_TAG, tenant_id: TENANT, is_default: false }, error: null },
      { data: { fee_value: 42.5, slot_count: 2 }, error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      tagIdFromClient: PEAK_TAG,
      requireExplicitTag: true,
    });
    expect(r).toEqual({ ok: true, tagId: PEAK_TAG, appliedFee: 42.5, slotCount: 2 });
  });

  it('non-default tag with no fee row → appliedFee 0', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: { id: DEFAULT_TAG }, error: null },
      { data: [{ tag_id: PEAK_TAG }], error: null },
      { data: { id: PEAK_TAG, tenant_id: TENANT, is_default: false }, error: null },
      { data: null, error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      tagIdFromClient: PEAK_TAG,
      requireExplicitTag: true,
    });
    expect(r).toEqual({ ok: true, tagId: PEAK_TAG, appliedFee: 0, slotCount: 1 });
  });

  it('rejects tag that does not belong to tenant (meta lookup)', async () => {
    const supabase = createSequentialMock([
      { data: { id: SVC, tenant_id: TENANT }, error: null },
      { data: { id: DEFAULT_TAG }, error: null },
      { data: [{ tag_id: PEAK_TAG }], error: null },
      { data: { id: PEAK_TAG, tenant_id: 'other', is_default: false }, error: null },
    ]);
    const r = await resolveBookingTagForCreate(supabase, {
      tenantId: TENANT,
      serviceId: SVC,
      tagIdFromClient: PEAK_TAG,
      requireExplicitTag: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Tag does not belong to tenant');
  });
});
