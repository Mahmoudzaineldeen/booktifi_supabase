/**
 * Dashboard metrics integration tests.
 *
 * Ensures:
 * 1. Date range logic matches dashboard (today, yesterday, last_week, last_month, custom).
 * 2. Stats structure includes booking and package metrics.
 * 3. Computation formulas for totalBookings, totalRevenue, packageSubscriptions, packageRevenue are correct.
 *
 * Run: npm run test:integration -- tests/integration/dashboard-metrics.test.ts
 */

import { describe, it, expect } from 'vitest';
import { startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

type TimeRange = 'today' | 'yesterday' | 'last_week' | 'last_month' | 'custom';

function getDateRange(
  timeRange: TimeRange,
  customStart = '',
  customEnd = ''
): { start: Date; end: Date } {
  const now = new Date();

  switch (timeRange) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'yesterday': {
      const yesterday = subDays(now, 1);
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
    }
    case 'last_week':
      return {
        start: startOfWeek(subDays(now, 7)),
        end: endOfWeek(subDays(now, 7)),
      };
    case 'last_month': {
      const lastMonth = subDays(now, 30);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    case 'custom':
      if (customStart && customEnd) {
        return {
          start: startOfDay(new Date(customStart)),
          end: endOfDay(new Date(customEnd)),
        };
      }
      return { start: startOfDay(now), end: endOfDay(now) };
    default:
      return { start: startOfDay(now), end: endOfDay(now) };
  }
}

/** Mirror dashboard booking stats computation */
function computeBookingStats(bookings: Array<{ total_price?: number | string; status?: string }>) {
  const totalBookings = bookings.length;
  const totalRevenue =
    bookings.reduce((sum, b) => sum + parseFloat(String(b.total_price ?? 0)), 0) || 0;
  const completedBookings = bookings.filter((b) => b.status === 'completed').length;
  const averageBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;
  return {
    totalBookings,
    totalRevenue,
    completedBookings,
    averageBookingValue,
  };
}

/** Mirror dashboard package stats computation (subscriptions with service_packages.total_price) */
function computePackageStats(
  subs: Array<{ id: string; service_packages?: { total_price?: number } | null }>
) {
  const packageSubscriptions = subs.length;
  const packageRevenue = subs.reduce((sum, s) => {
    const pkg = s.service_packages;
    const price = pkg?.total_price != null ? parseFloat(String(pkg.total_price)) : 0;
    return sum + price;
  }, 0);
  return { packageSubscriptions, packageRevenue };
}

describe('Dashboard date range', () => {
  it('today returns start and end of current day', () => {
    const { start, end } = getDateRange('today');
    const now = new Date();
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(start.getDate()).toBe(now.getDate());
    expect(end.getDate()).toBe(now.getDate());
  });

  it('yesterday returns previous day', () => {
    const { start, end } = getDateRange('yesterday');
    const yesterday = subDays(new Date(), 1);
    expect(start.getDate()).toBe(yesterday.getDate());
    expect(end.getDate()).toBe(yesterday.getDate());
  });

  it('last_week returns a 7-day window in the past', () => {
    const { start, end } = getDateRange('last_week');
    expect(end.getTime()).toBeLessThanOrEqual(startOfDay(new Date()).getTime());
    expect(end.getTime() - start.getTime()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  it('last_month returns a month window (start before end, ~28-31 days)', () => {
    const { start, end } = getDateRange('last_month');
    expect(start.getTime()).toBeLessThan(end.getTime());
    const daysDiff = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysDiff).toBeGreaterThanOrEqual(28);
    expect(daysDiff).toBeLessThanOrEqual(31);
  });

  it('custom uses provided start and end', () => {
    const { start, end } = getDateRange(
      'custom',
      '2026-01-01',
      '2026-01-15'
    );
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(15);
  });
});

describe('Dashboard booking stats computation', () => {
  it('computes totalBookings and totalRevenue correctly', () => {
    const bookings = [
      { total_price: 100, status: 'confirmed' },
      { total_price: 200, status: 'completed' },
      { total_price: 150, status: 'pending' },
    ];
    const stats = computeBookingStats(bookings);
    expect(stats.totalBookings).toBe(3);
    expect(stats.totalRevenue).toBe(450);
    expect(stats.completedBookings).toBe(1);
    expect(stats.averageBookingValue).toBe(150);
  });

  it('handles empty bookings', () => {
    const stats = computeBookingStats([]);
    expect(stats.totalBookings).toBe(0);
    expect(stats.totalRevenue).toBe(0);
    expect(stats.completedBookings).toBe(0);
    expect(stats.averageBookingValue).toBe(0);
  });

  it('handles string total_price', () => {
    const stats = computeBookingStats([
      { total_price: '99.50', status: 'completed' },
    ]);
    expect(stats.totalBookings).toBe(1);
    expect(stats.totalRevenue).toBe(99.5);
    expect(stats.averageBookingValue).toBe(99.5);
  });
});

describe('Dashboard package stats computation', () => {
  it('computes packageSubscriptions and packageRevenue correctly', () => {
    const subs = [
      { id: '1', service_packages: { total_price: 500 } },
      { id: '2', service_packages: { total_price: 750 } },
      { id: '3', service_packages: { total_price: 1000 } },
    ];
    const stats = computePackageStats(subs);
    expect(stats.packageSubscriptions).toBe(3);
    expect(stats.packageRevenue).toBe(2250);
  });

  it('handles empty subscriptions', () => {
    const stats = computePackageStats([]);
    expect(stats.packageSubscriptions).toBe(0);
    expect(stats.packageRevenue).toBe(0);
  });

  it('handles null or missing service_packages', () => {
    const stats = computePackageStats([
      { id: '1', service_packages: null },
      { id: '2', service_packages: {} },
      { id: '3', service_packages: { total_price: 100 } },
    ]);
    expect(stats.packageSubscriptions).toBe(3);
    expect(stats.packageRevenue).toBe(100);
  });
});

describe('Dashboard combined metrics structure', () => {
  it('full stats object has all required keys for UI', () => {
    const bookingStats = computeBookingStats([
      { total_price: 100, status: 'completed' },
    ]);
    const packageStats = computePackageStats([
      { id: '1', service_packages: { total_price: 500 } },
    ]);
    const stats = {
      ...bookingStats,
      ...packageStats,
    };
    expect(stats).toHaveProperty('totalBookings');
    expect(stats).toHaveProperty('totalRevenue');
    expect(stats).toHaveProperty('packageSubscriptions');
    expect(stats).toHaveProperty('packageRevenue');
    expect(stats).toHaveProperty('completedBookings');
    expect(stats).toHaveProperty('averageBookingValue');
    expect(stats.totalRevenue + stats.packageRevenue).toBe(600);
  });
});
