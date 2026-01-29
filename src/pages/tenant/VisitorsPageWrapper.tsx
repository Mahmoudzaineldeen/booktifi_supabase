import React from 'react';
import { useParams } from 'react-router-dom';
import { TenantLayout } from '../../components/layout/TenantLayout';
import { VisitorsPage } from './VisitorsPage';

export function VisitorsPageWrapper() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  return (
    <TenantLayout tenantSlug={tenantSlug || ''}>
      <VisitorsPage />
    </TenantLayout>
  );
}
