import { db } from './db';
import type { CapacityMode, CapacityCalculation, ShiftDurationValidation, EmployeeShiftConflict } from '../types';

export async function calculateServiceCapacity(
  serviceId: string,
  shiftId?: string
): Promise<CapacityCalculation | null> {
  try {
    const { data: service, error: serviceError } = await db
      .from('services')
      .select('capacity_mode, service_capacity_per_slot')
      .eq('id', serviceId)
      .single();

    if (serviceError || !service) {
      console.error('Error fetching service:', serviceError);
      return null;
    }

    if (service.capacity_mode === 'service_based') {
      return {
        mode: 'service_based',
        totalCapacity: service.service_capacity_per_slot || 0,
        source: 'service',
      };
    }

    if (!shiftId) {
      return null;
    }

    const { data: employees, error: employeesError } = await db
      .from('employee_services')
      .select(`
        employee_id,
        users!inner (
          id,
          full_name,
          capacity_per_slot
        )
      `)
      .eq('shift_id', shiftId);

    if (employeesError) {
      console.error('Error fetching employees:', employeesError);
      return null;
    }

    if (!employees || employees.length === 0) {
      return {
        mode: 'employee_based',
        totalCapacity: 0,
        source: 'employees',
        employees: [],
      };
    }

    const employeeList = employees.map((e: any) => ({
      id: e.users.id,
      name: e.users.full_name,
      capacity: e.users.capacity_per_slot,
    }));

    const totalCapacity = employeeList.reduce((sum, emp) => sum + emp.capacity, 0);

    return {
      mode: 'employee_based',
      totalCapacity,
      source: 'employees',
      employees: employeeList,
    };
  } catch (error) {
    console.error('Error calculating capacity:', error);
    return null;
  }
}

export function validateShiftDuration(
  shiftStartTime: string,
  shiftEndTime: string,
  serviceDurationMinutes: number
): ShiftDurationValidation {
  const [startHour, startMin] = shiftStartTime.split(':').map(Number);
  const [endHour, endMin] = shiftEndTime.split(':').map(Number);

  const shiftStartMinutes = startHour * 60 + startMin;
  const shiftEndMinutes = endHour * 60 + endMin;
  const shiftDurationMinutes = shiftEndMinutes - shiftStartMinutes;

  const isValid = shiftDurationMinutes >= serviceDurationMinutes;
  const slotsCount = Math.floor(shiftDurationMinutes / serviceDurationMinutes);

  return {
    isValid,
    shiftDurationMinutes,
    serviceDurationMinutes,
    slotsCount,
    message: isValid
      ? `This shift can accommodate ${slotsCount} slot(s)`
      : `Shift duration (${shiftDurationMinutes} min) is shorter than service duration (${serviceDurationMinutes} min)`,
  };
}

export async function checkEmployeeShiftConflict(
  employeeId: string,
  serviceId: string,
  shiftId: string
): Promise<EmployeeShiftConflict> {
  try {
    const { data, error } = await db.rpc('check_employee_shift_overlap', {
      p_employee_id: employeeId,
      p_service_id: serviceId,
      p_shift_id: shiftId,
    });

    if (error) {
      console.error('Error checking shift conflict:', error);
      return {
        hasConflict: false,
        message: 'Unable to check for conflicts',
      };
    }

    if (data) {
      const { data: conflictDetails } = await db
        .from('employee_services')
        .select(`
          service_id,
          services!inner (name),
          shifts!inner (start_time_utc, end_time_utc)
        `)
        .eq('employee_id', employeeId)
        .neq('service_id', serviceId)
        .limit(1)
        .single();

      if (conflictDetails) {
        return {
          hasConflict: true,
          conflictingService: conflictDetails.services.name,
          conflictingShift: `${conflictDetails.shifts.start_time_utc} - ${conflictDetails.shifts.end_time_utc}`,
          message: `Employee is already assigned to ${conflictDetails.services.name} during an overlapping time period`,
        };
      }
    }

    return {
      hasConflict: false,
    };
  } catch (error) {
    console.error('Error checking employee conflict:', error);
    return {
      hasConflict: false,
      message: 'Error checking for conflicts',
    };
  }
}

export async function regenerateSlotsForService(
  serviceId: string,
  startDate: string,
  endDate: string
): Promise<{ success: boolean; message: string; totalSlots?: number }> {
  try {
    const { data: shifts, error: shiftsError } = await db
      .from('shifts')
      .select('id')
      .eq('service_id', serviceId)
      .eq('is_active', true);

    if (shiftsError) {
      return { success: false, message: shiftsError.message };
    }

    if (!shifts || shifts.length === 0) {
      return { success: true, message: 'No shifts found for this service', totalSlots: 0 };
    }

    let totalSlots = 0;

    for (const shift of shifts) {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/rpc/generate_slots_for_shift`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            shift_id: shift.id,
            start_date: startDate,
            end_date: endDate,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        console.error('Error regenerating slots for shift:', shift.id, error);
        continue;
      }

      const result = await response.json();
      totalSlots += result.slots_generated || 0;
    }

    return {
      success: true,
      message: `Successfully regenerated ${totalSlots} slots`,
      totalSlots,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Error regenerating slots',
    };
  }
}

export async function checkOverbookedSlots(serviceId: string): Promise<number> {
  try {
    const { data: shifts } = await db
      .from('shifts')
      .select('id')
      .eq('service_id', serviceId);

    if (!shifts || shifts.length === 0) {
      return 0;
    }

    const shiftIds = shifts.map(s => s.id);

    const { count, error } = await db
      .from('slots')
      .select('*', { count: 'exact', head: true })
      .in('shift_id', shiftIds)
      .eq('is_overbooked', true)
      .gte('slot_date', new Date().toISOString().split('T')[0]);

    if (error) {
      console.error('Error checking overbooked slots:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('Error checking overbooked slots:', error);
    return 0;
  }
}
