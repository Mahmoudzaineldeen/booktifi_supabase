import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { LandingPageLayout } from './LandingPageLayout';
import { getIndustryDetail } from './industryCatalog';

export function IndustryDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const detail = slug ? getIndustryDetail(slug) : undefined;

  useEffect(() => {
    if (!detail) {
      document.title = isRTL ? 'القطاع غير موجود | Bookati' : 'Industry not found | Bookati';
      return;
    }
    document.title = isRTL ? `${detail.titleAr} | Bookati` : `${detail.titleEn} | Bookati`;
  }, [detail, isRTL]);

  if (!detail) {
    return (
      <LandingPageLayout>
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-2xl font-black text-slate-900">{isRTL ? 'الصفحة غير موجودة' : 'Page not found'}</h1>
          <p className="mt-2 text-slate-600">{isRTL ? 'تعذر العثور على هذا القطاع.' : 'This industry page could not be found.'}</p>
          <Link
            to="/industries"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {isRTL ? 'العودة إلى القطاعات' : 'Back to industries'}
          </Link>
        </main>
      </LandingPageLayout>
    );
  }

  const title = isRTL ? detail.titleAr : detail.titleEn;
  const description = isRTL ? detail.descriptionAr : detail.descriptionEn;
  const useCases = isRTL ? detail.useCasesAr : detail.useCasesEn;
  const features = isRTL ? detail.featuresAr : detail.featuresEn;
  const benefits = isRTL ? detail.benefitsAr : detail.benefitsEn;
  const sectionUse = isRTL ? 'حالات استخدام' : 'Use cases';
  const sectionFeat = isRTL ? 'المزايا المستخدمة' : 'Features in play';
  const sectionBen = isRTL ? 'النتائج المتوقعة' : 'Expected outcomes';
  const backLabel = isRTL ? 'جميع القطاعات' : 'All industries';

  return (
    <LandingPageLayout>
      <main className="mx-auto max-w-3xl px-4 py-12">
        <Link
          to="/industries"
          className={`inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-800 ${isRTL ? 'flex-row-reverse' : ''}`}
        >
          {isRTL ? <ArrowRight className="h-4 w-4 rotate-180" /> : <ArrowLeft className="h-4 w-4" />}
          {backLabel}
        </Link>

        <h1 className="mt-6 text-4xl font-black text-slate-900">{title}</h1>
        <p className="mt-3 text-lg text-slate-600">{description}</p>

        <SectionList title={sectionUse} items={useCases} />
        <SectionList title={sectionFeat} items={features} />
        <SectionList title={sectionBen} items={benefits} />

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/signup"
            className="inline-flex items-center justify-center rounded-lg bg-blue-700 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {isRTL ? 'ابدأ التجربة المجانية' : 'Start free trial'}
          </Link>
          <Link
            to="/industries"
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-lg font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            {backLabel}
          </Link>
        </div>
      </main>
    </LandingPageLayout>
  );
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-8">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{title}</h2>
      <ul className="mt-3 space-y-2 text-slate-700">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
