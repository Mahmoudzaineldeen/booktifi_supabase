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

  useEffect(() => {
    if (tenantId) {
      loadFeatures();
    }
  }, [tenantId]);

  const loadFeatures = async () => {
    if (!tenantId) return;

    try {
      const { data, error } = await db
        .from('tenant_features')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;

      // Default to all features enabled if no data
      setFeatures(data ? { ...data, scheduling_mode: (data as any).scheduling_mode ?? 'service_slot_based' } : {
        employees_enabled: true,
        employee_assignment_mode: 'both',
        packages_enabled: true,
        landing_page_enabled: true,
        scheduling_mode: 'service_slot_based',
      });
    } catch (error) {
      console.error('Error loading tenant features:', error);
      // Default to all features enabled if there's an error
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

  return { features, loading, reload: loadFeatures };
}
