export const DASHBOARD_LAYOUT_VERSION = 1;

export type DashboardWidgetId =
  | 'totalBookings'
  | 'bookingRevenue'
  | 'paidBookings'
  | 'unpaidBookings'
  | 'packageSubscriptions'
  | 'packageRevenue'
  | 'completedBookings'
  | 'averageBookingValue'
  | 'totalRevenueCombined'
  | 'revenueByService'
  | 'serviceBookingComparison'
  | 'servicePerformanceRevenue'
  | 'bookingsByService'
  | 'upcomingBookings'
  | 'pastBookings';

export interface DashboardLayoutItem {
  id: DashboardWidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

export interface DashboardLayoutConfig {
  version: number;
  widgets: DashboardLayoutItem[];
}

export interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  nameKey: string;
  fallbackName: string;
  descriptionKey: string;
  fallbackDescription: string;
  defaultLayout: Omit<DashboardLayoutItem, 'id' | 'visible'>;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}

export const DASHBOARD_WIDGET_DEFINITIONS: DashboardWidgetDefinition[] = [
  {
    id: 'totalBookings',
    nameKey: 'dashboard.totalBookings',
    fallbackName: 'Total Bookings',
    descriptionKey: 'dashboard.widgetDesc.totalBookings',
    fallbackDescription: 'Shows total bookings in selected period.',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minW: 3,
    maxW: 6,
  },
  {
    id: 'bookingRevenue',
    nameKey: 'dashboard.bookingRevenue',
    fallbackName: 'Booking Revenue',
    descriptionKey: 'dashboard.widgetDesc.bookingRevenue',
    fallbackDescription: 'Shows booking revenue split by paid/unpaid.',
    defaultLayout: { x: 4, y: 0, w: 4, h: 2 },
    minW: 3,
    maxW: 8,
  },
  {
    id: 'paidBookings',
    nameKey: 'dashboard.paidBookings',
    fallbackName: 'Paid Bookings',
    descriptionKey: 'dashboard.widgetDesc.paidBookings',
    fallbackDescription: 'Count of paid bookings.',
    defaultLayout: { x: 8, y: 0, w: 4, h: 2 },
    minW: 3,
    maxW: 6,
  },
  {
    id: 'unpaidBookings',
    nameKey: 'dashboard.unpaidBookings',
    fallbackName: 'Unpaid Bookings',
    descriptionKey: 'dashboard.widgetDesc.unpaidBookings',
    fallbackDescription: 'Count of unpaid bookings.',
    defaultLayout: { x: 0, y: 2, w: 4, h: 2 },
    minW: 3,
    maxW: 6,
  },
  {
    id: 'packageSubscriptions',
    nameKey: 'dashboard.packageSubscriptions',
    fallbackName: 'Package Subscriptions',
    descriptionKey: 'dashboard.widgetDesc.packageSubscriptions',
    fallbackDescription: 'Shows package subscription count.',
    defaultLayout: { x: 4, y: 2, w: 4, h: 2 },
    minW: 3,
    maxW: 6,
  },
  {
    id: 'packageRevenue',
    nameKey: 'dashboard.packageRevenue',
    fallbackName: 'Package Revenue',
    descriptionKey: 'dashboard.widgetDesc.packageRevenue',
    fallbackDescription: 'Shows package revenue total.',
    defaultLayout: { x: 8, y: 2, w: 4, h: 2 },
    minW: 3,
    maxW: 6,
  },
  {
    id: 'completedBookings',
    nameKey: 'dashboard.completedBookings',
    fallbackName: 'Completed Bookings',
    descriptionKey: 'dashboard.widgetDesc.completedBookings',
    fallbackDescription: 'Count of completed bookings.',
    defaultLayout: { x: 0, y: 4, w: 6, h: 2 },
    minW: 3,
    maxW: 8,
  },
  {
    id: 'averageBookingValue',
    nameKey: 'dashboard.averageBookingValue',
    fallbackName: 'Average Booking Value',
    descriptionKey: 'dashboard.widgetDesc.averageBookingValue',
    fallbackDescription: 'Average booking value in selected period.',
    defaultLayout: { x: 6, y: 4, w: 6, h: 2 },
    minW: 3,
    maxW: 8,
  },
  {
    id: 'totalRevenueCombined',
    nameKey: 'dashboard.totalRevenueCombined',
    fallbackName: 'Total Revenue (Bookings + Packages)',
    descriptionKey: 'dashboard.widgetDesc.totalRevenueCombined',
    fallbackDescription: 'Combined total revenue.',
    defaultLayout: { x: 0, y: 6, w: 12, h: 1 },
    minW: 6,
    maxW: 12,
    minH: 1,
    maxH: 2,
  },
  {
    id: 'revenueByService',
    nameKey: 'dashboard.revenueByService',
    fallbackName: 'Revenue by Service',
    descriptionKey: 'dashboard.widgetDesc.revenueByService',
    fallbackDescription: 'Pie chart for service revenue.',
    defaultLayout: { x: 0, y: 7, w: 12, h: 4 },
    minW: 6,
    maxW: 12,
  },
  {
    id: 'serviceBookingComparison',
    nameKey: 'dashboard.serviceBookingComparison',
    fallbackName: 'Service Booking Comparison',
    descriptionKey: 'dashboard.widgetDesc.serviceBookingComparison',
    fallbackDescription: 'Compares booking trends by service.',
    defaultLayout: { x: 0, y: 11, w: 12, h: 4 },
    minW: 6,
    maxW: 12,
  },
  {
    id: 'servicePerformanceRevenue',
    nameKey: 'dashboard.servicePerformance',
    fallbackName: 'Service Performance',
    descriptionKey: 'dashboard.widgetDesc.servicePerformanceRevenue',
    fallbackDescription: 'Performance chart by revenue.',
    defaultLayout: { x: 0, y: 15, w: 12, h: 4 },
    minW: 6,
    maxW: 12,
  },
  {
    id: 'bookingsByService',
    nameKey: 'dashboard.bookingsByService',
    fallbackName: 'Bookings by Service',
    descriptionKey: 'dashboard.widgetDesc.bookingsByService',
    fallbackDescription: 'Performance chart by bookings count.',
    defaultLayout: { x: 0, y: 19, w: 12, h: 4 },
    minW: 6,
    maxW: 12,
  },
  {
    id: 'upcomingBookings',
    nameKey: 'dashboard.upcomingBookings',
    fallbackName: 'Upcoming Bookings',
    descriptionKey: 'dashboard.widgetDesc.upcomingBookings',
    fallbackDescription: 'Upcoming bookings cards list.',
    defaultLayout: { x: 0, y: 23, w: 12, h: 5 },
    minW: 6,
    maxW: 12,
  },
  {
    id: 'pastBookings',
    nameKey: 'dashboard.expiredBookings',
    fallbackName: 'Past Bookings',
    descriptionKey: 'dashboard.widgetDesc.pastBookings',
    fallbackDescription: 'Past bookings cards list.',
    defaultLayout: { x: 0, y: 28, w: 12, h: 5 },
    minW: 6,
    maxW: 12,
  },
];

