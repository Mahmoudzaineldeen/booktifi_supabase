/**
 * Unit tests for parallel & consecutive slot allocation (employee-based booking).
 * Ensures: parallel books exact quantity slots (no full-period); consecutive uses same employee.
 */

import { describe, it, expect } from 'vitest';
import {
  filterSlotsByRequiredConsecutive,
  getRequiredSlotsForDuration,
  getParallelSlotsForQuantity,
  getConsecutiveSlotsForQuantity,
  hasRequiredConsecutiveSlotsFromStart,
  type AllocationSlot,
  type SelectedTime,
} from '../../src/lib/bookingSlotAllocation';

function slot(id: string, start: string, end: string, employeeId: string, capacity = 1): AllocationSlot {
  return { id, start_time: start, end_time: end, employee_id: employeeId, available_capacity: capacity };
}

describe('getParallelSlotsForQuantity', () => {
  it('returns exactly quantity slots, never whole period (2 employees × 2 periods, quantity 3)', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '09:00', '10:00', 'EM2'),
      slot('s3', '10:00', '11:00', 'EM1'),
      slot('s4', '10:00', '11:00', 'EM2'),
    ];
    const selected: SelectedTime = { start_time: '09:00', end_time: '10:00', slot_date: '2026-02-25' };
    const result = getParallelSlotsForQuantity(slots, selected, 3);
    expect(result).toHaveLength(3);
    expect(result.map(s => s.id)).toEqual(['s1', 's2', 's3']);
    expect(result[0].employee_id).toBe('EM1');
    expect(result[1].employee_id).toBe('EM2');
    expect(result[2].employee_id).toBe('EM1');
  });

  it('quantity 4 with 2 periods → 4 slots (2 per period)', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '09:00', '10:00', 'EM2'),
      slot('s3', '10:00', '11:00', 'EM1'),
      slot('s4', '10:00', '11:00', 'EM2'),
    ];
    const selected: SelectedTime = { start_time: '09:00', end_time: '10:00' };
    const result = getParallelSlotsForQuantity(slots, selected, 4);
    expect(result).toHaveLength(4);
    expect(result.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('quantity 1 → only one slot (never whole period)', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '09:00', '10:00', 'EM2'),
    ];
    const selected: SelectedTime = { start_time: '09:00', end_time: '10:00' };
    const result = getParallelSlotsForQuantity(slots, selected, 1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
  });

  it('quantity exceeds available → returns all available up to quantity', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '09:00', '10:00', 'EM2'),
    ];
    const result = getParallelSlotsForQuantity(slots, { start_time: '09:00', end_time: '10:00' }, 5);
    expect(result).toHaveLength(2);
  });

  it('filters out zero-capacity slots', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1', 1),
      slot('s2', '09:00', '10:00', 'EM2', 0),
      slot('s3', '10:00', '11:00', 'EM1', 1),
    ];
    const result = getParallelSlotsForQuantity(slots, { start_time: '09:00', end_time: '10:00' }, 2);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['s1', 's3']);
  });

  it('selectedTime null → starts from first slot', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '10:00', '11:00', 'EM1'),
    ];
    const result = getParallelSlotsForQuantity(slots, null, 2);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['s1', 's2']);
  });

  it('empty slots → empty array', () => {
    const result = getParallelSlotsForQuantity([], { start_time: '09:00', end_time: '10:00' }, 3);
    expect(result).toHaveLength(0);
  });

  it('respects requiredConsecutiveSlots when selecting start times', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '10:00', '11:00', 'EM1'),
      slot('s3', '12:00', '13:00', 'EM1'), // gap: cannot start 12:00 for 2 consecutive
    ];
    const result = getParallelSlotsForQuantity(slots, { start_time: '09:00', end_time: '10:00' }, 2, 2);
    expect(result.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('getConsecutiveSlotsForQuantity', () => {
  it('assigns all N slots to same employee when consecutive', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '10:00', '11:00', 'EM1'),
      slot('s3', '11:00', '12:00', 'EM1'),
      slot('s4', '09:00', '10:00', 'EM2'),
      slot('s5', '10:00', '11:00', 'EM2'),
    ];
    const result = getConsecutiveSlotsForQuantity(slots, 3);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(3);
    const employees = new Set(result!.map(s => s.employee_id));
    expect(employees.size).toBe(1);
    expect(result!.map(s => s.start_time)).toEqual(['09:00', '10:00', '11:00']);
  });

  it('returns null when no employee has N consecutive slots (break in availability)', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '11:00', '12:00', 'EM1'), // gap 10–11
      slot('s3', '12:00', '13:00', 'EM1'),
    ];
    const result = getConsecutiveSlotsForQuantity(slots, 3);
    expect(result).toBeNull();
  });

  it('returns first valid run when multiple employees have consecutive', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1'),
      slot('s2', '10:00', '11:00', 'EM1'),
      slot('s3', '11:00', '12:00', 'EM1'),
      slot('s4', '09:00', '10:00', 'EM2'),
      slot('s5', '10:00', '11:00', 'EM2'),
      slot('s6', '11:00', '12:00', 'EM2'),
    ];
    const result = getConsecutiveSlotsForQuantity(slots, 3);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(3);
    const emp = result![0].employee_id;
    expect(result!.every(s => s.employee_id === emp)).toBe(true);
  });

  it('quantity 1 returns one slot', () => {
    const slots: AllocationSlot[] = [slot('s1', '09:00', '10:00', 'EM1')];
    const result = getConsecutiveSlotsForQuantity(slots, 1);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
  });

  it('filters out zero-capacity slots', () => {
    const slots: AllocationSlot[] = [
      slot('s1', '09:00', '10:00', 'EM1', 1),
      slot('s2', '10:00', '11:00', 'EM1', 0),
      slot('s3', '11:00', '12:00', 'EM1', 1),
    ];
    const result = getConsecutiveSlotsForQuantity(slots, 3);
    expect(result).toBeNull();
  });

  it('empty slots → null', () => {
    const result = getConsecutiveSlotsForQuantity([], 2);
    expect(result).toBeNull();
  });
});

