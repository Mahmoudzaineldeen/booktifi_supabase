/**
 * Resolves which working hours apply per employee for employee-based slot generation.
 *
 * — If the employee has a branch → include that branch's branch_shifts.
 * — If the employee has custom employee_shifts → include those too.
 * — mergeEffectiveShiftsForCalendarDay() then merges per calendar day (union overlapping windows,
 *   drop same-day rows subsumed by overnight, etc.).
 *
 * When both exist, branch + custom are combined so a stray partial custom row (e.g. Wed-only 13:00–16:00)
 * does not hide full branch hours (13:00–midnight). To restrict an employee to shorter hours than the
 * branch on the same weekdays, use only employee_shifts and clear branch_id (or align data so custom
 * is the sole source of truth).
 */

export type EffectiveShift = {
  employee_id: string;
  start_time_utc: string;
  end_time_utc: string;
  days_of_week: number[];
};

type BranchShiftRow = {
  branch_id: string;
  days_of_week: unknown;
  start_time: unknown;
  end_time: unknown;
};

type EmployeeShiftRow = {
  employee_id: string;
  days_of_week: unknown;
  start_time_utc: unknown;
  end_time_utc: unknown;
};

/** PostgreSQL can return int[] or string like "{0,1,2}" */
export function toDaysArray(d: unknown): number[] {
  if (Array.isArray(d)) {
    return d.map((x: unknown) => Number(x)).filter((n: number) => !Number.isNaN(n) && n >= 0 && n <= 6);
  }
  if (typeof d === 'string') {
    return d
      .replace(/[{}]/g, '')
      .split(',')
      .map((x: string) => Number(x.trim()))
      .filter((n: number) => !Number.isNaN(n) && n >= 0 && n <= 6);
  }
  return [];
}

export function toTimeStr(t: unknown): string {
  if (t == null) return '00:00:00';
  const s = String(t);
  if (s.length >= 8) return s.slice(0, 8);
  if (s.length === 5) return `${s}:00`;
  return s;
}

export function buildEffectiveEmployeeShifts(options: {
  availableEmployeeIds: string[];
  employeeBranchId: Map<string, string | null | undefined>;
  branchShiftsList: BranchShiftRow[];
  empShifts: EmployeeShiftRow[] | null | undefined;
}): EffectiveShift[] {
  const { availableEmployeeIds, employeeBranchId, branchShiftsList, empShifts } = options;
  const list = empShifts || [];
  const effectiveShifts: EffectiveShift[] = [];

  for (const eid of availableEmployeeIds) {
    const branchId = employeeBranchId.get(eid);
    const customShifts = list.filter((s) => s.employee_id === eid);

    for (const es of customShifts) {
      const days = toDaysArray(es.days_of_week);
      if (days.length === 0) continue;
      effectiveShifts.push({
        employee_id: eid,
        start_time_utc: toTimeStr(es.start_time_utc),
        end_time_utc: toTimeStr(es.end_time_utc),
        days_of_week: days,
      });
    }

    if (branchId) {
      for (const bs of branchShiftsList) {
        if (bs.branch_id !== branchId) continue;
        const days = toDaysArray(bs.days_of_week);
        if (days.length === 0) continue;
        effectiveShifts.push({
          employee_id: eid,
          start_time_utc: toTimeStr(bs.start_time),
          end_time_utc: toTimeStr(bs.end_time),
          days_of_week: days,
        });
      }
    }
  }

  return effectiveShifts;
}

const MINUTES_PER_DAY = 24 * 60;

function timeStrToMinutes(t: string): number {
  const parts = (t || '00:00:00').slice(0, 8).split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function minutesToTimeStr(mins: number): string {
  const normalized = ((mins % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * True if same-calendar-day interval [a, b) in minutes is fully covered by an overnight shift
 * (end <= start), e.g. 13:00–00:00 covers [13:00, 24:00) and [00:00, end) when end > 0.
 * Used to drop redundant Wed-only (etc.) rows that are subsets of a full-week overnight row.
 */
export function sameDayIntervalSubsumedByOvernight(
  a: number,
  b: number,
  overnightStartM: number,
  overnightEndM: number
): boolean {
  if (overnightEndM > overnightStartM) return false;
  // Overnight: [overnightStartM, MINUTES_PER_DAY) ∪ [0, overnightEndM)
  if (a >= overnightStartM && b <= MINUTES_PER_DAY && a < b) {
    return true;
  }
  if (overnightEndM > 0 && a >= 0 && b <= overnightEndM && a < b) {
    return true;
  }
  return false;
}

/**
 * For one calendar day, merge overlapping/adjacent same-day intervals per employee.
 * Fixes split configs: e.g. branch row "Sun–Tue, Thu–Sat 13:00–23:00" + row "Wed 13:00–16:00"
 * becomes a single 13:00–23:00 window on Wed when both rows apply (union), not only the short row.
 * Overnight shifts (end <= start on the clock) are passed through without merging.
 *
 * When a same-day row is fully contained in an overnight row's coverage (e.g. Wed 13:00–16:00 inside
 * Mon–Sun 13:00–00:00), only the overnight row is kept — otherwise both would be emitted and slot
 * generation would duplicate the first slot (same start time) and bulk insert could fail or show
 * only the short window.
 */
export function mergeEffectiveShiftsForCalendarDay(
  shiftsForDay: EffectiveShift[],
  dayOfWeek: number
): EffectiveShift[] {
  if (shiftsForDay.length <= 1) return shiftsForDay;

  const byEmployee = new Map<string, EffectiveShift[]>();
  for (const s of shiftsForDay) {
    if (!byEmployee.has(s.employee_id)) byEmployee.set(s.employee_id, []);
    byEmployee.get(s.employee_id)!.push(s);
  }

  const out: EffectiveShift[] = [];

  for (const [eid, list] of byEmployee) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }

    const overnight: EffectiveShift[] = [];
    const intervals: { start: number; end: number }[] = [];

    for (const s of list) {
      const sm = timeStrToMinutes(s.start_time_utc);
      const em = timeStrToMinutes(s.end_time_utc);
      if (em <= sm) {
        overnight.push(s);
      }
    }

    for (const s of list) {
      const sm = timeStrToMinutes(s.start_time_utc);
      const em = timeStrToMinutes(s.end_time_utc);
      if (em <= sm) {
        continue;
      }
      const subsumed = overnight.some((ov) => {
        const osm = timeStrToMinutes(ov.start_time_utc);
        const oem = timeStrToMinutes(ov.end_time_utc);
        return sameDayIntervalSubsumedByOvernight(sm, em, osm, oem);
      });
      if (subsumed) {
        continue;
      }
      intervals.push({ start: sm, end: em });
    }

    intervals.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (!last || iv.start > last.end) {
        merged.push({ ...iv });
      } else {
        last.end = Math.max(last.end, iv.end);
      }
    }

    for (const m of merged) {
      out.push({
        employee_id: eid,
        start_time_utc: minutesToTimeStr(m.start),
        end_time_utc: minutesToTimeStr(m.end),
        days_of_week: [dayOfWeek],
      });
    }
    for (const s of overnight) {
      out.push(s);
    }
  }

  return out;
}
