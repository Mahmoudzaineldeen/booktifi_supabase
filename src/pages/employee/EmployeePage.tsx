import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { format, addWeeks, subWeeks, startOfWeek, isSameDay } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { Calendar, LogOut, User, ChevronLeft, ChevronRight, Phone, Mail, Clock, CheckCircle } from 'lucide-react';
import { getApiUrl } from '../../lib/apiUrl';
import { formatTimeTo12Hour } from '../../lib/timeFormat';
import { showNotification } from '../../contexts/NotificationContext';

interface SlotInfo {
  id?: string;
  slot_date: string;
  start_time: string;
  end_time: string;
}

interface ServiceInfo {
  id?: string;
  name: string;
  name_ar?: string;
}

interface EmployeeBooking {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  visitor_count: number;
  total_price: number;
  status: string;
  payment_status: string;
  notes: string | null;
  created_at: string;
  service_id: string;
  slot_id: string;
  employee_id: string;
  services: ServiceInfo | null;
  slots: SlotInfo | null;
  slot_date?: string | null;
  users?: { id: string; full_name?: string; full_name_ar?: string } | null;
}

const WEEK_DAYS = 7;

export function EmployeePage() {
  const { t, i18n } = useTranslation();
  const { userProfile, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const [initialAuthDone, setInitialAuthDone] = useState(false);
  const initialLoadRef = useRef(false);
  const [bookings, setBookings] = useState<EmployeeBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => new Date());
  const [completingId, setCompletingId] = useState<string | null>(null);

  const fetchBookings = useCallback(async () => {
    const from = format(weekStart, 'yyyy-MM-dd');
    const toDate = new Date(weekStart);
    toDate.setDate(toDate.getDate() + 6);
    const toStr = format(toDate, 'yyyy-MM-dd');
    setBookingsLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(
        `${getApiUrl()}/bookings/employee?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(toStr)}&limit=200`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to load bookings (${res.status})`);
      }
      const data = await res.json();
      setBookings(data.bookings || []);
    } catch (e: any) {
      console.error('Employee bookings fetch error:', e);
      showNotification('error', e.message || t('common.error'));
      setBookings([]);
    } finally {
      setBookingsLoading(false);
    }
  }, [weekStart, t]);

  useEffect(() => {
    if (initialAuthDone && userProfile) fetchBookings();
  }, [initialAuthDone, userProfile, fetchBookings]);

  useEffect(() => {
    if (initialLoadRef.current || initialAuthDone) return;
    if (authLoading) return;

    if (!userProfile) {
      navigate('/login');
      return;
    }

    if (userProfile.role !== 'employee') {
      navigate('/');
      return;
    }

    initialLoadRef.current = true;
    setInitialAuthDone(true);
  }, [authLoading, userProfile, navigate, initialAuthDone]);

  useEffect(() => {
    if (!initialAuthDone || authLoading) return;
    if (!userProfile) {
      const timeoutId = setTimeout(() => navigate('/login'), 500);
      return () => clearTimeout(timeoutId);
    }
  }, [userProfile, authLoading, navigate, initialAuthDone]);

  const handlePrevWeek = () => setWeekStart((d) => subWeeks(d, 1));
  const handleNextWeek = () => setWeekStart((d) => addWeeks(d, 1));
  const handleToday = () => {
    const today = new Date();
    setWeekStart(startOfWeek(today, { weekStartsOn: 0 }));
    setSelectedDate(today);
  };

  const handleComplete = async (bookingId: string) => {
    setCompletingId(bookingId);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${getApiUrl()}/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to complete booking');
      }
      showNotification('success', t('employeePage.complete') || 'Booking marked as completed');
      fetchBookings();
    } catch (e: any) {
      showNotification('error', e.message || t('common.error'));
    } finally {
      setCompletingId(null);
    }
  };

  const getSlotDate = (b: EmployeeBooking): string => {
    const d = b.slot_date || (b.slots && b.slots.slot_date);
    if (!d) return '';
    return String(d).split('T')[0];
  };

  const filteredBySelectedDay = selectedDate
    ? bookings.filter((b) => getSlotDate(b) === format(selectedDate, 'yyyy-MM-dd'))
    : bookings;

  const locale = i18n.language?.startsWith('ar') ? ar : undefined;
  const displayName = i18n.language === 'ar' ? userProfile?.full_name_ar : userProfile?.full_name;

  if (authLoading || !initialAuthDone) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const weekDays = Array.from({ length: WEEK_DAYS }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-2.5 rounded-xl shrink-0">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">
                  {t('employeePage.title', 'My Bookings')}
                </h1>
                <p className="text-xs md:text-sm text-slate-600">{displayName || userProfile?.full_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
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

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Calendar week strip */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4 mb-4">
              <Button variant="ghost" size="sm" onClick={handlePrevWeek} icon={<ChevronLeft className="w-4 h-4" />} />
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">
                  {format(weekStart, 'MMM d', { locale })} – {format(weekDays[6], 'MMM d, yyyy', { locale })}
                </span>
                <Button variant="secondary" size="sm" onClick={handleToday}>
                  {t('employeePage.today', 'Today')}
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={handleNextWeek} icon={<ChevronRight className="w-4 h-4" />} />
            </div>
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const count = bookings.filter((b) => getSlotDate(b) === dateStr).length;
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const isToday = isSameDay(day, new Date());
                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    className={`
                      py-3 px-2 rounded-lg text-center text-sm font-medium transition-colors
                      ${isSelected ? 'bg-blue-600 text-white ring-2 ring-blue-600 ring-offset-2' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                      ${isToday && !isSelected ? 'ring-1 ring-blue-400' : ''}
                    `}
                  >
                    <div>{format(day, 'EEE', { locale })}</div>
                    <div className="text-lg mt-0.5">{format(day, 'd')}</div>
                    {count > 0 && (
                      <div className={`text-xs mt-0.5 ${isSelected ? 'text-blue-100' : 'text-blue-600'}`}>
                        {count}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Bookings list for selected day */}
        <Card>
          <CardContent className="py-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {selectedDate
                ? format(selectedDate, 'EEEE, MMM d, yyyy', { locale })
                : t('employeePage.upcoming', 'Upcoming')}
            </h2>
            {bookingsLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
              </div>
            ) : filteredBySelectedDay.length === 0 ? (
              <p className="text-gray-500 py-8 text-center">
                {selectedDate
                  ? t('employeePage.noBookingsToday', 'No bookings today')
                  : t('employeePage.noUpcomingBookings', 'No upcoming bookings')}
              </p>
            ) : (
              <ul className="space-y-4">
                {filteredBySelectedDay
                  .sort((a, b) => {
                    const sa = a.slots?.start_time || '';
                    const sb = b.slots?.start_time || '';
                    return sa.localeCompare(sb);
                  })
                  .map((b) => {
                    const serviceName = b.services
                      ? i18n.language === 'ar' && b.services.name_ar
                        ? b.services.name_ar
                        : b.services.name
                      : '—';
                    const slot = b.slots;
                    const timeStr = slot
                      ? `${formatTimeTo12Hour(slot.start_time)} – ${formatTimeTo12Hour(slot.end_time)}`
                      : '—';
                    const canComplete =
                      b.status !== 'completed' && b.status !== 'cancelled' && completingId !== b.id;
                    return (
                      <li
                        key={b.id}
                        className="border border-gray-200 rounded-lg p-4 bg-white hover:border-blue-200 transition-colors"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-gray-900 font-medium">
                              <Clock className="w-4 h-4 text-gray-500 shrink-0" />
                              <span>{timeStr}</span>
                              <span
                                className={`
                                  text-xs px-2 py-0.5 rounded-full
                                  ${b.status === 'completed' ? 'bg-green-100 text-green-800' : ''}
                                  ${b.status === 'confirmed' ? 'bg-blue-100 text-blue-800' : ''}
                                  ${b.status === 'pending' ? 'bg-amber-100 text-amber-800' : ''}
                                  ${b.status === 'checked_in' ? 'bg-indigo-100 text-indigo-800' : ''}
                                  ${b.status === 'cancelled' ? 'bg-gray-200 text-gray-600' : ''}
                                `}
                              >
                                {b.status}
                              </span>
                              {(b.payment_status && b.payment_status !== 'unpaid') && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                  {t('employeePage.payment', 'Payment')}: {b.payment_status}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 font-medium text-gray-900">{serviceName}</p>
                            <p className="text-gray-700 mt-0.5">{b.customer_name}</p>
                            {b.customer_phone && (
                              <a
                                href={`tel:${b.customer_phone}`}
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mt-1"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                {b.customer_phone}
                              </a>
                            )}
                            {b.customer_email && (
                              <a
                                href={`mailto:${b.customer_email}`}
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mt-0.5 ml-4 sm:ml-0"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                {b.customer_email}
                              </a>
                            )}
                            {b.visitor_count > 1 && (
                              <p className="text-xs text-gray-500 mt-1">
                                {b.visitor_count} {t('reception.visitors', 'visitors')}
                              </p>
                            )}
                            {b.notes && (
                              <p className="text-sm text-gray-600 mt-1 border-l-2 border-gray-200 pl-2">{b.notes}</p>
                            )}
                          </div>
                          {canComplete && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => handleComplete(b.id)}
                              disabled={completingId === b.id}
                              icon={<CheckCircle className="w-4 h-4" />}
                              className="shrink-0"
                            >
                              {completingId === b.id ? '...' : t('employeePage.complete', 'Complete')}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
