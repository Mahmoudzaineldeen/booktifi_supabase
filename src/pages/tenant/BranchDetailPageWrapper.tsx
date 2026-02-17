import React from 'react';
import { TenantLayout } from '../../components/layout/TenantLayout';
import { BranchDetailPage } from './BranchDetailPage';
import { ErrorBoundary } from '../../components/ErrorBoundary';

export function BranchDetailPageWrapper() {
  return (
    <TenantLayout>
      <ErrorBoundary>
        <BranchDetailPage />
      </ErrorBoundary>
    </TenantLayout>
  );
}
