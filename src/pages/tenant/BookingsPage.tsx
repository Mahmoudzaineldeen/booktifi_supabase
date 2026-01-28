import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { safeTranslateStatus, safeTranslate } from '../../lib/safeTranslation';
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
import { Input } from '../../components/ui/Input';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { useTenantDefaultCountry } from '../../hooks/useTenantDefaultCountry';
import { countryCodes } from '../../lib/countryCodes';

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
  // ARCHIVED: users (employee) field removed
}

type SearchType = 'phone' | 'customer_name' | 'date' | 'service_name' | 'booking_id' | '';

export function BookingsPage() {
  const { t, i18n } = useTranslation();
  const { userProfile, tenant } = useAuth();
  const { formatPrice } = useCurrency();
  const tenantDefaultCountry = useTenantDefaultCountry();
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
  const [createOfferId, setCreateOfferId] = useState('');
  const [createShowFullCalendar, setCreateShowFullCalendar] = useState(false);
  const [isLookingUpCustomer, setIsLookingUpCustomer] = useState(false);
  const [createCustomerPackage, setCreateCustomerPackage] = useState<CustomerPackage | null>(null);
  const [createCountryCode, setCreateCountryCode] = useState(tenantDefaultCountry);
  const [createSelectedSlots, setCreateSelectedSlots] = useState<Array<{ slot_id: string; start_time: string; end_time: string; employee_id: string; slot_date: string }>>([]);
  const [createSelectedTimeSlot, setCreateSelectedTimeSlot] = useState<{ start_time: string; end_time: string; slot_date: string } | null>(null);
  const [createShowPreview, setCreateShowPreview] = useState(false);
  const [createSelectedServices, setCreateSelectedServices] = useState<Array<{ service: AdminService; slot: Slot; employeeId: string }>>([]);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editingBookingTime, setEditingBookingTime] = useState<Booking | null>(null);
  const [editingTimeDate, setEditingTimeDate] = useState<Date>(new Date());
  const [availableTimeSlots, setAvailableTimeSlots] = useState<Slot[]>([]);
  const [loadingTimeSlots, setLoadingTimeSlots] = useState(false);
  const [selectedNewSlotId, setSelectedNewSlotId] = useState<string>('');
  const [updatingBookingTime, setUpdatingBookingTime] = useState(false);
  const [deletingBooking, setDeletingBooking] = useState<string | null>(null);
  const [updatingPaymentStatus, setUpdatingPaymentStatus] = useState<string | null>(null);
  const [zohoSyncStatus, setZohoSyncStatus] = useState<Record<string, { success: boolean; error?: string }>>({});
  
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
    }).then(({ slots }) => {
      if (!cancelled) {
        setCreateSlots(slots.filter(s => s.available_capacity > 0));
        setCreateSlotId('');
      }
    }).catch(() => {
      if (!cancelled) setCreateSlots([]);
    }).finally(() => {
      if (!cancelled) setLoadingCreateSlots(false);
    });
    return () => { cancelled = true; };
  }, [createServiceId, createDate, userProfile?.tenant_id]);

  useEffect(() => {
    setCreateSelectedSlots([]);
  }, [createServiceId, createDate, createForm.visitor_count, createForm.booking_option]);

  // Look up customer by phone and auto-fill name/email + package (same as reception)
  async function lookupCustomerByPhone(fullPhoneNumber: string) {
    if (!fullPhoneNumber || fullPhoneNumber.length < 8 || !userProfile?.tenant_id) return;
    setIsLookingUpCustomer(true);
    setCreateCustomerPackage(null);
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
        const { data: subscriptionData } = await db
          .from('package_subscriptions')
          .select('id, package_id, status, expires_at, service_packages(name, name_ar, total_price)')
          .eq('customer_id', customerData.id)
          .eq('status', 'active')
          .maybeSingle();
        if (subscriptionData) {
          const isExpired = subscriptionData.expires_at && new Date(subscriptionData.expires_at) < new Date();
          if (!isExpired) {
            const { data: usageData } = await db
              .from('package_subscription_usage')
              .select('service_id, original_quantity, remaining_quantity, used_quantity, services(name, name_ar)')
              .eq('subscription_id', subscriptionData.id);
            setCreateCustomerPackage({ ...subscriptionData, usage: usageData || [] } as CustomerPackage);
          }
        }
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

  function checkServiceInPackage(serviceId: string): { available: boolean; remaining: number } {
    if (!createCustomerPackage) return { available: false, remaining: 0 };
    const usage = createCustomerPackage.usage.find(u => u.service_id === serviceId);
    if (!usage) return { available: false, remaining: 0 };
    return { available: usage.remaining_quantity > 0, remaining: usage.remaining_quantity };
  }

  function getRequiredSlotsCount(): number {
    if (createForm.visitor_count <= 1) return 1;
    if (createForm.booking_option === 'consecutive') return createForm.visitor_count;
    return 1;
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
        alert(t('reception.maxCapacityReached', { cap }) || `Maximum capacity reached. Available: ${cap}`);
        return;
      }
      if (sameCount === 0) {
        alert(t('reception.selectUpToSlots', { n: maxSlots }) || `You can select up to ${maxSlots} slot(s). Remove a slot first or click the same slot multiple times.`);
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
    setCreateCustomerPackage(null);
    setCreateCountryCode(tenantDefaultCountry);
    setCreateSelectedSlots([]);
    setCreateSelectedTimeSlot(null);
    setCreateShowPreview(false);
    setCreateSelectedServices([]);
  }

  function getNext8Days() {
    return Array.from({ length: 8 }, (_, i) => addDays(new Date(), i));
  }

  // Same backend as Reception: POST /bookings/create or create-bulk — slot checks, package resolution, invoice & ticket logic run server-side.
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
    if (createSelectedSlots.length > 0) {
      slotIds.push(...createSelectedSlots.map(s => s.slot_id));
    } else if (createSlotId) {
      slotIds.push(createSlotId);
    }
    if (slotIds.length === 0) return;

    setCreatingBooking(true);
    try {
      const session = await db.auth.getSession();
      const token = session.data.session?.access_token || localStorage.getItem('auth_token');
      const headers = { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) };

      if (slotIds.length === 1) {
        const slot = createSlots.find(s => s.id === slotIds[0]);
        const res = await fetch(`${getApiUrl()}/bookings/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tenant_id: userProfile.tenant_id,
            service_id: createServiceId,
            slot_id: slotIds[0],
            employee_id: slot?.employee_id || null,
            offer_id: createOfferId || null,
            customer_name: createForm.customer_name.trim(),
            customer_phone: fullPhone,
            customer_email: createForm.customer_email?.trim() || null,
            visitor_count: visitorCount,
            total_price: totalPrice,
            notes: createForm.notes?.trim() || null,
            language: i18n.language,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Failed to create booking');
        }
        alert(t('reception.bookingCreatedSuccess', 'Booking created successfully! Confirmation sent to customer.'));
      } else {
        const res = await fetch(`${getApiUrl()}/bookings/create-bulk`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tenant_id: userProfile.tenant_id,
            service_id: createServiceId,
            slot_ids: slotIds,
            customer_name: createForm.customer_name.trim(),
            customer_phone: fullPhone,
            customer_email: createForm.customer_email?.trim() || null,
            visitor_count: visitorCount,
            total_price: totalPrice,
            notes: createForm.notes?.trim() || null,
            language: i18n.language,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Failed to create booking');
        }
        alert(t('reception.bookingsCreatedSuccess', 'Bookings created successfully!'));
      }
      setIsCreateModalOpen(false);
      resetCreateForm();
      fetchBookings();
    } catch (err: any) {
      alert(err.message || t('reception.errorCreatingBooking', { message: err.message }));
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
          created_at,
          zoho_invoice_id,
          zoho_invoice_created_at,
          package_covered_quantity,
          package_subscription_id,
          service_id,
          slot_id,
          services:service_id (
            name,
            name_ar
          ),
          slots:slot_id (
            slot_date,
            start_time,
            end_time
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
          const slotDate = booking.slots?.slot_date;
          if (!slotDate) return false;
          return slotDate >= weekStartStr && slotDate <= weekEndStr;
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

  function getBookingsForDate(date: Date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    return displayBookings.filter(booking => {
      const bookingDate = booking.slots?.slot_date;
      return bookingDate === dateStr;
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
      alert(t('bookings.failedToDownloadInvoice', { message: errorMessage }));
      setDownloadingInvoice(null);
    }
  }

  async function updateBooking(bookingId: string, updateData: Partial<Booking>) {
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
      await fetchBookings(); // Refresh list
      setEditingBooking(null);
      
      alert(t('bookings.bookingUpdatedSuccessfully'));
    } catch (error: any) {
      console.error('Error updating booking:', error);
      alert(t('bookings.failedToUpdateBooking', { message: error.message }));
    }
  }

  async function deleteBooking(bookingId: string) {
    // Find the booking to check its payment status
    const booking = bookings.find(b => b.id === bookingId);
    const isPaid = booking?.payment_status === 'paid' || booking?.payment_status === 'paid_manual';

    // Show appropriate confirmation message based on payment status
    let confirmMessage: string;
    if (isPaid) {
      confirmMessage = t('bookings.confirmDeletePaid');
    } else {
      confirmMessage = t('bookings.confirmDelete');
    }

    if (!confirm(confirmMessage)) {
      return;
    }

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
      
      alert(t('bookings.bookingDeletedSuccessfully'));
    } catch (error: any) {
      console.error('Error deleting booking:', error);
      alert(t('bookings.failedToDeleteBooking', { message: error.message }));
      setDeletingBooking(null);
    }
  }

  async function updatePaymentStatus(bookingId: string, paymentStatus: string) {
    try {
      setUpdatingPaymentStatus(bookingId);
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/bookings/${bookingId}/payment-status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ payment_status: paymentStatus }),
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
      
      // Show sync status if available
      if (result.zoho_sync && !result.zoho_sync.success) {
        alert(t('bookings.paymentStatusUpdatedButZohoFailed', { error: result.zoho_sync.error }));
      } else {
        alert(t('bookings.paymentStatusUpdatedSuccessfully'));
      }
    } catch (error: any) {
      console.error('Error updating payment status:', error);
      alert(t('bookings.failedToUpdatePaymentStatus', { message: error.message }));
      setUpdatingPaymentStatus(null);
    }
  }

  async function handleEditTimeClick(booking: Booking) {
    console.log('[BookingsPage] ========================================');
    console.log('[BookingsPage] EDIT TIME CLICK - Booking details:');
    console.log('   Booking ID:', booking.id);
    console.log('   Customer:', booking.customer_name);
    console.log('   Service ID:', booking.service_id);
    console.log('   Service Name:', booking.services?.name);
    console.log('   Current slot date:', booking.slots?.slot_date);
    console.log('[BookingsPage] ========================================');
    
    if (!userProfile?.tenant_id || !booking.service_id) {
      alert(t('bookings.cannotEditBookingTime'));
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
      console.log('[BookingsPage] Edit time click - date set:', {
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
      alert(t('bookings.failedToFetchTimeSlots', { message: error.message }));
      setAvailableTimeSlots([]);
    } finally {
      setLoadingTimeSlots(false);
    }
  }

  async function handleTimeDateChange(newDate: Date) {
    setEditingTimeDate(newDate);
    setSelectedNewSlotId('');
    if (editingBookingTime && userProfile?.tenant_id) {
      // Pass date directly to avoid race condition
      await fetchTimeSlots(editingBookingTime.service_id, userProfile.tenant_id, newDate);
    }
  }

  async function updateBookingTime() {
    if (!editingBookingTime || !selectedNewSlotId || !userProfile?.tenant_id) {
      alert(safeTranslate(t, 'bookings.pleaseSelectNewTimeSlot', 'Please select a new time slot'));
      return;
    }

    if (!confirm(safeTranslate(t, 'bookings.confirmChangeBookingTime', 'Are you sure you want to change the booking time? Old tickets will be cancelled and new tickets will be created.'))) {
      return;
    }

    setUpdatingBookingTime(true);
    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/bookings/${editingBookingTime.id}/time`, {
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
      
      // Store booking ID for verification
      const updatedBookingId = editingBookingTime.id;
      
      // Store the selected slot ID before clearing state
      const newSlotIdToVerify = selectedNewSlotId;
      
      // If the backend returned the updated booking, use it directly
      let backendBookingData: any = null;
      if (result.booking && result.booking.slots) {
        backendBookingData = {
          slot_id: result.booking.slot_id,
          slots: result.booking.slots
        };
        console.log('[BookingsPage] ✅ Got updated booking from backend response:');
        console.log('[BookingsPage]   slot_id:', backendBookingData.slot_id);
        console.log('[BookingsPage]   slot_date:', backendBookingData.slots?.slot_date);
        console.log('[BookingsPage]   start_time:', backendBookingData.slots?.start_time);
        
        // Immediately update the state with backend data
        setBookings(prevBookings => 
          prevBookings.map(b => {
            if (b.id === updatedBookingId) {
              console.log('[BookingsPage] 🔄 Immediately updating booking state from backend response...');
              console.log('[BookingsPage]     Old slot_date:', b.slots?.slot_date);
              console.log('[BookingsPage]     New slot_date:', backendBookingData.slots?.slot_date);
              return { 
                ...b, 
                slot_id: backendBookingData.slot_id, 
                slots: backendBookingData.slots 
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
      
      alert(t('bookings.bookingTimeUpdatedSuccessfully'));
    } catch (error: any) {
      console.error('Error updating booking time:', error);
      alert(t('bookings.failedToUpdateBookingTime', { message: error.message }));
    } finally {
      setUpdatingBookingTime(false);
    }
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
        const phoneDigits = value.replace(/\D/g, '');
        if (phoneDigits.length < 5) {
          return { valid: false, error: t('reception.phoneMinLength') || 'Phone number must be at least 5 digits' };
        }
        break;
      case 'booking_id':
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(value.trim())) {
          return { valid: false, error: t('reception.invalidBookingId') || 'Invalid booking ID format' };
        }
        break;
      case 'customer_name':
        if (value.trim().length < 2) {
          return { valid: false, error: t('reception.nameMinLength') || 'Name must be at least 2 characters' };
        }
        break;
      case 'service_name':
        if (value.trim().length < 2) {
          return { valid: false, error: t('reception.serviceMinLength') || 'Service name must be at least 2 characters' };
        }
        break;
      case 'date':
        if (!value) {
          return { valid: false, error: t('reception.selectDate') || 'Please select a date' };
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
        created_at: b.created_at,
        zoho_invoice_id: b.zoho_invoice_id,
        zoho_invoice_created_at: b.zoho_invoice_created_at,
        service_id: b.service_id,
        slot_id: b.slot_id,
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
            List View
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
            title={showSearchResults ? 'Clear search to use calendar view' : ''}
          >
            <Calendar className="w-4 h-4 inline-block mr-2" />
            Calendar View
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
                  type="text"
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
                              `${format(new Date(booking.slots.slot_date), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined })} ${booking.slots.start_time}` :
                              format(new Date(booking.created_at), 'MMM dd, yyyy HH:mm', { locale: i18n.language === 'ar' ? ar : undefined })
                            }
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                        <span>{i18n.language === 'ar' ? booking.services?.name_ar : booking.services?.name}</span>
                        <span>•</span>
                        <span>{booking.visitor_count} {t('booking.visitorCount')}</span>
                        <span>•</span>
                        <span className="font-semibold">{booking.total_price} {t('service.price')}</span>
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
                            {booking.payment_status === 'paid' ? (
                              <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                                <CheckCircle className="w-3 h-3" />
                                {t('status.paid')}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                                <XCircle className="w-3 h-3" />
                                {t('status.unpaid')}
                              </span>
                            )}
                          </div>
                          {booking.zoho_invoice_created_at && (
                            <p className="text-xs text-blue-600 mb-3">
                              {t('billing.created')}{' '}
                              {format(new Date(booking.zoho_invoice_created_at), 'MMM dd, yyyy HH:mm', { locale: i18n.language === 'ar' ? ar : undefined })}
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
                        {/* Payment Status Dropdown */}
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-gray-500" />
                          <select
                            value={booking.payment_status || 'unpaid'}
                            onChange={(e) => updatePaymentStatus(booking.id, e.target.value)}
                            disabled={updatingPaymentStatus === booking.id}
                            className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="unpaid">{safeTranslate(t, 'bookings.unpaid', 'Unpaid')}</option>
                            <option value="awaiting_payment">{t('bookings.awaitingPaymentOption')}</option>
                            <option value="paid">{t('bookings.paid')}</option>
                            <option value="paid_manual">{t('bookings.paidManualOption')}</option>
                            <option value="refunded">{t('bookings.refundedOption')}</option>
                          </select>
                          {updatingPaymentStatus === booking.id && (
                            <span className="text-xs text-gray-500">{t('bookings.updating')}</span>
                          )}
                        </div>

                        {/* Zoho Sync Status */}
                        {zohoSyncStatus[booking.id] && (
                          <div className="flex items-center gap-1 text-xs">
                            {zohoSyncStatus[booking.id].success ? (
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
                          onClick={() => setEditingBooking(booking)}
                          variant="ghost"
                          size="sm"
                          className="flex items-center gap-1 text-sm"
                        >
                          <Edit className="w-4 h-4" />
                          {safeTranslate(t, 'bookings.edit', 'Edit')}
                        </Button>

                        {/* Change Time Button */}
                        <Button
                          onClick={() => handleEditTimeClick(booking)}
                          variant="ghost"
                          size="sm"
                          className="flex items-center gap-1 text-sm"
                        >
                          <Clock className="w-4 h-4" />
                          {safeTranslate(t, 'bookings.changeTime', 'Change Time')}
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
              {format(startOfWeek(calendarDate, { weekStartsOn: 0 }), 'MMM d', { locale: i18n.language === 'ar' ? ar : undefined })} - {format(addDays(startOfWeek(calendarDate, { weekStartsOn: 0 }), 6), 'MMM d, yyyy', { locale: i18n.language === 'ar' ? ar : undefined })}
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
                        {format(day, 'EEE', { locale: i18n.language === 'ar' ? ar : undefined })}
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
                                  {booking.slots?.start_time}
                                </div>
                                <div className="text-xs font-medium truncate">
                                  {booking.customer_name}
                                </div>
                                <div className="text-xs text-gray-600 truncate flex items-center gap-1">
                                  {i18n.language === 'ar' ? booking.services?.name_ar : booking.services?.name}
                                  {((booking.package_covered_quantity ?? 0) > 0 || booking.package_subscription_id) && (
                                    <span title={t('bookings.coveredByPackage', 'Covered by Package')}>
                                      <Package className="w-3 h-3 text-emerald-600 shrink-0" />
                                    </span>
                                  )}
                                </div>
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

      {/* Admin Create Booking Modal — same layout, field order, validation and preview as Receptionist (ReceptionPage) */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => { setIsCreateModalOpen(false); resetCreateForm(); }}
        title={createShowPreview ? t('reception.bookingPreview') : t('reception.createNewBooking', 'Create New Booking')}
        size="md"
      >
        {createShowPreview ? (
          <div className="space-y-6" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
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
                          <div className="font-medium text-gray-900">{i18n.language === 'ar' ? svc.name_ar : svc.name}</div>
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
                          <div className="text-sm font-medium text-gray-900">{format(parseISO(s.slot_date), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined })}</div>
                          <div className="text-xs text-gray-600">{s.start_time} - {s.end_time}</div>
                        </div>
                      </div>
                    ))
                  ) : createSlotId ? (() => {
                    const slot = createSlots.find(s => s.id === createSlotId);
                    return slot ? (
                      <div className="flex justify-between items-center py-2">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{format(parseISO(createDate), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined })}</div>
                          <div className="text-xs text-gray-600">{slot.start_time} - {slot.end_time}</div>
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
              <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-lg p-4 text-white">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">{t('reception.totalPrice')}</span>
                  <span className="text-2xl font-bold">
                    {(() => {
                      const svc = createServices.find(s => s.id === createServiceId);
                      if (!svc) return formatPrice(0);
                      const pkgCheck = checkServiceInPackage(svc.id);
                      if (pkgCheck.available && pkgCheck.remaining >= createForm.visitor_count) return t('reception.packageServiceTotal', { price: formatPrice(0) });
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
          {/* 1. Customer Phone */}
          <div className="relative">
            <PhoneInput
              label={t('booking.customerPhone')}
              value={createCustomerPhoneFull}
              onChange={(value) => {
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
            {isLookingUpCustomer && (
              <div className="absolute right-3 top-[38px]">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
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
          />
          {/* 3. Customer Email */}
          <Input
            label={t('booking.customerEmail')}
            type="email"
            value={createForm.customer_email}
            onChange={(e) => setCreateForm(f => ({ ...f, customer_email: e.target.value }))}
            placeholder={t('booking.customerEmail')}
          />
          {/* Package Information Display — same as Reception */}
          {createCustomerPackage && (
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Package className="w-5 h-5 text-green-600" />
                <h4 className="font-semibold text-green-900">
                  {t('packages.activePackage')}: {i18n.language === 'ar' ? createCustomerPackage.service_packages.name_ar : createCustomerPackage.service_packages.name}
                </h4>
              </div>
              <div className="space-y-2 text-sm">
                {createCustomerPackage.usage.map((usage) => (
                  <div key={usage.service_id} className="flex justify-between items-center py-1">
                    <span className={usage.remaining_quantity === 0 ? 'text-gray-400 line-through' : 'text-gray-700'}>
                      {i18n.language === 'ar' ? usage.services?.name_ar : usage.services?.name}
                    </span>
                    <span className={`font-medium ${usage.remaining_quantity > 5 ? 'text-green-600' : usage.remaining_quantity > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                      {usage.remaining_quantity} / {usage.original_quantity} {t('packages.remaining')}
                    </span>
                  </div>
                ))}
              </div>
              {createCustomerPackage.expires_at && (
                <p className="text-xs text-gray-600 mt-2">{t('packages.expiresOn')}: {new Date(createCustomerPackage.expires_at).toLocaleDateString()}</p>
              )}
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
              <option value="">{createServices.length === 0 && !loadingCreateSlots ? t('reception.noServicesAvailable') : t('reception.chooseService')}</option>
              {createServices.map((s) => {
                const pkgCheck = checkServiceInPackage(s.id);
                return (
                  <option key={s.id} value={s.id}>
                    {i18n.language === 'ar' ? s.name_ar : s.name} - {formatPrice(s.base_price)}
                    {pkgCheck.available && ` 🎁 (${pkgCheck.remaining} ${t('packages.remaining')})`}
                  </option>
                );
              })}
            </select>
            {createServices.length === 0 && !loadingCreateSlots && (
              <p className="mt-1 text-sm text-amber-600">⚠️ {t('reception.noServicesFound')}</p>
            )}
          </div>
          {/* 4b. Select Offer (if service has offers) */}
          {createServiceId && createServices.find(s => s.id === createServiceId)?.offers?.length ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{i18n.language === 'ar' ? 'اختر العرض (اختياري)' : 'Select Offer (Optional)'}</label>
              <select
                value={createOfferId}
                onChange={(e) => setCreateOfferId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">{t('reception.basePrice')} ({formatPrice(createServices.find(s => s.id === createServiceId)?.base_price ?? 0)})</option>
                {createServices.find(s => s.id === createServiceId)!.offers!.map((o) => (
                  <option key={o.id} value={o.id}>{i18n.language === 'ar' ? o.name_ar : o.name} - {formatPrice(o.price)}</option>
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
                {formatPrice(createServices.find(s => s.id === createServiceId)?.base_price ?? 0)} per ticket
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
                          <p className="text-sm font-semibold text-yellow-800 mb-1">{i18n.language === 'ar' ? 'تنبيه التغطية الجزئية' : 'Partial Package Coverage'}</p>
                          <p className="text-sm text-yellow-700">
                            {i18n.language === 'ar'
                              ? `حزمة العميل تغطي ${pkgCheck.remaining} حجز. سيتم دفع ${paidQty} حجز بشكل طبيعي.`
                              : `Customer's package covers ${pkgCheck.remaining} booking${pkgCheck.remaining !== 1 ? 's' : ''}. The remaining ${paidQty} booking${paidQty !== 1 ? 's will' : ' will'} be charged normally.`}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (pkgCheck.remaining === 0 && createCustomerPackage) {
                  return (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-300 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-blue-800 mb-1">{i18n.language === 'ar' ? 'تنبيه الحزمة' : 'Package Notice'}</p>
                          <p className="text-sm text-blue-700">{i18n.language === 'ar' ? 'حزمة العميل لهذه الخدمة مستخدمة بالكامل. سيتم دفع هذا الحجز بشكل طبيعي.' : "Customer's package for this service is fully used. This booking will be charged normally."}</p>
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
                        <div className="text-xs font-medium">{isToday ? t('dashboard.today') : format(day, 'EEE', { locale: i18n.language === 'ar' ? ar : undefined })}</div>
                        <div className="text-lg font-bold">{format(day, 'd')}</div>
                        <div className="text-xs text-gray-500">{format(day, 'MMM', { locale: i18n.language === 'ar' ? ar : undefined })}</div>
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
          {/* 8. Available Slots — same as Reception: group by time, click to add/remove, validation */}
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
                <p className="text-sm text-gray-500 py-4">{t('common.loading')}</p>
              ) : createSlots.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                  <Clock className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">{t('reception.noSlotsAvailable')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {(() => {
                    const timeMap = new Map<string, Slot[]>();
                    createSlots.forEach(slot => {
                      const key = `${slot.slot_date}-${slot.start_time}-${slot.end_time}`;
                      if (!timeMap.has(key)) timeMap.set(key, []);
                      timeMap.get(key)!.push(slot);
                    });
                    return Array.from(timeMap.entries()).map(([timeKey, grouped]) => {
                      const first = grouped[0];
                      const totalCap = grouped.reduce((sum, s) => sum + s.available_capacity, 0);
                      const selCount = createSelectedSlots.filter(s => s.start_time === first.start_time && s.end_time === first.end_time).length;
                      const isSelSingle = createForm.visitor_count <= 1 && createSlotId && grouped.some(s => s.id === createSlotId);
                      const isSel = selCount > 0 || isSelSingle;
                      return (
                        <button
                          key={timeKey}
                          type="button"
                          onClick={(e) => {
                            if (createForm.visitor_count <= 1) {
                              setCreateSlotId(prev => (grouped.some(s => s.id === prev) && prev === first.id ? '' : first.id));
                              setCreateSelectedSlots([]);
                            } else {
                              handleCreateSlotClick(first, e);
                            }
                          }}
                          onContextMenu={(e) => { e.preventDefault(); if (createForm.visitor_count > 1) handleCreateSlotClick(first, { ...e, button: 2 } as React.MouseEvent); }}
                          className={`p-3 text-left rounded-lg border relative ${isSel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                        >
                          {createForm.visitor_count > 1 && selCount > 0 && (
                            <div className="absolute -top-2 -right-2 bg-blue-800 text-white text-xs min-w-[24px] h-6 rounded-full font-bold flex items-center justify-center px-1">{selCount}</div>
                          )}
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-4 h-4" />
                            <span className="font-medium">{first.start_time} - {first.end_time}</span>
                          </div>
                          <div className="text-xs">{totalCap} spots left</div>
                        </button>
                      );
                    });
                  })()}
                </div>
              )}
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

      {/* Edit Booking Modal */}
      {editingBooking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold mb-4">{t('billing.editBooking')}</h2>
              
              <div className="space-y-4">
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
                  <label className="block text-sm font-medium mb-1">{t('billing.visitorCount')}</label>
                  <input
                    type="number"
                    min="1"
                    value={editingBooking.visitor_count}
                    onChange={(e) => setEditingBooking({ ...editingBooking, visitor_count: parseInt(e.target.value) || 1 })}
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

              <div className="flex gap-2 mt-6">
                <Button
                  onClick={() => updateBooking(editingBooking.id, {
                    customer_name: editingBooking.customer_name,
                    customer_email: editingBooking.customer_email,
                    visitor_count: editingBooking.visitor_count,
                    total_price: editingBooking.total_price,
                    status: editingBooking.status,
                  })}
                  className="flex-1"
                >
                  {t('common.save')}
                </Button>
                <Button
                  onClick={() => setEditingBooking(null)}
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

      {/* Edit Booking Time Modal */}
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
                      <Calendar className="w-4 h-4" />
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
                          ? `${editingBookingTime.slots.start_time} - ${editingBookingTime.slots.end_time}`
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

                {/* Available Time Slots */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('bookings.availableTimeSlots')}
                  </label>
                  {loadingTimeSlots ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                      <p className="text-sm text-gray-600 mt-2">
                        {t('bookings.loadingAvailableSlots')}
                      </p>
                    </div>
                  ) : availableTimeSlots.length === 0 ? (
                    <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                      <p className="text-sm text-yellow-800">
                        {t('bookings.noAvailableTimeSlots')}
                      </p>
                      <p className="text-xs text-yellow-700 mt-2">
                        {t('bookings.makeSureShiftsAndSlotsExist')}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-2 border border-gray-200 rounded-md">
                      {availableTimeSlots.map((slot) => (
                        <button
                          key={slot.id}
                          onClick={() => setSelectedNewSlotId(slot.id)}
                          className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                            selectedNewSlotId === slot.id
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="font-medium">{slot.start_time}</div>
                          <div className="text-xs opacity-75">
                            {slot.available_capacity} {t('common.available')}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Warning Message - Only show if tickets are enabled */}
                {tenant?.tickets_enabled !== false && (
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-800">
                      {t('common.oldTicketsInvalidated')}
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
                    ? safeTranslate(t, 'bookings.updating', 'Updating...')
                    : safeTranslate(t, 'bookings.updateTime', 'Update Time')}
                </Button>
                <Button
                  onClick={() => {
                    setEditingBookingTime(null);
                    setSelectedNewSlotId('');
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
    </div>
  );
}
