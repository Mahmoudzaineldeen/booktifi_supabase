import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { apiFetch, getAuthHeaders } from '../../lib/apiClient';
import { showNotification } from '../../contexts/NotificationContext';
import { db } from '../../lib/db';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Plus, Pencil, Trash2, Tag, Layers, DollarSign, Search, Sparkles } from 'lucide-react';

type TagRow = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  fee: {
    fee_name: string | null;
    fee_value: number;
    description: string | null;
    time_type?: 'fixed' | 'multiplier';
    time_value?: number;
  } | null;
};

type ServiceRow = { id: string; name: string; name_ar?: string | null };

export function TagsPage() {
  const { t, i18n } = useTranslation();
  const { userProfile, hasPermission } = useAuth();
  const { formatPrice } = useCurrency();
  const canManage = hasPermission('manage_tags');
  const canAssignServices = hasPermission('assign_tags_to_services') || hasPermission('manage_services');
  const canView = canManage || hasPermission('view_tags') || hasPermission('assign_tags_to_services');

  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [hasExtraCharge, setHasExtraCharge] = useState(false);
  const [createFeeValue, setCreateFeeValue] = useState('');
  const [createTimeType, setCreateTimeType] = useState<'fixed' | 'multiplier'>('fixed');
  const [createTimeValue, setCreateTimeValue] = useState('0');
  const [createServiceIds, setCreateServiceIds] = useState<Set<string>>(new Set());
  const [createServicesSearch, setCreateServicesSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TagRow | null>(null);
  const [feeModal, setFeeModal] = useState<TagRow | null>(null);
  const [feeName, setFeeName] = useState('');
  const [feeValue, setFeeValue] = useState('');
  const [feeDesc, setFeeDesc] = useState('');
  const [feeTimeType, setFeeTimeType] = useState<'fixed' | 'multiplier'>('fixed');
  const [feeTimeValue, setFeeTimeValue] = useState('0');

  const [services, setServices] = useState<ServiceRow[]>([]);
  const [serviceToTags, setServiceToTags] = useState<Record<string, string[]>>({});
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignTag, setAssignTag] = useState<TagRow | null>(null);
  const [assignSelection, setAssignSelection] = useState<Set<string>>(new Set());
  const [assignSearch, setAssignSearch] = useState('');
  const [assigning, setAssigning] = useState(false);

  const loadTags = useCallback(async () => {
    if (!userProfile?.tenant_id || !canView) return;
    setLoading(true);
    try {
      const res = await apiFetch('/tags', { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setTags(data.tags || []);
    } catch (e: any) {
      showNotification('error', e.message);
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [userProfile?.tenant_id, canView]);

  const loadServiceAssignments = useCallback(async () => {
    if (!userProfile?.tenant_id || !canAssignServices) return;
    setAssignmentsLoading(true);
    try {
      const res = await db
        .from('services')
        .select('id, name, name_ar')
        .eq('tenant_id', userProfile.tenant_id)
        .eq('is_active', true)
        .order('name');
      const list = (res.data || []) as ServiceRow[];
      setServices(list);
      const map: Record<string, string[]> = {};
      await Promise.all(
        list.map(async (s) => {
          try {
            const r = await apiFetch(`/tags/services/${s.id}`, { headers: getAuthHeaders() });
            const j = await r.json();
            map[s.id] = j.tag_ids || [];
          } catch {
            map[s.id] = [];
          }
        })
      );
      setServiceToTags(map);
    } catch (e: any) {
      showNotification('error', e.message);
      setServices([]);
      setServiceToTags({});
    } finally {
      setAssignmentsLoading(false);
    }
  }, [userProfile?.tenant_id, canAssignServices]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    loadServiceAssignments();
  }, [loadServiceAssignments]);

  const serviceLabel = useCallback(
    (s: ServiceRow) => (i18n.language === 'ar' ? s.name_ar || s.name : s.name),
    [i18n.language]
  );

  const countServicesForTag = useCallback(
    (tagId: string) => services.filter((s) => (serviceToTags[s.id] || []).includes(tagId)).length,
    [services, serviceToTags]
  );

  const filteredServicesForAssign = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => {
      const a = (s.name || '').toLowerCase();
      const b = (s.name_ar || '').toLowerCase();
      return a.includes(q) || b.includes(q);
    });
  }, [services, assignSearch]);

  const filteredServicesForCreate = useMemo(() => {
    const q = createServicesSearch.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => {
      const a = (s.name || '').toLowerCase();
      const b = (s.name_ar || '').toLowerCase();
      return a.includes(q) || b.includes(q);
    });
  }, [services, createServicesSearch]);

  function toggleCreateService(serviceId: string) {
    setCreateServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  function openAssignModal(row: TagRow) {
    if (row.is_default) return;
    setAssignTag(row);
    setAssignSearch('');
    setAssignSelection(
      new Set(services.filter((s) => (serviceToTags[s.id] || []).includes(row.id)).map((s) => s.id))
    );
  }

  function toggleAssignService(serviceId: string) {
    setAssignSelection((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  async function saveAssignments() {
    if (!assignTag || !canAssignServices) return;
    const T = assignTag.id;
    setAssigning(true);
    try {
      for (const s of services) {
        const had = (serviceToTags[s.id] || []).includes(T);
        const want = assignSelection.has(s.id);
        if (had === want) continue;
        const next = new Set(serviceToTags[s.id] || []);
        if (want) next.add(T);
        else next.delete(T);
        const res = await apiFetch(`/tags/services/${s.id}/assignments`, {
          method: 'PUT',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag_ids: [...next] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('tags.assignFailed', 'Could not save tag assignments'));
        setServiceToTags((prev) => ({
          ...prev,
          [s.id]: data.tag_ids || [...next],
        }));
      }
      showNotification('success', t('tags.assignmentsSaved', 'Service links saved'));
      setAssignTag(null);
    } catch (e: any) {
      showNotification('error', e.message);
    } finally {
      setAssigning(false);
    }
  }

  async function createTag(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !name.trim()) return;
    const createTimeNum = Number(createTimeValue);
    if (!Number.isFinite(createTimeNum) || (createTimeType === 'fixed' ? createTimeNum < 0 : createTimeNum < 1)) {
      showNotification(
        'warning',
        createTimeType === 'fixed'
          ? t('tags.invalidFixedTime', 'Time value must be a non-negative number of minutes.')
          : t('tags.invalidMultiplierTime', 'Multiplier must be at least 1.')
      );
      return;
    }
    if (hasExtraCharge) {
      const v = parseFloat(createFeeValue);
      if (!Number.isFinite(v) || v <= 0) {
        showNotification(
          'warning',
          t('tags.extraChargeAmountRequired', 'Enter an extra amount greater than zero, or turn off the extra charge.')
        );
        return;
      }
    }
    setSaving(true);
    try {
      const feeVal = hasExtraCharge && createFeeValue.trim() ? parseFloat(createFeeValue) : NaN;
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: desc.trim() || null,
        time_type: createTimeType,
        time_value: createTimeNum,
      };
      if (hasExtraCharge && Number.isFinite(feeVal) && feeVal > 0) {
        body.fee_name = name.trim();
        body.fee_value = feeVal;
        body.fee_description = desc.trim() || null;
      }

      const res = await apiFetch('/tags', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      const newTagId = data.tag?.id as string | undefined;

      if (newTagId && canAssignServices && createServiceIds.size > 0) {
        for (const sid of createServiceIds) {
          const next = new Set(serviceToTags[sid] || []);
          next.add(newTagId);
          const putRes = await apiFetch(`/tags/services/${sid}/assignments`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_ids: [...next] }),
          });
          const putData = await putRes.json();
          if (!putRes.ok) throw new Error(putData.error || t('tags.assignFailed', 'Could not save tag assignments'));
          setServiceToTags((prev) => ({ ...prev, [sid]: putData.tag_ids || [...next] }));
        }
      }

      showNotification('success', t('tags.created', 'Tag created'));
      setName('');
      setDesc('');
      setHasExtraCharge(false);
      setCreateFeeValue('');
      setCreateTimeType('fixed');
      setCreateTimeValue('0');
      setCreateServiceIds(new Set());
      setCreateServicesSearch('');
      await loadTags();
      await loadServiceAssignments();
    } catch (e: any) {
      showNotification('error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !canManage) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/tags/${editing.id}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editing.is_default ? undefined : name.trim(),
          description: desc.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showNotification('success', t('tags.updated', 'Updated'));
      setEditing(null);
      setName('');
      setDesc('');
      loadTags();
    } catch (e: any) {
      showNotification('error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveFee(e: React.FormEvent) {
    e.preventDefault();
    if (!feeModal || !canManage) return;
    const timeNum = Number(feeTimeValue);
    if (!Number.isFinite(timeNum) || (feeTimeType === 'fixed' ? timeNum < 0 : timeNum < 1)) {
      showNotification(
        'warning',
        feeTimeType === 'fixed'
          ? t('tags.invalidFixedTime', 'Time value must be a non-negative number of minutes.')
          : t('tags.invalidMultiplierTime', 'Multiplier must be at least 1.')
      );
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/tags/${feeModal.id}/fee`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fee_name: feeName.trim() || null,
          fee_value: parseFloat(feeValue) || 0,
          description: feeDesc.trim() || null,
          time_type: feeTimeType,
          time_value: timeNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showNotification('success', t('tags.feeSaved', 'Fee saved'));
      setFeeModal(null);
      loadTags();
    } catch (e: any) {
      showNotification('error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeTag(row: TagRow) {
    if (!canManage || row.is_default) return;
    if (!window.confirm(t('tags.confirmDelete', 'Delete this tag?'))) return;
    try {
      const res = await apiFetch(`/tags/${row.id}`, { method: 'DELETE', headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showNotification('success', t('tags.deleted', 'Deleted'));
      await loadTags();
      await loadServiceAssignments();
    } catch (e: any) {
      showNotification('error', e.message);
    }
  }

  if (!canView) {
    return (
      <div className="p-6">
        <p className="text-gray-600">{t('tags.noAccess', 'You do not have access to pricing tags.')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 px-6 py-8 shadow-sm">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-indigo-200/30 blur-2xl" aria-hidden />
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-800">
              <Sparkles className="h-3.5 w-3.5" />
              {t('tags.title', 'Pricing tags')}
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t('tags.title', 'Pricing tags')}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 leading-relaxed">
              {t(
                'tags.subtitle',
                'Optional fees linked to services; staff must pick a tag when creating bookings.'
              )}
            </p>
          </div>
        </div>
      </div>

      {canManage && (
        <Card className="overflow-hidden border-slate-200/90 shadow-md shadow-slate-200/40">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <Plus className="h-5 w-5 text-indigo-600" />
              {t('tags.createTag', 'Create tag')}
            </h2>
          </div>
          <CardContent className="p-5 md:p-6">
            <form onSubmit={createTag} className="space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('tags.name', 'Name')} <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder={t('tags.namePlaceholder', 'e.g. Peak hours, Weekend')}
                    className="text-base"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('tags.description', 'Description')}
                  </label>
                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder={t('tags.descriptionPlaceholder', 'Short note for staff')}
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    {t('tags.descriptionHelp', 'Shown to staff; also used as the fee note if you add an extra charge below.')}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 shadow-inner">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200/80 text-indigo-600">
                      <DollarSign className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {t('tags.extraChargeToggle', 'Add extra charge')}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                        {t(
                          'tags.extraChargeHint',
                          'When enabled, the amount is added at booking. The tag name is used as the fee label—no duplicate fields.'
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={hasExtraCharge}
                    onClick={() => {
                      setHasExtraCharge((v) => {
                        if (v) setCreateFeeValue('');
                        return !v;
                      });
                    }}
                    className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                      hasExtraCharge ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow transition ${
                        hasExtraCharge ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                {hasExtraCharge && (
                  <div className="mt-4 border-t border-slate-200/80 pt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      {t('tags.extraChargeAmount', 'Extra amount')} <span className="text-red-500">*</span>
                    </label>
                    <div className="flex flex-wrap items-end gap-3">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={createFeeValue}
                        onChange={(e) => setCreateFeeValue(e.target.value)}
                        placeholder="0"
                        className="max-w-[200px]"
                      />
                      <span className="pb-2 text-sm text-slate-500">{t('tags.feeUsesTagName', 'Label: same as tag name')}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 shadow-inner space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t('tags.timeImpact', 'Time impact')}</p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {t('tags.timeImpactHint', 'Controls how much booking time this tag consumes, without changing price unless fee is set.')}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('tags.timeType', 'Time type')}</label>
                    <select
                      value={createTimeType}
                      onChange={(e) => {
                        const nextType = (e.target.value === 'multiplier' ? 'multiplier' : 'fixed') as 'fixed' | 'multiplier';
                        setCreateTimeType(nextType);
                        setCreateTimeValue(nextType === 'fixed' ? '0' : '1');
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="fixed">{t('tags.fixedTime', 'Fixed (minutes)')}</option>
                      <option value="multiplier">{t('tags.multiplierTime', 'Multiplier (x duration)')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      {createTimeType === 'fixed' ? t('tags.extraMinutes', 'Extra minutes') : t('tags.durationMultiplier', 'Duration multiplier')}
                    </label>
                    <Input
                      type="number"
                      min={createTimeType === 'fixed' ? 0 : 1}
                      step={createTimeType === 'fixed' ? '1' : '0.1'}
                      value={createTimeValue}
                      onChange={(e) => setCreateTimeValue(e.target.value)}
                      className="max-w-[220px]"
                    />
                  </div>
                </div>
              </div>

              {canAssignServices && services.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Layers className="h-4 w-4 text-indigo-600" />
                    {t('tags.linkServicesOnCreate', 'Offer on services (optional)')}
                  </div>
                  <p className="text-xs text-slate-500">{t('tags.linkServicesOnCreateHint', 'Default tag stays on every service; pick where this new tag should appear.')}</p>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={createServicesSearch}
                      onChange={(e) => setCreateServicesSearch(e.target.value)}
                      placeholder={t('tags.searchServices', 'Search services…')}
                      className="pl-10"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 space-y-0.5">
                    {filteredServicesForCreate.length === 0 ? (
                      <p className="py-4 text-center text-sm text-slate-500">{t('tags.noMatch', 'No matching services.')}</p>
                    ) : (
                      filteredServicesForCreate.map((s) => (
                        <label
                          key={s.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={createServiceIds.has(s.id)}
                            onChange={() => toggleCreateService(s.id)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm text-slate-800">{serviceLabel(s)}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-1">
                <Button type="submit" variant="primary" disabled={saving || !name.trim()} className="min-w-[120px]">
                  {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden border-slate-200/90 shadow-md shadow-slate-200/40">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Tag className="h-5 w-5 text-indigo-600" />
            {t('tags.yourTags', 'Your tags')}
          </h2>
          {assignmentsLoading && canAssignServices && (
            <span className="text-xs text-slate-500">{t('common.loading')}…</span>
          )}
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            </div>
          ) : tags.length === 0 ? (
            <div className="px-6 py-14 text-center text-slate-500">{t('tags.empty', 'No tags yet.')}</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tags.map((row, index) => {
                const n = countServicesForTag(row.id);
                const feeNum = row.fee ? Number(row.fee.fee_value) : 0;
                const timeType = row.is_default ? 'fixed' : (row.fee?.time_type || 'fixed');
                const timeValue = row.is_default ? 0 : Number(row.fee?.time_value ?? 0);
                return (
                  <li
                    key={row.id}
                    className={`group flex flex-col gap-4 p-5 transition-colors sm:flex-row sm:items-start sm:justify-between ${
                      index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold text-slate-900">{row.name}</span>
                        {row.is_default ? (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                            {t('tags.default', 'Default')}
                          </span>
                        ) : feeNum > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                            +{formatPrice(feeNum)}
                          </span>
                        ) : null}
                      </div>
                      {row.description && <p className="text-sm text-slate-600">{row.description}</p>}
                      {!row.is_default && row.fee && feeNum > 0 && (
                        <p className="text-sm text-slate-700">
                          <span className="font-medium">{row.fee.fee_name || t('tags.fee', 'Fee')}:</span>{' '}
                          {formatPrice(feeNum)}
                          {row.fee.description ? (
                            <span className="text-slate-500"> — {row.fee.description}</span>
                          ) : null}
                        </p>
                      )}
                      {!row.is_default && (
                        <p className="text-xs text-slate-600">
                          {timeType === 'multiplier'
                            ? t('tags.timeMultiplierSummary', 'Duration: {{value}}x', { value: timeValue })
                            : t('tags.timeFixedSummary', 'Duration: +{{value}} min', { value: timeValue })}
                        </p>
                      )}
                      {row.is_default && (
                        <p className="text-xs text-slate-500">{t('tags.defaultTagNote', 'Always available with services.')}</p>
                      )}
                      {canAssignServices && !row.is_default && services.length > 0 && (
                        <p className="text-xs font-medium text-slate-500">
                          {t('tags.linkedServicesCount', '{{count}} linked services', { count: n })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap gap-2">
                      {canAssignServices && !row.is_default && services.length > 0 && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          icon={<Layers className="h-3.5 w-3.5" />}
                          onClick={() => openAssignModal(row)}
                          className="border-slate-200"
                        >
                          {t('tags.assignToServices', 'Link services')}
                        </Button>
                      )}
                      {canManage && (
                        <>
                          {!row.is_default && (
                            <>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                icon={<Pencil className="h-3.5 w-3.5" />}
                                onClick={() => {
                                  setEditing(row);
                                  setName(row.name);
                                  setDesc(row.description || '');
                                }}
                                className="border-slate-200"
                              >
                                {t('common.edit')}
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                icon={<DollarSign className="h-3.5 w-3.5" />}
                                onClick={() => {
                                  setFeeModal(row);
                                  setFeeName(row.fee?.fee_name || '');
                                  setFeeValue(String(row.fee?.fee_value ?? ''));
                                  setFeeDesc(row.fee?.description || '');
                                  const modalTimeType = row.fee?.time_type === 'multiplier' ? 'multiplier' : 'fixed';
                                  setFeeTimeType(modalTimeType);
                                  setFeeTimeValue(String(row.fee?.time_value ?? (modalTimeType === 'multiplier' ? 1 : 0)));
                                }}
                                className="border-slate-200"
                              >
                                {t('tags.fee', 'Fee')}
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                icon={<Trash2 className="h-3.5 w-3.5" />}
                                onClick={() => removeTag(row)}
                                className="border-red-100 text-red-700 hover:bg-red-50"
                              >
                                {t('common.delete')}
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canAssignServices && services.length === 0 && !assignmentsLoading && (
        <p className="text-center text-sm text-slate-500">{t('tags.noServicesYet', 'No active services yet.')}</p>
      )}

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={t('tags.editTag', 'Edit tag')}
        size="md"
      >
        <form onSubmit={saveEdit} className="space-y-4 px-1 pb-1">
          {!editing?.is_default && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('tags.name', 'Name')}</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('tags.description', 'Description')}</label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!feeModal}
        onClose={() => setFeeModal(null)}
        title={t('tags.editFee', 'Tag fee')}
        size="md"
      >
        <form onSubmit={saveFee} className="space-y-4 px-1 pb-1">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('tags.feeName', 'Fee name')}</label>
            <Input value={feeName} onChange={(e) => setFeeName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('tags.feeValue', 'Fee amount')} <span className="text-red-500">*</span>
            </label>
            <Input type="number" min={0} step="0.01" value={feeValue} onChange={(e) => setFeeValue(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('tags.feeDescription', 'Fee description')}</label>
            <Input value={feeDesc} onChange={(e) => setFeeDesc(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('tags.timeType', 'Time type')}</label>
              <select
                value={feeTimeType}
                onChange={(e) => {
                  const nextType = (e.target.value === 'multiplier' ? 'multiplier' : 'fixed') as 'fixed' | 'multiplier';
                  setFeeTimeType(nextType);
                  setFeeTimeValue(nextType === 'fixed' ? '0' : '1');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="fixed">{t('tags.fixedTime', 'Fixed (minutes)')}</option>
                <option value="multiplier">{t('tags.multiplierTime', 'Multiplier (x duration)')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {feeTimeType === 'fixed' ? t('tags.extraMinutes', 'Extra minutes') : t('tags.durationMultiplier', 'Duration multiplier')}
              </label>
              <Input
                type="number"
                min={feeTimeType === 'fixed' ? 0 : 1}
                step={feeTimeType === 'fixed' ? '1' : '0.1'}
                value={feeTimeValue}
                onChange={(e) => setFeeTimeValue(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setFeeModal(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!assignTag}
        onClose={() => !assigning && setAssignTag(null)}
        title={
          assignTag
            ? t('tags.assignToServicesTitle', 'Link "{{name}}" to services', { name: assignTag.name })
            : ''
        }
        size="lg"
      >
        {assignTag && (
          <div className="space-y-4 px-1 pb-1">
            <p className="text-sm text-slate-600">{t('tags.assignToServicesHint', 'Choose services where this tag appears when booking.')}</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                placeholder={t('tags.searchServices', 'Search services…')}
                className="pl-10"
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/50 p-2 space-y-1">
              {filteredServicesForAssign.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">{t('tags.noMatch', 'No matching services.')}</p>
              ) : (
                filteredServicesForAssign.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={assignSelection.has(s.id)}
                      onChange={() => toggleAssignService(s.id)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-medium text-slate-800">{serviceLabel(s)}</span>
                  </label>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" variant="primary" disabled={assigning} onClick={saveAssignments}>
                {assigning ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
              </Button>
              <Button type="button" variant="secondary" disabled={assigning} onClick={() => setAssignTag(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
