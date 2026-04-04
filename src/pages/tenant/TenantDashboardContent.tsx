import { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { safeTranslateStatus } from '../../lib/safeTranslation';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { db } from '../../lib/db';
import { getApiUrl } from '../../lib/apiUrl';
import { getAuthHeaders } from '../../lib/apiClient';
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
import {
  DashboardLayoutConfig,
  DashboardWidgetId,
  getDashboardWidgetMinHeightRows,
  getDefaultDashboardLayoutConfig,
  sanitizeDashboardLayoutConfig,
} from '../../lib/dashboardWidgets';
import { DashboardProfile, getDashboardLayout, getDashboardProfiles } from '../../lib/dashboardLayoutApi';

interface ServicePerformance {
  id: string;
  name: string;
  bookings: number;
  revenue: number;
  paidRevenue: number;
  unpaidRevenue: number;
  dailyData: { date: string; bookings: number; revenue: number }[];
}


export function TenantDashboardContent() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { userProfile, tenant, hasPermission } = useAuth();
  const { formatPrice, formatPriceString } = useCurrency();
  const { features } = useTenantFeatures(tenant?.id);
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [stats, setStats] = useState({
    totalBookings: 0,
    paidBookings: 0,
    unpaidBookings: 0,
    totalRevenue: 0,
    paidBookingRevenue: 0,
    unpaidBookingRevenue: 0,
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
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [layoutConfig, setLayoutConfig] = useState<DashboardLayoutConfig>(getDefaultDashboardLayoutConfig());
  const [activeProfileKey, setActiveProfileKey] = useState('default');
  const [dashboardProfiles, setDashboardProfiles] = useState<DashboardProfile[]>([{ key: 'default', name: 'Default', predefined: true }]);
  const isInitialLoadRef = useRef(true);
  const widgetContentRefs = useRef<Partial<Record<DashboardWidgetId, HTMLDivElement | null>>>({});
  const [contentRowsByWidget, setContentRowsByWidget] = useState<Partial<Record<DashboardWidgetId, number>>>({});
  const canCustomizeDashboard = hasPermission('customize_dashboard');
  const profileStorageKey = `dashboard_active_profile:${tenant?.slug || userProfile?.tenant_id || 'tenant'}`;
  const GRID_ROW_PX = 44;

  useEffect(() => {
    if (!userProfile) return;
    const isDateRangeChange = !isInitialLoadRef.current;
    fetchStats(isDateRangeChange);
  }, [userProfile, timeRange, customStartDate, customEndDate, i18n.language]);

  useEffect(() => {
    if (!userProfile) return;
    if (viewMode === 'calendar') fetchCalendarBookings();
    else fetchDashboardBookings();
  }, [userProfile, viewMode, calendarDate, timeRange, customStartDate, customEndDate]);

  useEffect(() => {
    if (!canCustomizeDashboard) return;
    let isActive = true;
    (async () => {
      try {
        const fetchedProfiles = await getDashboardProfiles();
        if (!isActive) return;
        if (fetchedProfiles.length > 0) setDashboardProfiles(fetchedProfiles);
        const storedKey = localStorage.getItem(profileStorageKey) || 'default';
        const exists = fetchedProfiles.some((profile) => profile.key === storedKey);
        const effective = exists ? storedKey : 'default';
        setActiveProfileKey(effective);
        localStorage.setItem(profileStorageKey, effective);
      } catch {
        if (!isActive) return;
        setDashboardProfiles([{ key: 'default', name: 'Default', predefined: true }]);
        setActiveProfileKey('default');
      }
    })();
    return () => {
      isActive = false;
    };
  }, [canCustomizeDashboard, profileStorageKey]);

  useEffect(() => {
    if (!userProfile || !canCustomizeDashboard) return;
    let isActive = true;
    const search = new URLSearchParams(location.search);
    const isPreviewMode = search.get('layoutPreview') === '1';

    if (isPreviewMode) {
      const previewDraft = sessionStorage.getItem('dashboard_layout_preview_draft');
      if (previewDraft) {
        try {
          setLayoutConfig(sanitizeDashboardLayoutConfig(JSON.parse(previewDraft)));
          return () => {
            isActive = false;
          };
        } catch {
          // Ignore parse errors and fall back to persisted layout.
        }
      }
    }

    (async () => {
      try {
        const { layout } = await getDashboardLayout(activeProfileKey);
        if (!isActive) return;
        setLayoutConfig(sanitizeDashboardLayoutConfig(layout));
      } catch {
        if (!isActive) return;
        setLayoutConfig(getDefaultDashboardLayoutConfig());
      }
    })();

    return () => {
      isActive = false;
    };
  }, [userProfile?.id, canCustomizeDashboard, location.search, activeProfileKey]);

  // Lightweight auto-refresh for real-time feel without heavy load.
  useEffect(() => {
    if (!userProfile) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchStats(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [userProfile, timeRange, customStartDate, customEndDate, i18n.language]);

  function getDateRange(): { start?: Date; end?: Date } {
    const now = new Date();

    switch (timeRange) {
      case 'all_time':
        return {};
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
        return {};
      default:
        return {};
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
      const qs = new URLSearchParams();
      if (start && end) {
        qs.set('startDate', format(start, 'yyyy-MM-dd'));
        qs.set('endDate', format(end, 'yyyy-MM-dd'));
      }
      const response = await fetch(`${getApiUrl()}/reports/dashboard-summary?${qs.toString()}`, {
        headers: getAuthHeaders(),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Failed to load dashboard summary');

      const summary = json?.summary || {};
      const services = Array.isArray(json?.servicePerformance) ? json.servicePerformance : [];

      setStats({
        totalBookings: Number(summary.totalBookings || 0),
        paidBookings: Number(summary.paidBookings || 0),
        unpaidBookings: Number(summary.unpaidBookings || 0),
        totalRevenue: Number(summary.bookingRevenue || 0),
        paidBookingRevenue: Number(summary.paidBookingRevenue || 0),
        unpaidBookingRevenue: Number(summary.unpaidBookingRevenue || 0),
        packageSubscriptions: Number(summary.packageSubscriptions || 0),
        packageRevenue: Number(summary.packageRevenue || 0),
        completedBookings: Number(summary.completedBookings || 0),
        averageBookingValue: Number(summary.averageBookingValue || 0),
      });

      setServicePerformance(
        services.map((service: any) => ({
          id: service.id,
          name: i18n.language === 'ar' && service.name_ar ? service.name_ar : (service.name || t('service.unknown')),
          bookings: Number(service.bookings || 0),
          revenue: Number(service.revenue || 0),
          paidRevenue: Number(service.paidRevenue || 0),
          unpaidRevenue: Number(service.unpaidRevenue || 0),
          dailyData: Array.isArray(service.dailyData)
            ? service.dailyData.map((d: any) => ({
                date: String(d.date || ''),
                bookings: Number(d.bookings || 0),
                revenue: Number(d.revenue || 0),
              }))
            : [],
        }))
      );
      setLastUpdatedAt(new Date());
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      isInitialLoadRef.current = false;
      setLoading(false);
    }
  }

  async function refreshNow() {
    setIsRefreshing(true);
    try {
      await fetchStats(true);
      if (viewMode === 'calendar') await fetchCalendarBookings();
      else await fetchDashboardBookings();
    } finally {
      setIsRefreshing(false);
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

      const { start, end } = getDateRange();
      const filteredBookings = (bookings || []).filter((booking: any) => {
        const slotDateRaw = booking.slots?.slot_date as string | undefined;
        if (!slotDateRaw || !start || !end) return true;

        const bookingDate = parse(slotDateRaw.substring(0, 10), 'yyyy-MM-dd', new Date());
        return bookingDate >= startOfDay(start) && bookingDate <= endOfDay(end);
      });

      setDashboardBookings(filteredBookings);
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

  const visibleWidgets = useMemo(
    () =>
      sanitizeDashboardLayoutConfig(layoutConfig).widgets
        .filter((w) => w.visible)
        .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y)),
    [layoutConfig]
  );

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || viewMode !== 'dashboard') return;

    const observer = new ResizeObserver((entries) => {
      setContentRowsByWidget((prev) => {
        let changed = false;
        const next: Partial<Record<DashboardWidgetId, number>> = { ...prev };

        for (const entry of entries) {
          const element = entry.target as HTMLDivElement;
          const widgetId = element.dataset.widgetId as DashboardWidgetId | undefined;
          if (!widgetId) continue;
          const rows = Math.max(1, Math.ceil((entry.contentRect.height + 8) / GRID_ROW_PX));
          if (next[widgetId] !== rows) {
            next[widgetId] = rows;
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    });

    for (const widget of visibleWidgets) {
      const el = widgetContentRefs.current[widget.id];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [visibleWidgets, viewMode]);

  const arrangedWidgets = useMemo(() => {
    const placed: Array<{ id: DashboardWidgetId; x: number; y: number; w: number; h: number }> = [];
    const sorted = [...visibleWidgets].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    const autoExpandWidgetIds = new Set<DashboardWidgetId>([
      'revenueByService',
      'serviceBookingComparison',
      'servicePerformanceRevenue',
      'bookingsByService',
      'upcomingBookings',
      'pastBookings',
    ]);
    const maxRowsByWidget: Partial<Record<DashboardWidgetId, number>> = {
      revenueByService: 8,
      serviceBookingComparison: 10,
      servicePerformanceRevenue: 6,
      bookingsByService: 6,
      upcomingBookings: 10,
      pastBookings: 10,
    };

    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
      const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
      const yOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
      return xOverlap && yOverlap;
    };

    for (const widget of sorted) {
      const minRows = getDashboardWidgetMinHeightRows(widget.id);
      const contentRows = contentRowsByWidget[widget.id] ?? 1;
      const maxRows = maxRowsByWidget[widget.id] ?? 12;
      const expandedRows = autoExpandWidgetIds.has(widget.id)
        ? Math.max(minRows, contentRows)
        : Math.max(widget.h, minRows);
      const effectiveHeight = Math.max(minRows, Math.min(maxRows, expandedRows));
      const candidate = { id: widget.id, x: widget.x, y: 0, w: widget.w, h: effectiveHeight };
      while (placed.some((existing) => overlaps(candidate, existing))) {
        candidate.y += 1;
      }
      placed.push(candidate);
    }

    return placed;
  }, [visibleWidgets, contentRowsByWidget]);

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

  const servicePieData = servicePerformance.map((service, index) => ({
    label: service.name,
    value: service.revenue,
    color: colors[index % colors.length],
    paidLabel: formatPriceString(service.paidRevenue),
    unpaidLabel: formatPriceString(service.unpaidRevenue),
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

  function formatSlotDateLabel(slotDateRaw?: string) {
    if (!slotDateRaw) return 'N/A';
    const parsedDate = parse(slotDateRaw.substring(0, 10), 'yyyy-MM-dd', new Date());
    if (Number.isNaN(parsedDate.getTime())) return 'N/A';
    return format(parsedDate, 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined });
  }

  function renderDashboardWidget(widgetId: DashboardWidgetId) {
    switch (widgetId) {
      case 'totalBookings':
        return (
          <StatCard
            title={t('dashboard.totalBookings', 'Total Bookings')}
            value={stats.totalBookings}
            icon={Calendar}
            iconColor="text-blue-600"
            iconBgColor="bg-blue-100"
          />
        );
      case 'bookingRevenue':
        return (
          <StatCard
            title={t('dashboard.bookingRevenue', 'Booking Revenue')}
            value={formatPrice(stats.totalRevenue)}
            subtitle={`${t('dashboard.paidLabel', 'Paid')}: ${formatPriceString(stats.paidBookingRevenue)} | ${t('dashboard.unpaidLabel', 'Unpaid')}: ${formatPriceString(stats.unpaidBookingRevenue)}`}
            icon={DollarSign}
            iconColor="text-green-600"
            iconBgColor="bg-green-100"
          />
        );
      case 'paidBookings':
        return (
          <StatCard
            title={t('dashboard.paidBookings', 'Paid Bookings')}
            value={stats.paidBookings}
            icon={CheckCircle}
            iconColor="text-emerald-600"
            iconBgColor="bg-emerald-100"
          />
        );
      case 'unpaidBookings':
        return (
          <StatCard
            title={t('dashboard.unpaidBookings', 'Unpaid Bookings')}
            value={stats.unpaidBookings}
            icon={XCircle}
            iconColor="text-amber-600"
            iconBgColor="bg-amber-100"
          />
        );
      case 'packageSubscriptions':
        return (
          <StatCard
            title={t('dashboard.packageSubscriptions', 'Package Subscriptions')}
            value={stats.packageSubscriptions}
            icon={Package}
            iconColor="text-violet-600"
            iconBgColor="bg-violet-100"
          />
        );
      case 'packageRevenue':
        return (
          <StatCard
            title={t('dashboard.packageRevenue', 'Package Revenue')}
            value={formatPrice(stats.packageRevenue)}
            icon={Package}
            iconColor="text-purple-600"
            iconBgColor="bg-purple-100"
          />
        );
      case 'completedBookings':
        return (
          <StatCard
            title={t('dashboard.completedBookings', 'Completed Bookings')}
            value={stats.completedBookings}
            icon={CheckCircle}
            iconColor="text-teal-600"
            iconBgColor="bg-teal-100"
          />
        );
      case 'averageBookingValue':
        return (
          <StatCard
            title={t('dashboard.averageBookingValue', 'Average Booking Value')}
            value={formatPrice(stats.averageBookingValue)}
            icon={TrendingUp}
            iconColor="text-orange-600"
            iconBgColor="bg-orange-100"
          />
        );
      case 'totalRevenueCombined':
        return (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-600">
              {t('dashboard.totalRevenueCombined', 'Total Revenue (Bookings + Packages)')}:{' '}
              <span className="font-semibold text-gray-900">
                {formatPrice(stats.totalRevenue + stats.packageRevenue)}
              </span>
            </p>
          </div>
        );
      case 'revenueByService':
        return (
          <PieChart
            title={t('dashboard.revenueByService', 'Revenue by Service')}
            data={servicePieData}
          />
        );
      case 'serviceBookingComparison':
        return (
          <ComparisonChart
            title={t('dashboard.serviceBookingComparison', 'Service Booking Comparison')}
            series={serviceComparisonSeries}
            valueLabel={t('dashboard.bookings', 'Bookings')}
          />
        );
      case 'servicePerformanceRevenue':
        return (
          <PerformanceChart
            title={t('dashboard.servicePerformance', 'Service Performance')}
            data={serviceChartData}
            metric="revenue"
          />
        );
      case 'bookingsByService':
        return (
          <PerformanceChart
            title={t('dashboard.bookingsByService', 'Bookings by Service')}
            data={serviceChartData}
            metric="bookings"
          />
        );
      case 'upcomingBookings':
        if (upcomingBookings.length === 0) return null;
        return (
          <div className="h-full min-h-0 flex flex-col">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <Clock className="w-5 h-5 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                {t('dashboard.upcomingBookings', 'Upcoming Bookings')}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-auto min-h-0 pr-1">
              {upcomingBookings.map((booking) => {
                const slot = booking.slots;
                const service = booking.services as any;
                const serviceName = i18n.language === 'ar' && service?.name_ar ? service.name_ar : (service?.name || t('service.unknown'));
                const bookingDate = formatSlotDateLabel(slot?.slot_date);
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
        );
      case 'pastBookings':
        if (expiredBookings.length === 0) return null;
        return (
          <div className="h-full min-h-0 flex flex-col">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <XCircle className="w-5 h-5 text-gray-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                {t('dashboard.expiredBookings', 'Past Bookings')}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-auto min-h-0 pr-1">
              {expiredBookings.map((booking) => {
                const slot = booking.slots;
                const service = booking.services as any;
                const serviceName = i18n.language === 'ar' && service?.name_ar ? service.name_ar : (service?.name || t('service.unknown'));
                const bookingDate = formatSlotDateLabel(slot?.slot_date);
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
        );
      default:
        return null;
    }
  }

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

      <div className="mb-4 flex justify-end">
        <div className="flex items-center gap-2">
          {canCustomizeDashboard && (
            <select
              value={activeProfileKey}
              onChange={(e) => {
                const nextProfile = e.target.value;
                setActiveProfileKey(nextProfile);
                localStorage.setItem(profileStorageKey, nextProfile);
              }}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 bg-white"
            >
              {dashboardProfiles.map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={refreshNow}
            disabled={isRefreshing}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isRefreshing ? t('dashboard.refreshing', 'Refreshing...') : t('dashboard.refreshNow', 'Refresh now')}
          </button>
        </div>
      </div>

      {new URLSearchParams(location.search).get('layoutPreview') === '1' && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          {t('dashboard.previewModeBanner', 'Preview mode: showing draft dashboard layout (not saved yet).')}
        </div>
      )}

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
          <div className="mt-6 grid grid-cols-12 gap-6 auto-rows-[44px]">
            {arrangedWidgets.map((widget) => {
              const content = renderDashboardWidget(widget.id);
              if (!content) return null;
              const span = Math.max(1, Math.min(12, widget.w));
              const colStart = Math.max(1, Math.min(13 - span, widget.x + 1));
              const rowStart = Math.max(1, widget.y + 1);
              const rowSpan = Math.max(1, widget.h);
              return (
                <div
                  key={widget.id}
                  className="min-h-0 overflow-hidden"
                  style={{
                    gridColumn: `${colStart} / span ${span}`,
                    gridRow: `${rowStart} / span ${rowSpan}`,
                  }}
                >
                  <div
                    className="min-h-0"
                    data-widget-id={widget.id}
                    ref={(el) => {
                      widgetContentRefs.current[widget.id] = el;
                    }}
                  >
                    {content}
                  </div>
                </div>
              );
            })}
          </div>
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
