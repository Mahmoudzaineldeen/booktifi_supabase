import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { getApiUrl } from '../../lib/apiUrl';
import { formatTimeTo12Hour } from '../../lib/timeFormat';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Users, Search, X, Clock, Briefcase } from 'lucide-react';

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
  employee_shifts: EmployeeShiftRow[];
  employee_services: ServiceRow[];
}

type SearchType = 'employee_name' | 'service_name' | '';

const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function formatShiftDays(shift: EmployeeShiftRow, isAr: boolean): string {
  const dayNames = isAr ? DAY_NAMES_AR : DAY_NAMES_EN;
  return (shift.days_of_week || [])
    .filter(d => d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .map(d => dayNames[d])
    .join(', ');
}

function formatShiftTime(shift: EmployeeShiftRow, _isAr?: boolean): string {
  return `${formatTimeTo12Hour(shift.start_time_utc)} – ${formatTimeTo12Hour(shift.end_time_utc)}`;
}

export function EmployeeShiftsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const { userProfile } = useAuth();
  const { features, loading: featuresLoading } = useTenantFeatures(userProfile?.tenant_id);
  const [employees, setEmployees] = useState<EmployeeWithShiftsAndServices[]>([]);
  const [loading, setLoading] = useState(true);

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
        const url = `${getApiUrl()}/employees/shifts-page-data?tenant_id=${encodeURIComponent(tenantId)}`;
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
        const rows: EmployeeWithShiftsAndServices[] = users.map((row: any) => ({
          id: row.id,
          full_name: row.full_name || '',
          full_name_ar: row.full_name_ar || '',
          role: row.role || '',
          employee_shifts: shiftByEmployee.get(row.id) || [],
          employee_services: (servicesByEmployee.get(row.id) || []).map((es) => ({ service_id: es.service_id, services: es.services })),
        }));
        setEmployees(rows);
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
  }, [userProfile?.tenant_id, isEmployeeBased]);

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
    return employees;
  }, [employees, searchQuery, searchType, i18n.language]);

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
            <Clock className="w-8 h-8 text-blue-600" />
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

      {/* Search Bar - same style as Bookings / Packages */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="w-full sm:w-64">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('reception.searchType') || 'Search By'}
            </label>
            <select
              value={searchType}
              onChange={(e) => {
                setSearchType(e.target.value as SearchType);
                setSearchQuery('');
                setShowSearchResults(false);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="">{t('reception.selectSearchType') || 'Select search type...'}</option>
              <option value="employee_name">{t('employeeShifts.searchByEmployee', 'Employee Name')}</option>
              <option value="service_name">{t('employeeShifts.searchByService', 'Service Name')}</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('reception.searchValue') || 'Search Value'}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
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
                    : (t('reception.selectSearchTypeFirst') || 'Select search type first...')
                }
                className={`pl-10 pr-10 ${!searchType ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!searchType}
              />
              {(searchQuery || showSearchResults) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setShowSearchResults(false);
                  }}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  title={t('common.clear') || 'Clear'}
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

      {effectiveList.length === 0 ? (
        <Card>
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
        <div className="space-y-4">
          {effectiveList.map((emp) => {
            const displayName = i18n.language === 'ar' ? (emp.full_name_ar || emp.full_name) : emp.full_name;
            const services = (emp.employee_services || []).map(es => es.services).filter(Boolean);
            const serviceNames = services.map(s => (i18n.language === 'ar' ? (s?.name_ar || s?.name) : s?.name)).filter(Boolean);
            const shifts = (emp.employee_shifts || []).filter(s => s.is_active !== false);
            const isAr = i18n.language === 'ar';
            return (
              <Card key={emp.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4">
                  <div className="flex flex-col md:flex-row md:items-start gap-4">
                    <div className="md:w-48 shrink-0">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-gray-500" />
                        <span className="font-semibold text-gray-900">{displayName}</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 space-y-3">
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                          <Briefcase className="w-4 h-4" />
                          {t('employee.assignedServices')}
                        </h4>
                        {serviceNames.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {serviceNames.map((name, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center px-2.5 py-0.5 rounded-md text-sm bg-blue-50 text-blue-800"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">{t('employeeShifts.noServices', 'No services assigned')}</p>
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {t('employee.workingShifts')}
                        </h4>
                        {shifts.length > 0 ? (
                          <ul className="text-sm text-gray-700 space-y-2">
                            {shifts.map((shift) => (
                              <li key={shift.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span>{formatShiftDays(shift, isAr)}</span>
                                <span className="font-medium text-gray-900 whitespace-nowrap">
                                  {formatShiftTime(shift, isAr)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-gray-500">{t('employeeShifts.noShifts', 'No shifts defined')}</p>
                        )}
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
