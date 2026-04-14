import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { showNotification } from '../../contexts/NotificationContext';
import { LanguageToggle } from './LanguageToggle';
import {
  Calendar,
  Users,
  Briefcase,
  Settings,
  LogOut,
  LayoutDashboard,
  Globe,
  Package,
  Gift,
  Menu,
  X,
  UserCheck,
  Clock,
  Building2,
  Wrench,
  UserX,
  Shield,
  BarChart3,
  ChevronDown,
  Tag,
  PanelsTopLeft,
} from 'lucide-react';
import { Button } from '../ui/Button';

function routeMatches(location: { pathname: string; hash: string }, to: string): boolean {
  const [pathRaw, frag] = to.split('#');
  const path = pathRaw.replace(/\/$/, '') || '';
  const pathOk = location.pathname === path || (path ? location.pathname.startsWith(`${path}/`) : false);
  if (!frag) return pathOk;
  return pathOk && location.hash === `#${frag}`;
}

type NavSubDef = { key: string; label: string; to: string; visible: boolean };

function NavDropdownGroup({
  location,
  baseTo,
  baseLabel,
  Icon,
  expanded,
  setExpanded,
  subItems,
  onMobileClose,
}: {
  location: ReturnType<typeof useLocation>;
  baseTo: string;
  baseLabel: string;
  Icon: React.ComponentType<{ className?: string }>;
  expanded: boolean;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  subItems: NavSubDef[];
  onMobileClose: () => void;
}) {
  const subs = subItems.filter((s) => s.visible);
  if (subs.length === 0) return null;

  const isMatch = (to: string) => routeMatches(location, to);
  const groupActive = isMatch(baseTo) || subs.some((s) => isMatch(s.to));

  if (subs.length === 1) {
    const only = subs[0];
    const active = isMatch(only.to);
    return (
      <Link
        to={only.to}
        onClick={() => onMobileClose()}
        className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
          active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <Icon className="w-5 h-5 shrink-0" />
        <span className="truncate">{only.label}</span>
      </Link>
    );
  }

  return (
    <div className="space-y-0.5">
      <div
        className={`flex w-full items-stretch rounded-lg overflow-hidden ${
          groupActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <Link
          to={baseTo}
          onClick={() => {
            setExpanded(true);
            onMobileClose();
          }}
          className={`flex flex-1 items-center gap-3 px-4 py-3 text-sm font-medium min-w-0 ${
            groupActive ? '' : 'hover:bg-gray-50/80'
          }`}
        >
          <Icon className="w-5 h-5 shrink-0" />
          <span className="truncate">{baseLabel}</span>
        </Link>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.preventDefault();
            setExpanded((v) => !v);
          }}
          className={`px-2 flex items-center shrink-0 border-l border-blue-100/80 ${
            groupActive ? 'border-blue-200/60' : 'border-gray-200'
          } hover:bg-black/5`}
        >
          <ChevronDown
            className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
      </div>
      {expanded && (
        <div className="ml-2 pl-4 border-l-2 border-blue-100 space-y-0.5 py-1">
          {subs.map((sub) => {
            const subActive = isMatch(sub.to);
            return (
              <Link
                key={sub.key}
                to={sub.to}
                onClick={() => onMobileClose()}
                className={`block px-3 py-2 text-sm rounded-md transition-colors ${
                  subActive ? 'bg-blue-50 text-blue-800 font-medium' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {sub.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TenantLayoutProps {
  children: React.ReactNode;
  tenantSlug?: string;
}

export function TenantLayout({ children, tenantSlug: propTenantSlug }: TenantLayoutProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ tenantSlug?: string }>();
  const { userProfile, tenant, signOut, isImpersonating, exitImpersonation, hasPermission } = useAuth();
  const { features } = useTenantFeatures(tenant?.id);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Only show feature-dependent items when we have resolved features (avoids flash on load and flicker on navigate/refetch)
  const hasFeatures = features !== null;

  // Get tenantSlug from props, URL params, or tenant slug
  const tenantSlug = propTenantSlug || params.tenantSlug || tenant?.slug || '';

  const reportsBasePath = tenantSlug ? `/${tenantSlug}/admin/reports` : '';
  const isReportsRoute = Boolean(reportsBasePath && location.pathname.startsWith(reportsBasePath));
  const [reportsExpanded, setReportsExpanded] = useState(isReportsRoute);

  useEffect(() => {
    if (isReportsRoute) setReportsExpanded(true);
  }, [isReportsRoute]);

  // Coordinator: admin limited to Visitors + Reports; anything else → reception
  useEffect(() => {
    if (userProfile?.role === 'coordinator' && tenantSlug && location.pathname.startsWith(`/${tenantSlug}/admin`)) {
      const ok =
        location.pathname.startsWith(`/${tenantSlug}/admin/visitors`) ||
        location.pathname.startsWith(`/${tenantSlug}/admin/reports`);
      if (!ok) navigate(`/${tenantSlug}/reception`, { replace: true });
    }
  }, [userProfile?.role, tenantSlug, location.pathname, navigate]);

  // When user has role_id (assigned role), use only permissions for menu visibility so category changes (admin ↔ employee) take effect without re-login
  const hasAssignedRole = Boolean(userProfile?.role_id);
  const isRestrictedRole = hasAssignedRole ? false : (userProfile?.role === 'customer_admin' || userProfile?.role === 'admin_user');
  const isAdminUser = hasAssignedRole ? false : (userProfile?.role === 'admin_user');
  const isCustomerAdmin = hasAssignedRole ? false : (userProfile?.role === 'customer_admin');

  // Permission-based visibility: custom roles see only what their permissions allow; built-in roles get permissions from role_permissions (seeded)
  const canAccessBookings = hasPermission('create_booking') || hasPermission('edit_booking') || hasPermission('cancel_booking') || hasPermission('manage_bookings') || hasPermission('view_schedules');
  const canAccessVisitors = hasPermission('register_visitors') || hasPermission('view_schedules') || hasPermission('manage_bookings');

  const adminBase = tenantSlug ? `/${tenantSlug}/admin` : '';
  const settingsBase = adminBase ? `${adminBase}/settings` : '';

  const dashboardHomeVisible = hasAssignedRole ? true : !isAdminUser;
  const customizeVisible = hasPermission('customize_dashboard');
  const servicesVisible = hasPermission('manage_services');
  const tagsVisible =
    hasPermission('manage_tags') ||
    hasPermission('view_tags') ||
    hasPermission('assign_tags_to_services');
  const packagesVisible = hasFeatures && (features?.packages_enabled ?? true) && hasPermission('manage_packages');
  const packageSubscribersVisible =
    hasFeatures &&
    (features?.packages_enabled ?? true) &&
    (hasPermission('sell_packages') || hasPermission('manage_packages'));
  const branchesVisible = hasPermission('manage_branches');
  const offersVisible = hasAssignedRole ? true : !isAdminUser;
  const bookingsVisible = canAccessBookings;
  const employeesVisible = hasFeatures && (features?.employees_enabled ?? true) && hasPermission('manage_employees');
  const rolesVisible = hasPermission('manage_roles');
  const shiftsVisible =
    hasFeatures && features?.scheduling_mode === 'employee_based' && hasPermission('manage_shifts');
  const landingEditorVisible = hasFeatures && (features?.landing_page_enabled ?? true) && !isRestrictedRole;
  const settingsVisible = !isRestrictedRole && hasPermission('edit_system_settings');
  const assignFixingVisible =
    !!userProfile?.role &&
    userProfile.role !== 'solution_owner' &&
    !['customer', 'customer_admin'].includes(userProfile.role);
  const isDashboardRoute =
    !!adminBase &&
    (location.pathname === adminBase || location.pathname.startsWith(`${adminBase}/dashboard-customize`));
  const [dashboardExpanded, setDashboardExpanded] = useState(isDashboardRoute);
  useEffect(() => {
    if (isDashboardRoute) setDashboardExpanded(true);
  }, [isDashboardRoute]);

  const isServicesRoute =
    !!adminBase &&
    (location.pathname.startsWith(`${adminBase}/services`) ||
      location.pathname.startsWith(`${adminBase}/offers`) ||
      location.pathname.startsWith(`${adminBase}/tags`));
  const [servicesExpanded, setServicesExpanded] = useState(isServicesRoute);
  useEffect(() => {
    if (isServicesRoute) setServicesExpanded(true);
  }, [isServicesRoute]);

  const isPackagesRoute =
    !!adminBase &&
    (location.pathname.startsWith(`${adminBase}/packages`) ||
      location.pathname.startsWith(`${adminBase}/package-subscribers`));
  const [packagesExpanded, setPackagesExpanded] = useState(isPackagesRoute);
  useEffect(() => {
    if (isPackagesRoute) setPackagesExpanded(true);
  }, [isPackagesRoute]);

  const isEmployeesRoute =
    !!adminBase &&
    (location.pathname.startsWith(`${adminBase}/employees`) ||
      location.pathname.startsWith(`${adminBase}/employee-shifts`) ||
      location.pathname.startsWith(`${adminBase}/roles`));
  const [employeesExpanded, setEmployeesExpanded] = useState(isEmployeesRoute);
  useEffect(() => {
    if (isEmployeesRoute) setEmployeesExpanded(true);
  }, [isEmployeesRoute]);

  const isLandingRoute = !!adminBase && location.pathname.startsWith(`${adminBase}/landing`);
  const [landingExpanded, setLandingExpanded] = useState(isLandingRoute);
  useEffect(() => {
    if (isLandingRoute) setLandingExpanded(true);
  }, [isLandingRoute]);

  const isSettingsRoute = !!adminBase && location.pathname.startsWith(`${adminBase}/settings`);
  const isAssignFixingRoute = !!adminBase && location.pathname.startsWith(`${adminBase}/assign-fixing-ticket`);
  const [settingsExpanded, setSettingsExpanded] = useState(isSettingsRoute || isAssignFixingRoute);
  useEffect(() => {
    if (isSettingsRoute || isAssignFixingRoute) setSettingsExpanded(true);
  }, [isSettingsRoute, isAssignFixingRoute]);

  const employeesBase =
    employeesVisible || !adminBase
      ? `${adminBase}/employees`
      : shiftsVisible
        ? `${adminBase}/employee-shifts`
        : `${adminBase}/roles`;

  const landingNavBase = adminBase ? `${adminBase}/landing` : '';

  const showReportsNav = (canAccessBookings || canAccessVisitors) && !!tenantSlug;
  const reportSubItems = [
    { name: t('reports.nav.visitors', 'Visitors'), href: `${reportsBasePath}/visitors` },
    { name: t('reports.nav.transactions', 'Transactions'), href: `${reportsBasePath}/transactions` },
    { name: t('reports.nav.bookings', 'Bookings'), href: `${reportsBasePath}/bookings` },
  ];

  // Coordinator: hide admin shell while redirecting (except visitors + reports)
  if (
    userProfile?.role === 'coordinator' &&
    tenantSlug &&
    location.pathname.startsWith(`/${tenantSlug}/admin`) &&
    !location.pathname.startsWith(`/${tenantSlug}/admin/visitors`) &&
    !location.pathname.startsWith(`/${tenantSlug}/admin/reports`)
  ) {
    return null;
  }

  async function handleLogout() {
    await signOut();
    navigate('/login');
  }

  const tenantLogoUrl = typeof tenant?.logo_url === 'string' ? tenant.logo_url : '';
  const BrandMark = ({ sizeClass }: { sizeClass: string }) => (
    tenantLogoUrl ? (
      <img
        src={tenantLogoUrl}
        alt={tenant?.name || 'Tenant logo'}
        className={`${sizeClass} object-contain`}
      />
    ) : (
      <Calendar className={`${sizeClass} text-blue-600`} />
    )
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-30">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <BrandMark sizeClass="h-7 w-auto max-w-[7.5rem]" />
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
              <BrandMark sizeClass="h-9 w-auto max-w-[9rem]" />
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
                <BrandMark sizeClass="h-9 w-auto max-w-[9rem]" />
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
            {adminBase && (dashboardHomeVisible || customizeVisible) && (
              <NavDropdownGroup
                location={location}
                baseTo={adminBase}
                baseLabel={t('navigation.groupDashboard', 'Dashboard')}
                Icon={LayoutDashboard}
                expanded={dashboardExpanded}
                setExpanded={setDashboardExpanded}
                onMobileClose={() => setMobileMenuOpen(false)}
                subItems={[
                  {
                    key: 'dash-home',
                    label: t('navigation.home'),
                    to: adminBase,
                    visible: dashboardHomeVisible,
                  },
                  {
                    key: 'dash-custom',
                    label: t('navigation.customizeDashboard', 'Customize Dashboard'),
                    to: `${adminBase}/dashboard-customize`,
                    visible: customizeVisible,
                  },
                ]}
              />
            )}

            {adminBase && (servicesVisible || offersVisible || tagsVisible) && (
              <NavDropdownGroup
                location={location}
                baseTo={`${adminBase}/services`}
                baseLabel={t('navigation.groupServicesAndOffers', 'Services & Offers')}
                Icon={Briefcase}
                expanded={servicesExpanded}
                setExpanded={setServicesExpanded}
                onMobileClose={() => setMobileMenuOpen(false)}
                subItems={[
                  {
                    key: 'svc',
                    label: t('navigation.services'),
                    to: `${adminBase}/services`,
                    visible: servicesVisible,
                  },
                  {
                    key: 'off',
                    label: t('navigation.offers'),
                    to: `${adminBase}/offers`,
                    visible: offersVisible,
                  },
                  {
                    key: 'tag',
                    label: t('navigation.pricingTags', 'Pricing tags'),
                    to: `${adminBase}/tags`,
                    visible: tagsVisible,
                  },
                ]}
              />
            )}

            {adminBase && (packagesVisible || packageSubscribersVisible) && (
              <NavDropdownGroup
                location={location}
                baseTo={`${adminBase}/packages`}
                baseLabel={t('navigation.groupPackages', 'Packages')}
                Icon={Package}
                expanded={packagesExpanded}
                setExpanded={setPackagesExpanded}
                onMobileClose={() => setMobileMenuOpen(false)}
                subItems={[
                  {
                    key: 'pkg',
                    label: t('navigation.packages'),
                    to: `${adminBase}/packages`,
                    visible: packagesVisible,
                  },
                  {
                    key: 'sub',
                    label: t('navigation.packageSubscribers', 'Package Subscribers'),
                    to: `${adminBase}/package-subscribers`,
                    visible: packageSubscribersVisible,
                  },
                ]}
              />
            )}

            {adminBase && branchesVisible && (
              <Link
                to={`${adminBase}/branches`}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                  location.pathname.startsWith(`${adminBase}/branches`)
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Building2 className="w-5 h-5 shrink-0" />
                {t('navigation.branches', 'Branches')}
              </Link>
            )}

            {adminBase && bookingsVisible && (
              <Link
                to={`${adminBase}/bookings`}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                  location.pathname.startsWith(`${adminBase}/bookings`)
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Calendar className="w-5 h-5 shrink-0" />
                {t('navigation.bookings')}
              </Link>
            )}

            {adminBase && (employeesVisible || shiftsVisible || rolesVisible) && (
              <NavDropdownGroup
                location={location}
                baseTo={employeesBase}
                baseLabel={t('navigation.groupEmployees', 'Employees')}
                Icon={Users}
                expanded={employeesExpanded}
                setExpanded={setEmployeesExpanded}
                onMobileClose={() => setMobileMenuOpen(false)}
                subItems={[
                  {
                    key: 'emp',
                    label: t('navigation.employees'),
                    to: `${adminBase}/employees`,
                    visible: employeesVisible,
                  },
                  {
                    key: 'shf',
                    label: t('navigation.employeeShifts', 'Employee Shifts & Assignments'),
                    to: `${adminBase}/employee-shifts`,
                    visible: shiftsVisible,
                  },
                  {
                    key: 'rol',
                    label: t('navigation.roles', 'Role Management'),
                    to: `${adminBase}/roles`,
                    visible: rolesVisible,
                  },
                ]}
              />
            )}

            {adminBase && landingEditorVisible && (
              <NavDropdownGroup
                location={location}
                baseTo={landingNavBase}
                baseLabel={t('navigation.groupLanding', 'Website Builder')}
                Icon={Globe}
                expanded={landingExpanded}
                setExpanded={setLandingExpanded}
                onMobileClose={() => setMobileMenuOpen(false)}
                subItems={[
                  {
                    key: 'lp',
                    label: t('navigation.landingPage'),
                    to: `${adminBase}/landing`,
                    visible: true,
                  },
                ]}
              />
            )}

            {adminBase && settingsVisible && (() => {
              const settingsSubNavItems = [
                {
                  key: 'ac',
                  label: t('navigation.accountSettings', 'Account settings'),
                  href: `${settingsBase}/account`,
                  visible: true,
                },
                {
                  key: 'am',
                  label: t('navigation.appManager', 'App manager'),
                  href: `${settingsBase}/app-manager`,
                  visible: true,
                },
                {
                  key: 'sch',
                  label: t('navigation.schedulingNav', 'Scheduling'),
                  href: `${settingsBase}/scheduling`,
                  visible: true,
                },
                {
                  key: 'lg',
                  label: t('navigation.logosAndBranding', 'Logos & branding'),
                  href: `${settingsBase}/logos`,
                  visible: true,
                },
                {
                  key: 'fix',
                  label: t('navigation.assignFixingTicket', 'Assign Fixing Ticket'),
                  href: `${adminBase}/assign-fixing-ticket`,
                  visible: assignFixingVisible,
                },
              ].filter((i) => i.visible);
              const settingsGroupActive = isSettingsRoute || isAssignFixingRoute;
              return (
                <div className="space-y-0.5">
                  <div
                    className={`flex w-full items-stretch rounded-lg overflow-hidden ${
                      settingsGroupActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Link
                      to={`${settingsBase}/account`}
                      onClick={() => {
                        setSettingsExpanded(true);
                        setMobileMenuOpen(false);
                      }}
                      className={`flex flex-1 items-center gap-3 px-4 py-3 text-sm font-medium min-w-0 ${
                        settingsGroupActive ? '' : 'hover:bg-gray-50/80'
                      }`}
                    >
                      <Settings className="w-5 h-5 shrink-0" />
                      <span className="truncate">{t('navigation.groupSettings', 'Settings')}</span>
                    </Link>
                    <button
                      type="button"
                      aria-expanded={settingsExpanded}
                      aria-label={settingsExpanded ? t('common.collapse', 'Collapse') : t('common.expand', 'Expand')}
                      onClick={(e) => {
                        e.preventDefault();
                        setSettingsExpanded((v) => !v);
                      }}
                      className={`px-2 flex items-center shrink-0 border-l border-blue-100/80 ${
                        settingsGroupActive ? 'border-blue-200/60' : 'border-gray-200'
                      } hover:bg-black/5`}
                    >
                      <ChevronDown
                        className={`w-4 h-4 text-gray-500 transition-transform ${settingsExpanded ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </button>
                  </div>
                  {settingsExpanded && (
                    <div className="ml-2 pl-4 border-l-2 border-blue-100 space-y-0.5 py-1">
                      {settingsSubNavItems.map((sub) => {
                        const subActive =
                          location.pathname === sub.href || location.pathname.startsWith(`${sub.href}/`);
                        return (
                          <Link
                            key={sub.key}
                            to={sub.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`block px-3 py-2 text-sm rounded-md transition-colors ${
                              subActive ? 'bg-blue-50 text-blue-800 font-medium' : 'text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {sub.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {showReportsNav && (
              <div className="space-y-0.5">
                <div
                  className={`flex w-full items-stretch rounded-lg overflow-hidden ${
                    isReportsRoute ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Link
                    to={reportsBasePath}
                    onClick={() => {
                      setReportsExpanded(true);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex flex-1 items-center gap-3 px-4 py-3 text-sm font-medium min-w-0 ${
                      isReportsRoute ? '' : 'hover:bg-gray-50/80'
                    }`}
                  >
                    <BarChart3 className="w-5 h-5 shrink-0" />
                    <span className="truncate">{t('navigation.reports', 'Reports')}</span>
                  </Link>
                  <button
                    type="button"
                    aria-expanded={reportsExpanded}
                    aria-label={reportsExpanded ? t('common.collapse', 'Collapse') : t('common.expand', 'Expand')}
                    onClick={(e) => {
                      e.preventDefault();
                      setReportsExpanded((v) => !v);
                    }}
                    className={`px-2 flex items-center shrink-0 border-l border-blue-100/80 ${
                      isReportsRoute ? 'border-blue-200/60' : 'border-gray-200'
                    } hover:bg-black/5`}
                  >
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 transition-transform ${reportsExpanded ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>
                </div>
                {reportsExpanded && (
                  <div className="ml-2 pl-4 border-l-2 border-blue-100 space-y-0.5 py-1">
                    {reportSubItems.map((sub) => {
                      const subActive = location.pathname === sub.href || location.pathname.startsWith(`${sub.href}/`);
                      return (
                        <Link
                          key={sub.href}
                          to={sub.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`block px-3 py-2 text-sm rounded-md transition-colors ${
                            subActive ? 'bg-blue-50 text-blue-800 font-medium' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {sub.name}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            
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
