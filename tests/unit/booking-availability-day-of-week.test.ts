/**
 * Unit test: Calendar date → day-of-week (timezone-invariant via noon UTC).
 * Server and client must use the same rule so slot day matches (e.g. no Monday vs Sunday mismatch).
 */
import { describe, it, expect } from 'vitest';
import { getDayOfWeekFromDateString } from '../../src/lib/bookingAvailability';

describe('getDayOfWeekFromDateString (booking availability)', () => {
  it('2025-02-25 is Tuesday (2) - noon UTC so server and client agree', () => {
    expect(getDayOfWeekFromDateString('2025-02-25')).toBe(2);
  });

  it('2025-02-24 is Monday (1)', () => {
    expect(getDayOfWeekFromDateString('2025-02-24')).toBe(1);
  });

  it('2025-02-23 is Sunday (0)', () => {
    expect(getDayOfWeekFromDateString('2025-02-23')).toBe(0);
  });

  it('Sunday = 0, Saturday = 6', () => {
    expect(getDayOfWeekFromDateString('2025-03-02')).toBe(0); // Sunday
    expect(getDayOfWeekFromDateString('2025-03-01')).toBe(6); // Saturday
    expect(getDayOfWeekFromDateString('2025-03-03')).toBe(1); // Monday
  });
});
