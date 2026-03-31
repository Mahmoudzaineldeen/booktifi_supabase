import { describe, expect, it } from 'vitest';
import { findOverlappingBooking, rangesOverlap } from '../../server/src/utils/employeeBookingConflict';

describe('employee booking conflict helper', () => {
  it('detects overlap with the same date', () => {
    const overlap = findOverlappingBooking(
      {
        slotDate: '2026-03-31',
        startTime: '09:30:00',
        endTime: '10:30:00',
      },
      [
        {
          bookingId: 'b1',
          slotDate: '2026-03-31',
          startTime: '09:00:00',
          endTime: '10:00:00',
        },
      ]
    );
    expect(overlap?.bookingId).toBe('b1');
  });

  it('does not overlap adjacent windows', () => {
    expect(rangesOverlap('09:00:00', '10:00:00', '10:00:00', '11:00:00')).toBe(false);
  });

  it('ignores the current booking when excluded', () => {
    const overlap = findOverlappingBooking(
      {
        bookingId: 'same',
        slotDate: '2026-03-31',
        startTime: '09:15:00',
        endTime: '09:45:00',
      },
      [
        {
          bookingId: 'same',
          slotDate: '2026-03-31',
          startTime: '09:00:00',
          endTime: '10:00:00',
        },
      ],
      { excludeBookingId: 'same' }
    );
    expect(overlap).toBeNull();
  });
});
