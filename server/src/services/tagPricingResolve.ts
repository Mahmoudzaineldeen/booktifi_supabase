import type { SupabaseClient } from '@supabase/supabase-js';

export type TagResolveOk = {
  ok: true;
  tagId: string;
  appliedFee: number;
  slotCount: number;
};
export type TagResolveErr = { ok: false; status: number; error: string };
export type TagResolveResult = TagResolveOk | TagResolveErr;

export function computeTagAdjustedDuration(baseDurationMinutes: number, slotCountRaw: number): {
  finalDurationMinutes: number;
  requiredSlots: number;
} {
  const base = Math.max(1, Math.round(Number(baseDurationMinutes) || 1));
  const safeSlotCount = Math.max(1, Math.ceil(Number.isFinite(slotCountRaw) ? slotCountRaw : 1));
  const adjusted = base * safeSlotCount;
  return {
    finalDurationMinutes: adjusted,
    requiredSlots: safeSlotCount,
  };
}

/**
 * Resolve pricing tag for booking create: validates tenant/service, assignment, computes fee snapshot.
 * Default tag always has fee 0. Staff must pass tag_id explicitly.
 */
export async function resolveBookingTagForCreate(
  supabase: SupabaseClient,
  opts: {
    tenantId: string;
    serviceId: string;
    tagIdFromClient?: string | null;
    requireExplicitTag: boolean;
  }
): Promise<TagResolveResult> {
  const { tenantId, serviceId, requireExplicitTag } = opts;
  const raw = opts.tagIdFromClient;
  const tagIdTrim = raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;

  const { data: serviceRow, error: svcErr } = await supabase
    .from('services')
    .select('id, tenant_id')
    .eq('id', serviceId)
    .maybeSingle();

  if (svcErr || !serviceRow) {
    return { ok: false, status: 400, error: 'Service not found' };
  }
  if (String(serviceRow.tenant_id) !== String(tenantId)) {
    return { ok: false, status: 400, error: 'Service does not belong to tenant' };
  }

  const { data: defaultTag, error: defErr } = await supabase
    .from('service_pricing_tags')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .maybeSingle();

  if (defErr || !defaultTag?.id) {
    return {
      ok: false,
      status: 500,
      error: 'Default pricing tag is not configured for this tenant. Run database migrations.',
    };
  }

  const defaultTagId = defaultTag.id as string;

  const { data: assignmentRows, error: asgErr } = await supabase
    .from('service_tag_assignments')
    .select('tag_id')
    .eq('service_id', serviceId);

  if (asgErr) {
    return { ok: false, status: 500, error: 'Failed to load service tags' };
  }

  const assignedIds = new Set((assignmentRows || []).map((r: { tag_id: string }) => r.tag_id));
  const hasAssignments = assignedIds.size > 0;

  if (requireExplicitTag && !tagIdTrim) {
    return { ok: false, status: 400, error: 'tag_id is required' };
  }

  let effectiveTagId = tagIdTrim || defaultTagId;

  if (!hasAssignments) {
    effectiveTagId = defaultTagId;
    if (tagIdTrim && tagIdTrim !== defaultTagId) {
      return {
        ok: false,
        status: 400,
        error: 'This service has no pricing tags assigned; use the default tag only.',
      };
    }
  } else if (!assignedIds.has(effectiveTagId)) {
    return { ok: false, status: 400, error: 'Selected tag is not available for this service' };
  }

  const { data: tagMeta, error: tagErr } = await supabase
    .from('service_pricing_tags')
    .select('id, tenant_id, is_default')
    .eq('id', effectiveTagId)
    .maybeSingle();

  if (tagErr || !tagMeta) {
    return { ok: false, status: 400, error: 'Tag not found' };
  }
  if (String(tagMeta.tenant_id) !== String(tenantId)) {
    return { ok: false, status: 400, error: 'Tag does not belong to tenant' };
  }

  if (tagMeta.is_default === true) {
    return { ok: true, tagId: effectiveTagId, appliedFee: 0, slotCount: 1 };
  }

  let feeRow: any = null;
  // Prefer slot_count; gracefully fallback for schemas that haven't migrated yet.
  const withSlots = await supabase
    .from('tag_fees')
    .select('fee_value, slot_count')
    .eq('tag_id', effectiveTagId)
    .maybeSingle();
  if (withSlots.error && String(withSlots.error.message || '').toLowerCase().includes('slot_count')) {
    const fallback = await supabase.from('tag_fees').select('fee_value').eq('tag_id', effectiveTagId).maybeSingle();
    feeRow = fallback.data || null;
  } else {
    feeRow = withSlots.data || null;
  }

  const fee = feeRow?.fee_value != null ? Number(feeRow.fee_value) : 0;
  const appliedFee = Number.isFinite(fee) && fee > 0 ? fee : 0;
  const rawSlotCount = feeRow?.slot_count != null ? Number(feeRow.slot_count) : 1;
  const slotCount = Number.isFinite(rawSlotCount) ? Math.max(1, Math.ceil(rawSlotCount)) : 1;

  return { ok: true, tagId: effectiveTagId, appliedFee, slotCount };
}
