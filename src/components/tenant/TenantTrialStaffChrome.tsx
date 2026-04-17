import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { formatTrialCountdownDisplay, isTenantAccessLocked, shouldShowTrialCountdownBanner } from '../../lib/trialCountdown';
import { TenantExpiredFullScreen } from './TenantExpiredFullScreen';
import { db } from '../../lib/db';
import type { Tenant } from '../../types';

const TENANT_TRIAL_SELECT =
  'id,is_active,trial_ends_at,trial_status,trial_countdown_enabled,trial_message_override,tenant_time_zone,announced_time_zone';

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
  const { tenant, userProfile, isImpersonating } = useAuth();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [liveTenant, setLiveTenant] = useState(tenant);

  // Merge auth tenant into live state without wiping trial_* that we already loaded via refetch
  // (some code paths may hydrate tenant before PostgREST exposes new columns, or omit fields).
  useEffect(() => {
    if (!tenant) {
      setLiveTenant(null);
      return;
    }
    setLiveTenant((prev) => {
      const next = { ...tenant } as Tenant;
      if (!prev) return next;
      if (next.trial_ends_at == null && prev.trial_ends_at != null) next.trial_ends_at = prev.trial_ends_at;
      if (next.trial_countdown_enabled === undefined && prev.trial_countdown_enabled !== undefined) {
        next.trial_countdown_enabled = prev.trial_countdown_enabled;
      }
      if (next.trial_status === undefined && prev.trial_status !== undefined) next.trial_status = prev.trial_status;
      if (next.trial_message_override === undefined && prev.trial_message_override !== undefined) {
        next.trial_message_override = prev.trial_message_override;
      }
      return next;
    });
  }, [tenant]);

  const tenantId = userProfile?.tenant_id;

  const refreshTrialFields = useCallback(async () => {
    if (!tenantId) return;
    const { data, error } = await db.from('tenants').select(TENANT_TRIAL_SELECT).eq('id', tenantId).maybeSingle();
    if (error || !data) return;
    setLiveTenant((prev) => ({ ...(prev || {}), ...data }) as Tenant);
  }, [tenantId]);

  // Mount + focus: pick up Super Admin trial edits without requiring tab blur/re-login.
  useEffect(() => {
    if (!tenantId) return;
    void refreshTrialFields();
    const onFocus = () => void refreshTrialFields();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [tenantId, refreshTrialFields]);

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
    const formatted = formatTrialCountdownDisplay(liveTenant, nowMs, i18n.language);
    if (formatted) return formatted;
    // Rare edge cases (date math): still show a line when trial is active and countdown is enabled.
    return i18n.language === 'ar'
      ? 'تنبيه: اشتراكك التجريبي ينتهي قريباً. راجع إدارة المنصة للتفاصيل.'
      : 'Reminder: your trial is ending soon. Contact your administrator for details.';
  }, [showBanner, liveTenant, nowMs, i18n.language]);

  if (!showBanner) return null;

  return (
    <div
      className="w-full shrink-0 bg-amber-50 border-b border-amber-200 text-amber-950 px-3 py-2 text-center text-sm font-medium z-[31]"
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-2 justify-center">
        <span aria-hidden>⏳</span>
        <span dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>{line}</span>
      </span>
    </div>
  );
}
