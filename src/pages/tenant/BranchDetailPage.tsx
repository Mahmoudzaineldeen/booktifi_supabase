import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../../contexts/CurrencyContext';
import { apiFetch, getAuthHeaders } from '../../lib/apiClient';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import {
  Building2,
  MapPin,
  ArrowLeft,
  Edit2,
  Users,
  Briefcase,
  Package,
  UserCheck,
  CreditCard,
  DollarSign,
  X,
  Check,
  Trash2,
  Power,
  PowerOff,
  Clock,
  Plus,
} from 'lucide-react';
import { formatTimeTo12Hour } from '../../lib/timeFormat';

export interface BranchShift {
  id: string;
  branch_id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  created_at: string;
}

interface BranchDetail {
  id: string;
  tenant_id: string;
  name: string;
  location: string | null;
  created_at: string;
  updated_at: string;
  is_active?: boolean;
  assigned_services: Array<{ id: string; name: string; name_ar?: string }>;
  assigned_packages: Array<{ id: string; name: string; name_ar?: string }>;
  assigned_employees: Array<{ id: string; full_name: string; full_name_ar?: string; email?: string }>;
  assigned_receptionists: Array<{ id: string; full_name: string; full_name_ar?: string; email?: string }>;
  assigned_cashiers: Array<{ id: string; full_name: string; full_name_ar?: string; email?: string }>;
  branch_shifts?: BranchShift[];
  income_summary: { from_bookings: number; from_subscriptions: number; total: number };
}

