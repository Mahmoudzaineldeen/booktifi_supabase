/**
 * Booking details modal: customer info, order items, notes, payment log, and actions.
 * Used in Admin (BookingsPage) and Reception (ReceptionPage) with smooth open/close animation.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  User,
  Phone,
  Mail,
  CalendarDays,
  Clock,
  Package,
  MoreVertical,
  Edit,
  RotateCw,
  Trash2,
  DollarSign,
  FileText,
  Download,
  CheckCircle,
  XCircle,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar } from 'date-fns/locale';
import { getPaymentDisplayLabel, getPaymentDisplayValue } from '../../lib/paymentDisplay';
import { formatTimeTo12Hour, formatDateTimeTo12Hour } from '../../lib/timeFormat';
import { apiFetch } from '../../lib/apiClient';
import { Button } from '../ui/Button';

export interface BookingDetailsModalBooking {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  visitor_count: number;
  total_price: number;
  status: string;
  payment_status?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  created_at?: string;
  created_by_user_id?: string | null;
  zoho_invoice_id?: string | null;
  zoho_invoice_created_at?: string | null;
  daftra_invoice_id?: string | null;
  daftra_invoice_created_at?: string | null;
  service_id?: string;
  slot_id?: string;
  tag_id?: string | null;
  required_slot_count?: number | null;
  effective_start_time?: string | null;
  effective_end_time?: string | null;
  services?: { name: string; name_ar?: string | null };
  slots?: { slot_date: string; start_time: string; end_time: string };
  users?: { full_name: string; full_name_ar?: string | null } | null;
  employees?: Array<{ id?: string; full_name: string; full_name_ar?: string | null }>;
}

export interface BookingDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingDetailsModalBooking | null;
  formatPrice: (n: number) => string;
  /** Service provider / employee name(s) - optional, derived from booking.users/employees if not provided */
  serviceProviderName?: string;
  /** Hide edit/delete/change appointment for coordinator role */
  isCoordinator?: boolean;
  onEdit?: (booking: BookingDetailsModalBooking) => void;
  onDelete?: (bookingId: string) => void;
  onChangeAppointment?: (booking: BookingDetailsModalBooking) => void;
  onRepeatBooking?: (booking: BookingDetailsModalBooking) => void;
  onMarkPaid?: (bookingId: string) => void;
  onConfirm?: (bookingId: string) => void;
  onComplete?: (bookingId: string) => void;
  onCancelBooking?: (bookingId: string) => void;
  onUpdatePaymentStatus?: (bookingId: string, value: 'unpaid' | 'paid_onsite' | 'bank_transfer') => void;
  onDownloadInvoice?: (bookingId: string, invoiceId: string, provider: 'zoho' | 'daftra') => void;
  /** When true, show payment dropdown in modal; when false, only show "Mark as paid" button */
  showPaymentDropdown?: boolean;
  downloadingInvoice?: string | null;
  updatingPayment?: string | null;
}

function getEmployeeDisplayName(booking: BookingDetailsModalBooking, isAr: boolean): string {
  const b = booking as any;
  if (b?.employees?.length) {
    return b.employees.map((e: any) => (isAr ? (e.full_name_ar || e.full_name) : e.full_name)).join(', ');
  }
  if (b?.users && typeof b.users === 'object') {
    const u = b.users;
    return isAr ? (u.full_name_ar || u.full_name) : u.full_name;
  }
  return '—';
}

