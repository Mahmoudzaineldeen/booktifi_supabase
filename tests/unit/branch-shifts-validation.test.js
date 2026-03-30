/**
 * Unit test: branch shift time validation logic (no server required).
 * Ensures we allow overnight (end < start) and only reject when start === end.
 */
import { describe, it, expect } from 'vitest';

function shouldRejectShift(startTime, endTime) {
  const start = (startTime && String(startTime).trim()) || '09:00';
  const end = (endTime && String(endTime).trim()) || '17:00';
  const startNorm = start.length === 5 ? `${start}:00` : start.slice(0, 8);
  const endNorm = end.length === 5 ? `${end}:00` : end.slice(0, 8);
  return endNorm === startNorm;
}

describe('branch shift time validation', () => {
  it('9 PM to 12 AM (overnight) — allowed', () => {
    expect(shouldRejectShift('21:00', '00:00')).toBe(false);
  });
  it('9 PM to 2 AM (overnight) — allowed', () => {
    expect(shouldRejectShift('21:00', '02:00')).toBe(false);
  });
  it('9 PM to 2 AM with seconds — allowed', () => {
    expect(shouldRejectShift('21:00:00', '02:00:00')).toBe(false);
  });
  it('9 AM to 5 PM (same-day) — allowed', () => {
    expect(shouldRejectShift('09:00', '17:00')).toBe(false);
  });
  it('Same start and end 21:00–21:00 — rejected', () => {
    expect(shouldRejectShift('21:00', '21:00')).toBe(true);
  });
  it('Same start and end 09:00–09:00 — rejected', () => {
    expect(shouldRejectShift('09:00', '09:00')).toBe(true);
  });
  it('Midnight to 1 AM — allowed', () => {
    expect(shouldRejectShift('00:00', '01:00')).toBe(false);
  });
});
