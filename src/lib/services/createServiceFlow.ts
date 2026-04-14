import type { ParsedImportRow } from './serviceImportMapping';

/** Runtime `db` client (insert + rpc); keep loose to match DatabaseClient builder. */
type DbClient = any;

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type GetAuthHeaders = () => HeadersInit;

export type BuildServiceInsertOptions = {
  tenantId: string;
  schedulingType: 'slot_based' | 'employee_based';
  /** When tenant scheduling is employee-based, treat like form `hideServiceSlots` capacity path */
  hideServiceSlots: boolean;
};

/**
 * Build insert payload aligned with ServicesPage `handleServiceSubmit` / DB expectations.
 */
export function buildServiceInsertPayloadFromImportRow(
  row: ParsedImportRow,
  options: BuildServiceInsertOptions
): Record<string, unknown> {
  const st = options.schedulingType;
  const hide = options.hideServiceSlots;
  // Mirrors ServicesPage `isEmployeeBasedScheduling` (affects numeric capacity defaults only).
  const isEmployeeBasedScheduling = st === 'employee_based' || hide;
  // Mirrors ServicesPage `capacity_mode` — driven only by scheduling_type, not hideServiceSlots alone.
  const capacity_mode = st === 'employee_based' ? 'employee_based' : 'service_based';

  let service_capacity_per_slot: number | null;
  let capacity_per_slot: number;
  if (capacity_mode === 'employee_based') {
    // DB check_service_based_capacity: employee_based => service_capacity_per_slot must be NULL
    service_capacity_per_slot = null;
    capacity_per_slot = 1;
  } else {
    const cap = isEmployeeBasedScheduling ? 1 : row.service_capacity_per_slot ?? 1;
    service_capacity_per_slot = cap;
    capacity_per_slot = cap;
  }

  const basePrice = row.base_price;
  let discount_percentage: number | null = row.discount_percentage;
  const originalPrice = row.original_price;

  if (originalPrice != null && originalPrice > basePrice && (discount_percentage == null || discount_percentage <= 0)) {
    discount_percentage = Math.round(((originalPrice - basePrice) / originalPrice) * 100);
  }

  const payload: Record<string, unknown> = {
    name: row.name,
    name_ar: row.name_ar,
    description: row.description,
    description_ar: row.description_ar,
    category_id: null,
    tenant_id: options.tenantId,
    capacity_mode,
    scheduling_type: st,
    assignment_mode: st === 'employee_based' ? 'manual_assign' : null,
    service_capacity_per_slot,
    duration_minutes: row.duration_minutes,
    service_duration_minutes: row.duration_minutes,
    capacity_per_slot,
    base_price: basePrice,
    gallery_urls: null,
    image_url: null,
    is_public: row.is_public,
    is_active: row.is_active,
  };

  if (originalPrice != null && originalPrice > 0) {
    payload.original_price = originalPrice;
  }
  if (discount_percentage != null && discount_percentage > 0) {
    payload.discount_percentage = discount_percentage;
  }

  return payload;
}

export async function assignBranchesToService(
  apiFetch: ApiFetch,
  getAuthHeaders: GetAuthHeaders,
  serviceId: string,
  branchIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const putRes = await apiFetch(`/branches/by-service/${serviceId}/branches`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ branch_ids: branchIds }),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      return { ok: false, error: (err as { error?: string }).error || 'Failed to assign branches' };
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to assign branches' };
  }
}

export async function createDefaultShiftAndSlots(
  db: DbClient,
  tenantId: string,
  serviceId: string
): Promise<void> {
  const defaultShift = {
    tenant_id: tenantId,
    service_id: serviceId,
    days_of_week: [1, 2, 3, 4, 5],
    start_time_utc: '09:00:00',
    end_time_utc: '18:00:00',
    is_active: true,
  };

  const shiftResult = await db.from('shifts').insert(defaultShift).select('*').single();
  if (shiftResult.error || !shiftResult.data?.id) {
    console.warn('[createServiceFlow] default shift failed', shiftResult.error);
    return;
  }

  const today = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 60);
  const todayStr = today.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const slotsResult = await db.rpc('generate_slots_for_shift', {
    p_shift_id: shiftResult.data.id,
    p_start_date: todayStr,
    p_end_date: endDateStr,
  });
  if (slotsResult.error) {
    console.warn('[createServiceFlow] generate_slots_for_shift failed', slotsResult.error);
  }
}

export type CreateServiceWithPostStepsParams = {
  db: DbClient;
  apiFetch: ApiFetch;
  getAuthHeaders: GetAuthHeaders;
  tenantId: string;
  branchIds: string[];
  schedulingType: 'slot_based' | 'employee_based';
  hideServiceSlots: boolean;
  row: ParsedImportRow;
  categoryId: string | null;
};

/**
 * Insert service, assign branches, optional default shift for slot_based — mirrors ServicesPage new-service path.
 */
export async function createServiceWithPostSteps(
  params: CreateServiceWithPostStepsParams
): Promise<{ ok: true; serviceId: string } | { ok: false; error: string }> {
  const { db, apiFetch, getAuthHeaders, tenantId, branchIds, schedulingType, hideServiceSlots, row, categoryId } =
    params;

  const insertPayload = buildServiceInsertPayloadFromImportRow(row, {
    tenantId,
    schedulingType,
    hideServiceSlots,
  });
  if (categoryId) {
    insertPayload.category_id = categoryId;
  }

  const result = await db.from('services').insert(insertPayload).select('*').single();
  if (result.error || !result.data?.id) {
    const msg =
      (result.error as { message?: string })?.message ||
      (typeof result.error === 'string' ? result.error : JSON.stringify(result.error)) ||
      'Insert failed';
    return { ok: false, error: msg };
  }

  const serviceId = result.data.id as string;

  // Same order as ServicesPage: shift/slots when scheduling_type is slot_based (see ServicesPage insert block).
  if (schedulingType === 'slot_based') {
    await createDefaultShiftAndSlots(db, tenantId, serviceId);
  }

  const branchRes = await assignBranchesToService(apiFetch, getAuthHeaders, serviceId, branchIds);
  if (!branchRes.ok) {
    return { ok: false, error: branchRes.error };
  }

  return { ok: true, serviceId };
}
