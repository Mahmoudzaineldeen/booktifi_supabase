import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { safeTranslateNested } from '../../lib/safeTranslation';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { countryCodes } from '../../lib/countryCodes';
import { Plus, Edit, Users, Mail, Phone, Briefcase, UserX, UserCheck, Search, Trash2, Clock } from 'lucide-react';
import { getApiUrl } from '../../lib/apiUrl';
import { formatTimeTo12Hour } from '../../lib/timeFormat';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';

interface Branch {
  id: string;
  name: string;
  location: string | null;
}

interface Employee {
  id: string;
  username: string;
  full_name: string;
  full_name_ar: string;
  email: string | null;
  phone: string | null;
  role: string;
  branch_id: string | null;
  is_active: boolean;
  is_paused_until?: string | null;
  employee_services?: Array<{
    service_id: string;
    shift_id: string | null;
    services: {
      name: string;
      name_ar: string;
    };
  }>;
}

interface Service {
  id: string;
  name: string;
  name_ar: string;
  capacity_mode: 'employee_based' | 'service_based';
  scheduling_type?: 'slot_based' | 'employee_based';
  assignment_mode?: 'auto_assign' | 'manual_assign' | null;
  service_duration_minutes: number;
  service_capacity_per_slot: number | null;
}

interface Shift {
  id: string;
  service_id: string;
  days_of_week: number[];
  start_time_utc: string;
  end_time_utc: string;
  is_active: boolean;
}

interface ServiceShiftAssignment {
  serviceId: string;
  shiftIds: string[];
}

interface EmployeeShift {
  id: string;
  employee_id: string;
  days_of_week: number[];
  start_time_utc: string;
  end_time_utc: string;
  is_active: boolean;
}

/** Normalize one shift for insert so server always receives valid days_of_week (array) and HH:MM:SS times. */
function normalizeEmployeeShiftForInsert(
  sh: { days_of_week?: number[] | string | null; start_time_utc?: string | null; end_time_utc?: string | null; is_active?: boolean },
  tenantId: string,
  employeeId: string
): { tenant_id: string; employee_id: string; days_of_week: number[]; start_time_utc: string; end_time_utc: string; is_active: boolean } | null {
  let days: number[] = [];
  if (Array.isArray(sh.days_of_week)) {
    days = sh.days_of_week.map((d) => Number(d)).filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6);
  } else if (typeof sh.days_of_week === 'string') {
    const raw = sh.days_of_week.replace(/^\{|\}$/g, '').trim();
    if (raw) days = raw.split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6);
  }
  if (days.length === 0) return null;

  const toTime = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    let s = String(v).trim();
    const tMatch = s.match(/T(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z)?/i);
    if (tMatch) {
      const [, h, m, sec] = tMatch;
      return `${String(Number(h)).padStart(2, '0')}:${String(Number(m)).padStart(2, '0')}:${String(sec !== undefined ? Number(sec) : 0).padStart(2, '0')}`;
    }
    s = s.slice(0, 12).replace(/\.[0-9]+$/, '');
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.length === 5 ? `${s}:00` : s;
    return null;
  };
  const start = toTime(sh.start_time_utc);
  const end = toTime(sh.end_time_utc);
  if (!start || !end) return null;
  const [sh_, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ((eh || 0) * 60 + (em || 0) <= (sh_ || 0) * 60 + (sm || 0)) return null;
  return {
    tenant_id: tenantId,
    employee_id: employeeId,
    days_of_week: days,
    start_time_utc: start,
    end_time_utc: end,
    is_active: sh.is_active !== false,
  };
}

