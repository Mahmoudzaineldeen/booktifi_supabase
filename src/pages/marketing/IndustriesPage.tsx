import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { LandingPageLayout } from './LandingPageLayout';
import { INDUSTRY_GRID } from './industryCatalog';

export function IndustriesPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const isRTL = i18n.language === 'ar';

  useEffect(() => {
    document.title = isRTL ? 'القطاعات | Bookati' : 'Industries | Bookati';
  }, [isRTL]);

  const headline = isRTL ? 'لأي نشاط خدمي — بوكاتي جاهز' : 'For any service business — Bookati is ready';
  const subline = isRTL
    ? 'نظام واحد يخدم قطاعات متعددة بمتطلبات تشغيلية مختلفة.'
    : 'One system for multiple sectors with different day-to-day needs.';
  const addTitle = isRTL ? 'أضف نشاطك هنا' : 'Add your activity here';
  const addHint = isRTL ? 'أخبرنا بنوع نشاطك وسنساعدك على الإعداد.' : 'Tell us your sector and we will help you get set up.';

  return (
    <LandingPageLayout>
      <main className="mx-auto max-w-7xl px-4 py-12" dir={isRTL ? 'rtl' : 'ltr'}>
        <header className="mb-10 text-center">
          <p className="text-sm font-semibold text-slate-500">{isRTL ? 'القطاعات' : 'Industries'}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">{headline}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600">{subline}</p>
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {INDUSTRY_GRID.map((item) => {
            const label = isRTL ? item.titleAr : item.titleEn;
            return (
              <Link
                key={item.slug}
                to={`/industries/${item.slug}`}
                className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm transition hover:border-blue-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <span className="text-4xl leading-none" aria-hidden>
                  {item.emoji}
                </span>
                <span className="mt-3 text-sm font-bold text-slate-900 sm:text-base">{label}</span>
              </Link>
            );
          })}

          <Link
            to="/signup"
            className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 p-4 text-center shadow-sm transition hover:border-sky-300 hover:bg-sky-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
          >
            <span className="text-sm font-black text-slate-900 sm:text-base">{addTitle}</span>
            <span className="mt-2 max-w-[12rem] text-xs text-slate-600 sm:text-sm">{addHint}</span>
          </Link>
        </div>

        <div className="mt-12 rounded-2xl bg-blue-700 p-8 text-white">
          <h2 className="text-2xl font-black">{isRTL ? 'ابدأ مع القطاع المناسب لك' : 'Start with the right setup'}</h2>
          <p className="mt-2 text-blue-100">
            {isRTL ? 'نساعدك تضبط نموذج تشغيلك بسرعة وبطريقة قابلة للتوسع.' : 'Launch fast with a scalable operating model.'}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => navigate('/signup')} size="lg" className="!bg-white !text-blue-700 hover:!bg-slate-100">
              {isRTL ? 'ابدأ التجربة المجانية' : 'Start Free Trial'}
              <ArrowRight className={`h-4 w-4 ${isRTL ? 'mr-2 rotate-180' : 'ml-2'}`} />
            </Button>
            <Button onClick={() => navigate('/login')} variant="outline" size="lg" className="border border-white !bg-transparent !text-white hover:!bg-blue-600">
              {isRTL ? 'احجز عرضًا تجريبيًا' : 'Book Demo'}
            </Button>
          </div>
        </div>
      </main>
    </LandingPageLayout>
  );
}
