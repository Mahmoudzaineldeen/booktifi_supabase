import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { showNotification } from '../../contexts/NotificationContext';
import { LanguageToggle } from './LanguageToggle';
import { Calendar, Users, Briefcase, Settings, LogOut, LayoutDashboard, Globe, Package, Gift, Menu, X, UserCheck, ClipboardList, UserCircle, Clock, Building2, Wrench, UserX } from 'lucide-react';
import { Button } from '../ui/Button';

interface TenantLayoutProps {
  children: React.ReactNode;
  tenantSlug?: string;
}

export function TenantLayout({ children, tenantSlug: propTenantSlug }: TenantLayoutProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ tenantSlug?: string }>();
  const { userProfile, tenant, signOut, isImpersonating, exitImpersonation } = useAuth();
  const { features } = useTenantFeatures(tenant?.id);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Only show feature-dependent items when we have resolved features (avoids flash on load and flicker on navigate/refetch)
  const hasFeatures = features !== null;

  // Get tenantSlug from props, URL params, or tenant slug
  const tenantSlug = propTenantSlug || params.tenantSlug || tenant?.slug || '';

  // Coordinator can only access reception page and visitors; redirect if they hit any other admin route
  useEffect(() => {
    if (userProfile?.role === 'coordinator' && tenantSlug && location.pathname.startsWith(`/${tenantSlug}/admin`)) {
      if (!location.pathname.startsWith(`/${tenantSlug}/admin/visitors`)) {
        navigate(`/${tenantSlug}/reception`, { replace: true });
      }
    }
  }, [userProfile?.role, tenantSlug, location.pathname, navigate]);

  // Determine restricted roles
  const isRestrictedRole = userProfile?.role === 'customer_admin' || userProfile?.role === 'admin_user';
  const isAdminUser = userProfile?.role === 'admin_user';
  const isCustomerAdmin = userProfile?.role === 'customer_admin';

  const baseNavigation = [
    {
      name: t('navigation.home'),
      href: `/${tenantSlug}/admin`,
      icon: LayoutDashboard,
      current: location.pathname === `/${tenantSlug}/admin`,
      visible: !isAdminUser, // customer_admin can access, but admin_user cannot
    },
    {
      name: t('navigation.services'),
      href: `/${tenantSlug}/admin/services`,
      icon: Briefcase,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/services`),
      visible: !isAdminUser, // customer_admin can access, but admin_user cannot
    },
    {
      name: t('navigation.packages'),
      href: `/${tenantSlug}/admin/packages`,
      icon: Package,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/packages`),
      visible: hasFeatures && (features?.packages_enabled ?? true) && !isAdminUser,
    },
    {
      name: t('navigation.branches', 'Branches'),
      href: `/${tenantSlug}/admin/branches`,
      icon: Building2,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/branches`),
      visible: userProfile?.role === 'tenant_admin' || userProfile?.role === 'solution_owner',
    },
    {
      name: t('navigation.packageSubscribers', 'Package Subscribers'),
      href: `/${tenantSlug}/admin/package-subscribers`,
      icon: UserCheck,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/package-subscribers`),
      visible: hasFeatures && (features?.packages_enabled ?? true) &&
               (userProfile?.role === 'tenant_admin' || userProfile?.role === 'admin_user' || userProfile?.role === 'customer_admin'),
    },
    {
      name: t('navigation.offers'),
      href: `/${tenantSlug}/admin/offers`,
      icon: Gift,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/offers`),
      visible: !isAdminUser, // customer_admin can access, but admin_user cannot
    },
    {
      name: t('navigation.bookings'),
      href: `/${tenantSlug}/admin/bookings`,
      icon: Calendar,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/bookings`),
      visible: true, // All roles can see bookings
    },
    {
      name: t('navigation.visitors', 'Visitors'),
      href: (userProfile?.role === 'receptionist' || userProfile?.role === 'coordinator')
        ? `/${tenantSlug}/reception/visitors`
        : `/${tenantSlug}/admin/visitors`,
      icon: UserCircle,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/visitors`) || location.pathname.startsWith(`/${tenantSlug}/reception/visitors`),
      visible: ['receptionist', 'coordinator', 'tenant_admin', 'customer_admin', 'admin_user'].includes(userProfile?.role || ''),
    },
    {
      name: t('navigation.reception', 'Reception'),
      href: `/${tenantSlug}/reception`,
      icon: ClipboardList,
      current: location.pathname === `/${tenantSlug}/reception`,
      visible: userProfile?.role === 'receptionist', // Admin has native flows in Admin panel; receptionist uses Reception page
    },
    {
      name: t('navigation.employees'),
      href: `/${tenantSlug}/admin/employees`,
      icon: Users,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/employees`),
      visible: hasFeatures && (features?.employees_enabled ?? true) && (userProfile?.role === 'tenant_admin' || userProfile?.role === 'customer_admin' || userProfile?.role === 'admin_user'),
    },
    {
      name: t('navigation.employeeShifts', 'Employee Shifts & Assignments'),
      href: `/${tenantSlug}/admin/employee-shifts`,
      icon: Clock,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/employee-shifts`),
      visible: hasFeatures && (features?.scheduling_mode === 'employee_based') && (userProfile?.role === 'tenant_admin' || userProfile?.role === 'customer_admin' || userProfile?.role === 'admin_user'),
    },
    {
      name: t('navigation.landingPage'),
      href: `/${tenantSlug}/admin/landing`,
      icon: Globe,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/landing`),
      visible: hasFeatures && (features?.landing_page_enabled ?? true) && !isRestrictedRole,
    },
    {
      name: t('navigation.settings'),
      href: `/${tenantSlug}/admin/settings`,
      icon: Settings,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/settings`),
      visible: !isRestrictedRole, // Both restricted roles cannot access
    },
    {
      name: t('navigation.assignFixingTicket', 'Assign Fixing Ticket'),
      href: `/${tenantSlug}/admin/assign-fixing-ticket`,
      icon: Wrench,
      current: location.pathname.startsWith(`/${tenantSlug}/admin/assign-fixing-ticket`),
      // Visible to all roles except super admin (Solution Owner) and customers
      visible: !!userProfile?.role &&
        userProfile.role !== 'solution_owner' &&
        !['customer', 'customer_admin'].includes(userProfile.role),
    },
  ];

  const navigation = baseNavigation.filter((item) => item.visible);

  // Coordinator must not see admin layout (except visitors); redirect is done in useEffect; avoid flashing content
  if (userProfile?.role === 'coordinator' && tenantSlug && location.pathname.startsWith(`/${tenantSlug}/admin`) && !location.pathname.startsWith(`/${tenantSlug}/admin/visitors`)) {
    return null;
  }

  async function handleLogout() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-30">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-6 h-6 text-blue-600" />
            <h1 className="text-lg font-bold text-gray-900">
              {tenant?.name || 'Bookati'}
            </h1>
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="flex h-screen pt-16 lg:pt-0">
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 bg-white border-r border-gray-200 flex flex-col
          transform transition-transform duration-300 ease-in-out
          lg:transform-none
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="hidden lg:block p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <Calendar className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {tenant?.name || 'Bookati'}
                </h1>
                <p className="text-xs text-gray-500">{userProfile?.full_name}</p>
              </div>
            </div>
          </div>

          {/* Mobile Header in Sidebar */}
          <div className="lg:hidden p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calendar className="w-8 h-8 text-blue-600" />
                <div>
                  <h1 className="text-xl font-bold text-gray-900">
                    {tenant?.name || 'Bookati'}
                  </h1>
                  <p className="text-xs text-gray-500">{userProfile?.full_name}</p>
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                    item.current
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {item.name}
                </Link>
              );
            })}
            
            {/* Preview Mode Section - Hidden for restricted roles (customer_admin and admin_user) */}
            {!isRestrictedRole && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {t('navigation.previewMode', 'Preview Mode')}
                </p>
                <Link
                  to={`/${tenantSlug}/book`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    if (tenant?.maintenance_mode) {
                      e.preventDefault();
                      showNotification('warning', t('navigation.customerPageDisabledMaintenance'));
                    }
                    setMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors text-gray-700 hover:bg-gray-50"
                >
                  <Calendar className="w-5 h-5" />
                  <span>{t('navigation.viewBookingPage', 'View Booking Page')}</span>
                </Link>
                <Link
                  to={`/${tenantSlug}/customer`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    if (tenant?.maintenance_mode) {
                      e.preventDefault();
                      showNotification('warning', t('navigation.customerPageDisabledMaintenance'));
                    }
                    setMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors text-gray-700 hover:bg-gray-50"
                >
                  <Users className="w-5 h-5" />
                  <span>{t('navigation.viewCustomerPage', 'View Customer Page')}</span>
                </Link>
              </div>
            )}
          </nav>

          <div className="p-4 border-t border-gray-200 space-y-3">
            {isImpersonating && (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => exitImpersonation().then(() => navigate('/solution-admin'))}
                icon={<UserX className="w-4 h-4" />}
                className="bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
              >
                {t('support.exitImpersonation', 'Exit Impersonation')}
              </Button>
            )}
            <div className="flex justify-center">
              <LanguageToggle />
            </div>
            <Button
              variant="secondary"
              fullWidth
              onClick={handleLogout}
              icon={<LogOut className="w-4 h-4" />}
            >
              {t('auth.logout')}
            </Button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto flex flex-col">
          {isImpersonating && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between shrink-0">
              <span className="text-sm text-amber-800 font-medium">
                {t('support.impersonationBanner', "You're viewing as this employee. Exit to return to Solution Owner.")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => exitImpersonation().then(() => navigate('/solution-admin'))}
                className="text-amber-800 hover:bg-amber-100"
              >
                <UserX className="w-4 h-4 mr-1" />
                {t('support.exitImpersonation', 'Exit Impersonation')}
              </Button>
            </div>
          )}
          <div className="flex-1">{children}</div>
        </main>
      </div>
    </div>
  );
}
