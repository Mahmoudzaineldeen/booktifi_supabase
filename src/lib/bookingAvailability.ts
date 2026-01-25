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

  const shiftIds = shifts?.map(s => s.id).filter(Boolean) || [];

  if (shiftIds.length === 0) {
    console.error('[bookingAvailability] ❌ No shifts found for service:', serviceId);
    console.error('[bookingAvailability]    Service ID:', serviceId);
    console.error('[bookingAvailability]    Tenant ID:', tenantId);
    console.error('[bookingAvailability]    Shifts data:', shifts);
    return { slots: [], shifts: shifts || [], lockedSlotIds: [] };
  }
  
  console.log('[bookingAvailability] Shift IDs extracted:', {
    count: shiftIds.length,
    ids: shiftIds.map(id => id.substring(0, 8))
  });

  // Step 2: Fetch slots for these shifts on the selected date
  console.log('[bookingAvailability] ========================================');
  console.log('[bookingAvailability] Building slots query with filters:');
  console.log(`[bookingAvailability]    tenant_id = ${tenantId}`);
  console.log(`[bookingAvailability]    shift_id IN [${shiftIds.length} shifts]:`, shiftIds.map(id => id.substring(0, 8)));
  console.log(`[bookingAvailability]    slot_date = ${dateStr}`);
  console.log(`[bookingAvailability]    is_available = true`);
  console.log(`[bookingAvailability]    includeZeroCapacity = ${includeZeroCapacity}`);
  if (!includeZeroCapacity) {
    console.log(`[bookingAvailability]    available_capacity > 0 (filtering zero capacity)`);
  }
  console.log('[bookingAvailability] ========================================');
  
  // CRITICAL: Ensure shiftIds is not empty and is an array
  if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
    console.error('[bookingAvailability] ❌ Invalid shiftIds:', shiftIds);
    return { slots: [], shifts: shifts || [], lockedSlotIds: [] };
  }
  
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
  
  console.log('[bookingAvailability] Query executed. Results:');
  console.log(`[bookingAvailability]    Slots found: ${slotsData?.length || 0}`);
  if (slotsError) {
    console.error(`[bookingAvailability]    Error: ${slotsError.message}`);
    console.error(`[bookingAvailability]    Error code: ${slotsError.code}`);
    console.error(`[bookingAvailability]    Error details:`, slotsError);
    console.error('[bookingAvailability] Error fetching slots:', slotsError);
    return { slots: [], shifts: shifts || [], lockedSlotIds: [] };
  }

  let availableSlots = (slotsData || []) as Slot[];
  
  console.log('[bookingAvailability] ========================================');
  console.log('[bookingAvailability] Fetched slots from database:', {
    dateStr,
    tenantId,
    serviceId,
    shiftIds: shiftIds.map(id => id.substring(0, 8)),
    shiftIdsCount: shiftIds.length,
    slotCount: availableSlots.length,
    includeZeroCapacity,
    slots: availableSlots.map(s => ({ 
      id: s.id.substring(0, 8), 
      date: s.slot_date, 
      time: s.start_time, 
      capacity: s.available_capacity,
      booked: s.booked_count,
      shiftId: s.shift_id?.substring(0, 8) || 'NO_SHIFT_ID'
    }))
  });
  console.log('[bookingAvailability] ========================================');
  
  // CRITICAL: If no slots found but shifts exist, log detailed diagnostic info
  if (availableSlots.length === 0 && shiftIds.length > 0) {
    console.warn('[bookingAvailability] ⚠️  NO SLOTS FOUND - Running diagnostic query...');
    
    // Try querying WITHOUT the available_capacity filter to see if slots exist
    try {
      const diagnosticQuery = db
        .from('slots')
        .select('id, slot_date, start_time, end_time, available_capacity, booked_count, shift_id, is_available')
        .eq('tenant_id', tenantId)
        .in('shift_id', shiftIds)
        .eq('slot_date', dateStr);
      
      const { data: allSlots, error: diagError } = await diagnosticQuery.order('start_time');
      
      if (!diagError && allSlots && allSlots.length > 0) {
        console.warn('[bookingAvailability] 🔍 DIAGNOSTIC: Found slots WITHOUT capacity filter:', allSlots.length);
        console.warn('[bookingAvailability]    Slots breakdown:');
        allSlots.forEach((slot: any) => {
          console.warn(`      - Slot ${slot.id.substring(0, 8)}: ${slot.start_time}, capacity=${slot.available_capacity}, booked=${slot.booked_count}, is_available=${slot.is_available}`);
        });
        
        // Check if they're being filtered by capacity
        const zeroCapacitySlots = allSlots.filter((s: any) => s.available_capacity <= 0);
        const unavailableSlots = allSlots.filter((s: any) => !s.is_available);
        const withCapacity = allSlots.filter((s: any) => s.available_capacity > 0 && s.is_available);
        
        console.warn(`[bookingAvailability]    Breakdown: ${withCapacity.length} available, ${zeroCapacitySlots.length} zero capacity, ${unavailableSlots.length} not available`);
        
        if (zeroCapacitySlots.length > 0 && !includeZeroCapacity) {
          console.warn(`[bookingAvailability]    ⚠️  ${zeroCapacitySlots.length} slots filtered out due to zero capacity (includeZeroCapacity=false)`);
        }
        if (unavailableSlots.length > 0) {
          console.warn(`[bookingAvailability]    ⚠️  ${unavailableSlots.length} slots filtered out due to is_available=false`);
        }
      } else if (!diagError && (!allSlots || allSlots.length === 0)) {
        console.warn('[bookingAvailability] 🔍 DIAGNOSTIC: No slots found at all for this date (even without filters)');
        console.warn('[bookingAvailability]    This means:');
        console.warn('[bookingAvailability]      1. No slots exist for shift_ids:', shiftIds.map(id => id.substring(0, 8)));
        console.warn('[bookingAvailability]      2. No slots exist for date:', dateStr);
        console.warn('[bookingAvailability]      3. OR slots exist but shift_id doesn\'t match');
      } else {
        console.error('[bookingAvailability] 🔍 DIAGNOSTIC query error:', diagError);
      }
    } catch (diagErr: any) {
      console.error('[bookingAvailability] 🔍 DIAGNOSTIC query exception:', diagErr);
    }
  }

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
  const slotsBeforeLockFilter = availableSlots.length;
  if (!includeLockedSlots) {
    availableSlots = availableSlots.filter(slot =>
      slot.available_capacity > 0 && !lockedSlotIds.includes(slot.id)
    );
    if (slotsBeforeLockFilter > availableSlots.length) {
      console.log(`[bookingAvailability] Filtered out ${slotsBeforeLockFilter - availableSlots.length} locked slots`);
    }
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
    
    // Also get day of week from the original date object for comparison
    const originalDayOfWeek = date.getDay();
    
    // Log both to catch any timezone issues
    console.log('[bookingAvailability] Day of week check:', {
      dateStr,
      dayOfWeekFromString: dayOfWeek,
      dayOfWeekFromDate: originalDayOfWeek,
      dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
      availableSlotCount: availableSlots.length,
      shifts: Array.from(shiftDaysMap.entries()).map(([id, days]) => ({ 
        id: id.substring(0, 8), 
        days, 
        dayNames: days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d])
      }))
    });
    
    // Use the normalized date's day of week (more reliable)
    const targetDayOfWeek = dayOfWeek;

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
      if (shiftDays.includes(targetDayOfWeek)) {
        return true;
      }

      // Day doesn't match the shift's days_of_week, filter it out
      console.warn(
        `[bookingAvailability] Filtering out slot ${slot.id.substring(0, 8)} on ${dateStr} (DOW=${targetDayOfWeek}/${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][targetDayOfWeek]}) - doesn't match shift ${slotShiftId.substring(0, 8)} days [${shiftDays.join(', ')}] (${shiftDays.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')})`
      );
      return false;
    });

    const slotsBeforeDayFilter = availableSlots.length;
    console.log('[bookingAvailability] After day-of-week filter: ' + availableSlots.length + ' slots remaining');
    if (slotsBeforeDayFilter > availableSlots.length) {
      console.warn(`[bookingAvailability] ⚠️  Filtered out ${slotsBeforeDayFilter - availableSlots.length} slots due to day-of-week mismatch`);
      console.warn(`[bookingAvailability]    Selected date: ${dateStr} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][targetDayOfWeek]})`);
      console.warn(`[bookingAvailability]    Shift days:`, Array.from(shiftDaysMap.entries()).map(([id, days]) => 
        `Shift ${id.substring(0, 8)}: [${days.join(', ')}] (${days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')})`
      ));
    }
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

  console.log('[bookingAvailability] ========================================');
  console.log('[bookingAvailability] FINAL RESULT:');
  console.log(`[bookingAvailability]    Total slots returned: ${availableSlots.length}`);
  console.log(`[bookingAvailability]    Shifts found: ${shifts?.length || 0}`);
  console.log(`[bookingAvailability]    Locked slot IDs: ${lockedSlotIds.length}`);
  if (availableSlots.length > 0) {
    console.log(`[bookingAvailability]    Slot times: ${availableSlots.map(s => s.start_time).join(', ')}`);
  }
  console.log('[bookingAvailability] ========================================');

  return {
    slots: availableSlots,
    shifts: shifts || [],
    lockedSlotIds,
  };
}
