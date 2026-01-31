import React from 'react';
import { useParams } from 'react-router-dom';
import { TenantLayout } from '../../components/layout/TenantLayout';
import { EmployeeShiftsPage } from './EmployeeShiftsPage';

export function EmployeeShiftsPageWrapper() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  return (
    <TenantLayout tenantSlug={tenantSlug || ''}>
      <EmployeeShiftsPage />
    </TenantLayout>
  );
}
