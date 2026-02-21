import { Outlet, useParams } from 'react-router-dom';
import { TenantLayout } from './TenantLayout';

/**
 * Single layout wrapper for all tenant admin routes. Renders once and keeps
 * mounting when navigating between admin pages, so sidebar state (e.g. tenant
 * features) does not reset and main content does not disappear.
 */
export function AdminLayout() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  return (
    <TenantLayout tenantSlug={tenantSlug || ''}>
      <Outlet />
    </TenantLayout>
  );
}
