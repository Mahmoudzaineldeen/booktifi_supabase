/**
 * Shared Booking Availability Logic
 * 
 * This module provides unified availability calculation logic
 * used by both Customer Booking page and Receptionist Booking page.
 * 
 * Ensures consistent slot availability across all booking flows.
 */

import { format } from 'date-fns';
import { db } from './db';
import { getApiUrl } from './apiUrl';

export interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  available_capacity: number;
  booked_count: number;
  employee_id?: string | null;
  shift_id: string;
  users?: {
    full_name?: string;
    full_name_ar?: string;
  } | null;
  isPast?: boolean; // Optional: for receptionist page to mark past slots
}

export interface Shift {
  id: string;
  days_of_week: number[];
}

export interface AvailabilityOptions {
  tenantId: string;
  serviceId: string;
  date: Date;
  includePastSlots?: boolean; // For receptionist: show past slots but mark them
  includeLockedSlots?: boolean; // For receptionist: show locked slots but mark them
  includeZeroCapacity?: boolean; // For receptionist: show fully booked slots
}

export interface AvailabilityResult {
  slots: Slot[];
  shifts: Shift[];
  lockedSlotIds: string[];
}

/**
 * Fetch available slots using the unified availability logic
 * 
 * This function implements the exact same logic as the Customer Booking page:
 * 1. Fetches shifts for the service
 * 2. Fetches slots for those shifts on the selected date
 * 3. Filters by available_capacity > 0 (unless includeZeroCapacity is true)
 * 4. Fetches and filters out locked slots (unless includeLockedSlots is true)
 * 5. Filters by shift days_of_week
 * 6. Filters out past time slots for today (unless includePastSlots is true)
 * 
 * @param options - Availability calculation options
 * @returns Availability result with filtered slots
 */
