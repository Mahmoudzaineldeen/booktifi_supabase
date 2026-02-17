import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { safeTranslateStatus, safeTranslate } from '../../lib/safeTranslation';
import { getPaymentDisplayLabel, getPaymentDisplayValue, PAYMENT_DISPLAY_KEYS } from '../../lib/paymentDisplay';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { Calendar, Plus, User, Phone, Mail, Clock, CheckCircle, XCircle, LogOut, CalendarDays, DollarSign, List, Grid, ChevronLeft, ChevronRight, X, Package, QrCode, Scan, Download, FileText, Search, Edit, CalendarClock, Users, Ban } from 'lucide-react';
import { ReceptionPackagesPage } from './ReceptionPackagesPage';
import { ReceptionVisitorsPage } from './ReceptionVisitorsPage';
import { QRScanner } from '../../components/qr/QRScanner';
import { format, addDays, startOfWeek, isSameDay, parseISO, startOfDay, endOfDay, addMinutes, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { countryCodes } from '../../lib/countryCodes';
import { getApiUrl } from '../../lib/apiUrl';
import { useTenantDefaultCountry } from '../../hooks/useTenantDefaultCountry';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { createTimeoutSignal } from '../../lib/requestTimeout';
import { extractBookingIdFromQR } from '../../lib/qrUtils';
import { fetchAvailableSlots as fetchAvailableSlotsUtil, Slot as AvailabilitySlot } from '../../lib/bookingAvailability';
import { BookingConfirmationModal } from '../../components/shared/BookingConfirmationModal';
import { SubscriptionConfirmationModal, type SubscriptionConfirmationData } from '../../components/shared/SubscriptionConfirmationModal';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';
import { useCustomerPhoneSearch, type CustomerSuggestion } from '../../hooks/useCustomerPhoneSearch';
import { CustomerPhoneSuggestionsDropdown } from '../../components/reception/CustomerPhoneSuggestionsDropdown';
import { formatTimeTo12Hour, formatDateTimeTo12Hour } from '../../lib/timeFormat';

interface Booking {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  visitor_count: number;
  total_price: number;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  notes: string | null;
  created_at: string;
  booking_group_id: string | null;
  zoho_invoice_id?: string | null;
  zoho_invoice_created_at?: string | null;
  package_covered_quantity?: number; // Number of tickets covered by package
  paid_quantity?: number; // Number of tickets that must be paid
  package_subscription_id?: string | null; // Package subscription ID if used
  services: {
    name: string;
    name_ar: string;
  };
  slots: {
    slot_date: string;
    start_time: string;
    end_time: string;
  };
  slot_id?: string;
  users: {
    id?: string;
    full_name: string;
    full_name_ar: string;
  } | null;
  /** Populated when grouping: array of employee user objects from users:employee_id */
  employees?: Array<{ id?: string; full_name: string; full_name_ar?: string }>;
}

/** Normalize employee display: use employees array (from grouping) or single users relation. */
function getBookingEmployees(booking: Booking | Record<string, any>): Array<{ id?: string; full_name: string; full_name_ar?: string }> {
  const b = booking as Record<string, any>;
  if (b?.employees?.length) return b.employees;
  if (b?.users && typeof b.users === 'object') return [b.users];
  return [];
}

interface ServiceOffer {
  id: string;
  name: string;
  name_ar: string | null;
  price: number;
  original_price: number | null;
  discount_percentage: number | null;
  is_active: boolean;
}

interface Service {
  id: string;
  name: string;
  name_ar: string;
  base_price: number; // This is the final price (discounted if discount exists)
  original_price?: number | null;
  discount_percentage?: number | null;
  capacity_per_slot: number;
  capacity_mode?: 'employee_based' | 'service_based';
  offers?: ServiceOffer[]; // Service offers
}

interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  available_capacity: number;
  booked_count: number;
  employee_id?: string | null;
  users?: {
    full_name: string;
    full_name_ar: string;
  } | null;
}

interface PackageUsage {
  service_id: string;
  original_quantity: number;
  remaining_quantity: number;
  used_quantity: number;
  services: {
    name: string;
    name_ar: string;
  };
}

interface CustomerPackage {
  id: string;
  package_id: string;
  status: 'active' | 'expired' | 'cancelled';
  expires_at: string | null;
  service_packages: {
    name: string;
    name_ar: string;
    total_price: number;
  };
  usage: PackageUsage[];
}

