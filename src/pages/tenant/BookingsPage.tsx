import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { safeTranslateStatus, safeTranslate } from '../../lib/safeTranslation';
import { getPaymentDisplayLabel, getPaymentDisplayValue, PAYMENT_DISPLAY_KEYS, type PaymentDisplayValue } from '../../lib/paymentDisplay';
import { db } from '../../lib/db';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Calendar, Clock, User, List, ChevronLeft, ChevronRight, FileText, Download, CheckCircle, XCircle, Edit, Trash2, DollarSign, AlertCircle, Search, X, Plus, Package, CalendarDays } from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, parseISO } from 'date-fns';
import { ar } from 'date-fns/locale';
import { getApiUrl } from '../../lib/apiUrl';
import { createTimeoutSignal } from '../../lib/requestTimeout';
import { fetchAvailableSlots, Slot } from '../../lib/bookingAvailability';
import { getParallelSlotsForQuantity as getParallelSlotsForQuantityLib, getConsecutiveSlotsForQuantity as getConsecutiveSlotsForQuantityLib } from '../../lib/bookingSlotAllocation';
import { formatTimeTo12Hour, formatDateTimeTo12Hour } from '../../lib/timeFormat';
import { Input } from '../../components/ui/Input';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { useTenantDefaultCountry } from '../../hooks/useTenantDefaultCountry';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { countryCodes } from '../../lib/countryCodes';
import { BookingConfirmationModal } from '../../components/shared/BookingConfirmationModal';
import { useCustomerPhoneSearch, type CustomerSuggestion } from '../../hooks/useCustomerPhoneSearch';
import { CustomerPhoneSuggestionsDropdown } from '../../components/reception/CustomerPhoneSuggestionsDropdown';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';

interface AdminService {
  id: string;
  name: string;
  name_ar?: string;
  base_price: number;
  original_price?: number | null;
  offers?: { id: string; name: string; name_ar?: string; price: number; discount_percentage?: number }[];
}

interface PackageUsage {
  service_id: string;
  original_quantity: number;
  remaining_quantity: number;
  used_quantity: number;
  services: { name: string; name_ar?: string };
}

interface CustomerPackage {
  id: string;
  package_id: string;
  status: string;
  expires_at: string | null;
  service_packages: { name: string; name_ar?: string; total_price: number };
  usage: PackageUsage[];
}

interface Booking {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  visitor_count: number;
  total_price: number;
  status: string;
  payment_status?: string;
  payment_method?: string | null;
  created_at: string;
  zoho_invoice_id?: string | null;
  zoho_invoice_created_at?: string | null;
  service_id: string;
  slot_id: string;
  services: {
    name: string;
    name_ar?: string;
  };
  slots: {
    slot_date: string;
    start_time: string;
    end_time: string;
  };
  package_covered_quantity?: number | null;
  package_subscription_id?: string | null;
  employee_id?: string | null;
  users?: { full_name: string; full_name_ar?: string | null } | null;
}

type SearchType = 'phone' | 'customer_name' | 'date' | 'service_name' | 'booking_id' | '';