export async function fetchAvailableSlots(
  options: AvailabilityOptions
): Promise<AvailabilityResult> {
  const {
    tenantId,
    serviceId,
    date,
    includePastSlots = false,
    includeLockedSlots = false,
    includeZeroCapacity = false,
  } = options;

  const dateStr = format(date, 'yyyy-MM-dd');

  // Step 1: Fetch shifts for this service
  console.log('[bookingAvailability] ========================================');
  console.log('[bookingAvailability] Fetching shifts for service:', serviceId);
  console.log('[bookingAvailability] Tenant ID:', tenantId);
  console.log('[bookingAvailability] Date:', dateStr);
  console.log('[bookingAvailability] ========================================');
  
  const { data: shifts, error: shiftsError } = await db
    .from('shifts')
    .select('id, days_of_week')
    .eq('service_id', serviceId)
    .eq('is_active', true);

  console.log('[bookingAvailability] Shifts query result:', {
    shiftsFound: shifts?.length || 0,
    error: shiftsError?.message,
    shifts: shifts?.map(s => ({ id: s.id, days: s.days_of_week }))
  });

  if (shiftsError) {
    console.error('[bookingAvailability] Error fetching shifts:', shiftsError);
    return { slots: [], shifts: [], lockedSlotIds: [] };
  }

  const shiftIds = shifts?.map(s => s.id) || [];

  if (shiftIds.length === 0) {
    console.error('[bookingAvailability] ❌ No shifts found for service:', serviceId);
    return { slots: [], shifts: shifts || [], lockedSlotIds: [] };
  }

  // Step 2: Fetch slots for these shifts on the selected date
  let slotsQuery = db
    .from('slots')
    .select(`
      id,
      slot_date,
      start_time,
      end_time,
      available_capacity,
      booked_count,
      employee_id,
      shift_id,
      users:employee_id (full_name, full_name_ar)
    `)
    .eq('tenant_id', tenantId)
    .in('shift_id', shiftIds)
    .eq('slot_date', dateStr)
    .eq('is_available', true);

  // Step 3: Filter by available_capacity (unless includeZeroCapacity is true)
  if (!includeZeroCapacity) {
    slotsQuery = slotsQuery.gt('available_capacity', 0);
  }

  const { data: slotsData, error: slotsError } = await slotsQuery.order('start_time');

  if (slotsError) {
    console.error('[bookingAvailability] Error fetching slots:', slotsError);
    return { slots: [], shifts: shifts || [], lockedSlotIds: [] };
  }

  let availableSlots = (slotsData || []) as Slot[];
  
  console.log('[bookingAvailability] Fetched slots from database:', {
    dateStr,
    tenantId,
    serviceId,
    shiftIds,
    slotCount: availableSlots.length,
    slots: availableSlots.map(s => ({ 
      id: s.id.substring(0, 8), 
      date: s.slot_date, 
      time: s.start_time, 
      capacity: s.available_capacity,
      shiftId: s.shift_id.substring(0, 8)
    }))
  });

  // Step 4: Fetch active locks for these slots to exclude locked ones
  const slotIds = availableSlots.map(s => s.id);
  let lockedSlotIds: string[] = [];

  if (slotIds.length > 0 && !includeLockedSlots) {
    try {
      const API_URL = getApiUrl();
      // Use POST to avoid 431 error (Request Header Fields Too Large) when there are many slots
      const locksResponse = await fetch(`${API_URL}/bookings/locks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slot_ids: slotIds }),
      });

      if (locksResponse.ok) {
        const locks = await locksResponse.json();
        lockedSlotIds = locks.map((l: any) => l.slot_id);
      } else {
        console.warn('[bookingAvailability] Failed to fetch locks:', locksResponse.status, locksResponse.statusText);
      }
    } catch (err) {
      console.warn('[bookingAvailability] Failed to fetch locks:', err);
    }
  }

  // Step 5: Filter out locked slots (unless includeLockedSlots is true)
  if (!includeLockedSlots) {
    availableSlots = availableSlots.filter(slot =>
      slot.available_capacity > 0 && !lockedSlotIds.includes(slot.id)
    );
  }

  // Step 6: Filter slots to only include those that match shift days_of_week
  // This prevents showing slots for days that don't match the shift schedule
  if (shifts && shifts.length > 0) {
    // Create a map of shift_id -> days_of_week for quick lookup
    const shiftDaysMap = new Map<string, number[]>();
    shifts.forEach((shift: any) => {
      shiftDaysMap.set(shift.id, shift.days_of_week);
    });

    // Get day of week from the date string to avoid timezone issues
    // Parse the date string directly instead of using date.getDay()
    const [year, month, day] = dateStr.split('-').map(Number);
    const normalizedDate = new Date(year, month - 1, day);
    const dayOfWeek = normalizedDate.getDay();

    console.log('[bookingAvailability] Day of week check:', {
      dateStr,
      dayOfWeek,
      dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
      availableSlotCount: availableSlots.length,
      shifts: Array.from(shiftDaysMap.entries()).map(([id, days]) => ({ id, days }))
    });

    // Filter slots: only keep slots where the day matches the shift's days_of_week
    availableSlots = availableSlots.filter((slot: Slot) => {
      const slotShiftId = slot.shift_id;
      if (!slotShiftId) {
        console.warn(`[bookingAvailability] Slot ${slot.id} has no shift_id - filtering out`);
        return false;
      }

      const shiftDays = shiftDaysMap.get(slotShiftId);
      if (!shiftDays || shiftDays.length === 0) {
        console.warn(`[bookingAvailability] Shift ${slotShiftId} has no days_of_week - filtering out slot ${slot.id}`);
        return false;
      }

      // Check if this day matches the shift's days_of_week
      if (shiftDays.includes(dayOfWeek)) {
        return true;
      }

      // Day doesn't match the shift's days_of_week, filter it out
      console.warn(
        `[bookingAvailability] Filtering out slot ${slot.id} on ${dateStr} (DOW=${dayOfWeek}/${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek]}) - doesn't match shift ${slotShiftId} days [${shiftDays.join(', ')}]`
      );
      return false;
    });

    console.log('[bookingAvailability] After day-of-week filter: ' + availableSlots.length + ' slots remaining');
  }

  // Step 7: Filter out past time slots for today only (unless includePastSlots is true)
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const isToday = dateStr === todayStr;

  if (isToday && !includePastSlots) {
    const currentTime = now.getHours() * 60 + now.getMinutes(); // Current time in minutes since midnight

    availableSlots = availableSlots.filter((slot: Slot) => {
      if (!slot.start_time) {
        return true; // Keep slots without start_time
      }

      // Handle time format: "HH:MM" or "HH:MM:SS"
      const timeParts = slot.start_time.split(':');
      const hours = parseInt(timeParts[0] || '0', 10);
      const minutes = parseInt(timeParts[1] || '0', 10);

      if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return true; // Keep slots with invalid time
      }

      const slotTime = hours * 60 + minutes; // Slot time in minutes since midnight
      // Keep slot if its start time is in the future
      return slotTime > currentTime;
    });
  } else if (isToday && includePastSlots) {
    // For receptionist: mark slots as past/future but don't filter them
    const currentTime = now.getHours() * 60 + now.getMinutes();
    availableSlots = availableSlots.map((slot: Slot) => {
      if (!slot.start_time) {
        return { ...slot, isPast: false };
      }

      const timeParts = slot.start_time.split(':');
      const hours = parseInt(timeParts[0] || '0', 10);
      const minutes = parseInt(timeParts[1] || '0', 10);

      if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return { ...slot, isPast: false };
      }

      const slotTime = hours * 60 + minutes;
      const isPast = slotTime <= currentTime;

      return { ...slot, isPast };
    });
  } else {
    // For future dates, mark all slots as future
    availableSlots = availableSlots.map((slot: Slot) => ({ ...slot, isPast: false }));
  }

  return {
    slots: availableSlots,
    shifts: shifts || [],
    lockedSlotIds,
  };
}
