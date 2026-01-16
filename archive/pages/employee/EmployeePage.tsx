import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { Calendar, User, Phone, Mail, Clock, LogOut, CheckCircle, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO, addDays, startOfDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface Booking {
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
  services: {
    name: string;
    name_ar: string;
  };
  slots: {
    slot_date: string;
    start_time: string;
    end_time: string;
  };
}

export function EmployeePage() {
  const { t, i18n } = useTranslation();
  const { userProfile, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [todayBookings, setTodayBookings] = useState<Booking[]>([]);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'all' | 'calendar'>('today');
  const [calendarStartDate, setCalendarStartDate] = useState(new Date());

  useEffect(() => {
    if (authLoading) {
      console.log('Employee: Auth still loading...');
      return;
    }

    console.log('Employee: Auth loaded', { userProfile, role: userProfile?.role });

    if (!userProfile) {
      console.log('Employee: No user profile, redirecting to login');
      navigate('/login');
      return;
    }

    if (userProfile.role !== 'employee') {
      console.log('Employee: Wrong role, redirecting to home. Expected: employee, Got:', userProfile.role);
      navigate('/');
      return;
    }

    console.log('Employee: User is employee, loading bookings...');
    fetchBookings();
  }, [userProfile, authLoading, navigate, calendarStartDate]);

  async function fetchBookings() {
    if (!userProfile?.tenant_id || !userProfile?.id) return;

    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const startDate = format(calendarStartDate, 'yyyy-MM-dd');
      const endDate = format(addDays(calendarStartDate, 6), 'yyyy-MM-dd');

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
          notes,
          created_at,
          services (name, name_ar),
          slots (slot_date, start_time, end_time)
        `)
        .eq('tenant_id', userProfile.tenant_id)
        .eq('employee_id', userProfile.id)
        .in('status', ['confirmed', 'pending', 'completed'])
        .gte('slots.slot_date', startDate)
        .lte('slots.slot_date', endDate)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const allBookings = data || [];
      setBookings(allBookings);

      const todayOnly = allBookings.filter(b => b.slots?.slot_date === today);
      setTodayBookings(todayOnly);

      const upcoming = allBookings.filter(b => b.slots?.slot_date > today);
      setUpcomingBookings(upcoming);
    } catch (err) {
      console.error('Error fetching bookings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function markAsCompleted(bookingId: string) {
    try {
      const { error } = await db
        .from('bookings')
        .update({
          status: 'completed',
          status_changed_at: new Date().toISOString(),
          checked_in_at: new Date().toISOString(),
          checked_in_by_user_id: userProfile?.id
        })
        .eq('id', bookingId);

      if (error) throw error;
      fetchBookings();
    } catch (err: any) {
      console.error('Error updating booking:', err);
      alert(`Error: ${err.message}`);
    }
  }

  function BookingCard({ booking, showActions = false }: { booking: Booking; showActions?: boolean }) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-center gap-2">
                  <User className="w-5 h-5 text-blue-600" />
                  <span className="font-bold text-xl">{booking.customer_name}</span>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  booking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  booking.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  booking.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {booking.status.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-4 h-4" />
                  <a href={`tel:${booking.customer_phone}`} className="text-blue-600 hover:underline">
                    {booking.customer_phone}
                  </a>
                </div>
                {booking.customer_email && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4" />
                    <a href={`mailto:${booking.customer_email}`} className="text-blue-600 hover:underline">
                      {booking.customer_email}
                    </a>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <span className="text-xs text-gray-500">{t('reception.service')}</span>
                  <div className="font-medium text-sm">
                    {i18n.language === 'ar' ? booking.services?.name_ar : booking.services?.name}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">{t('reception.date')}</span>
                  <div className="font-medium text-sm">
                    {format(parseISO(booking.slots?.slot_date), 'EEE, MMM dd, yyyy')}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">{t('reception.time')}</span>
                  <div className="font-medium text-sm flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {booking.slots?.start_time} - {booking.slots?.end_time}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">{t('reception.visitors')}</span>
                  <div className="font-medium text-sm">{booking.visitor_count}</div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">{t('service.price')}</span>
                  <div className="font-medium text-sm">{booking.total_price} SAR</div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">{t('employeePage.payment')}</span>
                  <div className="font-medium text-sm">
                    <span className={`${
                      booking.payment_status === 'paid' ? 'text-green-600' : 'text-orange-600'
                    }`}>
                      {booking.payment_status.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {booking.notes && (
                <div className="mt-3 text-sm text-gray-700 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                  <strong className="text-yellow-800">{t('reception.specialNotes')}:</strong>
                  <p className="mt-1">{booking.notes}</p>
                </div>
              )}
            </div>

            {showActions && booking.status === 'confirmed' && (
              <div className="ml-4">
                <Button
                  size="sm"
                  onClick={() => markAsCompleted(booking.id)}
                  icon={<CheckCircle className="w-4 h-4" />}
                >
                  {t('employeePage.complete')}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const displayBookings =
    activeTab === 'today' ? todayBookings :
    activeTab === 'upcoming' ? upcomingBookings :
    activeTab === 'calendar' ? [] :
    bookings;

  function CalendarView() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(calendarStartDate, i));

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-white p-4 rounded-lg shadow-sm">
          <Button
            variant="secondary"
            icon={<ChevronLeft className="w-4 h-4" />}
            onClick={() => setCalendarStartDate(prev => addDays(prev, -7))}
          >
            {t('employeePage.previousWeek')}
          </Button>
          <h3 className="text-lg font-semibold">
            {format(calendarStartDate, 'MMM dd')} - {format(addDays(calendarStartDate, 6), 'MMM dd, yyyy')}
          </h3>
          <Button
            variant="secondary"
            icon={<ChevronRight className="w-4 h-4" />}
            onClick={() => setCalendarStartDate(prev => addDays(prev, 7))}
          >
            {t('employeePage.nextWeek')}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {days.map((day) => {
            const dayString = format(day, 'yyyy-MM-dd');
            const dayBookings = bookings.filter(b => b.slots?.slot_date === dayString);
            const isToday = format(new Date(), 'yyyy-MM-dd') === dayString;

            return (
              <Card key={dayString} className={isToday ? 'ring-2 ring-blue-500' : ''}>
                <CardContent className="py-4">
                  <div className="mb-3">
                    <div className={`text-lg font-bold ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                      {format(day, 'EEE')}
                    </div>
                    <div className={`text-2xl font-bold ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                      {format(day, 'dd')}
                    </div>
                    <div className="text-sm text-gray-500">{format(day, 'MMM yyyy')}</div>
                  </div>

                  {dayBookings.length === 0 ? (
                    <div className="text-sm text-gray-400 italic py-4">{t('employeePage.noBookings')}</div>
                  ) : (
                    <div className="space-y-2">
                      {dayBookings
                        .sort((a, b) => a.slots.start_time.localeCompare(b.slots.start_time))
                        .map((booking) => (
                        <div
                          key={booking.id}
                          className={`p-3 rounded-lg border-l-4 ${
                            booking.status === 'confirmed' ? 'border-green-500 bg-green-50' :
                            booking.status === 'pending' ? 'border-yellow-500 bg-yellow-50' :
                            booking.status === 'completed' ? 'border-blue-500 bg-blue-50' :
                            'border-gray-500 bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-3 h-3 text-gray-600" />
                            <span className="text-sm font-semibold">
                              {booking.slots.start_time}
                            </span>
                          </div>
                          <div className="text-sm font-medium text-gray-900 mb-1">
                            {booking.customer_name}
                          </div>
                          <div className="text-xs text-gray-600 mb-2">
                            {i18n.language === 'ar' ? booking.services?.name_ar : booking.services?.name}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`text-xs px-2 py-1 rounded ${
                              booking.status === 'confirmed' ? 'bg-green-200 text-green-800' :
                              booking.status === 'pending' ? 'bg-yellow-200 text-yellow-800' :
                              booking.status === 'completed' ? 'bg-blue-200 text-blue-800' :
                              'bg-gray-200 text-gray-800'
                            }`}>
                              {booking.status.toUpperCase()}
                            </span>
                            {booking.status === 'confirmed' && (
                              <button
                                onClick={() => markAsCompleted(booking.id)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                              >
                                {t('employeePage.complete')}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">{t('employeePage.title')}</h1>
              <p className="text-xs md:text-sm text-gray-600">
                {t('reception.welcome')}, {i18n.language === 'ar' ? userProfile?.full_name_ar : userProfile?.full_name}
              </p>
            </div>
            <div className="flex items-center gap-2">
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
        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          <Button
            variant={activeTab === 'today' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('today')}
            size="sm"
          >
            {t('employeePage.today')} ({todayBookings.length})
          </Button>
          <Button
            variant={activeTab === 'upcoming' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('upcoming')}
            size="sm"
          >
            {t('employeePage.upcoming')} ({upcomingBookings.length})
          </Button>
          <Button
            variant={activeTab === 'calendar' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('calendar')}
            icon={<CalendarDays className="w-4 h-4" />}
            size="sm"
          >
            {t('employeePage.calendar')}
          </Button>
          <Button
            variant={activeTab === 'all' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('all')}
            size="sm"
          >
            {t('employeePage.all')} ({bookings.length})
          </Button>
        </div>

        {activeTab === 'calendar' ? (
          <CalendarView />
        ) : displayBookings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {activeTab === 'today' ? t('employeePage.noBookingsToday') :
                 activeTab === 'upcoming' ? t('employeePage.noUpcomingBookings') :
                 t('employeePage.noBookingsYet')}
              </h3>
              <p className="text-gray-600">{t('employeePage.assignedBookingsAppear')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {displayBookings.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                showActions={activeTab === 'today'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
