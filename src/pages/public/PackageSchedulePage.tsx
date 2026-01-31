import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { db } from '../../lib/db';
import { showNotification } from '../../contexts/NotificationContext';
import { Button } from '../../components/ui/Button';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { AnimatedRating } from '../../components/ui/AnimatedRating';
import { Calendar, Package, X, User } from 'lucide-react';

interface Tenant {
  id: string;
  name: string;
  name_ar: string;
  slug: string;
  landing_page_settings?: any;
}

interface ServicePackage {
  id: string;
  name: string;
  name_ar: string;
  description: string;
  description_ar: string;
  total_price: number;
  original_price?: number | null;
  discount_percentage?: number | null;
  image_url?: string;
  gallery_urls?: string[];
  services?: Array<{
    service_id: string;
    service_name: string;
    service_name_ar: string;
    quantity: number;
  }>;
}

interface PackageService {
  service_id: string;
  service_name: string;
  service_name_ar: string;
  quantity: number;
  service?: {
    id: string;
    name: string;
    name_ar: string;
    description: string;
    description_ar: string;
    base_price: number;
    duration_minutes: number;
    image_url?: string;
  };
}


// Helper function to format package name
function formatPackageName(
  pkg: ServicePackage,
  language: string
): string {
  const serviceNames = pkg.services
    ? pkg.services.map(svc => language === 'ar' ? svc.service_name_ar : svc.service_name).join(' + ')
    : '';
  
  let savePercentage = 0;
  if (pkg.original_price && pkg.original_price > pkg.total_price) {
    savePercentage = Math.round(((pkg.original_price - pkg.total_price) / pkg.original_price) * 100);
  } else if (pkg.discount_percentage) {
    savePercentage = pkg.discount_percentage;
  }
  
  if (savePercentage > 0 && serviceNames) {
    return language === 'ar' 
      ? `كومبو (وفر ${savePercentage}%): ${serviceNames}`
      : `Combo (Save ${savePercentage}%): ${serviceNames}`;
  } else if (serviceNames) {
    return language === 'ar'
      ? `كومبو: ${serviceNames}`
      : `Combo: ${serviceNames}`;
  } else {
    return language === 'ar' ? pkg.name_ar : pkg.name;
  }
}

