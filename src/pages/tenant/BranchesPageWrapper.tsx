import React from 'react';
import { TenantLayout } from '../../components/layout/TenantLayout';
import { BranchesPage } from './BranchesPage';
import { ErrorBoundary } from '../../components/ErrorBoundary';

export function BranchesPageWrapper() {
  return (
    <TenantLayout>
      <ErrorBoundary>
        <BranchesPage />
      </ErrorBoundary>
    </TenantLayout>
  );
}