/**
 * One selection per slot per period: a period with 2 distinct slots must not allow 3 selections.
 * (Mirrors UI logic: getNextSlotToAddFromGroup with uniqueBySlotId and selected < 1.)
 */
describe('period max selections (one per slot)', () => {
  function getNextSlotFromGroup(
    grouped: AllocationSlot[],
    selectedSlotIds: string[]
  ): AllocationSlot | null {
    const uniqueBySlotId = grouped.filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i);
    for (const slot of uniqueBySlotId) {
      const selected = selectedSlotIds.filter((id) => id === slot.id).length;
      if (selected < 1) return slot;
    }
    return null;
  }

  it('period with 2 slots allows at most 2 selections; 3rd returns null', () => {
    const periodSlots: AllocationSlot[] = [
      slot('id1', '22:00', '23:00', 'em2'),
      slot('id2', '22:00', '23:00', 'employee 1111'),
    ];
    const selected1: string[] = [];
    const selected2: string[] = ['id1'];
    const selected3: string[] = ['id1', 'id2'];

    expect(getNextSlotFromGroup(periodSlots, selected1)).not.toBeNull();
    expect(getNextSlotFromGroup(periodSlots, selected2)).not.toBeNull();
    expect(getNextSlotFromGroup(periodSlots, selected3)).toBeNull();
  });

  it('period with 2 slots (with duplicate in array) still allows only 2 selections', () => {
    const periodSlots: AllocationSlot[] = [
      slot('id1', '22:00', '23:00', 'em2'),
      slot('id2', '22:00', '23:00', 'employee 1111'),
      slot('id1', '22:00', '23:00', 'em2'),
    ];
    const selected: string[] = ['id1', 'id2'];
    expect(getNextSlotFromGroup(periodSlots, selected)).toBeNull();
  });
});

describe('duration helpers', () => {
  it('computes fixed extra minutes correctly', () => {
    const meta = getRequiredSlotsForDuration(60, 'fixed', 30);
    expect(meta.finalDurationMinutes).toBe(90);
    expect(meta.requiredSlots).toBe(2);
  });

  it('computes multiplier duration correctly', () => {
    const meta = getRequiredSlotsForDuration(45, 'multiplier', 2);
    expect(meta.finalDurationMinutes).toBe(90);
    expect(meta.requiredSlots).toBe(2);
  });
});

