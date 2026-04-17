import { differenceInCalendarDays, differenceInHours, differenceInMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { ar } from 'date-fns/locale';
import type { Tenant } from '../types';

function trialCountdownFlagOn(tenant: Tenant | null | undefined): boolean {
  const v = tenant?.trial_countdown_enabled as unknown;
  return v === true || v === 1 || String(v).toLowerCase() === 'true';
}

export function shouldShowTrialCountdownBanner(tenant: Tenant | null | undefined, nowMs = Date.now()): boolean {
  if (!tenant?.trial_ends_at) return false;
  const endMs = new Date(tenant.trial_ends_at as string).getTime();
  if (!Number.isFinite(endMs) || endMs <= nowMs) return false;
  if (tenant.is_active === false) return false;
  const status = String(tenant.trial_status ?? 'active').toLowerCase();
  if (status === 'expired') return false;
  if (!trialCountdownFlagOn(tenant)) return false;
  return true;
}

export function isTenantAccessLocked(tenant: Tenant | null | undefined): boolean {
  return !!(tenant && tenant.is_active === false);
}

/**
 * Single formatted line for the staff trial banner (EN/AR). Honors `trial_message_override`.
 */
export function formatTrialCountdownDisplay(tenant: Tenant, nowMs: number, lang: string): string {
  const override = tenant.trial_message_override?.trim();
  if (override) return override;

  const endMs = new Date(tenant.trial_ends_at as string).getTime();
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
