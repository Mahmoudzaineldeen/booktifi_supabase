import { useParams, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { LandingPageBuilder } from './LandingPageBuilder';

export function LandingPageBuilderWrapper() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { userProfile, loading } = useAuth();
  const { features, loading: featuresLoading } = useTenantFeatures(userProfile?.tenant_id);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Check session in localStorage before redirecting
  if (!userProfile) {
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
  if (userProfile.role === 'solution_owner') {
    return <Navigate to="/solution-admin" replace />;
  }

  // Block customer_admin and admin_user from landing page
  if (userProfile.role === 'customer_admin' || userProfile.role === 'admin_user') {
    return <Navigate to={`/${tenantSlug}/admin/bookings`} replace />;
  }

  if (userProfile.role !== 'tenant_admin') {
    return <Navigate to="/login" replace />;
  }

  if (!featuresLoading && features?.landing_page_enabled === false) {
    return <Navigate to={tenantSlug ? `/${tenantSlug}/admin` : '/login'} replace />;
  }

  return <LandingPageBuilder />;
}
