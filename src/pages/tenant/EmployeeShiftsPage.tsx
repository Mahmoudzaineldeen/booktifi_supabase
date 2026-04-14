import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ar as arDateLocale } from 'date-fns/locale';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { getApiUrl } from '../../lib/apiUrl';
import { formatTimeTo12Hour } from '../../lib/timeFormat';
import { safeTranslateNested } from '../../lib/safeTranslation';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { searchBarWrapperClass, searchSelectClass } from '../../components/ui/SearchInput';
import {
  Users,
  Search,
  X,
  Clock,
  Briefcase,
  MapPin,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Timer,
  CalendarCheck2,
} from 'lucide-react';

interface EmployeeShiftRow {
  id: string;
  employee_id: string;
  days_of_week: number[];
  start_time_utc: string;
  end_time_utc: string;
  is_active: boolean;
}

interface ServiceRow {
  service_id: string;
  services: { name: string; name_ar?: string };
}

interface EmployeeWithShiftsAndServices {
  id: string;
  full_name: string;
  full_name_ar: string;
  role: string;
  branch_id: string | null;
  employee_shifts: EmployeeShiftRow[];
  employee_services: ServiceRow[];
}

type SearchType = 'employee_name' | 'service_name' | 'branch_name' | '';

const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function formatDayHeaderParts(dateStr: string, lang: string): { weekday: string; dateLine: string } {
  try {
    const d = parseISO(dateStr);
    const locale = lang === 'ar' ? arDateLocale : undefined;
    return {
      weekday: format(d, 'EEE', { locale }),
      dateLine: format(d, 'd MMM yyyy', { locale }),
    };
  } catch {
    return { weekday: '', dateLine: dateStr };
  }
}