export const DASHBOARD_WIDGET_IDS = DASHBOARD_WIDGET_DEFINITIONS.map((w) => w.id);
const DASHBOARD_WIDGET_MIN_HEIGHT_ROWS: Partial<Record<DashboardWidgetId, number>> = {};

export function getDashboardWidgetMinHeightRows(widgetId: DashboardWidgetId): number {
  return DASHBOARD_WIDGET_MIN_HEIGHT_ROWS[widgetId] ?? 1;
}

export function getDefaultDashboardLayoutConfig(): DashboardLayoutConfig {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: DASHBOARD_WIDGET_DEFINITIONS.map((def) => ({
      id: def.id,
      ...def.defaultLayout,
      visible: true,
    })),
  };
}

export function sanitizeDashboardLayoutConfig(
  input: unknown,
  fallback = getDefaultDashboardLayoutConfig()
): DashboardLayoutConfig {
  if (!input || typeof input !== 'object') return fallback;
  const raw = input as Partial<DashboardLayoutConfig>;
  const rawWidgets = Array.isArray(raw.widgets) ? raw.widgets : [];
  const byId = new Map<string, DashboardLayoutItem>();

  for (const item of rawWidgets) {
    if (!item || typeof item !== 'object') continue;
    const cast = item as Partial<DashboardLayoutItem>;
    if (!cast.id || !DASHBOARD_WIDGET_IDS.includes(cast.id)) continue;
    const width = Number.isFinite(cast.w) ? Math.max(1, Math.min(12, Number(cast.w))) : 4;
    const minHeight = getDashboardWidgetMinHeightRows(cast.id);
    const height = Number.isFinite(cast.h) ? Math.max(minHeight, Math.min(12, Number(cast.h))) : Math.max(minHeight, 2);
    const x = Number.isFinite(cast.x) ? Math.max(0, Math.min(12 - width, Number(cast.x))) : 0;
    const y = Number.isFinite(cast.y) ? Math.max(0, Number(cast.y)) : 0;
    byId.set(cast.id, {
      id: cast.id,
      x,
      y,
      w: width,
      h: height,
      visible: cast.visible !== false,
    });
  }

  const merged = DASHBOARD_WIDGET_DEFINITIONS.map((def) => {
    const found = byId.get(def.id);
    return {
      id: def.id,
      x: found?.x ?? def.defaultLayout.x,
      y: found?.y ?? def.defaultLayout.y,
      w: found?.w ?? def.defaultLayout.w,
      h: found?.h ?? def.defaultLayout.h,
      visible: found?.visible ?? true,
    };
  });

  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: merged,
  };
}
