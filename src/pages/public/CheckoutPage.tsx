import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { CurrencyDisplay } from '../../components/ui/CurrencyDisplay';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { Package, User, Calendar, Clock, Users, CreditCard, CheckCircle, X, ArrowLeft, Percent, ChevronDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AnimatedRating } from '../../components/ui/AnimatedRating';
import { countryCodes, validatePhoneNumberByCountry } from '../../lib/countryCodes';
import { getApiUrl } from '../../lib/apiUrl';
import { createTimeoutSignal } from '../../lib/requestTimeout';

interface BookingData {
  serviceId: string;
  packageId?: string | null;
  offerId?: string | null;
  slotId: string;
  date: string;
  time: string;
}

interface ServiceOffer {
  id: string;
  service_id: string;
  name: string;
  name_ar?: string;
  price: number;
  original_price?: number;
  discount_percentage?: number;
}

interface Service {
  id: string;
  name: string;
  name_ar: string;
  description: string;
  description_ar: string;
  base_price: number; // This is the final price (discounted if discount exists)
  original_price?: number;
  discount_percentage?: number;
  duration_minutes: number;
  image_url?: string;
  gallery_urls?: string[];
  original_price?: number;
  discount_percentage?: number;
}

interface ServicePackage {
  id: string;
  name: string;
  name_ar: string;
  total_price: number;
  original_price?: number | null;
  discount_percentage?: number | null;
  image_url?: string | null;
  gallery_urls?: string[] | null;
  services?: Array<{
    service_id: string;
    service_name: string;
    service_name_ar: string;
    quantity: number;
  }>;
}

// Helper function to format package name
function formatPackageName(
  pkg: ServicePackage,
  language: string
): string {
  // Format: "Combo (Save X%): Service1 + Service2 + ..."
  const serviceNames = pkg.services
    ? pkg.services.map(svc => language === 'ar' ? svc.service_name_ar : svc.service_name).join(' + ')
    : '';
  
  // Calculate save percentage
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

interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
}

