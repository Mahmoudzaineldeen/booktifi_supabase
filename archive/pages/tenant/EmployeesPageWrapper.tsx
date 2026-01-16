import React from 'react';
import { useParams } from 'react-router-dom';
import { TenantLayout } from '../../components/layout/TenantLayout';
import { EmployeesPage } from './EmployeesPage';

export function EmployeesPageWrapper() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  return (
    <TenantLayout tenantSlug={tenantSlug || ''}>
      <EmployeesPage />
    </TenantLayout>
  );
}