/** Calendar Sunday (local) as YYYY-MM-DD */
function formatSundayYMD(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function addDaysYMD(iso: string, n: number): string {
  const [y, m, dd] = iso.split('-').map(Number);
  const d = new Date(y, m - 1, dd + n, 12, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface WeekDayAvailability {
  date: string;
  day_of_week: number;
  windows: { start: string; end: string }[];
}

interface WeekBookingRow {
  booking_id: string;
  status: string;
  customer_name: string | null;
  service_name: string;
  service_name_ar: string | null;
  start_time: string;
  end_time: string;
}

export function EmployeeShiftsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const { userProfile } = useAuth();
  const { features, loading: featuresLoading } = useTenantFeatures(userProfile?.tenant_id);
  const [employees, setEmployees] = useState<EmployeeWithShiftsAndServices[]>([]);
  const [branchesById, setBranchesById] = useState<Map<string, { name: string; name_ar?: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => formatSundayYMD(new Date()));
  const [weekRange, setWeekRange] = useState<{ start: string; end: string } | null>(null);
  const [weeklyAvailability, setWeeklyAvailability] = useState<Record<string, WeekDayAvailability[]>>({});
  const [weeklyBookings, setWeeklyBookings] = useState<Record<string, Record<string, WeekBookingRow[]>>>({});

  // Mode-dependent: only visible in Employee-Based Mode; redirect when Service-Based
  const schedulingMode = features?.scheduling_mode ?? 'service_slot_based';
  const isEmployeeBased = schedulingMode === 'employee_based';

  useEffect(() => {
    if (featuresLoading || !tenantSlug) return;
    if (features && features.scheduling_mode !== 'employee_based') {
      navigate(`/${tenantSlug}/admin/bookings`, { replace: true });
    }
  }, [features, featuresLoading, tenantSlug, navigate]);

  // Search state (same pattern as Bookings / Packages)
  const [searchType, setSearchType] = useState<SearchType>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  useEffect(() => {
    if (!userProfile?.tenant_id || !isEmployeeBased) return;
    const tenantId = userProfile.tenant_id;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Single endpoint: one round-trip instead of three (faster load)
        const token = localStorage.getItem('auth_token');
        const url = `${getApiUrl()}/employees/shifts-page-data?tenant_id=${encodeURIComponent(tenantId)}&week_start=${encodeURIComponent(weekStart)}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token && token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
          },
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(json?.error?.message || json?.error || res.statusText);
        }
        const users = json.users ?? [];
        const shifts = (json.employee_shifts ?? []) as EmployeeShiftRow[];
        const empServices = json.employee_services ?? [];
        const branches = (json.branches ?? []) as Array<{ id: string; name?: string; name_ar?: string }>;
        const shiftByEmployee = new Map<string, EmployeeShiftRow[]>();
        for (const s of shifts) {
          const list = shiftByEmployee.get(s.employee_id) || [];
          list.push(s);
          shiftByEmployee.set(s.employee_id, list);
        }
        const servicesByEmployee = new Map<string, Array<{ service_id: string; services: { name?: string; name_ar?: string } }>>();
        for (const es of empServices as any[]) {
          const list = servicesByEmployee.get(es.employee_id) || [];
          list.push({ service_id: es.service_id, services: es.services || { name: '', name_ar: '' } });
          servicesByEmployee.set(es.employee_id, list);
        }
        const branchById = new Map<string, { name: string; name_ar?: string }>();
        branches.forEach((b: any) => { branchById.set(b.id, { name: b.name || '', name_ar: b.name_ar }); });
        const rows: EmployeeWithShiftsAndServices[] = users.map((row: any) => ({
          id: row.id,
          full_name: row.full_name || '',
          full_name_ar: row.full_name_ar || '',
          role: row.role || '',
          branch_id: row.branch_id ?? null,
          employee_shifts: shiftByEmployee.get(row.id) || [],
          employee_services: (servicesByEmployee.get(row.id) || []).map((es) => ({ service_id: es.service_id, services: es.services })),
        }));
        setEmployees(rows);
        setBranchesById(branchById);
        const wk = json.week as { start?: string; end?: string } | undefined;
        setWeekRange(wk?.start && wk?.end ? { start: wk.start, end: wk.end } : null);
        setWeeklyAvailability((json.weekly_availability as Record<string, WeekDayAvailability[]>) || {});
        setWeeklyBookings((json.weekly_bookings as Record<string, Record<string, WeekBookingRow[]>>) || {});
      } catch (e) {
        if (!cancelled) {
          console.error('Error fetching employees for shifts:', e);
          setEmployees([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userProfile?.tenant_id, isEmployeeBased, weekStart]);

  // Live filter: by employee name or service name (no reload)
  const displayEmployees = useMemo(() => {
    if (!searchQuery.trim() || !searchType) return employees;
    const q = searchQuery.toLowerCase().trim();
    const isAr = i18n.language === 'ar';
    if (searchType === 'employee_name') {
      return employees.filter(emp => {
        const name = (isAr ? (emp.full_name_ar || emp.full_name) : emp.full_name).toLowerCase();
        const nameAr = (emp.full_name_ar || '').toLowerCase();
        return name.includes(q) || nameAr.includes(q);
      });
    }
    if (searchType === 'service_name') {
      return employees.filter(emp =>
        (emp.employee_services || []).some(es => {
          const name = (isAr ? es.services?.name_ar : es.services?.name) || es.services?.name || '';
          return name.toLowerCase().includes(q);
        })
      );
    }
    if (searchType === 'branch_name') {
      return employees.filter(emp => {
        if (!emp.branch_id) return false;
        const branch = branchesById.get(emp.branch_id);
        if (!branch) return false;
        const name = (isAr ? (branch.name_ar || branch.name) : branch.name).toLowerCase();
        const nameAr = (branch.name_ar || '').toLowerCase();
        return name.includes(q) || nameAr.includes(q);
      });
    }
    return employees;
  }, [employees, searchQuery, searchType, i18n.language, branchesById]);

  const hasActiveSearch = Boolean(searchQuery.trim() && searchType);
  const effectiveList = hasActiveSearch ? displayEmployees : employees;

  if (featuresLoading) {
    return (
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">{t('common.loading') || 'Loading...'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (features && features.scheduling_mode !== 'employee_based') {
    return null;
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">{t('common.loading') || 'Loading...'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2.5 rounded-xl">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                {t('employeeShifts.title', 'Employee Shifts & Assignments')}
              </h1>
              <p className="text-sm md:text-base text-gray-600 mt-1">
                {t('employeeShifts.subtitle', 'View working shifts and assigned services per employee')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar - same style as Bookings / Reception */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-64">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('reception.searchType') || 'Search By'}
            </label>
            <select
              value={searchType}
              onChange={(e) => {
                setSearchType(e.target.value as SearchType);
                setSearchQuery('');
                setShowSearchResults(false);
              }}
              className={searchSelectClass}
            >
              <option value="">{t('reception.selectSearchType') || 'Select search type...'}</option>
              <option value="employee_name">{t('employeeShifts.searchByEmployee', 'Employee Name')}</option>
              <option value="service_name">{t('employeeShifts.searchByService', 'Service Name')}</option>
              <option value="branch_name">{t('employeeShifts.searchByBranch', 'Branch')}</option>
            </select>
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('reception.searchValue') || 'Search Value'}
            </label>
            <div className={`${searchBarWrapperClass} ${!searchType ? 'opacity-60' : ''}`}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchQuery(v);
                  setShowSearchResults(Boolean(v.trim() && searchType));
                }}
                placeholder={
                  searchType === 'employee_name'
                    ? (t('employeeShifts.placeholderEmployee', 'Enter employee name...'))
                    : searchType === 'service_name'
                    ? (t('employeeShifts.placeholderService', 'Enter service name...'))
                    : searchType === 'branch_name'
                    ? (t('employeeShifts.placeholderBranch', 'Enter branch name...'))
                    : (t('reception.selectSearchTypeFirst') || 'Select search type first...')
                }
                className="w-full bg-transparent border-0 pl-11 pr-10 py-2.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
                disabled={!searchType}
              />
              {(searchQuery || showSearchResults) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setShowSearchResults(false);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 rounded-full p-0.5"
                  title={t('common.clear') || 'Clear'}
                  aria-label="Clear search"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
        {hasActiveSearch && (
          <div className="flex items-center justify-between text-sm">
            <p className="text-gray-600">
              <span className="font-medium">{t('reception.searchingBy') || 'Searching by'}: </span>
              <span>
                {searchType === 'employee_name' && (t('employeeShifts.searchByEmployee', 'Employee Name'))}
                {searchType === 'service_name' && (t('employeeShifts.searchByService', 'Service Name'))}
                {searchType === 'branch_name' && (t('employeeShifts.searchByBranch', 'Branch'))}
              </span>
            </p>
            <p className="text-gray-600">
              {effectiveList.length > 0
                ? `${effectiveList.length} ${t('reception.searchResults') || 'results found'}`
                : t('reception.noSearchResults') || 'No results found'}
            </p>
          </div>
        )}
      </div>

      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 px-4 py-4 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0 border border-slate-200/80 bg-white shadow-sm hover:bg-slate-50"
          onClick={() => setWeekStart((w) => addDaysYMD(w, -7))}
          icon={<ChevronLeft className="w-4 h-4" aria-hidden />}
        >
          {t('employeeShifts.weekPrev')}
        </Button>
        <div className="flex flex-1 flex-col items-center gap-1 text-center order-first sm:order-none min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-slate-600 ring-1 ring-slate-200/80 shadow-sm">
            <CalendarDays className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('employeeShifts.weekScheduleTitle')}
            </span>
          </div>
          <p className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
            {weekRange
              ? t('employeeShifts.weekLabel', { start: weekRange.start, end: weekRange.end })
              : weekStart}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-medium text-blue-700 hover:bg-blue-50"
            onClick={() => setWeekStart(formatSundayYMD(new Date()))}
          >
            {t('employeeShifts.weekThis')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="border border-slate-200/80 bg-white shadow-sm hover:bg-slate-50"
            onClick={() => setWeekStart((w) => addDaysYMD(w, 7))}
          >
            <span className="inline-flex items-center gap-1.5">
              {t('employeeShifts.weekNext')}
              <ChevronRight className="w-4 h-4 shrink-0" aria-hidden />
            </span>
          </Button>
        </div>
      </div>

      {effectiveList.length === 0 ? (
        <Card className="shadow-sm border border-gray-200/80">
          <CardContent className="py-12 text-center">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {hasActiveSearch
                ? (t('reception.noSearchResults') || 'No results found')
                : t('employeeShifts.noEmployees', 'No employees to display')}
            </h3>
            <p className="text-gray-600">
              {hasActiveSearch
                ? t('employeeShifts.tryDifferentSearch', 'Try a different search term.')
                : t('employeeShifts.configureInEmployees', 'Add employees and assign shifts in Settings → Employees.')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {effectiveList.map((emp) => {
            const displayName = i18n.language === 'ar' ? (emp.full_name_ar || emp.full_name) : emp.full_name;
            const services = (emp.employee_services || []).map(es => es.services).filter(Boolean);
            const serviceNames = services.map(s => (i18n.language === 'ar' ? (s?.name_ar || s?.name) : s?.name)).filter(Boolean);
            const isAr = i18n.language === 'ar';
            const lang = i18n.language;
            const weekDays = weeklyAvailability[emp.id] || [];
            const bookingsForEmp = weeklyBookings[emp.id] || {};
            return (
              <Card
                key={emp.id}
                className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_-8px_rgba(15,23,42,0.12)] transition-shadow hover:shadow-[0_12px_40px_-10px_rgba(15,23,42,0.14)]"
              >
                <CardContent className="p-0">
                  <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-sky-50/40 px-5 py-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
                        <Users className="h-5 w-5 text-slate-600" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-semibold text-slate-900">{displayName}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-slate-100/90 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200/60">
                            {safeTranslateNested(t, 'employee.roles', emp.role, emp.role)}
                          </span>
                          {emp.branch_id && (() => {
                            const branch = branchesById.get(emp.branch_id);
                            const branchName = branch ? (isAr ? (branch.name_ar || branch.name) : branch.name) : null;
                            return branchName ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200/80 shadow-sm"
                                title={t('employeeShifts.branch', 'Branch')}
                              >
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                                {branchName}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-slate-100 px-5 py-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                        <Briefcase className="h-4 w-4" aria-hidden />
                      </span>
                      {t('employee.assignedServices')}
                    </h4>
                    {serviceNames.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {serviceNames.map((name, idx) => (
                          <span
                            key={idx}
                            className="inline-flex max-w-full items-center rounded-full border border-sky-200/80 bg-gradient-to-br from-sky-50 to-white px-3.5 py-1.5 text-sm font-medium text-sky-950 shadow-sm"
                          >
                            <span className="truncate">{name}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">{t('employeeShifts.noServices', 'No services assigned')}</p>
                    )}
                  </div>

                  <div className="px-4 pb-5 pt-5 sm:px-5">
                    <h4 className="mb-4 flex items-center gap-2 border-l-4 border-blue-500 pl-3 text-base font-semibold text-slate-900">
                      <Clock className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
                      {t('employeeShifts.dailyBreakdown')}
                    </h4>
                    <div className="-mx-1 overflow-x-auto pb-2 [scrollbar-width:thin]">
                      <div className="flex min-w-0 snap-x snap-mandatory gap-3 lg:grid lg:snap-none lg:grid-cols-7 lg:gap-3">
                        {weekDays.map((day) => {
                          const dayBookings = bookingsForEmp[day.date] || [];
                          const headerParts = formatDayHeaderParts(day.date, lang);
                          return (
                            <article
                              key={day.date}
                              className="flex w-[min(100%,calc(100vw-3rem))] shrink-0 snap-start flex-col rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04] transition hover:ring-slate-900/[0.08] sm:min-w-[11.5rem] lg:min-w-0"
                            >
                              <header className="rounded-t-2xl bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 px-3.5 py-3 text-white">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">
                                  {headerParts.weekday || (isAr ? DAY_NAMES_AR[day.day_of_week] : DAY_NAMES_EN[day.day_of_week])}
                                </p>
                                <p className="mt-0.5 text-sm font-semibold leading-tight text-white">{headerParts.dateLine}</p>
                              </header>
                              <div className="flex flex-1 flex-col gap-3 p-3">
                                <section className="rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-3">
                                  <div className="mb-2 flex items-center gap-1.5 text-emerald-900">
                                    <Timer className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-900/90">
                                      {t('employeeShifts.availableShifts')}
                                    </span>
                                  </div>
                                  {day.windows.length === 0 ? (
                                    <p className="text-xs leading-relaxed text-emerald-800/70">{t('employeeShifts.noAvailabilityDay')}</p>
                                  ) : (
                                    <ul className="space-y-1.5">
                                      {day.windows.map((w, wi) => (
                                        <li key={wi}>
                                          <span className="inline-flex w-full items-center justify-center rounded-lg bg-white/90 px-2 py-1.5 text-center text-xs font-semibold text-emerald-950 shadow-sm ring-1 ring-emerald-100/80">
                                            {formatTimeTo12Hour(w.start)} – {formatTimeTo12Hour(w.end)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </section>
                                <section className="rounded-xl border border-violet-200/70 bg-violet-50/50 p-3">
                                  <div className="mb-2 flex items-center gap-1.5 text-violet-900">
                                    <CalendarCheck2 className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-violet-900/90">
                                      {t('employeeShifts.bookedSlots')}
                                    </span>
                                  </div>
                                  {dayBookings.length === 0 ? (
                                    <p className="text-xs italic text-violet-700/70">{t('employeeShifts.noBookingsDay')}</p>
                                  ) : (
                                    <ul className="space-y-2">
                                      {dayBookings.map((b) => (
                                        <li
                                          key={b.booking_id}
                                          className="rounded-xl border border-violet-100 bg-white p-2.5 shadow-sm ring-1 ring-violet-900/[0.04]"
                                        >
                                          <p className="text-xs font-bold tabular-nums text-violet-950">
                                            {formatTimeTo12Hour(b.start_time)} – {formatTimeTo12Hour(b.end_time)}
                                          </p>
                                          <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-slate-800" title={b.service_name}>
                                            {isAr ? (b.service_name_ar || b.service_name) : b.service_name}
                                          </p>
                                          {b.customer_name ? (
                                            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500" title={b.customer_name ?? undefined}>
                                              {b.customer_name}
                                            </p>
                                          ) : null}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </section>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
