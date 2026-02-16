/**
 * Booking Confirmation Modal — Admin & Receptionist
 * Shown after successfully creating a booking. Matches customer confirmation styling.
 * Fetches full booking details via GET /bookings/search?booking_id=...
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../../contexts/CurrencyContext';
import { db } from '../../lib/db';
import { getApiUrl } from '../../lib/apiUrl';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { CheckCircle, Calendar, Clock, User, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar } from 'date-fns/locale';
import { formatTimeTo12Hour } from '../../lib/timeFormat';

export interface BookingConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingId: string | null;
  onBackToBookings: () => void;
  onCreateAnother: () => void;
  /** When false, ticket-related message is hidden (tickets feature disabled) */
  ticketsEnabled?: boolean;
}

interface FetchedBooking {
  id: string;
  customer_name: string;
  customer_phone: string;
  visitor_count: number;
  total_price: number;
  services?: { name: string; name_ar?: string };
  slots?: { slot_date: string; start_time: string; end_time: string };
  /** Background invoice job: pending | processing | completed | failed */
  invoice_processing_status?: string | null;
  invoice_last_error?: string | null;
  zoho_invoice_id?: string | null;
}

export function BookingConfirmationModal({
  isOpen,
  onClose,
  bookingId,
  onBackToBookings,
  onCreateAnother,
  ticketsEnabled = true,
}: BookingConfirmationModalProps) {
  const { t, i18n } = useTranslation();
  const { formatPrice } = useCurrency();
  const [booking, setBooking] = useState<FetchedBooking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !bookingId) {
      setBooking(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const API_URL = getApiUrl();
        const session = await db.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) {
          setError('Not authenticated');
          return;
        }
        const params = new URLSearchParams();
        params.append('booking_id', bookingId);
        params.append('limit', '1');
        const response = await fetch(`${API_URL}/bookings/search?${params.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load booking');
        }
        const result = await response.json();
        const list = result.bookings || [];
        if (cancelled) return;
        if (list.length > 0) {
          const b = list[0];
          setBooking({
            id: b.id,
            customer_name: b.customer_name,
            customer_phone: b.customer_phone,
            visitor_count: b.visitor_count ?? 1,
            total_price: b.total_price ?? 0,
            services: b.services || { name: '', name_ar: '' },
            slots: b.slots || { slot_date: '', start_time: '', end_time: '' },
            invoice_processing_status: b.invoice_processing_status ?? null,
            invoice_last_error: b.invoice_last_error ?? null,
            zoho_invoice_id: b.zoho_invoice_id ?? null,
          });
        } else {
          setError('Booking not found');
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load booking');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, bookingId]);

  const serviceName =
    booking?.services &&
    (i18n.language === 'ar' && booking.services.name_ar
      ? booking.services.name_ar
      : booking.services.name);
  const timeSlot =
    booking?.slots?.start_time && booking?.slots?.end_time
      ? `${formatTimeTo12Hour(booking.slots.start_time)} – ${formatTimeTo12Hour(booking.slots.end_time)}`
      : booking?.slots?.start_time ? formatTimeTo12Hour(booking.slots.start_time) : '—';
  const dateFormatted =
    booking?.slots?.slot_date &&
    (() => {
      try {
        return format(parseISO(booking.slots.slot_date), 'EEEE, MMMM d, yyyy', {
          locale: i18n.language === 'ar' ? ar : undefined,
        });
      } catch {
        return booking.slots.slot_date;
      }
    })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="lg"
    >
      <div className="p-2">
        {loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900 mb-4" />
            <p className="text-gray-600">{t('common.loading', 'Loading...')}</p>
          </div>
        )}
        {error && !loading && (
          <div className="text-center py-8">
            <p className="text-red-600 mb-4">{error}</p>
            <div className="flex gap-3 justify-center">
              <Button variant="secondary" onClick={onClose}>
                {t('common.close', 'Close')}
              </Button>
            </div>
          </div>
        )}
        {booking && !loading && (
          <>
            <Card className="text-center border-0 shadow-none">
              <CardContent className="pt-4 pb-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center bg-green-100">
                    <CheckCircle className="w-10 h-10 text-green-600" />
                  </div>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {t('reception.bookingConfirmedTitle', 'Booking Confirmed!')}
                </h2>
                <p className={`text-gray-600 text-sm ${ticketsEnabled ? 'mb-2' : 'mb-6'}`}>
                  {t('reception.bookingConfirmedThankYou', 'Thank you! The booking has been confirmed.')}
                </p>
                {ticketsEnabled && (
                  <p className="text-gray-600 text-sm mb-6">
                    {booking.invoice_processing_status === 'pending' || booking.invoice_processing_status === 'processing' ? (
                      <span className="text-amber-700">
                        {t('reception.invoiceBeingPrepared', 'Invoice is being prepared and will be sent shortly.')}
                      </span>
                    ) : booking.invoice_processing_status === 'failed' ? (
                      <span className="text-red-600">
                        {t('reception.invoiceSendFailed', 'Invoice could not be sent.')}
                        {booking.invoice_last_error ? ` ${booking.invoice_last_error}` : ''}
                      </span>
                    ) : (
                      t('reception.ticketWillBeSentWhatsApp', "The booking ticket will be sent to the customer's WhatsApp number.")
                    )}
                  </p>
                )}

                <div className="bg-gray-50 rounded-lg p-5 mb-6 text-left space-y-4">
                  <Row
                    icon={<Calendar className="w-5 h-5 text-gray-500" />}
                    label={i18n.language === 'ar' ? 'رقم الحجز' : 'Booking ID'}
                    value={booking.id}
                  />
                  <Row
                    icon={<Users className="w-5 h-5 text-gray-500" />}
                    label={i18n.language === 'ar' ? 'عدد الزوار' : 'Number of Visitors'}
                    value={String(booking.visitor_count)}
                  />
                  <Row
                    icon={<User className="w-5 h-5 text-gray-500" />}
                    label={i18n.language === 'ar' ? 'اسم العميل' : 'Customer Name'}
                    value={booking.customer_name || '—'}
                  />
                  <Row
                    icon={<Clock className="w-5 h-5 text-gray-500" />}
                    label={i18n.language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}
                    value={booking.customer_phone || '—'}
                  />
                  <Row
                    icon={<Calendar className="w-5 h-5 text-gray-500" />}
                    label={i18n.language === 'ar' ? 'الخدمة' : 'Service Name'}
                    value={serviceName || '—'}
                  />
                  <Row
                    icon={<Calendar className="w-5 h-5 text-gray-500" />}
                    label={i18n.language === 'ar' ? 'التاريخ' : 'Date'}
                    value={dateFormatted || '—'}
                  />
                  <Row
                    icon={<Clock className="w-5 h-5 text-gray-500" />}
                    label={i18n.language === 'ar' ? 'الوقت' : 'Time Slot'}
                    value={timeSlot}
                  />
                  <Row
                    icon={<Clock className="w-5 h-5 text-gray-500" />}
                    label={i18n.language === 'ar' ? 'المبلغ الإجمالي' : 'Total Amount'}
                    value={formatPrice(parseFloat(String(booking.total_price ?? 0)))}
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button variant="secondary" onClick={onBackToBookings}>
                    {i18n.language === 'ar' ? 'العودة إلى الحجوزات' : 'Back to Bookings'}
                  </Button>
                  <Button onClick={onCreateAnother}>
                    {i18n.language === 'ar' ? 'إنشاء حجز آخر' : 'Create Another Booking'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Modal>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-500">{label}</p>
        <p className="font-semibold text-gray-900 truncate">{value}</p>
      </div>
    </div>
  );
}
