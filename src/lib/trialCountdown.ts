import { differenceInCalendarDays, differenceInHours, differenceInMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { ar } from 'date-fns/locale';
import type { Tenant } from '../types';

export function shouldShowTrialCountdownBanner(tenant: Tenant | null | undefined, nowMs = Date.now()): boolean {
  if (!tenant?.trial_ends_at) return false;
  if (tenant.trial_status === 'expired') return false;
  if (tenant.is_active === false) return false;
  const enabled = (tenant as Tenant & { trial_countdown_enabled?: unknown }).trial_countdown_enabled;
  // Opt-out: show whenever a future trial end is set unless the tenant explicitly disabled the strip.
  if (enabled === false || enabled === 'false' || enabled === 0) return false;
  const endMs = new Date(tenant.trial_ends_at).getTime();
  if (!Number.isFinite(endMs)) return false;
  return endMs > nowMs;
}

export function isTenantAccessLocked(tenant: Tenant | null | undefined): boolean {
  return !!(tenant && tenant.is_active === false);
}

/** Remaining time broken into units for digit-style UI (uses wall-clock ms, not calendar-day rounding). */
export type TrialCountdownParts = {
  totalMsLeft: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export function getTrialCountdownParts(
  tenant: Tenant | null | undefined,
  nowMs: number
): TrialCountdownParts | null {
  if (!tenant?.trial_ends_at) return null;
  const endMs = new Date(tenant.trial_ends_at as string).getTime();
  if (!Number.isFinite(endMs)) return null;
  const totalMsLeft = endMs - nowMs;
  if (totalMsLeft <= 0) return null;
  const days = Math.floor(totalMsLeft / 86_400_000);
  const hours = Math.floor((totalMsLeft % 86_400_000) / 3_600_000);
  const minutes = Math.floor((totalMsLeft % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMsLeft % 60_000) / 1000);
  return { totalMsLeft, days, hours, minutes, seconds };
}

/**
 * Elapsed fraction of the trial window from subscription_start (or created_at) to trial_ends_at.
 * Used for a progress bar; returns null if dates are missing or invalid.
 */
export function getTrialElapsedRatio(tenant: Tenant | null | undefined, nowMs: number): number | null {
  if (!tenant?.trial_ends_at) return null;
  const end = new Date(tenant.trial_ends_at as string).getTime();
  const startRaw = tenant.subscription_start || tenant.created_at;
  if (!startRaw) return null;
  const start = new Date(startRaw as string).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const r = (nowMs - start) / (end - start);
  return Math.min(1, Math.max(0, r));
}

/**
 * Time-until-trial-end line only (ignores `trial_message_override`).
 * Use this when the UI should always show the countdown and treat override as a separate hint.
 */
export function formatTrialCountdownCore(tenant: Tenant, nowMs: number, lang: string): string {
  if (!tenant.trial_ends_at) return '';

  const endMs = new Date(tenant.trial_ends_at as string).getTime();
  if (!Number.isFinite(endMs)) return '';

  const tz = tenant.announced_time_zone || tenant.tenant_time_zone || 'UTC';
  const isAr = lang === 'ar';
  const locale = isAr ? ar : undefined;

  const msLeft = endMs - nowMs;
  if (msLeft <= 0) return '';

  const weekdayTime = formatInTimeZone(new Date(endMs), tz, 'EEEE — h:mm a', { locale });
  const timeOnly = formatInTimeZone(new Date(endMs), tz, 'h:mm a', { locale });

  const days = differenceInCalendarDays(new Date(endMs), new Date(nowMs));
  if (days >= 1) {
    if (isAr) {
      return days === 1
        ? `ينتهي اشتراكك التجريبي خلال يوم واحد — ${weekdayTime}`
        : `ينتهي اشتراكك التجريبي خلال ${days} أيام — ${weekdayTime}`;
    }
    return days === 1
      ? `Your free trial ends in 1 day — ${weekdayTime}`
      : `Your free trial ends in ${days} days — ${weekdayTime}`;
  }

  const hours = differenceInHours(new Date(endMs), new Date(nowMs));
  if (hours >= 1) {
    if (isAr) {
      return hours === 1
        ? `ينتهي اشتراكك التجريبي اليوم الساعة ${timeOnly}`
        : `ينتهي اشتراكك التجريبي خلال ${hours} ساعات — الساعة ${timeOnly}`;
    }
    return hours === 1
      ? `Your trial ends today at ${timeOnly}`
      : `Your trial ends in ${hours} hours — today at ${timeOnly}`;
  }

  const mins = Math.max(1, differenceInMinutes(new Date(endMs), new Date(nowMs)));
  if (isAr) {
    return mins === 1
      ? 'ينتهي اشتراكك التجريبي خلال دقيقة واحدة'
      : `ينتهي اشتراكك التجريبي خلال ${mins} دقائق`;
  }
  return mins === 1 ? 'Your trial ends in 1 minute' : `Your trial ends in ${mins} minutes`;
}

/**
 * Single formatted line (EN/AR). If `trial_message_override` is set, returns that string only
 * (legacy / non-banner callers). For the staff banner, use `formatTrialCountdownCore` plus optional override line.
 */
export function formatTrialCountdownDisplay(tenant: Tenant, nowMs: number, lang: string): string {
  const override = tenant.trial_message_override?.trim();
  if (override) return override;
  return formatTrialCountdownCore(tenant, nowMs, lang);
}
