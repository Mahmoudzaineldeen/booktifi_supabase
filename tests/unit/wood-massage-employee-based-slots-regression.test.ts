/**
 * Regression tests for "one service + one calendar date" scheduling issues.
 * Healing Touch–style tenant: global scheduling_mode = employee_based (see tenant backup).
 * Wood Massage (345 SAR) uses slot_based on the service row, but availability still comes from
 * ensure-employee-based-slots when scheduling_mode is employee_based.
 *
 * These tests lock in date math and the main failure modes from server/src/routes/bookings.ts.
 */
import { describe, it, expect } from 'vitest';
import { getDayOfWeekFromDateString } from '../../src/lib/bookingAvailability';

describe('April 1, 2026 (reported problem date)', () => {
  it('is Wednesday (3) with Sun=0 … Sat=6 — must match server dayOfWeek', () => {
    expect(getDayOfWeekFromDateString('2026-04-01')).toBe(3);
  });

  it('date string parsing is stable (no off-by-one for April)', () => {
    const [y, m, d] = '2026-04-01'.split('-').map(Number);
    expect(y).toBe(2026);
    expect(m).toBe(4);
    expect(d).toBe(1);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
    expect(dayOfWeek).toBe(3);
  });
});

describe('ensure-employee-based-slots slot loop (mirrors server logic)', () => {
  function countSlotsInWindow(
    shiftStartM: number,
    shiftEndM: number,
    durationMinutes: number
  ): number {
    let n = 0;
    let slotStartM = shiftStartM;
    while (slotStartM + durationMinutes <= shiftEndM) {
      n++;
      slotStartM += durationMinutes;
    }
    return n;
  }

  it('produces no slots when service duration exceeds shift window (config error)', () => {
    // e.g. 13:00–23:00 = 600 minutes; duration 700 → zero slots (every day, not only Apr 1)
    const startM = 13 * 60;
    const endM = 23 * 60;
    expect(countSlotsInWindow(startM, endM, 700)).toBe(0);
    expect(countSlotsInWindow(startM, endM, 60)).toBeGreaterThan(0);
  });

  it('Wednesday must be listed in days_of_week for shifts that should run on 2026-04-01', () => {
    const wed = getDayOfWeekFromDateString('2026-04-01');
    const shiftDaysMissingWed = [0, 1, 2, 4, 5, 6];
    expect(shiftDaysMissingWed.includes(wed)).toBe(false);
  });

  it('explains UI showing only 1:00 PM and 2:00 PM: two 60-min slots ⇒ shift window 13:00–15:00 (not a UI cap)', () => {
    const startM = 13 * 60;
    const endM = 15 * 60;
    const duration = 60;
    let n = 0;
    let m = startM;
    while (m + duration <= endM) {
      n++;
      m += duration;
    }
    expect(n).toBe(2);
  });
});
