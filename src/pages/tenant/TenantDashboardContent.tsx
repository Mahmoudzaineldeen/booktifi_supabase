import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { safeTranslateStatus } from '../../lib/safeTranslation';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { db } from '../../lib/db';
import { Card, CardContent } from '../../components/ui/Card';
import { TimeFilter, TimeRange } from '../../components/dashboard/TimeFilter';
import { PerformanceChart } from '../../components/dashboard/PerformanceChart';
import { PieChart } from '../../components/dashboard/PieChart';
import { ComparisonChart } from '../../components/dashboard/ComparisonChart';
import { StatCard } from '../../components/dashboard/StatCard';
import { Calendar, Users, Briefcase, DollarSign, TrendingUp, CheckCircle, Grid, List, ChevronLeft, ChevronRight, Clock, XCircle, User, Package } from 'lucide-react';
import { startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, parseISO, eachDayOfInterval, addDays, isSameDay, addMinutes, isAfter, isBefore, parse } from 'date-fns';
import { formatTimeTo12Hour } from '../../lib/timeFormat';
import { ar } from 'date-fns/locale';

interface ServicePerformance {
  id: string;
  name: string;
  bookings: number;
  revenue: number;
  dailyData: { date: string; bookings: number; revenue: number }[];
}


export function TenantDashboardContent() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { userProfile, tenant } = useAuth();
  const { formatPrice } = useCurrency();
  const { features } = useTenantFeatures(tenant?.id);
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [stats, setStats] = useState({
    totalBookings: 0,
    totalRevenue: 0,
    packageSubscriptions: 0,
    packageRevenue: 0,
    completedBookings: 0,
    averageBookingValue: 0,
  });
  const [servicePerformance, setServicePerformance] = useState<ServicePerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'dashboard' | 'calendar'>('dashboard');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [allBookings, setAllBookings] = useState<any[]>([]);
  const [dashboardBookings, setDashboardBookings] = useState<any[]>([]);
  const [selectedBookingForDetails, setSelectedBookingForDetails] = useState<any | null>(null);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    // Don't redirect during initial load - let TenantDashboard handle auth checks
    if (!userProfile) {
      return;
    }
    const isDateRangeChange = !isInitialLoadRef.current;
    fetchStats(isDateRangeChange);
    if (viewMode === 'calendar') {
      fetchCalendarBookings();
    } else {
      fetchDashboardBookings();
    }
  }, [userProfile, timeRange, customStartDate, customEndDate, viewMode, calendarDate]);

  function getDateRange(): { start: Date; end: Date } {
    const now = new Date();

    switch (timeRange) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'yesterday':
        const yesterday = subDays(now, 1);
        return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
      case 'last_week':
        return { start: startOfWeek(subDays(now, 7)), end: endOfWeek(subDays(now, 7)) };
      case 'last_month':
        const lastMonth = subDays(now, 30);
        return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
      case 'custom':
        if (customStartDate && customEndDate) {
          return {
            start: startOfDay(new Date(customStartDate)),
            end: endOfDay(new Date(customEndDate)),
          };
        }
        return { start: startOfDay(now), end: endOfDay(now) };
      default:
        return { start: startOfDay(now), end: endOfDay(now) };
    }
  }

  async function fetchStats(skipFullLoading = false) {
    if (!userProfile?.tenant_id) return;

    // Only show full-page loading on initial load; when user changes date range, refresh in place
    if (!skipFullLoading) {
      setLoading(true);
    }
    const { start, end } = getDateRange();

    try {
      const { data: bookings, error: bookingsError } = await db
        .from('bookings')
        .select(`
          id,
          total_price,
          status,
          service_id,
          created_at,
          services:service_id (
            id,
            name,
            name_ar
          )
        `)
        .eq('tenant_id', userProfile.tenant_id)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());

      if (bookingsError) throw bookingsError;

      const totalBookings = bookings?.length || 0;
      const totalRevenue = bookings?.reduce((sum, b) => sum + (parseFloat(b.total_price?.toString() || '0')), 0) || 0;
      const completedBookings = bookings?.filter(b => b.status === 'completed').length || 0;
      const averageBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

      // Package metrics (same date range: subscribed_at)
      let packageSubscriptions = 0;
      let packageRevenue = 0;
      try {
        const { data: subs, error: subsError } = await db
          .from('package_subscriptions')
          .select('id, subscribed_at, service_packages(total_price)')
          .eq('tenant_id', userProfile.tenant_id)
          .gte('subscribed_at', start.toISOString())
          .lte('subscribed_at', end.toISOString());

        if (!subsError && subs?.length) {
          packageSubscriptions = subs.length;
          packageRevenue = subs.reduce((sum, s) => {
            const pkg = s.service_packages as { total_price?: number } | null;
            const price = pkg?.total_price != null ? parseFloat(String(pkg.total_price)) : 0;
            return sum + price;
          }, 0);
        }
      } catch (e) {
        console.warn('Dashboard: could not fetch package stats', e);
      }

      setStats({
        totalBookings,
        totalRevenue,
        packageSubscriptions,
        packageRevenue,
        completedBookings,
        averageBookingValue,
      });

      const allDates = eachDayOfInterval({ start, end }).map(date => format(date, 'yyyy-MM-dd'));

      const serviceMap = new Map<string, ServicePerformance>();

      bookings?.forEach((booking) => {
        const bookingDate = format(parseISO(booking.created_at), 'yyyy-MM-dd');
        const serviceId = booking.service_id;
        const service = booking.services as any;
        const serviceName = i18n.language === 'ar' && service?.name_ar ? service.name_ar : (service?.name || t('service.unknown'));
        const revenue = parseFloat(booking.total_price?.toString() || '0');

        if (serviceId) {
          const existing = serviceMap.get(serviceId);
          if (existing) {
            existing.bookings += 1;
            existing.revenue += revenue;
            const dayData = existing.dailyData.find(d => d.date === bookingDate);
            if (dayData) {
              dayData.bookings += 1;
              dayData.revenue += revenue;
            } else {
              existing.dailyData.push({ date: bookingDate, bookings: 1, revenue });
            }
          } else {
            serviceMap.set(serviceId, {
              id: serviceId,
              name: serviceName,
              bookings: 1,
              revenue,
              dailyData: [{ date: bookingDate, bookings: 1, revenue }],
            });
          }
        }
      });

      const normalizeData = (items: Map<string, ServicePerformance>) => {
        return Array.from(items.values()).map(item => ({
          ...item,
          dailyData: allDates.map(date => {
            const existing = item.dailyData.find(d => d.date === date);
            return existing || { date, bookings: 0, revenue: 0 };
          }),
        }));
      };

      setServicePerformance(
        normalizeData(serviceMap)
          .sort((a, b) => b.revenue - a.revenue)
      );
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      isInitialLoadRef.current = false;
      setLoading(false);
    }
  }

  async function fetchDashboardBookings() {
    if (!userProfile?.tenant_id) return;

    try {
      const { data: bookings, error } = await db
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
          zoho_invoice_id,
          zoho_invoice_created_at,
          slot_id,
          service_id,
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
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      setDashboardBookings(bookings || []);
    } catch (err) {
      console.error('Error fetching dashboard bookings:', err);
    }
  }

  async function fetchCalendarBookings() {
    if (!userProfile?.tenant_id) return;

    const weekStart = startOfWeek(calendarDate, { weekStartsOn: 0 });
    const weekEnd = addDays(weekStart, 6);
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

    try {
      const { data: bookings, error } = await db
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
          zoho_invoice_id,
          zoho_invoice_created_at,
          slot_id,
          service_id,
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

      const filteredBookings = (bookings || []).filter(booking => {
        const slotDate = booking.slots?.slot_date;
        if (!slotDate) return false;
        return slotDate >= weekStartStr && slotDate <= weekEndStr;
      });

      setAllBookings(filteredBookings);
    } catch (err) {
      console.error('Error fetching calendar bookings:', err);
    }
  }

  function getBookingsForDate(date: Date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    return allBookings.filter(booking => {
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

  function calculateBookingLayout(bookings: any[]) {
    if (bookings.length === 0) return [];

    const sortedBookings = [...bookings].sort((a, b) => {
      return (a.slots?.start_time || '').localeCompare(b.slots?.start_time || '');
    });

    const overlaps = (booking1: any, booking2: any) => {
      const start1 = booking1.slots?.start_time || '';
      const end1 = booking1.slots?.end_time || '';
      const start2 = booking2.slots?.start_time || '';
      const end2 = booking2.slots?.end_time || '';
      return start1 < end2 && start2 < end1;
    };

    const layout: Array<{ booking: any; column: number; totalColumns: number }> = [];
    const columns: any[][] = [];

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

  if (loading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-blue-200 border-t-blue-600"></div>
        <p className="text-sm text-gray-500">{t('common.loading', 'Loading...')}</p>
      </div>
    );
  }

  const colors = [
    '#3B82F6',
    '#10B981',
    '#F59E0B',
    '#EF4444',
    '#8B5CF6',
    '#EC4899',
    '#14B8A6',
    '#F97316',
  ];

  const serviceChartData = servicePerformance.map((service, index) => ({
    label: service.name,
    value: service.bookings,
    revenue: service.revenue,
    color: colors[index % colors.length],
  }));

  const totalRevenueForPie = stats.totalRevenue > 0 ? stats.totalRevenue : 1;
  const servicePieData = servicePerformance.slice(0, 8).map((service, index) => ({
    label: service.name,
    value: service.revenue,
    color: colors[index % colors.length],
    percentage: (service.revenue / totalRevenueForPie) * 100,
  }));

  const serviceComparisonSeries = servicePerformance.slice(0, 5).map((service, index) => ({
    name: service.name,
    data: service.dailyData.map(d => ({ date: d.date, value: d.bookings })),
    color: colors[index % colors.length],
  }));

  // Separate bookings into upcoming and expired
  const upcomingBookings = dashboardBookings.filter(booking => {
    const slot = booking.slots;
    
    // If status is completed or cancelled, it's expired
    if (booking.status === 'completed' || booking.status === 'cancelled') {
      return false;
    }
    
    // If no slot info, can't determine if upcoming
    if (!slot?.slot_date) {
      return false;
    }
    
    const now = new Date();
    const today = startOfDay(now);
    
    // Parse the slot date
    const slotDate = parse(slot.slot_date, 'yyyy-MM-dd', new Date());
    const slotDateStart = startOfDay(slotDate);
    
    // If slot date is in the past, it's expired
    if (isBefore(slotDateStart, today)) {
      return false;
    }
    
    // If slot date is today, check the end time
    if (isSameDay(slotDate, now)) {
      if (!slot?.end_time) {
        // If no end time but date is today, consider it upcoming if status allows
        return true;
      }
      // Parse end time and compare
      const [hours, minutes] = slot.end_time.split(':').map(Number);
      const bookingEndDateTime = new Date(slotDate);
      bookingEndDateTime.setHours(hours, minutes, 0, 0);
      return isAfter(bookingEndDateTime, now);
    }
    
    // If slot date is in the future, it's upcoming
    return isAfter(slotDateStart, today);
  }).sort((a, b) => {
    const dateA = parse(a.slots?.slot_date || '1970-01-01', 'yyyy-MM-dd', new Date());
    const dateB = parse(b.slots?.slot_date || '1970-01-01', 'yyyy-MM-dd', new Date());
    return dateA.getTime() - dateB.getTime();
  });

  const expiredBookings = dashboardBookings.filter(booking => {
    const slot = booking.slots;
    
    // If status is completed or cancelled, it's expired
    if (booking.status === 'completed' || booking.status === 'cancelled') {
      return true;
    }
    
    // If no slot info, can't determine - exclude from both lists
    if (!slot?.slot_date) {
      return false;
    }
    
    const now = new Date();
    const today = startOfDay(now);
    
    // Parse the slot date
    const slotDate = parse(slot.slot_date, 'yyyy-MM-dd', new Date());
    const slotDateStart = startOfDay(slotDate);
    
    // If slot date is in the past, it's expired
    if (isBefore(slotDateStart, today)) {
      return true;
    }
    
    // If slot date is today, check the end time
    if (isSameDay(slotDate, now)) {
      if (!slot?.end_time) {
        // If no end time but date is today and status is not active, consider expired
        return booking.status !== 'confirmed' && booking.status !== 'checked_in' && booking.status !== 'pending';
      }
      // Parse end time and compare
      const [hours, minutes] = slot.end_time.split(':').map(Number);
      const bookingEndDateTime = new Date(slotDate);
      bookingEndDateTime.setHours(hours, minutes, 0, 0);
      return !isAfter(bookingEndDateTime, now);
    }
    
    // If slot date is in the future, it's not expired
    return false;
  }).sort((a, b) => {
    const dateA = parse(a.slots?.slot_date || '1970-01-01', 'yyyy-MM-dd', new Date());
    const dateB = parse(b.slots?.slot_date || '1970-01-01', 'yyyy-MM-dd', new Date());
    return dateB.getTime() - dateA.getTime(); // Most recent first
  });

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
            {t('dashboard.welcomeBack', {
              name: i18n.language === 'ar' 
                ? (userProfile?.full_name_ar || userProfile?.full_name || '')
                : (userProfile?.full_name || '')
            })}
          </h1>
          <p className="text-sm md:text-base text-slate-600">{t('dashboard.subtitle', 'View your business analytics and manage bookings')}</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1.5 shadow-inner">
          <button
            type="button"
            onClick={() => setViewMode('dashboard')}
            className={`px-3 md:px-4 py-2 rounded-md text-sm md:text-base font-medium transition-colors ${
              viewMode === 'dashboard'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Grid className="w-4 h-4 inline-block mr-1 md:mr-2" />
            <span className="hidden sm:inline">{t('dashboard.viewMode.dashboard', 'Dashboard')}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`px-3 md:px-4 py-2 rounded-md text-sm md:text-base font-medium transition-colors ${
              viewMode === 'calendar'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Calendar className="w-4 h-4 inline-block mr-1 md:mr-2" />
            <span className="hidden sm:inline">{t('dashboard.viewMode.calendar', 'Calendar')}</span>
          </button>
        </div>
      </div>

      {viewMode === 'dashboard' && (
        <>
          <TimeFilter
            selectedRange={timeRange}
            onRangeChange={setTimeRange}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
            onCustomDateChange={(start, end) => {
              setCustomStartDate(start);
              setCustomEndDate(end);
            }}
          />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <StatCard
          title={t('dashboard.totalBookings', 'Total Bookings')}
          value={stats.totalBookings}
          icon={Calendar}
          iconColor="text-blue-600"
          iconBgColor="bg-blue-100"
        />

        <StatCard
          title={t('dashboard.bookingRevenue', 'Booking Revenue')}
          value={formatPrice(stats.totalRevenue)}
          icon={DollarSign}
          iconColor="text-green-600"
          iconBgColor="bg-green-100"
        />

        <StatCard
          title={t('dashboard.packageSubscriptions', 'Package Subscriptions')}
          value={stats.packageSubscriptions}
          icon={Package}
          iconColor="text-violet-600"
          iconBgColor="bg-violet-100"
        />

        <StatCard
          title={t('dashboard.packageRevenue', 'Package Revenue')}
          value={formatPrice(stats.packageRevenue)}
          icon={Package}
          iconColor="text-purple-600"
          iconBgColor="bg-purple-100"
        />

        <StatCard
          title={t('dashboard.completedBookings', 'Completed Bookings')}
          value={stats.completedBookings}
          icon={CheckCircle}
          iconColor="text-teal-600"
          iconBgColor="bg-teal-100"
        />

        <StatCard
          title={t('dashboard.averageBookingValue', 'Average Booking Value')}
          value={formatPrice(stats.averageBookingValue)}
          icon={TrendingUp}
          iconColor="text-orange-600"
          iconBgColor="bg-orange-100"
        />
      </div>

      {/* Combined revenue summary */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-600">
          {t('dashboard.totalRevenueCombined', 'Total Revenue (Bookings + Packages)')}:{' '}
          <span className="font-semibold text-gray-900">
            {formatPrice(stats.totalRevenue + stats.packageRevenue)}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <PieChart
          title={t('dashboard.revenueByService', 'Revenue by Service')}
          data={servicePieData}
        />
      </div>

      <div className="mb-8">
        <ComparisonChart
          title={t('dashboard.serviceBookingComparison', 'Service Booking Comparison')}
          series={serviceComparisonSeries}
          valueLabel={t('dashboard.bookings', 'Bookings')}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <PerformanceChart
          title={t('dashboard.servicePerformance', 'Service Performance')}
          data={serviceChartData}
          metric="revenue"
        />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <PerformanceChart
          title={t('dashboard.bookingsByService', 'Bookings by Service')}
          data={serviceChartData}
          metric="bookings"
        />
      </div>

      {/* Upcoming Bookings */}
      {upcomingBookings.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              {t('dashboard.upcomingBookings', 'Upcoming Bookings')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingBookings.map((booking) => {
              const slot = booking.slots;
              const service = booking.services as any;
              const serviceName = i18n.language === 'ar' && service?.name_ar ? service.name_ar : (service?.name || t('service.unknown'));
              const bookingDate = slot?.slot_date ? format(new Date(slot.slot_date), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined }) : 'N/A';
              
              return (
                <Card key={booking.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-500" />
                          <h3 className="font-semibold text-gray-900">{booking.customer_name}</h3>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          booking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                          booking.status === 'checked_in' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {safeTranslateStatus(t, booking.status, 'booking')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{serviceName}</p>
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <Calendar className="w-4 h-4" />
                        <span>{bookingDate}</span>
                      </div>
                      {slot?.start_time && slot?.end_time && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <span>{formatTimeTo12Hour(slot.start_time)} - {formatTimeTo12Hour(slot.end_time)}</span>
                        </div>
                      )}
                      <div className="pt-2 border-t text-sm">
                        <span className="font-medium text-gray-900">
                          {formatPrice(parseFloat(booking.total_price?.toString() || '0'))}
                        </span>
                        {booking.visitor_count > 1 && (
                          <span className="text-gray-600 ml-2">
                            ({booking.visitor_count} {t('booking.visitors', 'visitors')})
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Expired Bookings */}
      {expiredBookings.length > 0 && (
        <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <XCircle className="w-5 h-5 text-gray-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                {t('dashboard.expiredBookings', 'Past Bookings')}
              </h2>
            </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {expiredBookings.map((booking) => {
              const slot = booking.slots;
              const service = booking.services as any;
              const serviceName = i18n.language === 'ar' && service?.name_ar ? service.name_ar : (service?.name || t('service.unknown'));
              const bookingDate = slot?.slot_date ? format(new Date(slot.slot_date), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined }) : 'N/A';
              
              return (
                <Card key={booking.id} className="hover:shadow-md transition-shadow opacity-75">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-500" />
                          <h3 className="font-semibold text-gray-700">{booking.customer_name}</h3>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          booking.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                          booking.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {safeTranslateStatus(t, booking.status, 'booking')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{serviceName}</p>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Calendar className="w-4 h-4" />
                        <span>{bookingDate}</span>
                      </div>
                      {slot?.start_time && slot?.end_time && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <span>{formatTimeTo12Hour(slot.start_time)} - {formatTimeTo12Hour(slot.end_time)}</span>
                        </div>
                      )}
                      <div className="pt-2 border-t text-sm">
                        <span className="font-medium text-gray-700">
                          {formatPrice(parseFloat(booking.total_price?.toString() || '0'))}
                        </span>
                        {booking.visitor_count > 1 && (
                          <span className="text-gray-500 ml-2">
                            ({booking.visitor_count} {t('booking.visitors', 'visitors')})
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
        </>
      )}

      {viewMode === 'calendar' && (
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
                {t('dashboard.today', 'Today')}
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
                <div className="px-2 py-3 text-xs font-medium text-gray-500 border-r">{t('dashboard.time', 'Time')}</div>
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
    </div>
  );
}
