import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, Save, AlertCircle, Check, ArrowLeft, Search } from 'lucide-react';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { safeTranslateNested } from '../../lib/safeTranslation';

interface TenantFeatures {
  id: string;
  tenant_id: string;
  employees_enabled: boolean;
  employee_assignment_mode: 'automatic' | 'manual' | 'both';
  packages_enabled: boolean;
  landing_page_enabled: boolean;
  scheduling_mode: 'employee_based' | 'service_slot_based';
}

interface Tenant {
  id: string;
  name: string;
  name_ar: string | null;
  industry?: string;
  contact_email?: string | null;
}

const INDUSTRY_OPTIONS = ['restaurant', 'salon', 'clinic', 'parking', 'venue', 'other'] as const;
const MAIN_INDUSTRIES = ['restaurant', 'salon', 'clinic', 'parking', 'venue'];
function isOtherIndustry(industry: string | undefined): boolean {
  const ind = (industry || '').trim();
  return !ind || !MAIN_INDUSTRIES.includes(ind);
}

export function TenantFeaturesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [features, setFeatures] = useState<TenantFeatures | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const featuresCacheRef = React.useRef<Record<string, TenantFeatures | null>>({});

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    if (!selectedTenantId) {
      setFeatures(null);
      return;
    }
    const cached = featuresCacheRef.current[selectedTenantId];
    if (cached !== undefined) {
      setFeatures(cached);
      setLoading(false);
      return;
    }
    loadFeatures(selectedTenantId);
  }, [selectedTenantId]);

  const getClient = () => db;

  const loadTenants = async () => {
    try {
      const client = getClient();
      const { data, error } = await client
        .from('tenants')
        .select('id, name, name_ar, industry, contact_email')
        .order('name');

      if (error) throw error;
      setTenants(data || []);

      if (data && data.length > 0 && !selectedTenantId) {
        setSelectedTenantId(data[0].id);
      }
    } catch (error) {
      console.error('Error loading tenants:', error);
      setMessage({ type: 'error', text: 'Failed to load tenants' });
    }
  };

  const filteredTenants = useMemo(() => {
    let list = tenants;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (tenant) =>
          (tenant.name || '').toLowerCase().includes(q) ||
          (tenant.name_ar || '').toLowerCase().includes(q) ||
          (tenant.contact_email || '').toLowerCase().includes(q) ||
          (tenant.industry || '').toLowerCase().includes(q) ||
          (q === 'other' && isOtherIndustry(tenant.industry))
      );
    }
    if (categoryFilter) {
      if (categoryFilter === 'other') {
        list = list.filter((tenant) => isOtherIndustry(tenant.industry));
      } else {
        list = list.filter((tenant) => (tenant.industry || '') === categoryFilter);
      }
    }
    return list;
  }, [tenants, searchQuery, categoryFilter]);

  useEffect(() => {
    if (filteredTenants.length > 0 && selectedTenantId && !filteredTenants.some((t) => t.id === selectedTenantId)) {
      setSelectedTenantId(filteredTenants[0].id);
    }
  }, [filteredTenants, selectedTenantId]);

  const loadFeatures = async (tenantId: string) => {
    setLoading(true);
    try {
      const client = getClient();
      const { data, error } = await client
        .from('tenant_features')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;
      const resolved = data ? { ...data, scheduling_mode: (data as any).scheduling_mode ?? 'service_slot_based' } : null;
      featuresCacheRef.current[tenantId] = resolved;
      setFeatures(resolved);
    } catch (error) {
      console.error('Error loading features:', error);
      setMessage({ type: 'error', text: 'Failed to load tenant features' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!features || !selectedTenantId) return;

    setSaving(true);
    setMessage(null);

    try {
      const client = getClient();
      const { error } = await client
        .from('tenant_features')
        .update({
          employees_enabled: features.employees_enabled,
          employee_assignment_mode: features.employee_assignment_mode,
          packages_enabled: features.packages_enabled,
          landing_page_enabled: features.landing_page_enabled,
          scheduling_mode: features.scheduling_mode ?? 'service_slot_based',
        })
        .eq('tenant_id', selectedTenantId);

      if (error) {
        const msg = (error as { message?: string })?.message || String(error);
        throw new Error(msg);
      }

      setMessage({ type: 'success', text: 'Features updated successfully' });
      if (selectedTenantId && features) {
        featuresCacheRef.current[selectedTenantId] = features;
      }
      await loadFeatures(selectedTenantId);
      setTimeout(() => {
        setMessage(null);
      }, 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save features';
      console.error('Error saving features:', err);
      setMessage({ type: 'error', text: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleFeatureChange = (field: keyof TenantFeatures, value: any) => {
    if (!features) return;

    const updatedFeatures = { ...features, [field]: value };

    // If employees are disabled, force employee_assignment_mode to 'automatic'
    if (field === 'employees_enabled' && !value) {
      updatedFeatures.employee_assignment_mode = 'automatic';
    }

    setFeatures(updatedFeatures);
  };

  const selectedTenant = tenants.find(t => t.id === selectedTenantId);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate('/solution-admin')}
            className="mb-4 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-blue-100 p-2.5 rounded-xl">
              <Settings className="w-7 h-7 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Tenant Features Management</h1>
          </div>
          <p className="text-slate-600">
            Enable or disable features for individual tenants
          </p>
        </div>

        {/* Search and category filter */}
        {tenants.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                type="text"
                placeholder={t('admin.searchTenants', 'Search by name, email or industry...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white min-w-[140px]"
            >
              <option value="">{t('admin.allCategories', 'All categories')}</option>
              {INDUSTRY_OPTIONS.map((ind) => (
                <option key={ind} value={ind}>
                  {safeTranslateNested(t, 'admin.industries', ind, ind)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Tenant Selection */}
        <Card className="mb-6 shadow-sm border border-gray-200/80">
          <div className="p-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Select Tenant
            </label>
            <select
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {filteredTenants.length === 0 ? (
                <option value="">{t('admin.noTenantsMatchFilter', 'No tenants match your search or category.')}</option>
              ) : (
                filteredTenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} {tenant.name_ar ? `(${tenant.name_ar})` : ''}
                    {tenant.industry ? ` · ${safeTranslateNested(t, 'admin.industries', tenant.industry, tenant.industry)}` : ''}
                  </option>
                ))
              )}
            </select>
            {filteredTenants.length < tenants.length && (
              <p className="text-xs text-gray-500 mt-2">
                {t('admin.showingFiltered', 'Showing {{count}} of {{total}} tenants', { count: filteredTenants.length, total: tenants.length })}
              </p>
            )}
          </div>
        </Card>

        {/* Message */}
        {message && (
          <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 border ${
            message.type === 'success' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            {message.type === 'success' ? (
              <Check className="w-5 h-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <span className="font-medium">{message.text}</span>
          </div>
        )}

        {/* Features Configuration */}
        {loading && !features ? (
          <Card>
            <div className="p-6 space-y-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-48" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="h-10 bg-gray-200 rounded" />
                <div className="h-10 bg-gray-200 rounded" />
                <div className="h-10 bg-gray-200 rounded" />
                <div className="h-10 bg-gray-200 rounded" />
              </div>
              <div className="h-10 bg-gray-200 rounded w-24" />
            </div>
          </Card>
        ) : features ? (
          <div className="space-y-6">
            <Card className="shadow-sm border border-gray-200/80">
              <div className="p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-6">
                  Feature Settings for {selectedTenant?.name}
                </h2>

                <div className="space-y-6">
                  {/* Employees Module */}
                  <div className="border-b border-gray-200 pb-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                          Employees Module
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                          Enable or disable the entire employees module. When disabled, employee-based capacity
                          and employee performance analytics will be hidden from the dashboard.
                        </p>
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={features.employees_enabled}
                            onChange={(e) => handleFeatureChange('employees_enabled', e.target.checked)}
                            className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">
                            Enable Employees Module
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Employee Assignment Mode */}
                  <div className="border-b border-gray-200 pb-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                          Employee Assignment Mode
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                          Control how employees are assigned to bookings. This setting is only available
                          when the Employees Module is enabled.
                        </p>
                        <div className="space-y-3">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="radio"
                              name="assignment_mode"
                              value="automatic"
                              checked={features.employee_assignment_mode === 'automatic'}
                              onChange={(e) => handleFeatureChange('employee_assignment_mode', 'automatic')}
                              disabled={!features.employees_enabled}
                              className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                            />
                            <div>
                              <span className="text-sm font-medium text-gray-700">Automatic Only</span>
                              <p className="text-xs text-gray-500">System automatically assigns employees</p>
                            </div>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="radio"
                              name="assignment_mode"
                              value="manual"
                              checked={features.employee_assignment_mode === 'manual'}
                              onChange={(e) => handleFeatureChange('employee_assignment_mode', 'manual')}
                              disabled={!features.employees_enabled}
                              className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                            />
                            <div>
                              <span className="text-sm font-medium text-gray-700">Manual Only</span>
                              <p className="text-xs text-gray-500">Receptionist must manually select employees</p>
                            </div>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="radio"
                              name="assignment_mode"
                              value="both"
                              checked={features.employee_assignment_mode === 'both'}
                              onChange={(e) => handleFeatureChange('employee_assignment_mode', 'both')}
                              disabled={!features.employees_enabled}
                              className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                            />
                            <div>
                              <span className="text-sm font-medium text-gray-700">Both (Automatic & Manual)</span>
                              <p className="text-xs text-gray-500">Receptionist can choose either mode</p>
                            </div>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Global Scheduling Mode */}
                  <div className="border-b border-gray-200 pb-6">
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        Scheduling Mode
                      </h3>
                      <p className="text-sm text-gray-600 mb-4">
                        Controls how the entire booking system behaves. When Employee based, availability comes from employee shifts only; service slot management is hidden. When Service slot based, availability comes from service-defined slots.
                      </p>
                      <div className="space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="radio"
                            name="scheduling_mode"
                            value="service_slot_based"
                            checked={(features.scheduling_mode ?? 'service_slot_based') === 'service_slot_based'}
                            onChange={() => handleFeatureChange('scheduling_mode', 'service_slot_based')}
                            className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">Service slot based</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="radio"
                            name="scheduling_mode"
                            value="employee_based"
                            checked={(features.scheduling_mode ?? 'service_slot_based') === 'employee_based'}
                            onChange={() => handleFeatureChange('scheduling_mode', 'employee_based')}
                            className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">Employee based</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Packages Module */}
                  <div className="border-b border-gray-200 pb-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                          Service Packages Module
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                          Enable or disable the service packages and subscriptions feature. When disabled,
                          the packages menu item and functionality will be hidden.
                        </p>
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={features.packages_enabled}
                            onChange={(e) => handleFeatureChange('packages_enabled', e.target.checked)}
                            className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">
                            Enable Service Packages
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Landing Page */}
                  <div className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                          Customer Landing Page
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                          Enable or disable the public customer landing page for this tenant. When disabled,
                          customers will not be able to access the public booking page.
                        </p>
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={features.landing_page_enabled}
                            onChange={(e) => handleFeatureChange('landing_page_enabled', e.target.checked)}
                            className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">
                            Enable Customer Landing Page
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <div className="mt-8 flex justify-end">
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? t('common.saving') : t('settings.saveChanges')}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Impact Warning */}
            <Card className="bg-yellow-50 border-yellow-200">
              <div className="p-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-yellow-900 mb-2">Important Notes</h4>
                    <ul className="text-sm text-yellow-800 space-y-1 list-disc list-inside">
                      <li>Changes take effect immediately for the tenant</li>
                      <li>Disabling Employees will also disable employee-based capacity calculations</li>
                      <li>Employee analytics will be hidden from the dashboard when Employees are disabled</li>
                      <li>Disabling the Landing Page will prevent public customer bookings</li>
                    </ul>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        ) : (
          <Card>
            <div className="p-8 text-center text-gray-600">
              No features configuration found for this tenant.
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
