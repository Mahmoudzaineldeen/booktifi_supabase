import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../../contexts/CurrencyContext';
import { getApiUrl } from '../../lib/apiUrl';
import { showNotification } from '../../contexts/NotificationContext';
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
} from 'lucide-react';

interface BranchDetail {
  id: string;
  tenant_id: string;
  name: string;
  location: string | null;
  created_at: string;
  updated_at: string;
  assigned_services: Array<{ id: string; name: string; name_ar?: string }>;
  assigned_packages: Array<{ id: string; name: string; name_ar?: string }>;
  assigned_employees: Array<{ id: string; full_name: string; full_name_ar?: string; email?: string }>;
  assigned_receptionists: Array<{ id: string; full_name: string; full_name_ar?: string; email?: string }>;
  assigned_cashiers: Array<{ id: string; full_name: string; full_name_ar?: string; email?: string }>;
  income_summary: { from_bookings: number; from_subscriptions: number; total: number };
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function BranchDetailPage() {
  const { t, i18n } = useTranslation();
  const { tenantSlug, branchId } = useParams<{ tenantSlug: string; branchId: string }>();
  const navigate = useNavigate();
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

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/branches/${branchId}`, { headers: getAuthHeaders() });
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
        const res = await fetch(`${getApiUrl()}/query`, {
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
        if (res.ok && Array.isArray(data.data)) setAllServices(data.data);
      } catch (_) {}
    })();
  }, [detail?.tenant_id]);

  const handleSaveEdit = async () => {
    if (!branchId) return;
    setSaving(true);
    try {
      const res = await fetch(`${getApiUrl()}/branches/${branchId}`, {
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
      const res = await fetch(`${getApiUrl()}/branches/${branchId}/services`, {
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
        <Button variant="ghost" size="sm" onClick={() => navigate(`/${tenantSlug}/admin/branches`)}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t('common.back', 'Back')}
        </Button>
      </div>

      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Building2 className="w-6 h-6 text-blue-600" />
                {detail.name}
              </h1>
              {detail.location && (
                <p className="text-gray-500 flex items-center gap-1 mt-1">
                  <MapPin className="w-4 h-4" />
                  {detail.location}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditModalOpen(true)}>
                <Edit2 className="w-4 h-4 mr-1" />
                {t('common.edit', 'Edit')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAssignServicesModalOpen(true)}>
                <Briefcase className="w-4 h-4 mr-1" />
                {t('branches.assignServices', 'Assign services')}
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
    </div>
  );
}
