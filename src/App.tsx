import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from './contexts/AuthContext';
import { CurrencyProvider } from './contexts/CurrencyContext';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ManagementLoginPage } from './pages/admin/ManagementLoginPage';
import { SolutionOwnerDashboard } from './pages/admin/SolutionOwnerDashboard';
import { TenantFeaturesPage } from './pages/admin/TenantFeaturesPage';
import { TenantDashboard } from './pages/tenant/TenantDashboard';
import { ServicesPageWrapper } from './pages/tenant/ServicesPageWrapper';
import { BookingsPageWrapper } from './pages/tenant/BookingsPageWrapper';
import { VisitorsPageWrapper } from './pages/tenant/VisitorsPageWrapper';
import { EmployeesPageWrapper } from './pages/tenant/EmployeesPageWrapper';
import { EmployeeShiftsPageWrapper } from './pages/tenant/EmployeeShiftsPageWrapper';
import { SettingsPageWrapper } from './pages/tenant/SettingsPageWrapper';
import { ReceptionPage } from './pages/reception/ReceptionPage';
import { CashierPage } from './pages/cashier/CashierPage';
// ARCHIVED: import { EmployeePage } from './pages/employee/EmployeePage';
import { PublicBookingPage } from './pages/public/PublicBookingPage';
import { ServiceBookingFlow } from './pages/public/ServiceBookingFlow';
import { PackageSchedulePage } from './pages/public/PackageSchedulePage';
import { CheckoutPage } from './pages/public/CheckoutPage';
import { PhoneEntryPage } from './pages/public/PhoneEntryPage';
import { BookingSuccessPage } from './pages/public/BookingSuccessPage';
import { QRScannerPage } from './pages/public/QRScannerPage';
import { LandingPageBuilderWrapper } from './pages/tenant/LandingPageBuilderWrapper';
import { PackagesPageWrapper } from './pages/tenant/PackagesPageWrapper';
import { PackageSubscribersPageWrapper } from './pages/tenant/PackageSubscribersPageWrapper';
import { OffersPageWrapper } from './pages/tenant/OffersPageWrapper';
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
      <Route path="/solution-admin" element={<SolutionOwnerDashboard />} />
      <Route path="/management/features" element={<TenantFeaturesPage />} />

      {/* More specific admin routes first so /admin/visitors is not matched by /admin */}
      <Route path="/:tenantSlug/admin/services" element={<ServicesPageWrapper />} />
      <Route path="/:tenantSlug/admin/packages" element={<PackagesPageWrapper />} />
      <Route path="/:tenantSlug/admin/package-subscribers" element={<PackageSubscribersPageWrapper />} />
      <Route path="/:tenantSlug/admin/offers" element={<OffersPageWrapper />} />
      <Route path="/:tenantSlug/admin/bookings" element={<BookingsPageWrapper />} />
      <Route path="/:tenantSlug/admin/visitors" element={<VisitorsPageWrapper />} />
      <Route path="/:tenantSlug/admin/employees" element={<EmployeesPageWrapper />} />
      <Route path="/:tenantSlug/admin/employee-shifts" element={<EmployeeShiftsPageWrapper />} />
      <Route path="/:tenantSlug/admin/settings" element={<SettingsPageWrapper />} />
      <Route path="/:tenantSlug/admin/landing" element={<LandingPageBuilderWrapper />} />
      <Route path="/:tenantSlug/admin/debug/navigation" element={<NavigationTest />} />
      <Route path="/:tenantSlug/admin" element={<TenantDashboard />} />

      {/* Reception: /reception and /reception/visitors both render ReceptionPage (reception layout, no admin) */}
      <Route path="/:tenantSlug/reception/visitors" element={<ReceptionPage />} />
      <Route path="/:tenantSlug/reception" element={<ReceptionPage />} />
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
          <AppContent />
        </CurrencyProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