export function BranchDetailPage() {
  const { t, i18n } = useTranslation();
  const { tenantSlug, branchId } = useParams<{ tenantSlug: string; branchId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const branchesState = (location.state as { branches?: Array<{ id: string; name: string; location?: string | null }> } | null)?.branches;
  const { formatPrice } = useCurrency();
  const [detail, setDetail] = useState<BranchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [assignServicesModalOpen, setAssignServicesModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [allServices, setAllServices] = useState<Array<{ id: string; name: string; name_ar?: string }>>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [shiftModalMode, setShiftModalMode] = useState<'add' | 'edit'>('add');
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftDays, setShiftDays] = useState<number[]>([]);
  const [shiftStartTime, setShiftStartTime] = useState('09:00');
  const [shiftEndTime, setShiftEndTime] = useState('17:00');

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/branches/${branchId}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load branch');
        if (!cancelled) {
          setDetail(data.data);
          setEditName(data.data.name);
          setEditLocation(data.data.location || '');
          setSelectedServiceIds(new Set((data.data.assigned_services || []).map((s: any) => s.id)));
        }
      } catch (e: any) {
        if (!cancelled) showNotification('error', e.message || 'Failed to load branch');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [branchId]);

  useEffect(() => {
    if (!detail?.tenant_id) return;
    (async () => {
      try {
        const res = await apiFetch('/query', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            table: 'services',
            select: 'id,name,name_ar',
            where: { tenant_id: detail.tenant_id },
            orderBy: { column: 'name', ascending: true },
          }),
        });
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.data ?? []);
        if (res.ok && Array.isArray(list)) setAllServices(list);
      } catch (_) {}
    })();
  }, [detail?.tenant_id]);

  const handleSaveEdit = async () => {
    if (!branchId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/branches/${branchId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: editName.trim(), location: editLocation.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update branch');
      setDetail((prev) => prev ? { ...prev, name: editName.trim(), location: editLocation.trim() || null } : null);
      setEditModalOpen(false);
      showNotification('success', t('common.saved', 'Saved'));
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAssignedServices = async () => {
    if (!branchId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/branches/${branchId}/services`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ service_ids: Array.from(selectedServiceIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update services');
      setDetail((prev) => {
        if (!prev) return prev;
        const assigned = allServices.filter((s) => selectedServiceIds.has(s.id));
        return { ...prev, assigned_services: assigned };
      });
      setAssignServicesModalOpen(false);
      showNotification('success', t('common.saved', 'Saved'));
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const DAY_NAMES = i18n.language?.startsWith('ar')
    ? ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const formatShiftDays = (days: number[]) =>
    (days || []).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ');

  const openAddShift = () => {
    setShiftModalMode('add');
    setEditingShiftId(null);
    setShiftDays([0, 1, 2, 3, 4]); // Sun–Thu default
    setShiftStartTime('09:00');
    setShiftEndTime('17:00');
    setShiftModalOpen(true);
  };

  const openEditShift = (shift: BranchShift) => {
    setShiftModalMode('edit');
    setEditingShiftId(shift.id);
    setShiftDays(Array.isArray(shift.days_of_week) ? [...shift.days_of_week] : []);
    const st = (shift.start_time || '').slice(0, 5);
    const et = (shift.end_time || '').slice(0, 5);
    setShiftStartTime(st || '09:00');
    setShiftEndTime(et || '17:00');
    setShiftModalOpen(true);
  };

  const toggleShiftDay = (d: number) => {
    setShiftDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  };

  const selectAllWeekDays = () => setShiftDays([0, 1, 2, 3, 4, 5, 6]);

  const handleSaveShift = async () => {
    if (!branchId) return;
    if (shiftDays.length === 0) {
      showNotification('error', t('branches.shiftDaysRequired', 'Select at least one day'));
      return;
    }
    const start = shiftStartTime.length === 5 ? shiftStartTime : shiftStartTime.slice(0, 5);
    const end = shiftEndTime.length === 5 ? shiftEndTime : shiftEndTime.slice(0, 5);
    if (end === start) {
      showNotification('error', t('branches.shiftEndAfterStart', 'End time must be after start time'));
      return;
    }
    setSaving(true);
    try {
      if (shiftModalMode === 'edit' && editingShiftId) {
        const res = await apiFetch(`/branches/${branchId}/shifts/${editingShiftId}`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ days_of_week: shiftDays, start_time: start, end_time: end }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update shift');
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                branch_shifts: (prev.branch_shifts || []).map((s) =>
                  s.id === editingShiftId ? { ...s, days_of_week: shiftDays, start_time: start, end_time: end } : s
                ),
              }
            : null
        );
        showNotification('success', t('common.saved', 'Saved'));
      } else {
        const res = await apiFetch(`/branches/${branchId}/shifts`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ days_of_week: shiftDays, start_time: start, end_time: end }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to add shift');
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                branch_shifts: [...(prev.branch_shifts || []), data.data],
              }
            : null
        );
        showNotification('success', t('branches.shiftAdded', 'Shift added'));
      }
      setShiftModalOpen(false);
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to save shift');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShift = async (shift: BranchShift) => {
    if (!branchId) return;
    const ok = await showConfirm({
      title: t('common.confirm'),
      description: t('branches.deleteShiftConfirm', 'Delete this working shift?'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/branches/${branchId}/shifts/${shift.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete shift');
      setDetail((prev) =>
        prev ? { ...prev, branch_shifts: (prev.branch_shifts || []).filter((s) => s.id !== shift.id) } : null
      );
      showNotification('success', t('branches.shiftDeleted', 'Shift deleted'));
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to delete shift');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivateToggle = async () => {
    if (!branchId) return;
    const newActive = !(detail?.is_active !== false);
    const ok = await showConfirm({
      title: t('common.confirm'),
      description: newActive
        ? t('branches.activateConfirm', 'Activate this branch? It will appear in branch lists again.')
        : t('branches.deactivateConfirm', 'Deactivate this branch? It will be hidden from assignment dropdowns.'),
      confirmText: newActive ? t('branches.activate', 'Activate') : t('branches.deactivate', 'Deactivate'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/branches/${branchId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: newActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      setDetail((prev) => (prev ? { ...prev, is_active: newActive } : null));
      showNotification('success', newActive ? t('branches.activated', 'Branch activated') : t('branches.deactivated', 'Branch deactivated'));
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBranch = async () => {
    if (!branchId) return;
    const ok = await showConfirm({
      title: t('branches.deleteConfirmTitle', 'Delete branch?'),
      description: t('branches.deleteConfirmDescription', 'This will remove the branch. Bookings and subscriptions will keep their data but will no longer be linked to this branch. Employees and receptionists assigned to this branch will be unassigned. This cannot be undone.'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/branches/${branchId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete branch');
      showNotification('success', t('branches.deleted', 'Branch deleted'));
      navigate(`/${tenantSlug}/admin/branches`);
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to delete branch');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !detail) {
    return (
      <div className="p-6">
        <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>
      </div>
    );
  }

  const nameKey = i18n.language === 'ar' ? 'name_ar' : 'name';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            navigate(`/${tenantSlug}/admin/branches`, { state: branchesState ? { branches: branchesState } : undefined })
          }
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t('common.back', 'Back')}
        </Button>
      </div>

      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Building2 className="w-6 h-6 text-blue-600" />
                  {detail.name}
                </h1>
                {detail.is_active === false && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">
                    {t('common.inactive', 'Inactive')}
                  </span>
                )}
              </div>
              {detail.location && (
                <p className="text-gray-500 flex items-center gap-1 mt-1">
                  <MapPin className="w-4 h-4" />
                  {detail.location}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditModalOpen(true)}>
                <Edit2 className="w-4 h-4 mr-1" />
                {t('common.edit', 'Edit')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAssignServicesModalOpen(true)}>
                <Briefcase className="w-4 h-4 mr-1" />
                {t('branches.assignServices', 'Assign services')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeactivateToggle}
                disabled={saving}
              >
                {detail.is_active === false ? (
                  <>
                    <Power className="w-4 h-4 mr-1" />
                    {t('branches.activate', 'Activate')}
                  </>
                ) : (
                  <>
                    <PowerOff className="w-4 h-4 mr-1" />
                    {t('branches.deactivate', 'Deactivate')}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteBranch}
                disabled={saving}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                {t('common.delete', 'Delete')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              {t('branches.assignedServices', 'Assigned Services')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.assigned_services.length === 0 ? (
              <p className="text-sm text-gray-500">{t('branches.none', 'None')}</p>
            ) : (
              <ul className="text-sm space-y-1">
                {detail.assigned_services.map((s) => (
                  <li key={s.id}>{(s as any)[nameKey] || s.name}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="w-4 h-4" />
              {t('branches.assignedPackages', 'Assigned Packages')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.assigned_packages.length === 0 ? (
              <p className="text-sm text-gray-500">{t('branches.none', 'None')}</p>
            ) : (
              <ul className="text-sm space-y-1">
                {detail.assigned_packages.map((p) => (
                  <li key={p.id}>{(p as any)[nameKey] || p.name}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              {t('branches.assignedEmployees', 'Assigned Employees')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.assigned_employees.length === 0 ? (
              <p className="text-sm text-gray-500">{t('branches.none', 'None')}</p>
            ) : (
              <ul className="text-sm space-y-1">
                {detail.assigned_employees.map((u) => (
                  <li key={u.id}>{u.full_name_ar || u.full_name}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <UserCheck className="w-4 h-4" />
              {t('branches.assignedReceptionists', 'Assigned Receptionists')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.assigned_receptionists.length === 0 ? (
              <p className="text-sm text-gray-500">{t('branches.none', 'None')}</p>
            ) : (
              <ul className="text-sm space-y-1">
                {detail.assigned_receptionists.map((u) => (
                  <li key={u.id}>{u.full_name_ar || u.full_name}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              {t('branches.assignedCashiers', 'Assigned Cashiers')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.assigned_cashiers.length === 0 ? (
              <p className="text-sm text-gray-500">{t('branches.none', 'None')}</p>
            ) : (
              <ul className="text-sm space-y-1">
                {detail.assigned_cashiers.map((u) => (
                  <li key={u.id}>{u.full_name_ar || u.full_name}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {t('branches.workingShifts', 'Branch Working Shifts')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-3">
            {t('branches.workingShiftsDescription', 'Default working hours for this branch. Employees without custom shifts will use these.')}
          </p>
          {(detail.branch_shifts || []).length === 0 ? (
            <p className="text-sm text-gray-500">{t('branches.noShifts', 'No shifts defined')}</p>
          ) : (
            <ul className="space-y-2">
              {(detail.branch_shifts || []).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-gray-50 border border-gray-100"
                >
                  <span className="text-sm">
                    {formatShiftDays(s.days_of_week)} • {formatTimeTo12Hour(s.start_time)} – {formatTimeTo12Hour(s.end_time)}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEditShift(s)}>
                      {t('common.edit', 'Edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => handleDeleteShift(s)}
                      disabled={saving}
                    >
                      {t('common.delete', 'Delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" size="sm" className="mt-3" onClick={openAddShift} icon={<Plus className="w-4 h-4" />}>
            {t('branches.addShift', 'Add shift')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            {t('branches.incomeSummary', 'Branch income summary')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            <div>
              <span className="text-gray-500">{t('branches.fromBookings', 'From bookings')}:</span>
              <span className="ml-2 font-medium">{formatPrice(detail.income_summary.from_bookings)}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('branches.fromSubscriptions', 'From subscriptions')}:</span>
              <span className="ml-2 font-medium">{formatPrice(detail.income_summary.from_subscriptions)}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('branches.total', 'Total')}:</span>
              <span className="ml-2 font-medium">{formatPrice(detail.income_summary.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={t('branches.editBranch', 'Edit branch')}
      >
        <div className="space-y-4">
          <Input
            label={t('branches.name', 'Name')}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <Input
            label={t('branches.location', 'Location')}
            value={editLocation}
            onChange={(e) => setEditLocation(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving || !editName.trim()}>
              {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={assignServicesModalOpen}
        onClose={() => setAssignServicesModalOpen(false)}
        title={t('branches.assignServices', 'Assign services')}
      >
        <div className="max-h-80 overflow-y-auto space-y-2">
          {allServices.map((s) => (
            <label key={s.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedServiceIds.has(s.id)}
                onChange={() => toggleService(s.id)}
              />
              <span>{(s as any)[nameKey] || s.name}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setAssignServicesModalOpen(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSaveAssignedServices} disabled={saving}>
            {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={shiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        title={shiftModalMode === 'edit' ? t('branches.editShift', 'Edit shift') : t('branches.addShift', 'Add shift')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('branches.daysOfWeek', 'Days of week')}</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <label key={d} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shiftDays.includes(d)}
                    onChange={() => toggleShiftDay(d)}
                  />
                  <span className="text-sm">{DAY_NAMES[d]}</span>
                </label>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={selectAllWeekDays}>
              {t('branches.selectAllWeekDays', 'Select all week days')}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('branches.startTime', 'Start time')}
              type="time"
              value={shiftStartTime}
              onChange={(e) => setShiftStartTime(e.target.value)}
            />
            <Input
              label={t('branches.endTime', 'End time')}
              type="time"
              value={shiftEndTime}
              onChange={(e) => setShiftEndTime(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShiftModalOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSaveShift} disabled={saving || shiftDays.length === 0}>
              {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
