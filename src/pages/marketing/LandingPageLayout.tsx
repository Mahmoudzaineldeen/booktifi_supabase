import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { SaudiLogo } from '../../components/layout/SaudiLogo';
import { getMarketingContent } from './marketingContent';

interface LandingPageLayoutProps {
  children: React.ReactNode;
}

export function LandingPageLayout({ children }: LandingPageLayoutProps) {
  const { i18n, t } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const content = getMarketingContent(i18n.language);

  return (
    <div className="min-h-screen bg-white text-slate-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-600 p-2 text-white">
              <CalendarDays className="h-5 w-5" />
            </div>
            <span className="text-xl font-black text-slate-900">{content.brand}</span>
            <SaudiLogo className="h-7" />
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link to="/advantages" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 md:inline-flex">
              {content.learnAdvantages}
            </Link>
            <Link to="/industries" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 md:inline-flex">
              {content.exploreIndustries}
            </Link>
            <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
              {t('auth.login')}
            </Link>
            <Link
              to="/signup"
              className="hidden rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 sm:inline-flex"
            >
              {content.ctaPrimary}
            </Link>
            <LanguageToggle />
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-10 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-black text-slate-900">{content.brand}</span>
            <SaudiLogo className="h-7" />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Link to="/advantages" className="font-semibold text-slate-700 hover:text-blue-700">
              {content.learnAdvantages}
            </Link>
            <Link to="/industries" className="font-semibold text-slate-700 hover:text-blue-700">
              {content.exploreIndustries}
            </Link>
            <Link to="/login" className="font-semibold text-slate-700 hover:text-blue-700">
              {t('auth.login')}
            </Link>
            <Link to="/signup" className="font-semibold text-blue-700 hover:text-blue-800">
              {content.ctaPrimary}
            </Link>
          </div>
          <div className="text-slate-500">© 2026 {content.brand}. {isRTL ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}</div>
        </div>
      </footer>
    </div>
  );
}

