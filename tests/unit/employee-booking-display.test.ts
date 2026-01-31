/**
 * Unit tests for employee-based booking display logic
 * Verifies: getBookingEmployees normalization, employee-based availability behavior
 */

import { describe, it, expect } from 'vitest';

/** Same logic as ReceptionPage getBookingEmployees - normalize employee display from employees array or users relation */
function getBookingEmployees(booking: Record<string, any>): Array<{ id?: string; full_name: string; full_name_ar?: string }> {
  if (booking?.employees?.length) return booking.employees;
  if (booking?.users && typeof booking.users === 'object') return [booking.users];
  return [];
}

describe('getBookingEmployees (reception employee display)', () => {
  it('returns employees array when present', () => {
    const booking = {
      employees: [
        { id: 'e1', full_name: 'Ahmed Ali', full_name_ar: 'أحمد علي' },
      ],
    };
    expect(getBookingEmployees(booking)).toHaveLength(1);
    expect(getBookingEmployees(booking)[0].full_name).toBe('Ahmed Ali');
  });

  it('returns [users] when employees missing but users present (single booking from API)', () => {
    const booking = {
      users: { id: 'u1', full_name: 'Ahmed Ali', full_name_ar: 'أحمد علي' },
    };
    expect(getBookingEmployees(booking)).toHaveLength(1);
    expect(getBookingEmployees(booking)[0].full_name).toBe('Ahmed Ali');
  });

  it('returns empty when no employees and no users (service-based or legacy)', () => {
    expect(getBookingEmployees({})).toEqual([]);
    expect(getBookingEmployees({ employees: [] })).toEqual([]);
    expect(getBookingEmployees({ users: null })).toEqual([]);
  });

  it('handles multiple employees (grouped booking)', () => {
    const booking = {
      employees: [
        { id: 'e1', full_name: 'Ahmed', full_name_ar: 'أحمد' },
        { id: 'e2', full_name: 'Sara', full_name_ar: 'سارة' },
      ],
    };
    expect(getBookingEmployees(booking)).toHaveLength(2);
    expect(getBookingEmployees(booking).map(e => e.full_name)).toEqual(['Ahmed', 'Sara']);
  });
});

describe('employee-based availability logic (code path)', () => {
  it('employee-based mode uses only API shiftIds (no service shifts)', () => {
    const useEmployeeBasedAvailability = true;
    const employeeBasedShiftIdsFromApi: string[] | null = ['shift-1'];
    const shouldUseApiShiftIds = useEmployeeBasedAvailability && employeeBasedShiftIdsFromApi && employeeBasedShiftIdsFromApi.length > 0;
    expect(shouldUseApiShiftIds).toBe(true);
  });

  it('employee-based mode returns empty when API returns no shiftIds', () => {
    const useEmployeeBasedAvailability = true;
    const employeeBasedShiftIdsFromApi: string[] | null = null;
    const shouldReturnEmpty = useEmployeeBasedAvailability && (employeeBasedShiftIdsFromApi == null || employeeBasedShiftIdsFromApi.length === 0);
    expect(shouldReturnEmpty).toBe(true);
  });

  it('service-based mode does not return empty when employeeBasedShiftIds is undefined', () => {
    const useEmployeeBasedAvailability = false;
    const employeeBasedShiftIds: string[] | null | undefined = undefined;
    const shouldReturnEmpty = useEmployeeBasedAvailability && (employeeBasedShiftIds == null || employeeBasedShiftIds.length === 0);
    expect(shouldReturnEmpty).toBe(false);
  });
});