export function EmployeesPage() {
  const { t, i18n } = useTranslation();
  const { userProfile } = useAuth();
  const { features: tenantFeatures } = useTenantFeatures(userProfile?.tenant_id);
  const globalSchedulingMode = tenantFeatures?.scheduling_mode ?? 'service_slot_based';
  const hideServiceShiftSelection = globalSchedulingMode === 'employee_based';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    full_name: '',
    full_name_ar: '',
    email: '',
    phone: '',
    role: 'employee' as 'employee' | 'receptionist' | 'coordinator' | 'cashier' | 'customer_admin' | 'admin_user',
    branch_id: '',
    assigned_services: [] as string[],
    service_shift_assignments: [] as ServiceShiftAssignment[],
  });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [phoneFull, setPhoneFull] = useState<string>(''); // Full phone number with country code
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<'all' | 'employee' | 'cashier' | 'receptionist' | 'coordinator' | 'customer_admin' | 'admin_user'>('all');
  const [isPausedUntil, setIsPausedUntil] = useState<string>('');
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([]);
  const [employeeShiftForm, setEmployeeShiftForm] = useState({
    days_of_week: [] as number[],
    start_time: '09:00',
    end_time: '18:00',
    is_active: true,
  });

  function getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('auth_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function fetchBranches() {
    try {
      setLoadingBranches(true);
      const res = await fetch(`${getApiUrl()}/branches`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branches');
      setBranches(data.data || []);
    } catch (e: any) {
      setBranches([]);
      showNotification('error', e.message || 'Failed to load branches');
    } finally {
      setLoadingBranches(false);
    }
  }

  useEffect(() => {
    fetchServices();
    fetchEmployees();
    fetchBranches();
  }, [userProfile]);

  async function fetchServices() {
    if (!userProfile?.tenant_id) return;
    const { data } = await db
      .from('services')
      .select('id, name, name_ar, capacity_mode, scheduling_type, assignment_mode, service_duration_minutes, service_capacity_per_slot')
      .eq('tenant_id', userProfile.tenant_id)
      .eq('is_active', true)
      .order('name');
    setServices(data || []);
  }

  async function fetchShiftsForServices(serviceIds: string[]) {
    if (serviceIds.length === 0) {
      setShifts([]);
      return;
    }
    const { data } = await db
      .from('shifts')
      .select('*')
      .in('service_id', serviceIds)
      .eq('is_active', true)
      .order('start_time_utc');
    setShifts(data || []);
  }

  async function fetchEmployees() {
    if (!userProfile?.tenant_id) return;

    try {
      const { data, error } = await db
        .from('users')
        .select(`
          id,
          username,
          full_name,
          full_name_ar,
          email,
          phone,
          role,
          branch_id,
          is_active,
          is_paused_until,
          employee_services(
            service_id,
            shift_id,
            services(name, name_ar)
          )
        `)
        .eq('tenant_id', userProfile.tenant_id)
        .in('role', ['employee', 'receptionist', 'coordinator', 'cashier', 'customer_admin', 'admin_user'])
        .order('full_name');

      if (error) throw error;
      setEmployees(data || []);
    } catch (err) {
      console.error('Error fetching employees:', err);
    } finally {
      setLoading(false);
    }
  }

  const operationalRoles = ['employee', 'receptionist', 'coordinator', 'cashier'];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!userProfile?.tenant_id) return;

    if (operationalRoles.includes(formData.role) && !formData.branch_id?.trim()) {
      showNotification('warning', t('employee.selectBranchRequired'));
      return;
    }

    try {
      if (editingEmployee) {
        const { data: { session } } = await db.auth.getSession();
        if (!session) {
          showNotification('warning', t('employee.sessionExpired'));
          return;
        }

        // Use backend API endpoint
        const apiUrl = `${getApiUrl()}/employees/update`;

        const updatePayload: any = {
          employee_id: editingEmployee.id,
          full_name: formData.full_name,
          full_name_ar: formData.full_name_ar,
          phone: phoneFull || null,
          role: formData.role,
          is_paused_until: isPausedUntil ? isPausedUntil : null,
        };
        if (operationalRoles.includes(formData.role)) {
          updatePayload.branch_id = formData.branch_id || null;
        } else {
          updatePayload.branch_id = null;
        }

        if (formData.username && formData.username !== editingEmployee.username) {
          updatePayload.username = formData.username;
        }

        if (formData.password) {
          updatePayload.password = formData.password;
        }

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updatePayload),
        });

        // Check if response is JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          console.error('Non-JSON response:', text.substring(0, 200));
          showNotification('error', t('employee.errorUpdatingEmployeeServer', { status: response.status, statusText: response.statusText }));
          return;
        }

        const result = await response.json();

        if (!response.ok) {
          console.error('Update error:', result.error);
          showNotification('error', t('employee.errorUpdatingEmployee', { error: result.error || t('common.error') }));
          return;
        }

        // Only employees need service assignments (not receptionist, cashier, customer_admin, or admin_user)
        if (formData.role === 'employee') {
          await db
            .from('employee_services')
            .delete()
            .eq('employee_id', editingEmployee.id);

          if (formData.service_shift_assignments.length > 0) {
            const assignments: any[] = [];
            formData.service_shift_assignments.forEach(serviceAssignment => {
              const shiftIds = serviceAssignment.shiftIds || [];
              if (shiftIds.length > 0) {
                shiftIds.forEach(shift_id => {
                  assignments.push({
                    employee_id: editingEmployee.id,
                    service_id: serviceAssignment.serviceId,
                    shift_id,
                    tenant_id: userProfile.tenant_id,
                    duration_minutes: null,
                    capacity_per_slot: null,
                  });
                });
              } else {
                // Employee-based: availability from employee work schedule (employee_shifts)
                assignments.push({
                  employee_id: editingEmployee.id,
                  service_id: serviceAssignment.serviceId,
                  shift_id: null,
                  tenant_id: userProfile.tenant_id,
                  duration_minutes: null,
                  capacity_per_slot: null,
                });
              }
            });
            if (assignments.length > 0) {
              const { error: insertError } = await db.from('employee_services').insert(assignments);
              if (insertError) {
                console.error('Error inserting employee_services:', insertError);
                showNotification('error', t('employee.errorSavingServiceAssignments', { message: insertError.message }));
                return;
              }
            }
          }
        }

        // Save employee work schedule (employee_shifts) – shift-based only
        if (formData.role === 'employee' && editingEmployee?.id && userProfile?.tenant_id) {
          const { data: currentShifts } = await db.from('employee_shifts').select('id').eq('employee_id', editingEmployee.id);
          const currentIds = (currentShifts || []).map((s: { id: string }) => s.id);
          for (const id of currentIds) {
            await db.from('employee_shifts').delete().eq('id', id);
          }
          for (const sh of employeeShifts) {
            const payload = normalizeEmployeeShiftForInsert(sh, userProfile.tenant_id, editingEmployee.id);
            if (!payload) {
              showNotification('warning', t('employee.invalidShiftData', 'Each shift must have at least one day and end time after start time.'));
              return;
            }
            const { error } = await db.from('employee_shifts').insert(payload);
            if (error) {
              console.error('Error saving employee shift:', error);
              showNotification('error', t('employee.errorSavingShift', { message: error.message || t('common.failedToSaveShift') }));
              return;
            }
          }
        }

        if (formData.password) {
          showNotification('success', t('employee.employeeUpdatedWithCredentials', { username: formData.username, password: formData.password }));
        } else {
          showNotification('success', t('employee.employeeUpdatedSuccessfully'));
        }
      } else {
        const { data: { session } } = await db.auth.getSession();
        if (!session) {
          showNotification('warning', t('employee.sessionExpired'));
          return;
        }

        // Use backend API endpoint
        const apiUrl = `${getApiUrl()}/employees/create`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: formData.username,
            password: formData.password,
            full_name: formData.full_name,
            full_name_ar: formData.full_name_ar,
            email: formData.email || null,
            phone: phoneFull || null,
            role: formData.role,
            tenant_id: userProfile.tenant_id,
            branch_id: operationalRoles.includes(formData.role) ? (formData.branch_id || null) : null,
            service_shift_assignments: formData.service_shift_assignments,
            employee_shifts: formData.role === 'employee' && employeeShifts.length > 0
              ? employeeShifts.map(sh => ({
                  days_of_week: sh.days_of_week,
                  start_time_utc: sh.start_time_utc,
                  end_time_utc: sh.end_time_utc,
                  is_active: sh.is_active ?? true,
                }))
              : undefined,
          }),
        });

        // Check if response is JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          console.error('Non-JSON response:', text);
          showNotification('error', t('employee.errorCreatingEmployeeServer', { status: response.status, statusText: response.statusText }));
          return;
        }

        const result = await response.json();

        if (!response.ok) {
          console.error('Creation error:', result.error);
          showNotification('error', t('employee.errorCreatingEmployee', { error: result.error || t('common.error') }));
          return;
        }

        showNotification('success', t('employee.employeeCreatedSuccessfully', { username: formData.username, password: formData.password }));
      }

      setIsModalOpen(false);
      setEditingEmployee(null);
      resetForm();
      await fetchEmployees();
    } catch (err: any) {
      console.error('Error saving employee:', err);
      showNotification('error', t('employee.errorOccurred', { message: err.message || t('common.error') }));
    }
  }

  async function openEditModal(employee: Employee) {
    setEditingEmployee(employee);
    const assignedServices = employee.employee_services?.map(es => es.service_id) || [];
    const uniqueServiceIds = [...new Set(assignedServices)];

    const serviceShiftMap: ServiceShiftAssignment[] = [];
    for (const serviceId of uniqueServiceIds) {
      const serviceAssignments = employee.employee_services?.filter(es => es.service_id === serviceId) || [];
      const shiftIds = serviceAssignments
        .map(es => es.shift_id)
        .filter(id => id) as string[];
      serviceShiftMap.push({ serviceId, shiftIds });
    }

    // Load service shifts and employee shifts in parallel for faster modal open
    const [shiftsDataResult, employeeShiftsResult] = await Promise.all([
      assignedServices.length > 0
        ? db.from('shifts').select('*').in('service_id', assignedServices).eq('is_active', true).order('start_time_utc')
        : Promise.resolve({ data: [] }),
      db.from('employee_shifts').select('*').eq('employee_id', employee.id).order('created_at'),
    ]);
    setShifts(shiftsDataResult.data || []);
    setEmployeeShifts(employeeShiftsResult.data || []);
    setEmployeeShiftForm({ days_of_week: [], start_time: '09:00', end_time: '18:00', is_active: true });

    setFormData({
      username: employee.username,
      password: '',
      full_name: employee.full_name,
      full_name_ar: employee.full_name_ar || '',
      email: employee.email || '',
      phone: employee.phone || '',
      role: employee.role as 'employee' | 'receptionist' | 'coordinator' | 'cashier' | 'customer_admin' | 'admin_user',
      branch_id: employee.branch_id || '',
      assigned_services: uniqueServiceIds,
      service_shift_assignments: serviceShiftMap,
    });
    setPhoneFull(employee.phone || '');
    setIsPausedUntil(employee.is_paused_until ? employee.is_paused_until.split('T')[0] : '');

    setIsModalOpen(true);
  }

  function resetForm() {
    setFormData({
      username: '',
      password: '',
      full_name: '',
      full_name_ar: '',
      email: '',
      phone: '',
      role: 'employee',
      branch_id: '',
      assigned_services: [],
      service_shift_assignments: [],
    });
    setPhoneFull('');
    setShifts([]);
    setIsPausedUntil('');
    setEmployeeShifts([]);
    setEmployeeShiftForm({ days_of_week: [], start_time: '09:00', end_time: '18:00', is_active: true });
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingEmployee(null);
    resetForm();
  }

  async function toggleEmployeeStatus(employeeId: string, currentStatus: boolean) {
    if (!userProfile?.tenant_id) return;

    const confirmMessage = currentStatus
      ? t('employee.confirmDeactivate')
      : t('employee.confirmActivate');

    const ok = await showConfirm({
      title: t('common.confirm'),
      description: confirmMessage,
      destructive: currentStatus,
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;

    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) {
        showNotification('warning', t('common.sessionExpiredPleaseLogin'));
        return;
      }

      // Use backend API endpoint
      const { getApiUrl } = await import('../../lib/apiUrl');
      const apiUrl = `${getApiUrl()}/employees/update`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employee_id: employeeId,
          is_active: !currentStatus,
        }),
      });

      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        showNotification('error', t('employee.errorServerResponse', { status: response.status, statusText: response.statusText }));
        return;
      }

      const result = await response.json();

      if (!response.ok) {
        console.error('Status update error:', result.error);
        showNotification('error', t('employee.errorUnknown', { error: result.error || t('common.error') }));
        return;
      }

      await fetchEmployees();
      showNotification('success', currentStatus ? t('employee.employeeDeactivatedSuccessfully') : t('employee.employeeActivatedSuccessfully'));
    } catch (err: any) {
      console.error('Error toggling employee status:', err);
      showNotification('error', t('employee.errorOccurred', { message: err.message || t('common.error') }));
    }
  }

  function toggleService(serviceId: string) {
    setFormData(prev => {
      const isRemoving = prev.assigned_services.includes(serviceId);
      const newAssignedServices = isRemoving
        ? prev.assigned_services.filter(id => id !== serviceId)
        : [...prev.assigned_services, serviceId];

      const service = services.find(s => s.id === serviceId);
      const isEmployeeBased = service?.scheduling_type === 'employee_based';

      const newServiceShiftAssignments = isRemoving
        ? prev.service_shift_assignments.filter(a => a.serviceId !== serviceId)
        : [...prev.service_shift_assignments, { serviceId, shiftIds: [] }];

      fetchShiftsForServices(newAssignedServices.filter(id => {
        const s = services.find(sv => sv.id === id);
        return s?.scheduling_type === 'slot_based';
      }));

      return {
        ...prev,
        assigned_services: newAssignedServices,
        service_shift_assignments: newServiceShiftAssignments
      };
    });
  }

  function toggleShiftForService(serviceId: string, shiftId: string) {
    setFormData(prev => {
      const newAssignments = prev.service_shift_assignments.map(assignment => {
        if (assignment.serviceId === serviceId) {
          const isRemoving = assignment.shiftIds.includes(shiftId);
          return {
            ...assignment,
            shiftIds: isRemoving
              ? assignment.shiftIds.filter(id => id !== shiftId)
              : [...assignment.shiftIds, shiftId]
          };
        }
        return assignment;
      });
      return { ...prev, service_shift_assignments: newAssignments };
    });
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNamesAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function toggleEmployeeShiftDay(day: number) {
    setEmployeeShiftForm(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day)
        ? prev.days_of_week.filter(d => d !== day)
        : [...prev.days_of_week, day].sort()
    }));
  }

  function addEmployeeShift(e: React.FormEvent) {
    e.preventDefault();
    if (employeeShiftForm.days_of_week.length === 0) {
      showNotification('warning', t('employee.selectAtLeastOneDay', 'Select at least one day'));
      return;
    }
    const start = employeeShiftForm.start_time.length === 5 ? `${employeeShiftForm.start_time}:00` : employeeShiftForm.start_time;
    const end = employeeShiftForm.end_time.length === 5 ? `${employeeShiftForm.end_time}:00` : employeeShiftForm.end_time;
    setEmployeeShifts(prev => [...prev, {
      id: `temp-${Date.now()}`,
      employee_id: editingEmployee?.id || '',
      days_of_week: employeeShiftForm.days_of_week,
      start_time_utc: start,
      end_time_utc: end,
      is_active: employeeShiftForm.is_active,
    }]);
    setEmployeeShiftForm({ days_of_week: [], start_time: '09:00', end_time: '18:00', is_active: true });
  }

  function removeEmployeeShift(id: string) {
    setEmployeeShifts(prev => prev.filter(s => s.id !== id));
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('employee.employees')}</h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">{t('employee.manageTeam')}</p>
        </div>
        <Button
          onClick={() => setIsModalOpen(true)}
          icon={<Plus className="w-4 h-4" />}
        >
          {t('employee.addEmployee')}
        </Button>
      </div>

      {/* Search and Filter Section */}
      {employees.length > 0 && (
        <div className="mb-6 space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              type="text"
              placeholder={t('employee.searchEmployees')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Role Filter Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            <Button
              variant={selectedRole === 'all' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedRole('all')}
            >
              {t('employee.all')} ({employees.length})
            </Button>
            <Button
              variant={selectedRole === 'employee' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedRole('employee')}
            >
              {t('employee.roles.employee')} ({employees.filter(e => e.role === 'employee').length})
            </Button>
            <Button
              variant={selectedRole === 'cashier' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedRole('cashier')}
            >
              {t('employee.roles.cashier')} ({employees.filter(e => e.role === 'cashier').length})
            </Button>
            <Button
              variant={selectedRole === 'receptionist' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedRole('receptionist')}
            >
              {t('employee.roles.receptionist')} ({employees.filter(e => e.role === 'receptionist').length})
            </Button>
            <Button
              variant={selectedRole === 'coordinator' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedRole('coordinator')}
            >
              {t('employee.roles.coordinator')} ({employees.filter(e => e.role === 'coordinator').length})
            </Button>
            <Button
              variant={selectedRole === 'customer_admin' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedRole('customer_admin')}
            >
              {t('employee.roles.customer_admin')} ({employees.filter(e => e.role === 'customer_admin').length})
            </Button>
            <Button
              variant={selectedRole === 'admin_user' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedRole('admin_user')}
            >
              {t('employee.roles.admin_user')} ({employees.filter(e => e.role === 'admin_user').length})
            </Button>
          </div>
        </div>
      )}

      {/* Filtered Employees */}
      {(() => {
        // Filter employees by role
        let filteredEmployees = employees;
        if (selectedRole !== 'all') {
          filteredEmployees = employees.filter(emp => emp.role === selectedRole);
        }

        // Filter employees by search query
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase().trim();
          filteredEmployees = filteredEmployees.filter(emp => {
            const fullName = (i18n.language === 'ar' ? (emp.full_name_ar || emp.full_name) : emp.full_name).toLowerCase();
            const fullNameAr = (emp.full_name_ar || '').toLowerCase();
            const username = (emp.username || '').toLowerCase();
            const email = (emp.email || '').toLowerCase();
            const phone = (emp.phone || '').toLowerCase();
            
            return fullName.includes(query) || 
                   fullNameAr.includes(query) || 
                   username.includes(query) || 
                   email.includes(query) || 
                   phone.includes(query);
          });
        }

        if (filteredEmployees.length === 0) {
          return (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {searchQuery || selectedRole !== 'all' 
                    ? t('employee.noResultsFound')
                    : t('employee.noEmployeesYet')}
                </h3>
                <p className="text-gray-600 mb-6">
                  {searchQuery || selectedRole !== 'all'
                    ? t('employee.tryDifferentSearch')
                    : t('employee.startBuildingTeam')}
                </p>
                {!searchQuery && selectedRole === 'all' && (
                  <Button onClick={() => setIsModalOpen(true)} icon={<Plus className="w-4 h-4" />}>
                    {t('employee.addEmployee')}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        }

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredEmployees.map((employee) => (
            <Card key={employee.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="truncate">
                    {i18n.language === 'ar' ? (employee.full_name_ar || employee.full_name) : employee.full_name}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    employee.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {employee.is_active ? t('employee.active') : t('employee.inactive')}
                  </span>
                  {employee.is_paused_until && (
                    <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800" title={employee.is_paused_until}>
                      {t('employee.pausedUntil')} {employee.is_paused_until.split('T')[0]}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 mb-4">
                  {employee.email && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Mail className="w-4 h-4" />
                      <span className="truncate">{employee.email}</span>
                    </div>
                  )}
                  {employee.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="w-4 h-4" />
                      <span>{employee.phone}</span>
                    </div>
                  )}
                  <div className="mt-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 capitalize">
                      {safeTranslateNested(t, 'employee.roles', employee.role, employee.role)}
                    </span>
                  </div>
                  {employee.role === 'employee' && employee.employee_services && employee.employee_services.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                        <Briefcase className="w-3 h-3" />
                        <span>{t('employee.assignedServices')}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {employee.employee_services.map((es, idx) => (
                          <span key={idx} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                            {i18n.language === 'ar' ? es.services.name_ar : es.services.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEditModal(employee)}
                    icon={<Edit className="w-4 h-4" />}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant={employee.is_active ? "secondary" : "primary"}
                    size="sm"
                    className="flex-1"
                    onClick={() => toggleEmployeeStatus(employee.id, employee.is_active)}
                    icon={employee.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                  >
                    {employee.is_active ? t('employee.deactivate') : t('employee.activate')}
                  </Button>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
        );
      })()}

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingEmployee ? t('employee.editEmployee') : t('employee.addEmployee')}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={!editingEmployee ? t('employee.usernameRequired') : t('employee.username')}
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            required={!editingEmployee}
            disabled={editingEmployee !== null}
            placeholder="username"
            className={editingEmployee ? 'bg-gray-100' : ''}
          />

          <Input
            type="password"
            label={!editingEmployee ? t('employee.passwordRequired') : t('employee.passwordLeaveBlank')}
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required={!editingEmployee}
            placeholder="••••••••"
          />

          <Input
            label={t('employee.fullNameEnglish')}
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            required
            placeholder={t('employee.fullNameEnglishPlaceholder')}
          />

          <Input
            label={t('employee.fullNameArabic')}
            value={formData.full_name_ar}
            onChange={(e) => setFormData({ ...formData, full_name_ar: e.target.value })}
            required
            dir="rtl"
            placeholder="الاسم الكامل بالعربية"
          />

          <Input
            type="email"
            label={t('employee.email')}
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            disabled={!!editingEmployee}
            placeholder={t('employee.emailPlaceholder')}
          />

          <PhoneInput
            label={t('employee.phone')}
            value={phoneFull}
            onChange={(value) => {
              setPhoneFull(value);
              // Extract phone number without country code for backward compatibility
              let phoneNumber = value;
              for (const country of countryCodes) {
                if (value.startsWith(country.code)) {
                  phoneNumber = value.replace(country.code, '');
                  break;
                }
              }
              setFormData({ ...formData, phone: phoneNumber });
            }}
            defaultCountry="+966"
            placeholder="+966 50 123 4567"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('employee.role')}
            </label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as 'employee' | 'receptionist' | 'coordinator' | 'cashier' | 'customer_admin' | 'admin_user' })}
              required
            >
              <option value="employee">{t('employee.roles.employee')}</option>
              <option value="receptionist">{t('employee.roles.receptionist')}</option>
              <option value="coordinator">{t('employee.roles.coordinator')}</option>
              <option value="cashier">{t('employee.roles.cashier')}</option>
              <option value="customer_admin">{t('employee.roles.customer_admin')}</option>
              <option value="admin_user">{t('employee.roles.admin_user')}</option>
            </select>
          </div>

          {(formData.role === 'employee' || formData.role === 'receptionist' || formData.role === 'coordinator' || formData.role === 'cashier') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('employee.assignToBranch')}
              </label>
              {loadingBranches ? (
                <p className="text-sm text-gray-500">{t('common.loading')}</p>
              ) : branches.length === 0 ? (
                <p className="text-sm text-gray-500">{t('employee.noBranchesYet')}</p>
              ) : (
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.branch_id}
                  onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                  required
                >
                  <option value="">{t('employee.selectBranch')}</option>
                  {(branches.filter((b) => (b as { is_active?: boolean }).is_active !== false)).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.location ? ` (${b.location})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {formData.role === 'employee' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('employee.pauseUntil', 'Pause until (absent)')}
              </label>
              <Input
                type="date"
                value={isPausedUntil}
                onChange={(e) => setIsPausedUntil(e.target.value)}
                placeholder={t('employee.pauseUntilPlaceholder', 'Leave empty if not absent')}
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('employee.pauseUntilHelp', 'Set a date if this employee is absent until then. Leave empty when available.')}
              </p>
            </div>
          )}

          {formData.role === 'employee' && services.length > 0 && (
            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('employee.assignServices')}
              </label>
              <div className="max-h-96 overflow-y-auto space-y-3 bg-gray-50 p-3 rounded-lg">
                {services.map((service) => {
                  const isServiceSelected = formData.assigned_services.includes(service.id);
                  const serviceShifts = shifts.filter(s => s.service_id === service.id);
                  const serviceAssignment = formData.service_shift_assignments.find(a => a.serviceId === service.id);

                  return (
                    <div key={service.id} className="bg-white p-3 rounded-lg border">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isServiceSelected}
                          onChange={() => toggleService(service.id)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium">
                          {i18n.language === 'ar' ? service.name_ar : service.name}
                        </span>
                      </label>

                      {isServiceSelected && (hideServiceShiftSelection || service.scheduling_type === 'employee_based') && (
                        <div className="mt-3 ml-6 bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <div className="text-xs text-blue-800">
                            {t('employee.availabilityFromWorkSchedule', 'Availability comes from your Work Schedule below. Service duration is set in Services.')}
                          </div>
                        </div>
                      )}

                      {isServiceSelected && !hideServiceShiftSelection && (service.scheduling_type === 'slot_based' || !service.scheduling_type) && serviceShifts.length > 0 && (
                        <div className="mt-3 ml-6 space-y-2 pl-3 border-l-2 border-gray-200">
                          <div className="text-xs font-medium text-gray-600 mb-2">
                            {t('employee.selectShifts')}
                          </div>
                          {serviceShifts.map((shift) => (
                            <label key={shift.id} className="flex items-start gap-2 cursor-pointer text-xs">
                              <input
                                type="checkbox"
                                checked={serviceAssignment?.shiftIds.includes(shift.id) || false}
                                onChange={() => toggleShiftForService(service.id, shift.id)}
                                className="w-3 h-3 mt-0.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <div className="flex-1">
                                <div className="font-medium text-gray-700">
                                  {formatTimeTo12Hour(shift.start_time_utc)} - {formatTimeTo12Hour(shift.end_time_utc)}
                                </div>
                                <div className="text-gray-500">
                                  {shift.days_of_week.sort().map(day =>
                                    i18n.language === 'ar' ? dayNamesAr[day] : dayNames[day]
                                  ).join(', ')}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}

                      {isServiceSelected && !hideServiceShiftSelection && (service.scheduling_type === 'slot_based' || !service.scheduling_type) && serviceShifts.length === 0 && (
                        <div className="mt-2 ml-6 text-xs text-amber-600">
                          {t('employee.noShiftsConfigured')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {formData.role === 'employee' && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                {t('employee.workSchedule', 'Work Schedule')}
              </h4>
              <p className="text-xs text-gray-500 mb-3">
                {t('employee.workScheduleHelp', 'Define when this employee is working. Slots are generated from service duration and these shifts. Capacity = number of employees available at each time.')}
              </p>
              {employeeShifts.length > 0 && (
                <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                  {employeeShifts.map((sh) => (
                    <div key={sh.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-gray-800">
                          {formatTimeTo12Hour(sh.start_time_utc ?? '')} – {formatTimeTo12Hour(sh.end_time_utc ?? '')}
                        </span>
                        <span className="text-xs text-gray-600">
                          {[...(sh.days_of_week || [])].sort().map(d => (i18n.language === 'ar' ? dayNamesAr[d] : dayNames[d])).join(', ')}
                        </span>
                      </div>
                      <Button type="button" variant="danger" size="sm" onClick={() => removeEmployeeShift(sh.id)} icon={<Trash2 className="w-3 h-3" />} />
                    </div>
                  ))}
                </div>
              )}
              {/* Add shift form: days + time range; Add adds to list, Cancel resets form (keeps form visible) */}
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div className="text-xs font-medium text-gray-700">
                  {t('employee.addShift', 'Add shift')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(i18n.language === 'ar' ? dayNamesAr : dayNames).map((name, day) => (
                    <label key={day} className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={employeeShiftForm.days_of_week.includes(day)}
                        onChange={() => toggleEmployeeShiftDay(day)}
                        className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-gray-700">{name}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600">{t('employee.startTime', 'Start')}</span>
                    <input
                      type="time"
                      value={employeeShiftForm.start_time.slice(0, 5)}
                      onChange={(e) => setEmployeeShiftForm(prev => ({ ...prev, start_time: e.target.value || '09:00' }))}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600">{t('employee.endTime', 'End')}</span>
                    <input
                      type="time"
                      value={employeeShiftForm.end_time.slice(0, 5)}
                      onChange={(e) => setEmployeeShiftForm(prev => ({ ...prev, end_time: e.target.value || '18:00' }))}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={(e) => addEmployeeShift(e as unknown as React.FormEvent)}
                  >
                    {t('common.add')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setEmployeeShiftForm({ days_of_week: [], start_time: '09:00', end_time: '18:00', is_active: true })}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button type="submit" fullWidth>
              {editingEmployee ? t('common.save') : t('common.add')}
            </Button>
            <Button type="button" variant="secondary" fullWidth onClick={closeModal}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

