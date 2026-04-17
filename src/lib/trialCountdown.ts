import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
} from 'date-fns';
import { ar } from 'date-fns/locale';
import type { Tenant } from '../types';

/** True for `ar`, `ar-SA`, etc. (i18n often uses region codes; `lang === 'ar'` alone misses them). */
export function isArabicTrialLocale(lang: string | undefined): boolean {
  const l = (lang || '').toLowerCase();
  return l === 'ar' || l.startsWith('ar-');
}

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
 * Time-until-trial-end line only (ignores `trial_message_override`).
 * Use this when the UI should always show the countdown and treat override as a separate hint.
 */
export function formatTrialCountdownCore(tenant: Tenant, nowMs: number, lang: string): string {
  if (!tenant.trial_ends_at) return '';

  const endMs = new Date(tenant.trial_ends_at as string).getTime();
  if (!Number.isFinite(endMs)) return '';

  const isAr = isArabicTrialLocale(lang);
  const locale = isAr ? ar : undefined;

  const msLeft = endMs - nowMs;
  if (msLeft <= 0) return '';

  const endDate = new Date(endMs);
  const nowDate = new Date(nowMs);
  // Match super-admin "trial ends at" entry (browser-local datetime-local → ISO): show wall clock in the viewer's local TZ, not tenant TZ (which shifted the displayed hour vs what was typed).
  const weekdayTime = format(endDate, 'EEEE — h:mm a', { locale });
  const timeOnly = format(endDate, 'h:mm a', { locale });

  const days = differenceInCalendarDays(endDate, nowDate);
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

  const hours = differenceInHours(endDate, nowDate);
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

  const mins = Math.max(1, differenceInMinutes(endDate, nowDate));
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
