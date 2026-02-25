/**
 * Unit tests for parallel & consecutive slot allocation (employee-based booking).
 * Ensures: parallel books exact quantity slots (no full-period); consecutive uses same employee.
 */

import { describe, it, expect } from 'vitest';
import {
  getParallelSlotsForQuantity,
  getConsecutiveSlotsForQuantity,
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
