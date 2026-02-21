import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from './contexts/AuthContext';
import { CurrencyProvider } from './contexts/CurrencyContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ManagementLoginPage } from './pages/admin/ManagementLoginPage';
import { SolutionOwnerDashboard } from './pages/admin/SolutionOwnerDashboard';
import { SupportTicketsPage } from './pages/admin/SupportTicketsPage';
import { TenantFeaturesPage } from './pages/admin/TenantFeaturesPage';
import { TenantDashboard } from './pages/tenant/TenantDashboard';
import { ServicesPage } from './pages/tenant/ServicesPage';
import { BookingsPage } from './pages/tenant/BookingsPage';
import { VisitorsPage } from './pages/tenant/VisitorsPage';
import { EmployeesPage } from './pages/tenant/EmployeesPage';
import { EmployeeShiftsPage } from './pages/tenant/EmployeeShiftsPage';
import { SettingsPage } from './pages/tenant/SettingsPage';
import { ReceptionPage } from './pages/reception/ReceptionPage';
import { CashierPage } from './pages/cashier/CashierPage';
// ARCHIVED: import { EmployeePage } from './pages/employee/EmployeePage';
import PublicBookingPage from './pages/public/PublicBookingPage';
import { ServiceBookingFlow } from './pages/public/ServiceBookingFlow';
import { PackageSchedulePage } from './pages/public/PackageSchedulePage';
import { CheckoutPage } from './pages/public/CheckoutPage';
import { PhoneEntryPage } from './pages/public/PhoneEntryPage';
import { BookingSuccessPage } from './pages/public/BookingSuccessPage';
import { QRScannerPage } from './pages/public/QRScannerPage';
import { LandingPageBuilderWrapper } from './pages/tenant/LandingPageBuilderWrapper';
import { PackagesPage } from './pages/tenant/PackagesPage';
import { PackageSubscribersPage } from './pages/tenant/PackageSubscribersPage';
import { BranchesPage } from './pages/tenant/BranchesPage';
import { BranchDetailPage } from './pages/tenant/BranchDetailPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OffersPage } from './pages/tenant/OffersPage';
import { AssignFixingTicketPage } from './pages/tenant/AssignFixingTicketPage';
import { CustomerSignupPage } from './pages/customer/CustomerSignupPage';
import { CustomerLoginPage } from './pages/customer/CustomerLoginPage';
import { CustomerForgotPasswordPage } from './pages/customer/CustomerForgotPasswordPage';
import { CustomerDashboard } from './pages/customer/CustomerDashboard';
import { CustomerBillingPage } from './pages/customer/CustomerBillingPage';
import { CustomerLandingPage } from './pages/customer/CustomerLandingPage';
import { NavigationTest } from './components/debug/NavigationTest';
import './lib/i18n';

function AppContent() {
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return (
    <>
      <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/management" element={<ManagementLoginPage />} />
      <Route path="/solution-admin/support-tickets" element={<SupportTicketsPage />} />
      <Route path="/solution-admin" element={<SolutionOwnerDashboard />} />
      <Route path="/management/features" element={<TenantFeaturesPage />} />

      {/* Single admin layout so sidebar and features state persist when navigating between pages */}
      <Route path="/:tenantSlug/admin" element={<AdminLayout />}>
        <Route index element={<TenantDashboard />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="branches" element={<ErrorBoundary><BranchesPage /></ErrorBoundary>} />
        <Route path="branches/:branchId" element={<ErrorBoundary><BranchDetailPage /></ErrorBoundary>} />
        <Route path="packages" element={<PackagesPage />} />
        <Route path="package-subscribers" element={<PackageSubscribersPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route path="visitors" element={<VisitorsPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="employee-shifts" element={<EmployeeShiftsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="landing" element={<LandingPageBuilderWrapper />} />
        <Route path="assign-fixing-ticket" element={<AssignFixingTicketPage />} />
        <Route path="debug/navigation" element={<NavigationTest />} />
      </Route>

      {/* Reception: /reception, /reception/visitors, /reception/assign-fixing-ticket all use ReceptionPage (reception layout, no admin sidebar) */}
      <Route path="/:tenantSlug/reception/visitors" element={<ReceptionPage />} />
      <Route path="/:tenantSlug/reception/assign-fixing-ticket" element={<ReceptionPage />} />
      <Route path="/:tenantSlug/reception" element={<ReceptionPage />} />
      <Route path="/:tenantSlug/cashier/assign-fixing-ticket" element={<CashierPage />} />
      <Route path="/:tenantSlug/cashier" element={<CashierPage />} />
      {/* ARCHIVED: <Route path="/:tenantSlug/employee" element={<EmployeePage />} /> */}

      <Route path="/:tenantSlug/book" element={<PublicBookingPage />} />
      <Route path="/:tenantSlug/book/:serviceId" element={<ServiceBookingFlow />} />
      <Route path="/:tenantSlug/packages/:packageId/schedule" element={<PackageSchedulePage />} />
      <Route path="/:tenantSlug/book/phone-entry" element={<PhoneEntryPage />} />
      <Route path="/:tenantSlug/book/checkout" element={<CheckoutPage />} />
      <Route path="/:tenantSlug/book/success" element={<BookingSuccessPage />} />
      <Route path="/:tenantSlug/qr" element={<QRScannerPage />} />

      {/* Customer Routes */}
      <Route path="/:tenantSlug/customer" element={<CustomerLandingPage />} />
      <Route path="/:tenantSlug/customer/signup" element={<CustomerSignupPage />} />
      <Route path="/:tenantSlug/customer/login" element={<CustomerLoginPage />} />
      <Route path="/:tenantSlug/customer/forgot-password" element={<CustomerForgotPasswordPage />} />
      <Route path="/:tenantSlug/customer/dashboard" element={<CustomerDashboard />} />
      <Route path="/:tenantSlug/customer/billing" element={<CustomerBillingPage />} />

            <Route path="/:tenantSlug" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CurrencyProvider>
          <NotificationProvider>
            <ConfirmProvider>
              <AppContent />
            </ConfirmProvider>
          </NotificationProvider>
        </CurrencyProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