describe('consecutive start validation', () => {
  const slots: AllocationSlot[] = [
    { id: 'a', slot_date: '2026-04-05', start_time: '09:00', end_time: '10:00', employee_id: 'e1', available_capacity: 1 },
    { id: 'b', slot_date: '2026-04-05', start_time: '10:00', end_time: '11:00', employee_id: 'e1', available_capacity: 1 },
    { id: 'c', slot_date: '2026-04-05', start_time: '11:30', end_time: '12:30', employee_id: 'e1', available_capacity: 1 },
  ];

  it('returns true when enough consecutive slots exist from selected start', () => {
    expect(hasRequiredConsecutiveSlotsFromStart(slots, slots[0], 2)).toBe(true);
  });

  it('returns false when gap breaks required consecutive chain', () => {
    expect(hasRequiredConsecutiveSlotsFromStart(slots, slots[1], 2)).toBe(false);
  });

  it('filters valid starts based on required consecutive slots', () => {
    const filtered = filterSlotsByRequiredConsecutive(slots, 2);
    expect(filtered.map((s) => s.id)).toEqual(['a']);
  });
});

describe('end-of-shift multi-slot safeguards', () => {
  function daySlot(id: string, start: string, end: string, employeeId: string, date = '2026-04-11', capacity = 1): AllocationSlot {
    return {
      id,
      slot_date: date,
      start_time: start,
      end_time: end,
      employee_id: employeeId,
      available_capacity: capacity,
    };
  }

  it('rejects 10:00 PM start for 2-slot tag when shift ends 11:00 PM', () => {
    // Service window: 1:00 PM -> 11:00 PM (hourly slots).
    const slots: AllocationSlot[] = [
      daySlot('13', '13:00', '14:00', 'em2'),
      daySlot('14', '14:00', '15:00', 'em2'),
      daySlot('15', '15:00', '16:00', 'em2'),
      daySlot('16', '16:00', '17:00', 'em2'),
      daySlot('17', '17:00', '18:00', 'em2'),
      daySlot('18', '18:00', '19:00', 'em2'),
      daySlot('19', '19:00', '20:00', 'em2'),
      daySlot('20', '20:00', '21:00', 'em2'),
      daySlot('21', '21:00', '22:00', 'em2'),
      daySlot('22', '22:00', '23:00', 'em2'),
    ];
    const tenPm = slots.find((s) => s.start_time === '22:00')!;
    expect(hasRequiredConsecutiveSlotsFromStart(slots, tenPm, 2)).toBe(false);
  });

  it('keeps 9:00 PM as valid start for 2-slot tag in same shift', () => {
    const slots: AllocationSlot[] = [
      daySlot('21', '21:00', '22:00', 'em2'),
      daySlot('22', '22:00', '23:00', 'em2'),
    ];
    const ninePm = slots.find((s) => s.start_time === '21:00')!;
    expect(hasRequiredConsecutiveSlotsFromStart(slots, ninePm, 2)).toBe(true);
  });

  it('filters start-time list so 10:00 PM is hidden for 2-slot tag', () => {
    const slots: AllocationSlot[] = [
      daySlot('20', '20:00', '21:00', 'em2'),
      daySlot('21', '21:00', '22:00', 'em2'),
      daySlot('22', '22:00', '23:00', 'em2'),
    ];
    const filtered = filterSlotsByRequiredConsecutive(slots, 2);
    expect(filtered.map((s) => s.start_time)).toEqual(['20:00', '21:00']);
    expect(filtered.some((s) => s.start_time === '22:00')).toBe(false);
  });

  it('parallel allocator never returns invalid 10:00 PM start with requiredConsecutive=2', () => {
    const slots: AllocationSlot[] = [
      daySlot('20', '20:00', '21:00', 'em2'),
      daySlot('21', '21:00', '22:00', 'em2'),
      daySlot('22', '22:00', '23:00', 'em2'),
    ];
    const selected: SelectedTime = { start_time: '22:00', end_time: '23:00', slot_date: '2026-04-11' };
    const result = getParallelSlotsForQuantity(slots, selected, 1, 2);
    // When selected start is invalid, allocator falls back to the first valid start.
    expect(result).toHaveLength(1);
    expect(result[0].start_time).toBe('20:00');
    expect(result.some((s) => s.start_time === '22:00')).toBe(false);
  });
});
