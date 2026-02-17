import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiUrl } from '../../lib/apiUrl';
import { showNotification } from '../../contexts/NotificationContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Building2, MapPin, ChevronRight } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  location: string | null;
  created_at: string;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
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

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {t('navigation.branches', 'Branches')}
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map((branch) => (
          <Card key={branch.id} className="flex flex-col">
            <CardContent className="p-5 flex flex-col flex-1">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-gray-900 truncate">{branch.name}</h2>
                  {branch.location ? (
                    <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{branch.location}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">{t('branches.noLocation', 'No location')}</p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-auto w-full justify-between"
                onClick={() => navigate(`/${tenantSlug}/admin/branches/${branch.id}`)}
              >
                {t('branches.seeMore', 'See More')}
                <ChevronRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {branches.length === 0 && (
        <p className="text-gray-500 text-center py-8">{t('branches.noBranches', 'No branches yet.')}</p>
      )}
    </div>
  );
}
