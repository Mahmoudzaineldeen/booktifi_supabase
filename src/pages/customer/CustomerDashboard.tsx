import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { Calendar, Clock, LogOut, Star, MessageSquare, Package, CalendarOff, UserCircle, CheckCircle, XCircle, User, FileText, TrendingUp, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { ReviewForm } from '../../components/reviews/ReviewForm';
import { Modal } from '../../components/ui/Modal';
import { getApiUrl } from '../../lib/apiUrl';

interface Booking {
  id: string;
  service_id: string;
  service_name: string;
  service_name_ar: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  status: string;
  total_price: number;
  review_id?: string;
  rating?: number;
  review_approved?: boolean;
}

export function CustomerDashboard() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { userProfile, signOut, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<any>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'bookings' | 'packages'>('bookings');
  const [packages, setPackages] = useState<any[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);

  useEffect(() => {
    // Wait for AuthContext to finish loading before checking authentication
    if (authLoading) {
      return;
    }

    // Check if session exists in localStorage (might be loading from there)
    const sessionStr = localStorage.getItem('auth_session');
    const token = localStorage.getItem('auth_token');
    
    // If we have session data but no userProfile yet, wait a bit more
    if ((sessionStr || token) && !userProfile) {
      console.log('[CustomerDashboard] Session exists in localStorage but userProfile not loaded yet, waiting...');
      return;
    }

    // If no session and no userProfile after loading, redirect to login
    if (!userProfile || userProfile.role !== 'customer') {
      console.log('[CustomerDashboard] No userProfile or wrong role, redirecting to login', {
        hasUserProfile: !!userProfile,
        role: userProfile?.role,
        hasSession: !!(sessionStr || token)
      });
      navigate(`/${tenantSlug}/customer/login`);
      return;
    }

    // User is authenticated and is a customer, proceed
    fetchTenant();
    fetchBookings();
    if (activeTab === 'packages') {
      fetchPackages();
    }
  }, [userProfile, tenantSlug, authLoading, navigate, activeTab]);

  async function fetchTenant() {
    try {
      const { data } = await db
        .from('tenants')
        .select('id, name, name_ar, slug, landing_page_settings')
        .eq('slug', tenantSlug)
        .maybeSingle();
      
      if (data) {
        setTenant(data);
      }
    } catch (err) {
      console.error('Error fetching tenant:', err);
    }
  }

  async function fetchBookings() {
    if (!userProfile) return;

    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/customers/bookings`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch bookings');

      const data = await response.json();
      console.log('[CustomerDashboard] Fetched bookings:', data.length, 'bookings');
      // Log Nov 28 booking specifically
      const nov28Booking = data.find((b: Booking) => b.slot_date && b.slot_date.includes('2025-11-28'));
      if (nov28Booking) {
        console.log('[CustomerDashboard] Found Nov 28 booking:', {
          id: nov28Booking.id,
          slot_date: nov28Booking.slot_date,
          service: nov28Booking.service_name || nov28Booking.service_name_ar,
          status: nov28Booking.status
        });
      }
      setBookings(data);
    } catch (err) {
      console.error('Error fetching bookings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPackages() {
    if (!userProfile) return;

    try {
      setPackagesLoading(true);
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/customers/packages`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // Try to get detailed error from response
        let errorMessage = 'Failed to fetch packages';
        let errorDetails: any = null;
        
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            errorDetails = await response.json();
            errorMessage = errorDetails.error || errorDetails.message || errorMessage;
            if (errorDetails.details) {
              errorMessage += `: ${errorDetails.details}`;
            }
            console.error('[CustomerDashboard] Package fetch error details:', errorDetails);
          } else {
            const text = await response.text();
            console.error('[CustomerDashboard] Non-JSON error response:', text.substring(0, 200));
            errorMessage = `Server error (${response.status}): ${response.statusText}`;
          }
        } catch (parseError) {
          console.error('[CustomerDashboard] Error parsing error response:', parseError);
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('[CustomerDashboard] Fetched packages:', data.length, 'packages');
      setPackages(data || []);
    } catch (err: any) {
      console.error('[CustomerDashboard] Error fetching packages:', err);
      console.error('[CustomerDashboard] Error message:', err.message);
      setPackages([]);
    } finally {
      setPackagesLoading(false);
    }
  }

  async function handleLogout() {
    await signOut();
    navigate(`/${tenantSlug}/book`);
  }

  // Helper function to parse slot date string to Date object
  const parseSlotDate = (slotDateStr: string): Date | null => {
    if (!slotDateStr) return null;
    
    // Try YYYY-MM-DD format first (most common)
    const dateParts = slotDateStr.split('-');
    if (dateParts.length === 3) {
      const [year, month, day] = dateParts.map(Number);
      if (year && month && day) {
        const date = new Date(year, month - 1, day); // month is 0-indexed in JS
        date.setHours(0, 0, 0, 0);
        return date;
      }
    }
    
    // Try parsing as ISO date string
    const isoDate = new Date(slotDateStr);
    if (!isNaN(isoDate.getTime())) {
      isoDate.setHours(0, 0, 0, 0);
      return isoDate;
    }
    
    console.warn('[CustomerDashboard] Could not parse slot_date:', slotDateStr);
    return null;
  };

  // Helper function to check if a booking is expired
  const isBookingExpired = (b: Booking): boolean => {
    // If status is completed or cancelled, it's expired
    if (b.status === 'completed' || b.status === 'cancelled') {
      return true;
    }
    
    // If no slot date, can't determine - not expired
    if (!b.slot_date) {
      return false;
    }
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    today.setHours(0, 0, 0, 0);
    
    // Parse the slot date
    const slotDate = parseSlotDate(b.slot_date);
    if (!slotDate) {
      return false;
    }
    
    // If slot date is in the past, it's expired
    if (slotDate.getTime() < today.getTime()) {
      return true;
    }
    
    // If slot date is today, check the end time
    if (slotDate.getTime() === today.getTime()) {
      if (!b.end_time) {
        // If no end time, use a conservative approach
        // If it's past noon and no end time specified, consider it expired
        const currentHour = now.getHours();
        return currentHour >= 12;
      }
      
      // Parse end time (format: HH:MM or HH:MM:SS)
      const timeParts = b.end_time.split(':');
      const hours = parseInt(timeParts[0], 10);
      const minutes = parseInt(timeParts[1] || '0', 10);
      
      // Create booking end datetime by combining slot date with end time
      const bookingEndDateTime = new Date(slotDate);
      bookingEndDateTime.setHours(hours, minutes, 0, 0);
      
      // Debug logging for bookings ending around current time
      const timeDiff = now.getTime() - bookingEndDateTime.getTime();
      if (Math.abs(timeDiff) < 5 * 60 * 1000) { // Within 5 minutes of end time
        console.log('[CustomerDashboard] Checking booking near end time:', {
          slot_date: b.slot_date,
          end_time: b.end_time,
          bookingEndDateTime: bookingEndDateTime.toISOString(),
          now: now.toISOString(),
          timeDiffMinutes: Math.round(timeDiff / (60 * 1000)),
          isExpired: bookingEndDateTime <= now,
          service: b.service_name || b.service_name_ar
        });
      }
      
      // Booking is expired if the end time has passed (or is exactly now)
      return bookingEndDateTime <= now;
    }
    
    // If slot date is in the future, it's not expired
    return false;
  };

  const upcomingBookings = bookings.filter(b => {
    // If it's expired, it's NOT upcoming
    if (isBookingExpired(b)) {
      return false;
    }
    
    // If no slot date, can't determine
    if (!b.slot_date) {
      return false;
    }
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    today.setHours(0, 0, 0, 0);
    
    // Parse the slot date using helper function
    const slotDate = parseSlotDate(b.slot_date);
    if (!slotDate) {
      return false;
    }
    
    // If slot date is in the past, it's NOT upcoming
    if (slotDate.getTime() < today.getTime()) {
      return false;
    }
    
    // If slot date is today, check the end time
    if (slotDate.getTime() === today.getTime()) {
      if (!b.end_time) {
        return b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'pending';
      }
      const [hours, minutes] = b.end_time.split(':').map(Number);
      const bookingEndDateTime = new Date(slotDate);
      bookingEndDateTime.setHours(hours, minutes, 0, 0);
      return bookingEndDateTime > now;
    }
    
    // If slot date is in the future, it's upcoming (if status allows)
    return b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'pending';
  }).sort((a, b) => {
    const dateA = new Date(`${a.slot_date}T${a.start_time || '00:00'}`);
    const dateB = new Date(`${b.slot_date}T${b.start_time || '00:00'}`);
    return dateA.getTime() - dateB.getTime();
  });

  // Expired bookings: all bookings that are expired (NOT in upcoming)
  const expiredBookings = bookings.filter(b => {
    const isExpired = isBookingExpired(b);
    // Debug logging for Nov 28 booking
    if (b.slot_date && (b.slot_date.includes('2025-11-28') || b.slot_date.includes('Nov 28'))) {
      console.log('[CustomerDashboard] Expired filter for Nov 28:', {
        id: b.id,
        slot_date: b.slot_date,
        status: b.status,
        isExpired,
        service: b.service_name || b.service_name_ar
      });
    }
    return isExpired;
  }).sort((a, b) => {
    const dateA = new Date(`${a.slot_date}T${a.start_time || '00:00'}`);
    const dateB = new Date(`${b.slot_date}T${b.start_time || '00:00'}`);
    return dateB.getTime() - dateA.getTime(); // Most recent first
  });

  // Debug: Log final results
  useEffect(() => {
    if (bookings.length > 0) {
      console.log('[CustomerDashboard] Bookings summary:', {
        total: bookings.length,
        upcoming: upcomingBookings.length,
        expired: expiredBookings.length,
        upcomingDates: upcomingBookings.map(b => b.slot_date),
        expiredDates: expiredBookings.map(b => b.slot_date)
      });
    }
  }, [bookings, upcomingBookings, expiredBookings]);

  const canReview = (booking: Booking) => {
    return booking.status === 'completed' && !booking.review_id;
  };

  // Parse landing_page_settings
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
  const tenantName = tenant ? (i18n.language === 'ar' ? tenant.name_ar : tenant.name) : 'Bookati';

  // Show loading while auth is loading or data is loading
  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}15 100%)` }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: primaryColor }}></div>
          <p className="text-gray-600" style={{ color: primaryColor }}>
            {authLoading ? 'Authenticating...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Tenant not found</h1>
          <p className="text-gray-600 mb-4">The tenant you're looking for doesn't exist.</p>
          <Button onClick={() => navigate('/')}>Go Home</Button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen" 
      style={{ 
        background: `linear-gradient(135deg, ${primaryColor}08 0%, ${secondaryColor}08 100%)`
      }}
    >
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
                  {tenantName}
                </h1>
                <span className="text-sm text-gray-500 font-medium">
                  {i18n.language === 'ar' ? 'لوحة تحكم العميل' : 'Customer Dashboard'}
                </span>
              </div>
            </div>

            {/* Actions Section */}
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/${tenantSlug}/book`)}
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
                <Package className="w-4 h-4 mr-2" />
                {i18n.language === 'ar' ? 'احجز خدمة' : 'Book Service'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/${tenantSlug}/customer/billing`)}
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
                <FileText className="w-4 h-4 mr-2" />
                {i18n.language === 'ar' ? 'الفواتير' : 'Billing'}
              </Button>
              <div className="h-6 w-px bg-gray-300"></div>
              <LanguageToggle />
              <div className="h-6 w-px bg-gray-300"></div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
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
                <LogOut className="w-4 h-4 mr-2" />
                {i18n.language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section - Matching Landing Page Hero Style */}
        <div className="mb-12 text-center py-8 rounded-2xl" style={{ 
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
          boxShadow: `0 10px 30px ${primaryColor}30`
        }}>
          <div className="flex items-center justify-center gap-3 mb-3">
            <UserCircle className="w-8 h-8 md:w-10 md:h-10 text-white" />
            <h1 className="text-4xl md:text-5xl font-bold text-white">
              My Dashboard
            </h1>
          </div>
          <p className="text-xl text-white/90">
            {t('dashboard.welcomeBack', { 
              name: (i18n.language === 'ar' 
                ? (userProfile?.full_name_ar || userProfile?.full_name || userProfile?.email?.split('@')[0] || '')
                : (userProfile?.full_name || userProfile?.email?.split('@')[0] || ''))
            })}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-8 flex gap-4 border-b-2" style={{ borderColor: `${primaryColor}20` }}>
          <button
            onClick={() => setActiveTab('bookings')}
            className={`px-6 py-3 font-semibold text-lg transition-all duration-300 border-b-2 ${
              activeTab === 'bookings'
                ? 'text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            style={{
              borderColor: activeTab === 'bookings' ? primaryColor : 'transparent',
              backgroundColor: activeTab === 'bookings' ? primaryColor : 'transparent',
              borderRadius: activeTab === 'bookings' ? '8px 8px 0 0' : '0',
            }}
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {i18n.language === 'ar' ? 'حجوزاتي' : 'My Bookings'}
            </div>
          </button>
          <button
            onClick={() => {
              setActiveTab('packages');
              if (packages.length === 0 && !packagesLoading) {
                fetchPackages();
              }
            }}
            className={`px-6 py-3 font-semibold text-lg transition-all duration-300 border-b-2 ${
              activeTab === 'packages'
                ? 'text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            style={{
              borderColor: activeTab === 'packages' ? primaryColor : 'transparent',
              backgroundColor: activeTab === 'packages' ? primaryColor : 'transparent',
              borderRadius: activeTab === 'packages' ? '8px 8px 0 0' : '0',
            }}
          >
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              {i18n.language === 'ar' ? 'حزمي' : 'My Packages'}
            </div>
          </button>
        </div>

        {/* My Packages Tab Content */}
        {activeTab === 'packages' && (
          <div>
            {packagesLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: primaryColor }}></div>
                <p className="text-gray-600">{i18n.language === 'ar' ? 'جاري التحميل...' : 'Loading packages...'}</p>
              </div>
            ) : packages.length > 0 ? (
              <div className="space-y-6">
                {packages.map((pkg: any) => {
                  const totalUsed = pkg.usage?.reduce((sum: number, u: any) => sum + (u.used_quantity || 0), 0) || 0;
                  const totalRemaining = pkg.usage?.reduce((sum: number, u: any) => sum + (u.remaining_quantity || 0), 0) || 0;
                  const totalOriginal = pkg.usage?.reduce((sum: number, u: any) => sum + (u.original_quantity || 0), 0) || 0;
                  const usagePercentage = totalOriginal > 0 ? Math.round((totalUsed / totalOriginal) * 100) : 0;

                  return (
                    <Card key={pkg.id} className="border-2 hover:shadow-xl transition-all duration-300" style={{ borderColor: `${primaryColor}20` }}>
                      <CardHeader className="pb-4" style={{ borderBottom: `2px solid ${primaryColor}20` }}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <CardTitle className="text-2xl font-bold mb-2" style={{ color: primaryColor }}>
                              {i18n.language === 'ar' ? pkg.package_name_ar : pkg.package_name}
                            </CardTitle>
                            {pkg.package_description && (
                              <p className="text-gray-600 text-sm">
                                {i18n.language === 'ar' ? pkg.package_description_ar : pkg.package_description}
                              </p>
                            )}
                          </div>
                          {pkg.package_image_url && (
                            <img
                              src={pkg.package_image_url}
                              alt={i18n.language === 'ar' ? pkg.package_name_ar : pkg.package_name}
                              className="w-24 h-24 rounded-lg object-cover ml-4"
                            />
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="pt-6">
                        {/* Overall Usage Summary */}
                        <div className="mb-6 p-4 rounded-lg" style={{ backgroundColor: `${primaryColor}08` }}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <BarChart3 className="w-5 h-5" style={{ color: primaryColor }} />
                              <span className="font-semibold text-gray-700">
                                {i18n.language === 'ar' ? 'إجمالي الاستهلاك' : 'Total Consumption'}
                              </span>
                            </div>
                            <span className="text-lg font-bold" style={{ color: primaryColor }}>
                              {usagePercentage}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                            <div
                              className="h-3 rounded-full transition-all duration-300"
                              style={{
                                width: `${usagePercentage}%`,
                                backgroundColor: primaryColor,
                              }}
                            ></div>
                          </div>
                          <div className="flex items-center justify-between text-sm text-gray-600">
                            <span>
                              {i18n.language === 'ar' ? 'مستخدم' : 'Used'}: {totalUsed} / {totalOriginal}
                            </span>
                            <span>
                              {i18n.language === 'ar' ? 'متبقي' : 'Remaining'}: {totalRemaining}
                            </span>
                          </div>
                        </div>

                        {/* Service-wise Usage */}
                        <div>
                          <h3 className="text-lg font-semibold mb-4" style={{ color: primaryColor }}>
                            {i18n.language === 'ar' ? 'الاستهلاك حسب الخدمة' : 'Consumption by Service'}
                          </h3>
                          <div className="space-y-4">
                            {pkg.usage && pkg.usage.length > 0 ? (
                              pkg.usage.map((usage: any, index: number) => {
                                const serviceUsagePercentage = usage.original_quantity > 0
                                  ? Math.round((usage.used_quantity / usage.original_quantity) * 100)
                                  : 0;
                                
                                return (
                                  <div key={usage.service_id || index} className="p-4 border rounded-lg" style={{ borderColor: `${primaryColor}20` }}>
                                    <div className="flex items-center justify-between mb-3">
                                      <h4 className="font-semibold text-gray-900">
                                        {i18n.language === 'ar' ? usage.service_name_ar : usage.service_name}
                                      </h4>
                                      <span className="text-sm font-medium" style={{ color: primaryColor }}>
                                        {serviceUsagePercentage}%
                                      </span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                                      <div
                                        className="h-2 rounded-full transition-all duration-300"
                                        style={{
                                          width: `${serviceUsagePercentage}%`,
                                          backgroundColor: primaryColor,
                                        }}
                                      ></div>
                                    </div>
                                    <div className="flex items-center justify-between text-sm text-gray-600">
                                      <div className="flex items-center gap-4">
                                        <span>
                                          <TrendingUp className="w-4 h-4 inline mr-1" style={{ color: primaryColor }} />
                                          {i18n.language === 'ar' ? 'مستخدم' : 'Used'}: {usage.used_quantity}
                                        </span>
                                        <span>
                                          <Package className="w-4 h-4 inline mr-1" style={{ color: primaryColor }} />
                                          {i18n.language === 'ar' ? 'متبقي' : 'Remaining'}: {usage.remaining_quantity}
                                        </span>
                                      </div>
                                      <span className="text-gray-500">
                                        {i18n.language === 'ar' ? 'الإجمالي' : 'Total'}: {usage.original_quantity}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-gray-500 text-center py-4">
                                {i18n.language === 'ar' ? 'لا توجد خدمات في هذه الحزمة' : 'No services in this package'}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Package Status */}
                        <div className="mt-6 pt-4 border-t flex items-center justify-between" style={{ borderColor: `${primaryColor}20` }}>
                          <div className="flex items-center gap-2">
                            {pkg.is_active ? (
                              <CheckCircle className="w-5 h-5 text-green-600" />
                            ) : (
                              <XCircle className="w-5 h-5 text-gray-400" />
                            )}
                            <span className="text-sm font-medium text-gray-700">
                              {pkg.is_active
                                ? (i18n.language === 'ar' ? 'نشط' : 'Active')
                                : (i18n.language === 'ar' ? 'غير نشط' : 'Inactive')}
                            </span>
                          </div>
                          <span className="text-sm text-gray-500">
                            {i18n.language === 'ar' ? 'تم الشراء في' : 'Purchased on'}: {format(new Date(pkg.created_at), 'MMM dd, yyyy')}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="border-2" style={{ borderColor: `${primaryColor}20` }}>
                <CardContent className="text-center py-16">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
                    <Package className="w-10 h-10" style={{ color: primaryColor }} />
                  </div>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <Package className="w-6 h-6" style={{ color: primaryColor }} />
                    <h3 className="text-2xl font-bold" style={{ color: primaryColor }}>
                      {i18n.language === 'ar' ? 'لا توجد حزم' : 'No Packages'}
                    </h3>
                  </div>
                  <p className="text-gray-600 mb-6 text-lg">
                    {i18n.language === 'ar' 
                      ? 'لم تقم بشراء أي حزم بعد. ابدأ بشراء حزمة للحصول على خصومات!' 
                      : "You haven't purchased any packages yet. Start by purchasing a package to get discounts!"}
                  </p>
                  <Button 
                    onClick={() => navigate(`/${tenantSlug}/book`)}
                    className="font-semibold px-8 py-3 text-lg"
                    style={{ 
                      backgroundColor: primaryColor,
                      color: 'white',
                      borderColor: primaryColor
                    }}
                  >
                    <Package className="w-5 h-5 mr-2" />
                    {i18n.language === 'ar' ? 'تصفح الحزم' : 'Browse Packages'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* My Bookings Tab Content */}
        {activeTab === 'bookings' && (
          <>
            {/* Upcoming Bookings */}
            {upcomingBookings.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <Calendar className="w-6 h-6" style={{ color: primaryColor }} />
              <h2 className="text-3xl font-bold" style={{ color: primaryColor }}>
                {i18n.language === 'ar' ? 'الحجوزات القادمة' : 'Upcoming Bookings'}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {upcomingBookings.map((booking) => (
                <Card key={booking.id} className="hover:shadow-xl transition-all duration-300 border-2" style={{ borderColor: `${primaryColor}20` }}>
                  <CardHeader className="pb-3" style={{ borderBottom: `2px solid ${primaryColor}20` }}>
                    <CardTitle className="text-lg font-bold" style={{ color: primaryColor }}>
                      {i18n.language === 'ar' 
                        ? (booking.service_name_ar || booking.service_name) 
                        : (booking.service_name || booking.service_name_ar)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-gray-700">
                        <Calendar className="w-5 h-5" style={{ color: primaryColor }} />
                        <span className="font-medium">{format(new Date(booking.slot_date), 'MMM dd, yyyy')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-700">
                        <Clock className="w-5 h-5" style={{ color: primaryColor }} />
                        <span className="font-medium">{booking.start_time} - {booking.end_time}</span>
                      </div>
                      <div className="pt-3 border-t flex items-center gap-2" style={{ borderColor: `${primaryColor}20` }}>
                        {booking.status === 'confirmed' ? (
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        ) : (
                          <Clock className="w-4 h-4" style={{ color: secondaryColor }} />
                        )}
                        <span className="text-sm font-semibold text-gray-700">
                          Status:{' '}
                          <span className="px-2 py-1 rounded-full text-xs font-bold" style={{
                            backgroundColor: booking.status === 'confirmed' ? `${primaryColor}20` : `${secondaryColor}20`,
                            color: booking.status === 'confirmed' ? primaryColor : secondaryColor
                          }}>
                            {booking.status}
                          </span>
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Expired Bookings - Separate Section */}
        {expiredBookings.length > 0 && (
          <div className="mt-12">
            <div className="flex items-center gap-3 mb-6">
              <CalendarOff className="w-6 h-6" style={{ color: primaryColor }} />
              <h2 className="text-3xl font-bold" style={{ color: primaryColor }}>
                {i18n.language === 'ar' ? 'الحجوزات المنتهية' : 'Expired Bookings'}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {expiredBookings.map((booking) => (
                <Card key={booking.id} className="hover:shadow-xl transition-all duration-300 border-2" style={{ borderColor: `${primaryColor}20` }}>
                  <CardHeader className="pb-3" style={{ borderBottom: `2px solid ${primaryColor}20` }}>
                    <CardTitle className="text-lg font-bold" style={{ color: primaryColor }}>
                      {i18n.language === 'ar' 
                        ? (booking.service_name_ar || booking.service_name) 
                        : (booking.service_name || booking.service_name_ar)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-gray-700">
                        <Calendar className="w-5 h-5" style={{ color: primaryColor }} />
                        <span className="font-medium">{format(new Date(booking.slot_date), 'MMM dd, yyyy')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-700">
                        <Clock className="w-5 h-5" style={{ color: primaryColor }} />
                        <span className="font-medium">{booking.start_time} - {booking.end_time}</span>
                      </div>
                      {booking.review_id && (
                        <div className="flex items-center gap-2 pt-3 border-t" style={{ borderColor: `${primaryColor}20` }}>
                          <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                          <span className="text-sm font-medium text-gray-700">
                            Reviewed
                            {booking.review_approved ? '' : ' (Pending)'}
                          </span>
                        </div>
                      )}
                      {canReview(booking) && (
                        <Button
                          size="sm"
                          fullWidth
                          className="mt-3 font-semibold"
                          style={{ 
                            backgroundColor: primaryColor,
                            color: 'white',
                            borderColor: primaryColor
                          }}
                          onClick={() => {
                            setSelectedBooking(booking);
                            setShowReviewForm(true);
                          }}
                        >
                          <MessageSquare className="w-4 h-4 mr-2" />
                          Write Review
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

            {bookings.length === 0 && (
              <Card className="border-2" style={{ borderColor: `${primaryColor}20` }}>
                <CardContent className="text-center py-16">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
                    <CalendarOff className="w-10 h-10" style={{ color: primaryColor }} />
                  </div>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <CalendarOff className="w-6 h-6" style={{ color: primaryColor }} />
                    <h3 className="text-2xl font-bold" style={{ color: primaryColor }}>
                      {i18n.language === 'ar' ? 'لا توجد حجوزات' : 'No Bookings'}
                    </h3>
                  </div>
                  <p className="text-gray-600 mb-6 text-lg">
                    {i18n.language === 'ar' ? 'ابدأ بحجز خدمة' : 'Start by booking a service'}
                  </p>
                  <Button 
                    onClick={() => navigate(`/${tenantSlug}/book`)}
                    className="font-semibold px-8 py-3 text-lg"
                    style={{ 
                      backgroundColor: primaryColor,
                      color: 'white',
                      borderColor: primaryColor
                    }}
                  >
                    <Package className="w-5 h-5 mr-2" />
                    {i18n.language === 'ar' ? 'احجز خدمة' : 'Book Service'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Review Form Modal */}
      {showReviewForm && selectedBooking && (
        <ReviewForm
          bookingId={selectedBooking.id}
          serviceId={selectedBooking.service_id || selectedBooking.id}
          onClose={() => {
            setShowReviewForm(false);
            setSelectedBooking(null);
          }}
          onSuccess={() => {
            setShowReviewForm(false);
            setSelectedBooking(null);
            fetchBookings();
          }}
        />
      )}
    </div>
  );
}

