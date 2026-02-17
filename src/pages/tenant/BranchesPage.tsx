import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiUrl } from '../../lib/apiUrl';
import { showNotification } from '../../contexts/NotificationContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Building2, MapPin, ChevronRight, Plus, Store } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  location: string | null;
  created_at: string;
  is_active?: boolean;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function BranchesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/branches`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branches');
      setBranches(data.data || []);
    } catch (e: any) {
      setBranches([]);
      showNotification('error', e.message || 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${getApiUrl()}/branches`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load branches');
        if (!cancelled) setBranches(data.data || []);
      } catch (e: any) {
        if (!cancelled) {
          setBranches([]);
          showNotification('error', e.message || 'Failed to load branches');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCreateBranch = async () => {
    const name = createName.trim();
    if (!name) {
      showNotification('error', t('branches.nameRequired', 'Branch name is required'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${getApiUrl()}/branches`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          location: createLocation.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create branch');
      showNotification('success', t('branches.created', 'Branch created successfully'));
      setCreateModalOpen(false);
      setCreateName('');
      setCreateLocation('');
      setBranches((prev) => [...prev, data.data]);
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to create branch');
    } finally {
      setCreating(false);
    }
  };

  const openCreateModal = () => {
    setCreateName('');
    setCreateLocation('');
    setCreateModalOpen(true);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[320px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Store className="w-7 h-7 text-blue-600" />
            {t('navigation.branches', 'Branches')}
          </h1>
          <p className="mt-1 text-gray-500 text-sm max-w-xl">
            {t('branches.subtitle', 'Manage your business locations. Assign services, staff, and track income per branch.')}
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={openCreateModal}
          className="shrink-0"
        >
          {t('branches.createBranch', 'Create Branch')}
        </Button>
      </div>

      {/* Summary strip when there are branches */}
      {branches.length > 0 && (
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-gray-700">{branches.length}</span>
          <span>{branches.length === 1 ? t('branches.branch', 'branch') : t('branches.branches', 'branches')}</span>
        </div>
      )}

      {/* Branch cards or empty state */}
      {branches.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((branch) => (
            <Card
              key={branch.id}
              className="flex flex-col overflow-hidden border border-gray-200/80 hover:border-blue-200 hover:shadow-md transition-all duration-200"
            >
              <CardContent className="p-6 flex flex-col flex-1">
                <div className="flex items-start gap-4 mb-4">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-600 shrink-0">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold text-gray-900 text-lg truncate">{branch.name}</h2>
                      {branch.is_active === false && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">
                          {t('common.inactive', 'Inactive')}
                        </span>
                      )}
                    </div>
                    {branch.location ? (
                      <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-1">
                        <MapPin className="w-4 h-4 flex-shrink-0 text-gray-400" />
                        <span className="truncate">{branch.location}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-gray-400 italic mt-1">{t('branches.noLocation', 'No location set')}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto w-full justify-between group"
                  onClick={() => navigate(`/${tenantSlug}/admin/branches/${branch.id}`)}
                >
                  {t('branches.seeMore', 'See More')}
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-2 border-dashed border-gray-200 bg-gray-50/50">
          <CardContent className="py-16 px-6 text-center">
            <div className="inline-flex p-4 rounded-full bg-blue-100 text-blue-600 mb-4">
              <Building2 className="w-12 h-12" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {t('branches.noBranchesTitle', 'No branches yet')}
            </h2>
            <p className="text-gray-500 max-w-sm mx-auto mb-6">
              {t('branches.noBranchesDescription', 'Create your first branch to organize services, staff, and income by location.')}
            </p>
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreateModal}>
              {t('branches.createBranch', 'Create Branch')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create Branch Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => !creating && setCreateModalOpen(false)}
        title={t('branches.createBranch', 'Create Branch')}
        size="md"
      >
        <div className="space-y-4">
          <Input
            label={t('branches.name', 'Branch name')}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={t('branches.namePlaceholder', 'e.g. Downtown Branch')}
            required
          />
          <Input
            label={t('branches.location', 'Location / Address')}
            value={createLocation}
            onChange={(e) => setCreateLocation(e.target.value)}
            placeholder={t('branches.locationPlaceholder', 'e.g. 123 Main Street')}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateModalOpen(false)} disabled={creating}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleCreateBranch} disabled={creating || !createName.trim()}>
              {creating ? t('common.creating', 'Creating...') : t('branches.create', 'Create')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
