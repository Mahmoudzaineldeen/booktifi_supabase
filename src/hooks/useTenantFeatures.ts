import { useEffect, useState } from 'react';
import { db } from '../lib/db';

export interface TenantFeatures {
  employees_enabled: boolean;
  employee_assignment_mode: 'automatic' | 'manual' | 'both';
  packages_enabled: boolean;
  landing_page_enabled: boolean;
  /** Global scheduling mode: employee_based = availability from employee shifts only; service_slot_based = service-defined slots */
  scheduling_mode: 'employee_based' | 'service_slot_based';
}

export function useTenantFeatures(tenantId: string | undefined) {
  const [features, setFeatures] = useState<TenantFeatures | null>(null);
  const [loading, setLoading] = useState(true);

  const loadFeatures = async (options?: { showLoading?: boolean }) => {
    if (!tenantId) return;

    const showLoading = options?.showLoading !== false;
    if (showLoading) setLoading(true);

    try {
      const { data, error } = await db
        .from('tenant_features')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;

      setFeatures(data ? {
        ...data,
        scheduling_mode: (data as any).scheduling_mode ?? 'service_slot_based',
        employee_assignment_mode: (data as any).employee_assignment_mode ?? 'both',
      } : {
        employees_enabled: true,
        employee_assignment_mode: 'both',
        packages_enabled: true,
        landing_page_enabled: true,
        scheduling_mode: 'service_slot_based',
      });
    } catch (error) {
      console.error('Error loading tenant features:', error);
      setFeatures({
        employees_enabled: true,
        employee_assignment_mode: 'both',
        packages_enabled: true,
        landing_page_enabled: true,
        scheduling_mode: 'service_slot_based',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) {
      setFeatures(null);
      loadFeatures({ showLoading: true });
    } else {
      setFeatures(null);
      setLoading(false);
    }
  }, [tenantId]);

  // Refetch when user returns to the tab (no loading state so sidebar does not flicker)
  useEffect(() => {
    if (!tenantId) return;
    const onFocus = () => loadFeatures({ showLoading: false });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [tenantId]);

  return { features, loading, reload: () => loadFeatures({ showLoading: false }) };
}
