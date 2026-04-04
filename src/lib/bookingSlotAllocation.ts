/**
 * Employee-based booking slot allocation (parallel & consecutive).
 * Used by Reception and Admin booking pages. Slot-level only; never books full periods.
 */

export interface AllocationSlot {
  id: string;
  start_time: string;
  end_time: string;
  available_capacity?: number;
  employee_id?: string | null;
  slot_date?: string;
}

export type SelectedTime = { start_time: string; end_time: string; slot_date?: string };
export type TagTimeType = 'fixed' | 'multiplier';

export function getRequiredSlotsForDuration(
  baseDurationMinutes: number,
  timeType: TagTimeType,
  timeValue: number
): { finalDurationMinutes: number; requiredSlots: number } {
  const base = Math.max(1, Math.round(Number(baseDurationMinutes) || 1));
  const safeType: TagTimeType = timeType === 'multiplier' ? 'multiplier' : 'fixed';
  const safeValue = Number.isFinite(timeValue) ? timeValue : (safeType === 'multiplier' ? 1 : 0);
  const finalDurationMinutes = safeType === 'multiplier'
    ? Math.max(base, Math.ceil(base * Math.max(1, safeValue)))
    : Math.max(base, base + Math.ceil(Math.max(0, safeValue)));
  return {
    finalDurationMinutes,
    requiredSlots: Math.max(1, Math.ceil(finalDurationMinutes / base)),
  };
}

function slotKey(slot: AllocationSlot): string {
  return `${slot.slot_date || ''}|${slot.employee_id || ''}|${slot.start_time}|${slot.end_time}`;
}

export function hasRequiredConsecutiveSlotsFromStart(
  allSlots: AllocationSlot[],
  startSlot: AllocationSlot,
  requiredSlots: number
): boolean {
  if (requiredSlots <= 1) return true;
  const employeeKey = startSlot.employee_id || '';
  const dateKey = startSlot.slot_date || '';
  const byStart = new Map<string, AllocationSlot>();
  for (const slot of allSlots) {
    if ((slot.available_capacity ?? 0) <= 0) continue;
    if ((slot.employee_id || '') !== employeeKey) continue;
    if ((slot.slot_date || '') !== dateKey) continue;
    byStart.set(slot.start_time, slot);
  }
  let cursor = startSlot.start_time;
  for (let i = 0; i < requiredSlots; i++) {
    const slot = byStart.get(cursor);
    if (!slot) return false;
    cursor = slot.end_time;
  }
  return true;
}

export function filterSlotsByRequiredConsecutive(
  allSlots: AllocationSlot[],
  requiredSlots: number
): AllocationSlot[] {
  if (requiredSlots <= 1) return allSlots.filter((s) => (s.available_capacity ?? 0) > 0);
  const available = allSlots.filter((s) => (s.available_capacity ?? 0) > 0);
  return available.filter((slot) => hasRequiredConsecutiveSlotsFromStart(available, slot, requiredSlots));
}

/**
 * Flatten all slots by (start_time, end_time, employee_id); take first N from selected time onward.
 * Never group by period; each (employee, time) is one slot.
 */
export function getParallelSlotsForQuantity(
  allSlots: AllocationSlot[],
  selectedTime: SelectedTime | null,
  quantity: number,
  requiredConsecutiveSlots = 1
): AllocationSlot[] {
  const available = filterSlotsByRequiredConsecutive(allSlots, requiredConsecutiveSlots)
    .filter(s => (s.available_capacity ?? 0) > 0)
    .sort((a, b) => {
      const byTime = a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time);
      return byTime || (a.employee_id ?? '').localeCompare(b.employee_id ?? '');
    });
  if (available.length === 0) return [];
  let startIndex = 0;
  if (selectedTime) {
    const idx = available.findIndex(
      s => s.start_time === selectedTime.start_time && s.end_time === selectedTime.end_time
    );
    if (idx >= 0) startIndex = idx;
  }
  const picked: AllocationSlot[] = [];
  const seen = new Set<string>();
  for (let i = startIndex; i < available.length && picked.length < quantity; i++) {
    const key = slotKey(available[i]);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(available[i]);
  }
  return picked;
}

/**
 * Find one employee with N consecutive (adjacent) time slots. Returns those slots or null.
 */
export function getConsecutiveSlotsForQuantity(
  allSlots: AllocationSlot[],
  quantity: number,
  requiredConsecutiveSlots = 1
): AllocationSlot[] | null {
  const candidates = filterSlotsByRequiredConsecutive(allSlots, requiredConsecutiveSlots);
  const byEmployee = new Map<string, AllocationSlot[]>();
  for (const s of candidates) {
    if ((s.available_capacity ?? 0) <= 0) continue;
    const eid = s.employee_id ?? '';
    if (!byEmployee.has(eid)) byEmployee.set(eid, []);
    byEmployee.get(eid)!.push(s);
  }
  for (const [, empSlots] of byEmployee) {
    empSlots.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time));
    for (let i = 0; i <= empSlots.length - quantity; i++) {
      const run = empSlots.slice(i, i + quantity);
      const consecutive = run.every((slot, j) => {
        if (j === 0) return true;
        return run[j - 1].end_time === slot.start_time;
      });
      if (consecutive) return run;
    }
  }
  return null;
}
