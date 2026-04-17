import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { formatTrialCountdownDisplay, isTenantAccessLocked, shouldShowTrialCountdownBanner } from '../../lib/trialCountdown';
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

/** Sticky countdown strip for staff (place below mobile header, inside pt-16 column). */
export function TenantTrialBannerStrip() {
  const { i18n } = useTranslation();
  const { tenant, userProfile } = useAuth();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [liveTenant, setLiveTenant] = useState(tenant);

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
          'id,is_active,trial_ends_at,trial_status,trial_countdown_enabled,trial_message_override,tenant_time_zone,announced_time_zone'
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

    // Fetch immediately so newly-updated trial settings are reflected without requiring tab focus.
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
    if (!liveTenant || !shouldShowTrialCountdownBanner(liveTenant, nowMs)) return;
    const msLeft = new Date(liveTenant.trial_ends_at as string).getTime() - nowMs;
    const interval = msLeft < 86_400_000 ? 1000 : 60_000;
    const id = window.setInterval(() => setNowMs(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [liveTenant, nowMs]);

  const showBanner =
    userProfile?.role !== 'solution_owner' && liveTenant && shouldShowTrialCountdownBanner(liveTenant, nowMs);

  const line = useMemo(() => {
    if (!showBanner || !liveTenant) return '';
    return formatTrialCountdownDisplay(liveTenant, nowMs, i18n.language);
  }, [showBanner, liveTenant, nowMs, i18n.language]);

  if (!showBanner || !line) return null;

  return (
    <div
      data-testid="tenant-trial-banner"
      className="w-full shrink-0 bg-amber-100 border-b border-amber-300 text-amber-950 px-3 py-2.5 text-center text-sm font-semibold shadow-sm z-[31]"
      role="status"
      aria-live="polite"
      aria-label={line}
    >
      <span className="inline-flex items-center gap-2 justify-center">
        <span aria-hidden>⏳</span>
        <span dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>{line}</span>
      </span>
    </div>
  );
}
