import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import {
  format,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isSameDay,
  isSameMonth,
  isToday,
  eachDayOfInterval,
} from 'date-fns';
import { ar } from 'date-fns/locale';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import {
  Calendar as CalendarIcon,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Clock,
  CheckCircle,
  CalendarDays,
  UserCircle,
} from 'lucide-react';
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

export function EmployeePage() {
  const { t, i18n } = useTranslation();
  const { userProfile, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const [initialAuthDone, setInitialAuthDone] = useState(false);
  const initialLoadRef = useRef(false);
  const [bookings, setBookings] = useState<EmployeeBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => new Date());
  const [completingId, setCompletingId] = useState<string | null>(null);

  const fetchBookings = useCallback(async () => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const from = format(monthStart, 'yyyy-MM-dd');
    const toStr = format(monthEnd, 'yyyy-MM-dd');
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
  }, [calendarMonth, t]);

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

  const handlePrevMonth = () => {
    const next = subMonths(calendarMonth, 1);
    setCalendarMonth(next);
    setSelectedDate(startOfMonth(next));
  };
  const handleNextMonth = () => {
    const next = addMonths(calendarMonth, 1);
    setCalendarMonth(next);
    setSelectedDate(startOfMonth(next));
  };
  const handleToday = () => {
    const today = new Date();
    setCalendarMonth(today);
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

  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const allDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-blue-50/20 to-slate-50 overflow-x-hidden">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur border-b border-slate-200/80 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-500/25">
                <CalendarDays className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
                  {t('employeePage.title', 'My Bookings')}
                </h1>
                <p className="flex items-center gap-1.5 text-sm text-slate-600 mt-0.5">
                  <UserCircle className="w-4 h-4 text-slate-400" />
                  {displayName || userProfile?.full_name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <LanguageToggle />
              <Button
                variant="outline"
                size="sm"
                icon={<LogOut className="w-4 h-4" />}
                onClick={() => signOut()}
                className="border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                <span className="hidden sm:inline">{t('auth.logout')}</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Calendar — full month view */}
          <div className="lg:col-span-1">
            <Card className="overflow-hidden shadow-lg border-0 bg-white/95 backdrop-blur" padding="none">
              <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="font-semibold text-slate-900 text-lg">
                    {format(calendarMonth, 'MMMM yyyy', { locale })}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                    aria-label="Next month"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleToday}
                  className="w-full mt-3 bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  {t('employeePage.today', 'Today')}
                </Button>
              </div>
              <div className="p-4">
                {/* Weekday headers */}
                <div className="grid grid-cols-7 gap-0.5 mb-2">
                  {weeks[0]?.map((d) => (
                    <div
                      key={d.getTime()}
                      className="text-center text-xs font-medium text-slate-500 py-1.5"
                    >
                      {format(d, 'EEE', { locale })}
                    </div>
                  ))}
                </div>
                {/* Day grid */}
                <div className="space-y-1">
                  {weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-0.5">
                      {week.map((day) => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const count = bookings.filter((b) => getSlotDate(b) === dateStr).length;
                        const selected = selectedDate && isSameDay(day, selectedDate);
                        const today = isToday(day);
                        const inMonth = isSameMonth(day, calendarMonth);
                        return (
                          <button
                            key={dateStr}
                            type="button"
                            onClick={() => setSelectedDate(day)}
                            className={`
                              relative min-h-[2.75rem] rounded-xl text-sm font-medium transition-all
                              ${selected
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-[1.02]'
                                : today
                                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-400/60'
                                  : inMonth
                                    ? 'text-slate-800 hover:bg-slate-100'
                                    : 'text-slate-400 hover:bg-slate-50'}
                            `}
                          >
                            {format(day, 'd')}
                            {count > 0 && (
                              <span
                                className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${
                                  selected ? 'bg-white/90' : today ? 'bg-blue-500' : 'bg-blue-400'
                                }`}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          {/* Bookings for selected day */}
          <div className="lg:col-span-2">
            <Card className="shadow-lg border-0 bg-white/95 backdrop-blur overflow-hidden" padding="none">
              <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                <h2 className="text-lg font-semibold text-slate-900">
                  {selectedDate
                    ? format(selectedDate, 'EEEE, MMM d', { locale })
                    : t('employeePage.upcoming', 'Upcoming')}
                </h2>
                {selectedDate && filteredBySelectedDay.length > 0 && (
                  <p className="text-sm text-slate-500 mt-0.5">
                    {filteredBySelectedDay.length} {filteredBySelectedDay.length === 1 ? 'booking' : 'bookings'}
                  </p>
                )}
              </div>
              <div className="p-6 min-h-[280px]">
                {bookingsLoading ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-12 w-12 border-2 border-blue-500 border-t-transparent mb-4" />
                    <p className="text-sm text-slate-500">{t('common.loading', 'Loading...')}</p>
                  </div>
                ) : filteredBySelectedDay.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                      <CalendarIcon className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-slate-600 font-medium">
                      {selectedDate
                        ? t('employeePage.noBookingsToday', 'No bookings today')
                        : t('employeePage.noUpcomingBookings', 'No upcoming bookings')}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                      {t('employeePage.assignedBookingsAppear', 'Your assigned bookings will appear here')}
                    </p>
                  </div>
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
                        const statusBorder =
                          b.status === 'completed'
                            ? 'border-l-green-500'
                            : b.status === 'confirmed'
                              ? 'border-l-blue-500'
                              : b.status === 'checked_in'
                                ? 'border-l-indigo-500'
                                : b.status === 'cancelled'
                                  ? 'border-l-slate-400'
                                  : 'border-l-amber-500';
                        return (
                          <li
                            key={b.id}
                            className={`bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden border-l-4 ${statusBorder} hover:shadow-md hover:border-slate-300/80 transition-all`}
                          >
                            <div className="p-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                              <div className="flex-1 min-w-0 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center gap-1.5 text-slate-900 font-semibold">
                                    <Clock className="w-4 h-4 text-slate-500" />
                                    {timeStr}
                                  </span>
                                  <span
                                    className={`
                                      text-xs px-2.5 py-1 rounded-full font-medium
                                      ${b.status === 'completed' ? 'bg-green-100 text-green-800' : ''}
                                      ${b.status === 'confirmed' ? 'bg-blue-100 text-blue-800' : ''}
                                      ${b.status === 'pending' ? 'bg-amber-100 text-amber-800' : ''}
                                      ${b.status === 'checked_in' ? 'bg-indigo-100 text-indigo-800' : ''}
                                      ${b.status === 'cancelled' ? 'bg-slate-200 text-slate-600' : ''}
                                    `}
                                  >
                                    {b.status}
                                  </span>
                                  {b.payment_status && b.payment_status !== 'unpaid' && (
                                    <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800">
                                      {b.payment_status}
                                    </span>
                                  )}
                                </div>
                                <p className="text-slate-800 font-medium">{serviceName}</p>
                                {b.users && (
                                  <p className="text-sm text-slate-600">
                                    {t('employeePage.assignedTo', 'Assigned to')}:{' '}
                                    <span className="font-medium text-slate-800">
                                      {i18n.language === 'ar' && b.users.full_name_ar
                                        ? b.users.full_name_ar
                                        : b.users.full_name || '—'}
                                    </span>
                                  </p>
                                )}
                                <p className="text-slate-900 font-semibold">{b.customer_name}</p>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                  {b.customer_phone && (
                                    <a
                                      href={`tel:${b.customer_phone}`}
                                      className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 hover:underline"
                                    >
                                      <Phone className="w-4 h-4 shrink-0" />
                                      {b.customer_phone}
                                    </a>
                                  )}
                                  {b.customer_email && (
                                    <a
                                      href={`mailto:${b.customer_email}`}
                                      className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 hover:underline"
                                    >
                                      <Mail className="w-4 h-4 shrink-0" />
                                      {b.customer_email}
                                    </a>
                                  )}
                                </div>
                                {b.visitor_count > 1 && (
                                  <p className="text-xs text-slate-500">
                                    {b.visitor_count} {t('reception.visitors', 'visitors')}
                                  </p>
                                )}
                                {b.notes && (
                                  <p className="text-sm text-slate-600 border-l-2 border-slate-200 pl-3">{b.notes}</p>
                                )}
                              </div>
                              {canComplete && (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => handleComplete(b.id)}
                                  disabled={completingId === b.id}
                                  icon={<CheckCircle className="w-4 h-4" />}
                                  className="shrink-0 bg-green-600 hover:bg-green-700 shadow-sm"
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
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
