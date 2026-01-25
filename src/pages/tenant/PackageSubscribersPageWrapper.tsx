import { useEffect } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { TenantLayout } from '../../components/layout/TenantLayout';
import { PackageSubscribersPage } from './PackageSubscribersPage';

export function PackageSubscribersPageWrapper() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { userProfile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Only tenant_admin can access package subscribers page
    if (!authLoading && userProfile) {
      if (userProfile.role !== 'tenant_admin') {
        // Redirect to appropriate page based on role
        if (userProfile.role === 'customer_admin' || userProfile.role === 'admin_user') {
          navigate(`/${tenantSlug}/admin/bookings`);
        } else if (userProfile.role === 'cashier' || userProfile.role === 'receptionist') {
          navigate(`/${tenantSlug}/reception`);
        } else {
          navigate(`/${tenantSlug}/admin`);
        }
      }
    }
  }, [userProfile, authLoading, tenantSlug, navigate]);

  // Don't render if user is not tenant_admin
  if (!authLoading && userProfile && userProfile.role !== 'tenant_admin') {
    return null;
  }

  // Check session in localStorage before redirecting
  if (!authLoading && !userProfile) {
    const sessionStr = localStorage.getItem('auth_session');
    const token = localStorage.getItem('auth_token');
    
    if (sessionStr || token) {
      // Session exists, wait for profile to load
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      );
    }
    
    // No session, redirect to login
    return <Navigate to="/login" replace />;
  }

  // SECURITY: Solution Owner should access /solution-admin, not tenant routes
  if (!authLoading && userProfile && userProfile.role === 'solution_owner') {
    return <Navigate to="/solution-admin" replace />;
  }

  return (
    <TenantLayout tenantSlug={tenantSlug || ''}>
      <PackageSubscribersPage />
    </TenantLayout>
  );
}