export function PackageSchedulePage() {
  const { tenantSlug, packageId } = useParams<{ tenantSlug: string; packageId: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { formatPrice } = useCurrency();
  const isLoggedIn = userProfile?.role === 'customer';

  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [packageData, setPackageData] = useState<ServicePackage | null>(null);
  const [packageServices, setPackageServices] = useState<PackageService[]>([]);

  useEffect(() => {
    if (tenantSlug && packageId) {
      fetchData();
    }
  }, [tenantSlug, packageId]);

  async function fetchData() {
    try {
      setLoading(true);

      if (!packageId) {
        console.error('Package ID is missing from URL');
        showNotification('warning', t('packages.packageIdMissing'));
        navigate(`/${tenantSlug}/book`);
        return;
      }

      console.log('Fetching data for package:', { packageId, tenantSlug });

      // Fetch tenant
      const { data: tenantData, error: tenantError } = await db
        .from('tenants')
        .select('id, name, name_ar, slug, landing_page_settings')
        .eq('slug', tenantSlug)
        .eq('is_active', true)
        .maybeSingle();

      if (tenantError || !tenantData) {
        console.error('Error fetching tenant:', tenantError);
        showNotification('error', t('packages.serviceProviderNotFound'));
        navigate(`/${tenantSlug}/book`);
        return;
      }

      setTenant(tenantData);

      // Fetch package - filter by tenant_id and is_active for security
      console.log('Fetching package:', { packageId, tenantId: tenantData.id });
      const { data: pkgData, error: pkgError } = await db
        .from('service_packages')
        .select('id, name, name_ar, description, description_ar, total_price, original_price, discount_percentage, image_url, gallery_urls, is_active, tenant_id')
        .eq('id', packageId)
        .eq('tenant_id', tenantData.id)
        .eq('is_active', true)
        .maybeSingle();

      console.log('Package query result:', { 
        found: !!pkgData, 
        error: pkgError?.message,
        packageTenantId: pkgData?.tenant_id,
        currentTenantId: tenantData.id,
        isActive: pkgData?.is_active
      });

      if (pkgError) {
        console.error('Error fetching package:', pkgError);
        showNotification('error', t('packages.errorFetchingPackage', { message: pkgError.message }));
        navigate(`/${tenantSlug}/book`);
        return;
      }

      if (!pkgData) {
        console.error('Package not found in database:', { packageId, tenantId: tenantData.id });
        // Try to list all packages for this tenant to help debug
        const { data: allPackages } = await db
          .from('service_packages')
          .select('id, name, tenant_id, is_active')
          .eq('tenant_id', tenantData.id)
          .limit(10);
        console.log('Available packages for this tenant:', allPackages);
        showNotification('error', t('packages.packageNotFound'));
        navigate(`/${tenantSlug}/book`);
        return;
      }

      // Fetch package services
      // Use explicit foreign key format: services:service_id to avoid auto-detection issues
      const { data: packageServicesData, error: packageServicesError } = await db
        .from('package_services')
        .select('service_id, capacity_total, services:service_id (id, name, name_ar, description, description_ar, base_price, duration_minutes, image_url)')
        .eq('package_id', packageId);

      if (packageServicesError) {
        console.error('Error fetching package services:', packageServicesError);
      }

      const services: PackageService[] = (packageServicesData || []).map((ps: any) => ({
        service_id: ps.service_id,
        service_name: ps.services?.name || '',
        service_name_ar: ps.services?.name_ar || '',
        quantity: ps.capacity_total || ps.quantity || 1, // Support both old (quantity) and new (capacity_total) format
        service: ps.services ? {
          id: ps.services.id,
          name: ps.services.name,
          name_ar: ps.services.name_ar,
          description: ps.services.description || '',
          description_ar: ps.services.description_ar || '',
          base_price: parseFloat(ps.services.base_price || 0),
          duration_minutes: ps.services.duration_minutes || 60,
          image_url: ps.services.image_url || null,
        } : undefined,
      }));

      setPackageServices(services);

      // Validate that package has services
      if (!services || services.length === 0) {
        console.error('Package has no services:', { packageId, tenantId: tenantData.id });
        showNotification('warning', t('packages.packageHasNoServicesConfigured'));
        navigate(`/${tenantSlug}/book`);
        return;
      }

      // Parse gallery_urls
      let galleryUrls: string[] = [];
      if (pkgData.gallery_urls) {
        if (Array.isArray(pkgData.gallery_urls)) {
          galleryUrls = pkgData.gallery_urls.filter((img: any) => img && typeof img === 'string');
        } else if (typeof pkgData.gallery_urls === 'string') {
          try {
            const parsed = JSON.parse(pkgData.gallery_urls);
            if (Array.isArray(parsed)) {
              galleryUrls = parsed.filter((img: any) => img && typeof img === 'string');
            }
          } catch {
            galleryUrls = [];
          }
        }
      }
      if (galleryUrls.length === 0 && pkgData.image_url) {
        galleryUrls = [pkgData.image_url];
      }

      setPackageData({
        ...pkgData,
        services: services.map(s => ({
          service_id: s.service_id,
          service_name: s.service_name,
          service_name_ar: s.service_name_ar,
          quantity: s.quantity,
        })),
        gallery_urls: galleryUrls,
        image_url: pkgData.image_url || (galleryUrls.length > 0 ? galleryUrls[0] : null),
      });

    } catch (error: any) {
      console.error('Error fetching package data:', error);
      console.error('Error details:', {
        message: error?.message,
        stack: error?.stack,
        tenantSlug,
        packageId,
      });
      
      // Show more specific error message
      let errorMessage = i18n.language === 'ar' ? 'حدث خطأ أثناء تحميل البيانات' : 'Error loading data';
      if (error?.message) {
        errorMessage += `: ${error.message}`;
      }
      
      // Don't show alert if we're redirecting
      if (!tenant || !packageData) {
        // Will be handled by the component's error state
        return;
      }
      
      showNotification('error', errorMessage);
    } finally {
      setLoading(false);
    }
  }

  function handleBuyPackage() {
    if (!packageData) return;

    // Navigate to checkout with package purchase data (not booking data)
    const purchaseData = {
      packageId: packageData.id,
      packageName: formatPackageName(packageData, i18n.language),
      totalPrice: packageData.total_price,
      isPackagePurchase: true, // Flag to indicate this is a package purchase, not a booking
    };

    // Check if user is logged in
    if (!isLoggedIn) {
      // Redirect to phone entry page
      navigate(`/${tenantSlug}/book/phone-entry`, {
        state: purchaseData,
      });
      return;
    }

    // Navigate to checkout with package purchase data
    navigate(`/${tenantSlug}/book/checkout`, {
      state: purchaseData,
    });
  }


  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{i18n.language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (!packageData || !tenant) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">{i18n.language === 'ar' ? 'الحزمة غير موجودة' : 'Package not found'}</p>
          <Button onClick={() => navigate(`/${tenantSlug}/book`)} className="mt-4">
            {i18n.language === 'ar' ? 'العودة' : 'Go Back'}
          </Button>
        </div>
      </div>
    );
  }

  const packageDisplayName = formatPackageName(packageData, i18n.language);
  const packageImage = packageData.image_url || (packageData.gallery_urls && packageData.gallery_urls.length > 0 ? packageData.gallery_urls[0] : null);

  // Get settings for colors
  const getSettings = () => {
    if (!tenant?.landing_page_settings) return {};
    const rawSettings = tenant.landing_page_settings;
    if (typeof rawSettings === 'string') {
      try {
        return JSON.parse(rawSettings);
      } catch {
        return {};
      }
    }
    return rawSettings || {};
  };

  const settings = getSettings();
  const primaryColor = settings.primary_color || '#2563eb';
  const secondaryColor = settings.secondary_color || '#3b82f6';


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header - Matching ServiceBookingFlow Style */}
      <header 
        className="bg-white/95 backdrop-blur-md shadow-md sticky top-0 z-50 border-b transition-all duration-300" 
        style={{ 
          top: '0',
          borderColor: `${primaryColor}15`
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            {/* Logo/Brand Section */}
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate(`/${tenantSlug}/book`)}>
              <div 
                className="p-3 rounded-xl shadow-lg transition-all duration-300 group-hover:scale-105 group-hover:shadow-xl"
                style={{ 
                  background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                }}
              >
                <Package className="w-7 h-7 text-white" />
              </div>
              <div className="flex flex-col">
                <h1 
                  className="text-2xl md:text-3xl font-bold bg-clip-text text-transparent transition-all duration-300 group-hover:opacity-80"
                  style={{ 
                    backgroundImage: `linear-gradient(to right, ${primaryColor}, ${secondaryColor})`
                  }}
                >
                  {i18n.language === 'ar' ? tenant.name_ar : tenant.name}
                </h1>
                <span className="text-sm text-gray-500 font-medium">
                  {i18n.language === 'ar' ? 'احجز حزمتك الآن' : 'Book Your Package'}
                </span>
              </div>
            </div>

            {/* Actions Section */}
            <div className="flex items-center gap-3">
              {isLoggedIn ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/${tenantSlug}/customer/dashboard`)}
                  className="transition-all duration-300 hover:scale-105"
                  style={{ 
                    color: primaryColor,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = `${primaryColor}10`;
                    e.currentTarget.style.color = secondaryColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = primaryColor;
                  }}
                >
                  <User className="w-4 h-4 mr-2" />
                  {i18n.language === 'ar' ? 'حسابي' : 'My Account'}
                </Button>
              ) : null}
              <div className="h-6 w-px bg-gray-300"></div>
              <LanguageToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content - Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Package Title and Info - Matching reference page style */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
                    {packageDisplayName}
                  </h1>
                  {packageData.description && (
                    <p className="text-gray-600 mt-2">
                      {i18n.language === 'ar' ? packageData.description_ar : packageData.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/${tenantSlug}/book`)}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 ml-4 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                  title={i18n.language === 'ar' ? 'تعديل' : 'Edit'}
                >
                  <Calendar className="w-4 h-4" />
                  {i18n.language === 'ar' ? 'تعديل' : 'Edit'}
                </button>
              </div>
            </div>

            {/* Package Services List */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                {i18n.language === 'ar' ? 'الخدمات المشمولة' : 'Included Services'}
              </h2>
              <div className="space-y-4">
                {packageServices.map((pkgService, index) => {
                  const service = pkgService.service;
                  return (
                    <div key={pkgService.service_id} className="flex items-start gap-4 pb-4 border-b border-gray-200 last:border-0 last:pb-0">
                      <span className="flex items-center justify-center w-8 h-8 rounded-full font-semibold text-white flex-shrink-0"
                        style={{ backgroundColor: primaryColor }}>
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900 mb-1">
                          {i18n.language === 'ar' ? pkgService.service_name_ar : pkgService.service_name}
                        </h3>
                        {service && (
                          <p className="text-sm text-gray-600">
                            {i18n.language === 'ar' ? service.description_ar : service.description}
                          </p>
                        )}
                        {service && (
                          <p className="text-sm text-gray-500 mt-1">
                            {i18n.language === 'ar' ? 'السعة: ' : 'Capacity: '}{pkgService.quantity} {i18n.language === 'ar' ? 'حجز' : 'booking(s)'}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sidebar - Package Purchase Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm p-6 sticky top-24">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {i18n.language === 'ar' ? 'ملخص الشراء' : 'Purchase Summary'}
              </h2>

              <div className="space-y-4">
                {/* Package Name */}
                <div>
                  <div className="text-sm text-gray-600 mb-1">
                    {i18n.language === 'ar' ? 'الحزمة' : 'Package'}
                  </div>
                  <div className="font-medium text-gray-900">
                    {packageDisplayName}
                  </div>
                </div>

                {/* Included Services */}
                <div className="pt-3 border-t border-gray-200">
                  <div className="text-sm text-gray-600 mb-2">
                    {i18n.language === 'ar' ? 'الخدمات المشمولة' : 'Included Services'}
                  </div>
                  <div className="space-y-2">
                    {packageServices.map((pkgService, index) => (
                      <div key={pkgService.service_id} className="text-sm">
                        <span className="font-medium text-gray-900">
                          {index + 1}. {i18n.language === 'ar' ? pkgService.service_name_ar : pkgService.service_name}
                        </span>
                        <span className="text-gray-500 ml-2">
                          ({pkgService.quantity} {i18n.language === 'ar' ? 'حجز' : 'booking(s)'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Price Section */}
                <div className="pt-4 border-t border-gray-200">
                  <div className="space-y-3">
                    {packageData.original_price && packageData.original_price > packageData.total_price && (
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                          {i18n.language === 'ar' ? 'السعر الأصلي' : 'Original Price'}
                        </div>
                        <div className="text-sm text-gray-400 line-through">
                          {formatPrice(packageData.original_price)}
                        </div>
                      </div>
                    )}
                    {packageData.discount_percentage && packageData.discount_percentage > 0 && (
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                          {i18n.language === 'ar' ? 'الخصم' : 'Discount'}
                        </div>
                        <div className="text-sm font-semibold text-green-600">
                          -{packageData.discount_percentage}%
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="text-base font-bold text-gray-900">
                        {t('common.total')}
                      </div>
                      <div className="text-lg font-bold" style={{ color: primaryColor }}>
                        {formatPrice(packageData.total_price)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Info Message */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-800">
                    {i18n.language === 'ar' 
                      ? 'بعد الشراء، يمكنك حجز الخدمات في أي وقت متاح'
                      : 'After purchase, you can book services at any available time'}
                  </p>
                </div>

                {/* Buy Package Button */}
                <Button
                  onClick={handleBuyPackage}
                  className="w-full py-3 text-lg font-semibold"
                  style={{ 
                    backgroundColor: primaryColor,
                    color: 'white',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = secondaryColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = primaryColor;
                  }}
                >
                  {i18n.language === 'ar' ? 'شراء الحزمة' : 'Buy Package'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

