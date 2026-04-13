export interface EmployeeSlotWindow {
  bookingId?: string;
  slotId?: string;
  slotDate: string;
  startTime: string;
  endTime: string;
}

export function toMinutes(timeValue: string): number {
  const parts = (timeValue || '').slice(0, 8).split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const aStart = toMinutes(startA);
  const aEnd = toMinutes(endA);
  const bStart = toMinutes(startB);
  const bEnd = toMinutes(endB);
  return aStart < bEnd && aEnd > bStart;
}

export function findOverlappingBooking(
  requestedSlot: EmployeeSlotWindow,
  existingSlots: EmployeeSlotWindow[],
  options?: { excludeBookingId?: string }
): EmployeeSlotWindow | null {
  for (const existing of existingSlots) {
    if (!existing.slotDate || existing.slotDate !== requestedSlot.slotDate) continue;
    if (options?.excludeBookingId && existing.bookingId === options.excludeBookingId) continue;
    if (!rangesOverlap(existing.startTime, existing.endTime, requestedSlot.startTime, requestedSlot.endTime)) continue;
    return existing;
  }
  return null;
}

export function resolveEmployeeForBookingTimeEdit(params: {
  newSlotEmployeeId?: string | null;
  currentBookingEmployeeId?: string | null;
}): string | null {
  const { newSlotEmployeeId, currentBookingEmployeeId } = params;
  if (newSlotEmployeeId) return newSlotEmployeeId;
  if (currentBookingEmployeeId) return currentBookingEmployeeId;
  return null;
}