export function BookingsPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? false;
  const { userProfile, tenant } = useAuth();
  const { formatPrice, formatPriceString } = useCurrency();
  const tenantDefaultCountry = useTenantDefaultCountry();
  const { features: tenantFeatures } = useTenantFeatures(userProfile?.tenant_id);
  const isEmployeeBasedMode = tenantFeatures?.scheduling_mode === 'employee_based';
  const tenantAssignmentMode = (tenantFeatures?.employee_assignment_mode ?? 'both') as 'automatic' | 'manual' | 'both';
  const canCreateBooking = ['receptionist', 'admin_user', 'tenant_admin', 'customer_admin'].includes(userProfile?.role || '');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  // Admin create booking modal (same APIs as reception, no redirect) — UI matches reception: Phone first, then name, email, service, date/slot, etc.
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createCustomerPhoneFull, setCreateCustomerPhoneFull] = useState('');
  const [createForm, setCreateForm] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    visitor_count: 1,
    notes: '',
    booking_option: 'consecutive' as 'consecutive' | 'parallel',
  });
  const [createServiceId, setCreateServiceId] = useState('');
  const [createDate, setCreateDate] = useState('');
  const [createSlotId, setCreateSlotId] = useState('');
  const [createServices, setCreateServices] = useState<AdminService[]>([]);
  const [createSlots, setCreateSlots] = useState<Slot[]>([]);
  const [loadingCreateSlots, setLoadingCreateSlots] = useState(false);
  const [creatingBooking, setCreatingBooking] = useState(false);
  /** When set, create modal is closed and a full-screen loading overlay is shown (creating_booking -> creating_invoice) */
  const [createBookingLoadingStep, setCreateBookingLoadingStep] = useState<null | 'creating_booking' | 'creating_invoice'>(null);
  const [createOfferId, setCreateOfferId] = useState('');
  const [createShowFullCalendar, setCreateShowFullCalendar] = useState(false);
  const [isLookingUpCustomer, setIsLookingUpCustomer] = useState(false);
  const [createCustomerPackages, setCreateCustomerPackages] = useState<CustomerPackage[]>([]);
  const [createCountryCode, setCreateCountryCode] = useState(tenantDefaultCountry);
  const [createSelectedSlots, setCreateSelectedSlots] = useState<Array<{ slot_id: string; start_time: string; end_time: string; employee_id: string; slot_date: string }>>([]);
  const [createSelectedTimeSlot, setCreateSelectedTimeSlot] = useState<{ start_time: string; end_time: string; slot_date: string } | null>(null);
  const [createShowPreview, setCreateShowPreview] = useState(false);
  const [createSelectedCustomer, setCreateSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [createPaymentMethod, setCreatePaymentMethod] = useState<'unpaid' | 'onsite' | 'transfer'>('onsite');
  const [createTransactionReference, setCreateTransactionReference] = useState('');
  const [createSelectedServices, setCreateSelectedServices] = useState<Array<{ service: AdminService; slot: Slot; employeeId: string }>>([]);
  const [createAssignmentMode, setCreateAssignmentMode] = useState<'automatic' | 'manual'>('automatic');
  const [createSelectedEmployeeId, setCreateSelectedEmployeeId] = useState<string>('');
  const [createNextEmployeeIdForRotation, setCreateNextEmployeeIdForRotation] = useState<string | null>(null);
  const [confirmationBookingId, setConfirmationBookingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editingTimeDate, setEditingTimeDate] = useState<Date>(new Date());
  const [availableTimeSlots, setAvailableTimeSlots] = useState<Slot[]>([]);
  const [loadingTimeSlots, setLoadingTimeSlots] = useState(false);
  const [selectedNewSlotId, setSelectedNewSlotId] = useState<string>('');
  const [changeTimeEmployeeId, setChangeTimeEmployeeId] = useState<string>('');
  const [updatingBookingTime, setUpdatingBookingTime] = useState(false);
  const [deletingBooking, setDeletingBooking] = useState<string | null>(null);
  const [updatingPaymentStatus, setUpdatingPaymentStatus] = useState<string | null>(null);
  const [zohoSyncStatus, setZohoSyncStatus] = useState<Record<string, { success: boolean; error?: string; pending?: boolean; message?: string }>>({});
  const [paymentStatusModal, setPaymentStatusModal] = useState<{ bookingId: string } | null>(null);
  const [paymentStatusModalMethod, setPaymentStatusModalMethod] = useState<'onsite' | 'transfer'>('onsite');
  const [paymentStatusModalReference, setPaymentStatusModalReference] = useState('');
  const [paymentStatusModalSubmitting, setPaymentStatusModalSubmitting] = useState(false);

  // Search state
  const [searchType, setSearchType] = useState<SearchType>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDate, setSearchDate] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Booking[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchValidationError, setSearchValidationError] = useState<string>('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchBookings();
  }, [userProfile, calendarDate, viewMode]);

  // Fetch services when create modal opens
  async function fetchCreateServices() {
    if (!userProfile?.tenant_id) return;
    try {
      const { data: servicesData, error: servicesError } = await db
        .from('services')
        .select('id, name, name_ar, base_price, original_price, discount_percentage, capacity_per_slot')
        .eq('tenant_id', userProfile.tenant_id)
        .eq('is_active', true)
        .order('name');
      if (servicesError) throw servicesError;
      const serviceIds = (servicesData || []).map(s => s.id);
      const { data: offersData } = await db
        .from('service_offers')
        .select('id, service_id, name, name_ar, price')
        .in('service_id', serviceIds)
        .eq('is_active', true);
      const servicesWithOffers: AdminService[] = (servicesData || []).map(s => ({
        ...s,
        offers: (offersData || []).filter(o => o.service_id === s.id),
      }));
      setCreateServices(servicesWithOffers);
    } catch (e) {
      console.error('Error fetching services for create:', e);
      setCreateServices([]);
    }
  }

  // Fetch available slots when service and date selected — same filter as Receptionist (ReceptionPage): exclude past, locked, zero-capacity
  useEffect(() => {
    if (!createServiceId || !createDate || !userProfile?.tenant_id) {
      setCreateSlots([]);
      setCreateSlotId('');
      return;
    }
    let cancelled = false;
    setLoadingCreateSlots(true);
    const date = parseISO(createDate);
    fetchAvailableSlots({
      tenantId: userProfile.tenant_id,
      serviceId: createServiceId,
      date,
      includePastSlots: false, // Same as reception: filter out past slots (customer-facing behavior)
      includeZeroCapacity: false, // Same as reception: filter out fully booked slots
      includeLockedSlots: false, // Same as reception: filter out locked slots
    }).then(({ slots, nextEmployeeIdForRotation }) => {
      if (!cancelled) {
        setCreateSlots(slots.filter(s => s.available_capacity > 0));
        setCreateSlotId('');
        setCreateNextEmployeeIdForRotation(nextEmployeeIdForRotation ?? null);
      }
    }).catch(() => {
      if (!cancelled) {
        setCreateSlots([]);
        setCreateNextEmployeeIdForRotation(null);
      }
    }).finally(() => {
      if (!cancelled) setLoadingCreateSlots(false);
    });
    return () => { cancelled = true; };
  }, [createServiceId, createDate, userProfile?.tenant_id]);

  useEffect(() => {
    setCreateSelectedSlots([]);
  }, [createServiceId, createDate, createForm.visitor_count, createForm.booking_option]);

  const effectiveCreateAssignmentMode: 'automatic' | 'manual' =
    tenantAssignmentMode === 'both' ? createAssignmentMode : (tenantAssignmentMode === 'manual' ? 'manual' : 'automatic');

  useEffect(() => {
    setCreateSelectedEmployeeId('');
    setCreateSlotId('');
    setCreateNextEmployeeIdForRotation(null);
  }, [createServiceId, createDate]);

  // Look up customer by phone and auto-fill name/email + package (same as reception)
  async function lookupCustomerByPhone(fullPhoneNumber: string) {
    if (!fullPhoneNumber || fullPhoneNumber.length < 8 || !userProfile?.tenant_id) return;
    setIsLookingUpCustomer(true);
    setCreateCustomerPackages([]);
    try {
      const { data: customerData, error: customerError } = await db
        .from('customers')
        .select('id, name, email, phone')
        .eq('tenant_id', userProfile.tenant_id)
        .eq('phone', fullPhoneNumber)
        .maybeSingle();
      if (customerError) throw customerError;
      if (customerData) {
        setCreateForm(prev => ({
          ...prev,
          customer_name: prev.customer_name || customerData.name || '',
          customer_email: prev.customer_email || (customerData.email ?? ''),
        }));
        const { data: subscriptionsData } = await db
          .from('package_subscriptions')
          .select('id, package_id, status, expires_at, service_packages(name, name_ar, total_price)')
          .eq('customer_id', customerData.id)
          .eq('status', 'active');
        const packages: CustomerPackage[] = [];
        if (subscriptionsData && subscriptionsData.length > 0) {
          for (const sub of subscriptionsData) {
            const isExpired = sub.expires_at && new Date(sub.expires_at) < new Date();
            if (!isExpired) {
              const { data: usageData } = await db
                .from('package_subscription_usage')
                .select('service_id, original_quantity, remaining_quantity, used_quantity, services(name, name_ar)')
                .eq('subscription_id', sub.id);
              packages.push({ ...sub, usage: usageData || [] } as CustomerPackage);
            }
          }
        }
        setCreateCustomerPackages(packages);
        return;
      }
      const { data: bookingData, error: bookingError } = await db
        .from('bookings')
        .select('customer_name, customer_email, customer_phone')
        .eq('tenant_id', userProfile.tenant_id)
        .eq('customer_phone', fullPhoneNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!bookingError && bookingData) {
        setCreateForm(prev => ({
          ...prev,
          customer_name: prev.customer_name || bookingData.customer_name || '',
          customer_email: prev.customer_email || (bookingData.customer_email ?? ''),
        }));
      }
    } catch (err) {
      console.error('Error looking up customer:', err);
    } finally {
      setIsLookingUpCustomer(false);
    }
  }

  const createPhoneWrapperRef = useRef<HTMLDivElement>(null);
  const { suggestions: createPhoneSuggestions, loading: createPhoneSearchLoading, clearSuggestions: clearCreatePhoneSuggestions } = useCustomerPhoneSearch(userProfile?.tenant_id, createCustomerPhoneFull);

  function checkServiceInPackage(serviceId: string): { available: boolean; remaining: number } {
    if (!createCustomerPackages.length) return { available: false, remaining: 0 };
    let total = 0;
    for (const pkg of createCustomerPackages) {
      const usage = pkg.usage.find(u => u.service_id === serviceId);
      if (usage) total += usage.remaining_quantity;
    }
    return { available: total > 0, remaining: total };
  }

  function getRequiredSlotsCount(): number {
    if (createForm.visitor_count <= 1) return 1;
    return createForm.visitor_count;
  }

  function getParallelSlotsForQuantity(
    allSlots: Slot[],
    selectedTime: { start_time: string; end_time: string; slot_date: string } | null,
    quantity: number
  ): Slot[] {
    return getParallelSlotsForQuantityLib(allSlots, selectedTime, quantity) as Slot[];
  }

  function getConsecutiveSlotsForQuantity(allSlots: Slot[], quantity: number): Slot[] | null {
    return getConsecutiveSlotsForQuantityLib(allSlots, quantity) as Slot[] | null;
  }

  function validateSlotSelection(): { valid: boolean; message: string } {
    if (createForm.visitor_count > 1 && createSelectedTimeSlot) {
      const slotsAtTime = createSlots.filter(
        s =>
          s.start_time === createSelectedTimeSlot.start_time &&
          s.end_time === createSelectedTimeSlot.end_time &&
          s.available_capacity > 0
      );
      const slotWithEnough = slotsAtTime.find(s => s.available_capacity >= createForm.visitor_count);
      if (slotWithEnough) return { valid: true, message: t('reception.allTicketsSameSlot', 'All tickets can be booked in the same time slot') };
    }
    const required = getRequiredSlotsCount();
    if (createSelectedSlots.length < required) {
      return { valid: false, message: `${required - createSelectedSlots.length} ${t('reception.moreSlotsRequired', 'more slot(s) required')}` };
    }
    if (createSelectedSlots.length > required) {
      return { valid: false, message: t('reception.tooManySlots', { count: required }) || `Too many slots. Only ${required} needed.` };
    }
    if (createForm.booking_option === 'consecutive' && createSelectedSlots.length > 1) {
      const firstId = createSelectedSlots[0].employee_id;
      const allSame = createSelectedSlots.every(s => s.employee_id === firstId);
      if (!allSame) {
        return { valid: false, message: t('reception.sameEmployeeConsecutive', 'Please select slots from the same employee for consecutive booking') };
      }
    }
    return { valid: true, message: t('reception.allRequiredSlotsSelected', 'All required slots selected') };
  }

  function handleCreateSlotClick(slot: Slot, event?: React.MouseEvent) {
    const isRemove = event?.ctrlKey || event?.metaKey || event?.button === 2;
    if (isRemove) {
      const idx = createSelectedSlots.map(s => s.slot_id).lastIndexOf(slot.id);
      if (idx !== -1) {
        setCreateSelectedSlots(prev => {
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        });
      }
      return;
    }
    const required = getRequiredSlotsCount();
    const maxSlots = createForm.visitor_count > 1 ? createForm.visitor_count : required;
    if (createSelectedSlots.length >= maxSlots) {
      const sameCount = createSelectedSlots.filter(s => s.slot_id === slot.id).length;
      const cap = slot.available_capacity || 0;
      if (sameCount >= cap) {
        showNotification('warning', t('reception.maxCapacityReached', { cap }) || `Maximum capacity reached. Available: ${cap}`);
        return;
      }
      if (sameCount === 0) {
        showNotification('warning', t('reception.selectUpToSlots', { n: maxSlots }) || `You can select up to ${maxSlots} slot(s). Remove a slot first or click the same slot multiple times.`);
        return;
      }
    }
    setCreateSelectedSlots(prev => [
      ...prev,
      { slot_id: slot.id, start_time: slot.start_time, end_time: slot.end_time, employee_id: slot.employee_id || '', slot_date: slot.slot_date },
    ]);
    if (createSelectedSlots.length === 0) {
      setCreateSelectedTimeSlot({ start_time: slot.start_time, end_time: slot.end_time, slot_date: slot.slot_date });
    }
  }

  function resetCreateForm() {
    setCreateCustomerPhoneFull('');
    setCreateForm({ customer_name: '', customer_phone: '', customer_email: '', visitor_count: 1, notes: '', booking_option: 'consecutive' });
    setCreateServiceId('');
    setCreateDate('');
    setCreateSlotId('');
    setCreateOfferId('');
    setCreateShowFullCalendar(false);
    setCreateCustomerPackages([]);
    setCreateCountryCode(tenantDefaultCountry);
    setCreateSelectedSlots([]);
    setCreateSelectedTimeSlot(null);
    setCreateShowPreview(false);
    setCreateSelectedServices([]);
    setCreateSelectedCustomer(null);
    setCreatePaymentMethod('onsite');
    setCreateTransactionReference('');
  }

  function getNext8Days() {
    return Array.from({ length: 8 }, (_, i) => addDays(new Date(), i));
  }

  // Same backend as Reception: POST /bookings/create or create-bulk. Backend returns immediately (invoice/WhatsApp queued in background).
  // UX: close create modal and show full-screen "Creating booking..." then "Creating invoice..." before opening confirmation modal.
  async function handleCreateBooking(e?: React.FormEvent) {
    e?.preventDefault();
    if (!userProfile?.tenant_id || !createServiceId || !createDate) return;
    const service = createServices.find(s => s.id === createServiceId);
    if (!service) return;
    let price = service.base_price;
    if (createOfferId && service.offers?.length) {
      const offer = service.offers.find(o => o.id === createOfferId);
      if (offer) price = offer.price;
    }
    const visitorCount = Math.max(1, createForm.visitor_count);
    const totalPrice = price * visitorCount;
    const fullPhone = createCustomerPhoneFull.trim().startsWith('+') ? createCustomerPhoneFull.trim() : `${createCountryCode}${(createCustomerPhoneFull.trim() || createForm.customer_phone).replace(/^0+/, '')}`;

    const slotIds: string[] = [];
    const required = visitorCount;
    if (createSelectedSlots.length >= required) {
      slotIds.push(...createSelectedSlots.slice(0, required).map(s => s.slot_id));
    } else if (createForm.visitor_count > 1 && createForm.booking_option === 'parallel' && createSelectedTimeSlot) {
      const parallelSlots = getParallelSlotsForQuantity(createSlots, createSelectedTimeSlot, required);
      if (parallelSlots.length < required) {
        showNotification('warning', t('common.notEnoughCapacity', { available: parallelSlots.length, requested: required }) || `Not enough slots. Need ${required}, only ${parallelSlots.length} available.`);
        return;
      }
      slotIds.push(...parallelSlots.map(s => s.id));
    } else if (createForm.visitor_count > 1 && createForm.booking_option === 'consecutive' && createSelectedSlots.length === 0 && createSlots.length > 0) {
      const consecutiveSlots = getConsecutiveSlotsForQuantity(createSlots, required);
      if (!consecutiveSlots || consecutiveSlots.length < required) {
        showNotification('warning', t('reception.noConsecutiveAvailability') || 'No consecutive availability for the requested number of slots.');
        return;
      }
      slotIds.push(...consecutiveSlots.map(s => s.id));
    } else if (createSelectedSlots.length > 0) {
      slotIds.push(...createSelectedSlots.map(s => s.slot_id));
    } else if (createSlotId) {
      slotIds.push(createSlotId);
    }
    if (slotIds.length === 0) return;

    // Backend create-bulk requires unique slot IDs; each slot must exist and belong to tenant
    const uniqueSlotIds = [...new Set(slotIds)];
    if (uniqueSlotIds.length !== required) {
      showNotification('warning', t('reception.selectDistinctSlots') || `Please select ${required} distinct time slots. Each slot can only be used once.`);
      return;
    }
    // Only send IDs that exist in current createSlots (avoids stale/mismatched tenant)
    const validSlotIds = uniqueSlotIds.filter(id => createSlots.some(s => s.id === id));
    if (validSlotIds.length !== required) {
      showNotification('warning', t('reception.slotNoLongerAvailable') || 'One or more selected slots are no longer available. Please refresh and choose again.');
      return;
    }

    if (totalPrice > 0 && createPaymentMethod === 'transfer' && !createTransactionReference.trim()) {
      showNotification('warning', t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
      return;
    }
    const paymentPayload = totalPrice > 0
      ? (createPaymentMethod === 'unpaid'
        ? { payment_status: 'unpaid' as const }
        : {
            payment_method: createPaymentMethod,
            transaction_reference: createPaymentMethod === 'transfer' ? createTransactionReference.trim() : undefined,
          })
      : (createPaymentMethod === 'unpaid' ? { payment_status: 'unpaid' as const } : {});

    setCreatingBooking(true);
    setIsCreateModalOpen(false);
    setCreateBookingLoadingStep('creating_booking');
    try {
      const session = await db.auth.getSession();
      const token = session.data.session?.access_token || localStorage.getItem('auth_token');
      const headers = { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) };

      const idsToSend = validSlotIds;
      if (idsToSend.length === 1) {
        const slot = createSlots.find(s => s.id === idsToSend[0]);
        const res = await fetch(`${getApiUrl()}/bookings/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tenant_id: userProfile.tenant_id,
            service_id: createServiceId,
            slot_id: idsToSend[0],
            employee_id: slot?.employee_id || null,
            offer_id: createOfferId || null,
            ...(createSelectedCustomer?.id && { customer_id: createSelectedCustomer.id }),
            customer_name: createForm.customer_name.trim(),
            customer_phone: fullPhone,
            customer_email: createForm.customer_email?.trim() || null,
            visitor_count: visitorCount,
            total_price: totalPrice,
            notes: createForm.notes?.trim() || null,
            language: i18n.language,
            ...paymentPayload,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Failed to create booking');
        }
        const result = await res.json();
        setCreateBookingLoadingStep('creating_invoice');
        await new Promise(r => setTimeout(r, 700));
        setCreateBookingLoadingStep(null);
        await fetchBookings();
        if (createServiceId && createDate) {
          try {
            const { slots: freshSlots } = await fetchAvailableSlots({
              tenantId: userProfile.tenant_id,
              serviceId: createServiceId,
              date: parseISO(createDate),
              includePastSlots: false,
              includeZeroCapacity: false,
              includeLockedSlots: false,
            });
            setCreateSlots((freshSlots || []).filter(s => s.available_capacity > 0));
          } catch (_) { /* non-blocking */ }
        }
        resetCreateForm();
        setConfirmationBookingId(result.id ?? null);
      } else {
        const res = await fetch(`${getApiUrl()}/bookings/create-bulk`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tenant_id: userProfile.tenant_id,
            service_id: createServiceId,
            slot_ids: idsToSend,
            ...(createSelectedCustomer?.id && { customer_id: createSelectedCustomer.id }),
            customer_name: createForm.customer_name.trim(),
            customer_phone: fullPhone,
            customer_email: createForm.customer_email?.trim() || null,
            visitor_count: visitorCount,
            total_price: totalPrice,
            notes: createForm.notes?.trim() || null,
            language: i18n.language,
            ...paymentPayload,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Failed to create booking');
        }
        const result = await res.json();
        setCreateBookingLoadingStep('creating_invoice');
        await new Promise(r => setTimeout(r, 700));
        setCreateBookingLoadingStep(null);
        await fetchBookings();
        if (createServiceId && createDate) {
          try {
            const { slots: freshSlots } = await fetchAvailableSlots({
              tenantId: userProfile.tenant_id,
              serviceId: createServiceId,
              date: parseISO(createDate),
              includePastSlots: false,
              includeZeroCapacity: false,
              includeLockedSlots: false,
            });
            setCreateSlots((freshSlots || []).filter(s => s.available_capacity > 0));
          } catch (_) { /* non-blocking */ }
        }
        resetCreateForm();
        const firstId = result.bookings?.[0]?.id ?? null;
        setConfirmationBookingId(firstId);
      }
    } catch (err: any) {
      setCreateBookingLoadingStep(null);
      showNotification('error', err.message || t('reception.errorCreatingBooking', { message: err.message }));
    } finally {
      setCreatingBooking(false);
    }
  }

  async function fetchBookings() {
    if (!userProfile?.tenant_id) return;

    setLoading(true);
    try {
      const { data, error } = await db
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
          created_at,
          zoho_invoice_id,
          zoho_invoice_created_at,
          package_covered_quantity,
          package_subscription_id,
          service_id,
          slot_id,
          employee_id,
          services:service_id (
            name,
            name_ar
          ),
          slots:slot_id (
            slot_date,
            start_time,
            end_time
          ),
          users:employee_id (
            full_name,
            full_name_ar
          )
        `)
        .eq('tenant_id', userProfile.tenant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filter out cancelled bookings (they should be hard-deleted, but filter as safety measure)
      const activeBookings = (data || []).filter(booking => booking.status !== 'cancelled');

      if (viewMode === 'calendar') {
        const weekStart = startOfWeek(calendarDate, { weekStartsOn: 0 });
        const weekEnd = addDays(weekStart, 6);
        const weekStartStr = format(weekStart, 'yyyy-MM-dd');
        const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

        const filteredBookings = activeBookings.filter(booking => {
          const raw = booking.slots?.slot_date;
          if (raw == null) return false;
          const normalized = normalizeSlotDate(raw);
          return normalized >= weekStartStr && normalized <= weekEndStr;
        });
        setBookings(filteredBookings);
      } else {
        setBookings(activeBookings.slice(0, 50));
      }
    } catch (err) {
      console.error('Error fetching bookings:', err);
    } finally {
      setLoading(false);
    }
  }

  function normalizeSlotDate(raw: string | Date): string {
    if (typeof raw === 'string') {
      if (raw.includes('T') || raw.includes('Z')) {
        try {
          return format(parseISO(raw), 'yyyy-MM-dd');
        } catch {
          return raw.substring(0, 10);
        }
      }
      return raw.substring(0, 10);
    }
    return format(new Date(raw), 'yyyy-MM-dd');
  }

  function getBookingsForDate(date: Date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    return displayBookings.filter(booking => {
      const raw = booking.slots?.slot_date;
      if (raw == null) return false;
      return normalizeSlotDate(raw) === dateStr;
    });
  }

  function generateTimeSlots() {
    const slots = [];
    const startHour = 6;
    const endHour = 22;
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
    return (totalMinutes / 30) * 60;
  }

  function getBookingHeight(startTime: string, endTime: string) {
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    const durationMinutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
    return (durationMinutes / 30) * 60;
  }

  function calculateBookingLayout(bookings: Booking[]) {
    if (bookings.length === 0) return [];

    const sortedBookings = [...bookings].sort((a, b) => {
      return (a.slots?.start_time || '').localeCompare(b.slots?.start_time || '');
    });

    const overlaps = (booking1: Booking, booking2: Booking) => {
      const start1 = booking1.slots?.start_time || '';
      const end1 = booking1.slots?.end_time || '';
      const start2 = booking2.slots?.start_time || '';
      const end2 = booking2.slots?.end_time || '';
      return start1 < end2 && start2 < end1;
    };

    const layout: Array<{ booking: Booking; column: number; totalColumns: number }> = [];
    const columns: Booking[][] = [];

    sortedBookings.forEach(booking => {
      let columnIndex = 0;
      for (let i = 0; i < columns.length; i++) {
        const hasOverlap = columns[i].some(b => overlaps(b, booking));
        if (!hasOverlap) {
          columnIndex = i;
          break;
        }
        columnIndex = i + 1;
      }

      if (!columns[columnIndex]) {
        columns[columnIndex] = [];
      }
      columns[columnIndex].push(booking);

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

    layout.forEach((item, index) => {
      const overlappingItems = layout.filter(other =>
        overlaps(item.booking, other.booking)
      );
      const maxCols = Math.max(...overlappingItems.map(i => i.column + 1));
      layout[index].totalColumns = maxCols;
    });

    return layout;
  }

  async function downloadInvoice(bookingId: string, zohoInvoiceId: string) {
    try {
      setDownloadingInvoice(bookingId);
      
      // Use centralized API URL utility
      const API_URL = getApiUrl();
      
      const token = localStorage.getItem('auth_token');
      
      // Ensure API_URL doesn't have trailing slash
      const baseUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
      // Add token as query parameter to bypass CORS header issues
      const downloadUrl = `${baseUrl}/zoho/invoices/${zohoInvoiceId}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      
      const isBolt = window.location.hostname.includes('bolt') || window.location.hostname.includes('webcontainer');
      console.log('[BookingsPage] Downloading invoice:', zohoInvoiceId);
      console.log('[BookingsPage] Environment:', { isBolt, API_URL, downloadUrl: downloadUrl.replace(token || '', '***') });
      
      // Use fetch to download the PDF and create a blob URL
      // This approach is more reliable than direct link, especially in Bolt
      try {
        // Invoice download may take time, use longer timeout
        const response = await fetch(downloadUrl, {
          method: 'GET',
          headers: token ? {
            'Authorization': `Bearer ${token}`,
          } : {},
          signal: createTimeoutSignal('/zoho/invoices', false), // 10s default, but can be extended
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(t('bookings.failedToDownloadInvoice', { message: `${response.status} ${response.statusText}. ${errorText}` }));
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
        
        console.log('[BookingsPage] Download completed successfully');
      } catch (fetchError: any) {
        console.error('[BookingsPage] Fetch error:', fetchError);
        // Fallback to direct link approach if fetch fails
        console.log('[BookingsPage] Falling back to direct link approach');
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
      console.error('[BookingsPage] Error downloading invoice:', error);
      const errorMessage = error.message || t('common.error');
      showNotification('error', t('bookings.failedToDownloadInvoice', { message: errorMessage }));
      setDownloadingInvoice(null);
    }
  }

  async function updateBooking(bookingId: string, updateData: Partial<Booking>, keepModalOpen = false) {
    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('bookings.failedToUpdateBooking', { message: t('common.error') }));
      }

      const result = await response.json();
      await fetchBookings();
      if (!keepModalOpen) setEditingBooking(null);

      const message = (result.message && String(result.message).trim())
        || (result.invoice_created
          ? (t('bookings.bookingUpdatedAndInvoiceSent') || 'Booking updated. A new invoice has been created and sent to the customer.')
          : t('bookings.bookingUpdatedSuccessfully'));
      showNotification('success', message);
      return result;
    } catch (error: any) {
      console.error('Error updating booking:', error);
      showNotification('error', t('bookings.failedToUpdateBooking', { message: error.message }));
      throw error;
    }
  }

  /** Save combined edit modal: details and optionally new time in one action */
  async function handleSaveEditBooking() {
    if (!editingBooking) return;
    const timeChanged = selectedNewSlotId && selectedNewSlotId !== editingBooking.slot_id;
    if (timeChanged) {
      const ok = await showConfirm({
        title: t('common.confirm'),
        description: safeTranslate(t, 'bookings.confirmChangeBookingTime', 'Are you sure you want to change the booking time? Old tickets will be cancelled and new tickets will be created.'),
        destructive: false,
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
      });
      if (!ok) return;
    }
    try {
      await updateBooking(editingBooking.id, {
        customer_name: editingBooking.customer_name,
        customer_email: editingBooking.customer_email,
        total_price: editingBooking.total_price,
        status: editingBooking.status,
      }, true);
      if (timeChanged) {
        await updateBookingTime(editingBooking, true);
      } else {
        setEditingBooking(null);
        setSelectedNewSlotId('');
        setChangeTimeEmployeeId('');
        setAvailableTimeSlots([]);
      }
    } catch {
      // Error already shown by updateBooking / updateBookingTime
    }
  }

  async function deleteBooking(bookingId: string) {
    // Find the booking to check its payment status
    const booking = bookings.find(b => b.id === bookingId);
    const isPaid = getPaymentDisplayValue(booking) !== 'unpaid';

    // Show appropriate confirmation message based on payment status
    let confirmMessage: string;
    if (isPaid) {
      confirmMessage = t('bookings.confirmDeletePaid');
    } else {
      confirmMessage = t('bookings.confirmDelete');
    }

    const ok = await showConfirm({
      title: t('common.confirm'),
      description: confirmMessage,
      destructive: true,
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;

    try {
      setDeletingBooking(bookingId);
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      // Include allowDeletePaid=true if booking is paid
      const url = isPaid 
        ? `${API_URL}/bookings/${bookingId}?allowDeletePaid=true`
        : `${API_URL}/bookings/${bookingId}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('bookings.failedToDeleteBooking', { message: t('common.error') }));
      }

      await fetchBookings(); // Refresh list
      setDeletingBooking(null);
      
      showNotification('success', t('bookings.bookingDeletedSuccessfully'));
    } catch (error: any) {
      console.error('Error deleting booking:', error);
      showNotification('error', t('bookings.failedToDeleteBooking', { message: error.message }));
      setDeletingBooking(null);
    }
  }

  async function updatePaymentStatus(
    bookingId: string,
    paymentStatus: string,
    paymentMethod?: 'onsite' | 'transfer',
    transactionReference?: string
  ) {
    try {
      setUpdatingPaymentStatus(bookingId);
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const body: Record<string, string> = { payment_status: paymentStatus };
      if (paymentStatus === 'paid' || paymentStatus === 'paid_manual') {
        if (paymentMethod) body.payment_method = paymentMethod;
        if (paymentMethod === 'transfer' && transactionReference?.trim())
          body.transaction_reference = transactionReference.trim();
      }

      const response = await fetch(`${API_URL}/bookings/${bookingId}/payment-status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('bookings.failedToUpdatePaymentStatus', { message: t('common.error') }));
      }

      const result = await response.json();
      
      // Store Zoho sync status
      if (result.zoho_sync) {
        setZohoSyncStatus(prev => ({
          ...prev,
          [bookingId]: result.zoho_sync,
        }));
      }

      await fetchBookings(); // Refresh list
      setUpdatingPaymentStatus(null);

      // Show message: use API message when present (e.g. pending regeneration), else success or Zoho warning
      const zoho = result.zoho_sync;
      if (zoho && !zoho.success) {
        showNotification('warning', t('bookings.paymentStatusUpdatedButZohoFailed', { error: zoho.error }));
      } else {
        const msg = (result.message && String(result.message).trim()) || t('bookings.paymentStatusUpdatedSuccessfully');
        showNotification('success', msg);
      }
    } catch (error: any) {
      console.error('Error updating payment status:', error);
      showNotification('error', t('bookings.failedToUpdatePaymentStatus', { message: error.message }));
      setUpdatingPaymentStatus(null);
    }
  }

  /** Open combined Edit modal: details + change time in one place */
  async function handleEditBookingClick(booking: Booking) {
    if (!userProfile?.tenant_id || !booking.service_id) {
      showNotification('warning', t('bookings.cannotEditBookingTime'));
      return;
    }
    setEditingBooking(booking);
    let initialDate: Date;
    if (booking.slots?.slot_date) {
      const [year, month, day] = booking.slots.slot_date.split('-').map(Number);
      initialDate = new Date(year, month - 1, day);
      setEditingTimeDate(initialDate);
    } else {
      initialDate = new Date();
      setEditingTimeDate(initialDate);
    }
    setSelectedNewSlotId('');
    setChangeTimeEmployeeId('');
    await fetchTimeSlots(booking.service_id, userProfile.tenant_id, initialDate);
  }

  async function fetchTimeSlots(serviceId: string, tenantId: string, date?: Date) {
    // Use provided date or fall back to state
    const targetDate = date || editingTimeDate;
    if (!targetDate) {
      console.warn('[BookingsPage] No date provided for slot fetching');
      return;
    }

    setLoadingTimeSlots(true);
    try {
      console.log('[BookingsPage] ========================================');
      console.log('[BookingsPage] Fetching available slots for booking time edit...');
      console.log('   Service ID:', serviceId);
      console.log('   Date object:', targetDate);
      console.log('   Date string:', format(targetDate, 'yyyy-MM-dd'));
      console.log('   Day of week:', targetDate.getDay(), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][targetDate.getDay()]);
      console.log('   Tenant ID:', tenantId);
      console.log('[BookingsPage] ========================================');
      
      const result = await fetchAvailableSlots({
        tenantId,
        serviceId,
        date: targetDate,
        includePastSlots: true,  // Allow rescheduling to any slot (past or future)
        includeLockedSlots: false, // Still exclude locked slots
        includeZeroCapacity: false, // Still exclude fully booked slots
      });

      console.log('[BookingsPage] ========================================');
      console.log('[BookingsPage] Fetched slots:', result.slots.length);
      console.log('[BookingsPage] Shifts found:', result.shifts.length);
      if (result.shifts.length > 0) {
        console.log('[BookingsPage] Shift schedules:', result.shifts.map(s => ({
          id: s.id.substring(0, 8),
          days: s.days_of_week,
          dayNames: s.days_of_week.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d])
        })));
      }
      console.log('[BookingsPage] ========================================');
      
      if (result.slots.length === 0) {
        console.warn('[BookingsPage] ❌ No slots found for this date. Possible reasons:');
        console.warn('   - No shifts defined for this service');
        console.warn('   - No slots created for this date');
        console.warn('   - All slots are fully booked');
        console.warn('   - Day of week does not match shift schedule');
        console.warn('   CHECK THE LOGS ABOVE FOR DETAILS');
        
        // If we have shifts but no slots, try fetching with includeZeroCapacity to see if slots exist but are fully booked
        if (result.shifts.length > 0) {
          console.log('[BookingsPage] Trying to fetch slots with includeZeroCapacity=true to check if slots exist but are fully booked...');
          try {
            const resultWithZero = await fetchAvailableSlots({
              tenantId,
              serviceId,
              date: targetDate,
              includePastSlots: true,
              includeLockedSlots: false,
              includeZeroCapacity: true, // Include fully booked slots
            });
            
            if (resultWithZero.slots.length > 0) {
              console.warn(`[BookingsPage] ⚠️  Found ${resultWithZero.slots.length} slots but all are fully booked (available_capacity = 0)`);
              console.warn('[BookingsPage]    These slots exist but cannot be selected because they have no available capacity');
            } else {
              console.warn('[BookingsPage] ⚠️  No slots exist for this date at all');
            }
          } catch (diagError) {
            console.error('[BookingsPage] Error in diagnostic query:', diagError);
          }
        }
      }

      setAvailableTimeSlots(result.slots);
    } catch (error: any) {
      console.error('Error fetching time slots:', error);
      showNotification('error', t('bookings.failedToFetchTimeSlots', { message: error.message }));
      setAvailableTimeSlots([]);
    } finally {
      setLoadingTimeSlots(false);
    }
  }

  async function handleTimeDateChange(newDate: Date) {
    setEditingTimeDate(newDate);
    setSelectedNewSlotId('');
    setChangeTimeEmployeeId('');
    if (editingBooking && userProfile?.tenant_id) {
      await fetchTimeSlots(editingBooking.service_id, userProfile.tenant_id, newDate);
    }
  }

  async function updateBookingTime(bookingRef?: Booking | null, skipConfirm = false) {
    const target = bookingRef ?? editingBooking;
    if (!target || !selectedNewSlotId || !userProfile?.tenant_id) {
      showNotification('warning', safeTranslate(t, 'bookings.pleaseSelectNewTimeSlot', 'Please select a new time slot'));
      return;
    }

    if (!skipConfirm) {
      const ok = await showConfirm({
        title: t('common.confirm'),
        description: safeTranslate(t, 'bookings.confirmChangeBookingTime', 'Are you sure you want to change the booking time? Old tickets will be cancelled and new tickets will be created.'),
        destructive: false,
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
      });
      if (!ok) return;
    }

    setUpdatingBookingTime(true);
    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/bookings/${target.id}/time`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ slot_id: selectedNewSlotId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('bookings.failedToUpdateBookingTime', { message: t('common.error') }));
      }

      const result = await response.json();
      console.log('[BookingsPage] ✅ Booking time update response:', result);
      
      const updatedBookingId = target.id;
      
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
        console.log('[BookingsPage] ✅ Got updated booking from backend response:');
        console.log('[BookingsPage]   slot_id:', backendBookingData.slot_id);
        console.log('[BookingsPage]   slot_date:', backendBookingData.slots?.slot_date);
        console.log('[BookingsPage]   start_time:', backendBookingData.slots?.start_time);
        console.log('[BookingsPage]   employee_id:', backendBookingData.employee_id);
        
        // Immediately update the state with backend data (including employee_id for employee-based mode)
        setBookings(prevBookings => 
          prevBookings.map(b => {
            if (b.id === updatedBookingId) {
              console.log('[BookingsPage] 🔄 Immediately updating booking state from backend response...');
              console.log('[BookingsPage]     Old slot_date:', b.slots?.slot_date);
              console.log('[BookingsPage]     New slot_date:', backendBookingData.slots?.slot_date);
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
      
      setEditingBooking(null);
      setSelectedNewSlotId('');
      setAvailableTimeSlots([]);
      
      // Refresh bookings with a delay to ensure backend has updated
      console.log('[BookingsPage] Refreshing bookings after time update...');
      console.log('[BookingsPage] Updated slot_id:', newSlotIdToVerify);
      console.log('[BookingsPage] Booking ID to verify:', updatedBookingId);
      
      // Force refresh by clearing any potential cache
      setTimeout(async () => {
        // CRITICAL: Use API response data if available (most reliable)
        // The backend returns the updated booking with correct slot_date
        if (backendBookingData && backendBookingData.slot_id === newSlotIdToVerify) {
          console.log('[BookingsPage] 🔄 Using API response data for state update...');
          console.log('[BookingsPage]   API slot_id:', backendBookingData.slot_id);
          console.log('[BookingsPage]   API slot_date:', backendBookingData.slots?.slot_date);
          
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
                console.log('[BookingsPage]   State update from API response:', {
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
          
          console.log('[BookingsPage] ✅ State updated from API response');
        }
        
        // Verify the booking was updated correctly with multiple attempts
        let bookingData: any = null;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts && !bookingData) {
          attempts++;
          console.log(`[BookingsPage] Verification attempt ${attempts}/${maxAttempts}...`);
          
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
              console.log('[BookingsPage] ✅ Verified updated booking:');
              console.log('[BookingsPage]   slot_id:', bookingData.slot_id);
              console.log('[BookingsPage]   slot_date:', bookingData.slots?.slot_date);
              console.log('[BookingsPage]   start_time:', bookingData.slots?.start_time);
              break;
            } else if (error) {
              console.warn(`[BookingsPage] Verification attempt ${attempts} failed:`, error);
            } else if (data && data.slot_id !== newSlotIdToVerify) {
              console.warn(`[BookingsPage] Verification attempt ${attempts}: slot_id mismatch. Expected: ${newSlotIdToVerify}, Got: ${data.slot_id}`);
            }
          } catch (verifyError) {
            console.warn(`[BookingsPage] Verification attempt ${attempts} error:`, verifyError);
          }
          
          // Wait before next attempt
          if (attempts < maxAttempts && !bookingData) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // Force a fresh query of all bookings
        await fetchBookings();
        console.log('[BookingsPage] ✅ Bookings refreshed');
        
        // CRITICAL: After fetchBookings, ensure the updated booking has correct slot_date
        // This handles cases where fetchBookings might return stale relationship data
        if (bookingData && bookingData.slot_id === newSlotIdToVerify) {
          console.log('[BookingsPage] 🔄 Force updating booking state with verified slot data after fetchBookings...');
          console.log('[BookingsPage]   Verified slot_id:', bookingData.slot_id);
          console.log('[BookingsPage]   Verified slot_date:', bookingData.slots?.slot_date || 'MISSING (will fetch)');
          
          // If slot_date is missing, fetch it separately
          let finalSlotData = bookingData.slots;
          if (!finalSlotData || !finalSlotData.slot_date) {
            console.log('[BookingsPage]   Slot date missing, fetching slot details...');
            try {
              const { data: slotData, error: slotError } = await db
                .from('slots')
                .select('slot_date, start_time, end_time')
                .eq('id', bookingData.slot_id)
                .single();
              
              if (!slotError && slotData) {
                finalSlotData = slotData;
                console.log('[BookingsPage]   ✅ Fetched slot date:', finalSlotData.slot_date);
              }
            } catch (slotFetchError) {
              console.warn('[BookingsPage]   ⚠️  Failed to fetch slot details:', slotFetchError);
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
                console.log('[BookingsPage]   Final state update after fetchBookings:', {
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
          
          console.log('[BookingsPage] ✅ State updated with verified slot data after fetchBookings');
        } else if (backendBookingData) {
          // If we have API response data but verification failed, still use API data
          console.log('[BookingsPage] ✅ Using API response data (verification skipped)');
          setBookings(prevBookings => {
            const updated = prevBookings.map(b => {
              if (b.id === updatedBookingId && b.slot_id !== backendBookingData.slot_id) {
                return {
                  ...b,
                  slot_id: backendBookingData.slot_id,
                  slots: backendBookingData.slots,
                };
              }
              return b;
            });
            return updated;
          });
        } else {
          console.warn('[BookingsPage] ⚠️  Could not verify booking update. Slot ID mismatch or booking not found.');
          if (bookingData) {
            console.warn(`[BookingsPage]   Expected slot_id: ${newSlotIdToVerify}, Got: ${bookingData.slot_id}`);
          }
        }
      }, 1500);
      
      showNotification('success', t('bookings.bookingTimeUpdatedSuccessfully'));
    } catch (error: any) {
      console.error('Error updating booking time:', error);
      showNotification('error', t('bookings.failedToUpdateBookingTime', { message: error.message }));
    } finally {
      setUpdatingBookingTime(false);
    }
  }

  // Validate search input based on search type
  function validateSearchInput(type: SearchType, value: string): { valid: boolean; error?: string } {
    if (!type) {
      return { valid: false, error: isAr ? 'اختر نوع البحث أولاً...' : (t('reception.selectSearchTypeFirst') || 'Please select a search type first') };
    }

    if (!value || value.trim().length === 0) {
      return { valid: false, error: isAr ? 'يرجى إدخال قيمة البحث' : (t('reception.enterSearchValue') || 'Please enter a search value') };
    }

    switch (type) {
      case 'phone':
        const phoneDigits = value.replace(/\D/g, '');
        if (phoneDigits.length < 5) {
          return { valid: false, error: isAr ? 'يجب أن يكون رقم الهاتف 5 أرقام على الأقل' : (t('reception.phoneMinLength') || 'Phone number must be at least 5 digits') };
        }
        break;
      case 'booking_id':
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(value.trim())) {
          return { valid: false, error: isAr ? 'تنسيق رقم الحجز غير صحيح' : (t('reception.invalidBookingId') || 'Invalid booking ID format') };
        }
        break;
      case 'customer_name':
        if (value.trim().length < 2) {
          return { valid: false, error: isAr ? 'يجب أن يكون الاسم حرفين على الأقل' : (t('reception.nameMinLength') || 'Name must be at least 2 characters') };
        }
        break;
      case 'service_name':
        if (value.trim().length < 2) {
          return { valid: false, error: isAr ? 'يجب أن يكون اسم الخدمة حرفين على الأقل' : (t('reception.serviceMinLength') || 'Service name must be at least 2 characters') };
        }
        break;
      case 'date':
        if (!value) {
          return { valid: false, error: isAr ? 'اختر التاريخ' : (t('reception.selectDate') || 'Please select a date') };
        }
        break;
    }

    return { valid: true };
  }

  // Search bookings function
  async function searchBookings(type: SearchType, value: string) {
    if (!userProfile?.tenant_id || !type || !value) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

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
      
      const transformedBookings = (result.bookings || []).map((b: any) => ({
        id: b.id,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        customer_email: b.customer_email,
        visitor_count: b.visitor_count,
        total_price: b.total_price,
        status: b.status,
        payment_status: b.payment_status,
        payment_method: b.payment_method,
        created_at: b.created_at,
        zoho_invoice_id: b.zoho_invoice_id,
        zoho_invoice_created_at: b.zoho_invoice_created_at,
        package_covered_quantity: b.package_covered_quantity,
        package_subscription_id: b.package_subscription_id,
        service_id: b.service_id,
        slot_id: b.slot_id,
        employee_id: b.employee_id,
        users: b.users || null,
        services: b.services || { name: '', name_ar: '' },
        slots: b.slots || { slot_date: '', start_time: '', end_time: '' }
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
      const digitsOnly = value.replace(/\D/g, '');
      setSearchQuery(digitsOnly);
    } else if (searchType === 'booking_id') {
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

    if (searchType && searchType !== 'date' && searchType !== '' && searchQuery.trim().length > 0) {
      const validation = validateSearchInput(searchType, searchQuery);
      if (validation.valid) {
        searchTimeoutRef.current = setTimeout(() => {
          searchBookings(searchType, searchQuery);
        }, 300);
      }
    } else if (searchType === '' || (searchType !== 'date' && searchQuery.trim().length === 0)) {
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

  // Determine which bookings to display
  const displayBookings = showSearchResults ? searchResults : bookings;

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Calendar className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('bookings.title')}</h1>
              <p className="text-sm md:text-base text-gray-600 mt-1">{t('bookings.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateBooking && (
            <Button
              onClick={() => {
                setIsCreateModalOpen(true);
                fetchCreateServices();
                resetCreateForm();
              }}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t('reception.createNewBooking', 'Add booking')}
            </Button>
          )}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => {
              setViewMode('list');
              if (showSearchResults) {
                setSearchQuery('');
                setSearchDate('');
                setSearchType('');
                setShowSearchResults(false);
                setSearchResults([]);
                setSearchValidationError('');
              }
            }}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            disabled={showSearchResults && viewMode === 'list'}
          >
            <List className="w-4 h-4 inline-block mr-2" />
            {isAr ? 'عرض القائمة' : t('bookings.listView')}
          </button>
          <button
            onClick={() => {
              if (showSearchResults) {
                // Clear search when switching to calendar
                setSearchQuery('');
                setSearchDate('');
                setSearchType('');
                setShowSearchResults(false);
                setSearchResults([]);
                setSearchValidationError('');
              }
              setViewMode('calendar');
            }}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              viewMode === 'calendar'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            } ${showSearchResults ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={showSearchResults}
            title={showSearchResults ? (isAr ? 'امسح البحث لاستخدام عرض التقويم' : (t('bookings.clearSearchToUseCalendar') || 'Clear search to use calendar view')) : ''}
          >
            <Calendar className="w-4 h-4 inline-block mr-2" />
            {isAr ? 'عرض التقويم' : t('bookings.calendarView')}
          </button>
        </div>
        </div>
      </div>

      {/* Search Bar with Type Selector - Only show in list view */}
      {viewMode === 'list' && (
      <div className="mb-6 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Type Selector */}
          <div className="w-full sm:w-64">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isAr ? 'البحث حسب' : (t('reception.searchType') || 'Search By')}
            </label>
            <select
              value={searchType}
              onChange={(e) => handleSearchTypeChange(e.target.value as SearchType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="">{isAr ? 'اختر نوع البحث...' : (t('reception.selectSearchType') || 'Select search type...')}</option>
              <option value="phone">{isAr ? 'رقم هاتف العميل' : (t('reception.searchByPhone') || 'Customer Phone Number')}</option>
              <option value="customer_name">{isAr ? 'اسم العميل' : (t('reception.searchByName') || 'Customer Name')}</option>
              <option value="date">{isAr ? 'تاريخ الحجز' : (t('reception.searchByDate') || 'Booking Date')}</option>
              <option value="service_name">{isAr ? 'اسم الخدمة' : (t('reception.searchByService') || 'Service Name')}</option>
              <option value="booking_id">{isAr ? 'رقم الحجز' : (t('reception.searchByBookingId') || 'Booking ID')}</option>
            </select>
          </div>

          {/* Search Input (conditional based on type) */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {searchType === 'date'
                ? (isAr ? 'اختر التاريخ' : (t('reception.selectDate') || 'Select Date'))
                : (isAr ? 'قيمة البحث' : (t('reception.searchValue') || 'Search Value'))}
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
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchInputChange(e.target.value)}
                  placeholder={
                    searchType === 'phone'
                      ? (isAr ? 'أدخل رقم الهاتف...' : (t('reception.phonePlaceholder') || 'Enter phone number...'))
                      : searchType === 'booking_id'
                      ? (isAr ? 'أدخل رقم الحجز (UUID)...' : (t('reception.bookingIdPlaceholder') || 'Enter booking ID (UUID)...'))
                      : searchType === 'customer_name'
                      ? (isAr ? 'أدخل اسم العميل...' : (t('reception.namePlaceholder') || 'Enter customer name...'))
                      : searchType === 'service_name'
                      ? (isAr ? 'أدخل اسم الخدمة...' : (t('reception.servicePlaceholder') || 'Enter service name...'))
                      : (isAr ? 'اختر نوع البحث أولاً...' : (t('reception.selectSearchTypeFirst') || 'Select search type first...'))
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
              <span className="font-medium">{isAr ? 'البحث حسب' : (t('reception.searchingBy') || 'Searching by')}: </span>
              <span>
                {searchType === 'phone' && (isAr ? 'رقم هاتف العميل' : (t('reception.searchByPhone') || 'Phone Number'))}
                {searchType === 'customer_name' && (isAr ? 'اسم العميل' : (t('reception.searchByName') || 'Customer Name'))}
                {searchType === 'date' && (isAr ? 'تاريخ الحجز' : (t('reception.searchByDate') || 'Booking Date'))}
                {searchType === 'service_name' && (isAr ? 'اسم الخدمة' : (t('reception.searchByService') || 'Service Name'))}
                {searchType === 'booking_id' && (isAr ? 'رقم الحجز' : (t('reception.searchByBookingId') || 'Booking ID'))}
              </span>
            </p>
            <p className="text-gray-600">
              {searchResults.length > 0
                ? (isAr ? `${searchResults.length} نتيجة` : `${searchResults.length} ${t('reception.searchResults') || 'results found'}`)
                : (isAr ? 'لم يتم العثور على نتائج' : (t('reception.noSearchResults') || 'No results found'))}
            </p>
          </div>
        )}
      </div>
      )}

      {viewMode === 'list' ? (
        displayBookings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <div className="flex items-center justify-center gap-2 mb-2">
                <Calendar className="w-5 h-5 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900">
                {showSearchResults 
                  ? t('reception.noSearchResults') || 'No results found'
                  : t('bookings.noBookingsYet')}
              </h3>
              </div>
              <p className="text-gray-600">{t('bookings.bookingsWillAppear')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {displayBookings.map((booking) => (
              <Card key={booking.id} className="hover:shadow-lg transition-shadow">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-2">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-500" />
                          <span className="font-medium">{booking.customer_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-gray-500" />
                          <span className="text-sm text-gray-600">
                            {booking.slots ?
                              `${format(new Date(booking.slots.slot_date), 'MMM dd, yyyy', { locale: isAr ? ar : undefined })} ${formatTimeTo12Hour(booking.slots.start_time)}` :
                              formatDateTimeTo12Hour(booking.created_at, { locale: isAr ? ar : undefined })
                            }
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                        <span>{isAr ? booking.services?.name_ar : booking.services?.name}</span>
                        <span>•</span>
                        <span>{booking.visitor_count} {t('booking.visitorCount')}</span>
                        <span>•</span>
                        <span className="font-semibold">{booking.total_price} {t('service.price')}</span>
                        {booking.users && (
                          <>
                            <span>•</span>
                            <span>{isAr ? (booking.users.full_name_ar || booking.users.full_name) : booking.users.full_name}</span>
                          </>
                        )}
                        {((booking.package_covered_quantity ?? 0) > 0 || booking.package_subscription_id) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            <Package className="w-3.5 h-3.5" />
                            {t('bookings.coveredByPackage', 'Covered by Package')}
                          </span>
                        )}
                      </div>
                      
                      {/* Invoice Section */}
                      {booking.zoho_invoice_id ? (
                        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div className="flex items-center gap-2">
                              <FileText className="w-5 h-5 text-blue-600" />
                              <div>
                                <h4 className="font-semibold text-blue-900 text-sm">
                                  {t('billing.invoice')}
                                </h4>
                                <p className="text-xs text-blue-700 font-mono mt-1">
                                  {booking.zoho_invoice_id}
                                </p>
                              </div>
                            </div>
                            {getPaymentDisplayValue(booking) === 'unpaid' ? (
                              <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                                <XCircle className="w-3 h-3" />
                                {getPaymentDisplayLabel(booking, t)}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                                <CheckCircle className="w-3 h-3" />
                                {getPaymentDisplayLabel(booking, t)}
                              </span>
                            )}
                          </div>
                          {booking.zoho_invoice_created_at && (
                            <p className="text-xs text-blue-600 mb-3">
                              {t('billing.created')}{' '}
                              {formatDateTimeTo12Hour(booking.zoho_invoice_created_at, { locale: isAr ? ar : undefined })}
                            </p>
                          )}
                          <Button
                            onClick={() => downloadInvoice(booking.id, booking.zoho_invoice_id!)}
                            disabled={downloadingInvoice === booking.id}
                            className="flex items-center gap-2 text-sm"
                            variant="ghost"
                            size="sm"
                          >
                            <Download className="w-4 h-4" />
                            {downloadingInvoice === booking.id 
                              ? t('billing.downloading')
                              : t('billing.downloadPdf')}
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                          <p className="text-xs text-gray-600 flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            {safeTranslate(t, 'bookings.noInvoiceForBooking', 'No invoice for this booking')}
                          </p>
                        </div>
                      )}

                      {/* Booking Management Actions (Service Provider Only) */}
                      <div className="mt-4 flex flex-wrap gap-2 pt-4 border-t border-gray-200">
                        {/* Payment Status Dropdown: Unpaid | Paid On Site | Bank Transfer */}
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-gray-500" />
                          <select
                            value={getPaymentDisplayValue(booking)}
                            onChange={(e) => {
                              const val = e.target.value as PaymentDisplayValue;
                              if (val === 'unpaid') {
                                updatePaymentStatus(booking.id, 'unpaid');
                              } else if (val === 'paid_onsite') {
                                updatePaymentStatus(booking.id, 'paid_manual', 'onsite');
                              } else {
                                setPaymentStatusModal({ bookingId: booking.id });
                                setPaymentStatusModalMethod('transfer');
                                setPaymentStatusModalReference('');
                              }
                            }}
                            disabled={updatingPaymentStatus === booking.id}
                            className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="unpaid">{t('payment.displayUnpaid', 'Unpaid')}</option>
                            <option value="paid_onsite">{t('payment.displayPaidOnSite', 'Paid On Site')}</option>
                            <option value="bank_transfer">{t('payment.displayBankTransfer', 'Bank Transfer')}</option>
                          </select>
                          {updatingPaymentStatus === booking.id && (
                            <span className="text-xs text-gray-500">{t('bookings.updating')}</span>
                          )}
                        </div>

                        {/* Zoho Sync Status */}
                        {zohoSyncStatus[booking.id] && (
                          <div className="flex items-center gap-1 text-xs">
                            {zohoSyncStatus[booking.id].pending ? (
                              <span className="text-amber-600 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />
                                {t('bookings.zohoRegenerating', 'Invoice regenerating…')}
                              </span>
                            ) : zohoSyncStatus[booking.id].success ? (
                              <span className="text-green-600 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />
                                {t('bookings.zohoSynced')}
                              </span>
                            ) : (
                              <span className="text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                {t('bookings.zohoFailed')}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Edit Button */}
                        <Button
                          onClick={() => handleEditBookingClick(booking)}
                          variant="ghost"
                          size="sm"
                          className="flex items-center gap-1 text-sm"
                        >
                          <Edit className="w-4 h-4" />
                          {t('common.edit')}
                        </Button>

                        {/* Delete Button */}
                        <Button
                          onClick={() => deleteBooking(booking.id)}
                          disabled={deletingBooking === booking.id}
                          variant="ghost"
                          size="sm"
                          className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                          {deletingBooking === booking.id 
                            ? t('common.deleting')
                            : t('common.delete')}
                        </Button>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                      booking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                      booking.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      booking.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {safeTranslateStatus(t, booking.status, 'booking')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setCalendarDate(addDays(calendarDate, -7))}
                className="p-2 hover:bg-white rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <button
                onClick={() => setCalendarDate(new Date())}
                className="px-4 py-2 bg-white hover:bg-gray-50 rounded-lg font-medium text-sm transition-colors shadow-sm"
              >
                {t('bookings.today')}
              </button>
              <button
                onClick={() => setCalendarDate(addDays(calendarDate, 7))}
                className="p-2 hover:bg-white rounded-lg transition-colors"
              >
                <ChevronRight className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">
              {format(startOfWeek(calendarDate, { weekStartsOn: 0 }), 'MMM d', { locale: isAr ? ar : undefined })} - {format(addDays(startOfWeek(calendarDate, { weekStartsOn: 0 }), 6), 'MMM d, yyyy', { locale: isAr ? ar : undefined })}
            </h2>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[1200px]">
              <div className="grid grid-cols-8 border-b bg-gradient-to-r from-blue-50 to-indigo-50 sticky top-0 z-10">
                <div className="px-2 py-3 text-xs font-medium text-gray-500 border-r flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {t('bookings.time')}
                </div>
                {Array.from({ length: 7 }, (_, i) => {
                  const day = addDays(startOfWeek(calendarDate, { weekStartsOn: 0 }), i);
                  const isToday = isSameDay(day, new Date());
                  return (
                    <div key={i} className={`px-2 py-3 text-center border-r ${
                      isToday ? 'bg-blue-100' : ''
                    }`}>
                      <div className="text-xs font-medium text-gray-500">
                        {format(day, 'EEE', { locale: isAr ? ar : undefined })}
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

              <div className="relative">
                <div className="grid grid-cols-8">
                  <div className="border-r bg-gray-50">
                    {generateTimeSlots().map((time, idx) => (
                      <div
                        key={idx}
                        className="h-[60px] px-2 py-1 text-xs text-gray-500 border-b text-right"
                      >
                        {time}
                      </div>
                    ))}
                  </div>

                  {Array.from({ length: 7 }, (_, dayIndex) => {
                    const day = addDays(startOfWeek(calendarDate, { weekStartsOn: 0 }), dayIndex);
                    const dayBookings = getBookingsForDate(day);
                    const isToday = isSameDay(day, new Date());

                    return (
                      <div key={dayIndex} className={`relative border-r ${
                        isToday ? 'bg-blue-50/30' : ''
                      }`}>
                        {generateTimeSlots().map((_, idx) => (
                          <div
                            key={idx}
                            className="h-[60px] border-b hover:bg-gray-50"
                          />
                        ))}

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
                              >
                                <div className="text-xs font-semibold truncate">
                                  {formatTimeTo12Hour(booking.slots?.start_time ?? '')}
                                </div>
                                <div className="text-xs font-medium truncate">
                                  {booking.customer_name}
                                </div>
                                <div className="text-xs text-gray-600 truncate flex items-center gap-1">
                                  {isAr ? booking.services?.name_ar : booking.services?.name}
                                </div>
                                {booking.users && (
                                  <div className="text-xs text-gray-500 truncate">
                                    {isAr ? (booking.users.full_name_ar || booking.users.full_name) : booking.users.full_name}
                                  </div>
                                )}
                                {((booking.package_covered_quantity ?? 0) > 0 || booking.package_subscription_id) && (
                                  <span title={t('bookings.coveredByPackage', 'Covered by Package')}>
                                    <Package className="w-3 h-3 text-emerald-600 shrink-0" />
                                  </span>
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

      {/* Full-screen loading overlay when creating booking (same UX as Reception: modal closed, then "Creating booking..." → "Creating invoice...") */}
      {createBookingLoadingStep && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm" dir={isAr ? 'rtl' : 'ltr'}>
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4" />
          <p className="text-lg font-medium text-gray-800">
            {createBookingLoadingStep === 'creating_booking'
              ? t('reception.creatingBooking', 'Creating booking...')
              : t('reception.creatingInvoice', 'Creating invoice...')}
          </p>
        </div>
      )}

      {/* Payment status modal: when setting to paid, collect payment method + transaction reference */}
      {paymentStatusModal && (
        <Modal
          isOpen={!!paymentStatusModal}
          onClose={() => {
            setPaymentStatusModal(null);
            setPaymentStatusModalReference('');
          }}
          title={t('bookings.setPaymentStatus', 'Set Payment Status')}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {t('bookings.enterReferenceForBankTransfer', 'Enter transaction reference for bank transfer. Invoice will be sent via WhatsApp after confirmation.')}
            </p>
            {paymentStatusModalMethod === 'transfer' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('bookings.transactionReferenceRequired', 'Transaction Reference Number (required)')}
                </label>
                <input
                  type="text"
                  value={paymentStatusModalReference}
                  onChange={(e) => setPaymentStatusModalReference(e.target.value)}
                  placeholder={t('bookings.enterReferenceNumber', 'Enter reference number')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setPaymentStatusModal(null);
                  setPaymentStatusModalReference('');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  if (!paymentStatusModalReference.trim()) {
                    showNotification('warning', t('bookings.transactionReferenceRequired') || 'Transaction reference is required for transfer.');
                    return;
                  }
                  setPaymentStatusModalSubmitting(true);
                  try {
                    await updatePaymentStatus(
                      paymentStatusModal.bookingId,
                      'paid_manual',
                      'transfer',
                      paymentStatusModalReference.trim() || undefined
                    );
                    setPaymentStatusModal(null);
                    setPaymentStatusModalReference('');
                  } finally {
                    setPaymentStatusModalSubmitting(false);
                  }
                }}
                disabled={paymentStatusModalSubmitting || !paymentStatusModalReference.trim()}
                icon={<DollarSign className="w-4 h-4" />}
              >
                {paymentStatusModalSubmitting ? t('bookings.updating') : t('common.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Admin Create Booking Modal — same layout, field order, validation and preview as Receptionist (ReceptionPage) */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => { setIsCreateModalOpen(false); resetCreateForm(); }}
        title={createShowPreview ? t('reception.bookingPreview') : t('reception.createNewBooking', 'Create New Booking')}
        size="md"
      >
        {createShowPreview ? (
          <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6 shadow-lg">
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900">{t('reception.bookingSummary')}</h3>
                <p className="text-sm text-gray-600 mt-1">{t('reception.reviewBeforeConfirm')}</p>
              </div>
              <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {t('reception.customerInformation')}
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">{t('reception.nameLabel')}</span>
                    <div className="font-medium text-gray-900">{createForm.customer_name}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('reception.phoneLabel')}</span>
                    <div className="font-medium text-gray-900">{createCountryCode}{createForm.customer_phone}</div>
                  </div>
                  {createForm.customer_email && (
                    <div className="col-span-2">
                      <span className="text-gray-500">{t('reception.emailLabel')}</span>
                      <div className="font-medium text-gray-900">{createForm.customer_email}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('reception.serviceDetails')}</h4>
                {(() => {
                  const svc = createServices.find(s => s.id === createServiceId);
                  if (!svc) return null;
                  const pkgCheck = checkServiceInPackage(svc.id);
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-gray-900">{isAr ? svc.name_ar : svc.name}</div>
                          <div className="text-sm text-gray-600">{t('reception.quantityCount', { count: createForm.visitor_count })}</div>
                        </div>
                        <div className="text-right">
                          {pkgCheck.available && pkgCheck.remaining >= createForm.visitor_count ? (
                            <span className="text-green-600 font-semibold text-sm flex items-center gap-1">
                              <Package className="w-4 h-4" />
                              {t('reception.packageService')}
                            </span>
                          ) : (
                            <span className="font-bold text-gray-900">{formatPrice((svc.base_price || 0) * createForm.visitor_count)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {t('reception.scheduleAndEmployees')}
                </h4>
                <div className="space-y-2">
                  {createSelectedSlots.length > 0 ? (
                    createSelectedSlots.map((s, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2 border-b last:border-b-0">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{format(parseISO(s.slot_date), 'MMM dd, yyyy', { locale: isAr ? ar : undefined })}</div>
                          <div className="text-xs text-gray-600">{formatTimeTo12Hour(s.start_time)} - {formatTimeTo12Hour(s.end_time)}</div>
                        </div>
                      </div>
                    ))
                  ) : createSlotId ? (() => {
                    const slot = createSlots.find(s => s.id === createSlotId);
                    return slot ? (
                      <div className="flex justify-between items-center py-2">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{format(parseISO(createDate), 'MMM dd, yyyy', { locale: isAr ? ar : undefined })}</div>
                          <div className="text-xs text-gray-600">{formatTimeTo12Hour(slot.start_time)} - {formatTimeTo12Hour(slot.end_time)}</div>
                        </div>
                      </div>
                    ) : null;
                  })() : (
                    <div className="text-sm text-gray-500">{t('reception.noTimeSlotSelected')}</div>
                  )}
                </div>
              </div>
              {createForm.notes && (
                <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('reception.notesLabel')}</h4>
                  <p className="text-sm text-gray-600">{createForm.notes}</p>
                </div>
              )}
              {/* Payment method (payable or package booking — Unpaid option for both) */}
              {(() => {
                const svc = createServices.find(s => s.id === createServiceId);
                if (!svc) return null;
                return (
                  <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('reception.paymentMethod') || 'Payment method'}</h4>
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
                          onChange={() => setCreatePaymentMethod('onsite')}
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
              <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-lg p-4 text-white">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">{t('reception.totalPrice')}</span>
                  <span className="text-2xl font-bold">
                    {(() => {
                      const svc = createServices.find(s => s.id === createServiceId);
                      if (!svc) return formatPrice(0);
                      const pkgCheck = checkServiceInPackage(svc.id);
                      if (pkgCheck.available && pkgCheck.remaining >= createForm.visitor_count) return t('reception.packageServiceTotal', { price: formatPriceString(0) });
                      return formatPrice((svc.base_price || 0) * createForm.visitor_count);
                    })()}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-4 border-t">
              <Button type="button" variant="secondary" fullWidth onClick={() => setCreateShowPreview(false)}>
                {t('reception.editBooking')}
              </Button>
              <Button type="button" fullWidth onClick={() => handleCreateBooking()} disabled={creatingBooking}>
                {creatingBooking ? t('common.loading') : t('reception.confirmBooking')}
              </Button>
            </div>
          </div>
        ) : (
        <form onSubmit={(e) => { e.preventDefault(); setCreateShowPreview(true); }} className="space-y-4">
          {/* 1. Customer Phone + suggestions dropdown */}
          <div className="relative" ref={createPhoneWrapperRef}>
            <PhoneInput
              label={t('booking.customerPhone')}
              value={createCustomerPhoneFull}
              onChange={(value) => {
                if (createSelectedCustomer && value !== createSelectedCustomer.phone) setCreateSelectedCustomer(null);
                setCreateCustomerPhoneFull(value);
                let phoneNumber = value;
                let code = tenantDefaultCountry;
                for (const country of countryCodes) {
                  if (value.startsWith(country.code)) {
                    code = country.code;
                    phoneNumber = value.replace(country.code, '').trim();
                    break;
                  }
                }
                setCreateCountryCode(code);
                setCreateForm(f => ({ ...f, customer_phone: phoneNumber }));
                if (value.length >= 8) lookupCustomerByPhone(value);
              }}
              defaultCountry={tenantDefaultCountry}
              required
            />
            {(isLookingUpCustomer || createPhoneSearchLoading) && (
              <div className="absolute right-3 top-[38px] flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
                <span className="text-xs text-gray-500">{t('reception.checkingCustomerAndPackages') || 'Checking customer & packages...'}</span>
              </div>
            )}
            {!createSelectedCustomer && createPhoneSuggestions.length >= 1 && (
              <CustomerPhoneSuggestionsDropdown
                suggestions={createPhoneSuggestions}
                onSelect={(c) => {
                  setCreateSelectedCustomer(c);
                  setCreateCustomerPhoneFull(c.phone);
                  let localPhone = c.phone;
                  let code = tenantDefaultCountry;
                  for (const country of countryCodes) {
                    if (c.phone.startsWith(country.code)) {
                      code = country.code;
                      localPhone = c.phone.replace(country.code, '').trim();
                      break;
                    }
                  }
                  setCreateCountryCode(code);
                  setCreateForm(prev => ({ ...prev, customer_name: c.name || '', customer_email: c.email || '', customer_phone: localPhone }));
                  clearCreatePhoneSuggestions();
                  lookupCustomerByPhone(c.phone);
                }}
                onClose={clearCreatePhoneSuggestions}
                containerRef={createPhoneWrapperRef}
              />
            )}
            {createSelectedCustomer && (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>{t('reception.existingCustomerSelected')}</span>
              </div>
            )}
          </div>
          {/* 2. Customer Name */}
          <Input
            label={`${t('booking.customerName')} *`}
            value={createForm.customer_name}
            onChange={(e) => setCreateForm(f => ({ ...f, customer_name: e.target.value }))}
            required
            placeholder={t('booking.customerName')}
            disabled={!!createSelectedCustomer}
          />
          {/* 3. Customer Email */}
          <Input
            label={t('booking.customerEmail')}
            type="email"
            value={createForm.customer_email}
            onChange={(e) => setCreateForm(f => ({ ...f, customer_email: e.target.value }))}
            placeholder={t('booking.customerEmail')}
            disabled={!!createSelectedCustomer}
          />
          {/* Package Information Display — scrollable; show loading skeleton while looking up customer (same as Reception) */}
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
          {!isLookingUpCustomer && createCustomerPackages.length > 0 && (
            <div className="rounded-lg border-2 border-green-200 bg-green-50/50 p-2">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-green-800">
                <Package className="h-4 w-4" />
                {t('packages.activePackage')} ({createCustomerPackages.length}) — {isAr ? 'مرر للأسفل للمزيد' : 'scroll for more'}
              </p>
              <div
                className="space-y-3 overflow-y-auto pr-1"
                style={{ maxHeight: '340px' }}
              >
                {createCustomerPackages.map((pkg) => (
                  <div key={pkg.id} className="shrink-0 rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Package className="w-5 h-5 text-green-600 shrink-0" />
                      <h4 className="font-semibold text-green-900 truncate">
                        {isAr ? pkg.service_packages.name_ar : pkg.service_packages.name}
                      </h4>
                    </div>
                    <div className="space-y-2 text-sm">
                      {pkg.usage.map((usage) => (
                        <div key={`${pkg.id}-${usage.service_id}`} className="flex justify-between items-center py-1 gap-2">
                          <span className={`min-w-0 truncate ${usage.remaining_quantity === 0 ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                            {isAr ? usage.services?.name_ar : usage.services?.name}
                          </span>
                          <span className={`shrink-0 font-medium ${usage.remaining_quantity > 5 ? 'text-green-600' : usage.remaining_quantity > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                            {usage.remaining_quantity} / {usage.original_quantity} {t('packages.remaining')}
                          </span>
                        </div>
                      ))}
                    </div>
                    {pkg.expires_at && (
                      <p className="text-xs text-gray-600 mt-2">{t('packages.expiresOn')}: {new Date(pkg.expires_at).toLocaleDateString()}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 4. Select Service */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('reception.selectService')} *</label>
            <select
              value={createServiceId}
              onChange={(e) => { setCreateServiceId(e.target.value); setCreateSlotId(''); setCreateOfferId(''); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              disabled={loadingCreateSlots}
            >
              <option value="">{createServices.length === 0 && !loadingCreateSlots ? t('reception.noServicesAvailable') : loadingCreateSlots ? t('common.loading') + '...' : t('reception.chooseService')}</option>
              {createServices.map((s) => {
                const pkgCheck = checkServiceInPackage(s.id);
                return (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.name_ar : s.name} - {formatPrice(s.base_price)}
                    {pkgCheck.available && ` 🎁 (${pkgCheck.remaining} ${t('packages.remaining')})`}
                  </option>
                );
              })}
            </select>
            {createServices.length === 0 && !loadingCreateSlots && (
              <p className="mt-1 text-sm text-amber-600">⚠️ {t('reception.noServicesFound')}</p>
            )}
            {loadingCreateSlots && (
              <p className="mt-1 text-sm text-blue-600">{t('reception.loadingServices')}</p>
            )}
          </div>
          {/* 4b. Select Offer (if service has offers) */}
          {createServiceId && createServices.find(s => s.id === createServiceId)?.offers?.length ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{isAr ? 'اختر العرض (اختياري)' : 'Select Offer (Optional)'}</label>
              <select
                value={createOfferId}
                onChange={(e) => setCreateOfferId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">{t('reception.basePrice')} ({formatPrice(createServices.find(s => s.id === createServiceId)?.base_price ?? 0)})</option>
                {createServices.find(s => s.id === createServiceId)!.offers!.map((o) => (
                  <option key={o.id} value={o.id}>{isAr ? o.name_ar : o.name} - {formatPrice(o.price)}</option>
                ))}
              </select>
            </div>
          ) : null}
          {/* 5. Visitor Count */}
          {createServiceId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('booking.visitorCount')} *</label>
              <Input
                type="number"
                min={1}
                value={createForm.visitor_count}
                onChange={(e) => setCreateForm(f => ({ ...f, visitor_count: parseInt(e.target.value, 10) || 1 }))}
                required
                placeholder="Enter number of tickets"
              />
              <p className="text-xs text-gray-600 mt-1">
                {formatPrice(createServices.find(s => s.id === createServiceId)?.base_price ?? 0)} {t('checkout.perBook')}
              </p>
              {createServiceId && createForm.visitor_count && (() => {
                const pkgCheck = checkServiceInPackage(createServiceId);
                const qty = createForm.visitor_count;
                if (pkgCheck.remaining > 0 && pkgCheck.remaining < qty) {
                  const paidQty = qty - pkgCheck.remaining;
                  return (
                    <div className="mt-3 p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-yellow-800 mb-1">{isAr ? 'تنبيه التغطية الجزئية' : 'Partial Package Coverage'}</p>
                          <p className="text-sm text-yellow-700">
                            {isAr
                              ? `حزمة العميل تغطي ${pkgCheck.remaining} حجز. سيتم دفع ${paidQty} حجز بشكل طبيعي.`
                              : `Customer's package covers ${pkgCheck.remaining} booking${pkgCheck.remaining !== 1 ? 's' : ''}. The remaining ${paidQty} booking${paidQty !== 1 ? 's will' : ' will'} be charged normally.`}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (pkgCheck.remaining === 0 && createCustomerPackages.length > 0) {
                  return (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-300 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-blue-800 mb-1">{isAr ? 'تنبيه الحزمة' : 'Package Notice'}</p>
                          <p className="text-sm text-blue-700">{isAr ? 'حزمة العميل لهذه الخدمة مستخدمة بالكامل. سيتم دفع هذا الحجز بشكل طبيعي.' : "Customer's package for this service is fully used. This booking will be charged normally."}</p>
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
          {createServiceId && createForm.visitor_count && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('booking.notes')}</label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
                value={createForm.notes}
                onChange={(e) => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                placeholder={t('booking.notes')}
              />
            </div>
          )}
          {/* 7. Select Date */}
          {createServiceId && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">{t('booking.selectDate')} *</label>
                <button
                  type="button"
                  onClick={() => setCreateShowFullCalendar(!createShowFullCalendar)}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <CalendarDays className="w-4 h-4" />
                  {createShowFullCalendar ? t('reception.hideCalendar') : t('reception.showFullCalendar')}
                </button>
              </div>
              {!createShowFullCalendar ? (
                <div className="grid grid-cols-4 gap-2">
                  {getNext8Days().map((day) => {
                    const isToday = isSameDay(day, new Date());
                    const dayStr = format(day, 'yyyy-MM-dd');
                    return (
                      <button
                        key={dayStr}
                        type="button"
                        onClick={() => setCreateDate(dayStr)}
                        className={`p-2 text-center rounded-lg border ${createDate === dayStr ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'} ${isToday ? 'ring-2 ring-blue-300' : ''}`}
                      >
                        <div className="text-xs font-medium">{isToday ? t('dashboard.today') : format(day, 'EEE', { locale: isAr ? ar : undefined })}</div>
                        <div className="text-lg font-bold">{format(day, 'd')}</div>
                        <div className="text-xs text-gray-500">{format(day, 'MMM', { locale: isAr ? ar : undefined })}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="border border-gray-300 rounded-lg p-4">
                  <input
                    type="date"
                    value={createDate}
                    onChange={(e) => setCreateDate(e.target.value)}
                    min={format(new Date(), 'yyyy-MM-dd')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}
            </div>
          )}
          {/* 8. Employee-based: note, assignment mode (when both), employee dropdown (when manual) — same as Reception */}
          {createServiceId && createDate && isEmployeeBasedMode && (
            <>
              <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800">{t('reception.employeeModeSlotNote') || 'Times are from employee shifts. Service slot settings do not apply.'}</p>
              </div>
              {tenantAssignmentMode === 'both' && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('reception.assignmentMode') || 'Assignment'}</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateAssignmentMode('automatic')}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium ${effectiveCreateAssignmentMode === 'automatic' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    >
                      {t('reception.autoAssign') || 'Automatic'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateAssignmentMode('manual')}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium ${effectiveCreateAssignmentMode === 'manual' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    >
                      {t('reception.manualAssign') || 'Manual'}
                    </button>
                  </div>
                </div>
              )}
              {effectiveCreateAssignmentMode === 'manual' && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('reception.selectEmployee')} *</label>
                  <select
                    value={createSelectedEmployeeId}
                    onChange={(e) => { setCreateSelectedEmployeeId(e.target.value); setCreateSlotId(''); setCreateSelectedSlots([]); }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required={effectiveCreateAssignmentMode === 'manual'}
                  >
                    <option value="">{t('reception.chooseEmployee') || 'Choose employee'}</option>
                    {(() => {
                      const empMap = new Map<string, { id: string; name: string; name_ar: string }>();
                      createSlots.forEach(slot => {
                        if (slot.employee_id && !empMap.has(slot.employee_id)) {
                          const u = (slot as any).users;
                          empMap.set(slot.employee_id, {
                            id: slot.employee_id,
                            name: u?.full_name ?? '',
                            name_ar: u?.full_name_ar ?? '',
                          });
                        }
                      });
                      return Array.from(empMap.values()).map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {isAr ? (emp.name_ar || emp.name) : emp.name}
                        </option>
                      ));
                    })()}
                  </select>
                </div>
              )}
            </>
          )}
          {/* 9. Available Slots — same as Reception: group by time, click to add/remove, validation; in employee manual mode filter by selected employee */}
          {createServiceId && createDate && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('reception.availableSlots')} *</label>
              {(() => {
                const required = getRequiredSlotsCount();
                if (required <= 1 && createSelectedSlots.length === 0 && !createSlotId) return null;
                const validation = validateSlotSelection();
                const isComplete = (createSelectedSlots.length >= required || (required === 1 && createSlotId)) && (createSelectedSlots.length > 0 ? validation.valid : true);
                const isPartial = (createSelectedSlots.length > 0 || createSlotId) && !isComplete;
                return (
                  <div className={`mb-2 p-3 rounded-lg border ${isComplete ? 'bg-green-50 border-green-300' : isPartial ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-300'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${isComplete ? 'text-green-900' : isPartial ? 'text-yellow-900' : 'text-gray-900'}`}>
                        {isComplete ? '✓' : isPartial ? '⚠' : 'ℹ'} {t('reception.slotSelection', 'Slot Selection')}
                      </span>
                      {(createSelectedSlots.length > 0 || createSlotId) && (
                        <span className={`text-sm font-bold ${isComplete ? 'text-green-700' : 'text-yellow-700'}`}>
                          {createSelectedSlots.length > 0 ? createSelectedSlots.length : 1} / {required}
                        </span>
                      )}
                    </div>
                    {createSelectedSlots.length > 0 && <div className="text-xs text-gray-600">{validation.message}</div>}
                    <div className="text-xs mt-2 text-gray-600 italic">💡 {t('common.tip')}: {t('common.clickSlotMultiple')}</div>
                  </div>
                );
              })()}
              {loadingCreateSlots ? (
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
              ) : isEmployeeBasedMode && effectiveCreateAssignmentMode === 'manual' && !createSelectedEmployeeId ? (
                <div className="text-center py-6 bg-gray-50 rounded-lg border border-gray-200">
                  <User className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">{t('reception.selectEmployeeFirst') || 'Please select an employee above to see available times.'}</p>
                </div>
              ) : (() => {
                const displaySlots = isEmployeeBasedMode && effectiveCreateAssignmentMode === 'manual' && createSelectedEmployeeId
                  ? createSlots.filter(s => s.employee_id === createSelectedEmployeeId)
                  : createSlots;
                return displaySlots.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <Clock className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600">{t('reception.noSlotsAvailable')}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {(() => {
                      const timeMap = new Map<string, Slot[]>();
                      displaySlots.forEach(slot => {
                        const key = `${slot.slot_date}-${slot.start_time}-${slot.end_time}`;
                        if (!timeMap.has(key)) timeMap.set(key, []);
                        timeMap.get(key)!.push(slot);
                      });
                      const isManualSingleEmployee = isEmployeeBasedMode && effectiveCreateAssignmentMode === 'manual' && !!createSelectedEmployeeId;
                      const isAutoEmployeeBased = isEmployeeBasedMode && effectiveCreateAssignmentMode === 'automatic';
                      return Array.from(timeMap.entries()).map(([timeKey, grouped]) => {
                        const first = grouped[0];
                        let totalCap: number;
                        if (isManualSingleEmployee) {
                          totalCap = first.available_capacity;
                        } else if (isAutoEmployeeBased) {
                          const uniqueEmployeesWithCapacity = new Set(
                            grouped.filter(s => (s.available_capacity ?? 0) > 0).map(s => s.employee_id).filter(Boolean)
                          ).size;
                          totalCap = uniqueEmployeesWithCapacity > 0 ? uniqueEmployeesWithCapacity : grouped.reduce((sum, s) => sum + (s.available_capacity ?? 0), 0);
                        } else {
                          totalCap = grouped.reduce((sum, s) => sum + (s.available_capacity ?? 0), 0);
                        }
                        const slotToUse = (effectiveCreateAssignmentMode === 'automatic' && createNextEmployeeIdForRotation)
                          ? grouped.find(s => s.employee_id === createNextEmployeeIdForRotation) ?? first
                          : first;
                        const selCount = createSelectedSlots.filter(s => s.start_time === first.start_time && s.end_time === first.end_time).length;
                        const isSelSingle = createForm.visitor_count <= 1 && createSlotId && grouped.some(s => s.id === createSlotId);
                        const isSel = selCount > 0 || isSelSingle;
                        return (
                          <button
                            key={timeKey}
                            type="button"
                            onClick={(e) => {
                              if (createForm.visitor_count <= 1) {
                                setCreateSlotId(prev => (grouped.some(s => s.id === prev) && prev === slotToUse.id ? '' : slotToUse.id));
                                setCreateSelectedSlots([]);
                              } else {
                                handleCreateSlotClick(slotToUse, e);
                              }
                            }}
                            onContextMenu={(e) => { e.preventDefault(); if (createForm.visitor_count > 1) handleCreateSlotClick(slotToUse, { ...e, button: 2 } as React.MouseEvent); }}
                            className={`p-3 text-left rounded-lg border relative ${isSel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                          >
                            {createForm.visitor_count > 1 && selCount > 0 && (
                              <div className="absolute -top-2 -right-2 bg-blue-800 text-white text-xs min-w-[24px] h-6 rounded-full font-bold flex items-center justify-center px-1">{selCount}</div>
                            )}
                            <div className="flex items-center gap-2 mb-1">
                              <Clock className="w-4 h-4" />
                              <span className="font-medium">{formatTimeTo12Hour(first.start_time)} - {formatTimeTo12Hour(first.end_time)}</span>
                            </div>
                            <div className="text-xs">{t('reception.spotsLeftCount', { count: totalCap })}</div>
                          </button>
                        );
                      });
                    })()}
                  </div>
                );
              })()}
            </div>
          )}
          {/* Booking Option when quantity > 1 — same as Reception */}
          {createServiceId && createForm.visitor_count > 1 && createSelectedTimeSlot && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">{t('reception.bookingOption', 'Booking Option')} *</label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => setCreateForm(f => ({ ...f, booking_option: 'parallel' }))}
                  className={`p-3 text-left rounded-lg border ${createForm.booking_option === 'parallel' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`}
                >
                  <div className="font-medium">✓ Parallel - Multiple Employees</div>
                  <div className="text-sm text-gray-600">{t('reception.bookMultipleSameTime', 'Book multiple at same time with different employees')}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setCreateForm(f => ({ ...f, booking_option: 'consecutive' }))}
                  className={`p-3 text-left rounded-lg border ${createForm.booking_option === 'consecutive' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`}
                >
                  <div className="font-medium">→ Consecutive - Single Employee</div>
                  <div className="text-sm text-gray-600">{t('reception.bookConsecutiveSlots', 'Book consecutive time slots with one employee')}</div>
                </button>
              </div>
            </div>
          )}
          {/* Payment method (payable or package booking — Unpaid option for both) */}
          {(() => {
            if (!createServiceId || !createForm.visitor_count) return null;
            const svc = createServices.find(s => s.id === createServiceId);
            if (!svc) return null;
            return (
              <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('reception.paymentMethod') || 'Payment method'}</h4>
                <div className="flex flex-wrap gap-4 mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="createPaymentMethodForm"
                      checked={createPaymentMethod === 'unpaid'}
                      onChange={() => { setCreatePaymentMethod('unpaid'); setCreateTransactionReference(''); }}
                      className="rounded-full border-gray-300 text-blue-600"
                    />
                    <span>{t(PAYMENT_DISPLAY_KEYS.unpaid) || 'Unpaid'}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="createPaymentMethodForm"
                      checked={createPaymentMethod === 'onsite'}
                      onChange={() => setCreatePaymentMethod('onsite')}
                      className="rounded-full border-gray-300 text-blue-600"
                    />
                    <span>{t(PAYMENT_DISPLAY_KEYS.paid_onsite) || 'Paid On Site'}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="createPaymentMethodForm"
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
          <div className="flex gap-3 pt-4 border-t mt-6">
            <Button
              type="submit"
              fullWidth
              disabled={(() => {
                if (!createForm.customer_phone || !createForm.customer_name || !createServiceId || !createForm.visitor_count || !createDate) return true;
                if (createForm.visitor_count <= 1) return !createSlotId && createSelectedSlots.length === 0;
                const req = getRequiredSlotsCount();
                const val = validateSlotSelection();
                if (createSelectedSlots.length >= req && val.valid) return false;
                const single = createSlotId ? createSlots.find(s => s.id === createSlotId) : null;
                if (single && single.available_capacity >= createForm.visitor_count) return false;
                if (createForm.booking_option === 'parallel' && createSelectedTimeSlot && getParallelSlotsForQuantity(createSlots, createSelectedTimeSlot, req).length >= req) return false;
                if (createForm.booking_option === 'consecutive' && createSelectedSlots.length === 0 && getConsecutiveSlotsForQuantity(createSlots, req)) return false;
                return true;
              })()}
            >
              {t('reception.proceed', 'Proceed')}
            </Button>
            <Button type="button" variant="secondary" fullWidth onClick={() => { setIsCreateModalOpen(false); resetCreateForm(); }}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
        )}
      </Modal>

      {/* Booking Confirmation (Admin/Receptionist) — full-page-style modal after create */}
      <BookingConfirmationModal
        isOpen={!!confirmationBookingId}
        onClose={() => setConfirmationBookingId(null)}
        bookingId={confirmationBookingId}
        onBackToBookings={() => setConfirmationBookingId(null)}
        onCreateAnother={() => {
          setConfirmationBookingId(null);
          setIsCreateModalOpen(true);
        }}
        ticketsEnabled={tenant?.tickets_enabled !== false}
      />

      {/* Edit Booking Modal (details + change time in one place) */}
      {editingBooking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold mb-4">{t('billing.editBooking')}</h2>

              {/* Section 1: Booking details */}
              <div className="space-y-4 mb-6">
                <h3 className="text-sm font-semibold text-gray-700 border-b pb-1">{t('bookings.bookingDetails') || 'Booking details'}</h3>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.customerName')}</label>
                  <input
                    type="text"
                    value={editingBooking.customer_name}
                    onChange={(e) => setEditingBooking({ ...editingBooking, customer_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.email')}</label>
                  <input
                    type="email"
                    value={editingBooking.customer_email || ''}
                    onChange={(e) => setEditingBooking({ ...editingBooking, customer_email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.totalPrice')}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editingBooking.total_price}
                    onChange={(e) => setEditingBooking({ ...editingBooking, total_price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('billing.status')}</label>
                  <select
                    value={editingBooking.status}
                    onChange={(e) => setEditingBooking({ ...editingBooking, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="pending">{t('status.pending')}</option>
                    <option value="confirmed">{t('status.confirmed')}</option>
                    <option value="checked_in">{t('status.checked_in')}</option>
                    <option value="completed">{t('status.completed')}</option>
                    <option value="cancelled">{t('status.cancelled')}</option>
                  </select>
                </div>
              </div>

              {/* Section 2: Change time (optional) */}
              <div className="space-y-4 mb-6 pt-4 border-t">
                <h3 className="text-sm font-semibold text-gray-700 border-b pb-1">{t('bookings.changeTime')}</h3>
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-xs text-gray-600 mb-2">{t('bookings.currentTime')}</p>
                  <div className="text-sm text-gray-700 flex items-center gap-2 flex-wrap">
                    <Calendar className="w-4 h-4" />
                    <span>
                      {editingBooking.slots?.slot_date
                        ? format(parseISO(editingBooking.slots.slot_date), 'MMM dd, yyyy', { locale: isAr ? ar : undefined })
                        : 'N/A'}
                    </span>
                    <Clock className="w-4 h-4 ml-2" />
                    <span>
                      {editingBooking.slots?.start_time
                        ? `${formatTimeTo12Hour(editingBooking.slots.start_time)} - ${formatTimeTo12Hour(editingBooking.slots.end_time)}`
                        : 'N/A'}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('bookings.newDate')}</label>
                  <input
                    type="date"
                    value={format(editingTimeDate, 'yyyy-MM-dd')}
                    onChange={(e) => handleTimeDateChange(parseISO(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                {isEmployeeBasedMode && (tenantAssignmentMode === 'manual' || tenantAssignmentMode === 'both') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('reception.selectEmployee')} *</label>
                    <select
                      value={changeTimeEmployeeId}
                      onChange={(e) => { setChangeTimeEmployeeId(e.target.value); setSelectedNewSlotId(''); }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required={tenantAssignmentMode === 'manual'}
                    >
                      <option value="">{t('reception.chooseEmployee') || 'Choose employee'}</option>
                      {(() => {
                        const empMap = new Map<string, { id: string; name: string; name_ar: string }>();
                        availableTimeSlots.forEach(slot => {
                          if ((slot as any).employee_id && !empMap.has((slot as any).employee_id)) {
                            const u = (slot as any).users;
                            empMap.set((slot as any).employee_id, {
                              id: (slot as any).employee_id,
                              name: u?.full_name ?? '',
                              name_ar: u?.full_name_ar ?? '',
                            });
                          }
                        });
                        return Array.from(empMap.values()).map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {isAr ? (emp.name_ar || emp.name) : emp.name}
                          </option>
                        ));
                      })()}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">{t('bookings.availableTimeSlots')}</label>
                  {loadingTimeSlots ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 flex items-center justify-center gap-3 py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
                      <p className="text-sm text-gray-600">{t('bookings.loadingAvailableSlots')}</p>
                    </div>
                  ) : (() => {
                    const requireEmployeeFirst = isEmployeeBasedMode && (tenantAssignmentMode === 'manual' || tenantAssignmentMode === 'both');
                    const slotsToShow = changeTimeEmployeeId
                      ? availableTimeSlots.filter((s) => (s as any).employee_id === changeTimeEmployeeId)
                      : requireEmployeeFirst ? [] : availableTimeSlots;
                    if (requireEmployeeFirst && !changeTimeEmployeeId) {
                      return (
                        <p className="text-sm text-blue-800 p-4 bg-blue-50 rounded-lg border border-blue-200">
                          {t('bookings.selectEmployeeFirst') || 'Please select an employee above to see available time slots.'}
                        </p>
                      );
                    }
                    if (slotsToShow.length === 0) {
                      return (
                        <p className="text-sm text-yellow-800 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                          {changeTimeEmployeeId ? (t('bookings.noSlotsForSelectedEmployee') || 'No slots for selected employee on this date') : t('bookings.noAvailableTimeSlots')}
                        </p>
                      );
                    }
                    const timeMap = new Map<string, typeof slotsToShow>();
                    slotsToShow.forEach((s) => {
                      const key = `${s.start_time}-${s.end_time}`;
                      if (!timeMap.has(key)) timeMap.set(key, []);
                      timeMap.get(key)!.push(s);
                    });
                    const grouped = Array.from(timeMap.entries()).map(([timeKey, group]) => {
                      const first = group[0];
                      const totalCap = group.reduce((sum, s) => sum + s.available_capacity, 0);
                      return { timeKey, first, totalCap, slotIds: group.map((s) => s.id) };
                    });
                    return (
                      <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-2 border border-gray-200 rounded-md">
                        {grouped.map(({ timeKey, first, totalCap, slotIds }) => (
                          <button
                            key={timeKey}
                            type="button"
                            onClick={() => setSelectedNewSlotId(first.id)}
                            className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                              slotIds.includes(selectedNewSlotId) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="font-medium">{formatTimeTo12Hour(first.start_time)} - {formatTimeTo12Hour(first.end_time)}</div>
                            {isEmployeeBasedMode && (first as any).users && (
                              <div className="text-xs truncate">
                                {isAr ? (first as any).users?.full_name_ar || (first as any).users?.full_name : (first as any).users?.full_name || (first as any).users?.full_name_ar}
                              </div>
                            )}
                            <div className="text-xs opacity-75">{totalCap} {t('common.available') || 'Available'}</div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                {tenant?.tickets_enabled !== false && (
                  <p className="text-xs text-blue-800 p-3 bg-blue-50 rounded-lg border border-blue-200">{t('common.oldTicketsInvalidated')}</p>
                )}
              </div>

              <div className="flex gap-2 mt-6">
                <Button
                  onClick={handleSaveEditBooking}
                  disabled={updatingBookingTime}
                  className="flex-1"
                >
                  {updatingBookingTime ? safeTranslate(t, 'bookings.updating', 'Updating...') : t('billing.saveChanges')}
                </Button>
                <Button
                  onClick={() => {
                    setEditingBooking(null);
                    setSelectedNewSlotId('');
                    setChangeTimeEmployeeId('');
                    setAvailableTimeSlots([]);
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
    </div>
  );
}