export function BookingDetailsModal({
  isOpen,
  onClose,
  booking,
  formatPrice,
  serviceProviderName,
  isCoordinator = false,
  onEdit,
  onDelete,
  onChangeAppointment,
  onRepeatBooking,
  onMarkPaid,
  onConfirm,
  onComplete,
  onCancelBooking,
  onUpdatePaymentStatus,
  onDownloadInvoice,
  showPaymentDropdown = false,
  downloadingInvoice,
  updatingPayment,
}: BookingDetailsModalProps) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? false;
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagSlotCount, setTagSlotCount] = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityEntries, setActivityEntries] = useState<
    Array<{ id: string; title: string; details: string; actor: string; created_at: string }>
  >([]);
  const [mounted, setMounted] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousBookingRef = useRef<BookingDetailsModalBooking | null>(null);

  const visible = isOpen || isExiting;
  const displayBooking = isOpen ? booking : previousBookingRef.current;

  useEffect(() => {
    if (isOpen) {
      previousBookingRef.current = booking;
      setIsExiting(false);
      const raf = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [isOpen, booking]);

  useEffect(() => {
    let cancelled = false;
    if (!isOpen || !displayBooking?.tag_id) {
      setTagSlotCount(1);
      return;
    }
    (async () => {
      try {
        const response = await apiFetch('/query', {
          method: 'POST',
          body: JSON.stringify({
            table: 'tag_fees',
            select: 'slot_count',
            where: { tag_id: displayBooking.tag_id },
            limit: 1,
          }),
        });
        if (!response.ok) {
          if (!cancelled) setTagSlotCount(1);
          return;
        }
        const payload = await response.json().catch(() => []);
        const row = Array.isArray(payload?.value)
          ? payload.value[0]
          : Array.isArray(payload)
            ? payload[0]
            : null;
        const parsed = Number(row?.slot_count);
        if (!cancelled) setTagSlotCount(Number.isFinite(parsed) && parsed >= 1 ? Math.ceil(parsed) : 1);
      } catch {
        if (!cancelled) setTagSlotCount(1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, displayBooking?.tag_id]);

  useEffect(() => {
    let cancelled = false;
    if (!isOpen || !displayBooking?.id) {
      setActivityEntries([]);
      setActivityLoading(false);
      return;
    }

    const readablePaymentStatus = (value: unknown, paymentMethod?: unknown): string => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return '—';
      if (normalized === 'unpaid' || normalized === 'awaiting_payment' || normalized === 'refunded') {
        return t('payment.displayUnpaid', 'Unpaid');
      }
      if (normalized === 'paid_manual') {
        const method = String(paymentMethod || '').trim().toLowerCase();
        if (method === 'transfer') return t('payment.displayBankTransfer', 'Bank transfer');
        return t('payment.displayPaidOnSite', 'Paid on site');
      }
      if (normalized === 'paid') return t('payment.displayPaid', 'Paid');
      return normalized.replace(/_/g, ' ');
    };

    const readableStatus = (value: unknown): string => {
      const normalized = String(value || '').trim();
      if (!normalized) return '—';
      return t(`status.${normalized}`, normalized.replace(/_/g, ' '));
    };

    const humanizeFieldValue = (key: string, value: unknown, valuesObj?: Record<string, unknown>): string => {
      if (value == null || value === '') return '—';
      if (key === 'status') return readableStatus(value);
      if (key === 'payment_status') {
        return readablePaymentStatus(value, valuesObj?.payment_method);
      }
      if (key === 'payment_method') {
        const normalized = String(value).toLowerCase();
        if (normalized === 'transfer') return t('payment.displayBankTransfer', 'Bank transfer');
        if (normalized === 'onsite') return t('payment.displayPaidOnSite', 'Paid on site');
        return String(value).replace(/_/g, ' ');
      }
      if (typeof value === 'number') return String(value);
      if (typeof value === 'boolean') return value ? t('common.yes', 'Yes') : t('common.no', 'No');
      return String(value);
    };

    const fieldLabel = (key: string): string => {
      const labels: Record<string, string> = {
        status: t('booking.status', 'Status'),
        payment_status: t('booking.paymentStatus', 'Payment status'),
        payment_method: t('bookings.paymentMethod', 'Payment method'),
        transaction_reference: t('bookings.transactionReferenceNumberLabel', 'Transaction reference'),
        visitor_count: t('booking.visitorCount', 'Quantity'),
        total_price: t('booking.totalPrice', 'Total price'),
        notes: t('booking.notes', 'Notes'),
        customer_name: t('booking.customerName', 'Customer name'),
        customer_phone: t('booking.customerPhone', 'Customer phone'),
        customer_email: t('booking.customerEmail', 'Customer email'),
        slot_id: t('bookings.changeAppointment', 'Appointment'),
        service_id: t('booking.selectService', 'Service'),
        tag_id: t('tags.title', 'Pricing tag'),
      };
      return labels[key] || key.replace(/_/g, ' ');
    };

    const buildChangeSummary = (oldValuesRaw: unknown, newValuesRaw: unknown): string => {
      const oldValues = (oldValuesRaw && typeof oldValuesRaw === 'object') ? (oldValuesRaw as Record<string, unknown>) : {};
      const newValues = (newValuesRaw && typeof newValuesRaw === 'object') ? (newValuesRaw as Record<string, unknown>) : {};
      const ignoreKeys = new Set([
        'updated_at',
        'status_changed_at',
        'zoho_sync_status',
        'invoice_processing_status',
        'invoice_last_error',
      ]);
      const keys = Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)]))
        .filter((k) => !ignoreKeys.has(k));

      const changes: string[] = [];
      for (const key of keys) {
        const prev = oldValues[key];
        const next = newValues[key];
        if (JSON.stringify(prev) === JSON.stringify(next)) continue;
        const label = fieldLabel(key);
        const prevText = humanizeFieldValue(key, prev, oldValues);
        const nextText = humanizeFieldValue(key, next, newValues);
        if ((prev == null || prev === '') && (next != null && next !== '')) {
          changes.push(`${label}: ${nextText}`);
        } else if ((next == null || next === '') && (prev != null && prev !== '')) {
          changes.push(`${label}: ${t('common.removed', 'removed')}`);
        } else {
          changes.push(`${label}: ${prevText} -> ${nextText}`);
        }
      }
      if (changes.length === 0) return t('bookings.detailsUpdated', 'Booking details were updated.');
      const maxShown = 3;
      const visible = changes.slice(0, maxShown);
      const remaining = changes.length - visible.length;
      return remaining > 0
        ? `${visible.join(' | ')} +${remaining} ${isAr ? 'تعديلات إضافية' : 'more changes'}`
        : visible.join(' | ');
    };

    (async () => {
      setActivityLoading(true);
      try {
        const logsResponse = await apiFetch('/query', {
          method: 'POST',
          body: JSON.stringify({
            table: 'audit_logs',
            select: 'id,user_id,action_type,old_values,new_values,created_at',
            where: {
              resource_type: 'booking',
              resource_id: displayBooking.id,
            },
            orderBy: { column: 'created_at', ascending: false },
            limit: 30,
          }),
        });

        const logsPayload = logsResponse.ok ? await logsResponse.json().catch(() => []) : [];
        const logs = Array.isArray(logsPayload) ? logsPayload : (Array.isArray(logsPayload?.value) ? logsPayload.value : []);

        const userIds = new Set<string>();
        if (displayBooking.created_by_user_id) userIds.add(String(displayBooking.created_by_user_id));
        for (const log of logs) {
          if (log?.user_id) userIds.add(String(log.user_id));
        }

        let userMap = new Map<string, { full_name?: string; full_name_ar?: string }>();
        if (userIds.size > 0) {
          const usersResponse = await apiFetch('/query', {
            method: 'POST',
            body: JSON.stringify({
              table: 'users',
              select: 'id,full_name,full_name_ar',
              where: { id__in: Array.from(userIds) },
              limit: Math.max(10, userIds.size + 2),
            }),
          });
          const usersPayload = usersResponse.ok ? await usersResponse.json().catch(() => []) : [];
          const users = Array.isArray(usersPayload) ? usersPayload : (Array.isArray(usersPayload?.value) ? usersPayload.value : []);
          userMap = new Map(
            users
              .filter((u: any) => u?.id)
              .map((u: any) => [String(u.id), { full_name: u.full_name, full_name_ar: u.full_name_ar }])
          );
        }

        const actorNameForId = (userId?: string | null): string => {
          if (!userId) return t('bookings.unknownStaff', 'Unknown staff');
          const user = userMap.get(String(userId));
          if (!user) return t('bookings.unknownStaff', 'Unknown staff');
          return isAr ? (user.full_name_ar || user.full_name || t('bookings.unknownStaff', 'Unknown staff')) : (user.full_name || user.full_name_ar || t('bookings.unknownStaff', 'Unknown staff'));
        };

        const entries: Array<{ id: string; title: string; details: string; actor: string; created_at: string }> = [];

        if (displayBooking.created_at) {
          entries.push({
            id: `created-${displayBooking.id}`,
            title: t('bookings.activityCreatedTitle', 'Booking created'),
            details: t('bookings.activityCreatedDetails', 'Booking was created.'),
            actor: actorNameForId(displayBooking.created_by_user_id || null),
            created_at: displayBooking.created_at,
          });
        }

        for (const log of logs) {
          const actionType = String(log?.action_type || '').toLowerCase();
          const oldValues = (log?.old_values && typeof log.old_values === 'object') ? log.old_values : {};
          const newValues = (log?.new_values && typeof log.new_values === 'object') ? log.new_values : {};
          const newStatus = String((newValues as Record<string, unknown>)?.status || '').toLowerCase();
          const wasCancelled = actionType === 'delete' || newStatus === 'cancelled';

          let title = t('bookings.activityEditedTitle', 'Booking updated');
          if (actionType === 'payment_status_update') title = t('bookings.activityPaymentTitle', 'Payment updated');
          if (wasCancelled) title = t('bookings.activityCancelledTitle', 'Booking cancelled');

          entries.push({
            id: String(log?.id || `${actionType}-${log?.created_at || Math.random()}`),
            title,
            details: buildChangeSummary(oldValues, newValues),
            actor: actorNameForId(log?.user_id || null),
            created_at: String(log?.created_at || new Date().toISOString()),
          });
        }

        entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        if (!cancelled) setActivityEntries(entries);
      } catch {
        if (!cancelled) setActivityEntries([]);
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, displayBooking?.id, displayBooking?.created_at, displayBooking?.created_by_user_id, isAr, t]);

  useEffect(() => {
    if (!isOpen && previousBookingRef.current) {
      setIsExiting(true);
      setMounted(false);
      exitTimeoutRef.current = setTimeout(() => {
        setIsExiting(false);
        previousBookingRef.current = null;
        exitTimeoutRef.current = null;
      }, 280);
      return () => {
        if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isExiting) {
        setMenuOpen(false);
        handleRequestClose();
      }
    };
    if (visible) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible, isOpen, isExiting]);

  const handleRequestClose = useCallback(() => {
    if (exitTimeoutRef.current) return;
    previousBookingRef.current = booking;
    setIsExiting(true);
    setMounted(false);
    exitTimeoutRef.current = setTimeout(() => {
      setIsExiting(false);
      previousBookingRef.current = null;
      exitTimeoutRef.current = null;
      onClose();
    }, 280);
  }, [booking, onClose]);

  if (!visible) return null;

  const displayId = displayBooking?.id?.slice(0, 8)?.toUpperCase() || '—';
  const createdDate = displayBooking?.created_at
    ? formatDateTimeTo12Hour(displayBooking.created_at, { locale: isAr ? ar : undefined })
    : null;
  const serviceName = displayBooking?.services
    ? (isAr ? (displayBooking.services.name_ar || displayBooking.services.name) : displayBooking.services.name)
    : '—';
  const providerName = serviceProviderName ?? (displayBooking ? getEmployeeDisplayName(displayBooking, isAr) : '—');
  const slotDate = displayBooking?.slots?.slot_date;
  const addMinutesToTimeValue = (startTime: string, minutesToAdd: number): string => {
    const [h, m] = (startTime || '00:00:00').slice(0, 8).split(':').map(Number);
    const base = (Number(h) || 0) * 60 + (Number(m) || 0);
    const total = (base + Math.max(0, Math.round(minutesToAdd))) % (24 * 60);
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  };
  const displayStartTime = displayBooking?.effective_start_time || displayBooking?.slots?.start_time || '';
  const displayEndTime =
    displayBooking?.effective_end_time ||
    (() => {
      const start = displayBooking?.slots?.start_time;
      const end = displayBooking?.slots?.end_time;
      const requiredSlots = Math.max(1, Math.ceil(Number(displayBooking?.required_slot_count ?? tagSlotCount ?? 1)));
      if (!start || !end || requiredSlots <= 1) return end || '';
      const startM = (Number(start.slice(0, 2)) || 0) * 60 + (Number(start.slice(3, 5)) || 0);
      let endM = (Number(end.slice(0, 2)) || 0) * 60 + (Number(end.slice(3, 5)) || 0);
      if (endM <= startM) endM += 24 * 60;
      const slotDuration = Math.max(1, endM - startM);
      return addMinutesToTimeValue(start, slotDuration * requiredSlots);
    })();
  const slotTime =
    displayStartTime && displayEndTime
      ? `${formatTimeTo12Hour(displayStartTime)} - ${formatTimeTo12Hour(displayEndTime)}`
      : '—';
  const slotDateFormatted =
    slotDate && slotTime !== '—'
      ? `${format(parseISO(slotDate), 'dd/MM/yyyy', { locale: isAr ? ar : undefined })} | ${slotTime}`
      : '—';
  const paymentValue = displayBooking ? getPaymentDisplayValue(displayBooking) : 'unpaid';
  const paymentLabel = displayBooking ? getPaymentDisplayLabel(displayBooking, t) : t('payment.displayUnpaid', 'Unpaid');

  const statusClass =
    displayBooking?.status === 'confirmed'
      ? 'bg-green-100 text-green-800'
      : displayBooking?.status === 'pending'
        ? 'bg-yellow-100 text-yellow-800'
        : displayBooking?.status === 'cancelled'
          ? 'bg-red-100 text-red-800'
          : displayBooking?.status === 'completed'
            ? 'bg-blue-100 text-blue-800'
            : 'bg-gray-100 text-gray-800';

  const paymentClass =
    paymentValue === 'unpaid'
      ? 'bg-red-100 text-red-800'
      : paymentValue === 'bank_transfer'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-emerald-100 text-emerald-800';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      dir={isAr ? 'rtl' : 'ltr'}
      aria-modal
      role="dialog"
    >
      {/* Backdrop with transition */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-[280ms] ease-out"
        style={{ opacity: mounted ? 1 : 0 }}
        onClick={() => {
          setMenuOpen(false);
          handleRequestClose();
        }}
      />

      {/* Panel with scale + opacity */}
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 transition-all duration-[280ms] ease-out"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'scale(1)' : 'scale(0.96)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!displayBooking ? (
          <div className="p-12 text-center text-gray-500 text-sm">{t('bookings.noBookingDetails', 'No booking details')}</div>
        ) : (
          <>
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-100 px-6 py-5">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-gray-200/80">
                  <Package className="h-5 w-5 text-slate-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-gray-900">
                    {t('bookings.orderId', 'Order')} <span className="text-slate-600 font-mono">#{displayBooking.id?.slice(0, 8)?.toUpperCase() || '—'}</span>
                  </h2>
                  {createdDate && (
                    <p className="mt-0.5 text-sm text-gray-500 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {createdDate}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  handleRequestClose();
                }}
                className="rounded-xl p-2.5 text-gray-400 hover:bg-white hover:text-gray-700 hover:shadow-sm transition-all duration-200"
                aria-label={t('common.close', 'Close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Customer details card */}
              <section className="rounded-xl border border-gray-100 bg-gray-50/50 p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
                  {t('bookings.customerDetails', 'Customer details')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-gray-100">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
                      ID
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">{t('bookings.customerId', 'ID')}</p>
                      <p className="font-medium text-gray-900 truncate">{displayId}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-gray-100">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                      <User className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">{t('billing.customerName', 'Name')}</p>
                      <p className="font-medium text-gray-900 truncate">{displayBooking.customer_name || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-gray-100">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                      <Phone className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">{t('reception.phoneNumber', 'Phone')}</p>
                      <p className="font-medium text-gray-900 truncate">{displayBooking.customer_phone || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-gray-100">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                      <Mail className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">{t('billing.email', 'Email')}</p>
                      <p className="font-medium text-gray-900 truncate">{displayBooking.customer_email || '—'}</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Order items card */}
              <section className="rounded-xl border border-gray-100 overflow-hidden bg-white shadow-sm ring-1 ring-gray-100">
                <div className="border-b border-gray-100 bg-gray-50/80 px-5 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {t('bookings.orderItems', 'Order items')}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50/50 text-gray-600">
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">{t('bookings.name', 'Name')}</th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">{t('bookings.serviceProvider', 'Service provider')}</th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">{t('booking.visitorCount', 'Qty')}</th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">{t('bookings.totalAfterDiscount', 'Total')}</th>
                        <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">{t('bookings.status', 'Status')}</th>
                        <th className="w-12 px-2 py-3.5" />
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="font-semibold text-gray-900">{serviceName}</div>
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {slotDateFormatted}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-gray-700">{providerName}</td>
                        <td className="px-5 py-4 text-gray-700">{(displayBooking as any).groupCount ?? displayBooking.visitor_count}</td>
                        <td className="px-5 py-4 font-semibold text-gray-900">
                          {formatPrice((displayBooking as any).grouped_total_price ?? displayBooking.total_price)}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${statusClass}`}>
                            {t(`status.${displayBooking.status}`, displayBooking.status)}
                            <ChevronDown className="h-3 w-3 opacity-70" />
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          {!isCoordinator && (onEdit || onChangeAppointment || onRepeatBooking || onCancelBooking) && (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setMenuOpen((v) => !v)}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                                aria-label={t('common.more', 'More')}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                              {menuOpen && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setMenuOpen(false)}
                                    aria-hidden
                                  />
                                  <div className="absolute right-0 top-full mt-1 z-20 min-w-[200px] rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl ring-1 ring-black/5">
                                    {onChangeAppointment && displayBooking.status !== 'cancelled' && displayBooking.status !== 'completed' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMenuOpen(false);
                                          onChangeAppointment(displayBooking);
                                        }}
                                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                      >
                                        <Edit className="h-4 w-4 text-gray-400" />
                                        {t('bookings.changeAppointment', 'Change appointment')}
                                      </button>
                                    )}
                                    {onRepeatBooking && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMenuOpen(false);
                                          onRepeatBooking(displayBooking);
                                        }}
                                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                      >
                                        <RotateCw className="h-4 w-4 text-gray-400" />
                                        {t('bookings.repeatBooking', 'Repeat booking')}
                                      </button>
                                    )}
                                    {onEdit && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMenuOpen(false);
                                          onEdit(displayBooking);
                                        }}
                                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                      >
                                        <Edit className="h-4 w-4 text-gray-400" />
                                        {t('bookings.editItem', 'Edit item')}
                                      </button>
                                    )}
                                    {onCancelBooking && displayBooking.status !== 'cancelled' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMenuOpen(false);
                                          onCancelBooking(displayBooking.id);
                                        }}
                                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                                      >
                                        <XCircle className="h-4 w-4" />
                                        {t('bookings.cancelBooking', 'Cancel booking')}
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Booking notes */}
              {displayBooking.notes && (
                <section className="rounded-xl border border-amber-100 bg-amber-50/30 p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-800/80 mb-2">
                    {t('bookings.bookingNotes', 'Booking notes')}
                  </h3>
                  <p className="text-sm text-gray-700 leading-relaxed pl-1 border-l-2 border-amber-300">{displayBooking.notes}</p>
                </section>
              )}

              {/* Payment log card */}
              <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm ring-1 ring-gray-100">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
                  {t('bookings.paymentLog', 'Payment log')}
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium shadow-sm ${paymentClass}`}>
                    {paymentValue === 'unpaid' && <XCircle className="h-4 w-4" />}
                    {paymentValue !== 'unpaid' && <CheckCircle className="h-4 w-4" />}
                    {paymentLabel}
                  </span>
                  {showPaymentDropdown && onUpdatePaymentStatus && (
                    <select
                      value={paymentValue}
                      onChange={(e) => {
                        const v = e.target.value as 'unpaid' | 'paid_onsite' | 'bank_transfer';
                        onUpdatePaymentStatus(displayBooking.id, v);
                      }}
                      disabled={!!updatingPayment}
                      className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                    >
                      <option value="unpaid">{t('payment.displayUnpaid', 'Unpaid')}</option>
                      <option value="paid_onsite">{t('payment.displayPaidOnSite', 'Paid on site')}</option>
                      <option value="bank_transfer">{t('payment.displayBankTransfer', 'Bank transfer')}</option>
                    </select>
                  )}
                  {!showPaymentDropdown && paymentValue === 'unpaid' && onMarkPaid && !isCoordinator && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => onMarkPaid(displayBooking.id)}
                      disabled={!!updatingPayment}
                      icon={<Plus className="h-4 w-4" />}
                      className="rounded-xl"
                    >
                      {t('reception.markAsPaid', 'Mark as paid')}
                    </Button>
                  )}
                  {displayBooking.zoho_invoice_id && onDownloadInvoice && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDownloadInvoice(displayBooking.id, displayBooking.zoho_invoice_id!, 'zoho')}
                      disabled={downloadingInvoice === displayBooking.id}
                      icon={<Download className="h-4 w-4" />}
                      className="rounded-xl border border-gray-200 hover:bg-gray-50"
                    >
                      {downloadingInvoice === displayBooking.id ? t('common.downloading', 'Downloading...') : t('reception.downloadPdf', 'Download PDF')}
                    </Button>
                  )}
                  {displayBooking.daftra_invoice_id && onDownloadInvoice && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDownloadInvoice(displayBooking.id, displayBooking.daftra_invoice_id!, 'daftra')}
                      disabled={downloadingInvoice === displayBooking.id}
                      icon={<Download className="h-4 w-4" />}
                      className="rounded-xl border border-gray-200 hover:bg-gray-50"
                    >
                      {downloadingInvoice === displayBooking.id
                        ? t('common.downloading', 'Downloading...')
                        : t('reception.downloadDaftraPdf', 'Download PDF (Daftra)')}
                    </Button>
                  )}
                </div>
              </section>

              {/* Booking activity log (human-readable) */}
              <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm ring-1 ring-gray-100">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
                  {t('bookings.activityLog', 'Booking activity')}
                </h3>
                {activityLoading ? (
                  <p className="text-sm text-gray-500">{t('common.loading', 'Loading...')}</p>
                ) : activityEntries.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('bookings.noActivityYet', 'No activity recorded yet.')}</p>
                ) : (
                  <div className="space-y-3">
                    {activityEntries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900">{entry.title}</p>
                          <p className="text-xs text-gray-500">
                            {formatDateTimeTo12Hour(entry.created_at, { locale: isAr ? ar : undefined })}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-gray-600">
                          {t('bookings.activityBy', 'By')}: <span className="font-medium text-gray-700">{entry.actor}</span>
                        </p>
                        <p className="mt-1 text-sm text-gray-700 leading-relaxed">{entry.details}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
                {displayBooking.status === 'pending' && onConfirm && !isCoordinator && (
                  <Button variant="primary" size="sm" onClick={() => onConfirm(displayBooking.id)} icon={<CheckCircle className="h-4 w-4" />} className="rounded-xl">
                    {t('common.confirm')}
                  </Button>
                )}
                {displayBooking.status === 'confirmed' && onComplete && !isCoordinator && (
                  <Button variant="primary" size="sm" onClick={() => onComplete(displayBooking.id)} icon={<CheckCircle className="h-4 w-4" />} className="rounded-xl">
                    {t('bookings.markComplete', 'Mark complete')}
                  </Button>
                )}
                {onEdit && !isCoordinator && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onEdit(displayBooking)}
                    icon={<Edit className="h-4 w-4" />}
                    className="rounded-xl"
                  >
                    {t('reception.editBooking', 'Edit booking')}
                  </Button>
                )}
                {onDelete && !isCoordinator && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => onDelete(displayBooking.id)}
                    icon={<Trash2 className="h-4 w-4" />}
                    className="rounded-xl"
                  >
                    {t('common.delete')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleRequestClose} className="rounded-xl ms-auto">
                  {t('common.close', 'Close')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
