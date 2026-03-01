/**
 * Unit tests: Global employee time lock – time overlap formula and helpers.
 *
 * Overlap rule: (existing_start < requested_end) AND (existing_end > requested_start)
 * Used by server and integration tests to determine if an employee is busy.
 */
import { describe, it, expect } from 'vitest';

function timeRangesOverlap(
  existingStart: string,
  existingEnd: string,
  requestedStart: string,
  requestedEnd: string
): boolean {
  const toM = (t: string) => {
    const parts = (t || '').slice(0, 8).split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };
  const es = toM(existingStart);
  const ee = toM(existingEnd);
  const rs = toM(requestedStart);
  const re = toM(requestedEnd);
  return es < re && ee > rs;
}

describe('Global employee time lock – time overlap formula', () => {
  it('same window 9:00–10:00 overlaps', () => {
    expect(timeRangesOverlap('09:00', '10:00', '09:00', '10:00')).toBe(true);
  });

  it('requested 9:30–10:30 overlaps existing 9:00–10:00', () => {
    expect(timeRangesOverlap('09:00', '10:00', '09:30', '10:30')).toBe(true);
  });

  it('requested 8:30–9:30 overlaps existing 9:00–10:00', () => {
    expect(timeRangesOverlap('09:00', '10:00', '08:30', '09:30')).toBe(true);
  });

  it('requested 8:00–11:00 fully contains existing 9:00–10:00', () => {
    expect(timeRangesOverlap('09:00', '10:00', '08:00', '11:00')).toBe(true);
  });

  it('adjacent 10:00–11:00 does NOT overlap 9:00–10:00', () => {
    expect(timeRangesOverlap('09:00', '10:00', '10:00', '11:00')).toBe(false);
  });

  it('requested 10:01–11:00 does NOT overlap 9:00–10:00', () => {
    expect(timeRangesOverlap('09:00', '10:00', '10:01', '11:00')).toBe(false);
  });

  it('requested 7:00–8:00 does NOT overlap 9:00–10:00', () => {
    expect(timeRangesOverlap('09:00', '10:00', '07:00', '08:00')).toBe(false);
  });

  it('handles HH:MM:SS format', () => {
    expect(timeRangesOverlap('09:00:00', '10:00:00', '09:30:00', '10:30:00')).toBe(true);
    expect(timeRangesOverlap('09:00:00', '10:00:00', '10:00:00', '11:00:00')).toBe(false);
  });
});

describe('Global employee time lock – rotation filter logic', () => {
  it('filters to only employees that have at least one slot', () => {
    const allAssignedIds = ['emp1', 'emp2', 'emp3'];
    const availableSlots = [
      { employee_id: 'emp2' },
      { employee_id: 'emp2' },
      { employee_id: 'emp3' },
    ];
    const availableEmployeeIds = [...new Set(availableSlots.map((s: any) => s.employee_id).filter(Boolean))].sort();
    const employeeIds = availableEmployeeIds.length > 0 ? availableEmployeeIds : allAssignedIds;
    expect(employeeIds).toEqual(['emp2', 'emp3']);
    expect(employeeIds).not.toContain('emp1');
  });

  it('falls back to all assigned when no slots', () => {
    const allAssignedIds = ['emp1', 'emp2'];
    const availableSlots: any[] = [];
    const availableEmployeeIds = [...new Set(availableSlots.map((s: any) => s.employee_id).filter(Boolean))].sort();
    const employeeIds = availableEmployeeIds.length > 0 ? availableEmployeeIds : allAssignedIds;
    expect(employeeIds).toEqual(['emp1', 'emp2']);
  });
});