export function CheckoutPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { formatPrice } = useCurrency();
  const isLoggedIn = userProfile?.role === 'customer';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenant, setTenant] = useState<any>(null);
  const [service, setService] = useState<Service | null>(null);
  const [servicePackage, setServicePackage] = useState<ServicePackage | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<ServiceOffer | null>(null);
  const [packageServiceDetails, setPackageServiceDetails] = useState<Array<{
    serviceId: string;
    serviceName: string;
    serviceName_ar: string;
    base_price: number;
    visitorCount: number;
  }>>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slotCapacity, setSlotCapacity] = useState<number | null>(null); // Track current slot capacity
  // Get visitor count from booking data if provided, otherwise default to 1
  const bookingDataFromState = location.state as any;
  const initialVisitorCount = bookingDataFromState?.visitorCount || bookingDataFromState?.adultCount || 1;
  
  const [visitorCount, setVisitorCount] = useState(initialVisitorCount);
  const [countryCode, setCountryCode] = useState('+966'); // Default to Saudi Arabia (kept for backward compatibility)
  const [customerPhoneFull, setCustomerPhoneFull] = useState(userProfile?.phone || ''); // Full phone number with country code
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [packageCapacity, setPackageCapacity] = useState<{ remaining: number; total: number } | null>(null); // Package capacity info
  const [packageCapacityLoading, setPackageCapacityLoading] = useState(false);
  
  // OTP verification state for guest bookings
  const [otpStep, setOtpStep] = useState<'phone' | 'otp' | 'verified'>('phone'); // 'phone' | 'otp' | 'verified'
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [phoneUniquenessChecked, setPhoneUniquenessChecked] = useState(false);
  const [phoneUniquenessError, setPhoneUniquenessError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Get customer info from state if provided (from phone entry page)
  const locationState = location.state as any;
  const customerInfoFromState = locationState?.customerInfo;

  // Customer information form
  const [customerInfo, setCustomerInfo] = useState({
    name: customerInfoFromState?.name || userProfile?.full_name || '',
    email: customerInfoFromState?.email || userProfile?.email || '',
    phone: customerInfoFromState?.phone || userProfile?.phone || '',
  });

  // Package subscription payment (same options as bookings)
  const [packagePaymentMethod, setPackagePaymentMethod] = useState<'onsite' | 'transfer'>('onsite');
  const [packageTransactionReference, setPackageTransactionReference] = useState('');

  // Update customer info if provided from state (from phone entry page)
  useEffect(() => {
    if (customerInfoFromState) {
      const phone = customerInfoFromState.phone || '';
      setCustomerInfo({
        name: customerInfoFromState.name || '',
        email: customerInfoFromState.email || '',
        phone: phone,
      });
      // Set the full phone number for OTP flow
      if (phone) {
        setCustomerPhoneFull(phone);
        // Extract country code from phone
        for (const country of countryCodes) {
          if (phone.startsWith(country.code)) {
            setCountryCode(country.code);
            break;
          }
        }
        // Mark OTP as verified since phone was already verified in phone entry page
        setOtpStep('verified');
      }
    }
  }, [customerInfoFromState]);

  // Phone number validation based on country code (using unified validation function)
  function validatePhoneNumber(phone: string, code: string): { valid: boolean; error?: string } {
    return validatePhoneNumberByCountry(phone, code, i18n.language as 'en' | 'ar');
  }

  // Send OTP function (reusable for initial send and resend)
  const sendOTPToPhone = async () => {
    if (!customerPhoneFull || phoneError) return;
    
    setOtpLoading(true);
    setPhoneUniquenessError(null);
    
    try {
      const API_URL = getApiUrl();
      const response = await fetch(`${API_URL}/auth/guest/verify-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: customerPhoneFull,
          tenant_id: tenant?.id,
        }),
        signal: createTimeoutSignal('/auth/guest/verify-phone', false),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || t('checkout.failedToSendOTP'));
      }
      
      setOtpSent(true);
      setOtpStep('otp');
      setPhoneUniquenessChecked(true);
      setResendCooldown(60); // Set cooldown to 60 seconds
      if (data.phoneExists) {
        // Phone was used before, but allow it (informational)
        console.log('Phone number was used before');
      }
    } catch (err: any) {
      setPhoneUniquenessError(err.message || t('checkout.failedToSendOTP'));
    } finally {
      setOtpLoading(false);
    }
  };

  // Get booking data from navigation state or URL params
  const bookingData: BookingData | null = locationState?.isPackagePurchase ? null : (locationState || (() => {
    const params = new URLSearchParams(location.search);
    if (params.get('serviceId') && params.get('slotId') && params.get('date') && params.get('time')) {
      return {
        serviceId: params.get('serviceId')!,
        packageId: params.get('packageId') || null,
        slotId: params.get('slotId')!,
        date: params.get('date')!,
        time: params.get('time')!,
      };
    }
    return null;
  }));

  // Check if this is a package purchase (not a booking)
  const isPackagePurchase = locationState?.isPackagePurchase === true;

  useEffect(() => {
    if (!isPackagePurchase && !bookingData) {
      navigate(`/${tenantSlug}/book`);
      return;
    }

    fetchCheckoutData();
  }, [tenantSlug, bookingData, isPackagePurchase]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  async function fetchCheckoutData() {
    if (!tenantSlug) return;

    try {
      setLoading(true);

      // Fetch tenant
      const { data: tenantData } = await db
        .from('tenants')
        .select('id, name, name_ar, slug, landing_page_settings, is_active')
        .eq('slug', tenantSlug)
        .maybeSingle();

      if (!tenantData || !tenantData.is_active) {
        alert('Tenant not found or inactive');
        navigate(`/${tenantSlug}/book`);
        return;
      }

      setTenant(tenantData);

      // Handle package purchase flow
      if (isPackagePurchase) {
        const packageId = locationState?.packageId;
        if (!packageId) {
          alert('Package ID is required');
          navigate(`/${tenantSlug}/book`);
          return;
        }

        // Fetch package
        const { data: packageData } = await db
          .from('service_packages')
          .select('*')
          .eq('id', packageId)
          .eq('tenant_id', tenantData.id)
          .eq('is_active', true)
          .maybeSingle();

        if (!packageData) {
          alert('Package not found or inactive');
          navigate(`/${tenantSlug}/book`);
          return;
        }

        // Fetch package services
        const { data: packageServices, error: packageServicesError } = await db
          .from('package_services')
          .select('service_id, capacity_total, services (id, name, name_ar)')
          .eq('package_id', packageId);

        if (packageServicesError) {
          console.error('Error fetching package services:', packageServicesError);
          alert(i18n.language === 'ar' 
            ? 'خطأ في جلب خدمات الحزمة' 
            : 'Error fetching package services');
          navigate(`/${tenantSlug}/book`);
          return;
        }

        const services = (packageServices || []).map((ps: any) => ({
          service_id: ps.service_id,
          service_name: ps.services?.name || '',
          service_name_ar: ps.services?.name_ar || '',
          quantity: ps.capacity_total || 1,
        }));

        // Validate that package has services
        if (!services || services.length === 0) {
          console.error('Package has no services:', { packageId, tenantId: tenantData.id });
          alert(i18n.language === 'ar' 
            ? 'هذه الحزمة لا تحتوي على خدمات. يرجى الاتصال بالمسؤول.' 
            : 'This package has no services configured. Please contact the administrator.');
          navigate(`/${tenantSlug}/book`);
          return;
        }

        setServicePackage({
          ...packageData,
          services,
        });

        setLoading(false);
        return;
      }

      // Regular booking flow - requires bookingData
      if (!bookingData) {
        navigate(`/${tenantSlug}/book`);
        return;
      }

      // Fetch service
      const { data: serviceData } = await db
        .from('services')
        .select('*')
        .eq('id', bookingData.serviceId)
        .eq('tenant_id', tenantData.id)
        .eq('is_active', true)
        .eq('is_public', true)
        .maybeSingle();

      if (!serviceData) {
        alert(t('checkout.serviceNotFound'));
        navigate(`/${tenantSlug}/book`);
        return;
      }

      setService({
        id: serviceData.id,
        name: serviceData.name || '',
        name_ar: serviceData.name_ar || '',
        description: serviceData.description || '',
        description_ar: serviceData.description_ar || '',
        base_price: parseFloat(serviceData.base_price?.toString() || '0'),
        original_price: serviceData.original_price ? parseFloat(serviceData.original_price.toString()) : undefined,
        discount_percentage: serviceData.discount_percentage ? parseFloat(serviceData.discount_percentage.toString()) : undefined,
        duration_minutes: serviceData.duration_minutes || serviceData.service_duration_minutes || 0,
        image_url: serviceData.image_url || null,
        gallery_urls: Array.isArray(serviceData.gallery_urls) ? serviceData.gallery_urls : [],
      });

      // Fetch offer if offerId is provided
      if (bookingData.offerId) {
        try {
          const { data: offerData, error: offerError } = await db
            .from('service_offers')
            .select('*')
            .eq('id', bookingData.offerId)
            .eq('service_id', bookingData.serviceId)
            .eq('is_active', true)
            .maybeSingle();

          if (!offerError && offerData) {
            setSelectedOffer({
              id: offerData.id,
              service_id: offerData.service_id,
              name: offerData.name || '',
              name_ar: offerData.name_ar || '',
              price: parseFloat(offerData.price?.toString() || '0'),
              original_price: offerData.original_price ? parseFloat(offerData.original_price.toString()) : undefined,
              discount_percentage: offerData.discount_percentage ? parseFloat(offerData.discount_percentage.toString()) : undefined,
            });
            console.log('Offer loaded:', offerData);
          } else if (offerError) {
            console.warn('Could not fetch offer:', offerError);
          }
        } catch (offerErr: any) {
          console.warn('Error fetching offer:', offerErr);
        }
      }

      // Fetch package if applicable
      if (bookingData.packageId) {
        const { data: packageData } = await db
          .from('service_packages')
          .select('*')
          .eq('id', bookingData.packageId)
          .eq('tenant_id', tenantData.id)
          .maybeSingle();

        if (packageData) {
          // Get package services with ticket counts from booking data if available
          const bookingPackageServices = bookingDataFromState?.packageServices || [];
          
          console.log('=== PACKAGE PRICING DEBUG ===');
          console.log('bookingDataFromState:', bookingDataFromState);
          console.log('bookingPackageServices:', bookingPackageServices);
          console.log('visitorCount from state:', bookingDataFromState?.visitorCount || bookingDataFromState?.adultCount);
          
          // Fetch package services to format name correctly and get prices
          const { data: packageServices, error: packageServicesError } = await db
            .from('package_services')
            .select('service_id, quantity, services (id, name, name_ar, base_price)')
            .eq('package_id', bookingData.packageId);

          if (packageServicesError) {
            console.error('Error fetching package services:', packageServicesError);
          }

          console.log('Package services fetched from DB:', packageServices);
          console.log('Number of services:', packageServices?.length || 0);

          // Handle both array and single object responses
          const servicesArray = Array.isArray(packageServices) ? packageServices : (packageServices ? [packageServices] : []);
          
          const services = servicesArray.map((ps: any) => {
            // Handle nested services object - it might be in different formats
            const serviceData = ps.services || (typeof ps === 'object' && 'services' in ps ? ps.services : {});
            return {
              service_id: ps.service_id,
              service_name: serviceData?.name || serviceData?.services_rel_name || '',
              service_name_ar: serviceData?.name_ar || serviceData?.services_rel_name_ar || '',
              quantity: ps.quantity || 1,
            };
          }).filter(s => s.service_id); // Filter out any invalid entries

          console.log('Processed services:', services);
          console.log('Number of processed services:', services.length);

          // Build package service details with prices and ticket counts
          // Match booking services with package services by serviceId
          const serviceDetails = servicesArray.map((ps: any) => {
            const serviceData = ps.services || {};
            
            // Find matching booking service - try multiple matching strategies
            const bookingService = bookingPackageServices.find((bs: any) => {
              const bsServiceId = bs.serviceId || bs.service_id;
              return bsServiceId === ps.service_id;
            });
            
            // Use visitor count from bookingService if found, otherwise use default
            const visitorCount = bookingService?.visitorCount !== undefined && bookingService?.visitorCount !== null
              ? bookingService.visitorCount
              : (bookingService?.adultCount !== undefined ? bookingService.adultCount : 1);
            
            console.log(`Matching service ${ps.service_id}:`, {
              found: !!bookingService,
              visitorCount,
              bookingService
            });
            
            return {
              serviceId: ps.service_id,
              serviceName: serviceData?.name || '',
              serviceName_ar: serviceData?.name_ar || '',
              base_price: parseFloat(serviceData?.base_price?.toString() || '0'),
              visitorCount: visitorCount,
            };
          });
          
          // If no matches found but we have total counts, apply to all services
          const hasMatches = serviceDetails.some(s => {
            const bookingService = bookingPackageServices.find((bs: any) => {
              const bsServiceId = bs.serviceId || bs.service_id;
              return bsServiceId === s.serviceId;
            });
            return !!bookingService;
          });
          
          if (!hasMatches && bookingDataFromState) {
            const totalVisitorsFromState = bookingDataFromState.visitorCount || bookingDataFromState.adultCount || 1;
            
            if (totalVisitorsFromState > 0) {
              // If single service, apply all counts to it
              if (serviceDetails.length === 1) {
                serviceDetails[0].visitorCount = totalVisitorsFromState;
              } else {
                // If multiple services, distribute evenly
                const visitorsPerService = Math.floor(totalVisitorsFromState / serviceDetails.length) || 1;
                const visitorsRemainder = totalVisitorsFromState % serviceDetails.length;
                
                serviceDetails.forEach((svc, index) => {
                  svc.visitorCount = visitorsPerService + (index === 0 ? visitorsRemainder : 0);
                });
              }
            }
          }
          
          console.log('Service details after processing:', serviceDetails.map(s => {
            const serviceTotal = s.base_price * s.visitorCount;
            return {
              name: s.serviceName,
              visitorCount: s.visitorCount,
              base_price: s.base_price,
              serviceTotal: serviceTotal
            };
          }));

          const calculatedTotal = serviceDetails.reduce((sum, s) => {
            return sum + (s.base_price * s.visitorCount);
          }, 0);
          
          console.log('Calculated total from serviceDetails:', calculatedTotal);
          console.log('Total visitors:', serviceDetails.reduce((sum, s) => sum + s.visitorCount, 0));
          console.log('=== END PACKAGE PRICING DEBUG ===');
          setPackageServiceDetails(serviceDetails);

          // Parse gallery_urls if it's a string
          let galleryUrls: string[] = [];
          if (packageData.gallery_urls) {
            if (Array.isArray(packageData.gallery_urls)) {
              galleryUrls = packageData.gallery_urls.filter((img: any) => img && typeof img === 'string');
            } else if (typeof packageData.gallery_urls === 'string') {
              try {
                const parsed = JSON.parse(packageData.gallery_urls);
                if (Array.isArray(parsed)) {
                  galleryUrls = parsed.filter((img: any) => img && typeof img === 'string');
                }
              } catch {
                galleryUrls = [];
              }
            }
          }

          setServicePackage({
            id: packageData.id,
            name: packageData.name || '',
            name_ar: packageData.name_ar || '',
            total_price: parseFloat(packageData.total_price?.toString() || '0'),
            original_price: packageData.original_price ? parseFloat(packageData.original_price.toString()) : null,
            discount_percentage: packageData.discount_percentage || null,
            image_url: packageData.image_url || null,
            gallery_urls: galleryUrls.length > 0 ? galleryUrls : null,
            services: services,
          });
        }
      }

      // Fetch slot details including capacity (only for regular bookings, not package purchases)
      if (!isPackagePurchase && bookingData?.slotId) {
        const { data: slotData } = await db
          .from('slots')
          .select('id, slot_date, start_time, end_time, available_capacity')
          .eq('id', bookingData.slotId)
          .maybeSingle();

        if (slotData) {
          setSlot({
            id: slotData.id,
            slot_date: slotData.slot_date,
            start_time: slotData.start_time,
            end_time: slotData.end_time,
          });
          setSlotCapacity(slotData.available_capacity || 0);
        }

        // Fetch package capacity for logged-in customers
        if (isLoggedIn && userProfile?.id && bookingData?.serviceId) {
          await fetchPackageCapacity(userProfile.id, bookingData.serviceId);
        }
      }

  // Fetch package capacity for a customer and service
  async function fetchPackageCapacity(customerId: string, serviceId: string) {
    try {
      setPackageCapacityLoading(true);
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      // First, find customer record by user email/phone
      const { data: userData } = await db
        .from('users')
        .select('email, phone')
        .eq('id', customerId)
        .maybeSingle();

      if (!userData) {
        setPackageCapacity(null);
        return;
      }

      // Find customer by email or phone
      let customerRecordId: string | null = null;
      if (userData.email) {
        const { data: customerByEmail } = await db
          .from('customers')
          .select('id')
          .eq('email', userData.email)
          .eq('tenant_id', tenant?.id)
          .maybeSingle();
        
        if (customerByEmail) {
          customerRecordId = customerByEmail.id;
        }
      }

      if (!customerRecordId && userData.phone) {
        const { data: customerByPhone } = await db
          .from('customers')
          .select('id')
          .eq('phone', userData.phone)
          .eq('tenant_id', tenant?.id)
          .maybeSingle();
        
        if (customerByPhone) {
          customerRecordId = customerByPhone.id;
        }
      }

      if (!customerRecordId) {
        setPackageCapacity(null);
        return;
      }

      // Fetch capacity
      const response = await fetch(`${API_URL}/bookings/capacity/${customerRecordId}/${serviceId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPackageCapacity({
          remaining: data.total_remaining_capacity || 0,
          total: data.total_remaining_capacity || 0, // We don't have total, just use remaining
        });
      } else {
        setPackageCapacity(null);
      }
    } catch (err) {
      console.error('Error fetching package capacity:', err);
      setPackageCapacity(null);
    } finally {
      setPackageCapacityLoading(false);
    }
  }

      // Get visitor count from URL params if available
      const params = new URLSearchParams(location.search);
      const paxParam = params.get('pax.general') || params.get('pax');
      if (paxParam) {
        const count = parseInt(paxParam, 10);
        if (!isNaN(count) && count > 0) {
          setVisitorCount(count);
        }
      }
    } catch (error) {
      console.error('Error fetching checkout data:', error);
      alert(t('checkout.failedToLoadCheckoutPage'));
      navigate(`/${tenantSlug}/book`);
    } finally {
      setLoading(false);
    }
  }

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

  // Calculate prices with adult/child pricing
  // If offer is selected, use offer price; otherwise use base_price
  const price = selectedOffer ? selectedOffer.price : (service?.base_price || 0);
  const basePrice = servicePackage ? servicePackage.total_price : price;
  const originalPrice = selectedOffer 
    ? (selectedOffer.original_price || selectedOffer.price)
    : (service?.original_price || basePrice);
  const serviceDiscount = selectedOffer?.discount_percentage || service?.discount_percentage || 0;
  
  // Calculate total based on price * visitor count
  let subtotal: number;
  let total: number;
  
  if (isPackagePurchase && servicePackage) {
    // Package purchase - use package total_price directly (not multiplied by visitor count)
    subtotal = servicePackage.total_price || 0;
    total = subtotal;
    console.log('Package pricing (direct purchase):', {
      packagePrice: servicePackage.total_price,
      subtotal,
      total
    });
  } else if (servicePackage && packageServiceDetails.length > 0) {
    // Package booking: sum up all services with their visitor counts
    subtotal = packageServiceDetails.reduce((sum, svc) => {
      const priceForService = svc.base_price || 0;
      const svcVisitorCount = svc.visitorCount !== undefined && svc.visitorCount !== null ? svc.visitorCount : 1;
      const serviceTotal = priceForService * svcVisitorCount;
      console.log(`Service ${svc.serviceName}: ${svcVisitorCount} tickets × ${priceForService} = ${serviceTotal}`);
      return sum + serviceTotal;
    }, 0);
    total = subtotal;
  } else if (servicePackage && packageServiceDetails.length === 0) {
    // Package but service details not loaded yet - use package price as fallback
    subtotal = servicePackage.total_price || 0;
    total = subtotal;
    console.log('Package pricing fallback (service details not loaded):', {
      packagePrice: servicePackage.total_price,
      subtotal,
      total
    });
  } else {
    // Regular service booking - use offer price if selected, otherwise base_price
    subtotal = basePrice * visitorCount;
    total = subtotal;
  }
  
  console.log('Final pricing calculation:', {
    servicePackage: !!servicePackage,
    packageServiceDetailsCount: packageServiceDetails.length,
    subtotal,
    total,
    visitorCount,
    bookingDataFromState: {
      visitorCount: bookingDataFromState?.visitorCount || bookingDataFromState?.adultCount,
      packageServices: bookingDataFromState?.packageServices?.length || 0
    },
    packageServiceDetails: packageServiceDetails.map(s => ({
      name: s.serviceName,
      visitorCount: s.visitorCount,
      base_price: s.base_price
    }))
  });
  
  // Update visitor count based on actual ticket counts
  useEffect(() => {
    if (servicePackage && packageServiceDetails.length > 0) {
      // For packages, sum up all visitor counts from packageServiceDetails
      const totalVisitors = packageServiceDetails.reduce((sum, svc) => {
        const svcVisitorCount = svc.visitorCount !== undefined && svc.visitorCount !== null ? svc.visitorCount : 1;
        return sum + svcVisitorCount;
      }, 0);
      setVisitorCount(totalVisitors);
    }
    // For regular services, visitorCount is already set
  }, [packageServiceDetails, servicePackage]);

  // Check if maintenance mode is enabled and user is a customer
  const isMaintenanceMode = tenant?.maintenance_mode === true;
  const isCustomer = !userProfile || userProfile?.role === 'customer';
  const isBlockedByMaintenance = isMaintenanceMode && isCustomer;

  // Handle booking submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Block customers during maintenance mode
    if (isBlockedByMaintenance) {
      alert(i18n.language === 'ar' 
        ? 'الحجوزات معطلة مؤقتاً. يرجى زيارة موقعنا شخصياً لإجراء الحجز.'
        : 'Bookings are temporarily disabled. Please visit us in person to make a reservation.'
      );
      return;
    }
    
    if (!customerInfo.name || !customerInfo.phone) {
      alert(t('checkout.pleaseFillAllRequiredFields'));
      return;
    }

    // For package purchase, skip service/slot validation
    if (!isPackagePurchase) {
      if (!service || !slot) {
        alert(t('checkout.pleaseFillAllRequiredFields'));
        return;
      }

      // Ensure at least one ticket
      if (visitorCount === 0 || visitorCount < 1) {
        alert(t('checkout.pleaseSelectAtLeastOneTicket'));
        return;
      }
    }

    // For guest bookings, require OTP verification
    if (!isLoggedIn && otpStep !== 'verified') {
      alert(i18n.language === 'ar' ? 'يرجى التحقق من رقم الهاتف أولاً' : 'Please verify your phone number first');
      return;
    }

    // Validate phone number before submission
    const phoneValidation = validatePhoneNumber(customerInfo.phone, countryCode);
    if (!phoneValidation.valid) {
      setPhoneError(phoneValidation.error || null);
      alert(phoneValidation.error || t('checkout.invalidPhoneNumber'));
      return;
    }

    setSubmitting(true);

    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      // Handle package purchase
      if (isPackagePurchase && servicePackage) {
        // Get customer ID if logged in
        // Note: customers table doesn't have user_id, so we match by email/phone
        let customerId = null;
        if (isLoggedIn && userProfile?.id) {
          // Get user's email and phone to find matching customer record
          const { data: userData } = await db
            .from('users')
            .select('email, phone')
            .eq('id', userProfile.id)
            .eq('tenant_id', tenant.id)
            .maybeSingle();
          
          if (userData) {
            // Try to find customer by email first
            if (userData.email) {
              const { data: customerByEmail } = await db
                .from('customers')
                .select('id')
                .eq('tenant_id', tenant.id)
                .eq('email', userData.email)
                .maybeSingle();
              
              if (customerByEmail) {
                customerId = customerByEmail.id;
              }
            }
            
            // If not found by email, try by phone
            if (!customerId && userData.phone) {
              const { data: customerByPhone } = await db
                .from('customers')
                .select('id')
                .eq('tenant_id', tenant.id)
                .eq('phone', userData.phone)
                .maybeSingle();
              
              if (customerByPhone) {
                customerId = customerByPhone.id;
              }
            }
          }
        }

        if (packagePaymentMethod === 'transfer' && !packageTransactionReference.trim()) {
          setSubmitting(false);
          alert(i18n.language === 'ar' ? 'رقم المرجع مطلوب عند الدفع بالحوالة.' : 'Transaction reference number is required for transfer payment.');
          return;
        }

        // Create package subscription
        const subscriptionUrl = `${API_URL}/packages/subscriptions`;
        const subscriptionPayload: Record<string, unknown> = {
          tenant_id: tenant.id,
          package_id: servicePackage.id,
          customer_id: customerId,
          customer_name: customerInfo.name,
          customer_email: customerInfo.email || null,
          customer_phone: customerPhoneFull || `${countryCode}${customerInfo.phone}`,
          total_price: servicePackage.total_price,
        };
        if (packagePaymentMethod) subscriptionPayload.payment_method = packagePaymentMethod;
        if (packagePaymentMethod === 'transfer' && packageTransactionReference.trim()) subscriptionPayload.transaction_reference = packageTransactionReference.trim();

        console.log('[Checkout] Creating package subscription:', {
          url: subscriptionUrl,
          payload: { ...subscriptionPayload, customer_phone: '***' }, // Hide phone in logs
        });

        const subscriptionResponse = await fetch(subscriptionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify(subscriptionPayload),
        });

        if (!subscriptionResponse.ok) {
          // Try to parse error as JSON, but handle HTML responses
          let errorData;
          const contentType = subscriptionResponse.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            errorData = await subscriptionResponse.json();
          } else {
            const text = await subscriptionResponse.text();
            console.error('Non-JSON error response:', text.substring(0, 200));
            throw new Error(`Server error (${subscriptionResponse.status}): ${subscriptionResponse.statusText}`);
          }
          throw new Error(errorData.error || 'Failed to create package subscription');
        }

        // Ensure response is JSON before parsing
        const contentType = subscriptionResponse.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await subscriptionResponse.text();
          console.error('Non-JSON success response:', text.substring(0, 200));
          throw new Error('Server returned invalid response format');
        }

        const subscriptionResult = await subscriptionResponse.json();

        // Navigate to success page
        navigate(`/${tenantSlug}/book/success`, {
          state: {
            subscriptionId: subscriptionResult.subscription.id,
            subscription: subscriptionResult.subscription,
            isPackagePurchase: true,
          },
        });
        return;
      }

      // Regular booking flow
      // Calculate actual visitor count
      const actualVisitorCount = servicePackage && packageServiceDetails.length > 0
        ? packageServiceDetails.reduce((sum, svc) => {
            const svcVisitorCount = svc.visitorCount !== undefined && svc.visitorCount !== null ? svc.visitorCount : 1;
            return sum + svcVisitorCount;
          }, 0)
        : visitorCount;

      // Acquire booking lock first
      const lockResponse = await fetch(`${API_URL}/bookings/lock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          slot_id: slot!.id,
          reserved_capacity: actualVisitorCount,
        }),
      });

      if (!lockResponse.ok) {
        const errorData = await lockResponse.json();
        throw new Error(errorData.error || t('checkout.failedToReserveSlot'));
      }

      const lockData = await lockResponse.json();

      // Create booking
      const bookingResponse = await fetch(`${API_URL}/bookings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          tenant_id: tenant.id,
          service_id: service!.id,
          slot_id: slot!.id,
          customer_name: customerInfo.name,
          customer_email: customerInfo.email || null,
          customer_phone: customerPhoneFull || `${countryCode}${customerInfo.phone}`, // Use full phone number
          visitor_count: actualVisitorCount,
          total_price: total,
          notes: null,
          lock_id: lockData.lock_id,
          session_id: lockData.session_id,
          package_id: servicePackage?.id || null, // Include package_id if booking is for a package
          offer_id: selectedOffer?.id || null, // Include offer_id if offer is selected
          language: i18n.language // Customer's selected language
        }),
      });

      if (!bookingResponse.ok) {
        const errorData = await bookingResponse.json();
        throw new Error(errorData.error || t('checkout.failedToCreateBooking'));
      }

      const bookingResult = await bookingResponse.json();

      // Navigate to success page
      navigate(`/${tenantSlug}/book/success`, {
        state: {
          bookingId: bookingResult.booking.id,
          booking: bookingResult.booking,
        },
      });
    } catch (error: any) {
      console.error('Error creating booking/subscription:', error);
      
      // Check if error is due to maintenance mode
      if (error.message && error.message.includes('temporarily disabled')) {
        alert(i18n.language === 'ar' 
          ? 'الحجوزات معطلة مؤقتاً. يرجى زيارة موقعنا شخصياً لإجراء الحجز.'
          : 'Bookings are temporarily disabled. Please visit us in person to make a reservation.'
        );
      } else if (error.code === 'BOOKING_DISABLED_MAINTENANCE') {
        alert(i18n.language === 'ar' 
          ? 'الحجوزات معطلة مؤقتاً. يرجى زيارة موقعنا شخصياً لإجراء الحجز.'
          : 'Bookings are temporarily disabled. Please visit us in person to make a reservation.'
        );
      } else {
        alert(error.message || 'Failed to complete purchase. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: primaryColor }}></div>
          <p className="text-gray-600">Loading checkout...</p>
        </div>
      </div>
    );
  }

  // For package purchase, only tenant and servicePackage are required
  // For regular booking, service, slot, and tenant are required
  if (isPackagePurchase) {
    if (!servicePackage || !tenant) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">{i18n.language === 'ar' ? 'معلومات الحزمة غير موجودة' : 'Package information not found'}</h1>
            <p className="text-gray-600 mt-2">{i18n.language === 'ar' ? 'يرجى اختيار حزمة مرة أخرى' : 'Please select a package again.'}</p>
            <Button
              onClick={() => navigate(`/${tenantSlug}/book`)}
              className="mt-4"
              style={{ backgroundColor: primaryColor }}
            >
              {i18n.language === 'ar' ? 'العودة' : 'Go Back'}
            </Button>
          </div>
        </div>
      );
    }
  } else {
    if (!service || !slot || !tenant) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">{i18n.language === 'ar' ? 'معلومات الحجز غير موجودة' : 'Booking information not found'}</h1>
            <p className="text-gray-600 mt-2">{i18n.language === 'ar' ? 'يرجى اختيار خدمة ووقت مرة أخرى' : 'Please select a service and time slot again.'}</p>
            <Button
              onClick={() => navigate(`/${tenantSlug}/book`)}
              className="mt-4"
              style={{ backgroundColor: primaryColor }}
            >
              {i18n.language === 'ar' ? 'العودة' : 'Go Back'}
            </Button>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Maintenance Mode Warning Banner */}
      {isBlockedByMaintenance && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-amber-800">
              {i18n.language === 'ar' 
                ? 'الحجوزات معطلة مؤقتاً. يرجى زيارة موقعنا شخصياً لإجراء الحجز.'
                : 'Bookings are temporarily disabled. Please visit us in person to make a reservation.'}
            </p>
          </div>
        </div>
      )}
      
      {/* Header - Matching Public Booking Page Style */}
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
                  {t('checkout.title')}
                </span>
              </div>
            </div>

            {/* Actions Section */}
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/${tenantSlug}/book/${service.id}`)}
                className="transition-all duration-300 hover:scale-105"
                style={{ 
                  color: primaryColor,
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('checkout.back')}
              </Button>
              <div className="h-6 w-px bg-gray-300"></div>
              <LanguageToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content - Customer Information & Booking Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Booking Summary Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" style={{ color: primaryColor }} />
                  {t('checkout.bookingSummary')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Service/Package Name */}
                <div className="flex items-start gap-4">
                  {(servicePackage?.image_url || servicePackage?.gallery_urls?.[0] || service?.image_url) && (
                    <img
                      src={
                        servicePackage?.image_url || 
                        servicePackage?.gallery_urls?.[0] || 
                        service?.image_url
                      }
                      alt={
                        servicePackage 
                          ? (i18n.language === 'ar' ? servicePackage.name_ar : servicePackage.name)
                          : (i18n.language === 'ar' ? service?.name_ar : service?.name) || ''
                      }
                      className="w-20 h-20 rounded-lg object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {servicePackage 
                        ? formatPackageName(servicePackage, i18n.language)
                        : selectedOffer
                        ? (i18n.language === 'ar' ? selectedOffer.name_ar || selectedOffer.name : selectedOffer.name)
                        : (i18n.language === 'ar' ? service?.name_ar : service?.name) || ''
                      }
                    </h3>
                    {servicePackage && (
                      <p className="text-sm text-gray-500 mt-1">
                        {i18n.language === 'ar' ? servicePackage.name_ar : servicePackage.name}
                      </p>
                    )}
                    {!servicePackage && selectedOffer && service && (
                      <p className="text-sm text-gray-500 mt-1">
                        {i18n.language === 'ar' ? service.name_ar : service.name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Date & Time - Only show for regular bookings, not package purchases */}
                {!isPackagePurchase && bookingData && slot && (
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">{t('checkout.date')}</p>
                        <p className="text-sm font-medium text-gray-900">
                          {format(new Date(bookingData.date), 'EEEE, MMMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">{t('checkout.time')}</p>
                        <p className="text-sm font-medium text-gray-900">
                          {slot.start_time} - {slot.end_time}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Package Info - Only show for package purchases */}
                {isPackagePurchase && servicePackage && (
                  <div className="pt-4 border-t">
                    <p className="text-sm text-gray-600 mb-2">
                      {i18n.language === 'ar' ? 'بعد الشراء، يمكنك حجز الخدمات في أي وقت متاح' : 'After purchase, you can book services at any available time'}
                    </p>
                    {servicePackage.services && servicePackage.services.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-gray-500 mb-2">
                          {i18n.language === 'ar' ? 'الخدمات المشمولة:' : 'Included Services:'}
                        </p>
                        <ul className="list-disc list-inside space-y-1">
                          {servicePackage.services.map((svc, idx) => (
                            <li key={idx} className="text-sm text-gray-700">
                              {i18n.language === 'ar' ? svc.service_name_ar : svc.service_name}
                              <span className="text-gray-500 ml-1">
                                ({svc.quantity} {i18n.language === 'ar' ? 'حجز' : 'booking(s)'})
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

              </CardContent>
            </Card>

            {/* Customer Information Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" style={{ color: primaryColor }} />
                  {t('checkout.customerInformation')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <Input
                    label={i18n.language === 'ar' ? 'الاسم الكامل' : 'Full Name'}
                    value={customerInfo.name}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
                    required
                    placeholder={t('checkout.enterFullName')}
                  />

                  {/* Phone Number with OTP Verification for Guests */}
                  {!isLoggedIn && otpStep === 'phone' && (
                    <>
                      <PhoneInput
                        label={t('checkout.phoneNumber')}
                        value={customerPhoneFull}
                        onChange={(value) => {
                          setCustomerPhoneFull(value);
                          // Extract country code and phone number for backward compatibility
                          let phoneNumber = value;
                          let code = '+966';
                          for (const country of countryCodes) {
                            if (value.startsWith(country.code)) {
                              code = country.code;
                              phoneNumber = value.replace(country.code, '');
                              break;
                            }
                          }
                          setCountryCode(code);
                          setCustomerInfo({ ...customerInfo, phone: phoneNumber });
                          // Validate phone number
                          if (phoneNumber.length > 0) {
                            const validation = validatePhoneNumber(phoneNumber, code);
                            setPhoneError(validation.valid ? null : validation.error || null);
                          } else {
                            setPhoneError(null);
                          }
                          // Reset OTP state when phone changes
                          setOtpSent(false);
                          setOtpStep('phone');
                        }}
                        defaultCountry="+966"
                        required
                        error={phoneError || phoneUniquenessError || undefined}
                        disabled={otpLoading}
                      />
                      
                      {/* Send OTP Button */}
                      <Button
                        type="button"
                        onClick={sendOTPToPhone}
                        disabled={!customerPhoneFull || !!phoneError || otpLoading || !customerInfo.name}
                        fullWidth
                        style={{ backgroundColor: primaryColor }}
                      >
                        {otpLoading 
                          ? (i18n.language === 'ar' ? 'جاري الإرسال...' : 'Sending...')
                          : t('checkout.sendVerificationCode')
                        }
                      </Button>
                    </>
                  )}

                  {/* OTP Input Step */}
                  {!isLoggedIn && otpStep === 'otp' && (
                    <>
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800 mb-2">
                          {i18n.language === 'ar' 
                            ? `تم إرسال رمز التحقق إلى ${customerPhoneFull}. يرجى إدخال الرمز أدناه.`
                            : `Verification code sent to ${customerPhoneFull}. Please enter the code below.`
                          }
                        </p>
                      </div>
                      
                      <Input
                        type="text"
                        label={t('checkout.verificationCode')}
                        value={otpCode}
                        onChange={(e) => {
                          const code = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
                          setOtpCode(code);
                        }}
                        placeholder={i18n.language === 'ar' ? 'أدخل الرمز المكون من 6 أرقام' : 'Enter 6-digit code'}
                        required
                        maxLength={6}
                        className="text-center text-2xl tracking-widest"
                      />
                      
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setOtpStep('phone');
                            setOtpCode('');
                            setOtpSent(false);
                          }}
                          fullWidth
                        >
                          {t('checkout.changeNumber')}
                        </Button>
                        <Button
                          type="button"
                          onClick={async () => {
                            if (otpCode.length !== 6) {
                              setPhoneUniquenessError(i18n.language === 'ar' ? 'الرمز يجب أن يكون 6 أرقام' : 'Code must be 6 digits');
                              return;
                            }
                            
                            setOtpLoading(true);
                            setPhoneUniquenessError(null);
                            
                            try {
                              const API_URL = getApiUrl();
                              const response = await fetch(`${API_URL}/auth/guest/verify-otp`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  phone: customerPhoneFull,
                                  otp: otpCode,
                                }),
                                signal: createTimeoutSignal('/auth/guest/verify-otp', false),
                              });
                              
                              const data = await response.json();
                              
                              if (!response.ok) {
                                throw new Error(data.error || t('checkout.invalidVerificationCode'));
                              }
                              
                              setOtpStep('verified');
                              setPhoneUniquenessChecked(true);
                            } catch (err: any) {
                              setPhoneUniquenessError(err.message || t('checkout.invalidVerificationCode'));
                            } finally {
                              setOtpLoading(false);
                            }
                          }}
                          disabled={otpCode.length !== 6 || otpLoading}
                          fullWidth
                          style={{ backgroundColor: primaryColor }}
                        >
                          {otpLoading 
                            ? (i18n.language === 'ar' ? 'جاري التحقق...' : 'Verifying...')
                            : (i18n.language === 'ar' ? 'التحقق' : 'Verify')
                          }
                        </Button>
                      </div>

                      <div className="text-center mt-4">
                        <button
                          type="button"
                          onClick={sendOTPToPhone}
                          disabled={resendCooldown > 0 || otpLoading}
                          className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed underline"
                        >
                          {otpLoading 
                            ? (i18n.language === 'ar' ? 'جارٍ الإرسال...' : 'Sending...')
                            : resendCooldown > 0
                            ? (i18n.language === 'ar' 
                                ? `إعادة الإرسال (${resendCooldown}ث)`
                                : `Resend code (${resendCooldown}s)`)
                            : (i18n.language === 'ar' ? 'إعادة إرسال رمز التحقق' : 'Resend verification code')
                          }
                        </button>
                      </div>
                    </>
                  )}

                  {/* Phone Verified (for guests) or Regular Input (for logged-in users) */}
                  {((isLoggedIn) || (otpStep === 'verified')) && (
                    <PhoneInput
                      label={i18n.language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}
                      value={customerPhoneFull}
                      onChange={(value) => {
                        setCustomerPhoneFull(value);
                        let phoneNumber = value;
                        let code = '+966';
                        for (const country of countryCodes) {
                          if (value.startsWith(country.code)) {
                            code = country.code;
                            phoneNumber = value.replace(country.code, '');
                            break;
                          }
                        }
                        setCountryCode(code);
                        setCustomerInfo({ ...customerInfo, phone: phoneNumber });
                        if (phoneNumber.length > 0) {
                          const validation = validatePhoneNumber(phoneNumber, code);
                          setPhoneError(validation.valid ? null : validation.error || null);
                        } else {
                          setPhoneError(null);
                        }
                      }}
                      defaultCountry="+966"
                      required
                      error={phoneError || undefined}
                      disabled={!isLoggedIn && otpStep === 'verified'} // Disable if verified (guest)
                    />
                  )}

                  {/* Verified Badge for Guests */}
                  {!isLoggedIn && otpStep === 'verified' && (
                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="text-sm text-green-800">
                        {i18n.language === 'ar' ? 'تم التحقق من رقم الهاتف بنجاح' : 'Phone number verified successfully'}
                      </span>
                    </div>
                  )}

                  <Input
                    type="email"
                    label={i18n.language === 'ar' ? 'البريد الإلكتروني' : 'Email'}
                    value={customerInfo.email}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                    placeholder={i18n.language === 'ar' ? 'your@email.com' : 'your@email.com'}
                  />
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Order Summary & Pricing */}
          <div className="lg:col-span-1">
            <Card className="sticky top-24">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5" style={{ color: primaryColor }} />
                  {i18n.language === 'ar' ? 'ملخص الطلب' : 'Order Summary'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Package Services List */}
                {servicePackage && servicePackage.services && servicePackage.services.length > 0 && (
                  <div className="mb-4 pb-4 border-b">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">
                      {i18n.language === 'ar' ? 'الخدمات المتضمنة' : 'Included Services'}
                    </h4>
                    <div className="space-y-2">
                      {servicePackage.services.map((svc, idx) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <span className="text-gray-600">
                            {i18n.language === 'ar' ? svc.service_name_ar : svc.service_name}
                            {svc.quantity > 1 && ` (×${svc.quantity})`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Price Breakdown */}
                <div className="space-y-3">
                  {servicePackage && packageServiceDetails.length > 0 ? (
                    <>
                      {/* Package Pricing - Show breakdown per service */}
                      {packageServiceDetails.map((svc, idx) => {
                        const priceForService = svc.base_price || 0;
                        const svcVisitorCount = svc.visitorCount !== undefined && svc.visitorCount !== null ? svc.visitorCount : 1;
                        const serviceTotal = priceForService * svcVisitorCount;
                        
                        return (
                          <div key={idx} className="pb-3 border-b last:border-b-0 last:pb-0">
                            <div className="text-sm font-medium text-gray-700 mb-2">
                              {i18n.language === 'ar' ? svc.serviceName_ar : svc.serviceName}
                            </div>
                            <div className="flex justify-between text-xs text-gray-600 mb-1">
                              <span>
                                {i18n.language === 'ar' ? 'عدد التذاكر' : 'Tickets'} × {svcVisitorCount}
                              </span>
                              <span>
                                {formatPrice(priceForService)} × {svcVisitorCount} = {formatPrice(serviceTotal)}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm font-medium text-gray-900 mt-2">
                              <span>{i18n.language === 'ar' ? 'المجموع' : 'Subtotal'}</span>
                              <span>{formatPrice(serviceTotal)}</span>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-between items-center pt-3 border-t-2 border-gray-300 mt-3">
                        <span className="text-lg font-semibold text-gray-900">
                          {i18n.language === 'ar' ? 'السعر الإجمالي' : 'Total Price'}
                        </span>
                        <span className="text-xl font-bold" style={{ color: primaryColor }}>
                          {formatPrice(total)}
                        </span>
                      </div>
                    </>
                  ) : servicePackage ? (
                    <>
                      {/* Fallback to package price if service details not loaded */}
                      {servicePackage.original_price && servicePackage.original_price > servicePackage.total_price && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600 line-through">
                            {i18n.language === 'ar' ? 'السعر الأصلي' : 'Original Price'}
                          </span>
                          <span className="text-gray-500 line-through">
                            {formatPrice(servicePackage.original_price)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-semibold text-gray-900">
                          {i18n.language === 'ar' ? 'السعر الإجمالي' : 'Total Price'}
                        </span>
                        <span className="text-xl font-bold" style={{ color: primaryColor }}>
                          {formatPrice(total)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Selected Offer Display */}
                      {selectedOffer && (
                        <div className="mb-4 pb-3 border-b">
                          <div className="text-sm font-semibold text-gray-700 mb-2">
                            {i18n.language === 'ar' ? 'العرض المحدد' : 'Selected Offer'}
                          </div>
                          <div className="text-sm text-gray-900">
                            {i18n.language === 'ar' ? selectedOffer.name_ar || selectedOffer.name : selectedOffer.name}
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-sm text-gray-600">
                              {i18n.language === 'ar' ? 'سعر العرض' : 'Offer Price'}
                            </span>
                            <div className="text-right">
                              {selectedOffer.original_price && selectedOffer.original_price > selectedOffer.price && (
                                <div className="text-xs text-gray-400 line-through mb-1">
                                  {formatPrice(selectedOffer.original_price)}
                                </div>
                              )}
                              <span className="text-sm font-semibold text-gray-900">
                                {formatPrice(selectedOffer.price)}
                              </span>
                              {selectedOffer.discount_percentage && selectedOffer.discount_percentage > 0 && (
                                <div className="text-xs text-green-600 mt-1">
                                  -{selectedOffer.discount_percentage}%
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Base Price Display (only if no offer) */}
                      {!selectedOffer && (
                        <div className="mb-4 pb-3 border-b">
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-gray-600">
                              {i18n.language === 'ar' ? 'السعر الأساسي' : 'Base Price'}
                            </span>
                            <span className="text-gray-900">
                              {formatPrice(basePrice)}
                            </span>
                          </div>
                          {service?.original_price && service.original_price > service.base_price && (
                            <>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600 line-through">
                                  {i18n.language === 'ar' ? 'السعر الأصلي' : 'Original Price'}
                                </span>
                                <span className="text-gray-500 line-through">
                                  {formatPrice(originalPrice)}
                                </span>
                              </div>
                              {serviceDiscount > 0 && (
                                <div className="flex justify-between text-sm text-green-600">
                                  <span className="flex items-center gap-1">
                                    <Percent className="w-3 h-3" />
                                    {i18n.language === 'ar' ? 'خصم الخدمة' : 'Service Discount'}
                                  </span>
                                  <span>-{serviceDiscount}%</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {/* Base Price & Original Price Display (for services with discounts, no offer) */}
                      {!selectedOffer && service && service.original_price && service.original_price > service.base_price && (
                        <div className="mb-4 pb-3 border-b space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">{i18n.language === 'ar' ? 'السعر الأساسي' : 'Base Price'}</span>
                            <span className="text-gray-900">{formatPrice(service.base_price)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">{i18n.language === 'ar' ? 'السعر الأصلي' : 'Original Price'}</span>
                            <span className="text-gray-400 line-through">{formatPrice(service.original_price)}</span>
                          </div>
                          {service.discount_percentage && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">{i18n.language === 'ar' ? 'خصم الخدمة' : 'Service Discount'}</span>
                              <span className="text-green-600 font-semibold">-{service.discount_percentage}%</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Quantity Display */}
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">
                          {i18n.language === 'ar' ? 'الكمية' : 'Quantity'}
                        </span>
                        <span className="text-gray-900">× {visitorCount}</span>
                      </div>

                      <div className="pt-3 border-t">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-gray-600">
                            {i18n.language === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}
                          </span>
                          <span className="text-gray-900 font-medium">
                            {formatPrice(subtotal)}
                          </span>
                        </div>

                        <div className="pt-3 border-t">
                          <div className="flex justify-between items-center">
                            <span className="text-lg font-semibold text-gray-900">
                              {i18n.language === 'ar' ? 'الإجمالي' : 'Total'}
                            </span>
                            <span 
                              className="text-2xl font-bold"
                              style={{ color: primaryColor }}
                            >
                              {formatPrice(total)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Capacity Warning */}
                {(() => {
                  const actualVisitorCount = servicePackage && packageServiceDetails.length > 0
                    ? packageServiceDetails.reduce((sum, svc) => {
                        const svcVisitorCount = svc.visitorCount !== undefined && svc.visitorCount !== null ? svc.visitorCount : 1;
                        return sum + svcVisitorCount;
                      }, 0)
                    : visitorCount;
                  
                  return slotCapacity !== null && slotCapacity < actualVisitorCount ? (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-700">
                        {t('common.notEnoughCapacity', { available: slotCapacity, requested: actualVisitorCount })}
                      </p>
                    </div>
                  ) : null;
                })()}

                {/* Package Partial Coverage Warning */}
                {!isPackagePurchase && packageCapacity && packageCapacity.remaining > 0 && packageCapacity.remaining < visitorCount && (
                  <div className="mt-4 p-4 bg-yellow-50 border border-yellow-300 rounded-lg">
                    <div className="flex items-start gap-3">
                      <Package className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-yellow-800 mb-1">
                          {i18n.language === 'ar' ? 'تنبيه التغطية الجزئية' : 'Partial Package Coverage'}
                        </p>
                        <p className="text-sm text-yellow-700">
                          {i18n.language === 'ar' 
                            ? `حزمتك تغطي ${packageCapacity.remaining} حجز. سيتم دفع ${visitorCount - packageCapacity.remaining} حجز بشكل طبيعي.`
                            : `Your package covers ${packageCapacity.remaining} booking${packageCapacity.remaining !== 1 ? 's' : ''}. The remaining ${visitorCount - packageCapacity.remaining} booking${(visitorCount - packageCapacity.remaining) !== 1 ? 's will' : ' will'} be charged normally.`}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Package Exhausted Warning */}
                {!isPackagePurchase && packageCapacity && packageCapacity.remaining === 0 && (
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-300 rounded-lg">
                    <div className="flex items-start gap-3">
                      <Package className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-blue-800 mb-1">
                          {i18n.language === 'ar' ? 'تنبيه الحزمة' : 'Package Notice'}
                        </p>
                        <p className="text-sm text-blue-700">
                          {i18n.language === 'ar' 
                            ? 'حزمتك لهذه الخدمة مستخدمة بالكامل. سيتم دفع هذا الحجز بشكل طبيعي.'
                            : 'Your package for this service is fully used. This booking will be charged normally.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Package purchase: Payment method (same as bookings) */}
                {isPackagePurchase && servicePackage && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      {i18n.language === 'ar' ? 'طريقة الدفع' : 'Payment method'}
                    </p>
                    <div className="flex flex-wrap gap-4 mb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="packagePaymentMethod"
                          checked={packagePaymentMethod === 'onsite'}
                          onChange={() => { setPackagePaymentMethod('onsite'); setPackageTransactionReference(''); }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm">{i18n.language === 'ar' ? 'مدفوع يدوياً' : 'Paid On Site'}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="packagePaymentMethod"
                          checked={packagePaymentMethod === 'transfer'}
                          onChange={() => setPackagePaymentMethod('transfer')}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm">{i18n.language === 'ar' ? 'حوالة بنكية' : 'Bank Transfer'}</span>
                      </label>
                    </div>
                    {packagePaymentMethod === 'transfer' && (
                      <div className="mt-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {i18n.language === 'ar' ? 'رقم المرجع' : 'Transaction reference'} *
                        </label>
                        <input
                          type="text"
                          value={packageTransactionReference}
                          onChange={(e) => setPackageTransactionReference(e.target.value)}
                          placeholder={i18n.language === 'ar' ? 'رقم المرجع أو الحوالة' : 'Transfer reference number'}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* CTA Button */}
                <Button
                  type="submit"
                  fullWidth
                  size="lg"
                  onClick={handleSubmit}
                  disabled={(() => {
                    const actualVisitorCount = servicePackage && packageServiceDetails.length > 0
                      ? packageServiceDetails.reduce((sum, svc) => {
                          const svcVisitorCount = svc.visitorCount !== undefined && svc.visitorCount !== null ? svc.visitorCount : 1;
                          return sum + svcVisitorCount;
                        }, 0)
                      : visitorCount;
                    
                    return submitting || 
                      isBlockedByMaintenance || // Block during maintenance mode
                      !customerInfo.name || 
                      !customerInfo.phone || 
                      !!phoneError ||
                      (isPackagePurchase && packagePaymentMethod === 'transfer' && !packageTransactionReference.trim()) ||
                      (slotCapacity !== null && slotCapacity < actualVisitorCount) ||
                      total <= 0 ||
                      (!isLoggedIn && otpStep !== 'verified') || // Require OTP verification for guests
                      (visitorCount === 0 || visitorCount < 1); // Require at least one ticket
                  })()}
                  className="mt-6"
                  style={{ 
                    backgroundColor: primaryColor,
                    borderColor: primaryColor,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = secondaryColor;
                    e.currentTarget.style.borderColor = secondaryColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = primaryColor;
                    e.currentTarget.style.borderColor = primaryColor;
                  }}
                >
                  {submitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      {i18n.language === 'ar' ? 'جاري المعالجة...' : 'Processing...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2" />
                      {i18n.language === 'ar' ? 'إتمام الحجز والدفع' : 'Complete Booking & Pay'}
                    </>
                  )}
                </Button>

                {/* Terms & Conditions */}
                <p className="text-xs text-gray-500 text-center mt-4">
                  {i18n.language === 'ar' 
                    ? 'بالضغط على "إتمام الحجز"، أنت توافق على الشروط والأحكام'
                    : 'By clicking "Complete Booking", you agree to our Terms & Conditions'}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

