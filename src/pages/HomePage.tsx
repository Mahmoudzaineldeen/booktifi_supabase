import React, { Suspense, lazy, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { getMarketingContent } from './marketing/marketingContent';
import { LandingPageLayout } from './marketing/LandingPageLayout';

const LandingDeferredSections = lazy(() => import('./marketing/LandingDeferredSections'));

export function HomePage() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const content = getMarketingContent(i18n.language);

  useEffect(() => {
    document.title = isRTL
      ? 'Bookati | منصة حجوزات وتشغيل للأعمال السعودية'
      : 'Bookati | Saudi-first bookings and operations platform';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        'content',
        isRTL
          ? 'منصة تجمع الحجوزات والتشغيل والتقارير والمبيعات في مكان واحد — قريبة من طريقة الشغل في السعودية.'
          : 'All-in-one platform for bookings, operations, analytics, and sales.'
      );
    }
  }, [isRTL]);

  return (
    <LandingPageLayout>
      <main>
        <section className="relative overflow-hidden bg-gradient-to-b from-blue-50 via-white to-white">
          <div className="mx-auto max-w-7xl px-4 py-16 md:py-24">
            <div className="mx-auto max-w-4xl text-center">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700">
                <Sparkles className="h-4 w-4" />
                {content.heroBadge}
              </div>
              <h1 className="text-balance text-4xl font-black leading-tight md:text-6xl">{content.heroTitle}</h1>
              <p className="mx-auto mt-5 max-w-3xl text-lg leading-relaxed text-slate-600 md:text-xl">{content.heroSubtitle}</p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button onClick={() => navigate('/signup')} size="lg" className="px-8 py-6 text-base md:text-lg">
                  {content.ctaPrimary}
                  <ArrowRight className={`h-5 w-5 ${isRTL ? 'mr-2 rotate-180' : 'ml-2'}`} />
                </Button>
                <Button onClick={() => navigate('/login')} variant="secondary" size="lg" className="px-8 py-6 text-base md:text-lg">
                  {content.ctaSecondary}
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-600">
                {content.trust.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="mx-auto mt-12 grid max-w-5xl gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              {content.stats.map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-3xl font-black text-blue-700">{stat.value}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-600">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Suspense fallback={<SectionLoading />}>
          <LandingDeferredSections isRTL={isRTL} content={content} />
        </Suspense>

        <section className="bg-blue-700 py-20 text-white">
          <div className="mx-auto max-w-5xl px-4 text-center">
            <h2 className="text-3xl font-black md:text-5xl">{content.finalTitle}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-blue-100">{content.finalSubtitle}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button onClick={() => navigate('/signup')} size="lg" className="min-w-[220px] !bg-white px-8 py-6 text-lg font-bold !text-blue-700 hover:!bg-slate-100">
                {content.ctaPrimary}
              </Button>
              <Button onClick={() => navigate('/login')} variant="outline" size="lg" className="min-w-[220px] border border-white !bg-transparent px-8 py-6 text-lg font-bold !text-white hover:!bg-blue-600">
                {content.ctaSecondary}
              </Button>
            </div>
          </div>
        </section>
      </main>
    </LandingPageLayout>
  );
}

function SectionLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
