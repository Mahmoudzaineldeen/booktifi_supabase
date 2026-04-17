import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  formatTrialCountdownCore,
  getTrialCountdownParts,
  getTrialElapsedRatio,
  isTenantAccessLocked,
  shouldShowTrialCountdownBanner,
} from '../../lib/trialCountdown';
import { TenantExpiredFullScreen } from './TenantExpiredFullScreen';
import { db } from '../../lib/db';
import type { Tenant } from '../../types';

type GateProps = { children: React.ReactNode };

/** Full-screen lock only (inactive tenant). */
export function TenantStaffTrialGate({ children }: GateProps) {
  const { tenant, userProfile } = useAuth();
  const locked = useMemo(
    () => userProfile?.role !== 'solution_owner' && isTenantAccessLocked(tenant),
    [userProfile?.role, tenant]
  );

  if (locked) {
    return <TenantExpiredFullScreen />;
  }
  return <>{children}</>;
}

function CountdownSep() {
  return (
    <span
      className="mx-0.5 hidden select-none self-end pb-[1.35rem] text-lg font-extralight text-indigo-200/90 sm:inline"
      aria-hidden
    >
      :
    </span>
  );
}

function CountdownDigitBox({
  value,
  label,
  isDayUnit,
  emphasize,
}: {
  value: number;
  label: string;
  isDayUnit: boolean;
  emphasize?: boolean;
}) {
  const text = isDayUnit ? String(Math.max(0, value)) : String(Math.max(0, Math.min(99, value))).padStart(2, '0');
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`
          relative flex h-[3.1rem] w-[3.1rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl
          border border-white/30 bg-gradient-to-b font-bold tabular-nums text-white shadow-md ring-1 ring-indigo-950/10
          text-lg leading-none tracking-tight transition-all duration-200 ease-in-out
          ${emphasize ? 'from-violet-600 to-indigo-800 animate-trialDigit' : 'from-indigo-500 to-indigo-800'}
          ${isDayUnit && value > 99 ? 'w-[3.5rem] text-base' : ''}
        `}
      >
        <span className="relative z-[1] drop-shadow-sm">{text}</span>
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" aria-hidden />
      </div>
      <span className="max-w-[4.5rem] text-center text-[10px] font-semibold uppercase tracking-wider text-indigo-900/45">
        {label}
      </span>
    </div>
  );
}

