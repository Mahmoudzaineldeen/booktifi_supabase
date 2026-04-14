import React, { useMemo } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { SETTINGS_MORE_NAV_SLUGS, SETTINGS_TOP_NAV_SLUGS, type SettingsSectionSlug } from './settingsSections';

function labelForSlug(slug: SettingsSectionSlug, t: (k: string, d?: string) => string): string {
  switch (slug) {
    case 'account':
      return t('settings.nav.account');
    case 'scheduling':
      return t('settings.nav.scheduling');
    case 'logos':
      return t('settings.nav.logos');
    case 'app-manager':
      return t('settings.nav.appManager');
    case 'whatsapp':
      return t('settings.nav.whatsapp');
    case 'integrations':
      return t('settings.nav.integrations');
    default:
      return slug;
  }
}

export function SettingsLayout() {
  const { t } = useTranslation();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const location = useLocation();
  const base = tenantSlug ? `/${tenantSlug}/admin/settings` : '';

  const topItems = useMemo(
    () =>
      SETTINGS_TOP_NAV_SLUGS.map((slug) => ({
        slug,
        label: labelForSlug(slug, t),
        to: `${base}/${slug}`,
      })),
    [t, base]
  );

  const moreItems = useMemo(
    () =>
      SETTINGS_MORE_NAV_SLUGS.map((slug) => ({
        slug,
        label: labelForSlug(slug, t),
        to: `${base}/${slug}`,
      })),
    [t, base]
  );

  const isActive = (slug: string, to: string) =>
    location.pathname === to || location.pathname.endsWith(`/${slug}`);

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="bg-slate-100 p-2.5 rounded-xl">
            <Settings className="w-6 h-6 text-slate-600" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('navigation.settings')}</h1>
        </div>
        <p className="text-sm md:text-base text-slate-600 mt-1">{t('settings.manageSettings')}</p>
      </div>

      <nav
        className="mb-3 flex flex-wrap gap-2 rounded-xl border border-gray-200/90 bg-white p-2 shadow-sm"
        aria-label={t('settings.sectionPickerLabel')}
      >
        {topItems.map(({ slug, label, to }) => {
          const active = isActive(slug, to);
          return (
            <Link
              key={slug}
              to={to}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-200/80'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <nav
        className="mb-6 flex flex-wrap gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-2"
        aria-label={t('settings.moreSettingsNav', 'More settings')}
      >
        <span className="w-full px-1 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:w-auto sm:self-center">
          {t('settings.moreSettingsHeading', 'Operations & branding')}
        </span>
        {moreItems.map(({ slug, label, to }) => {
          const active = isActive(slug, to);
          return (
            <Link
              key={slug}
              to={to}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-white text-blue-800 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-white/90'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <Outlet />
    </div>
  );
}