export function ReceptionPage() {
  const { t, i18n } = useTranslation();
  const { userProfile, tenant, signOut, loading: authLoading } = useAuth();
  const { formatPrice, formatPriceString } = useCurrency();
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantSlug: routeTenantSlug } = useParams<{ tenantSlug?: string }>();
  const tenantSlugForNav = routeTenantSlug || (typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : '');
  const isVisitorsPath = location.pathname.includes('/reception/visitors');
  const tenantDefaultCountry = useTenantDefaultCountry();
  const { features: tenantFeatures } = useTenantFeatures(userProfile?.tenant_id);
  const schedulingMode = (tenantFeatures?.scheduling_mode ?? 'service_slot_based') as 'employee_based' | 'service_slot_based';
  const isEmployeeBasedMode = schedulingMode === 'employee_based';
  const tenantAssignmentMode = (tenantFeatures?.employee_assignment_mode ?? 'both') as 'automatic' | 'manual' | 'both';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [todayBookings, setTodayBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmationBookingId, setConfirmationBookingId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedService, setSelectedService] = useState<string>('');
  const [selectedOffer, setSelectedOffer] = useState<string>(''); // Selected service offer ID
  const [selectedServices, setSelectedServices] = useState<Array<{service: Service, slot: Slot, employeeId: string}>>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'today' | 'all'>('today');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [currentView, setCurrentView] = useState<'bookings' | 'packages'>('bookings');
  const [selectedBookingForDetails, setSelectedBookingForDetails] = useState<Booking | null>(null);
  const [isEditBookingModalOpen, setIsEditBookingModalOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editingBookingTime, setEditingBookingTime] = useState<Booking | null>(null);
  const [editingTimeDate, setEditingTimeDate] = useState<Date>(new Date());
  const [availableTimeSlots, setAvailableTimeSlots] = useState<Slot[]>([]);
  const [loadingTimeSlots, setLoadingTimeSlots] = useState(false);
  const [selectedNewSlotId, setSelectedNewSlotId] = useState<string>('');
  const [changeTimeEmployeeId, setChangeTimeEmployeeId] = useState<string>('');
  const [updatingBookingTime, setUpdatingBookingTime] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'automatic' | 'manual'>('automatic');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<{start_time: string, end_time: string, slot_date: string} | null>(null);
  const [availableEmployees, setAvailableEmployees] = useState<Array<{id: string, name: string, name_ar: string, bookingCount: number}>>([]);
  const [isLookingUpCustomer, setIsLookingUpCustomer] = useState(false);
  const [countryCode, setCountryCode] = useState(tenantDefaultCountry); // Use tenant's default country code
  const [customerPhoneFull, setCustomerPhoneFull] = useState(''); // Full phone number with country code
  const [customerPackages, setCustomerPackages] = useState<CustomerPackage[]>([]);
  const [customerIsBlocked, setCustomerIsBlocked] = useState(false);
  const [bookingSelectedCustomer, setBookingSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [subscriptionCustomerLookup, setSubscriptionCustomerLookup] = useState<any>(null);
  const [subscriptionSelectedCustomer, setSubscriptionSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [subscriptionPhoneFull, setSubscriptionPhoneFull] = useState(''); // Full phone number with country code
  const [isLookingUpSubscriptionCustomer, setIsLookingUpSubscriptionCustomer] = useState(false);
  const [subscriptionForm, setSubscriptionForm] = useState({
    customer_phone: '',
    customer_name: '',
    customer_email: '',
    package_id: ''
  });
  const [subscriptionPaymentMethod, setSubscriptionPaymentMethod] = useState<'unpaid' | 'onsite' | 'transfer'>('onsite');
  const [subscriptionTransactionReference, setSubscriptionTransactionReference] = useState('');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [subscriptionConfirmationData, setSubscriptionConfirmationData] = useState<SubscriptionConfirmationData | null>(null);

  const [bookingForm, setBookingForm] = useState({
    customer_phone: '',
    customer_name: '',
    customer_email: '',
    visitor_count: 1,
    notes: '',
    booking_option: 'consecutive' as 'consecutive' | 'parallel'
  });
  const [manualSlotAssignments, setManualSlotAssignments] = useState<Array<{slotIndex: number, employeeId: string, slotId: string}>>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  /** When set, create booking modal is closed and full-screen loading overlay is shown (creating_booking -> creating_invoice) */
  const [bookingCreationLoadingStep, setBookingCreationLoadingStep] = useState<null | 'creating_booking' | 'creating_invoice'>(null);
  const [selectedSlots, setSelectedSlots] = useState<Array<{slot_id: string, start_time: string, end_time: string, employee_id: string, slot_date: string}>>([]);

  // QR Code Validation State
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);
  const [qrInputValue, setQrInputValue] = useState('');
  const [qrValidating, setQrValidating] = useState(false);
  const [qrValidationResult, setQrValidationResult] = useState<{success: boolean; message: string; booking?: any} | null>(null);
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null);

  // Search state
  type SearchType = 'phone' | 'customer_name' | 'date' | 'service_name' | 'booking_id' | '';
  const [searchType, setSearchType] = useState<SearchType>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDate, setSearchDate] = useState<string>(''); // For date picker
  const [searchResults, setSearchResults] = useState<Booking[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchValidationError, setSearchValidationError] = useState<string>('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bookingPhoneWrapperRef = useRef<HTMLDivElement>(null);
  const subscriptionPhoneWrapperRef = useRef<HTMLDivElement>(null);
  const { suggestions: bookingPhoneSuggestions, loading: bookingPhoneSearchLoading, clearSuggestions: clearBookingPhoneSuggestions } = useCustomerPhoneSearch(userProfile?.tenant_id, customerPhoneFull);
  const { suggestions: subscriptionPhoneSuggestions, loading: subscriptionPhoneSearchLoading, clearSuggestions: clearSubscriptionPhoneSuggestions } = useCustomerPhoneSearch(userProfile?.tenant_id, subscriptionPhoneFull);

  const [markPaidBookingId, setMarkPaidBookingId] = useState<string | null>(null);
  const [markPaidMethod, setMarkPaidMethod] = useState<'onsite' | 'transfer'>('onsite');
  const [markPaidReference, setMarkPaidReference] = useState('');
  const [markPaidSubmitting, setMarkPaidSubmitting] = useState(false);

  // Create booking: payment method (when booking has payable amount). 'unpaid' | 'onsite' | 'transfer'
  const [createPaymentMethod, setCreatePaymentMethod] = useState<'unpaid' | 'onsite' | 'transfer'>('onsite');
  const [createTransactionReference, setCreateTransactionReference] = useState('');

  const isCoordinator = (userProfile?.role as string) === 'coordinator';

  // Track if initial auth check has been completed
  const [initialAuthDone, setInitialAuthDone] = useState(false);
  const initialLoadRef = useRef(false); // Use ref to prevent multiple loads

  // Initial auth check - only runs once after auth is loaded
  useEffect(() => {
    // Don't run if already done (using ref for extra protection)
    if (initialLoadRef.current || initialAuthDone) {
      return;
    }

    // Wait for auth to finish loading
    if (authLoading) {
      console.log('Reception: Auth still loading...');
      return;
    }

    console.log('Reception: Initial auth check', { userProfile, role: userProfile?.role });

    if (!userProfile) {
      console.log('Reception: No user profile, redirecting to login');
      navigate('/login');
      return;
    }

    // Allow receptionist, coordinator, tenant_admin, customer_admin, and admin_user (coordinator is view + confirm only)
    const allowedRoles = ['receptionist', 'coordinator', 'tenant_admin', 'customer_admin', 'admin_user'];
    if (!allowedRoles.includes(userProfile.role)) {
      console.log('ReceptionPage: Wrong role, redirecting. Expected: receptionist, coordinator, tenant_admin, customer_admin, or admin_user, Got:', userProfile.role);
      if (userProfile.role === 'cashier') {
        // Redirect cashiers to their own page
        const tenantSlug = window.location.pathname.split('/')[1];
        navigate(`/${tenantSlug}/cashier`);
      } else {
      navigate('/');
      }
      return;
    }

    // Mark as started to prevent duplicate runs
    initialLoadRef.current = true;
    console.log('ReceptionPage: User is receptionist, loading initial data...');
    sessionStorage.setItem('reception_logged_in', 'true');
    setInitialAuthDone(true);
    
    // Load data in parallel and handle errors gracefully
    Promise.all([
      fetchServices().catch(err => {
        console.error('Error in fetchServices:', err);
        return null;
      }),
      fetchPackages().catch(err => {
        console.error('Error in fetchPackages:', err);
        return null;
      }),
      fetchBookings().catch(err => {
        console.error('Error in fetchBookings:', err);
        return null;
      })
    ]).finally(() => {
      console.log('Reception: Initial data loading completed');
      setLoading(false);
    });
  }, [authLoading, userProfile, navigate, initialAuthDone]); // Run when auth state changes, but only once

  // Monitor for actual logout ONLY after initial auth is done
  useEffect(() => {
    // Don't run logout check until initial auth is complete
    if (!initialAuthDone || authLoading) return;

    console.log('Reception: Monitoring session', { userProfile: !!userProfile, authLoading });

    // Only redirect if user profile disappears after successful initial auth
    if (!userProfile) {
      // Add a delay to prevent false positives during state updates
      const timeoutId = setTimeout(() => {
        console.log('Reception: Session lost, redirecting to login');
        sessionStorage.removeItem('reception_logged_in');
        navigate('/login');
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [userProfile, authLoading, navigate, initialAuthDone]);

  useEffect(() => {
    if (selectedService && selectedDate) {
      fetchAvailableSlots();
    }
  }, [selectedService, selectedDate]);

  // Populate employee dropdown as soon as a service is selected (so "Select employee" has options before date is picked)
  useEffect(() => {
    if (userProfile?.tenant_id && selectedService) {
      const dateStr = format(selectedDate || new Date(), 'yyyy-MM-dd');
      fetchEmployeeBookingCounts(dateStr, []);
    } else {
      setAvailableEmployees([]);
    }
  }, [selectedService, userProfile?.tenant_id]);

  // Mode separation: in employee-based mode use tenant assignment mode; in service-based mode always automatic (no employee selection)
  useEffect(() => {
    if (isEmployeeBasedMode) {
      const mode = tenantAssignmentMode === 'manual' ? 'manual' : 'automatic';
      setAssignmentMode(mode);
    } else {
      setAssignmentMode('automatic');
      setSelectedEmployee('');
      setSelectedSlot('');
    }
  }, [isEmployeeBasedMode, tenantAssignmentMode]);


  // Clear selected slots when key parameters change
  useEffect(() => {
    setSelectedSlots([]);
  }, [selectedService, selectedDate, bookingForm.visitor_count, bookingForm.booking_option]);

  // Calculate required slots based on booking mode
  function getRequiredSlotsCount(): number {
    if (bookingForm.visitor_count <= 1) return 1;

    if (bookingForm.booking_option === 'consecutive') {
      // Consecutive: need N slots where N = quantity (same employee, different times)
      return bookingForm.visitor_count;
    } else {
      // Parallel: need only 1 time slot (system will auto-assign multiple employees at same time)
      return 1;
    }
  }

  // Validate slot selection
  function validateSlotSelection(): { valid: boolean; message: string } {
    // If booking multiple tickets, first check if a single slot can handle all tickets
    if (bookingForm.visitor_count > 1 && selectedTimeSlot) {
      const slotsAtTime = slots.filter(
        s => s.start_time === selectedTimeSlot.start_time &&
             s.end_time === selectedTimeSlot.end_time &&
             s.available_capacity > 0
      );
      
      // Check if any slot has enough capacity for all tickets
      const slotWithEnoughCapacity = slotsAtTime.find(s => s.available_capacity >= bookingForm.visitor_count);
      if (slotWithEnoughCapacity) {
        // Can book all tickets in one slot - no need to select multiple slots
        return { valid: true, message: 'All tickets can be booked in the same time slot' };
      }
    }

    const required = getRequiredSlotsCount();

    if (selectedSlots.length < required) {
      return {
        valid: false,
        message: `${required - selectedSlots.length} more slot(s) required`
      };
    }

    if (selectedSlots.length > required) {
      return {
        valid: false,
        message: `Too many slots selected. Only ${required} needed.`
      };
    }

    // Consecutive mode: validate same employee
    if (bookingForm.booking_option === 'consecutive' && selectedSlots.length > 1) {
      const firstEmployeeId = selectedSlots[0].employee_id;
      const allSameEmployee = selectedSlots.every(s => s.employee_id === firstEmployeeId);

      if (!allSameEmployee) {
        return {
          valid: false,
          message: 'Please select slots from the same employee for consecutive booking'
        };
      }
    }

    // Parallel mode: validate sufficient employee availability at selected time
    if (bookingForm.booking_option === 'parallel' && bookingForm.visitor_count > 1 && selectedSlots.length === 1) {
      const selectedSlot = selectedSlots[0];
      const slotsAtSameTime = slots.filter(
        s => s.start_time === selectedSlot.start_time &&
             s.end_time === selectedSlot.end_time &&
             s.available_capacity > 0
      );

      if (slotsAtSameTime.length < bookingForm.visitor_count) {
        return {
          valid: false,
          message: `Not enough employees available. Need ${bookingForm.visitor_count}, only ${slotsAtSameTime.length} available at this time.`
        };
      }
    }

    return { valid: true, message: 'All required slots selected' };
  }

  // Handle slot click for multi-selection
  function handleSlotClick(slot: Slot, event?: React.MouseEvent) {
    // Check if right-click or Ctrl+Click to remove one instance
    const isRemoveAction = event?.ctrlKey || event?.metaKey || event?.button === 2;
    
    if (isRemoveAction) {
      // Remove the last instance of this slot
      const slotIndex = selectedSlots.map(s => s.slot_id).lastIndexOf(slot.id);
      if (slotIndex !== -1) {
        setSelectedSlots(prev => {
          const newSlots = [...prev];
          newSlots.splice(slotIndex, 1);
          if (newSlots.length === 0) setSelectedSlot('');
          else if (newSlots.length === 1) setSelectedSlot(newSlots[0].slot_id);
          return newSlots;
        });
      }
      return;
    }

    // Check if we can add more slots
    const required = getRequiredSlotsCount();
    const currentCount = selectedSlots.length;
    
    // Allow adding slots up to the required count (or visitor_count if booking multiple tickets)
    const maxSlots = bookingForm.visitor_count > 1 ? bookingForm.visitor_count : required;
    
    if (currentCount >= maxSlots) {
      // Check if we can still add this specific slot (if it's the same slot, allow multiple)
      const sameSlotCount = selectedSlots.filter(s => s.slot_id === slot.id).length;
      const slotCapacity = slot.available_capacity || 0;
      
      if (sameSlotCount >= slotCapacity) {
        showNotification('warning', t('common.maximumCapacityReached', { available: slotCapacity }));
        return;
      }
      
      // If we've reached max but this is a different slot, show message
      if (sameSlotCount === 0) {
        showNotification('warning', t('common.selectUpToSlots', { max: maxSlots }));
        return;
      }
    }

    // Add to selection (allow multiple instances of the same slot)
    const newSlot = {
      slot_id: slot.id,
      start_time: slot.start_time,
      end_time: slot.end_time,
      employee_id: slot.employee_id || '',
      slot_date: slot.slot_date
    };

    setSelectedSlots(prev => [...prev, newSlot]);

    // Sync selectedSlot when single slot selected so submit can find it
    if (selectedSlots.length === 0) {
      setSelectedSlot(slot.id);
      setSelectedTimeSlot({
        start_time: slot.start_time,
        end_time: slot.end_time,
        slot_date: slot.slot_date
      });
    }
  }

  async function fetchServices() {
    if (!userProfile?.tenant_id) {
      console.warn('[ReceptionPage] fetchServices: No tenant_id available', { userProfile });
      return;
    }
    const branchId = (userProfile as { branch_id?: string | null }).branch_id ?? null;
    try {
      let serviceIds: string[] | null = null;
      if (branchId) {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`${getApiUrl()}/branches/${branchId}/services`, {
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data?.data)) {
          serviceIds = data.data.map((s: { id: string }) => s.id);
          if (serviceIds.length === 0) {
            setServices([]);
            return;
          }
        }
      }
      const servicesResult = await db
        .from('services')
        .select('id, name, name_ar, base_price, original_price, discount_percentage, capacity_per_slot, capacity_mode')
        .eq('tenant_id', userProfile.tenant_id)
        .eq('is_active', true)
        .order('name');
      const { data: servicesDataRaw, error: servicesError } = servicesResult;
      if (servicesError) {
        setServices([]);
        return;
      }
      let servicesData = servicesDataRaw ?? [];
      if (branchId && serviceIds && serviceIds.length > 0) {
        servicesData = servicesData.filter((s: { id: string }) => serviceIds!.includes(s.id));
      }
      if (servicesData.length > 0) {
        const serviceIdsArr = servicesData.map((s: { id: string }) => s.id);
        const offersResult = await db
          .from('service_offers')
          .select('id, service_id, name, name_ar, price, original_price, discount_percentage, is_active')
          .in('service_id', serviceIdsArr)
          .eq('is_active', true)
          .order('name');
        const { data: offersData } = offersResult;
        const servicesWithOffers = servicesData.map((service: { id: string } & Record<string, unknown>) => ({
          ...service,
          offers: offersData?.filter((offer: { service_id: string }) => offer.service_id === service.id) || [],
        }));
        setServices(servicesWithOffers);
      } else {
        setServices([]);
      }
    } catch (error) {
      console.error('[ReceptionPage] Unexpected error in fetchServices:', error);
      setServices([]);
    }
  }

  async function fetchPackages() {
    if (!userProfile?.tenant_id) {
      setPackages([]);
      return;
    }
    const branchId = (userProfile as { branch_id?: string | null }).branch_id ?? null;
    setLoadingPackages(true);
    try {
      if (branchId) {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`${getApiUrl()}/packages/receptionist/packages`, {
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = await res.json();
        if (!res.ok) {
          setPackages([]);
          return;
        }
        const list = data?.packages ?? [];
        const packagesWithServices = list.map((pkg: { id: string; name: string; name_ar?: string; total_price: number; services?: Array<{ service_id: string; service_name: string; service_name_ar?: string; capacity?: number }> }) => ({
          id: pkg.id,
          name: pkg.name,
          name_ar: pkg.name_ar ?? '',
          total_price: pkg.total_price,
          package_services: (pkg.services ?? []).map((ps: { service_id: string; service_name: string; service_name_ar?: string; capacity?: number }) => ({
            package_id: pkg.id,
            service_id: ps.service_id,
            services: { id: ps.service_id, name: ps.service_name, name_ar: ps.service_name_ar ?? '', base_price: 0 },
            capacity_total: ps.capacity ?? 0,
          })),
        }));
        setPackages(packagesWithServices);
        return;
      }
      const { data: packagesData, error: packagesError } = await db
        .from('service_packages')
        .select('id, name, name_ar, total_price')
        .eq('tenant_id', userProfile!.tenant_id)
        .eq('is_active', true)
        .order('name');

      if (packagesError) {
        setPackages([]);
        return;
      }
      if (!packagesData || packagesData.length === 0) {
        setPackages([]);
        return;
      }
      const packageIds = packagesData.map((p: { id: string }) => p.id);
      const { data: packageServicesData, error: packageServicesError } = await db
        .from('package_services')
        .select('package_id, service_id, services(id, name, name_ar, base_price)')
        .in('package_id', packageIds);

      if (packageServicesError) {
        setPackages(packagesData.map((pkg: { id: string } & Record<string, unknown>) => ({ ...pkg, package_services: [] })));
        return;
      }
      const packagesWithServices = packagesData.map((pkg: { id: string } & Record<string, unknown>) => ({
        ...pkg,
        package_services: packageServicesData?.filter((ps: { package_id: string }) => ps.package_id === pkg.id) || [],
      }));
      setPackages(packagesWithServices);
    } catch (error) {
      console.error('Unexpected error in fetchPackages:', error);
      setPackages([]);
    } finally {
      setLoadingPackages(false);
    }
  }

  function formatPhoneNumber(phone: string, code: string): string {
    const gulfCountries = ['+966', '+971', '+968', '+965', '+973', '+974'];
    if (gulfCountries.includes(code) && phone.startsWith('0')) {
      return phone.substring(1);
    }
    return phone;
  }

  async function lookupSubscriptionCustomer(fullPhoneNumber: string) {
    if (!fullPhoneNumber || fullPhoneNumber.length < 10 || !userProfile?.tenant_id) {
      setSubscriptionCustomerLookup(null);
      setIsLookingUpSubscriptionCustomer(false);
      return;
    }

    setIsLookingUpSubscriptionCustomer(true);
    
    try {
      // Extract country code and phone number
      let phoneNumber = fullPhoneNumber;
      let code = tenantDefaultCountry;
      
      for (const country of countryCodes) {
        if (fullPhoneNumber.startsWith(country.code)) {
          code = country.code;
          phoneNumber = fullPhoneNumber.replace(country.code, '');
          break;
        }
      }

      // Lookup customer in customers table
      const { data: customerData, error: customerError } = await db
        .from('customers')
        .select('id, name, email, phone')
        .eq('tenant_id', userProfile!.tenant_id)
        .eq('phone', fullPhoneNumber)
        .maybeSingle();

      if (customerError) {
        console.error('Error looking up subscription customer:', customerError);
        setSubscriptionCustomerLookup(null);
        setIsLookingUpSubscriptionCustomer(false);
        return;
      }

      if (customerData) {
        // Customer found - auto-fill data
        setSubscriptionCustomerLookup(customerData);
        setSubscriptionForm(prev => ({
          ...prev,
          customer_name: customerData.name || '',
          customer_email: customerData.email || '',
          customer_phone: phoneNumber // Store without country code for display
        }));
      } else {
        // Customer not found - clear lookup but keep phone
        setSubscriptionCustomerLookup(null);
        setSubscriptionForm(prev => ({
          ...prev,
          customer_name: '',
          customer_email: ''
        }));
      }
    } catch (error) {
      console.error('Error in lookupSubscriptionCustomer:', error);
      setSubscriptionCustomerLookup(null);
    } finally {
      setIsLookingUpSubscriptionCustomer(false);
    }
  }

  async function handleSubscriptionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userProfile?.tenant_id) return;

    // Use the full phone number from subscriptionPhoneFull
    const fullPhone = subscriptionPhoneFull || (subscriptionForm.customer_phone ? `${tenantDefaultCountry}${subscriptionForm.customer_phone}` : '');
    if (!fullPhone) {
      showNotification('warning', t('packages.customerPhoneRequired') || 'Customer phone is required');
      return;
    }
    if (!subscriptionForm.customer_name?.trim()) {
      showNotification('warning', t('packages.customerNameRequired') || 'Customer name is required');
      return;
    }
    if (!subscriptionForm.package_id) {
      showNotification('warning', t('packages.selectPackage') || 'Please select a package');
      return;
    }
    if (subscriptionPaymentMethod === 'transfer' && !subscriptionTransactionReference.trim()) {
      showNotification('warning', t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
      return;
    }

    try {
      setIsSubscribing(true);
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');
      const body: Record<string, string | undefined> = {
        package_id: subscriptionForm.package_id,
        customer_phone: fullPhone.trim(),
        customer_name: subscriptionForm.customer_name.trim(),
        customer_email: subscriptionForm.customer_email?.trim() || undefined
      };
      if (subscriptionSelectedCustomer?.id || subscriptionCustomerLookup?.id) {
        body.customer_id = subscriptionSelectedCustomer?.id || subscriptionCustomerLookup.id;
      }
      if (subscriptionPaymentMethod === 'unpaid') {
        body.payment_status = 'pending';
      } else {
        body.payment_status = 'paid';
        body.payment_method = subscriptionPaymentMethod;
        if (subscriptionPaymentMethod === 'transfer' && subscriptionTransactionReference.trim()) body.transaction_reference = subscriptionTransactionReference.trim();
      }
      const response = await fetch(`${API_URL}/packages/receptionist/subscriptions`, {
        method: 'POST',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to subscribe customer');
      }
      const pkg = packages.find((p: any) => p.id === subscriptionForm.package_id);
      const confirmationData: SubscriptionConfirmationData = {
        subscriptionId: data.subscription?.id ?? '',
        customerName: subscriptionForm.customer_name.trim(),
        customerPhone: fullPhone.trim() || undefined,
        packageName: data.subscription?.package?.name ?? pkg?.name ?? '',
        packageNameAr: data.subscription?.package?.name_ar ?? pkg?.name_ar,
        subscribedAt: data.subscription?.subscribed_at ?? new Date().toISOString(),
        totalPrice: pkg?.total_price ?? data.subscription?.package?.total_price,
        invoiceCreated: !!data.invoice?.id,
        invoicePending: !!data.invoice_pending,
        invoiceError: data.invoice_error,
      };
      setIsSubscriptionModalOpen(false);
      resetSubscriptionForm();
      setSubscriptionConfirmationData(confirmationData);
    } catch (err: any) {
      console.error('Error creating subscription:', err);
      showNotification('error', t('reception.errorCreatingBooking', { message: err.message || t('common.error') }));
    } finally {
      setIsSubscribing(false);
    }
  }

  function resetSubscriptionForm() {
    setSubscriptionForm({
      customer_phone: '',
      customer_name: '',
      customer_email: '',
      package_id: ''
    });
    setSubscriptionCustomerLookup(null);
    setSubscriptionSelectedCustomer(null);
    setSubscriptionPhoneFull('');
    setIsLookingUpSubscriptionCustomer(false);
    setSubscriptionPaymentMethod('onsite');
    setSubscriptionTransactionReference('');
  }

  // Validate search input based on search type
  function validateSearchInput(type: SearchType, value: string): { valid: boolean; error?: string } {
    if (!type) {
      return { valid: false, error: t('reception.selectSearchType') || 'Please select a search type first' };
    }

    if (!value || value.trim().length === 0) {
      return { valid: false, error: t('reception.enterSearchValue') || 'Please enter a search value' };
    }

    switch (type) {
      case 'phone':
        // Phone should be numeric and at least 5 digits
        const phoneDigits = value.replace(/\D/g, '');
        if (phoneDigits.length < 5) {
          return { valid: false, error: t('reception.phoneMinLength') || 'Phone number must be at least 5 digits' };
        }
        break;
      case 'booking_id':
        // Booking ID must be a valid UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(value.trim())) {
          return { valid: false, error: t('reception.invalidBookingId') || 'Invalid booking ID format' };
        }
        break;
      case 'customer_name':
        // Name should be at least 2 characters
        if (value.trim().length < 2) {
          return { valid: false, error: t('reception.nameMinLength') || 'Name must be at least 2 characters' };
        }
        break;
      case 'service_name':
        // Service name should be at least 2 characters
        if (value.trim().length < 2) {
          return { valid: false, error: t('reception.serviceMinLength') || 'Service name must be at least 2 characters' };
        }
        break;
      case 'date':
        // Date validation is handled by date picker
        if (!value) {
          return { valid: false, error: t('reception.selectDate') || 'Please select a date' };
        }
        break;
    }

    return { valid: true };
  }

  // Search bookings function with explicit search type
  async function searchBookings(type: SearchType, value: string) {
    if (!userProfile?.tenant_id || !type || !value) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    // Validate input
    const validation = validateSearchInput(type, value);
    if (!validation.valid) {
      setSearchValidationError(validation.error || '');
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setSearchValidationError('');
    setIsSearching(true);
    try {
      const API_URL = getApiUrl();
      const session = await db.auth.getSession();
      
      // Build query params - only send the selected search type parameter
      const params = new URLSearchParams();
      params.append(type, value.trim());
      params.append('limit', '50');

      const response = await fetch(`${API_URL}/bookings/search?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.data.session?.access_token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Search failed');
      }

      const result = await response.json();
      
      // Transform results to match Booking interface
      const transformedBookings = (result.bookings || []).map((b: any) => ({
        id: b.id,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        customer_email: b.customer_email,
        visitor_count: b.visitor_count,
        total_price: b.total_price,
        status: b.status,
        payment_status: b.payment_status,
        notes: b.notes,
        created_at: b.created_at,
        booking_group_id: b.booking_group_id,
        zoho_invoice_id: b.zoho_invoice_id,
        zoho_invoice_created_at: b.zoho_invoice_created_at,
        services: b.services || { name: '', name_ar: '' },
        slots: b.slots || { slot_date: '', start_time: '', end_time: '' },
        users: b.users || null,
        employees: b.users ? [b.users] : []
      }));

      setSearchResults(transformedBookings);
      setShowSearchResults(true);
    } catch (error: any) {
      console.error('Search error:', error);
      setSearchValidationError(error.message || t('reception.searchError') || 'Search failed');
      setSearchResults([]);
      setShowSearchResults(false);
    } finally {
      setIsSearching(false);
    }
  }

  // Handle search type change
  const handleSearchTypeChange = (type: SearchType) => {
    setSearchType(type);
    setSearchQuery('');
    setSearchDate('');
    setSearchResults([]);
    setShowSearchResults(false);
    setSearchValidationError('');
  };

  // Handle search input change
  const handleSearchInputChange = (value: string) => {
    if (searchType === 'phone') {
      // Only allow digits for phone
      const digitsOnly = value.replace(/\D/g, '');
      setSearchQuery(digitsOnly);
    } else if (searchType === 'booking_id') {
      // Allow UUID format for booking ID
      setSearchQuery(value);
    } else {
      setSearchQuery(value);
    }
    setSearchValidationError('');
  };

  // Handle date change
  const handleDateChange = (date: string) => {
    setSearchDate(date);
    setSearchValidationError('');
    // Auto-search when date is selected
    if (date && searchType === 'date') {
      searchBookings('date', date);
    } else if (!date) {
      setSearchResults([]);
      setShowSearchResults(false);
    }
  };

  // Debounced search handler for text inputs
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Only search if search type is selected and not date (date is handled separately)
    if (searchType && searchType !== 'date' && (searchType as string) !== '' && searchQuery.trim().length > 0) {
      const validation = validateSearchInput(searchType, searchQuery);
      if (validation.valid) {
        searchTimeoutRef.current = setTimeout(() => {
          searchBookings(searchType, searchQuery);
        }, 300); // 300ms debounce
      }
    } else if ((searchType as string) === '' || (searchType !== 'date' && searchQuery.trim().length === 0)) {
      setSearchResults([]);
      setShowSearchResults(false);
      setSearchValidationError('');
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, searchType]);

  async function fetchBookings() {
    if (!userProfile?.tenant_id) return;

    const branchId = (userProfile as { branch_id?: string | null }).branch_id ?? null;

    try {
      const today = format(new Date(), 'yyyy-MM-dd');

      let query = db
        .from('bookings')
        .select(`
          id,
          customer_name,
          customer_phone,
          customer_email,
          visitor_count,
          total_price,
          status,
          payment_status,
          payment_method,
          notes,
          created_at,
          booking_group_id,
          service_id,
          slot_id,
          qr_scanned,
          qr_scanned_at,
          qr_scanned_by_user_id,
          zoho_invoice_id,
          zoho_invoice_created_at,
          package_covered_quantity,
          paid_quantity,
          package_subscription_id,
          services (name, name_ar),
          slots (slot_date, start_time, end_time),
          users:employee_id (id, full_name, full_name_ar)
        `)
        .eq('tenant_id', userProfile!.tenant_id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (branchId) {
        query = query.eq('branch_id', branchId);
      }
      const { data, error } = await query;

      if (error) throw error;

      const rawBookings = data || [];
      console.log(`[ReceptionPage] ========================================`);
      console.log(`[ReceptionPage] Fetched bookings: ${rawBookings.length} total bookings`);
      if (rawBookings.length > 0) {
        console.log(`[ReceptionPage] Sample bookings:`, rawBookings.slice(0, 3).map((b: Record<string, unknown>) => ({
          id: b.id,
          customer_name: b.customer_name,
          slot_date: (b.slots as Record<string, unknown>)?.slot_date,
          start_time: (b.slots as Record<string, unknown>)?.start_time,
          visitor_count: b.visitor_count
        })));
      }

      // Group bookings by booking_group_id to aggregate employees and count
      const bookingGroups = new Map();
      rawBookings.forEach((booking: Record<string, unknown>) => {
        const groupId = booking.booking_group_id || booking.id;

        if (!bookingGroups.has(groupId)) {
          bookingGroups.set(groupId, {
            ...booking,
            employees: booking.users ? [booking.users] : [],
            groupCount: 1
          });
        } else {
          const group = bookingGroups.get(groupId);
          // Add employee if not already in list
          if (booking.users && !group.employees.find((e: { id: string }) => e.id === (booking.users as { id: string })?.id)) {
            group.employees.push(booking.users);
          }
          group.groupCount += 1;
        }
      });

      const allBookings = Array.from(bookingGroups.values());
      console.log('Grouped bookings:', allBookings.length, 'booking groups');
      setBookings(allBookings);

      // Filter today's bookings - handle both date formats
      console.log(`[ReceptionPage] Filtering today's bookings. Today: ${today}, Total bookings: ${allBookings.length}`);
      const todayOnly = allBookings.filter(b => {
        if (!b.slots?.slot_date) {
          console.warn(`[ReceptionPage] Booking ${b.id} has no slot_date`);
          return false;
        }
        const bookingDate = b.slots.slot_date;
        // Handle both "2025-12-09" and "2025-12-09T22:00:00.000Z" formats
        let normalizedBookingDate: string;
        if (typeof bookingDate === 'string') {
          if (bookingDate.includes('T') || bookingDate.includes('Z')) {
            try {
              normalizedBookingDate = format(parseISO(bookingDate), 'yyyy-MM-dd');
            } catch (e) {
              normalizedBookingDate = bookingDate.substring(0, 10);
            }
          } else {
            normalizedBookingDate = bookingDate.substring(0, 10);
          }
        } else {
          normalizedBookingDate = format(new Date(bookingDate), 'yyyy-MM-dd');
        }
        const matches = normalizedBookingDate === today;
        if (!matches) {
          console.log(`[ReceptionPage] Booking ${b.id} date mismatch: "${normalizedBookingDate}" !== "${today}" (original: ${bookingDate})`);
        } else {
          console.log(`[ReceptionPage] Booking ${b.id} matches today: ${normalizedBookingDate} === ${today}`);
        }
        return matches;
      });
      console.log(`[ReceptionPage] Today's bookings: ${todayOnly.length} out of ${allBookings.length} total`);
      if (todayOnly.length > 0) {
        console.log('[ReceptionPage] Today\'s bookings details:', todayOnly.map(b => ({
          id: b.id,
          customer_name: b.customer_name,
          slot_date: b.slots?.slot_date,
          start_time: b.slots?.start_time,
          visitor_count: b.visitor_count
        })));
      } else {
        console.warn(`[ReceptionPage] ⚠️ No bookings found for today (${today})`);
        if (allBookings.length > 0) {
          console.log(`[ReceptionPage] All booking dates:`, allBookings.map(b => ({
            id: b.id,
            slot_date: b.slots?.slot_date,
            normalized: b.slots?.slot_date ? (b.slots.slot_date.includes('T') || b.slots.slot_date.includes('Z') 
              ? format(parseISO(b.slots.slot_date), 'yyyy-MM-dd')
              : b.slots.slot_date.substring(0, 10)) : 'N/A'
          })));
        }
      }
      setTodayBookings(todayOnly);
    } catch (err) {
      console.error('Error fetching bookings:', err);
      setBookings([]);
      setTodayBookings([]);
    }
    // Note: setLoading(false) is now handled in the useEffect that calls this function
  }

  async function fetchAvailableSlots() {
    if (!userProfile?.tenant_id || !selectedService || !selectedDate) return;

    const branchId = (userProfile as { branch_id?: string | null }).branch_id ?? null;

    setLoadingTimeSlots(true);
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');

      // When receptionist is branch-scoped, get employee IDs for this service in this branch so we only show their slots
      let branchEmployeeIds: Set<string> | null = null;
      if (branchId) {
        const { data: empServ } = await db
          .from('employee_services')
          .select('employee_id')
          .eq('tenant_id', userProfile!.tenant_id)
          .eq('service_id', selectedService);
        const ids = [...new Set((empServ ?? []).map((es: { employee_id: string }) => es.employee_id))];
        if (ids.length > 0) {
          const { data: branchUsers } = await db
            .from('users')
            .select('id')
            .in('id', ids)
            .eq('tenant_id', userProfile!.tenant_id)
            .eq('branch_id', branchId);
          branchEmployeeIds = new Set((branchUsers ?? []).map((u: { id: string }) => u.id));
        } else {
          branchEmployeeIds = new Set();
        }
      }

      // Use shared availability logic (SAME as customer page)
      const result = await fetchAvailableSlotsUtil({
        tenantId: userProfile.tenant_id,
        serviceId: selectedService,
        date: selectedDate,
        includePastSlots: false,
        includeLockedSlots: false,
        includeZeroCapacity: false,
      });

      let slotsToShow = result.slots as Slot[];
      if (branchEmployeeIds !== null) {
        slotsToShow = slotsToShow.filter((s) => s.employee_id && branchEmployeeIds!.has(s.employee_id));
      }

      // Get shift IDs for employee booking counts (from displayed slots so counts match)
      const shiftIds = result.shifts.map(s => s.id);

      const nonConflictingSlots = filterConflictingSlots(slotsToShow);

      setSlots(nonConflictingSlots);

      await fetchEmployeeBookingCounts(dateStr, shiftIds);
    } catch (err) {
      console.error('Error in fetchAvailableSlots:', err);
      setSlots([]);
    } finally {
      setLoadingTimeSlots(false);
    }
  }

  async function fetchEmployeeBookingCounts(dateStr: string, shiftIds: string[]) {
    if (!userProfile?.tenant_id || !selectedService) return;

    try {
      // Query only employee_id so we don't depend on backend nested-relation support; then fetch names from users.
      const { data: employeeServices, error: empServError } = await db
        .from('employee_services')
        .select('employee_id')
        .eq('tenant_id', userProfile!.tenant_id)
        .eq('service_id', selectedService);

      if (empServError) {
        console.error('Error fetching employee services:', empServError);
        setAvailableEmployees([]);
        return;
      }

      if (!employeeServices || employeeServices.length === 0) {
        setAvailableEmployees([]);
        return;
      }

      const employeeIdsFromServices = [...new Set(employeeServices.map((es: { employee_id: string }) => es.employee_id))] as string[];

      const branchId = (userProfile as { branch_id?: string | null }).branch_id ?? null;
      let usersQuery = db
        .from('users')
        .select('id, full_name, full_name_ar, is_active, branch_id')
        .in('id', employeeIdsFromServices)
        .eq('tenant_id', userProfile!.tenant_id);
      if (branchId) {
        usersQuery = usersQuery.eq('branch_id', branchId);
      }
      const { data: usersData } = await usersQuery;
      const employeeMap = new Map<string, {id: string, name: string, name_ar: string}>();
      (usersData || []).forEach((u: { id: string; full_name?: string; full_name_ar?: string; is_active?: boolean }) => {
        if (u.is_active !== false) {
          employeeMap.set(u.id, {
            id: u.id,
            name: u.full_name ?? '',
            name_ar: u.full_name_ar ?? ''
          });
        }
      });
      // If no names (e.g. RLS), still show employees so dropdown isn't empty
      if (employeeMap.size === 0) {
        employeeIdsFromServices.forEach((id: string) => {
          employeeMap.set(id, { id, name: 'Employee', name_ar: 'موظف' });
        });
      }

      const employeeIds = Array.from(employeeMap.keys());
      // When no shift IDs (e.g. no slots yet), still show employees with zero counts so dropdown is populated
      if (shiftIds.length === 0) {
        const employeesWithCounts = Array.from(employeeMap.values()).map(emp => ({
          ...emp,
          bookingCount: 0
        }));
        setAvailableEmployees(employeesWithCounts);
        return;
      }
      const { data: allSlots } = await db
        .from('slots')
        .select('id, employee_id')
        .eq('tenant_id', userProfile!.tenant_id)
        .eq('slot_date', dateStr)
        .in('shift_id', shiftIds)
        .in('employee_id', employeeIds);

      if (!allSlots) {
        const employeesWithCounts = Array.from(employeeMap.values()).map(emp => ({
          ...emp,
          bookingCount: 0
        }));
        setAvailableEmployees(employeesWithCounts);
        return;
      }

      // Get booking counts for each employee on this date
      const slotIds = allSlots.map((s: { id: string }) => s.id);

      if (slotIds.length === 0) {
        const employeesWithCounts = Array.from(employeeMap.values()).map(emp => ({
          ...emp,
          bookingCount: 0
        }));
        setAvailableEmployees(employeesWithCounts);
        return;
      }

      const branchIdForCount = (userProfile as { branch_id?: string | null }).branch_id ?? null;
      let bookingCountQuery = db
        .from('bookings')
        .select('employee_id')
        .in('slot_id', slotIds)
        .in('status', ['pending', 'confirmed', 'checked_in'])
        .eq('tenant_id', userProfile!.tenant_id);
      if (branchIdForCount) {
        bookingCountQuery = bookingCountQuery.eq('branch_id', branchIdForCount);
      }
      const { data: bookings } = await bookingCountQuery;

      const bookingCountMap = new Map<string, number>();
      (bookings || []).forEach((booking: { employee_id: string }) => {
        const count = bookingCountMap.get(booking.employee_id) || 0;
        bookingCountMap.set(booking.employee_id, count + 1);
      });

      const employeesWithCounts = Array.from(employeeMap.values()).map(emp => ({
        ...emp,
        bookingCount: bookingCountMap.get(emp.id) || 0
      })).sort((a, b) => a.bookingCount - b.bookingCount); // Sort by booking count ascending

      setAvailableEmployees(employeesWithCounts);
    } catch (err) {
      console.error('Error fetching employee booking counts:', err);
      setAvailableEmployees([]);
    }
  }

  // Helper function to create bookings via API (ensures tickets are sent)
  async function createBulkBookingViaAPI(bookingData: {
    slot_ids: string[];
    service_id: string;
    tenant_id: string;
    customer_id?: string;
    customer_name: string;
    customer_phone: string;
    customer_email?: string | null;
    visitor_count: number;
    total_price: number;
    notes?: string | null;
    employee_id?: string | null;
    offer_id?: string | null;
    language?: string;
    booking_group_id?: string | null;
    payment_method?: 'onsite' | 'transfer';
    transaction_reference?: string;
  }) {
    // Get API URL (already includes /api suffix)
    const API_URL = getApiUrl();
    
    const session = await db.auth.getSession();
    
    if (!session.data.session?.access_token) {
      throw new Error('Not authenticated. Please log in again.');
    }

    // Construct URL: API URL already includes /api, so just append the route
    const url = `${API_URL}/bookings/create-bulk`;
    console.log('Creating bulk booking via API:', { url, slotCount: bookingData.slot_ids.length, hasToken: !!session.data.session?.access_token });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.data.session.access_token}`
        },
        body: JSON.stringify({
          ...bookingData,
          language: bookingData.language || i18n.language
        })
      });

      // Check if response is JSON
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      // If response is not OK or not JSON, handle error
      if (!response.ok || !isJson) {
        const text = await response.text();
        
        // If it's HTML (error page), provide helpful message
        if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
          console.error('Server returned HTML instead of JSON. This usually means:');
          console.error('1. Backend server is not running');
          console.error('2. API URL is incorrect:', url);
          console.error('3. Request was redirected to an error page');
          throw new Error(`Backend server error: The API server at ${API_URL} is not responding correctly. Please ensure the backend server is running.`);
        }

        // Try to parse as JSON even if content-type is wrong
        let errorData;
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = { error: text || `HTTP ${response.status}: ${response.statusText}` };
        }

        throw new Error(errorData.error || `Failed to create bulk booking: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('✅ Bulk booking created successfully:', result);
      return result;
    } catch (error: any) {
      console.error('Error creating bulk booking:', error);
      throw error;
    }
  }

  async function createBookingViaAPI(bookingData: any) {
    // Get API URL (already includes /api suffix)
    const API_URL = getApiUrl();
    
    const session = await db.auth.getSession();
    
    if (!session.data.session?.access_token) {
      throw new Error('Not authenticated. Please log in again.');
    }

    // Construct URL: API URL already includes /api, so just append the route
    const url = `${API_URL}/bookings/create`;
    console.log('Creating booking via API:', { url, hasToken: !!session.data.session?.access_token });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.data.session.access_token}`
        },
        body: JSON.stringify({
          ...bookingData,
          language: i18n.language
        })
      });

      // Check if response is JSON
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      // If response is not OK or not JSON, handle error
      if (!response.ok || !isJson) {
        const text = await response.text();
        
        // If it's HTML (error page), provide helpful message
        if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
          console.error('Server returned HTML instead of JSON. This usually means:');
          console.error('1. Backend server is not running');
          console.error('2. API URL is incorrect:', url);
          console.error('3. Request was redirected to an error page');
          throw new Error(`Backend server error: The API server at ${API_URL} is not responding correctly. Please ensure the backend server is running.`);
        }
        
        // Try to parse as JSON if possible
        if (isJson) {
          try {
            const errorData = JSON.parse(text);
            console.error('Server error response:', errorData);
            // Include details if available
            const errorMessage = errorData.error || `Server error: ${response.status} ${response.statusText}`;
            const errorDetails = errorData.details ? `\nDetails: ${errorData.details}` : '';
            const errorCode = errorData.code ? `\nCode: ${errorData.code}` : '';
            throw new Error(`${errorMessage}${errorDetails}${errorCode}`);
          } catch (parseError) {
            console.error('Failed to parse error JSON:', parseError);
            console.error('Raw error text:', text);
            throw new Error(`Server error: ${response.status} ${response.statusText}\nResponse: ${text.substring(0, 200)}`);
          }
        } else {
          console.error('Non-JSON error response:', text.substring(0, 500));
          throw new Error(`Server returned invalid response (${response.status}). Check if backend server is running at ${API_URL}\nResponse: ${text.substring(0, 200)}`);
        }
      }

      // Parse and return JSON response
      return await response.json();
    } catch (error: any) {
      // Handle network errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error('Network error - cannot reach API server:', url);
        throw new Error(`Cannot connect to backend server at ${API_URL}. Please ensure the server is running.`);
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  async function handleQuantityBooking(service: Service) {
    const quantity = bookingForm.visitor_count;
    const fullPhoneNumber = `${countryCode}${bookingForm.customer_phone}`;

    if (!selectedTimeSlot) {
      showNotification('warning', t('reception.slotNotSelected'));
      return;
    }

    const slotsAtTime = slots.filter(
      s => s.start_time === selectedTimeSlot.start_time &&
           s.end_time === selectedTimeSlot.end_time &&
           s.available_capacity > 0
    );

    if (slotsAtTime.length === 0) {
      showNotification('warning', t('reception.noSlotsAvailable'));
      return;
    }

    // Check if we can book all tickets in a single slot (preferred option)
    const slotWithEnoughCapacity = slotsAtTime.find(s => s.available_capacity >= quantity);
    
    if (slotWithEnoughCapacity) {
      // Book all tickets in the same slot - this is what the user wants
      await saveOrUpdateCustomer(fullPhoneNumber);
      
      // Calculate price
      let price = service.base_price || 0;
      if (selectedOffer) {
        const offer = service.offers?.find(o => o.id === selectedOffer);
        if (offer) {
          price = offer.price;
        }
      }
      const totalPrice = price * (typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1);
      
      if (totalPrice > 0 && createPaymentMethod === 'transfer' && !createTransactionReference.trim()) {
        showNotification('warning', t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
        return;
      }
      
      // Generate booking group ID
      const bookingGroupId = crypto.randomUUID();
      
      // Create booking via API to ensure tickets are sent
      try {
        const API_URL = getApiUrl();
        const response = await fetch(`${API_URL}/bookings/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await db.auth.getSession().then(s => s.data.session?.access_token)}`
          },
          body: JSON.stringify({
            tenant_id: userProfile!.tenant_id,
            service_id: selectedService!,
            slot_id: slotWithEnoughCapacity.id,
            employee_id: slotWithEnoughCapacity.employee_id || null,
            offer_id: selectedOffer || null,
            ...(bookingSelectedCustomer?.id && { customer_id: bookingSelectedCustomer.id }),
            customer_name: bookingForm.customer_name,
            customer_phone: fullPhoneNumber,
            customer_email: bookingForm.customer_email || null,
            visitor_count: quantity,
            total_price: totalPrice,
            notes: bookingForm.notes || null,
            booking_group_id: bookingGroupId,
            language: i18n.language,
            ...(totalPrice > 0 ? (createPaymentMethod === 'unpaid'
              ? { payment_status: 'unpaid' }
              : {
                  payment_method: createPaymentMethod,
                  transaction_reference: createPaymentMethod === 'transfer' ? createTransactionReference.trim() : undefined,
                }) : {}),
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create booking');
        }

        const result = await response.json();
        console.log('✅ Booking created successfully:', result);
        setBookingCreationLoadingStep('creating_invoice');
        await new Promise(r => setTimeout(r, 700));
        setBookingCreationLoadingStep(null);
        resetForm();
        fetchBookings();
        fetchAvailableSlots();
        setConfirmationBookingId(result.id ?? null);
        return;
      } catch (error: any) {
        console.error('Error creating booking:', error);
        setBookingCreationLoadingStep(null);
        showNotification('error', t('reception.errorCreatingBooking', { message: error.message || t('common.error') }));
        return;
      }
    }

    // If single slot doesn't have enough capacity, use the existing logic
    const totalCapacity = slotsAtTime.reduce((sum, s) => sum + s.available_capacity, 0);
    
    if (totalCapacity < quantity) {
      showNotification('warning', t('common.notEnoughCapacity', { available: totalCapacity, requested: quantity }));
      return;
    }

    // Save or update customer
    await saveOrUpdateCustomer(fullPhoneNumber);

    let firstBookingId: string | null = null;
    if (bookingForm.booking_option === 'parallel' && slotsAtTime.length > 1) {
      firstBookingId = await handleParallelBooking(service, slotsAtTime, quantity, fullPhoneNumber);
    } else {
      firstBookingId = await handleConsecutiveBooking(service, quantity, fullPhoneNumber);
    }

    setBookingCreationLoadingStep('creating_invoice');
    await new Promise(r => setTimeout(r, 700));
    setBookingCreationLoadingStep(null);
    resetForm();
    fetchBookings();
    fetchAvailableSlots();
    setConfirmationBookingId(firstBookingId);
  }

  async function saveOrUpdateCustomer(fullPhoneNumber: string) {
    const { data: existingCustomer } = await db
      .from('customers')
      .select('id, total_bookings')
      .eq('tenant_id', userProfile!.tenant_id)
      .eq('phone', fullPhoneNumber)
      .maybeSingle();

    if (existingCustomer) {
      await db
        .from('customers')
        .update({
          name: bookingForm.customer_name,
          email: bookingForm.customer_email || null,
          last_booking_at: new Date().toISOString(),
          total_bookings: existingCustomer.total_bookings + bookingForm.visitor_count
        })
        .eq('id', existingCustomer.id);
    } else {
      await db
        .from('customers')
        .insert({
          tenant_id: userProfile!.tenant_id,
          phone: fullPhoneNumber,
          name: bookingForm.customer_name,
          email: bookingForm.customer_email || null,
          last_booking_at: new Date().toISOString(),
          total_bookings: bookingForm.visitor_count
        });
    }
  }

  async function handleParallelBooking(service: Service, slotsAtTime: Slot[], quantity: number, fullPhoneNumber: string) {
    // Use manually selected slots
    if (selectedSlots.length === 0) {
      throw new Error('Please select time slots first');
    }

    const validation = validateSlotSelection();
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    // For parallel mode with capacity
    const required = getRequiredSlotsCount();

    // Generate a group ID for all bookings in this transaction
    const bookingGroupId = crypto.randomUUID();

    // Calculate price
      let price = service.base_price || 0;
      if (selectedOffer) {
        const offer = service.offers?.find(o => o.id === selectedOffer);
        if (offer) {
          price = offer.price;
        }
      }
    const totalPrice = price * (typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1);

    // Determine which slots to use
    let slotsToUse: Slot[];
    if (required === 1) {
      // Simple case: All bookings at same time with different employees
      slotsToUse = slotsAtTime.slice(0, quantity);
    } else {
      // Parallel + Extension: Use manually selected slots
      slotsToUse = selectedSlots.map(s => slots.find(slot => slot.id === s.slot_id)).filter(Boolean) as Slot[];
    }

    // Validate slot count matches visitor count
    if (slotsToUse.length !== quantity) {
      throw new Error(`Number of selected slots (${slotsToUse.length}) must match visitor count (${quantity})`);
    }

    if (totalPrice > 0 && createPaymentMethod === 'transfer' && !createTransactionReference.trim()) {
      throw new Error(t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
    }

    const serviceId = selectedService;
    const tenantId = userProfile?.tenant_id;
    if (!serviceId || !tenantId) throw new Error('Missing service or tenant');

    // Use bulk booking endpoint for atomic transaction and proper validation
    try {
      const result = await createBulkBookingViaAPI({
        slot_ids: slotsToUse.map(s => s.id),
        service_id: serviceId,
        tenant_id: tenantId,
        ...(bookingSelectedCustomer?.id && { customer_id: bookingSelectedCustomer.id }),
        customer_name: bookingForm.customer_name,
        customer_phone: fullPhoneNumber,
        customer_email: bookingForm.customer_email || null,
        visitor_count: quantity,
        total_price: totalPrice,
        notes: bookingForm.notes || null,
        employee_id: slotsToUse[0]?.employee_id || null, // Use first slot's employee
        offer_id: selectedOffer || null,
        language: i18n.language,
        booking_group_id: bookingGroupId,
        ...(totalPrice > 0 ? (createPaymentMethod === 'unpaid'
          ? { payment_status: 'unpaid' }
          : {
              payment_method: createPaymentMethod,
              transaction_reference: createPaymentMethod === 'transfer' ? createTransactionReference.trim() : undefined,
            }) : {}),
      });
      return result.bookings?.[0]?.id ?? null;
    } catch (error: any) {
      console.error('Error creating bulk booking:', error);
      throw error;
    }
  }

  async function handleConsecutiveBooking(service: Service, quantity: number, fullPhoneNumber: string) {
    // Use manually selected slots
    if (selectedSlots.length === 0) {
      throw new Error('Please select time slots first');
    }

    const validation = validateSlotSelection();
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    // Get employee ID from first selected slot (all should be same employee for consecutive)
    const employeeId = selectedSlots[0]?.employee_id ?? null;

    // Generate a group ID for all bookings in this transaction
    const bookingGroupId = crypto.randomUUID();

    // Calculate prices
      let price = service.base_price || 0;
      if (selectedOffer) {
        const offer = service.offers?.find(o => o.id === selectedOffer);
        if (offer) {
          price = offer.price;
        }
      }
    const totalPrice = price * (typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1);

    // Get slots from selected slots
    const slotsToUse = selectedSlots.map(s => slots.find(slot => slot.id === s.slot_id)).filter(Boolean) as Slot[];

    // Validate slot count matches visitor count
    if (slotsToUse.length !== quantity) {
      throw new Error(`Number of selected slots (${slotsToUse.length}) must match visitor count (${quantity})`);
    }

    if (totalPrice > 0 && createPaymentMethod === 'transfer' && !createTransactionReference.trim()) {
      throw new Error(t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
    }

    const serviceIdConsec = selectedService;
    const tenantIdConsec = userProfile?.tenant_id;
    if (!serviceIdConsec || !tenantIdConsec) throw new Error('Missing service or tenant');

    // Use bulk booking endpoint for atomic transaction and proper validation
    try {
      const result = await createBulkBookingViaAPI({
        slot_ids: slotsToUse.map(s => s.id),
        service_id: serviceIdConsec,
        tenant_id: tenantIdConsec,
        ...(bookingSelectedCustomer?.id && { customer_id: bookingSelectedCustomer.id }),
        customer_name: bookingForm.customer_name,
        customer_phone: fullPhoneNumber,
        customer_email: bookingForm.customer_email || null,
        visitor_count: quantity,
        total_price: totalPrice,
        notes: bookingForm.notes || null,
        employee_id: employeeId ?? null,
        offer_id: selectedOffer || null,
        language: i18n.language,
        booking_group_id: bookingGroupId,
        ...(totalPrice > 0 ? (createPaymentMethod === 'unpaid'
          ? { payment_status: 'unpaid' }
          : {
              payment_method: createPaymentMethod,
              transaction_reference: createPaymentMethod === 'transfer' ? createTransactionReference.trim() : undefined,
            }) : {}),
      });
      return result.bookings?.[0]?.id ?? null;
    } catch (error: any) {
      console.error('Error creating bulk booking:', error);
      throw error;
    }
  }

  async function handleMultiServiceBookingWithList(servicesToBook: Array<{service: Service, slot: Slot, employeeId: string}>) {
    if (!userProfile?.tenant_id) return;
    if (servicesToBook.length === 0) {
      showNotification('warning', t('reception.noServicesSelected'));
      return;
    }

    try {
      // Construct full phone number
      const fullPhoneNumber = `${countryCode}${bookingForm.customer_phone}`;

      // Save or update customer record
      const { data: existingCustomer } = await db
        .from('customers')
        .select('id, total_bookings')
        .eq('tenant_id', userProfile!.tenant_id)
        .eq('phone', fullPhoneNumber)
        .maybeSingle();

      if (existingCustomer) {
        await db
          .from('customers')
          .update({
            name: bookingForm.customer_name,
            email: bookingForm.customer_email || null,
            last_booking_at: new Date().toISOString(),
            total_bookings: existingCustomer.total_bookings + servicesToBook.length
          })
          .eq('id', existingCustomer.id);
      } else {
        await db
          .from('customers')
          .insert({
            tenant_id: userProfile.tenant_id,
            phone: fullPhoneNumber,
            name: bookingForm.customer_name,
            email: bookingForm.customer_email || null,
            last_booking_at: new Date().toISOString(),
            total_bookings: servicesToBook.length
          });
      }

      // Group services by service_id (same service = same group)
      const serviceGroups = new Map<string, Array<{service: Service, slot: Slot, employeeId: string}>>();
      servicesToBook.forEach(item => {
        if (!serviceGroups.has(item.service.id)) {
          serviceGroups.set(item.service.id, []);
        }
        serviceGroups.get(item.service.id)!.push(item);
      });

      // Create bookings for each service, grouped by service_id
      const bookingPromises = Array.from(serviceGroups.entries()).flatMap(([serviceId, items]) => {
        // Generate one group ID per service
        const bookingGroupId = crypto.randomUUID();

        // Determine how many bookings can use package for this service
        const packageCheck = checkServiceInPackage(serviceId);
        const service = services.find(s => s.id === serviceId);
        let packageUsedCount = 0;

        return items.map(async (item, index) => {
          console.log('Creating booking for service:', item.service.name, 'slot:', item.slot.id, 'group:', bookingGroupId);

          // Determine if this specific booking can use the package
          const canUsePackage = packageCheck.available && packageUsedCount < packageCheck.remaining;
          const usePackage = canUsePackage;
          const price = usePackage ? 0 : (service?.base_price || 0);

          if (usePackage) {
            packageUsedCount++;
          }

          // Calculate price for this booking
          const serviceForBooking = services.find(s => s.id === item.service.id);
          // If an offer is selected, use offer price; otherwise use base_price
          let priceForBooking = serviceForBooking?.base_price || 0;
          if (selectedOffer) {
            const offer = serviceForBooking?.offers?.find(o => o.id === selectedOffer);
            if (offer) {
              priceForBooking = offer.price;
            }
          }
          
          // Check if this is a multi-ticket booking in a single slot
          const isMultiTicketInSingleSlot = item.service.id === selectedService && 
                                           bookingForm.visitor_count > 1 && 
                                           item.slot.available_capacity >= bookingForm.visitor_count;
          
          // Use actual ticket count if multi-ticket in single slot, otherwise use 1
          const bookingVisitorCount = isMultiTicketInSingleSlot ? (typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1) : 1;
          const bookingPrice = usePackage ? 0 : (priceForBooking * bookingVisitorCount);

          if (bookingPrice > 0 && createPaymentMethod === 'transfer' && !createTransactionReference.trim()) {
            showNotification('warning', t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
            throw new Error('transaction_reference required');
          }

          // Insert booking via API
          // NOTE: Backend calculates package_subscription_id, package_covered_quantity, and paid_quantity automatically
          // Do NOT send status, package_subscription_id, or created_by_user_id - backend handles these
          try {
            const bookingData = await createBookingViaAPI({
              tenant_id: userProfile.tenant_id!,
              service_id: item.service.id,
              slot_id: item.slot.id,
              employee_id: item.employeeId || null,
              offer_id: selectedOffer || null,
              ...(bookingSelectedCustomer?.id && { customer_id: bookingSelectedCustomer.id }),
              customer_name: bookingForm.customer_name,
              customer_phone: fullPhoneNumber,
              customer_email: bookingForm.customer_email || null,
              visitor_count: bookingVisitorCount,
              total_price: bookingPrice,
              notes: bookingForm.notes || null,
              ...(bookingPrice > 0 ? (createPaymentMethod === 'unpaid'
                ? { payment_status: 'unpaid' }
                : {
                    payment_method: createPaymentMethod,
                    transaction_reference: createPaymentMethod === 'transfer' ? createTransactionReference.trim() : undefined,
                  }) : {}),
              ...(bookingGroupId ? { booking_group_id: bookingGroupId } : {})
            });

            console.log('Booking created:', bookingData);
            // Note: Slot capacity and package usage are automatically updated by database triggers
            return { ...bookingData, usedPackage: usePackage };
          } catch (error: any) {
            console.error('Error creating booking:', error);
            throw error;
          }
        });
      });

      const results = await Promise.all(bookingPromises);
      console.log('All bookings created successfully:', results);

      // Count package vs paid bookings
      const packageBookings = results.filter(r => r.usedPackage).length;
      const paidBookings = results.length - packageBookings;

      // Wait a moment for database triggers to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh bookings and slots
      console.log('Refreshing bookings list and slots...');
      await Promise.all([
        fetchBookings(),
        // Refresh slots if we have a selected service and date
        selectedService && selectedDate ? fetchAvailableSlots() : Promise.resolve()
      ]);
      console.log('Bookings and slots refreshed');

      const firstBookingId = results[0]?.id ?? null;
      setBookingCreationLoadingStep('creating_invoice');
      await new Promise(r => setTimeout(r, 700));
      setBookingCreationLoadingStep(null);
      resetForm();
      setConfirmationBookingId(firstBookingId);
    } catch (err: any) {
      console.error('Error creating multi-service bookings:', err);
      console.error('Error stack:', err.stack);
      setBookingCreationLoadingStep(null);
      showNotification('error', t('reception.errorCreatingBooking', { message: err.message || t('common.error') }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Collect all services to book (from list + currently selected)
    let servicesToBook = [...selectedServices];

    // If there's a currently selected service (not yet added to list), add it
    if (selectedService) {
      const service = services.find(s => s.id === selectedService);
      if (service) {
        // Check if this is a multi-quantity booking
        if (bookingForm.visitor_count > 1) {
          // First, check if a single slot has enough capacity (preferred option)
          if (selectedTimeSlot) {
            const slotsAtTime = slots.filter(
              s => s.start_time === selectedTimeSlot.start_time &&
                   s.end_time === selectedTimeSlot.end_time &&
                   s.available_capacity > 0
            );
            
            const slotWithEnoughCapacity = slotsAtTime.find(s => s.available_capacity >= bookingForm.visitor_count);
            
            if (slotWithEnoughCapacity) {
              // Book all tickets in the same slot - add to servicesToBook
              servicesToBook.push({
                service,
                slot: slotWithEnoughCapacity,
                employeeId: slotWithEnoughCapacity.employee_id || ''
              });
            } else if (selectedSlots.length > 0) {
              // No single slot has enough capacity, use manually selected slots
              if (bookingForm.booking_option === 'parallel' && selectedSlots.length === 1) {
                // Parallel mode: Only 1 slot selected, need to find multiple employees at same time
                const selectedSlotData = selectedSlots[0];
                const slotsAtSameTime = slots.filter(
                  s => s.start_time === selectedSlotData.start_time &&
                       s.end_time === selectedSlotData.end_time &&
                       s.available_capacity > 0
                );

                // Add booking for each available employee (up to quantity)
                const slotsToUse = slotsAtSameTime.slice(0, bookingForm.visitor_count);
                for (const slot of slotsToUse) {
                  servicesToBook.push({
                    service,
                    slot,
                    employeeId: slot.employee_id || ''
                  });
                }
              } else {
                // Consecutive mode: Add all manually selected slots
                for (const selectedSlotData of selectedSlots) {
                  const slot = slots.find(s => s.id === selectedSlotData.slot_id);
                  if (slot) {
                    servicesToBook.push({
                      service,
                      slot,
                      employeeId: selectedSlotData.employee_id
                    });
                  }
                }
              }
            }
          } else if (selectedSlots.length > 0) {
            // No time slot selected but slots manually selected
            if (bookingForm.booking_option === 'parallel' && selectedSlots.length === 1) {
              // Parallel mode: Only 1 slot selected, need to find multiple employees at same time
              const selectedSlotData = selectedSlots[0];
              const slotsAtSameTime = slots.filter(
                s => s.start_time === selectedSlotData.start_time &&
                     s.end_time === selectedSlotData.end_time &&
                     s.available_capacity > 0
              );

              // Add booking for each available employee (up to quantity)
              const slotsToUse = slotsAtSameTime.slice(0, bookingForm.visitor_count);
              for (const slot of slotsToUse) {
                servicesToBook.push({
                  service,
                  slot,
                  employeeId: slot.employee_id || ''
                });
              }
            } else {
              // Consecutive mode: Add all manually selected slots
              for (const selectedSlotData of selectedSlots) {
                const slot = slots.find(s => s.id === selectedSlotData.slot_id);
                if (slot) {
                  servicesToBook.push({
                    service,
                    slot,
                    employeeId: selectedSlotData.employee_id
                  });
                }
              }
            }
          }
        } else if (assignmentMode === 'automatic' && selectedTimeSlot || assignmentMode === 'manual' && selectedSlot) {
          // Single booking or quantity 1
          let slotToAdd: Slot | undefined;
          let employeeId = '';

          if (assignmentMode === 'automatic') {
            const slotsAtTime = slots.filter(
              s => s.start_time === selectedTimeSlot!.start_time &&
                   s.end_time === selectedTimeSlot!.end_time &&
                   s.available_capacity > 0
            );
            slotToAdd = slotsAtTime[0];
            if (slotToAdd) {
              employeeId = slotToAdd.employee_id || '';
            }
          } else {
            slotToAdd = slots.find(s => s.id === selectedSlot);
            employeeId = selectedEmployee || (slotToAdd?.employee_id || '');
          }

          if (slotToAdd && !servicesToBook.some(s => s.service.id === service.id)) {
            servicesToBook.push({
              service,
              slot: slotToAdd,
              employeeId
            });
          }
        }
      }
    }

    // Handle multi-service booking if we have services
    if (servicesToBook.length > 0) {
      await handleMultiServiceBookingWithList(servicesToBook);
      return;
    }

    if (!userProfile?.tenant_id) return;
    // User selected a service and slot(s) but slot wasn't found in list (e.g. stale slots) – show slot-specific error
    const hadSlotSelection = selectedTimeSlot || selectedSlot || selectedSlots.length > 0;
    if (selectedService && hadSlotSelection) {
      showNotification('warning', t('reception.slotNoLongerAvailable') || 'Selected slot is no longer available. Please choose another time.');
      return;
    }
    showNotification('warning', t('reception.noServicesSelected'));
    return;

    if (!userProfile?.tenant_id || !selectedService) return;
    const service = services.find(s => s.id === selectedService);
    if (!service) return;

    // ARCHIVED: Employee validation removed - all services are service-based now
    // if (assignmentMode === 'manual' && !selectedEmployee && service.capacity_mode !== 'service_based') {
    //   alert('Please select an employee');
    //   return;
    // }

    if (assignmentMode === 'automatic' && !selectedTimeSlot) {
      showNotification('warning', t('common.pleaseSelectTimeSlot'));
      return;
    }

    if (assignmentMode === 'manual' && !selectedSlot) {
      showNotification('warning', t('common.pleaseSelectTimeSlot'));
      return;
    }

    try {
      // Handle quantity-based booking
      if (bookingForm.visitor_count > 1) {
        await handleQuantityBooking(service as Service);
        return;
      }

      // Handle single booking (original logic)
      let employeeId: string;
      let slotId: string;

      if (assignmentMode === 'automatic') {
        // Use the selected time slot info
        if (!selectedTimeSlot) {
          showNotification('warning', t('reception.slotNotSelected'));
          return;
        }

        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const timeSlot = selectedTimeSlot;
        console.log('=== AUTOMATIC BOOKING DEBUG ===');
        console.log('Selected date:', dateStr);
        console.log('Selected time:', timeSlot);
        console.log('All available slots:', slots);
        console.log('Selected service:', selectedService);
        console.log('Service capacity mode:', service?.capacity_mode);

        // Find all slots at this time (same start_time and end_time)
        const slotsAtSelectedTime = slots.filter(
          s => s.start_time === timeSlot!.start_time &&
               s.end_time === timeSlot!.end_time &&
               s.available_capacity > 0
        );

        console.log('Slots matching time filter:', slotsAtSelectedTime);

        if (slotsAtSelectedTime.length === 0) {
          showNotification('warning', t('reception.noSlotsAvailable'));
          return;
        }

        // ARCHIVED: Employee-based capacity removed - always use service-based
        // Just pick the first available slot (no employee needed)
        const availableSlot = slotsAtSelectedTime[0];
        slotId = availableSlot.id;
        employeeId = availableSlot.employee_id || ''; // Can be null for service-based
        console.log('Service-based capacity - Slot ID:', slotId, 'Employee ID:', employeeId || 'None');
      } else {
        // Manual mode
        const manualSlot = slots.find(s => s.id === selectedSlot);
        if (!manualSlot) {
          showNotification('warning', t('reception.selectedSlotNotFound'));
          return;
        }

        slotId = selectedSlot;

        // ARCHIVED: Employee-based removed - always service-based
        employeeId = manualSlot!.employee_id ?? '';
        
        // ARCHIVED: Employee validation removed
        // else {
        //   // Employee-based: validate employee selection
        //   if (!selectedEmployee) {
        //     alert('Please select an employee');
        //     return;
        //   }
        //   employeeId = selectedEmployee;
        //
        //   // Validate that the selected employee matches the slot's employee
        //   if (slot.employee_id !== selectedEmployee) {
        //     alert('Selected employee does not match the slot. Please select a slot for this employee.');
        //     return;
        //   }
        // }
      }

      const slot = slots.find(s => s.id === slotId);
      if (!slot) {
        showNotification('warning', t('reception.slotNotSelected'));
        return;
      }

      // Construct full phone number with country code
      const fullPhoneNumber = `${countryCode}${bookingForm.customer_phone}`;

      // Save or update customer record
      const { data: existingCustomer } = await db
        .from('customers')
        .select('id, total_bookings')
        .eq('tenant_id', userProfile!.tenant_id)
        .eq('phone', fullPhoneNumber)
        .maybeSingle();

      if (existingCustomer) {
        // Update existing customer
        await db
          .from('customers')
          .update({
            name: bookingForm.customer_name,
            email: bookingForm.customer_email || null,
            last_booking_at: new Date().toISOString(),
            total_bookings: existingCustomer.total_bookings + 1
          })
          .eq('id', existingCustomer.id);
      } else {
        // Create new customer
        await db
          .from('customers')
          .insert({
            tenant_id: userProfile!.tenant_id,
            phone: fullPhoneNumber,
            name: bookingForm.customer_name,
            email: bookingForm.customer_email || null,
            last_booking_at: new Date().toISOString(),
            total_bookings: 1
          });
      }

      // Calculate total price based on adult/child pricing
      // If an offer is selected, use offer price; otherwise use base_price
      let price = service!.base_price || 0;
      if (selectedOffer) {
        const offer = service!.offers?.find(o => o.id === selectedOffer);
        if (offer) {
          price = offer!.price;
        }
      }
      const totalPrice = price * (typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1);

      if (totalPrice > 0 && createPaymentMethod === 'transfer' && !createTransactionReference.trim()) {
        showNotification('warning', t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
        return;
      }

      try {
        const result = await createBookingViaAPI({
          tenant_id: userProfile!.tenant_id,
          service_id: selectedService,
          slot_id: slotId,
          employee_id: employeeId || null,
          offer_id: selectedOffer || null,
          ...(bookingSelectedCustomer?.id && { customer_id: bookingSelectedCustomer.id }),
          customer_name: bookingForm.customer_name,
          customer_phone: fullPhoneNumber,
          customer_email: bookingForm.customer_email || null,
          visitor_count: typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1,
          total_price: totalPrice,
          notes: bookingForm.notes || null,
          ...(totalPrice > 0 ? (createPaymentMethod === 'unpaid'
            ? { payment_status: 'unpaid' }
            : {
                payment_method: createPaymentMethod,
                transaction_reference: createPaymentMethod === 'transfer' ? createTransactionReference.trim() : undefined,
              }) : {}),
        });

        // Note: Slot capacity is updated by the backend API
        setBookingCreationLoadingStep('creating_invoice');
        await new Promise(r => setTimeout(r, 700));
        setBookingCreationLoadingStep(null);
        resetForm();
        fetchBookings();
        fetchAvailableSlots();
        setConfirmationBookingId(result?.id ?? null);
      } catch (err: any) {
        console.error('Error creating booking:', err);
        setBookingCreationLoadingStep(null);
        showNotification('error', t('reception.errorCreatingBooking', { message: err.message || t('common.error') }));
      }
    } catch (err: any) {
      console.error('Error in handleSubmit:', err);
      setBookingCreationLoadingStep(null);
      showNotification('error', t('reception.errorCreatingBooking', { message: err.message || t('common.error') }));
    }
  }

  async function updateBookingStatus(bookingId: string, status: string) {
    try {
      // Coordinator must use API so backend enforces confirm-only; receptionist/admin can use API for consistency
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to update status (${response.status})`);
      }
      fetchBookings();
    } catch (err: any) {
      console.error('Error updating booking:', err);
      showNotification('error', t('reception.errorCreatingBooking', { message: err.message || t('common.error') }));
    }
  }

  async function updatePaymentStatus(bookingId: string, paymentStatus: string) {
    if (paymentStatus === 'paid_manual') {
      setMarkPaidBookingId(bookingId);
      setMarkPaidMethod('onsite');
      setMarkPaidReference('');
      return;
    }
    try {
      const { error } = await db
        .from('bookings')
        .update({ payment_status: paymentStatus })
        .eq('id', bookingId);

      if (error) throw error;
      fetchBookings();
    } catch (err: any) {
      console.error('Error updating payment status:', err);
      showNotification('error', t('reception.errorCreatingBooking', { message: err.message || t('common.error') }));
    }
  }

  async function confirmMarkPaid() {
    if (!markPaidBookingId) return;
    if (markPaidMethod === 'transfer' && !markPaidReference.trim()) {
      showNotification('warning', t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
      return;
    }
    setMarkPaidSubmitting(true);
    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/bookings/${markPaidBookingId}/mark-paid`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          payment_method: markPaidMethod,
          transaction_reference: markPaidMethod === 'transfer' ? markPaidReference.trim() : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to mark as paid');
      fetchBookings();
      setMarkPaidBookingId(null);
      setMarkPaidReference('');
      setSelectedBookingForDetails(null);
      showNotification('success', t('reception.paymentStatusUpdatedSuccessfully'));
    } catch (err: any) {
      console.error('Mark paid error:', err);
      showNotification('error', err.message || t('common.failedToMarkAsPaid'));
    } finally {
      setMarkPaidSubmitting(false);
    }
  }

  // Edit booking form state
  const [editBookingForm, setEditBookingForm] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    visitor_count: 1,
    total_price: 0,
    notes: '',
    status: 'pending',
  });

  // Edit booking function (same as tenant provider)
  async function handleEditBooking() {
    if (!editingBooking) return;

    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const updateData: any = {
        customer_name: editBookingForm.customer_name,
        customer_phone: editBookingForm.customer_phone,
        customer_email: editBookingForm.customer_email || null,
        visitor_count: editBookingForm.visitor_count,
        total_price: editBookingForm.total_price,
        notes: editBookingForm.notes || null,
        status: editBookingForm.status,
      };

      const response = await fetch(`${API_URL}/bookings/${editingBooking.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update booking');
      }

      await fetchBookings();
      setIsEditBookingModalOpen(false);
      setEditingBooking(null);
      showNotification('success', t('bookings.bookingUpdatedSuccessfully') || 'Booking updated successfully!');
    } catch (err: any) {
      console.error('Error updating booking:', err);
      showNotification('error', t('bookings.failedToUpdateBooking', { message: err.message }));
    }
  }

  // Handle edit time click (same as tenant provider)
  async function handleEditTimeClick(booking: Booking) {
    console.log('[ReceptionPage] ========================================');
    console.log('[ReceptionPage] EDIT TIME CLICK - Booking details:');
    console.log('   Booking ID:', booking.id);
    console.log('   Customer:', booking.customer_name);
    console.log('   Service ID:', (booking as any).service_id);
    console.log('   Service Name:', booking.services?.name);
    console.log('   Current slot date:', booking.slots?.slot_date);
    console.log('[ReceptionPage] ========================================');
    
    if (!userProfile?.tenant_id || !(booking as any).service_id) {
      showNotification('warning', t('bookings.cannotEditBookingTime') || 'Cannot edit booking time');
      return;
    }

    setEditingBookingTime(booking);
    // Set initial date to current booking date
    // FIX: Parse date string directly to avoid timezone issues with parseISO
    let initialDate: Date;
    if (booking.slots?.slot_date) {
      const [year, month, day] = booking.slots.slot_date.split('-').map(Number);
      initialDate = new Date(year, month - 1, day);
      setEditingTimeDate(initialDate);
      console.log('[ReceptionPage] Edit time click - date set:', {
        slotDate: booking.slots.slot_date,
        parsedDate: initialDate,
        dayOfWeek: initialDate.getDay(),
        dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][initialDate.getDay()]
      });
    } else {
      initialDate = new Date();
      setEditingTimeDate(initialDate);
    }
    setSelectedNewSlotId('');
    // Pass date directly to avoid race condition with state update
    await fetchTimeSlotsForEdit((booking as any).service_id, userProfile.tenant_id, initialDate);
  }

  // Fetch time slots for editing (same as tenant provider)
  async function fetchTimeSlotsForEdit(serviceId: string, tenantId: string, date?: Date) {
    // Use provided date or fall back to state
    const targetDate = date || editingTimeDate;
    if (!targetDate) {
      console.warn('[ReceptionPage] No date provided for slot fetching');
      return;
    }

    setLoadingTimeSlots(true);
    try {
      console.log('[ReceptionPage] ========================================');
      console.log('[ReceptionPage] Fetching available slots for booking time edit...');
      console.log('   Service ID:', serviceId);
      console.log('   Date object:', targetDate);
      console.log('   Date string:', format(targetDate, 'yyyy-MM-dd'));
      console.log('   Day of week:', targetDate.getDay(), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][targetDate.getDay()]);
      console.log('   Tenant ID:', tenantId);
      console.log('[ReceptionPage] ========================================');
      
      const result = await fetchAvailableSlotsUtil({
        tenantId,
        serviceId,
        date: targetDate,
        includePastSlots: true,  // Allow rescheduling to any slot (past or future)
        includeLockedSlots: false, // Still exclude locked slots
        includeZeroCapacity: false, // Still exclude fully booked slots
      });

      console.log('[ReceptionPage] ========================================');
      console.log('[ReceptionPage] Fetched slots:', result.slots.length);
      console.log('[ReceptionPage] Shifts found:', result.shifts.length);
      if (result.shifts.length > 0) {
        console.log('[ReceptionPage] Shift schedules:', result.shifts.map(s => ({
          id: s.id.substring(0, 8),
          days: s.days_of_week,
          dayNames: s.days_of_week.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d])
        })));
      }
      console.log('[ReceptionPage] ========================================');
      
      if (result.slots.length === 0) {
        console.warn('[ReceptionPage] ❌ No slots found for this date. Possible reasons:');
        console.warn('   - No shifts defined for this service');
        console.warn('   - No slots created for this date');
        console.warn('   - All slots are fully booked');
        console.warn('   - Day of week does not match shift schedule');
        console.warn('   CHECK THE LOGS ABOVE FOR DETAILS');
        
        // If we have shifts but no slots, try fetching with includeZeroCapacity to see if slots exist but are fully booked
        if (result.shifts.length > 0) {
          console.log('[ReceptionPage] Trying to fetch slots with includeZeroCapacity=true to check if slots exist but are fully booked...');
          try {
            const resultWithZero = await fetchAvailableSlotsUtil({
              tenantId,
              serviceId,
              date: targetDate,
              includePastSlots: true,
              includeLockedSlots: false,
              includeZeroCapacity: true, // Include fully booked slots
            });
            
            if (resultWithZero.slots.length > 0) {
              console.warn(`[ReceptionPage] ⚠️  Found ${resultWithZero.slots.length} slots but all are fully booked (available_capacity = 0)`);
              console.warn('[ReceptionPage]    These slots exist but cannot be selected because they have no available capacity');
            } else {
              console.warn('[ReceptionPage] ⚠️  No slots exist for this date at all');
            }
          } catch (diagError) {
            console.error('[ReceptionPage] Error in diagnostic query:', diagError);
          }
        }
      }

      setAvailableTimeSlots(result.slots as Slot[]);
    } catch (error: any) {
      console.error('Error fetching time slots:', error);
      showNotification('error', t('bookings.failedToFetchTimeSlots', { message: error.message }));
      setAvailableTimeSlots([]);
    } finally {
      setLoadingTimeSlots(false);
    }
  }

  // Handle time date change (same as tenant provider)
  async function handleTimeDateChange(newDate: Date) {
    setEditingTimeDate(newDate);
    setSelectedNewSlotId('');
    setChangeTimeEmployeeId('');
    if (editingBookingTime && userProfile?.tenant_id) {
      // Pass date directly to avoid race condition
      await fetchTimeSlotsForEdit((editingBookingTime as any).service_id, userProfile.tenant_id, newDate);
    }
  }

  // Update booking time (same as tenant provider - uses atomic endpoint)
  async function updateBookingTime() {
    if (!editingBookingTime || !selectedNewSlotId || !userProfile?.tenant_id) {
      showNotification('warning', t('bookings.pleaseSelectNewTimeSlot') || 'Please select a new time slot');
      return;
    }

    const ok = await showConfirm({
      title: t('common.confirm'),
      description: t('bookings.confirmChangeBookingTime') || 'Are you sure you want to change the booking time? Old tickets will be invalidated.',
      destructive: false,
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;

    setUpdatingBookingTime(true);
    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      console.log('[ReceptionPage] ========================================');
      console.log('[ReceptionPage] Updating booking time...');
      console.log('[ReceptionPage]   Booking ID:', editingBookingTime.id);
      console.log('[ReceptionPage]   New Slot ID:', selectedNewSlotId);
      console.log('[ReceptionPage]   API URL:', API_URL);
      console.log('[ReceptionPage] ========================================');

      const response = await fetch(`${API_URL}/bookings/${editingBookingTime.id}/time`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ slot_id: selectedNewSlotId }),
      });

      console.log('[ReceptionPage] Response status:', response.status);
      console.log('[ReceptionPage] Response ok:', response.ok);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[ReceptionPage] ❌ Error response:', errorData);
        throw new Error(errorData.error || t('bookings.failedToUpdateBookingTime', { message: t('common.error') }));
      }

      const result = await response.json().catch(() => ({}));
      console.log('[ReceptionPage] ✅ Success response:', result);

      // Store booking ID for verification
      const updatedBookingId = editingBookingTime.id;
      
      // Store the selected slot ID before clearing state
      const newSlotIdToVerify = selectedNewSlotId;
      
      // If the backend returned the updated booking, use it directly
      let backendBookingData: any = null;
      if (result.booking && result.booking.slots) {
        backendBookingData = {
          slot_id: result.booking.slot_id,
          slots: result.booking.slots,
          employee_id: result.booking.employee_id ?? undefined,
        };
        console.log('[ReceptionPage] ✅ Got updated booking from backend response:');
        console.log('[ReceptionPage]   slot_id:', backendBookingData.slot_id);
        console.log('[ReceptionPage]   slot_date:', backendBookingData.slots?.slot_date);
        console.log('[ReceptionPage]   start_time:', backendBookingData.slots?.start_time);
        console.log('[ReceptionPage]   employee_id:', backendBookingData.employee_id);
        
        // Immediately update the state with backend data (including employee_id for employee-based mode)
        setBookings(prevBookings => 
          prevBookings.map(b => {
            if (b.id === updatedBookingId) {
              console.log('[ReceptionPage] 🔄 Immediately updating booking state from backend response...');
              console.log('[ReceptionPage]     Old slot_date:', b.slots?.slot_date);
              console.log('[ReceptionPage]     New slot_date:', backendBookingData.slots?.slot_date);
              return { 
                ...b, 
                slot_id: backendBookingData.slot_id, 
                slots: backendBookingData.slots,
                ...(backendBookingData.employee_id !== undefined && { employee_id: backendBookingData.employee_id }),
              };
            }
            return b;
          })
        );
        
        // Also update todayBookings if this booking is in today's list
        setTodayBookings(prevTodayBookings =>
          prevTodayBookings.map(b => {
            if (b.id === updatedBookingId) {
              return { 
                ...b, 
                slot_id: backendBookingData.slot_id, 
                slots: backendBookingData.slots,
                ...(backendBookingData.employee_id !== undefined && { employee_id: backendBookingData.employee_id }),
              };
            }
            return b;
          })
        );
      }

      // Close modal first
      setEditingBookingTime(null);
      setSelectedNewSlotId('');
      setAvailableTimeSlots([]);

      // Refresh bookings with a delay to ensure backend has updated
      console.log('[ReceptionPage] Refreshing bookings after time update...');
      console.log('[ReceptionPage] Updated slot_id:', newSlotIdToVerify);
      console.log('[ReceptionPage] Booking ID to verify:', updatedBookingId);
      
      // Force refresh by clearing any potential cache
      setTimeout(async () => {
        // CRITICAL: Use API response data if available (most reliable)
        // The backend returns the updated booking with correct slot_date
        if (backendBookingData && backendBookingData.slot_id === newSlotIdToVerify) {
          console.log('[ReceptionPage] 🔄 Using API response data for state update...');
          console.log('[ReceptionPage]   API slot_id:', backendBookingData.slot_id);
          console.log('[ReceptionPage]   API slot_date:', backendBookingData.slots?.slot_date);
          
          // Update state immediately with API response data
          setBookings(prevBookings => {
            const updated = prevBookings.map(b => {
              if (b.id === updatedBookingId) {
                const updatedBooking = {
                  ...b,
                  slot_id: backendBookingData.slot_id,
                  slots: backendBookingData.slots,
                  ...(backendBookingData.employee_id !== undefined && { employee_id: backendBookingData.employee_id }),
                };
                console.log('[ReceptionPage]   State update from API response:', {
                  bookingId: updatedBookingId,
                  oldSlotDate: b.slots?.slot_date,
                  newSlotDate: updatedBooking.slots?.slot_date,
                });
                return updatedBooking;
              }
              return b;
            });
            return updated;
          });
          
          // Also update todayBookings
          setTodayBookings(prevTodayBookings => {
            const updated = prevTodayBookings.map(b => {
              if (b.id === updatedBookingId) {
                return {
                  ...b,
                  slot_id: backendBookingData.slot_id,
                  slots: backendBookingData.slots,
                  ...(backendBookingData.employee_id !== undefined && { employee_id: backendBookingData.employee_id }),
                };
              }
              return b;
            });
            return updated;
          });
          
          console.log('[ReceptionPage] ✅ State updated from API response');
        }
        
        // Verify the booking was updated correctly with multiple attempts
        let bookingData: any = null;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts && !bookingData) {
          attempts++;
          console.log(`[ReceptionPage] Verification attempt ${attempts}/${maxAttempts}...`);
          
          try {
            const { data, error } = await db
              .from('bookings')
              .select(`
                id,
                slot_id,
                slots:slot_id (
                  slot_date,
                  start_time,
                  end_time
                )
              `)
              .eq('id', updatedBookingId)
              .single();
            
            if (!error && data && data.slot_id === newSlotIdToVerify) {
              bookingData = data;
              console.log('[ReceptionPage] ✅ Verified updated booking:');
              console.log('[ReceptionPage]   slot_id:', bookingData.slot_id);
              console.log('[ReceptionPage]   slot_date:', bookingData.slots?.slot_date);
              console.log('[ReceptionPage]   start_time:', bookingData.slots?.start_time);
              break;
            } else if (error) {
              console.warn(`[ReceptionPage] Verification attempt ${attempts} failed:`, error);
            } else if (data && data.slot_id !== newSlotIdToVerify) {
              console.warn(`[ReceptionPage] Verification attempt ${attempts}: slot_id mismatch. Expected: ${newSlotIdToVerify}, Got: ${data.slot_id}`);
            }
          } catch (verifyError) {
            console.warn(`[ReceptionPage] Verification attempt ${attempts} error:`, verifyError);
          }
          
          // Wait before next attempt
          if (attempts < maxAttempts && !bookingData) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // Force a fresh query of all bookings
        await fetchBookings();
        console.log('[ReceptionPage] ✅ Bookings refreshed');
        
        // CRITICAL: After fetchBookings, ensure the updated booking has correct slot_date
        // This handles cases where fetchBookings might return stale relationship data
        if (bookingData && bookingData.slot_id === newSlotIdToVerify) {
          console.log('[ReceptionPage] 🔄 Force updating booking state with verified slot data after fetchBookings...');
          console.log('[ReceptionPage]   Verified slot_id:', bookingData.slot_id);
          console.log('[ReceptionPage]   Verified slot_date:', bookingData.slots?.slot_date || 'MISSING (will fetch)');
          
          // If slot_date is missing, fetch it separately
          let finalSlotData = bookingData.slots;
          if (!finalSlotData || !finalSlotData.slot_date) {
            console.log('[ReceptionPage]   Slot date missing, fetching slot details...');
            try {
              const { data: slotData, error: slotError } = await db
                .from('slots')
                .select('slot_date, start_time, end_time')
                .eq('id', bookingData.slot_id)
                .single();
              
              if (!slotError && slotData) {
                finalSlotData = slotData;
                console.log('[ReceptionPage]   ✅ Fetched slot date:', finalSlotData.slot_date);
              }
            } catch (slotFetchError) {
              console.warn('[ReceptionPage]   ⚠️  Failed to fetch slot details:', slotFetchError);
            }
          }
          
          // Update state again after fetchBookings to ensure correct slot_date
          setBookings(prevBookings => {
            const updated = prevBookings.map(b => {
              if (b.id === updatedBookingId) {
                const updatedBooking = {
                  ...b,
                  slot_id: bookingData.slot_id,
                  slots: finalSlotData || b.slots, // Use fetched slot data or keep old if fetch failed
                };
                console.log('[ReceptionPage]   Final state update after fetchBookings:', {
                  bookingId: updatedBookingId,
                  oldSlotDate: b.slots?.slot_date,
                  newSlotDate: updatedBooking.slots?.slot_date,
                });
                return updatedBooking;
              }
              return b;
            });
            return updated;
          });
          
          // Also update todayBookings
          setTodayBookings(prevTodayBookings => {
            const updated = prevTodayBookings.map(b => {
              if (b.id === updatedBookingId) {
                return {
                  ...b,
                  slot_id: bookingData.slot_id,
                  slots: finalSlotData || b.slots,
                };
              }
              return b;
            });
            return updated;
          });
          
          console.log('[ReceptionPage] ✅ State updated with verified slot data after fetchBookings');
        } else if (backendBookingData) {
          // If we have API response data but verification failed, still use API data
          console.log('[ReceptionPage] ✅ Using API response data (verification skipped)');
          setBookings(prevBookings => {
            const updated = prevBookings.map(b => {
              if (b.id === updatedBookingId && b.slot_id !== backendBookingData.slot_id) {
                return {
                  ...b,
                  slot_id: backendBookingData.slot_id,
                  slots: backendBookingData.slots,
                  ...(backendBookingData.employee_id !== undefined && { employee_id: backendBookingData.employee_id }),
                };
              }
              return b;
            });
            return updated;
          });
        } else {
          console.warn('[ReceptionPage] ⚠️  Could not verify booking update. Slot ID mismatch or booking not found.');
          if (bookingData) {
            console.warn(`[ReceptionPage]   Expected slot_id: ${newSlotIdToVerify}, Got: ${bookingData.slot_id}`);
          }
        }
      }, 1500);
      
      // Show a clear, informative success message
      let successMessage = '';
      
      if (result.message) {
        // Use the backend message which is already comprehensive
        successMessage = result.message;
      } else {
        // Fallback to translation or default
        successMessage = t('bookings.bookingTimeUpdatedSuccessfully') || 'Booking time updated successfully!';
        
        // Add details if available
        if (result.tickets_invalidated) {
          successMessage += '\n\n' + (t('bookings.oldTicketsInvalidated') || 'Old tickets have been invalidated.');
        }
        if (result.new_ticket_generated) {
          successMessage += '\n' + (t('bookings.newTicketSent') || 'A new ticket has been sent to the customer.');
        }
      }
      
      showNotification('success', successMessage);
    } catch (error: any) {
      console.error('[ReceptionPage] ❌ Error updating booking time:', error);
      showNotification('error', t('bookings.failedToUpdateBookingTime', { message: error.message }));
    } finally {
      setUpdatingBookingTime(false);
    }
  }

  // Initialize edit form when booking is selected
  useEffect(() => {
    if (editingBooking) {
      setEditBookingForm({
        customer_name: editingBooking.customer_name,
        customer_phone: editingBooking.customer_phone,
        customer_email: editingBooking.customer_email || '',
        visitor_count: editingBooking.visitor_count,
        total_price: editingBooking.total_price,
        notes: editingBooking.notes || '',
        status: editingBooking.status,
      });
    }
  }, [editingBooking]);

  // Download invoice PDF (TASK 7: Receptionist can download invoices)
  async function downloadInvoice(bookingId: string, zohoInvoiceId: string) {
    try {
      setDownloadingInvoice(bookingId);
      
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');
      
      // Ensure API_URL doesn't have trailing slash
      const baseUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
      // Add token as query parameter to bypass CORS header issues
      const downloadUrl = `${baseUrl}/zoho/invoices/${zohoInvoiceId}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      
      console.log('[ReceptionPage] Downloading invoice:', zohoInvoiceId);
      console.log('[ReceptionPage] Download URL:', downloadUrl.replace(token || '', '***'));
      
      // Use fetch to download the PDF and create a blob URL
      try {
        const response = await fetch(downloadUrl, {
          method: 'GET',
          headers: token ? {
            'Authorization': `Bearer ${token}`,
          } : {},
          signal: createTimeoutSignal('/zoho/invoices', false),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to download invoice: ${response.status} ${response.statusText}. ${errorText}`);
        }

        // Get the PDF as a blob
        const blob = await response.blob();
        
        // Create a blob URL and trigger download
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `invoice-${zohoInvoiceId}.pdf`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        
        // Clean up
        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
          setDownloadingInvoice(null);
        }, 100);
        
        console.log('[ReceptionPage] Download completed successfully');
      } catch (fetchError: any) {
        console.error('[ReceptionPage] Fetch error:', fetchError);
        // Fallback to direct link approach if fetch fails
        console.log('[ReceptionPage] Falling back to direct link approach');
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `invoice-${zohoInvoiceId}.pdf`;
        link.target = '_blank';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
          document.body.removeChild(link);
          setDownloadingInvoice(null);
        }, 1000);
      }
      
    } catch (error: any) {
      console.error('[ReceptionPage] Error downloading invoice:', error);
      const errorMessage = error.message || t('common.error');
      showNotification('error', t('common.failedToDownloadInvoice', { message: errorMessage }));
      setDownloadingInvoice(null);
    }
  }

  // Import shared QR utility function
  // Note: extractBookingIdFromQR is now imported from '../../lib/qrUtils'

  // Validate QR Code
  async function validateQRCode(qrContent: string) {
    setQrValidating(true);
    setQrValidationResult(null);

    try {
      // Extract booking ID from QR content (supports URL or raw UUID)
      const bookingId = extractBookingIdFromQR(qrContent);
      
      if (!bookingId) {
        setQrValidationResult({
          success: false,
          message: i18n.language === 'ar' 
            ? 'تنسيق QR غير صالح. يجب أن يحتوي رمز QR على معرف حجز صالح أو رابط.'
            : 'Invalid QR code format. QR code must contain a valid booking ID or URL.',
        });
        setQrValidating(false);
        return;
      }

      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/bookings/validate-qr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ booking_id: qrContent }), // Send original content, backend will extract
      });

      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        setQrValidationResult({
          success: false,
          message: `Server returned ${response.status} ${response.statusText}. Please check the console for details.`,
          booking: null,
        });
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        setQrValidationResult({
          success: false,
          message: data.error || 'Failed to validate QR code',
          booking: data.booking || null,
        });
        return;
      }

      setQrValidationResult({
        success: true,
        message: data.message || 'QR code validated successfully',
        booking: data.booking,
      });

      // Refresh bookings list
      await fetchBookings();

      // Auto-close after 3 seconds on success
      setTimeout(() => {
        setIsQRScannerOpen(false);
        setQrInputValue('');
        setQrValidationResult(null);
      }, 3000);
    } catch (err: any) {
      console.error('Error validating QR code:', err);
      setQrValidationResult({
        success: false,
        message: err.message || 'Failed to validate QR code',
      });
    } finally {
      setQrValidating(false);
    }
  }

  // Handle QR input (can be scanned or manually entered)
  function handleQRSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    
    const bookingId = qrInputValue.trim();
    if (!bookingId) {
      setQrValidationResult({
        success: false,
        message: t('reception.pleaseEnterBookingId'),
      });
      return;
    }

    validateQRCode(bookingId);
  }

  async function lookupCustomerByPhone(fullPhoneNumber: string) {
    if (!fullPhoneNumber || fullPhoneNumber.length < 10 || !userProfile?.tenant_id) return;

    setIsLookingUpCustomer(true);
    
    // Extract country code and phone number
    let phoneNumber = fullPhoneNumber;
    let code = tenantDefaultCountry; // Use tenant's default country code
    
    for (const country of countryCodes) {
      if (fullPhoneNumber.startsWith(country.code)) {
        code = country.code;
        phoneNumber = fullPhoneNumber.replace(country.code, '');
        break;
      }
    }
    setCustomerPackages([]);
    setCustomerIsBlocked(false);
    try {
      // First, try to find in customers table (include is_blocked for visitor block warning)
      const { data: customerData, error: customerError } = await db
        .from('customers')
        .select('id, name, email, phone, is_blocked')
        .eq('tenant_id', userProfile!.tenant_id)
        .eq('phone', fullPhoneNumber)
        .maybeSingle();

      if (customerError) throw customerError;

      if (customerData) {
        setCustomerIsBlocked((customerData as any).is_blocked === true);
        // Customer found in customers table - only auto-fill if fields are empty
        setBookingForm(prev => ({
          ...prev,
          customer_name: prev.customer_name || customerData.name || '',
          customer_email: prev.customer_email || customerData.email || ''
        }));

        // Fetch ALL active package subscriptions for this customer
        const { data: subscriptionsData } = await db
          .from('package_subscriptions')
          .select('id, package_id, status, expires_at, service_packages(name, name_ar, total_price)')
          .eq('customer_id', customerData.id)
          .eq('status', 'active');

        const packages: CustomerPackage[] = [];
        if (subscriptionsData && subscriptionsData.length > 0) {
          const nonExpired = subscriptionsData.filter(
            (sub: { expires_at?: string }) => !sub.expires_at || new Date(sub.expires_at) >= new Date()
          );
          if (nonExpired.length > 0) {
            const subscriptionIds = nonExpired.map((s: { id: string }) => s.id);
            // Single batched query instead of N queries (one per subscription)
            const { data: allUsage } = await db
              .from('package_subscription_usage')
              .select('subscription_id, service_id, original_quantity, remaining_quantity, used_quantity, services(name, name_ar)')
              .in('subscription_id', subscriptionIds);
            const usageBySub = new Map<string, typeof allUsage>();
            (allUsage || []).forEach((row: { subscription_id: string } & Record<string, unknown>) => {
              const list = usageBySub.get(row.subscription_id) || [];
              list.push(row);
              usageBySub.set(row.subscription_id, list);
            });
            nonExpired.forEach((sub: Record<string, unknown> & { id: string }) => {
              packages.push({ ...sub, usage: usageBySub.get(sub.id) || [] } as CustomerPackage);
            });
          }
        }
        setCustomerPackages(packages);
      } else {
        // Customer not found in customers table, check bookings table for guest bookings
        const { data: bookingData, error: bookingError } = await db
          .from('bookings')
          .select('customer_name, customer_email, customer_phone')
          .eq('tenant_id', userProfile!.tenant_id)
          .eq('customer_phone', fullPhoneNumber)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (bookingError) {
          console.error('Error looking up booking:', bookingError);
        } else if (bookingData) {
          // Guest booking found, auto-fill name and email only if fields are empty
          setBookingForm(prev => ({
            ...prev,
            customer_name: prev.customer_name || bookingData.customer_name || '',
            customer_email: prev.customer_email || bookingData.customer_email || ''
          }));
        }
        // If no customer or booking found, do nothing - don't overwrite user-entered fields
      }
    } catch (err) {
      console.error('Error looking up customer:', err);
    } finally {
      setIsLookingUpCustomer(false);
    }
  }

  // Helper function to check if two time slots overlap
  function doSlotsOverlap(slot1Start: string, slot1End: string, slot2Start: string, slot2End: string): boolean {
    // Convert time strings to comparable format (assuming HH:MM:SS format)
    return slot1Start < slot2End && slot2Start < slot1End;
  }

  // Check if service is available in any of customer's packages (aggregate remaining across all subscriptions)
  function checkServiceInPackage(serviceId: string): { available: boolean; remaining: number } {
    if (!customerPackages.length) return { available: false, remaining: 0 };

    let total = 0;
    for (const pkg of customerPackages) {
      const usage = pkg.usage.find(u => u.service_id === serviceId);
      if (usage) total += usage.remaining_quantity;
    }
    return {
      available: total > 0,
      remaining: total
    };
  }

  // Calculate booking price considering package availability AND already selected services in current session
  // Now supports partial coverage: uses package for available capacity, rest is paid
  function calculateBookingPrice(serviceId: string, quantity: number, alreadySelectedCount: number = 0): { 
    price: number; 
    usePackage: boolean; 
    canUsePackage: boolean;
    packageCoveredQty: number;
    paidQty: number;
  } {
    const service = services.find(s => s.id === serviceId);
    if (!service) return { price: 0, usePackage: false, canUsePackage: false, packageCoveredQty: 0, paidQty: quantity };

    const packageCheck = checkServiceInPackage(serviceId);

    // Calculate remaining after accounting for already selected services in this session
    const effectiveRemaining = packageCheck.remaining - alreadySelectedCount;

    // Calculate partial coverage
    const packageCoveredQty = Math.max(0, Math.min(quantity, effectiveRemaining));
    const paidQty = quantity - packageCoveredQty;

    // Calculate price only for paid portion
    const price = paidQty > 0 ? (service.base_price * paidQty) : 0;

    return {
      price,
      usePackage: packageCoveredQty > 0,
      canUsePackage: effectiveRemaining > 0,
      packageCoveredQty,
      paidQty
    };
  }

  // Get all booked time slots from selectedServices to avoid conflicts
  function getBookedTimeSlots() {
    return selectedServices.map(item => ({
      start_time: item.slot.start_time,
      end_time: item.slot.end_time
    }));
  }

  // Filter slots to exclude those that conflict with already selected services
  function filterConflictingSlots(availableSlots: Slot[]): Slot[] {
    console.log(`[ReceptionPage filterConflictingSlots] Input: ${availableSlots.length} slots, selectedServices: ${selectedServices.length}`);
    
    if (selectedServices.length === 0) {
      console.log(`[ReceptionPage filterConflictingSlots] No selected services, returning all ${availableSlots.length} slots`);
      return availableSlots;
    }

    const bookedSlots = getBookedTimeSlots();
    console.log(`[ReceptionPage filterConflictingSlots] Booked slots: ${bookedSlots.length}`, bookedSlots);
    
    const filtered = availableSlots.filter(slot => {
      // Check if this slot overlaps with any already booked slot
      const overlaps = bookedSlots.some(booked =>
        doSlotsOverlap(slot.start_time, slot.end_time, booked.start_time, booked.end_time)
      );
      if (overlaps) {
        console.log(`[ReceptionPage filterConflictingSlots] Slot ${slot.start_time}-${slot.end_time} overlaps with booked slot, filtering out`);
      }
      return !overlaps;
    });
    
    console.log(`[ReceptionPage filterConflictingSlots] Output: ${filtered.length} slots (filtered out ${availableSlots.length - filtered.length})`);
    return filtered;
  }

  function resetForm() {
    // Clear all booking form state completely
    setBookingForm({
      customer_phone: '',
      customer_name: '',
      customer_email: '',
      visitor_count: 1,
      notes: '',
      booking_option: 'consecutive'
    });
    setManualSlotAssignments([]);
    setShowPreview(false);
    setPreviewData(null);
    setSelectedSlots([]);
    setCountryCode(tenantDefaultCountry);
    setCustomerPhoneFull(''); // Clear full phone number
    setBookingSelectedCustomer(null);
    setSelectedService('');
    setSelectedOffer(''); // Clear selected offer
    setSelectedSlot('');
    setSelectedEmployee('');
    setSelectedTimeSlot(null);
    setSelectedDate(new Date());
    setAssignmentMode('automatic');
    setShowFullCalendar(false);
    setSelectedServices([]);
    setCustomerPackages([]); // Clear customer packages
    setIsLookingUpCustomer(false);
    setCreatePaymentMethod('onsite');
    setCreateTransactionReference('');
    
    // Clear any cached booking data from localStorage
    try {
      localStorage.removeItem('reception_booking_draft');
      localStorage.removeItem('reception_customer_data');
    } catch (e) {
      console.warn('Failed to clear localStorage:', e);
    }
  }

  function getNext8Days() {
    const today = new Date();
    return Array.from({ length: 8 }, (_, i) => addDays(today, i));
  }

  function getCalendarWeeks() {
    // Get start of current week (Sunday)
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
    // Generate 5 weeks (35 days)
    const weeks: Date[][] = [];
    for (let week = 0; week < 5; week++) {
      const weekDays: Date[] = [];
      for (let day = 0; day < 7; day++) {
        weekDays.push(addDays(weekStart, week * 7 + day));
      }
      weeks.push(weekDays);
    }
    return weeks;
  }

  function getBookingsForDate(date: Date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    return displayBookings.filter(booking => {
      const bookingDate = booking.slots?.slot_date;
      return bookingDate === dateStr;
    });
  }

  function getCalendarDaysInMonth() {
    const start = startOfMonth(calendarDate);
    const end = endOfMonth(calendarDate);
    return eachDayOfInterval({ start, end });
  }

  function generateTimeSlots() {
    const slots = [];
    const startHour = 6; // 6 AM
    const endHour = 22; // 10 PM
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        slots.push(time);
      }
    }
    return slots;
  }

  function getBookingPosition(startTime: string) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const startHour = 6;
    const totalMinutes = (hours - startHour) * 60 + minutes;
    return (totalMinutes / 30) * 60; // 60px per 30-min slot
  }

  function getBookingHeight(startTime: string, endTime: string) {
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    const durationMinutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
    return (durationMinutes / 30) * 60; // 60px per 30-min slot
  }

  function calculateBookingLayout(bookings: Booking[]) {
    if (bookings.length === 0) return [];

    // Sort bookings by start time
    const sortedBookings = [...bookings].sort((a, b) => {
      return (a.slots?.start_time || '').localeCompare(b.slots?.start_time || '');
    });

    // Helper to check if two bookings overlap
    const overlaps = (booking1: Booking, booking2: Booking) => {
      const start1 = booking1.slots?.start_time || '';
      const end1 = booking1.slots?.end_time || '';
      const start2 = booking2.slots?.start_time || '';
      const end2 = booking2.slots?.end_time || '';
      return start1 < end2 && start2 < end1;
    };

    // Assign columns to bookings
    const layout: Array<{ booking: Booking; column: number; totalColumns: number }> = [];
    const columns: Booking[][] = [];

    sortedBookings.forEach(booking => {
      // Find the first column where this booking doesn't overlap
      let columnIndex = 0;
      for (let i = 0; i < columns.length; i++) {
        const hasOverlap = columns[i].some(b => overlaps(b, booking));
        if (!hasOverlap) {
          columnIndex = i;
          break;
        }
        columnIndex = i + 1;
      }

      // Add to column
      if (!columns[columnIndex]) {
        columns[columnIndex] = [];
      }
      columns[columnIndex].push(booking);

      // Find all overlapping bookings to determine total columns needed
      const overlappingBookings = sortedBookings.filter(b => overlaps(b, booking));
      const maxColumns = Math.max(
        ...overlappingBookings.map(b => {
          const existingLayout = layout.find(l => l.booking.id === b.id);
          return existingLayout ? existingLayout.column + 1 : columnIndex + 1;
        })
      );

      layout.push({
        booking,
        column: columnIndex,
        totalColumns: maxColumns
      });
    });

    // Update totalColumns for all overlapping bookings
    layout.forEach((item, index) => {
      const overlappingItems = layout.filter(other =>
        overlaps(item.booking, other.booking)
      );
      const maxCols = Math.max(...overlappingItems.map(i => i.column + 1));
      layout[index].totalColumns = maxCols;
    });

    return layout;
  }

  function BookingCard({ booking }: { booking: Booking }) {
    return (
      <Card key={booking.id}>
        <CardContent className="py-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-3">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  <span className="font-medium text-lg">{booking.customer_name}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-4 h-4" />
                  <span className="text-sm">{booking.customer_phone}</span>
                </div>
                {booking.customer_email && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4" />
                    <span className="text-sm">{booking.customer_email}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">{t('reception.serviceLabel')}</span>
                  <div className="font-medium">
                    {i18n.language === 'ar' ? booking.services?.name_ar : booking.services?.name}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">{t('reception.dateAndTimeLabel')}</span>
                  <div className="font-medium">
                    {format(parseISO(booking.slots?.slot_date), 'MMM dd, yyyy', { locale: i18n.language?.startsWith('ar') ? ar : undefined })}
                    <br />
                    {formatTimeTo12Hour(booking.slots?.start_time ?? '')} - {formatTimeTo12Hour(booking.slots?.end_time ?? '')}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">{getBookingEmployees(booking).length > 1 ? t('reception.employeesLabel') : t('reception.employeeLabel')}</span>
                  <div className="font-medium">
                    {getBookingEmployees(booking).length > 0
                      ? getBookingEmployees(booking).map((emp, idx) => (
                          <span key={emp.id ?? idx}>
                            {i18n.language === 'ar' ? (emp.full_name_ar || emp.full_name) : emp.full_name}
                            {idx < getBookingEmployees(booking).length - 1 ? ', ' : ''}
                          </span>
                        ))
                      : (i18n.language === 'ar' ? '—' : '—')}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">{t('booking.visitorCount')}:</span>
                  <div className="font-medium">
                    {(booking as any).groupCount || booking.visitor_count} • {formatPrice((booking as any).grouped_total_price || booking.total_price)}
                    {/* Show only paid amount if package is used */}
                    {booking.package_covered_quantity !== undefined && booking.package_covered_quantity > 0 && booking.paid_quantity !== undefined && booking.paid_quantity > 0 && (
                      <span className="text-xs text-gray-500 ml-2">
                        ({t('reception.paidOnly')})
                      </span>
                    )}
                  </div>
                  {/* Package Coverage Badge */}
                  {booking.package_covered_quantity !== undefined && booking.package_covered_quantity > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      {booking.package_covered_quantity === booking.visitor_count ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-300">
                          <Package className="w-3 h-3" />
                          {t('reception.coveredByPackage')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300">
                          <Package className="w-3 h-3" />
                          {t('reception.packagePaidFormat', { package: booking.package_covered_quantity, paid: booking.paid_quantity || 0 })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {booking.notes && (
                <div className="mt-3 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                  <strong>{t('reception.notesLabelWithColon')}</strong> {booking.notes}
                </div>
              )}
              
              {/* Invoice Section (TASK 7: Receptionist can download invoices) */}
              {booking.zoho_invoice_id ? (
                <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-blue-600" />
                      <div>
                        <h4 className="font-semibold text-blue-900 text-sm">
                          {t('reception.invoice')}
                        </h4>
                        <p className="text-xs text-blue-700 font-mono mt-1">
                          {booking.zoho_invoice_id}
                        </p>
                      </div>
                    </div>
                    {getPaymentDisplayValue(booking) !== 'unpaid' ? (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3" />
                        {getPaymentDisplayLabel(booking, t)}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                        <XCircle className="w-3 h-3" />
                        {getPaymentDisplayLabel(booking, t)}
                      </span>
                    )}
                  </div>
                  {booking.zoho_invoice_created_at && (
                    <p className="text-xs text-blue-600 mb-3">
                      {i18n.language === 'ar' ? 'تاريخ الإنشاء:' : 'Created:'}{' '}
                      {formatDateTimeTo12Hour(booking.zoho_invoice_created_at, { locale: i18n.language === 'ar' ? ar : undefined })}
                    </p>
                  )}
                  <Button
                    onClick={() => downloadInvoice(booking.id, booking.zoho_invoice_id!)}
                    disabled={downloadingInvoice === booking.id}
                    className="flex items-center gap-2 text-sm w-full"
                    variant="ghost"
                    size="sm"
                  >
                    <Download className="w-4 h-4" />
                    {downloadingInvoice === booking.id 
                      ? (i18n.language === 'ar' ? 'جاري التنزيل...' : 'Downloading...')
                      : t('reception.downloadPdf')}
                  </Button>
                </div>
              ) : (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-xs text-gray-600 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    {i18n.language === 'ar' 
                      ? 'لا توجد فاتورة لهذا الحجز' 
                      : t('reception.noInvoiceForBooking')}
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row md:flex-col md:items-end gap-2">
              <div className="flex gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                  booking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  booking.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  booking.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                  booking.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {safeTranslateStatus(t, booking.status, 'booking')}
                </span>
                <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                  getPaymentDisplayValue(booking) === 'unpaid' ? 'bg-orange-100 text-orange-800' :
                  getPaymentDisplayValue(booking) === 'bank_transfer' ? 'bg-blue-100 text-blue-800' :
                  'bg-emerald-100 text-emerald-800'
                }`}>
                  {getPaymentDisplayLabel(booking, t)}
                </span>
              </div>
              {booking.status !== 'cancelled' && (
                <div className="flex flex-col gap-2 w-full sm:w-auto">
                  <div className="flex flex-wrap gap-2">
                    {booking.status !== 'completed' && (
                      <>
                        {booking.status === 'pending' && (
                          <Button
                            size="sm"
                            onClick={() => updateBookingStatus(booking.id, 'confirmed')}
                            icon={<CheckCircle className="w-3 h-3" />}
                          >
                            {t('common.confirm')}
                          </Button>
                        )}
                        {!isCoordinator && (
                          <>
                            {booking.status === 'confirmed' && (
                              <Button
                                size="sm"
                                onClick={() => updateBookingStatus(booking.id, 'completed')}
                                icon={<CheckCircle className="w-3 h-3" />}
                              >
                                {t('reception.complete')}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => updateBookingStatus(booking.id, 'cancelled')}
                              icon={<XCircle className="w-3 h-3" />}
                            >
                              {t('common.cancel')}
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  {!isCoordinator && (
                  <>
                  {getPaymentDisplayValue(booking) === 'unpaid' && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => updatePaymentStatus(booking.id, 'paid_manual')}
                      icon={<DollarSign className="w-3 h-3" />}
                      className="w-full"
                    >
                      {t('reception.markAsPaid')}
                    </Button>
                  )}
                  {getPaymentDisplayValue(booking) !== 'unpaid' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => updatePaymentStatus(booking.id, 'unpaid')}
                      icon={<DollarSign className="w-3 h-3" />}
                      className="w-full"
                    >
                      {t('reception.markAsUnpaid')}
                    </Button>
                  )}
                  
                  {/* QR Code Validation Button - only when tickets are enabled */}
                  {tenant?.tickets_enabled !== false && booking.status !== 'cancelled' && !(booking as any).qr_scanned && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setQrInputValue(booking.id);
                        setIsQRScannerOpen(true);
                        setQrValidationResult(null);
                      }}
                      icon={<QrCode className="w-3 h-3" />}
                      className="w-full"
                    >
                      {t('reception.scanQR')}
                    </Button>
                  )}
                  
                  {/* QR Already Scanned Indicator - only when tickets are enabled */}
                  {tenant?.tickets_enabled !== false && (booking as any).qr_scanned && (
                    <div className="w-full p-2 bg-green-50 border border-green-200 rounded-lg text-center">
                      <div className="flex items-center justify-center gap-2 text-green-800 text-xs">
                        <CheckCircle className="w-4 h-4" />
                        <span>{t('reception.qrScanned')}</span>
                      </div>
                      {(booking as any).qr_scanned_at && (
                        <div className="text-xs text-green-600 mt-1">
                          {formatDateTimeTo12Hour((booking as any).qr_scanned_at)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Edit and Reschedule Buttons - hidden for coordinator */}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingBooking(booking);
                      setIsEditBookingModalOpen(true);
                    }}
                    icon={<Edit className="w-3 h-3" />}
                    className="w-full"
                  >
                    {t('reception.editBooking')}
                  </Button>
                  {booking.status !== 'cancelled' && booking.status !== 'completed' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleEditTimeClick(booking)}
                      icon={<CalendarClock className="w-3 h-3" />}
                      className="w-full"
                    >
                      {t('bookings.changeTime')}
                    </Button>
                  )}
                  </>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Early return if user is not allowed on reception page (receptionist, coordinator, admin)
  const allowedReceptionRoles = ['receptionist', 'coordinator', 'tenant_admin', 'customer_admin', 'admin_user'];
  if (!authLoading && userProfile && !allowedReceptionRoles.includes(userProfile.role)) {
    // Redirect will happen in useEffect, but don't render anything
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Group bookings by booking_group_id and calculate totals
  function groupBookings(bookingList: Booking[]): Array<Booking & { grouped_quantity: number, grouped_total_price: number }> {
    const groupMap = new Map<string, Booking[]>();

    // Group bookings by booking_group_id
    bookingList.forEach(booking => {
      const groupId = booking.booking_group_id || booking.id;
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, []);
      }
      groupMap.get(groupId)!.push(booking);
    });

    // Create display bookings with aggregated quantity and price
    const result: Array<Booking & { grouped_quantity: number, grouped_total_price: number }> = [];
    groupMap.forEach((group) => {
      // Use first booking as representative
      const representative = group[0];
      const totalQuantity = group.reduce((sum, b) => sum + b.visitor_count, 0);
      const totalPrice = group.reduce((sum, b) => sum + b.total_price, 0);

      result.push({
        ...representative,
        grouped_quantity: totalQuantity,
        grouped_total_price: totalPrice
      });
    });

    return result;
  }

  // Use search results if searching, otherwise use regular bookings
  const bookingsToDisplay = showSearchResults ? searchResults : (activeTab === 'today' ? todayBookings : bookings);
  const displayBookings = groupBookings(bookingsToDisplay);

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">{t('reception.title')}</h1>
              <p className="text-xs md:text-sm text-gray-600">{t('reception.welcomeReceptionist')} {i18n.language === 'ar' ? userProfile?.full_name_ar : userProfile?.full_name}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={!isVisitorsPath && currentView === 'bookings' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setCurrentView('bookings'); tenantSlugForNav && navigate(`/${tenantSlugForNav}/reception`); }}
              >
                <Calendar className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">{i18n.language === 'ar' ? 'الحجوزات' : 'Bookings'}</span>
              </Button>
              {!isCoordinator && (
              <>
              <Button
                variant={!isVisitorsPath && currentView === 'packages' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setCurrentView('packages'); tenantSlugForNav && navigate(`/${tenantSlugForNav}/reception`); }}
              >
                <Package className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">{i18n.language === 'ar' ? 'الباقات' : 'Packages'}</span>
              </Button>
              <Button
                variant={isVisitorsPath ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => tenantSlugForNav && navigate(`/${tenantSlugForNav}/reception/visitors`)}
              >
                <Users className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">{t('navigation.visitors', 'Visitors')}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<Package className="w-4 h-4" />}
                onClick={() => setIsSubscriptionModalOpen(true)}
                className="hidden sm:flex"
              >
                <span className="hidden sm:inline">{t('packages.addSubscription')}</span>
              </Button>
              </>
              )}
              <LanguageToggle />
              <Button
                variant="secondary"
                size="sm"
                icon={<LogOut className="w-4 h-4" />}
                onClick={() => signOut()}
              >
                <span className="hidden sm:inline">{t('auth.logout')}</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Visitors View (reception layout, same APIs as admin) */}
        {isVisitorsPath && (
          <ReceptionVisitorsPage />
        )}

        {/* Packages View */}
        {!isVisitorsPath && currentView === 'packages' && (
          <ReceptionPackagesPage />
        )}

        {/* Bookings View */}
        {!isVisitorsPath && currentView === 'bookings' && (
          <>
        {/* Search Bar with Type Selector */}
        <div className="mb-6 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search Type Selector */}
            <div className="w-full sm:w-64">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reception.searchType') || 'Search By'}
              </label>
              <select
                value={searchType}
                onChange={(e) => handleSearchTypeChange(e.target.value as SearchType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="">{t('reception.selectSearchType') || 'Select search type...'}</option>
                <option value="phone">{t('reception.searchByPhone') || 'Customer Phone Number'}</option>
                <option value="customer_name">{t('reception.searchByName') || 'Customer Name'}</option>
                <option value="date">{t('reception.searchByDate') || 'Booking Date'}</option>
                <option value="service_name">{t('reception.searchByService') || 'Service Name'}</option>
                <option value="booking_id">{t('reception.searchByBookingId') || 'Booking ID'}</option>
              </select>
            </div>

            {/* Search Input (conditional based on type) */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {searchType === 'date' 
                  ? (t('reception.selectDate') || 'Select Date')
                  : (t('reception.searchValue') || 'Search Value')}
              </label>
              {searchType === 'date' ? (
                <Input
                  type="date"
                  value={searchDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className={`w-full ${!searchType ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!searchType || searchType !== 'date'}
                />
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <Input
                    type={searchType === 'phone' || searchType === 'booking_id' ? 'text' : 'text'}
                    value={searchQuery}
                    onChange={(e) => handleSearchInputChange(e.target.value)}
                    placeholder={
                      searchType === 'phone' 
                        ? (t('reception.phonePlaceholder') || 'Enter phone number...')
                        : searchType === 'booking_id'
                        ? (t('reception.bookingIdPlaceholder') || 'Enter booking ID (UUID)...')
                        : searchType === 'customer_name'
                        ? (t('reception.namePlaceholder') || 'Enter customer name...')
                        : searchType === 'service_name'
                        ? (t('reception.servicePlaceholder') || 'Enter service name...')
                        : (t('reception.selectSearchTypeFirst') || 'Select search type first...')
                    }
                    className={`pl-10 pr-10 ${!searchType ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={!searchType}
                  />
                  {(searchQuery || searchDate) && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSearchDate('');
                        setSearchType('');
                        setShowSearchResults(false);
                        setSearchResults([]);
                        setSearchValidationError('');
                      }}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      title={t('common.clear') || 'Clear'}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Validation Error */}
          {searchValidationError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
              {searchValidationError}
            </div>
          )}

          {/* Search Status */}
          {isSearching && (
            <p className="text-sm text-gray-500">{t('common.loading')}...</p>
          )}
          {showSearchResults && !isSearching && searchType && (
            <div className="flex items-center justify-between text-sm">
              <p className="text-gray-600">
                <span className="font-medium">{t('reception.searchingBy') || 'Searching by'}: </span>
                <span>
                  {searchType === 'phone' && (t('reception.searchByPhone') || 'Phone Number')}
                  {searchType === 'customer_name' && (t('reception.searchByName') || 'Customer Name')}
                  {searchType === 'date' && (t('reception.searchByDate') || 'Booking Date')}
                  {searchType === 'service_name' && (t('reception.searchByService') || 'Service Name')}
                  {searchType === 'booking_id' && (t('reception.searchByBookingId') || 'Booking ID')}
                </span>
              </p>
              <p className="text-gray-600">
                {searchResults.length > 0 
                  ? `${searchResults.length} ${t('reception.searchResults') || 'results found'}`
                  : t('reception.noSearchResults') || 'No results found'}
              </p>
            </div>
          )}
        </div>

        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            <Button
              variant={activeTab === 'today' ? 'primary' : 'secondary'}
              onClick={() => {
                setActiveTab('today');
                setSearchQuery('');
                setSearchDate('');
                setSearchType('');
                setShowSearchResults(false);
                setSearchResults([]);
                setSearchValidationError('');
              }}
              disabled={showSearchResults}
            >
              {t('dashboard.today')} ({todayBookings.length})
            </Button>
            <Button
              variant={activeTab === 'all' ? 'primary' : 'secondary'}
              onClick={() => {
                setActiveTab('all');
                setSearchQuery('');
                setSearchDate('');
                setSearchType('');
                setShowSearchResults(false);
                setSearchResults([]);
                setSearchValidationError('');
              }}
              disabled={showSearchResults}
            >
              {t('reception.allBookings')} ({bookings.length})
            </Button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <Button
                variant={viewMode === 'list' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setViewMode('list')}
                icon={<List className="w-4 h-4" />}
              >
                <span className="hidden sm:inline">{i18n.language?.startsWith('ar') ? 'عرض القائمة' : (t('bookings.listView') || 'List')}</span>
              </Button>
              <Button
                variant={viewMode === 'calendar' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setViewMode('calendar')}
                icon={<Grid className="w-4 h-4" />}
              >
                <span className="hidden sm:inline">{i18n.language?.startsWith('ar') ? 'عرض التقويم' : (t('bookings.calendarView') || 'Calendar')}</span>
              </Button>
            </div>
            {!isCoordinator && (
            <Button
              onClick={() => setIsModalOpen(true)}
              icon={<Plus className="w-4 h-4" />}
              size="sm"
            >
              <span className="hidden sm:inline">{t('booking.newBooking')}</span>
              <span className="sm:hidden">New</span>
            </Button>
            )}
            {tenant?.tickets_enabled !== false && (
              <Button
                onClick={() => {
                  setIsQRScannerOpen(true);
                  setQrInputValue('');
                  setQrValidationResult(null);
                }}
                icon={<Scan className="w-4 h-4" />}
                size="sm"
                variant="secondary"
              >
                <span className="hidden sm:inline">{t('reception.scanQR')}</span>
                <span className="sm:hidden">QR</span>
              </Button>
            )}
          </div>
        </div>

        {displayBookings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {showSearchResults 
                  ? t('reception.noSearchResults') || 'No results found'
                  : (activeTab === 'today' ? t('reception.noBookingsToday') : t('booking.noBookingsYet'))}
              </h3>
              <p className="text-gray-600">
                {showSearchResults 
                  ? t('common.tryDifferentSearch') || 'Try a different search term'
                  : t('reception.createNewBooking')}
              </p>
            </CardContent>
          </Card>
        ) : viewMode === 'list' ? (
          <div className="space-y-4">
            {displayBookings.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {/* Calendar Navigation */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
              <div className="flex items-center gap-4">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ChevronLeft className="w-4 h-4" />}
                  onClick={() => setCalendarDate(addDays(calendarDate, -7))}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCalendarDate(new Date())}
                >
                  Today
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ChevronRight className="w-4 h-4" />}
                  onClick={() => setCalendarDate(addDays(calendarDate, 7))}
                />
              </div>
              <h2 className="text-lg font-semibold">
                {format(startOfWeek(calendarDate, { weekStartsOn: 0 }), 'MMM d')} - {format(addDays(startOfWeek(calendarDate, { weekStartsOn: 0 }), 6), 'MMM d, yyyy')}
              </h2>
            </div>

            {/* Week View Calendar */}
            <div className="overflow-x-auto">
              <div className="min-w-[1200px]">
                {/* Day Headers */}
                <div className="grid grid-cols-8 border-b bg-gray-50 sticky top-0 z-10">
                  <div className="px-2 py-3 text-xs font-medium text-gray-500 border-r">Time</div>
                  {Array.from({ length: 7 }, (_, i) => {
                    const day = addDays(startOfWeek(calendarDate, { weekStartsOn: 0 }), i);
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div key={i} className={`px-2 py-3 text-center border-r ${
                        isToday ? 'bg-blue-50' : ''
                      }`}>
                        <div className="text-xs font-medium text-gray-500">
                          {format(day, 'EEE')}
                        </div>
                        <div className={`text-lg font-semibold ${
                          isToday ? 'text-blue-600' : 'text-gray-900'
                        }`}>
                          {format(day, 'd')}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Time Slots with Bookings */}
                <div className="relative">
                  <div className="grid grid-cols-8">
                    {/* Time Labels Column */}
                    <div className="border-r">
                      {generateTimeSlots().map((time, idx) => (
                        <div
                          key={idx}
                          className="h-[60px] px-2 py-1 text-xs text-gray-500 border-b text-right"
                        >
                          {time}
                        </div>
                      ))}
                    </div>

                    {/* Day Columns */}
                    {Array.from({ length: 7 }, (_, dayIndex) => {
                      const day = addDays(startOfWeek(calendarDate, { weekStartsOn: 0 }), dayIndex);
                      const dayBookings = getBookingsForDate(day);
                      const isToday = isSameDay(day, new Date());

                      return (
                        <div key={dayIndex} className={`relative border-r ${
                          isToday ? 'bg-blue-50/30' : ''
                        }`}>
                          {/* Time Grid */}
                          {generateTimeSlots().map((_, idx) => (
                            <div
                              key={idx}
                              className="h-[60px] border-b hover:bg-gray-50"
                            />
                          ))}

                          {/* Bookings Overlay */}
                          <div className="absolute inset-0 pointer-events-none">
                            {calculateBookingLayout(dayBookings).map(({ booking, column, totalColumns }) => {
                              const top = getBookingPosition(booking.slots?.start_time || '09:00');
                              const height = getBookingHeight(
                                booking.slots?.start_time || '09:00',
                                booking.slots?.end_time || '10:00'
                              );
                              const width = 100 / totalColumns;
                              const left = (100 / totalColumns) * column;

                              return (
                                <div
                                  key={booking.id}
                                  className={`absolute rounded shadow-sm border-l-4 p-2 cursor-pointer pointer-events-auto overflow-hidden ${
                                    booking.status === 'confirmed' ? 'bg-green-100 border-green-500 hover:bg-green-200' :
                                    booking.status === 'pending' ? 'bg-yellow-100 border-yellow-500 hover:bg-yellow-200' :
                                    booking.status === 'cancelled' ? 'bg-red-100 border-red-500 hover:bg-red-200' :
                                    booking.status === 'completed' ? 'bg-blue-100 border-blue-500 hover:bg-blue-200' :
                                    'bg-gray-100 border-gray-500 hover:bg-gray-200'
                                  }`}
                                  style={{
                                    top: `${top}px`,
                                    height: `${Math.max(height, 40)}px`,
                                    left: `calc(${left}% + 2px)`,
                                    width: `calc(${width}% - 4px)`
                                  }}
                                  onClick={() => setSelectedBookingForDetails(booking)}
                                >
                                  <div className="text-xs font-semibold truncate">
                                    {formatTimeTo12Hour(booking.slots?.start_time ?? '')}
                                  </div>
                                  <div className="text-xs font-medium truncate">
                                    {booking.customer_name}
                                  </div>
                                  <div className="text-xs text-gray-600 truncate">
                                    {i18n.language === 'ar' ? booking.services?.name_ar : booking.services?.name}
                                  </div>
                                  {/* Package Coverage Badge (Calendar View) */}
                                  {booking.package_covered_quantity !== undefined && booking.package_covered_quantity > 0 && (
                                    <div className="mt-0.5">
                                      {booking.package_covered_quantity === booking.visitor_count ? (
                                        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold bg-green-200 text-green-800">
                                          <Package className="w-2.5 h-2.5" />
                                          {i18n.language === 'ar' ? 'باقة' : 'Package'}
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold bg-blue-200 text-blue-800">
                                          <Package className="w-2.5 h-2.5" />
                                          {i18n.language === 'ar' 
                                            ? `${booking.package_covered_quantity}/${booking.visitor_count}`
                                            : `${booking.package_covered_quantity}/${booking.visitor_count}`}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {getBookingEmployees(booking).length > 0 && (
                                    <div className="text-xs text-gray-500 truncate mt-1">
                                      {getBookingEmployees(booking).map(emp =>
                                        (i18n.language === 'ar' ? (emp.full_name_ar || emp.full_name) : emp.full_name)
                                      ).join(', ')}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Full-screen loading overlay when creating booking (modal already closed) */}
      {bookingCreationLoadingStep && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4" />
          <p className="text-lg font-medium text-gray-800">
            {bookingCreationLoadingStep === 'creating_booking'
              ? t('reception.creatingBooking', 'Creating booking...')
              : t('reception.creatingInvoice', 'Creating invoice...')}
          </p>
        </div>
      )}

          <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={showPreview ? t('reception.bookingPreview') : t('reception.createNewBooking')}
      >
        {showPreview ? (
          <div className="space-y-6" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
            {/* Booking Preview Ticket */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6 shadow-lg">
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900">{t('reception.bookingSummary')}</h3>
                <p className="text-sm text-gray-600 mt-1">{t('reception.reviewBeforeConfirm')}</p>
              </div>

              {/* Customer Information */}
              <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {t('reception.customerInformation')}
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">{t('reception.nameLabel')}</span>
                    <div className="font-medium text-gray-900">{bookingForm.customer_name}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('reception.phoneLabel')}</span>
                    <div className="font-medium text-gray-900">{countryCode}{bookingForm.customer_phone}</div>
                  </div>
                  {bookingForm.customer_email && (
                    <div className="col-span-2">
                      <span className="text-gray-500">{t('reception.emailLabel')}</span>
                      <div className="font-medium text-gray-900">{bookingForm.customer_email}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Service Information */}
              <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('reception.serviceDetails')}</h4>
                {(() => {
                  const service = services.find(s => s.id === selectedService);
                  if (!service) return null;
                  const packageCheck = checkServiceInPackage(service.id);
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-gray-900">
                            {i18n.language === 'ar' ? service.name_ar : service.name}
                          </div>
                          <div className="text-sm text-gray-600">
                            {t('reception.quantityCount', { count: bookingForm.visitor_count })}
                          </div>
                        </div>
                        <div className="text-right">
                          {packageCheck.available && packageCheck.remaining >= (bookingForm.visitor_count as number) ? (
                            <span className="text-green-600 font-semibold text-sm flex items-center gap-1">
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                              </svg>
                              {t('reception.packageService')}
                            </span>
                          ) : (
                            <span className="font-bold text-gray-900">
                              {(() => {
                                const price = service.base_price || 0;
                                const visitorCount = typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1;
                                return formatPrice(price * visitorCount);
                              })()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {t('reception.mode')}: {bookingForm.visitor_count === 1 ? t('reception.singleBooking') : bookingForm.booking_option === 'parallel' ? t('reception.parallelBooking') : t('reception.consecutiveBooking')}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Time Slots: in employee-based mode ONLY from employee shifts; in service-based from service slots */}
              <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {isEmployeeBasedMode
                    ? (t('reception.availableTimesFromEmployees') || 'Available times (from employee shifts)')
                    : t('reception.scheduleAndEmployees')}
                </h4>
                {isEmployeeBasedMode && (
                  <p className="text-xs text-gray-500 mb-3">
                    {t('reception.employeeModeSlotNote') || 'Times are from employee shifts. Service slot settings do not apply.'}
                  </p>
                )}
                <div className="space-y-2">
                  {selectedSlots.length > 0 ? (
                    selectedSlots.map((slot, idx) => {
                      const employee = slots.find(s => s.id === slot.slot_id)?.users;
                      return (
                        <div key={idx} className="flex justify-between items-center py-2 border-b last:border-b-0">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {format(parseISO(slot.slot_date), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined })}
                            </div>
                            <div className="text-xs text-gray-600">
                              {formatTimeTo12Hour(slot.start_time)} - {formatTimeTo12Hour(slot.end_time)}
                            </div>
                          </div>
                          {employee && (
                            <div className="text-sm text-gray-700">
                              {i18n.language === 'ar' ? employee.full_name_ar : employee.full_name}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : selectedTimeSlot ? (
                    <div className="flex justify-between items-center py-2">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {format(parseISO(selectedTimeSlot.slot_date), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined })}
                        </div>
                        <div className="text-xs text-gray-600">
                          {formatTimeTo12Hour(selectedTimeSlot.start_time)} - {formatTimeTo12Hour(selectedTimeSlot.end_time)}
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">
                        {assignmentMode === 'automatic' ? t('reception.autoAssigned') : t('reception.manualAssignment')}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">{t('reception.noTimeSlotSelected')}</div>
                  )}
                </div>
              </div>

              {/* Notes */}
              {bookingForm.notes && (
                <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('reception.notesLabel')}</h4>
                  <p className="text-sm text-gray-600">{bookingForm.notes}</p>
                </div>
              )}

              {/* Payment method (when payable) */}
              {(() => {
                const service = services.find(s => s.id === selectedService);
                if (!service) return null;
                const pkg = checkServiceInPackage(service.id);
                const hasPayableAmount = !pkg.available || pkg.remaining < (bookingForm.visitor_count as number);
                if (!hasPayableAmount) return null;
                return (
                  <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('reception.paymentMethod') || 'Payment method'}</h4>
                    <p className="text-sm text-gray-900">
                      {createPaymentMethod === 'unpaid' ? (t(PAYMENT_DISPLAY_KEYS.unpaid) || 'Unpaid') : createPaymentMethod === 'onsite' ? (t(PAYMENT_DISPLAY_KEYS.paid_onsite) || 'Paid On Site') : (t(PAYMENT_DISPLAY_KEYS.bank_transfer) || 'Bank Transfer')}
                      {createPaymentMethod === 'transfer' && createTransactionReference && (
                        <span className="block mt-1 text-gray-600">Ref: {createTransactionReference}</span>
                      )}
                    </p>
                  </div>
                );
              })()}

              {/* Total Price */}
              <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-lg p-4 text-white">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">{t('reception.totalPrice')}</span>
                  <span className="text-2xl font-bold">
                    {(() => {
                      const service = services.find(s => s.id === selectedService);
                      if (!service) return formatPrice(0);
                      const packageCheck = checkServiceInPackage(service.id);
                      if (packageCheck.available && packageCheck.remaining >= (bookingForm.visitor_count as number)) {
                        return t('reception.packageServiceTotal', { price: formatPriceString(0) });
                      }
                      const price = service.base_price || 0;
                      const visitorCount = typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1;
                      return formatPrice(price * visitorCount);
                    })()}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="secondary"
                fullWidth
                onClick={() => setShowPreview(false)}
              >
                {t('reception.editBooking')}
              </Button>
              <Button
                type="button"
                fullWidth
                onClick={async () => {
                  setShowPreview(false);
                  setIsModalOpen(false);
                  setBookingCreationLoadingStep('creating_booking');
                  try {
                    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                    await handleSubmit(submitEvent as any);
                  } finally {
                    setBookingCreationLoadingStep(null);
                  }
                }}
              >
                {t('reception.confirmBooking')}
              </Button>
            </div>
          </div>
        ) : (
        <form onSubmit={(e) => {
          e.preventDefault();
          // Show preview instead of directly submitting
          setShowPreview(true);
        }} className="space-y-4">
          {/* 1. Customer Mobile + suggestions dropdown */}
          <div className="relative" ref={bookingPhoneWrapperRef}>
            <PhoneInput
              label={t('booking.customerPhone')}
              value={customerPhoneFull}
              onChange={(value) => {
                if (bookingSelectedCustomer && value !== bookingSelectedCustomer.phone) setBookingSelectedCustomer(null);
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
                setBookingForm({ ...bookingForm, customer_phone: phoneNumber });
                if (phoneNumber.length >= 8) lookupCustomerByPhone(value);
              }}
              defaultCountry={tenantDefaultCountry}
              required
            />
            {(isLookingUpCustomer || bookingPhoneSearchLoading) && (
              <div className="absolute right-3 top-[38px] flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
                <span className="text-xs text-gray-500">{t('reception.checkingCustomerAndPackages') || 'Checking customer & packages...'}</span>
              </div>
            )}
            {!bookingSelectedCustomer && bookingPhoneSuggestions.length >= 1 && (
              <CustomerPhoneSuggestionsDropdown
                suggestions={bookingPhoneSuggestions}
                onSelect={(c) => {
                  setBookingSelectedCustomer(c);
                  setCustomerPhoneFull(c.phone);
                  let localPhone = c.phone;
                  let code = tenantDefaultCountry;
                  for (const country of countryCodes) {
                    if (c.phone.startsWith(country.code)) {
                      code = country.code;
                      localPhone = c.phone.replace(country.code, '').trim();
                      break;
                    }
                  }
                  setCountryCode(code);
                  setBookingForm(prev => ({ ...prev, customer_name: c.name || '', customer_email: c.email || '', customer_phone: localPhone }));
                  clearBookingPhoneSuggestions();
                  lookupCustomerByPhone(c.phone);
                }}
                onClose={clearBookingPhoneSuggestions}
                containerRef={bookingPhoneWrapperRef}
              />
            )}
            {bookingSelectedCustomer && (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>{t('reception.existingCustomerSelected')}</span>
              </div>
            )}
          </div>

          {customerIsBlocked && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
              <Ban className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>
                {i18n.language === 'ar'
                  ? 'هذا الزائر محظور ولا يمكنه إنشاء حجوزات من جانب العميل. يمكنك الاستمرار في إنشاء الحجز من الاستقبال.'
                  : 'This visitor is blocked and cannot create bookings from the customer side. You can still create this booking from reception.'}
              </span>
            </div>
          )}

          {/* 2. Customer Name */}
          <Input
            label={`${t('booking.customerName')} *`}
            value={bookingForm.customer_name}
            onChange={(e) => setBookingForm({ ...bookingForm, customer_name: e.target.value })}
            required
            placeholder={t('booking.customerName')}
            disabled={!!bookingSelectedCustomer}
          />

          {/* 3. Customer Email */}
          <Input
            label={t('booking.customerEmail')}
            type="email"
            value={bookingForm.customer_email}
            onChange={(e) => setBookingForm({ ...bookingForm, customer_email: e.target.value })}
            placeholder={t('booking.customerEmail')}
            disabled={!!bookingSelectedCustomer}
          />

          {/* Package Information Display — scrollable, ~2 cards visible; show loading skeleton while looking up customer */}
          {isLookingUpCustomer && (
            <div className="rounded-lg border-2 border-gray-200 bg-gray-50 p-4 animate-pulse" role="status" aria-label={t('reception.loadingCustomerPackages') || 'Loading customer packages...'}>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-5 rounded bg-gray-300" />
                <div className="h-4 w-24 rounded bg-gray-300" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full rounded bg-gray-200" />
                <div className="h-4 w-3/4 rounded bg-gray-200" />
                <div className="h-4 w-1/2 rounded bg-gray-200" />
              </div>
              <p className="text-xs text-gray-500 mt-2">{t('reception.loadingCustomerPackages') || 'Loading customer packages...'}</p>
            </div>
          )}
          {!isLookingUpCustomer && customerPackages.length > 0 && (
            <div className="rounded-lg border-2 border-green-200 bg-green-50/50 p-2">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-green-800">
                <Package className="h-4 w-4" />
                {t('packages.activePackage')} ({customerPackages.length}) — {i18n.language === 'ar' ? 'مرر للأسفل للمزيد' : 'scroll for more'}
              </p>
              <div
                className="space-y-3 overflow-y-auto pr-1"
                style={{ maxHeight: '340px' }}
              >
                {customerPackages.map((pkg) => (
                  <div key={pkg.id} className="shrink-0 rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Package className="w-5 h-5 text-green-600 shrink-0" />
                      <h4 className="font-semibold text-green-900 truncate">
                        {i18n.language === 'ar' ? pkg.service_packages.name_ar : pkg.service_packages.name}
                      </h4>
                    </div>
                    <div className="space-y-2 text-sm">
                      {pkg.usage.map((usage) => (
                        <div key={`${pkg.id}-${usage.service_id}`} className="flex justify-between items-center py-1 gap-2">
                          <span className={`min-w-0 truncate ${usage.remaining_quantity === 0 ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                            {i18n.language === 'ar' ? usage.services?.name_ar : usage.services?.name}
                          </span>
                          <span className={`shrink-0 font-medium ${
                            usage.remaining_quantity > 5 ? 'text-green-600' :
                            usage.remaining_quantity > 0 ? 'text-amber-600' :
                            'text-red-600'
                          }`}>
                            {usage.remaining_quantity} / {usage.original_quantity} {t('packages.remaining')}
                          </span>
                        </div>
                      ))}
                    </div>
                    {pkg.expires_at && (
                      <p className="text-xs text-gray-600 mt-2">
                        {t('packages.expiresOn')}: {new Date(pkg.expires_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Select Service */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('reception.selectService')} *
            </label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={selectedService}
              onChange={(e) => {
                setSelectedService(e.target.value);
                setSelectedOffer(''); // Reset offer when service changes
                setSelectedSlot('');
              }}
              required
              disabled={loading}
            >
                <option value="">{loading ? t('common.loading') + '...' : t('reception.chooseService')}</option>
              {services.length === 0 && !loading ? (
                <option value="" disabled>
                  {t('reception.noServicesAvailable')}
                </option>
              ) : (
                services.map((service) => {
                const packageCheck = checkServiceInPackage(service.id);
                return (
                  <option key={service.id} value={service.id}>
                    {i18n.language === 'ar' ? service.name_ar : service.name} - {formatPrice(service.base_price)}
                    {packageCheck.available && ` 🎁 (${packageCheck.remaining} ${t('packages.remaining')})`}
                    {service.offers && service.offers.length > 0 && ` (${service.offers.length} ${t('reception.offers')})`}
                  </option>
                );
                })
              )}
            </select>
            {services.length === 0 && !loading && (
              <p className="mt-1 text-sm text-amber-600">
                ⚠️ {t('reception.noServicesFound')}
              </p>
            )}
            {loading && (
              <p className="mt-1 text-sm text-blue-600">
                {t('reception.loadingServices')}
              </p>
            )}
          </div>

          {/* 4b. Select Offer (if service has offers) */}
          {selectedService && (() => {
            const service = services.find(s => s.id === selectedService);
            const availableOffers = service?.offers || [];
            
            if (availableOffers.length > 0) {
              return (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {i18n.language === 'ar' ? 'اختر العرض (اختياري)' : 'Select Offer (Optional)'}
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    value={selectedOffer}
                    onChange={(e) => setSelectedOffer(e.target.value)}
                  >
                    <option value="">{t('reception.basePrice')} ({formatPrice(service?.base_price || 0)})</option>
                    {availableOffers.map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        {i18n.language === 'ar' ? offer.name_ar || offer.name : offer.name} - {formatPrice(offer.price)}
                        {offer.discount_percentage && ` (${t('reception.save')} ${offer.discount_percentage}%)`}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            return null;
          })()}

          {/* 5. Visitor Count */}
          {selectedService && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('booking.visitorCount')} *
              </label>
              <Input
                type="number"
                min="1"
                value={bookingForm.visitor_count}
                onChange={(e) => {
                  const visitorCount = parseInt(e.target.value) || 1;
                  setBookingForm({ 
                    ...bookingForm, 
                    visitor_count: visitorCount
                  });
                }}
                required
                placeholder="Enter number of tickets"
              />
              <p className="text-xs text-gray-600 mt-1">
                {(() => {
                  const service = services.find(s => s.id === selectedService);
                  const price = service?.base_price ?? 0;
                  return (
                    <>
                      {formatPrice(price)} {t('reception.perTicket') || 'per book'}
                    </>
                  );
                })()}
                {(() => {
                  const service = services.find(s => s.id === selectedService);
                  if (service?.original_price && service?.original_price > service?.base_price) {
                    return <span className="text-green-600 ml-1">(Discounted)</span>;
                  }
                  return null;
                })()}
              </p>

              {/* Package Partial Coverage Warning */}
              {selectedService && bookingForm.visitor_count && (() => {
                const packageCheck = checkServiceInPackage(selectedService);
                const quantity = typeof bookingForm.visitor_count === 'number' ? bookingForm.visitor_count : 1;
                
                if (packageCheck.remaining > 0 && packageCheck.remaining < quantity) {
                  const paidQty = quantity - packageCheck.remaining;
                  return (
                    <div className="mt-3 p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-yellow-800 mb-1">
                            {i18n.language === 'ar' ? 'تنبيه التغطية الجزئية' : 'Partial Package Coverage'}
                          </p>
                          <p className="text-sm text-yellow-700">
                            {i18n.language === 'ar' 
                              ? `حزمة العميل تغطي ${packageCheck.remaining} حجز. سيتم دفع ${paidQty} حجز بشكل طبيعي.`
                              : `Customer's package covers ${packageCheck.remaining} booking${packageCheck.remaining !== 1 ? 's' : ''}. The remaining ${paidQty} booking${paidQty !== 1 ? 's will' : ' will'} be charged normally.`}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                
                if (packageCheck.remaining === 0 && customerPackages.length > 0) {
                  return (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-300 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-blue-800 mb-1">
                            {i18n.language === 'ar' ? 'تنبيه الحزمة' : 'Package Notice'}
                          </p>
                          <p className="text-sm text-blue-700">
                            {i18n.language === 'ar' 
                              ? 'حزمة العميل لهذه الخدمة مستخدمة بالكامل. سيتم دفع هذا الحجز بشكل طبيعي.'
                              : 'Customer\'s package for this service is fully used. This booking will be charged normally.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                
                return null;
              })()}
            </div>
          )}

          {/* 6. Notes */}
          {selectedService && bookingForm.visitor_count && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('booking.notes')}
              </label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
                value={bookingForm.notes}
                onChange={(e) => setBookingForm({ ...bookingForm, notes: e.target.value })}
                placeholder={t('booking.notes')}
              />
            </div>
          )}

          {/* Payment method (when booking has payable amount) */}
          {selectedService && bookingForm.visitor_count && (() => {
            const pkg = checkServiceInPackage(selectedService);
            const hasPayableAmount = !pkg.available || pkg.remaining < (bookingForm.visitor_count as number);
            if (!hasPayableAmount) return null;
            return (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('reception.paymentMethod') || 'Payment method'}
                </label>
                <div className="flex flex-wrap gap-4 mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="createPaymentMethod"
                      checked={createPaymentMethod === 'unpaid'}
                      onChange={() => { setCreatePaymentMethod('unpaid'); setCreateTransactionReference(''); }}
                      className="rounded-full border-gray-300 text-blue-600"
                    />
                    <span>{t(PAYMENT_DISPLAY_KEYS.unpaid) || 'Unpaid'}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="createPaymentMethod"
                      checked={createPaymentMethod === 'onsite'}
                      onChange={() => { setCreatePaymentMethod('onsite'); setCreateTransactionReference(''); }}
                      className="rounded-full border-gray-300 text-blue-600"
                    />
                    <span>{t(PAYMENT_DISPLAY_KEYS.paid_onsite) || 'Paid On Site'}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="createPaymentMethod"
                      checked={createPaymentMethod === 'transfer'}
                      onChange={() => setCreatePaymentMethod('transfer')}
                      className="rounded-full border-gray-300 text-blue-600"
                    />
                    <span>{t(PAYMENT_DISPLAY_KEYS.bank_transfer) || 'Bank Transfer'}</span>
                  </label>
                </div>
                {createPaymentMethod === 'transfer' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('reception.transactionReference') || 'Transaction reference'} *
                    </label>
                    <input
                      type="text"
                      value={createTransactionReference}
                      onChange={(e) => setCreateTransactionReference(e.target.value)}
                      placeholder={t('reception.enterReferenceNumber') || 'Enter reference number'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Add Service Button */}
          {selectedService && (assignmentMode === 'automatic' && selectedTimeSlot || assignmentMode === 'manual' && selectedSlot) && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 mb-2">
                {t('reception.multiServiceNote')}
              </p>
              <button
                type="button"
                onClick={() => {
                  const service = services.find(s => s.id === selectedService);
                  if (!service) return;

                  let slotToAdd: Slot | undefined;
                  let employeeId = '';

                  if (assignmentMode === 'automatic') {
                    // Find the slot at the selected time
                    const slotsAtTime = slots.filter(
                      s => s.start_time === selectedTimeSlot!.start_time &&
                           s.end_time === selectedTimeSlot!.end_time &&
                           s.available_capacity > 0
                    );
                    slotToAdd = slotsAtTime[0];
                    if (slotToAdd) {
                      employeeId = slotToAdd.employee_id || '';
                    }
                  } else {
                    slotToAdd = slots.find(s => s.id === selectedSlot);
                    employeeId = selectedEmployee || (slotToAdd?.employee_id || '');
                  }

                  if (!slotToAdd) {
                    showNotification('warning', t('reception.slotNotSelected'));
                    return;
                  }

                  // Check if service already added
                  if (selectedServices.some(s => s.service.id === service.id)) {
                    showNotification('info', t('common.serviceAlreadyAdded'));
                    return;
                  }

                  // Check for time slot conflicts
                  const bookedSlots = getBookedTimeSlots();
                  const hasConflict = bookedSlots.some(booked =>
                    doSlotsOverlap(slotToAdd!.start_time, slotToAdd!.end_time, booked.start_time, booked.end_time)
                  );

                  if (hasConflict) {
                    showNotification('warning', t('reception.timeConflict'));
                    return;
                  }

                  setSelectedServices([...selectedServices, {
                    service,
                    slot: slotToAdd,
                    employeeId
                  }]);

                  // Reset selection
                  setSelectedService('');
                  setSelectedSlot('');
                  setSelectedEmployee('');
                  setSelectedTimeSlot(null);
                  setSlots([]);
                }}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                {t('reception.addService')}
              </button>
            </div>
          )}

          {/* Selected Services List */}
          {selectedServices.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-green-900 mb-3">{t('reception.selectedServices')}</h4>
              <div className="space-y-2">
                {selectedServices.map((item, index) => (
                  <div key={index} className="flex items-center justify-between bg-white p-3 rounded-lg border border-green-200">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">
                        {i18n.language === 'ar' ? item.service.name_ar : item.service.name}
                      </div>
                      <div className="text-sm text-gray-600">
                        {formatTimeTo12Hour(item.slot.start_time)} - {formatTimeTo12Hour(item.slot.end_time)}
                        {item.employeeId && item.slot.users && (
                          <span className="ml-2">
                            ({i18n.language === 'ar' ? item.slot.users.full_name_ar : item.slot.users.full_name})
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-medium text-green-600">
                        {formatPrice(item.service.base_price)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedServices(selectedServices.filter((_, i) => i !== index));
                      }}
                      className="ml-3 text-red-600 hover:text-red-700 font-medium text-sm"
                    >
                      {t('reception.remove')}
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-green-200 flex justify-between items-center">
                <span className="font-medium text-gray-900">Total:</span>
                <span className="text-lg font-bold text-green-600">
                  {formatPrice(selectedServices.reduce((sum, item) => sum + item.service.base_price, 0))}
                </span>
              </div>
            </div>
          )}

          {selectedService && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('booking.selectDate')} *
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowFullCalendar(!showFullCalendar)}
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <CalendarDays className="w-4 h-4" />
                    {showFullCalendar ? t('reception.hideCalendar') : t('reception.showFullCalendar')}
                  </button>
                </div>

                {!showFullCalendar ? (
                  <div className="grid grid-cols-4 gap-2">
                    {getNext8Days().map((day) => {
                      const isToday = isSameDay(day, new Date());
                      return (
                        <button
                          key={day.toString()}
                          type="button"
                          onClick={() => setSelectedDate(day)}
                          className={`p-2 text-center rounded-lg border ${
                            isSameDay(day, selectedDate)
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          } ${isToday ? 'ring-2 ring-blue-300' : ''}`}
                        >
                          <div className="text-xs font-medium">
                            {isToday ? t('dashboard.today') : format(day, 'EEE')}
                          </div>
                          <div className="text-lg font-bold">{format(day, 'd')}</div>
                          <div className="text-xs text-gray-500">{format(day, 'MMM')}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border border-gray-300 rounded-lg p-4">
                    <input
                      type="date"
                      value={format(selectedDate, 'yyyy-MM-dd')}
                      onChange={(e) => setSelectedDate(new Date(e.target.value))}
                      min={format(new Date(), 'yyyy-MM-dd')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                )}
              </div>

              {/* Employee-based mode only: show assignment (Auto / Manual). Manual is an instruction to receptionist, not a button. */}
              {isEmployeeBasedMode && (tenantAssignmentMode === 'both' || tenantAssignmentMode === 'automatic' || tenantAssignmentMode === 'manual') && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('reception.employeeAssignment') || 'Employee assignment'}
                  </label>
                  <div className="space-y-2">
                    {(tenantAssignmentMode === 'both' || tenantAssignmentMode === 'automatic') && (
                      <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                        assignmentMode === 'automatic'
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}>
                        <input
                          type="radio"
                          name="assignmentMode"
                          checked={assignmentMode === 'automatic'}
                          onChange={() => {
                            setAssignmentMode('automatic');
                            setSelectedSlot('');
                            setSelectedEmployee('');
                            setSelectedTimeSlot(null);
                          }}
                          className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{t('reception.automaticAssignment')}</div>
                          <div className="text-xs text-gray-600 mt-0.5">{t('reception.autoAssignDescription') || 'System assigns to employee with least bookings'}</div>
                        </div>
                      </label>
                    )}
                    {(tenantAssignmentMode === 'both' || tenantAssignmentMode === 'manual') && (
                      <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                        assignmentMode === 'manual'
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}>
                        <input
                          type="radio"
                          name="assignmentMode"
                          checked={assignmentMode === 'manual'}
                          onChange={() => {
                            setAssignmentMode('manual');
                            setSelectedSlot('');
                            setSelectedEmployee('');
                            setSelectedTimeSlot(null);
                          }}
                          className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{t('reception.manualAssignment')}</div>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {t('reception.manualAssignInstruction') || 'Receptionist should choose specific employee and time.'}
                          </p>
                        </div>
                      </label>
                    )}
                  </div>
                </div>
              )}

                {/* Employee distribution display - optional, kept commented */}
                {/* {assignmentMode === 'automatic' && availableEmployees.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                    <div className="text-sm font-medium text-blue-900 mb-2">Employee Distribution:</div>
                    <div className="space-y-1">
                      {availableEmployees.slice(0, 3).map((emp, idx) => (
                        <div key={emp.id} className="text-xs text-blue-800 flex items-center justify-between">
                          <span>
                            {idx === 0 && '➜ '}{i18n.language === 'ar' ? emp.name_ar : emp.name}
                          </span>
                          <span className="font-medium">{emp.bookingCount} bookings</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )} */}

                {/* Show already booked time slots */}
                {selectedServices.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                    <div className="text-sm font-medium text-amber-900 mb-2">
                      {t('reception.bookedTimeSlots')}:
                    </div>
                    <div className="space-y-1">
                      {selectedServices.map((item, idx) => {
                        const pricingInfo = calculateBookingPrice(item.service.id, 1);
                        return (
                          <div key={idx} className="text-xs flex items-center justify-between py-1">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-amber-900">
                                {i18n.language === 'ar' ? item.service.name_ar : item.service.name}
                              </span>
                              <span className="text-amber-700">{formatTimeTo12Hour(item.slot.start_time)} - {formatTimeTo12Hour(item.slot.end_time)}</span>
                            </div>
                            {pricingInfo.usePackage ? (
                              <span className="text-green-600 font-semibold flex items-center gap-1">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                </svg>
                                {t('packages.packageService')}
                              </span>
                            ) : (
                              <span className="text-gray-700 font-medium">{formatPrice(pricingInfo.price)}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-xs text-amber-700 mt-2 italic">
                      {t('reception.availableTimesOnly')}
                    </div>
                  </div>
                )}

                {/* Employee-based + manual: show employee dropdown */}
                {isEmployeeBasedMode && assignmentMode === 'manual' && (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('reception.selectEmployee')} *
                    </label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      value={selectedEmployee}
                      onChange={(e) => {
                        setSelectedEmployee(e.target.value);
                        setSelectedSlot('');
                      }}
                      required={assignmentMode === 'manual'}
                    >
                      <option value="">{t('reception.chooseEmployee')}</option>
                      {availableEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {i18n.language === 'ar' ? emp.name_ar : emp.name} ({emp.bookingCount} {t('reception.bookingsToday') || 'bookings today'})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('reception.availableSlots')} *
                </label>

                {(() => {
                  // Show selection indicator if quantity > 1 OR if we need slot selection validation
                  const required = getRequiredSlotsCount();

                  // Only show if multiple slots are required
                  if (required <= 1 && selectedSlots.length === 0) return null;

                  const validation = validateSlotSelection();
                  const isComplete = selectedSlots.length === required && validation.valid;
                  const isPartial = selectedSlots.length > 0 && selectedSlots.length < required;
                  const hasError = selectedSlots.length > 0 && !validation.valid;

                  return (
                    <div className={`mb-2 p-3 rounded-lg border ${
                      isComplete ? 'bg-green-50 border-green-300' :
                      hasError ? 'bg-red-50 border-red-300' :
                      isPartial ? 'bg-yellow-50 border-yellow-300' :
                      'bg-gray-50 border-gray-300'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="text-lg">
                            {isComplete ? '✓' : isPartial ? '⚠' : 'ℹ'}
                          </span>
                          <span className={
                            isComplete ? 'text-green-900' :
                            hasError ? 'text-red-900' :
                            isPartial ? 'text-yellow-900' :
                            'text-gray-900'
                          }>
                            Slot Selection
                          </span>
                        </div>
                        <div className={`text-sm font-bold ${
                          isComplete ? 'text-green-700' :
                          hasError ? 'text-red-700' :
                          isPartial ? 'text-yellow-700' :
                          'text-gray-700'
                        }`}>
                          {selectedSlots.length} / {required}
                        </div>
                      </div>
                      <div className={`text-xs ${
                        isComplete ? 'text-green-800' :
                        hasError ? 'text-red-800' :
                        isPartial ? 'text-yellow-800' :
                        'text-gray-700'
                      }`}>
                        {validation.message}
                      </div>
                      <div className="text-xs mt-2 text-gray-600 italic">
                        💡 {t('common.tip')}: {t('common.clickSlotMultiple')}
                      </div>
                    </div>
                  );
                })()}

                {!selectedService || !selectedDate ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <Clock className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600">{t('reception.selectServiceAndDateFirst') || 'Please select a service and date to see available times.'}</p>
                  </div>
                ) : (selectedService && selectedDate && (assignmentMode !== 'manual' || selectedEmployee) && loadingTimeSlots) ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4" role="status" aria-label={t('reception.loadingSlots') || 'Loading available times...'}>
                    <div className="flex items-center justify-center gap-3 py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
                      <p className="text-sm font-medium text-gray-600">{t('reception.loadingSlots') || 'Loading available times...'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-16 rounded-lg bg-gray-200/80 animate-pulse" />
                      ))}
                    </div>
                  </div>
                ) : assignmentMode === 'manual' && !selectedEmployee ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <User className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600">{t('reception.selectEmployeeFirst') || 'Please select an employee first.'}</p>
                    {!loadingTimeSlots && availableEmployees.length === 0 && (
                      <p className="text-xs text-amber-600 mt-2">{t('reception.noEmployeesForServiceDate') || 'No employees with shifts for this service on the selected date. Add work schedule in Settings → Employees.'}</p>
                    )}
                  </div>
                ) : assignmentMode === 'manual' && selectedEmployee && slots.filter(s => s.employee_id === selectedEmployee).length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <Clock className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600">{t('reception.noSlotsAvailable')}</p>
                    <p className="text-xs text-amber-600 mt-2 max-w-md mx-auto">
                      {selectedDate
                        ? t('reception.noSlotsForEmployeeSteps', {
                            dayName: (i18n.language === 'ar'
                              ? ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
                              : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])[selectedDate.getDay()],
                          })
                        : t('reception.noSlotsForEmployeeHint')}
                    </p>
                  </div>
                ) : assignmentMode === 'automatic' && slots.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <Clock className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600">{t('reception.noSlotsAvailable')}</p>
                    {process.env.NODE_ENV === 'development' && (
                      <div className="mt-4 text-xs text-gray-500 space-y-1">
                        <p>Debug Info:</p>
                        <p>Selected Service: {selectedService || 'None'}</p>
                        <p>Selected Date: {selectedDate ? format(selectedDate, 'yyyy-MM-dd') : 'None'}</p>
                        <p>Current Time: {new Date().toLocaleTimeString()}</p>
                        <p>Check browser console for detailed logs</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {selectedSlots.length > 0 && (
                      <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="text-xs font-medium text-blue-800 mb-1">{t('reception.yourSelection') || 'Your selection'}</div>
                        <div className="space-y-1">
                          {selectedSlots.map((slot, idx) => {
                            const slotObj = slots.find(s => s.id === slot.slot_id);
                            const employee = slotObj?.users;
                            return (
                              <div key={idx} className="flex justify-between items-center text-sm">
                                <span className="text-gray-700">
                                  {format(parseISO(slot.slot_date), 'MMM d', { locale: i18n.language === 'ar' ? ar : undefined })} {formatTimeTo12Hour(slot.start_time)} - {formatTimeTo12Hour(slot.end_time)}
                                  {employee && (
                                    <span className="text-gray-500 ml-1">({i18n.language === 'ar' ? employee.full_name_ar : employee.full_name})</span>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const slotIndex = selectedSlots.map(s => s.slot_id).lastIndexOf(slot.slot_id);
                                    if (slotIndex !== -1) {
                                      setSelectedSlots(prev => {
                                        const next = [...prev];
                                        next.splice(slotIndex, 1);
                                        if (next.length === 0) setSelectedSlot('');
                                        else if (next.length === 1) setSelectedSlot(next[0].slot_id);
                                        return next;
                                      });
                                    }
                                  }}
                                  className="text-red-600 hover:text-red-800 p-1 rounded"
                                  title={t('reception.removeSlot') || 'Remove'}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {assignmentMode === 'automatic' ? (
                      // For automatic mode, group slots by time and show unique time slots
                      (() => {
                        const timeSlotMap = new Map<string, Slot[]>();
                        slots.forEach(slot => {
                          const timeKey = `${slot.slot_date}-${slot.start_time}-${slot.end_time}`;
                          if (!timeSlotMap.has(timeKey)) {
                            timeSlotMap.set(timeKey, []);
                          }
                          timeSlotMap.get(timeKey)!.push(slot);
                        });

                        // Hide time groups that are already selected so selected slots disappear from the list
                        const entries = Array.from(timeSlotMap.entries()).filter(([, groupedSlots]) => {
                          const first = groupedSlots[0];
                          return !selectedSlots.some(s => s.start_time === first.start_time && s.end_time === first.end_time);
                        });

                        return entries.map(([timeKey, groupedSlots]) => {
                          const firstSlot = groupedSlots[0];
                          const totalAvailable = groupedSlots.reduce((sum, s) => sum + s.available_capacity, 0);

                          return (
                            <button
                              key={timeKey}
                              type="button"
                              onClick={(e) => handleSlotClick(firstSlot, e)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                handleSlotClick(firstSlot, { ...e, button: 2 } as any);
                              }}
                              className="p-3 text-left rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Clock className="w-4 h-4" />
                                <span className="font-medium">{formatTimeTo12Hour(firstSlot.start_time)} - {formatTimeTo12Hour(firstSlot.end_time)}</span>
                              </div>
                              <div className="text-xs">
                                {totalAvailable} spots left
                              </div>
                            </button>
                          );
                        });
                      })()
                    ) : (
                      // For manual mode, show slots filtered by selected employee
                      (() => {
                        // Group slots by time for manual mode too
                        const timeSlotMap = new Map<string, Slot[]>();
                        slots
                          .filter(slot => slot.employee_id === selectedEmployee && !selectedSlots.some(s => s.slot_id === slot.id))
                          .forEach(slot => {
                            const timeKey = `${slot.slot_date}-${slot.start_time}-${slot.end_time}`;
                            if (!timeSlotMap.has(timeKey)) {
                              timeSlotMap.set(timeKey, []);
                            }
                            timeSlotMap.get(timeKey)!.push(slot);
                          });

                        return Array.from(timeSlotMap.entries()).map(([timeKey, groupedSlots]) => {
                          const slot = groupedSlots[0];

                          return (
                            <button
                              key={slot.id}
                              type="button"
                              onClick={(e) => handleSlotClick(slot, e)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                handleSlotClick(slot, { ...e, button: 2 } as any);
                              }}
                              className="p-3 text-left rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Clock className="w-4 h-4" />
                                <span className="font-medium">{formatTimeTo12Hour(slot.start_time)} - {formatTimeTo12Hour(slot.end_time)}</span>
                              </div>
                              <div className="text-xs">
                                {slot.available_capacity} spots left
                              </div>
                            </button>
                          );
                        });
                      })()
                    )}
                  </div>
                  </>
                )}
              </div>
            </>
          )}

          {(() => {
            // Show booking options when quantity > 1
            if (bookingForm.visitor_count <= 1) return null;

            // For automatic mode, we need a selected time slot to check employee availability
            // For manual mode, we can show options without a selected slot
            if (assignmentMode === 'automatic' && !selectedTimeSlot) return null;

            let numEmployees = 1;
            let totalCapacity = 1;

            if (selectedTimeSlot) {
              const slotsInTimeRange = slots.filter(
                s => s.start_time === selectedTimeSlot.start_time && s.end_time === selectedTimeSlot.end_time
              );
              totalCapacity = slotsInTimeRange.reduce((sum, s) => sum + s.available_capacity, 0);
              numEmployees = slotsInTimeRange.length;
            } else if (assignmentMode === 'manual' && selectedEmployee) {
              // For manual mode, check if selected employee has capacity
              const employeeSlots = slots.filter(s => s.employee_id === selectedEmployee);
              numEmployees = employeeSlots.length > 0 ? 1 : 0;
            } else {
              // No slot selected yet in manual mode - show all options
              numEmployees = slots.length > 0 ? 2 : 1; // Assume multiple employees available
            }

            const needsExtension = bookingForm.visitor_count > numEmployees;
            const parallelSlots = Math.min(bookingForm.visitor_count, numEmployees);
            const extensionSlots = needsExtension ? bookingForm.visitor_count - numEmployees : 0;

            // Auto-select consecutive if only 1 employee (but only if we have a selected slot)
            if (selectedTimeSlot && numEmployees <= 1 && bookingForm.booking_option === 'parallel') {
              setBookingForm({ ...bookingForm, booking_option: 'consecutive' });
            }

            return (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Booking Option *
                </label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBookingForm({ ...bookingForm, booking_option: 'parallel' });
                      setManualSlotAssignments([]);
                    }}
                    className={`p-3 text-left rounded-lg border ${
                      bookingForm.booking_option === 'parallel'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium">
                      ✓ Parallel {needsExtension && selectedTimeSlot ? '+ Extension' : ''} - Multiple Employees
                    </div>
                    <div className="text-sm text-gray-600">
                      {selectedTimeSlot ? (
                        needsExtension ? (
                          <>
                            Book {parallelSlots} services simultaneously + {extensionSlots} extended slot{extensionSlots > 1 ? 's' : ''}
                            <br />
                            <span className="text-blue-600 font-medium">({numEmployees} employees available, {extensionSlots} will extend to next slot)</span>
                          </>
                        ) : (
                          `Book ${bookingForm.visitor_count} services at the same time with ${bookingForm.visitor_count} different employees (${numEmployees} employees available)`
                        )
                      ) : (
                        `Book ${bookingForm.visitor_count} services at the same time with different employees`
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBookingForm({ ...bookingForm, booking_option: 'consecutive' });
                      setManualSlotAssignments([]);
                    }}
                    className={`p-3 text-left rounded-lg border ${
                      bookingForm.booking_option === 'consecutive'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium">→ Consecutive - Single Employee</div>
                    <div className="text-sm text-gray-600">
                      Book {bookingForm.visitor_count} consecutive time slots with one employee
                    </div>
                  </button>
                </div>
              </div>
            );
          })()}

          {(() => {
            // Show manual slot assignment UI when:
            // 1. Manual assignment mode is selected
            // 2. Quantity > 1
            // 3. Parallel + Extension scenario (quantity > numEmployees)
            if (assignmentMode === 'manual' && bookingForm.visitor_count > 1 && selectedTimeSlot && bookingForm.booking_option === 'parallel') {
              const slotsInTimeRange = slots.filter(
                s => s.start_time === selectedTimeSlot.start_time && s.end_time === selectedTimeSlot.end_time
              );
              const numEmployees = slotsInTimeRange.length;
              const needsExtension = bookingForm.visitor_count > numEmployees;

              if (!needsExtension) return null; // No need for manual assignment if no extension needed

              const parallelCount = numEmployees;
              const extensionCount = bookingForm.visitor_count - numEmployees;

              return (
                <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="font-medium text-blue-900">
                    Manual Employee Assignment Required
                  </div>
                  <p className="text-sm text-blue-800">
                    You need to assign employees for {parallelCount} parallel slots + {extensionCount} extension slot{extensionCount > 1 ? 's' : ''}.
                  </p>

                  <div className="space-y-2">
                    {Array.from({ length: bookingForm.visitor_count }).map((_, index) => {
                      const isParallel = index < parallelCount;
                      const currentAssignment = manualSlotAssignments.find(a => a.slotIndex === index);

                      return (
                        <div key={index} className="bg-white p-3 rounded border">
                          <div className="text-sm font-medium mb-2">
                            Slot {index + 1} {isParallel ? '(Parallel)' : '(Extension)'}
                          </div>
                          <select
                            value={currentAssignment?.employeeId || ''}
                            onChange={(e) => {
                              const employeeId = e.target.value;
                              if (!employeeId) return;

                              // Find available slot for this employee
                              const availableSlot = isParallel
                                ? slotsInTimeRange.find(s => s.employee_id === employeeId)
                                : null; // For extension, we'll fetch next slots

                              if (availableSlot || !isParallel) {
                                setManualSlotAssignments(prev => [
                                  ...prev.filter(a => a.slotIndex !== index),
                                  { slotIndex: index, employeeId, slotId: availableSlot?.id || '' }
                                ]);
                              }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="">Select employee...</option>
                            {availableEmployees.map(emp => (
                              <option key={emp.id} value={emp.id}>
                                {i18n.language === 'ar' ? emp.name_ar : emp.name} ({emp.bookingCount} bookings today)
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            return null;
          })()}

          <div className="flex gap-3 pt-4 border-t mt-6">
            <Button
              type="submit"
              fullWidth
              disabled={(() => {
                // Require all basic fields
                if (!bookingForm.customer_phone || !bookingForm.customer_name) return true;
                if (!selectedService || !bookingForm.visitor_count) return true;

                // Allow booking if there are services in the list
                if (selectedServices.length > 0) return false;

                // For single bookings, check if we have required slots selected
                const required = getRequiredSlotsCount();
                const validation = validateSlotSelection();

                // If quantity is 1, just need any slot selected
                if (bookingForm.visitor_count === 1) {
                  return selectedSlots.length === 0 && !selectedSlot && !selectedTimeSlot;
                }

                // For quantity > 1, check if single slot has enough capacity first
                if (selectedTimeSlot) {
                  const slotsAtTime = slots.filter(
                    s => s.start_time === selectedTimeSlot.start_time &&
                         s.end_time === selectedTimeSlot.end_time &&
                         s.available_capacity > 0
                  );
                  
                  const slotWithEnoughCapacity = slotsAtTime.find(s => s.available_capacity >= bookingForm.visitor_count);
                  
                  if (slotWithEnoughCapacity) {
                    // Single slot has enough capacity - no need to select multiple slots
                    return false; // Button enabled
                  }
                }
                
                // Otherwise, need all required slots selected and valid
                return selectedSlots.length < required || !validation.valid;
              })()}
            >
              {t('common.proceed')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
        )}
      </Modal>

      {/* Booking Confirmation (Admin/Receptionist) — full confirmation view after create */}
      <BookingConfirmationModal
        isOpen={!!confirmationBookingId}
        onClose={() => setConfirmationBookingId(null)}
        bookingId={confirmationBookingId}
        onBackToBookings={() => setConfirmationBookingId(null)}
        onCreateAnother={() => {
          setConfirmationBookingId(null);
          setIsModalOpen(true);
        }}
        ticketsEnabled={tenant?.tickets_enabled !== false}
      />

      {/* Booking Details Modal */}
      <Modal
        isOpen={!!selectedBookingForDetails}
        onClose={() => setSelectedBookingForDetails(null)}
        title={t('reception.bookingDetails')}
      >
        {selectedBookingForDetails && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Customer Name</label>
                <div className="mt-1 flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">{selectedBookingForDetails.customer_name}</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Phone</label>
                <div className="mt-1 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">{selectedBookingForDetails.customer_phone}</span>
                </div>
              </div>
            </div>

            {selectedBookingForDetails.customer_email && (
              <div>
                <label className="text-sm font-medium text-gray-500">Email</label>
                <div className="mt-1 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">{selectedBookingForDetails.customer_email}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">{t('reception.serviceLabel')}</label>
                <div className="mt-1 font-medium">
                  {i18n.language === 'ar' ? selectedBookingForDetails.services?.name_ar : selectedBookingForDetails.services?.name}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">{getBookingEmployees(selectedBookingForDetails).length > 1 ? t('reception.employeesLabel') : t('reception.employeeLabel')}</label>
                <div className="mt-1 font-medium">
                  {getBookingEmployees(selectedBookingForDetails).length > 0
                    ? getBookingEmployees(selectedBookingForDetails).map((emp, idx) => (
                        <div key={emp.id ?? idx}>
                          {i18n.language === 'ar' ? (emp.full_name_ar || emp.full_name) : emp.full_name}
                        </div>
                      ))
                    : (i18n.language === 'ar' ? '—' : '—')}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">{t('reception.date')}</label>
                <div className="mt-1 flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">
                    {format(parseISO(selectedBookingForDetails.slots?.slot_date), 'MMM dd, yyyy', { locale: i18n.language?.startsWith('ar') ? ar : undefined })}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">{t('reception.time')}</label>
                <div className="mt-1 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">
                    {formatTimeTo12Hour(selectedBookingForDetails.slots?.start_time ?? '')} - {formatTimeTo12Hour(selectedBookingForDetails.slots?.end_time ?? '')}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">{t('booking.visitorCount')}</label>
                <div className="mt-1 font-medium">{(selectedBookingForDetails as any).groupCount || selectedBookingForDetails.visitor_count}</div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">{t('reception.totalPrice')}</label>
                <div className="mt-1 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">{formatPrice(selectedBookingForDetails.total_price)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Status</label>
                <div className="mt-1">
                  <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                    selectedBookingForDetails.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                    selectedBookingForDetails.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    selectedBookingForDetails.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                    selectedBookingForDetails.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {selectedBookingForDetails.status.toUpperCase()}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Payment Status</label>
                <div className="mt-1">
                  <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                    getPaymentDisplayValue(selectedBookingForDetails) === 'unpaid' ? 'bg-orange-100 text-orange-800' :
                    getPaymentDisplayValue(selectedBookingForDetails) === 'bank_transfer' ? 'bg-blue-100 text-blue-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {getPaymentDisplayLabel(selectedBookingForDetails, t)}
                  </span>
                </div>
              </div>
            </div>

            {selectedBookingForDetails.notes && (
              <div>
                <label className="text-sm font-medium text-gray-500">Notes</label>
                <div className="mt-1 p-3 bg-gray-50 rounded-lg text-sm">
                  {selectedBookingForDetails.notes}
                </div>
              </div>
            )}

            {/* Action Buttons - coordinator only sees Confirm when pending */}
            <div className="flex flex-col gap-2 pt-4 border-t">
              {selectedBookingForDetails.status === 'pending' && (
                <Button
                  variant="primary"
                  onClick={() => {
                    updateBookingStatus(selectedBookingForDetails.id, 'confirmed');
                    setSelectedBookingForDetails(null);
                  }}
                  icon={<CheckCircle className="w-4 h-4" />}
                  fullWidth
                >
                  {t('common.confirm')}
                </Button>
              )}
              {!isCoordinator && (
              <>
              {/* Edit and Reschedule - hidden for coordinator */}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingBooking(selectedBookingForDetails);
                    setIsEditBookingModalOpen(true);
                    setSelectedBookingForDetails(null);
                  }}
                  icon={<Edit className="w-4 h-4" />}
                  fullWidth
                >
                  {t('reception.editBooking')}
                </Button>
                {selectedBookingForDetails.status !== 'cancelled' && selectedBookingForDetails.status !== 'completed' && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      handleEditTimeClick(selectedBookingForDetails);
                      setSelectedBookingForDetails(null);
                    }}
                    icon={<CalendarClock className="w-4 h-4" />}
                    fullWidth
                  >
                    {t('bookings.changeTime')}
                  </Button>
                )}
              </div>
              
              {/* Status Management Buttons */}
              {selectedBookingForDetails.status !== 'cancelled' && selectedBookingForDetails.status !== 'completed' && (
                <div className="flex gap-2">
                  {selectedBookingForDetails.status === 'confirmed' && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        updateBookingStatus(selectedBookingForDetails.id, 'completed');
                        setSelectedBookingForDetails(null);
                      }}
                      icon={<CheckCircle className="w-4 h-4" />}
                      fullWidth
                    >
                      {t('bookings.markComplete')}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={() => {
                      updateBookingStatus(selectedBookingForDetails.id, 'cancelled');
                      setSelectedBookingForDetails(null);
                    }}
                    icon={<XCircle className="w-4 h-4" />}
                    fullWidth
                  >
                    {t('bookings.cancelBooking')}
                  </Button>
                </div>
              )}

            {getPaymentDisplayValue(selectedBookingForDetails) === 'unpaid' && (
              <Button
                variant="primary"
                onClick={() => {
                  updatePaymentStatus(selectedBookingForDetails.id, 'paid_manual');
                  setSelectedBookingForDetails(null);
                }}
                icon={<DollarSign className="w-4 h-4" />}
                fullWidth
              >
                {t('reception.markAsPaid')}
              </Button>
            )}
              </>
              )}
            </div>

            <Button
              variant="secondary"
              onClick={() => setSelectedBookingForDetails(null)}
              fullWidth
            >
              Close
            </Button>
          </div>
        )}
      </Modal>

      {/* Mark as paid modal: payment method + transaction reference */}
      {markPaidBookingId && (
        <Modal
          isOpen={!!markPaidBookingId}
          onClose={() => {
            setMarkPaidBookingId(null);
            setMarkPaidReference('');
          }}
          title={t('reception.markAsPaid') || 'Mark as Paid'}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {t('reception.selectPaymentMethod') || 'Select payment method. Invoice will be sent via WhatsApp after confirmation.'}
            </p>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">{t('reception.paymentMethod') || 'Payment method'}</p>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mark-paid-method"
                    checked={markPaidMethod === 'onsite'}
                    onChange={() => setMarkPaidMethod('onsite')}
                    className="rounded-full border-gray-300 text-blue-600"
                  />
                  <span>مدفوع يدوياً</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mark-paid-method"
                    checked={markPaidMethod === 'transfer'}
                    onChange={() => setMarkPaidMethod('transfer')}
                    className="rounded-full border-gray-300 text-blue-600"
                  />
                  <span>حوالة</span>
                </label>
              </div>
            </div>
            {markPaidMethod === 'transfer' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('reception.transactionReferenceRequired') || 'Transaction Reference Number (required)'}
                </label>
                <input
                  type="text"
                  value={markPaidReference}
                  onChange={(e) => setMarkPaidReference(e.target.value)}
                  placeholder={t('reception.enterReferenceNumber') || 'Enter reference number'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setMarkPaidBookingId(null);
                  setMarkPaidReference('');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={confirmMarkPaid}
                disabled={markPaidSubmitting || (markPaidMethod === 'transfer' && !markPaidReference.trim())}
                icon={<DollarSign className="w-4 h-4" />}
              >
                {markPaidSubmitting ? t('common.updating') : t('reception.confirmMarkAsPaid')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Booking Modal - Same as tenant provider */}
      {editingBooking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold mb-4">{t('reception.editBooking')}</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.customerName') || 'Customer Name'}</label>
                  <input
                    type="text"
                    value={editBookingForm.customer_name}
                    onChange={(e) => setEditBookingForm({ ...editBookingForm, customer_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">{t('reception.phoneNumber') || 'Phone Number'}</label>
                  <PhoneInput
                    value={editBookingForm.customer_phone}
                    onChange={(value) => setEditBookingForm({ ...editBookingForm, customer_phone: value })}
                    defaultCountry={countryCode}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.email') || 'Email'}</label>
                  <input
                    type="email"
                    value={editBookingForm.customer_email}
                    onChange={(e) => setEditBookingForm({ ...editBookingForm, customer_email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.visitorCount') || 'Visitor Count'}</label>
                  <input
                    type="number"
                    min="1"
                    value={editBookingForm.visitor_count}
                    onChange={(e) => setEditBookingForm({ ...editBookingForm, visitor_count: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.totalPrice') || 'Total Price'}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editBookingForm.total_price}
                    onChange={(e) => setEditBookingForm({ ...editBookingForm, total_price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.status') || 'Status'}</label>
                  <select
                    value={editBookingForm.status}
                    onChange={(e) => setEditBookingForm({ ...editBookingForm, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="pending">{t('status.pending')}</option>
                    <option value="confirmed">{t('status.confirmed')}</option>
                    <option value="checked_in">{t('status.checked_in')}</option>
                    <option value="completed">{t('status.completed')}</option>
                    <option value="cancelled">{t('status.cancelled')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">{t('reception.notes') || 'Notes'}</label>
                  <textarea
                    value={editBookingForm.notes}
                    onChange={(e) => setEditBookingForm({ ...editBookingForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <Button
                  onClick={handleEditBooking}
                  className="flex-1"
                >
                  {t('billing.saveChanges')}
                </Button>
                <Button
                  onClick={() => {
                    setIsEditBookingModalOpen(false);
                    setEditingBooking(null);
                  }}
                  variant="ghost"
                  className="flex-1"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Booking Time Modal - Same as tenant provider */}
      {editingBookingTime && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold mb-4">{t('bookings.changeBookingTime')}</h2>
              
              <div className="space-y-4">
                {/* Current Booking Info */}
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="text-sm font-semibold mb-2">{t('bookings.currentTime')}</h3>
                  <div className="text-sm text-gray-600">
                    <div className="flex items-center gap-2 mb-1">
                      <CalendarDays className="w-4 h-4" />
                      <span>
                        {editingBookingTime.slots?.slot_date 
                          ? format(parseISO(editingBookingTime.slots.slot_date), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined })
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>
                        {editingBookingTime.slots?.start_time 
                          ? `${formatTimeTo12Hour(editingBookingTime.slots.start_time)} - ${formatTimeTo12Hour(editingBookingTime.slots.end_time)}`
                          : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* New Date Selection */}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('bookings.newDate')}</label>
                  <input
                    type="date"
                    value={format(editingTimeDate, 'yyyy-MM-dd')}
                    onChange={(e) => {
                      const newDate = parseISO(e.target.value);
                      handleTimeDateChange(newDate);
                    }}
                    // Allow past dates for rescheduling (includePastSlots is true)
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                {/* Employee-based + manual: Choose employee (same as creating bookings) */}
                {isEmployeeBasedMode && (tenantAssignmentMode === 'manual' || tenantAssignmentMode === 'both') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('reception.selectEmployee')} *</label>
                    <select
                      value={changeTimeEmployeeId}
                      onChange={(e) => {
                        setChangeTimeEmployeeId(e.target.value);
                        setSelectedNewSlotId('');
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required={tenantAssignmentMode === 'manual'}
                    >
                      <option value="">{t('reception.chooseEmployee') || 'Choose employee'}</option>
                      {(() => {
                        const empMap = new Map<string, { id: string; name: string; name_ar: string }>();
                        availableTimeSlots.forEach((slot: any) => {
                          if (slot.employee_id && !empMap.has(slot.employee_id)) {
                            const u = slot.users;
                            empMap.set(slot.employee_id, {
                              id: slot.employee_id,
                              name: u?.full_name ?? '',
                              name_ar: u?.full_name_ar ?? '',
                            });
                          }
                        });
                        return Array.from(empMap.values()).map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {i18n.language === 'ar' ? (emp.name_ar || emp.name) : emp.name}
                          </option>
                        ));
                      })()}
                    </select>
                  </div>
                )}

                {/* Available Time Slots */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('bookings.availableTimeSlots') || 'Available Time Slots'}
                  </label>
                  {loadingTimeSlots ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                      <p className="text-sm text-gray-600 mt-2">
                        {t('bookings.loadingAvailableSlots') || 'Loading available slots...'}
                      </p>
                    </div>
                  ) : (() => {
                    const requireEmployeeFirst = isEmployeeBasedMode && (tenantAssignmentMode === 'manual' || tenantAssignmentMode === 'both');
                    const slotsToShow = changeTimeEmployeeId
                      ? availableTimeSlots.filter((s: any) => s.employee_id === changeTimeEmployeeId)
                      : requireEmployeeFirst
                        ? []
                        : availableTimeSlots;
                    if (requireEmployeeFirst && !changeTimeEmployeeId) {
                      return (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                          <p className="text-sm text-blue-800">
                            {t('bookings.selectEmployeeFirst') || 'Please select an employee above to see available time slots.'}
                          </p>
                        </div>
                      );
                    }
                    return slotsToShow.length === 0 ? (
                      <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                        <p className="text-sm text-yellow-800">
                          {changeTimeEmployeeId ? (t('bookings.noSlotsForSelectedEmployee') || 'No slots for selected employee on this date') : (t('bookings.noAvailableTimeSlots') || 'No available time slots for this date')}
                        </p>
                        <p className="text-xs text-yellow-700 mt-2">
                          {t('bookings.makeSureShiftsAndSlotsExist') || 'Make sure shifts and slots exist for this service'}
                        </p>
                      </div>
                    ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-2 border border-gray-200 rounded-md">
                      {slotsToShow.map((slot) => (
                        <button
                          key={slot.id}
                          onClick={() => setSelectedNewSlotId(slot.id)}
                          className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                            selectedNewSlotId === slot.id
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="font-medium">{formatTimeTo12Hour(slot.start_time)}</div>
                          {isEmployeeBasedMode && (slot as any).users && (
                            <div className="text-xs truncate" title={i18n.language === 'ar' ? (slot as any).users?.full_name_ar : (slot as any).users?.full_name}>
                              {i18n.language === 'ar' ? (slot as any).users?.full_name_ar || (slot as any).users?.full_name : (slot as any).users?.full_name || (slot as any).users?.full_name_ar}
                            </div>
                          )}
                          <div className="text-xs opacity-75">
                            {slot.available_capacity} {t('common.available') || 'Available'}
                          </div>
                        </button>
                      ))}
                    </div>
                    );
                  })()}
                </div>

                {/* Warning Message - Only show if tickets are enabled */}
                {tenant?.tickets_enabled !== false && (
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-800">
                      {t('common.oldTicketsInvalidated') || 'Changing the booking time will invalidate old tickets and send new tickets to the customer.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-6">
                <Button
                  onClick={updateBookingTime}
                  disabled={!selectedNewSlotId || updatingBookingTime}
                  className="flex-1"
                >
                  {updatingBookingTime 
                    ? (t('bookings.updating') || 'Updating...')
                    : (t('bookings.updateTime') || 'Update Time')}
                </Button>
                <Button
                  onClick={() => {
                    setEditingBookingTime(null);
                    setSelectedNewSlotId('');
                    setChangeTimeEmployeeId('');
                    setAvailableTimeSlots([]);
                  }}
                  variant="ghost"
                  className="flex-1"
                  disabled={updatingBookingTime}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add Subscription Modal */}
      <Modal
        isOpen={isSubscriptionModalOpen}
        onClose={() => {
          setIsSubscriptionModalOpen(false);
          resetSubscriptionForm();
        }}
        title={t('packages.addSubscription')}
      >
        <form onSubmit={handleSubscriptionSubmit} className="space-y-4">
          {/* Customer Phone with Auto-fill + suggestions dropdown */}
          <div className="relative" ref={subscriptionPhoneWrapperRef}>
            <PhoneInput
              label={`${t('packages.customerPhone')} *`}
              value={subscriptionPhoneFull}
              onChange={(value) => {
                if (subscriptionSelectedCustomer && value !== subscriptionSelectedCustomer.phone) setSubscriptionSelectedCustomer(null);
                setSubscriptionPhoneFull(value);
                let phoneNumber = value;
                let code = tenantDefaultCountry;
                for (const country of countryCodes) {
                  if (value.startsWith(country.code)) {
                    code = country.code;
                    phoneNumber = value.replace(country.code, '');
                    break;
                  }
                }
                setSubscriptionForm({ ...subscriptionForm, customer_phone: phoneNumber });
                if (subscriptionCustomerLookup) setSubscriptionCustomerLookup(null);
                if (value.length >= 10) {
                  lookupSubscriptionCustomer(value);
                } else {
                  setSubscriptionForm(prev => ({ ...prev, customer_name: '', customer_email: '' }));
                }
              }}
              defaultCountry={tenantDefaultCountry}
              required
            />
            {(isLookingUpSubscriptionCustomer || subscriptionPhoneSearchLoading) && (
              <div className="absolute right-3 top-[38px]">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              </div>
            )}
            {!subscriptionSelectedCustomer && !subscriptionCustomerLookup && subscriptionPhoneSuggestions.length >= 1 && (
              <CustomerPhoneSuggestionsDropdown
                suggestions={subscriptionPhoneSuggestions}
                onSelect={(c) => {
                  setSubscriptionSelectedCustomer(c);
                  setSubscriptionPhoneFull(c.phone);
                  let localPhone = c.phone;
                  for (const country of countryCodes) {
                    if (c.phone.startsWith(country.code)) {
                      localPhone = c.phone.replace(country.code, '').trim();
                      break;
                    }
                  }
                  setSubscriptionForm(prev => ({ ...prev, customer_name: c.name || '', customer_email: c.email || '', customer_phone: localPhone }));
                  setSubscriptionCustomerLookup(c);
                  clearSubscriptionPhoneSuggestions();
                  lookupSubscriptionCustomer(c.phone);
                }}
                onClose={clearSubscriptionPhoneSuggestions}
                containerRef={subscriptionPhoneWrapperRef}
              />
            )}
            {(subscriptionSelectedCustomer || subscriptionCustomerLookup) && (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>{t('reception.existingCustomerSelected')}</span>
              </div>
            )}
          </div>
          {subscriptionPhoneFull.length >= 10 && !subscriptionCustomerLookup && !subscriptionSelectedCustomer && !isLookingUpSubscriptionCustomer && !subscriptionPhoneSearchLoading && (
            <p className="text-sm text-blue-600">
              {t('packages.newCustomer')}
            </p>
          )}
          <Input
            label={`${t('packages.customerName')} *`}
            value={subscriptionForm.customer_name}
            onChange={(e) => setSubscriptionForm({ ...subscriptionForm, customer_name: e.target.value })}
            required
            placeholder={t('packages.customerName')}
            disabled={!!(subscriptionSelectedCustomer || subscriptionCustomerLookup)}
          />
          <Input
            label={t('packages.customerEmail')}
            type="email"
            value={subscriptionForm.customer_email}
            onChange={(e) => setSubscriptionForm({ ...subscriptionForm, customer_email: e.target.value })}
            placeholder={t('packages.customerEmail')}
            disabled={!!(subscriptionSelectedCustomer || subscriptionCustomerLookup)}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('packages.selectPackage')} *
            </label>
            {loadingPackages ? (
              <div className="w-full px-3 py-3 border border-gray-200 rounded-lg bg-gray-50 flex items-center gap-2" role="status" aria-label={t('reception.loadingPackagesList')}>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
                <span className="text-sm text-gray-600">{t('reception.loadingPackagesList') || 'Loading packages...'}</span>
              </div>
            ) : (
              <select
                value={subscriptionForm.package_id}
                onChange={(e) => setSubscriptionForm({ ...subscriptionForm, package_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">{t('packages.selectPackage')}</option>
                {packages.map(pkg => (
                  <option key={pkg.id} value={pkg.id}>
                    {i18n.language === 'ar' ? pkg.name_ar : pkg.name} - {formatPrice(pkg.total_price)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Payment method (Unpaid | Paid On Site | Bank Transfer — same as bookings) */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('reception.paymentMethod') || 'Payment method'}</h4>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="subscriptionPaymentMethod"
                  checked={subscriptionPaymentMethod === 'unpaid'}
                  onChange={() => { setSubscriptionPaymentMethod('unpaid'); setSubscriptionTransactionReference(''); }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{t(PAYMENT_DISPLAY_KEYS.unpaid) || 'Unpaid'}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="subscriptionPaymentMethod"
                  checked={subscriptionPaymentMethod === 'onsite'}
                  onChange={() => { setSubscriptionPaymentMethod('onsite'); setSubscriptionTransactionReference(''); }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{t(PAYMENT_DISPLAY_KEYS.paid_onsite) || 'Paid On Site'}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="subscriptionPaymentMethod"
                  checked={subscriptionPaymentMethod === 'transfer'}
                  onChange={() => setSubscriptionPaymentMethod('transfer')}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{t(PAYMENT_DISPLAY_KEYS.bank_transfer) || 'Bank Transfer'}</span>
              </label>
            </div>
            {subscriptionPaymentMethod === 'transfer' && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('reception.transactionReference') || 'Transaction reference'} *</label>
                <Input
                  type="text"
                  value={subscriptionTransactionReference}
                  onChange={(e) => setSubscriptionTransactionReference(e.target.value)}
                  placeholder={i18n.language === 'ar' ? 'رقم المرجع أو الحوالة' : 'Transfer reference number'}
                />
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" className="flex-1" disabled={isSubscribing}>
              {isSubscribing ? (
                <>
                  <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2 align-middle" />
                  {i18n.language === 'ar' ? 'جاري الاشتراك...' : 'Subscribing...'}
                </>
              ) : (
                t('packages.subscribe')
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!isSubscribing) {
                  setIsSubscriptionModalOpen(false);
                  resetSubscriptionForm();
                }
              }}
              className="flex-1"
              disabled={isSubscribing}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Subscription success confirmation — same style as booking confirmation */}
      <SubscriptionConfirmationModal
        isOpen={!!subscriptionConfirmationData}
        onClose={() => setSubscriptionConfirmationData(null)}
        data={subscriptionConfirmationData}
        onAddAnother={() => {
          setSubscriptionConfirmationData(null);
          setIsSubscriptionModalOpen(true);
        }}
      />

      {/* QR Code Scanner Modal with Camera - only when tickets are enabled */}
      {isQRScannerOpen && tenant?.tickets_enabled !== false && (
        <QRScanner
          title={t('reception.scanQR')}
          onScanSuccess={(decodedText) => {
            // QR code contains booking ID
            setQrInputValue(decodedText);
            validateQRCode(decodedText);
          }}
          onScanError={(error) => {
            console.error('QR scan error:', error);
            setQrValidationResult({
              success: false,
              message: error || 'Failed to scan QR code',
            });
          }}
          onClose={() => {
            setIsQRScannerOpen(false);
            setQrInputValue('');
            setQrValidationResult(null);
          }}
          showManualInput={true}
          onManualInput={(value) => {
            setQrInputValue(value);
            validateQRCode(value);
          }}
        />
      )}

      {/* Legacy QR Scanner Modal (fallback - can be removed after testing) */}
      {false && (
      <Modal
        isOpen={isQRScannerOpen}
        onClose={() => {
          setIsQRScannerOpen(false);
          setQrInputValue('');
          setQrValidationResult(null);
        }}
        title={t('reception.scanQR')}
      >
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              {i18n.language === 'ar' 
                ? 'يمكنك إدخال رقم الحجز يدوياً أو مسح رمز QR من التذكرة'
                : 'You can enter the booking ID manually or scan the QR code from the ticket'}
            </p>
          </div>

          <form onSubmit={handleQRSubmit} className="space-y-4">
            <Input
              label={i18n.language === 'ar' ? 'رقم الحجز أو رمز QR' : 'Booking ID or QR Code'}
              value={qrInputValue}
              onChange={(e) => {
                setQrInputValue(e.target.value);
                setQrValidationResult(null);
              }}
              placeholder={i18n.language === 'ar' ? 'أدخل رقم الحجز أو امسح QR' : 'Enter booking ID or scan QR'}
              required
              disabled={qrValidating}
              autoFocus
            />

            {qrValidationResult != null ? (() => {
              const qr = qrValidationResult as NonNullable<typeof qrValidationResult>;
              return (
                <div className={`p-4 rounded-lg border ${
                  qr.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                }`}>
                  <div className={`flex items-center gap-2 ${
                    qr.success ? 'text-green-800' : 'text-red-800'
                  }`}>
                    {qr.success ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                    <span className="font-medium">{qr.message}</span>
                  </div>
                  {qr.booking != null && qr.success && (
                    <div className="mt-3 pt-3 border-t border-green-200 space-y-2 text-sm">
                      <div>
                        <span className="text-gray-600">{i18n.language === 'ar' ? 'اسم العميل' : 'Customer'}:</span>
                        <span className="font-medium ml-2">{qr.booking.customer_name}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">{i18n.language === 'ar' ? 'الخدمة' : 'Service'}:</span>
                        <span className="font-medium ml-2">
                          {i18n.language === 'ar' ? qr.booking.service_name_ar : qr.booking.service_name}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">{i18n.language === 'ar' ? 'التاريخ والوقت' : 'Date & Time'}:</span>
                        <span className="font-medium ml-2">
                          {format(parseISO(qr.booking.slot_date), 'MMM dd, yyyy')} {formatTimeTo12Hour(qr.booking.start_time)}
                        </span>
                      </div>
                    </div>
                  )}
                  {qr.booking != null && !qr.success && (
                    <div className="mt-3 pt-3 border-t border-red-200 text-sm text-red-700">
                      {i18n.language === 'ar' ? 'تم مسح هذا الرمز مسبقاً في:' : 'This QR code was already scanned at:'}
                      <div className="font-medium mt-1">
                        {qr.booking.qr_scanned_at
                          ? formatDateTimeTo12Hour(qr.booking.qr_scanned_at)
                          : 'N/A'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })() : null}

            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                fullWidth
                disabled={!qrInputValue.trim() || qrValidating}
                style={{ backgroundColor: qrValidating ? '#9ca3af' : undefined }}
              >
                {qrValidating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    {i18n.language === 'ar' ? 'جاري التحقق...' : 'Validating...'}
                  </>
                ) : (
                  <>
                    <QrCode className="w-4 h-4 mr-2" />
                    {i18n.language === 'ar' ? 'التحقق' : 'Validate'}
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                fullWidth
                onClick={() => {
                  setIsQRScannerOpen(false);
                  setQrInputValue('');
                  setQrValidationResult(null);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </div>
      </Modal>
      )}
          </>
        )}
      </div>
    </div>
  );
}