/** Premium trial strip: glass card, progress, countdown. */
export function TenantTrialBannerStrip() {
  const { t, i18n } = useTranslation();
  const { tenant, userProfile } = useAuth();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [liveTenant, setLiveTenant] = useState(tenant);
  const liveTenantRef = useRef(tenant);
  liveTenantRef.current = liveTenant;

  useEffect(() => {
    setLiveTenant(tenant);
  }, [tenant]);

  const tenantId = userProfile?.tenant_id ?? tenant?.id;

  useEffect(() => {
    if (!tenantId) return;
    const refreshTenantTrialState = () => {
      void db
        .from('tenants')
        .select(
          'id,slug,created_at,subscription_start,is_active,trial_ends_at,trial_status,trial_countdown_enabled,trial_message_override,tenant_time_zone,announced_time_zone'
        )
        .eq('id', tenantId)
        .maybeSingle()
        .then((res: { data: Record<string, unknown> | null; error?: { message?: string } | null }) => {
          if (res.error && import.meta.env.DEV) {
            console.warn('[TenantTrialBannerStrip] tenant trial refetch failed:', res.error.message || res.error);
          }
          const data = res.data;
          if (data) setLiveTenant((prev) => ({ ...(prev || {}), ...data }) as Tenant);
        });
    };

    refreshTenantTrialState();
    const onFocus = () => refreshTenantTrialState();
    const periodicRefresh = window.setInterval(refreshTenantTrialState, 60_000);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(periodicRefresh);
    };
  }, [tenantId]);

  useEffect(() => {
    if (!liveTenant?.trial_ends_at) return undefined;
    if (!shouldShowTrialCountdownBanner(liveTenant, Date.now())) return undefined;
    const id = window.setInterval(() => {
      const t0 = liveTenantRef.current;
      const now = Date.now();
      if (!t0?.trial_ends_at || !shouldShowTrialCountdownBanner(t0, now)) {
        window.clearInterval(id);
      }
      setNowMs(now);
    }, 1000);
    return () => window.clearInterval(id);
  }, [liveTenant]);

  const showBanner =
    userProfile?.role !== 'solution_owner' && liveTenant && shouldShowTrialCountdownBanner(liveTenant, nowMs);

  const parts = useMemo(() => {
    if (!showBanner || !liveTenant) return null;
    return getTrialCountdownParts(liveTenant, nowMs);
  }, [showBanner, liveTenant, nowMs]);

  const countdownLine = useMemo(() => {
    if (!showBanner || !liveTenant) return '';
    return formatTrialCountdownCore(liveTenant, nowMs, i18n.language);
  }, [showBanner, liveTenant, nowMs, i18n.language]);

  const progressRatio = useMemo(() => {
    if (!showBanner || !liveTenant) return null;
    return getTrialElapsedRatio(liveTenant, nowMs);
  }, [showBanner, liveTenant, nowMs]);

  const overrideLine = useMemo(() => {
    if (!showBanner || !liveTenant) return '';
    return (liveTenant.trial_message_override || '').trim();
  }, [showBanner, liveTenant]);

  if (!showBanner || !parts || !countdownLine) return null;

  const ariaLabel = [countdownLine, overrideLine].filter(Boolean).join('. ');
  const daysLabel = t('trial.banner.days', 'Days');
  const hoursLabel = t('trial.banner.hours', 'Hours');
  const minsLabel = t('trial.banner.minutes', 'Min');
  const secsLabel = t('trial.banner.seconds', 'Sec');
  const isRtl = i18n.language === 'ar';
  const progressPct = progressRatio != null ? Math.round(progressRatio * 100) : null;

  return (
    <div
      data-testid="tenant-trial-banner"
      className="sticky top-0 z-[31] w-full shrink-0 border-b border-indigo-100/80 bg-gradient-to-r from-indigo-50/95 via-purple-50/90 to-indigo-50/95 px-4 py-4 shadow-sm sm:px-6 sm:py-5"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <span className="sr-only">{countdownLine}</span>

      <div className="mx-auto max-w-7xl">
        <div
          className="rounded-2xl border border-gray-100 bg-white/70 p-5 shadow-md backdrop-blur-md sm:p-6"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
            <div className="flex min-w-0 flex-1 gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md ring-2 ring-white/40">
                <Clock className="h-6 w-6" strokeWidth={2} aria-hidden />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  {t('trial.banner.titlePremium', 'Trial ending soon')}
                </h2>
                <p
                  className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base"
                  dir={isRtl ? 'rtl' : 'ltr'}
                >
                  {countdownLine}
                </p>
                {overrideLine ? (
                  <p className="mt-2 text-xs font-semibold text-indigo-800/80 sm:text-sm" dir="auto">
                    {overrideLine}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex w-full flex-col items-stretch gap-4 lg:w-auto lg:min-w-[min(100%,22rem)] lg:items-end">
              <div className="flex justify-center sm:justify-end" dir="ltr">
                <div className="inline-flex items-end gap-1 rounded-2xl bg-white/80 px-3 py-3 shadow-inner ring-1 ring-indigo-100/80 sm:gap-1.5">
                  <CountdownDigitBox value={parts.days} label={daysLabel} isDayUnit />
                  <CountdownSep />
                  <CountdownDigitBox value={parts.hours} label={hoursLabel} isDayUnit={false} />
                  <CountdownSep />
                  <CountdownDigitBox value={parts.minutes} label={minsLabel} isDayUnit={false} />
                  <CountdownSep />
                  <CountdownDigitBox value={parts.seconds} label={secsLabel} isDayUnit={false} emphasize />
                </div>
              </div>

              {progressPct != null ? (
                <div className="w-full max-w-xl lg:ms-auto">
                  <div className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>{t('trial.banner.progressLabel', 'Trial progress')}</span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200/80 ring-1 ring-slate-200/60">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 transition-[width] duration-500 ease-out"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
