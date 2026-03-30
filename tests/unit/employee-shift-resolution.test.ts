/**
 * Server util: custom employee_shifts must override branch_shifts (not merge).
 * Merging caused short windows (e.g. 13:00–16:00 custom + full branch) to dominate or duplicate slot rows.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEffectiveEmployeeShifts,
  mergeEffectiveShiftsForCalendarDay,
  sameDayIntervalSubsumedByOvernight,
} from '../../server/src/utils/employeeShiftResolution';

describe('buildEffectiveEmployeeShifts', () => {
  const branchId = 'b1';
  const emp1 = 'e1';

  it('uses only branch_shifts when employee has branch and no custom shifts', () => {
    const out = buildEffectiveEmployeeShifts({
      availableEmployeeIds: [emp1],
      employeeBranchId: new Map([[emp1, branchId]]),
      branchShiftsList: [
        {
          branch_id: branchId,
          days_of_week: [3],
          start_time: '13:00:00',
          end_time: '23:00:00',
        },
      ],
      empShifts: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      employee_id: emp1,
      start_time_utc: '13:00:00',
      end_time_utc: '23:00:00',
      days_of_week: [3],
    });
  });

  it('uses only custom employee_shifts when present (overrides branch — no merge)', () => {
    const out = buildEffectiveEmployeeShifts({
      availableEmployeeIds: [emp1],
      employeeBranchId: new Map([[emp1, branchId]]),
      branchShiftsList: [
        {
          branch_id: branchId,
          days_of_week: [3],
          start_time: '13:00:00',
          end_time: '23:00:00',
        },
      ],
      empShifts: [
        {
          employee_id: emp1,
          days_of_week: [3],
          start_time_utc: '13:00:00',
          end_time_utc: '16:00:00',
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].end_time_utc).toBe('16:00:00');
    expect(out[0].start_time_utc).toBe('13:00:00');
  });

  it('uses custom when employee has no branch', () => {
    const out = buildEffectiveEmployeeShifts({
      availableEmployeeIds: [emp1],
      employeeBranchId: new Map([[emp1, null]]),
      branchShiftsList: [],
      empShifts: [
        {
          employee_id: emp1,
          days_of_week: [1, 2, 3],
          start_time_utc: '09:00:00',
          end_time_utc: '17:00:00',
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].days_of_week).toEqual([1, 2, 3]);
  });

  it('returns nothing when employee has branch but no branch_shifts rows and no custom', () => {
    const out = buildEffectiveEmployeeShifts({
      availableEmployeeIds: [emp1],
      employeeBranchId: new Map([[emp1, branchId]]),
      branchShiftsList: [],
      empShifts: [],
    });
    expect(out).toHaveLength(0);
  });
});

describe('mergeEffectiveShiftsForCalendarDay', () => {
  const emp = 'e1';
  /** Wed = 3 — same day as 2026-04-01 in UTC-noon weekday logic */
  const wed = 3;

  it('merges overlapping windows into one span (full week row + redundant Wed-only short row)', () => {
    const shiftsForDay = [
      {
        employee_id: emp,
        start_time_utc: '13:00:00',
        end_time_utc: '23:00:00',
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
      },
      {
        employee_id: emp,
        start_time_utc: '13:00:00',
        end_time_utc: '16:00:00',
        days_of_week: [3],
      },
    ];
    const out = mergeEffectiveShiftsForCalendarDay(shiftsForDay, wed);
    expect(out).toHaveLength(1);
    expect(out[0].start_time_utc).toBe('13:00:00');
    expect(out[0].end_time_utc).toBe('23:00:00');
  });

  it('keeps disjoint intervals as separate rows', () => {
    const shiftsForDay = [
      {
        employee_id: emp,
        start_time_utc: '09:00:00',
        end_time_utc: '12:00:00',
        days_of_week: [3],
      },
      {
        employee_id: emp,
        start_time_utc: '14:00:00',
        end_time_utc: '18:00:00',
        days_of_week: [3],
      },
    ];
    const out = mergeEffectiveShiftsForCalendarDay(shiftsForDay, wed);
    expect(out).toHaveLength(2);
  });

  /**
   * Regression: full-week 13:00→midnight (overnight) + Wed-only 13:00–16:00 previously emitted BOTH,
   * duplicating 13:00 slots and breaking bulk insert — only 13:00 appeared for Wood Massage on Wed.
   */
  it('drops Wed-only same-day row when it is contained in a full-week overnight shift (13:00→00:00)', () => {
    const shiftsForDay = [
      {
        employee_id: emp,
        start_time_utc: '13:00:00',
        end_time_utc: '00:00:00',
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
      },
      {
        employee_id: emp,
        start_time_utc: '13:00:00',
        end_time_utc: '16:00:00',
        days_of_week: [3],
      },
    ];
    const out = mergeEffectiveShiftsForCalendarDay(shiftsForDay, wed);
    expect(out).toHaveLength(1);
    expect(out[0].start_time_utc).toBe('13:00:00');
    expect(out[0].end_time_utc).toBe('00:00:00');
  });
});

describe('sameDayIntervalSubsumedByOvernight', () => {
  it('detects 13:00–16:00 inside 13:00→midnight', () => {
    const a = 13 * 60;
    const b = 16 * 60;
    expect(sameDayIntervalSubsumedByOvernight(a, b, 13 * 60, 0)).toBe(true);
  });

  it('does not mark 09:00–12:00 as subsumed by 13:00→midnight', () => {
    expect(sameDayIntervalSubsumedByOvernight(9 * 60, 12 * 60, 13 * 60, 0)).toBe(false);
  });
});
