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

  // Step 0: Global scheduling mode (tenant_features) overrides per-service behavior
  const { data: tenantFeatures } = await db
    .from('tenant_features')
    .select('scheduling_mode, employee_assignment_mode')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const globalSchedulingMode = (tenantFeatures as any)?.scheduling_mode ?? 'service_slot_based';
  const tenantAssignmentMode = (tenantFeatures as any)?.employee_assignment_mode ?? 'both';

  const { data: serviceRow } = await db
    .from('services')
    .select('scheduling_type, assignment_mode')
    .eq('id', serviceId)
    .eq('tenant_id', tenantId)
    .single();
  const schedulingType = (serviceRow as any)?.scheduling_type;
  const assignmentMode = (serviceRow as any)?.assignment_mode;

  const useEmployeeBasedAvailability = globalSchedulingMode === 'employee_based';
  /** Only set when we call ensure-employee-based-slots; used so employee-based mode uses only API shift IDs. */
  let employeeBasedShiftIds: string[] | null | undefined = undefined;

  if (useEmployeeBasedAvailability) {
    try {
      const API_URL = getApiUrl();
      const res = await fetch(`${API_URL}/bookings/ensure-employee-based-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, serviceId, date: dateStr }),
      });
      if (res.ok) {
        const body = await res.json();
        employeeBasedShiftIds = Array.isArray(body?.shiftIds) ? body.shiftIds : null;
      } else {
        console.warn('[bookingAvailability] ensure-employee-based-slots failed:', res.status, await res.text());
        employeeBasedShiftIds = null;
      }
    } catch (err) {
      console.warn('[bookingAvailability] ensure-employee-based-slots error:', err);
      employeeBasedShiftIds = null;
    }
  } else if (schedulingType === 'employee_based') {
    try {
      const API_URL = getApiUrl();
      const res = await fetch(`${API_URL}/bookings/ensure-employee-based-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, serviceId, date: dateStr }),
      });
      if (res.ok) {
        const body = await res.json();
        employeeBasedShiftIds = Array.isArray(body?.shiftIds) ? body.shiftIds : null;
      } else {
        console.warn('[bookingAvailability] ensure-employee-based-slots failed:', res.status, await res.text());
        employeeBasedShiftIds = null;
      }
    } catch (err) {
      console.warn('[bookingAvailability] ensure-employee-based-slots error:', err);
      employeeBasedShiftIds = null;
    }
  }

  // In employee-based mode, only show slots from API; if we got no shift IDs, return empty (no service slots)
  if (useEmployeeBasedAvailability && (employeeBasedShiftIds == null || employeeBasedShiftIds.length === 0)) {
    return { slots: [], shifts: [], lockedSlotIds: [] };
  }

  console.log('[bookingAvailability] ========================================');
  console.log('[bookingAvailability] Fetching shifts for service:', serviceId);
  console.log('[bookingAvailability] Tenant ID:', tenantId);
  console.log('[bookingAvailability] Date:', dateStr);
  console.log('[bookingAvailability] ========================================');

  let shifts: Shift[] | null = null;
  let shiftsError: any = null;

  if (useEmployeeBasedAvailability && employeeBasedShiftIds && employeeBasedShiftIds.length > 0) {
    const { data: shiftData, error: shiftErr } = await db
      .from('shifts')
      .select('id, days_of_week')
      .in('id', employeeBasedShiftIds)
      .eq('is_active', true);
    shifts = shiftData || null;
    shiftsError = shiftErr;
  } else {
    const result = await db
      .from('shifts')
      .select('id, days_of_week')
      .eq('service_id', serviceId)
      .eq('is_active', true);
    shifts = result.data || null;
    shiftsError = result.error;
  }

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
  // Skip when showing employee-based slots: backend creates slots per-date from employee_shifts;
  // the shift we reuse may have different days (e.g. Mon–Fri), but slots were already created
  // only for the selected date and only for employees who work that day.
  const showingEmployeeBasedSlots = (employeeBasedShiftIds != null && employeeBasedShiftIds.length > 0);
  if (shifts && shifts.length > 0 && !showingEmployeeBasedSlots) {
    // Create a map of shift_id -> days_of_week for quick lookup
    const shiftDaysMap = new Map<string, number[]>();
    shifts.forEach((shift: any) => {
      shiftDaysMap.set(shift.id, shift.days_of_week);
    });

    // Get day of week from the date string to avoid timezone issues
    const [year, month, day] = dateStr.split('-').map(Number);
    const normalizedDate = new Date(year, month - 1, day);
    const dayOfWeek = normalizedDate.getDay();
    const targetDayOfWeek = dayOfWeek;

    // Filter slots: only keep slots where the day matches the shift's days_of_week
    availableSlots = availableSlots.filter((slot: Slot) => {
      const slotShiftId = slot.shift_id;
      if (!slotShiftId) return false;
      const shiftDays = shiftDaysMap.get(slotShiftId);
      if (!shiftDays || shiftDays.length === 0) return false;
      return shiftDays.includes(targetDayOfWeek);
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

  // For employee-based + auto_assign: show one slot per time (the next employee in rotation)
  const effectiveEmployeeBased = useEmployeeBasedAvailability || schedulingType === 'employee_based';
  const useAutoAssign = useEmployeeBasedAvailability
    ? (tenantAssignmentMode === 'automatic' || tenantAssignmentMode === 'both')
    : assignmentMode === 'auto_assign';
  if (effectiveEmployeeBased && useAutoAssign && availableSlots.length > 0) {
    const { data: rotationRow } = await db.from('service_rotation_state').select('last_assigned_employee_id').eq('service_id', serviceId).single();
    const lastAssignedId = (rotationRow as any)?.last_assigned_employee_id ?? null;
    const { data: empServices } = await db.from('employee_services').select('employee_id').eq('service_id', serviceId).eq('shift_id', null);
    const employeeIds = [...new Set((empServices || []).map((es: any) => es.employee_id))].sort();
    const nextIndex = lastAssignedId ? (employeeIds.indexOf(lastAssignedId) + 1) % Math.max(1, employeeIds.length) : 0;
    const nextEmployeeId = employeeIds[nextIndex] ?? employeeIds[0];
    const byStartTime = new Map<string, Slot[]>();
    for (const slot of availableSlots) {
      const key = slot.start_time || '';
      if (!byStartTime.has(key)) byStartTime.set(key, []);
      byStartTime.get(key)!.push(slot);
    }
    availableSlots = [];
    for (const [, slotsAtTime] of byStartTime) {
      const rotated = slotsAtTime.find(s => s.employee_id === nextEmployeeId) ?? slotsAtTime[0];
      availableSlots.push(rotated);
    }
    availableSlots.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
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
