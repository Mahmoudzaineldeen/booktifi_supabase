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

/**
 * Flatten all slots by (start_time, end_time, employee_id); take first N from selected time onward.
 * Never group by period; each (employee, time) is one slot.
 */
export function getParallelSlotsForQuantity(
  allSlots: AllocationSlot[],
  selectedTime: SelectedTime | null,
  quantity: number
): AllocationSlot[] {
  const available = allSlots
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
  return available.slice(startIndex, startIndex + quantity);
}

/**
 * Find one employee with N consecutive (adjacent) time slots. Returns those slots or null.
 */
export function getConsecutiveSlotsForQuantity(
  allSlots: AllocationSlot[],
  quantity: number
): AllocationSlot[] | null {
  const byEmployee = new Map<string, AllocationSlot[]>();
  for (const s of allSlots) {
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
