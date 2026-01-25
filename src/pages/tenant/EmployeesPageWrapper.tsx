import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { TenantLayout } from '../../components/layout/TenantLayout';
import { EmployeesPage } from './EmployeesPage';

export function EmployeesPageWrapper() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { userProfile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Allow tenant_admin, customer_admin, and admin_user to access employees page
    if (!authLoading && userProfile) {
      const allowedRoles = ['tenant_admin', 'customer_admin', 'admin_user'];
      if (!allowedRoles.includes(userProfile.role)) {
        // Redirect cashier/receptionist to reception page
        if (userProfile.role === 'cashier' || userProfile.role === 'receptionist') {
          navigate(`/${tenantSlug}/reception`);
        } else {
          // Other roles go to admin dashboard
          navigate(`/${tenantSlug}/admin`);
        }
      }
    }
  }, [userProfile, authLoading, tenantSlug, navigate]);

  // Don't render if user is not in allowed roles
  const allowedRoles = ['tenant_admin', 'customer_admin', 'admin_user'];
  if (!authLoading && userProfile && !allowedRoles.includes(userProfile.role)) {
    return null;
  }

  return (
    <TenantLayout tenantSlug={tenantSlug || ''}>
      <EmployeesPage />
    </TenantLayout>
  );
}

