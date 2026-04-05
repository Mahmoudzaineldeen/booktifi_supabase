import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { INDUSTRY_GRID } from './industryCatalog';

type LandingDeferredProps = {
  isRTL: boolean;
  content: Record<string, unknown> & {
    overviewTitle: string;
    overviewSubtitle: string;
    overviewFeatures: { key: string; title: string; desc: string; benefit: string }[];
    coreGridTitle: string;
    coreGridSubtitle: string;
    coreCards: { key: string; title: string; desc: string }[];
    advantagesTitle: string;
    advantagesSubtitle: string;
    learnAdvantages: string;
    sellTitle: string;
    sellSubtitle: string;
    industriesTitle: string;
    industriesSubtitle: string;
    exploreIndustries: string;
    partnersTitle: string;
    partnersSubtitle: string;
    dashboardPowerTitle: string;
    dashboardPowerSubtitle: string;
    rolesTitle: string;
    rolesSubtitle: string;
    reportsTitle: string;
    reportsSubtitle: string;
    faqTitle: string;
    faqSubtitle: string;
    faqItems?: { q: string; a: string }[];
  };
};

const overviewEmoji: Record<string, { emoji: string; tone: string }> = {
  dashboard: { emoji: '📊', tone: 'bg-sky-50' },
  multilang: { emoji: '🌍', tone: 'bg-emerald-50' },
  roles: { emoji: '🛡️', tone: 'bg-violet-50' },
  branches: { emoji: '🏢', tone: 'bg-blue-50' },
  bookings: { emoji: '📅', tone: 'bg-cyan-50' },
  tags: { emoji: '🏷️', tone: 'bg-amber-50' },
  analytics: { emoji: '📈', tone: 'bg-indigo-50' },
  integrations: { emoji: '🔌', tone: 'bg-lime-50' },
};

const coreEmoji: Record<string, { emoji: string; tone: string }> = {
  booking: { emoji: '📅', tone: 'bg-blue-50' },
  landing: { emoji: '🌐', tone: 'bg-emerald-50' },
  pos: { emoji: '🧾', tone: 'bg-violet-50' },
  packages: { emoji: '🔁', tone: 'bg-sky-50' },
  offers: { emoji: '🎁', tone: 'bg-rose-50' },
  branches: { emoji: '🏢', tone: 'bg-amber-50' },
  tags: { emoji: '🏷️', tone: 'bg-orange-50' },
  employees: { emoji: '👥', tone: 'bg-cyan-50' },
  reports: { emoji: '📊', tone: 'bg-indigo-50' },
  customers: { emoji: '🙋', tone: 'bg-pink-50' },
  roles: { emoji: '🛡️', tone: 'bg-slate-100' },
};

function EmojiCard({
  emoji,
  tone,
  title,
  desc,
  footer,
  to,
  isRTL,
}: {
  emoji: string;
  tone: string;
  title: string;
  desc: string;
  footer?: string;
  to?: string;
  isRTL: boolean;
}) {
  const inner = (
    <>
      <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}>
        <span className="text-2xl leading-none" aria-hidden>
          {emoji}
        </span>
      </div>
      <h3 className="text-lg font-black text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{desc}</p>
      {footer ? <p className="mt-2 text-sm font-semibold text-blue-700">{footer}</p> : null}
      {to ? (
        <span className={`mt-auto pt-3 text-sm font-bold text-blue-700 ${isRTL ? 'text-right' : 'text-left'}`}>
          {isRTL ? 'شوف التفاصيل ←' : 'View details →'}
        </span>
      ) : null}
    </>
  );

  const className =
    'flex h-full min-h-[200px] flex-col rounded-2xl border border-slate-200 bg-white p-5 text-start shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    );
  }

  return <article className={className}>{inner}</article>;
}

/** Stable fragment ids for in-page jump links (prefixed to avoid collisions). */
const IDS = {
  overview: 'bookati-landing-overview',
  core: 'bookati-landing-core',
  why: 'bookati-landing-why',
  sell: 'bookati-landing-sell',
  industries: 'bookati-landing-industries',
  power: 'bookati-landing-power',
  faq: 'bookati-landing-faq',
} as const;

export default function LandingDeferredSections({ isRTL, content }: LandingDeferredProps) {
  const jumpLinks = useMemo(
    () =>
      isRTL
        ? [
            { id: IDS.overview, emoji: '🔎', label: 'لمحة عن النظام' },
            { id: IDS.core, emoji: '🧩', label: 'أساسيات التشغيل' },
            { id: IDS.why, emoji: '✨', label: 'ليش بوكاتي؟' },
            { id: IDS.sell, emoji: '💳', label: 'طرق البيع' },
            { id: IDS.industries, emoji: '🏭', label: 'القطاعات' },
            { id: IDS.power, emoji: '⚡', label: 'القوة والشراكة' },
            { id: IDS.faq, emoji: '❔', label: 'أسئلة متكررة' },
          ]
        : [
            { id: IDS.overview, emoji: '🔎', label: 'System overview' },
            { id: IDS.core, emoji: '🧩', label: 'Core suite' },
            { id: IDS.why, emoji: '✨', label: 'Why Bookati' },
            { id: IDS.sell, emoji: '💳', label: 'Ways to sell' },
            { id: IDS.industries, emoji: '🏭', label: 'Industries' },
            { id: IDS.power, emoji: '⚡', label: 'Power & partners' },
            { id: IDS.faq, emoji: '❔', label: 'FAQ' },
          ],
    [isRTL]
  );

  const whyCards = useMemo(
    () =>
      isRTL
        ? [
            { title: 'موجّه للسوق السعودي من أول يوم', desc: 'عربي من اليمين لليسار، فوترة تلائم الشغل المحلّي، وسيناريوهات تشغيل قريبة من واقع السوق.', emoji: '🛡️', tone: 'bg-emerald-50', to: '/advantages?tab=advantages' as const },
            { title: 'مدفوعات مرنة على كيفك', desc: 'دفع مسبق أو في الفرع، مع مجال نربط لاحقًا بوابات دفع محلية.', emoji: '💳', tone: 'bg-sky-50', to: '/advantages?tab=products' as const },
            { title: 'تشغيل ذكي يخفّص الزحمة', desc: 'توزيع للموظفين، تنبيهات لحظية، وجدولة تقلّل التعارض والتداخل.', emoji: '🤖', tone: 'bg-cyan-50', to: '/advantages?tab=operations' as const },
            { title: 'أقل غلطات تشغيلية', desc: 'فوترة تلقائية وأقل إدخال يدوي، عشان تقلّل أخطاء الإدخال.', emoji: '🔒', tone: 'bg-slate-100', to: '/advantages?tab=operations' as const },
            { title: 'بيع موحّد من مكان واحد', desc: 'خدمات، منتجات، باقات، اشتراكات، وتذاكر — كله تحت منصة وحدة.', emoji: '🛍️', tone: 'bg-violet-50', to: '/advantages?tab=products' as const },
            { title: 'تكاملات وواجهات برمجية', desc: 'جاهزين مع Zoho وDaftra، وقابلين نوسّع لأنظمة أكبر لما يكبر شغلك.', emoji: '🔌', tone: 'bg-indigo-50', to: '/advantages?tab=advantages' as const },
          ]
        : [
            { title: 'Built for Saudi from day one', desc: 'RTL-ready experience, local invoicing flows, and market-fit operations.', emoji: '🛡️', tone: 'bg-emerald-50', to: '/advantages?tab=advantages' as const },
            { title: 'Flexible payments', desc: 'Prepaid and on-site flows with room to expand local gateways.', emoji: '💳', tone: 'bg-sky-50', to: '/advantages?tab=products' as const },
            { title: 'Smart operations', desc: 'Assignment, alerts, and scheduling that reduce conflicts.', emoji: '🤖', tone: 'bg-cyan-50', to: '/advantages?tab=operations' as const },
            { title: 'Fewer operational mistakes', desc: 'Structured invoicing and less manual entry risk.', emoji: '🔒', tone: 'bg-slate-100', to: '/advantages?tab=operations' as const },
            { title: 'Unified commerce', desc: 'Services, products, packages, subscriptions, and tickets together.', emoji: '🛍️', tone: 'bg-violet-50', to: '/advantages?tab=products' as const },
            { title: 'Integrations & APIs', desc: 'Zoho and Daftra today, extensible for what comes next.', emoji: '🔌', tone: 'bg-indigo-50', to: '/advantages?tab=advantages' as const },
          ],
    [isRTL]
  );

  const sellCards = useMemo(
    () =>
      isRTL
        ? [
            { title: 'الخدمات', desc: 'مواعيد وحجوزات خدمة مضبوطة وواضحة.', emoji: '🛎️', tone: 'bg-indigo-50', to: '/advantages?tab=products' as const },
            { title: 'المنتجات', desc: 'بيع مباشر مع استلام من الفرع أو توصيل حسب نموذجك.', emoji: '🏪', tone: 'bg-blue-50', to: '/advantages?tab=products' as const },
            { title: 'الباقات', desc: 'عروض مجمّعة ترفع متوسط قيمة الطلب.', emoji: '📦', tone: 'bg-amber-50', to: '/advantages?tab=products' as const },
            { title: 'الاشتراكات', desc: 'فوترة دورية وتجديد يمشي تلقائي.', emoji: '🔁', tone: 'bg-emerald-50', to: '/advantages?tab=products' as const },
            { title: 'التذاكر', desc: 'بيع فعاليات ومتابعة الحضور من نفس النظام.', emoji: '🎫', tone: 'bg-rose-50', to: '/advantages?tab=products' as const },
          ]
        : [
            { title: 'Services', desc: 'Appointment-led service delivery.', emoji: '🛎️', tone: 'bg-indigo-50', to: '/advantages?tab=products' as const },
            { title: 'Products', desc: 'Sell with pickup or delivery workflows.', emoji: '🏪', tone: 'bg-blue-50', to: '/advantages?tab=products' as const },
            { title: 'Packages', desc: 'Bundles that lift average order value.', emoji: '📦', tone: 'bg-amber-50', to: '/advantages?tab=products' as const },
            { title: 'Subscriptions', desc: 'Recurring billing with renewal automation.', emoji: '🔁', tone: 'bg-emerald-50', to: '/advantages?tab=products' as const },
            { title: 'Tickets', desc: 'Events and attendance from one stack.', emoji: '🎫', tone: 'bg-rose-50', to: '/advantages?tab=products' as const },
          ],
    [isRTL]
  );

  const powerCards = useMemo(
    () =>
      isRTL
        ? [
            { key: 'dash', title: content.dashboardPowerTitle, desc: content.dashboardPowerSubtitle, emoji: '🖥️', to: '/signup', cta: 'جرّب النظام ←' },
            { key: 'roles', title: content.rolesTitle, desc: content.rolesSubtitle, emoji: '👥', to: '/advantages?tab=operations', cta: 'الصلاحيات والتشغيل ←' },
            { key: 'reports', title: content.reportsTitle, desc: content.reportsSubtitle, emoji: '📊', to: '/advantages?tab=products', cta: 'التقارير والمنظومة ←' },
          ]
        : [
            { key: 'dash', title: content.dashboardPowerTitle, desc: content.dashboardPowerSubtitle, emoji: '🖥️', to: '/signup', cta: 'Start free trial →' },
            { key: 'roles', title: content.rolesTitle, desc: content.rolesSubtitle, emoji: '👥', to: '/advantages?tab=operations', cta: 'Ops & permissions →' },
            { key: 'reports', title: content.reportsTitle, desc: content.reportsSubtitle, emoji: '📊', to: '/advantages?tab=products', cta: 'Suite & reporting →' },
          ],
    [content, isRTL]
  );

  const partnersMarquee = useMemo(
    () =>
      [
        { label: 'Zoho', logoSrc: '/images/zoho-logo.svg', large: false, logoClass: 'max-h-9' },
        { label: 'Daftra', logoSrc: '/images/daftra-logo.png', large: false, logoClass: 'max-h-12' },
        { label: 'API', logoSrc: '/images/api-logo.png', large: true, logoClass: 'max-h-12' },
        { label: 'Zoho', logoSrc: '/images/zoho-logo.svg', large: false, logoClass: 'max-h-9' },
        { label: 'Daftra', logoSrc: '/images/daftra-logo.png', large: false, logoClass: 'max-h-12' },
        { label: 'API', logoSrc: '/images/api-logo.png', large: true, logoClass: 'max-h-12' },
      ] as const,
    []
  );

  const sectionShell = (variant: 'white' | 'muted') =>
    variant === 'muted' ? 'bg-gradient-to-b from-slate-50/90 to-slate-50/40' : 'bg-white';

  const navLabel = isRTL ? 'تنقّل بين الأقسام' : 'Jump to section';

  return (
    <div className="bg-white" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="sticky top-[4.75rem] z-40 border-b border-slate-200/90 bg-white/90 shadow-md backdrop-blur-md md:top-[4.5rem]">
        <div className="mx-auto max-w-7xl px-4 py-3">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">{navLabel}</p>
          <nav className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:flex-wrap md:justify-center [&::-webkit-scrollbar]:hidden" aria-label={navLabel}>
            {jumpLinks.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200/90 bg-gradient-to-b from-white to-slate-50 px-3 py-2 text-sm font-bold text-slate-800 shadow-sm ring-1 ring-slate-100 transition hover:border-blue-300 hover:from-blue-50 hover:to-white hover:text-blue-800 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <span className="text-base leading-none" aria-hidden>
                  {item.emoji}
                </span>
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <section id={IDS.overview} className={`scroll-mt-40 py-14 md:py-20 ${sectionShell('white')}`}>
        <div className="mx-auto max-w-7xl px-4">
          <header className="mb-10 text-center">
            <p className="text-sm font-semibold text-blue-700">{isRTL ? 'لمحة عن النظام' : 'System overview'}</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900 md:text-4xl">{content.overviewTitle}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600">{content.overviewSubtitle}</p>
          </header>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {content.overviewFeatures.map((feature) => {
              const meta = overviewEmoji[feature.key] ?? { emoji: '✨', tone: 'bg-slate-100' };
              return (
                <EmojiCard
                  key={feature.key}
                  emoji={meta.emoji}
                  tone={meta.tone}
                  title={feature.title}
                  desc={feature.desc}
                  footer={feature.benefit}
                  to="/advantages?tab=products"
                  isRTL={isRTL}
                />
              );
            })}
          </div>
        </div>
      </section>

      <section id={IDS.core} className={`scroll-mt-40 py-14 md:py-20 ${sectionShell('muted')}`}>
        <div className="mx-auto max-w-7xl px-4">
          <header className="mb-10 text-center">
            <p className="text-sm font-semibold text-blue-700">{isRTL ? 'أساسيات التشغيل' : 'Core suite'}</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900 md:text-4xl">{content.coreGridTitle}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600">{content.coreGridSubtitle}</p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {content.coreCards.map((card) => {
              const meta = coreEmoji[card.key] ?? { emoji: '✨', tone: 'bg-slate-100' };
              return (
                <EmojiCard
                  key={card.key}
                  emoji={meta.emoji}
                  tone={meta.tone}
                  title={card.title}
                  desc={card.desc}
                  to="/advantages?tab=products"
                  isRTL={isRTL}
                />
              );
            })}
          </div>
        </div>
      </section>

      <section id={IDS.why} className={`scroll-mt-40 py-14 md:py-20 ${sectionShell('white')}`}>
        <div className="mx-auto max-w-7xl px-4">
          <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-center sm:text-start">
              <p className="text-sm font-semibold text-blue-700">{isRTL ? 'ليش بوكاتي؟' : 'Why Bookati'}</p>
              <h2 className="mt-2 text-3xl font-black text-slate-900 md:text-4xl">{content.advantagesTitle}</h2>
              <p className="mt-2 max-w-xl text-slate-600">{content.advantagesSubtitle}</p>
            </div>
            <Link
              to="/advantages"
              className="shrink-0 self-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 sm:self-auto"
            >
              {content.learnAdvantages}
            </Link>
          </header>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {whyCards.map((item) => (
              <Link
                key={item.title}
                to={item.to}
                className="block rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5 text-start shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              >
                <div className={`mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl ${item.tone}`}>
                  <span className="text-2xl" aria-hidden>
                    {item.emoji}
                  </span>
                </div>
                <h3 className="text-lg font-black text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{item.desc}</p>
                <span className="mt-3 inline-block text-sm font-bold text-emerald-800">{isRTL ? 'شوف التفاصيل ←' : 'Learn more →'}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id={IDS.sell} className={`scroll-mt-40 py-14 md:py-20 ${sectionShell('muted')}`}>
        <div className="mx-auto max-w-7xl px-4">
          <header className="mb-10 text-center">
            <p className="text-sm font-semibold text-blue-700">{isRTL ? 'طرق البيع' : 'Ways to sell'}</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900 md:text-4xl">{content.sellTitle}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600">{content.sellSubtitle}</p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {sellCards.map((item) => (
              <Link
                key={item.title}
                to={item.to}
                className="block rounded-2xl border border-indigo-100 bg-white p-5 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                <div className={`mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl ${item.tone}`}>
                  <span className="text-3xl" aria-hidden>
                    {item.emoji}
                  </span>
                </div>
                <h3 className="font-black text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{item.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id={IDS.industries} className={`scroll-mt-40 py-14 md:py-20 ${sectionShell('white')}`}>
        <div className="mx-auto max-w-7xl px-4">
          <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-center sm:text-start">
              <p className="text-sm font-semibold text-blue-700">{isRTL ? 'القطاعات' : 'Industries'}</p>
              <h2 className="mt-2 text-3xl font-black text-slate-900 md:text-4xl">{content.industriesTitle}</h2>
              <p className="mt-2 max-w-xl text-slate-600">{content.industriesSubtitle}</p>
            </div>
            <Link
              to="/industries"
              className="shrink-0 self-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 sm:self-auto"
            >
              {content.exploreIndustries}
            </Link>
          </header>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {INDUSTRY_GRID.map((item) => {
              const label = isRTL ? item.titleAr : item.titleEn;
              return (
                <Link
                  key={item.slug}
                  to={`/industries/${item.slug}`}
                  className="flex min-h-[128px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm transition hover:border-blue-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  <span className="text-3xl" aria-hidden>
                    {item.emoji}
                  </span>
                  <span className="mt-2 text-sm font-bold text-slate-900">{label}</span>
                </Link>
              );
            })}
            <Link
              to="/signup"
              className="flex min-h-[128px] flex-col items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 p-4 text-center shadow-sm transition hover:border-sky-300 hover:bg-sky-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
            >
              <span className="text-sm font-black text-slate-900 sm:text-base">{isRTL ? 'أضف نشاطك هنا' : 'Add your activity here'}</span>
              <span className="mt-2 max-w-[11rem] text-xs text-slate-600">{isRTL ? 'سجّل واختر طريقة شغلك المناسبة.' : 'Sign up and tell us how you operate.'}</span>
            </Link>
          </div>
        </div>
      </section>

      <section id={IDS.power} className={`scroll-mt-40 py-14 md:py-20 ${sectionShell('muted')}`}>
        <div className="mx-auto max-w-7xl px-4">
          <header className="mb-10 text-center">
            <p className="text-sm font-semibold text-blue-700">{isRTL ? 'القوة والشراكة' : 'Power & partners'}</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900 md:text-4xl">{isRTL ? 'قوة النظام والشراكة' : 'Platform power & partners'}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600">
              {isRTL ? 'لوحة تحكم وصلاحيات وتقارير، ومعها تكاملات جاهزة — كله واضح ومرتّب.' : 'Dashboards, permissions, reporting, and integrations in one place.'}
            </p>
          </header>

          <div className="rounded-3xl bg-slate-900 p-6 shadow-xl sm:p-8">
            <div className="grid gap-5 lg:grid-cols-3">
              {powerCards.map((card) => (
                <Link
                  key={card.key}
                  to={card.to}
                  className="flex min-h-[168px] flex-col rounded-2xl border border-slate-700/80 bg-slate-800/80 p-5 text-white shadow-md transition hover:-translate-y-0.5 hover:border-cyan-500/30 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                >
                  <div className="flex items-start gap-4">
                    <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-700/90">
                      <span className="text-2xl leading-none" aria-hidden>
                        {card.emoji}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 text-start">
                      <h3 className="text-lg font-bold leading-snug">{card.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-300">{card.desc}</p>
                    </div>
                  </div>
                  <span className="mt-auto pt-4 text-sm font-bold text-cyan-300">{card.cta}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-14">
            <h3 className="text-center text-xl font-black text-slate-900">{content.partnersTitle}</h3>
            <p className="mx-auto mt-2 max-w-2xl text-center text-slate-600">{content.partnersSubtitle}</p>
            <div className="relative mx-auto mt-8 max-w-5xl overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
              <div className="flex justify-center">
                <div className={`partners-marquee-track flex w-max items-center gap-12 py-3 ${isRTL ? '' : 'partners-marquee-reverse'}`}>
                  {partnersMarquee.map((partner, idx) => (
                    <div
                      key={`${partner.label}-${idx}`}
                      className={`flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 shadow-sm ${
                        partner.large ? 'h-[4.5rem] min-w-[10.5rem]' : 'h-16 min-w-[7.5rem]'
                      }`}
                    >
                      <img
                        src={partner.logoSrc}
                        alt={partner.label}
                        className={`w-auto object-contain ${partner.logoClass ?? (partner.large ? 'max-h-[2.75rem]' : 'max-h-9')}`}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <style>{`
              @keyframes partners-marquee {
                0% { transform: translateX(0); }
                100% { transform: translateX(-50%); }
              }
              .partners-marquee-track {
                animation: partners-marquee 22s linear infinite;
              }
              .partners-marquee-reverse {
                animation-direction: reverse;
              }
            `}</style>
          </div>

          <div className="mx-auto mt-12 grid max-w-7xl gap-4 md:grid-cols-3">
            <Link
              to="/signup"
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
                <span className="text-2xl" aria-hidden>
                  💳
                </span>
              </div>
              <h4 className="font-black text-slate-900">{isRTL ? 'دفع يناسب عميلك وطريقة شغلك' : 'Payment options that fit'}</h4>
              <p className="mt-2 text-sm text-slate-600">
                {isRTL ? 'خيارات سداد مرنة على حسب نوع الطلب وطريقة التشغيل عندك.' : 'Flexible flows for how you collect revenue.'}
              </p>
            </Link>
            <Link
              to="/advantages?tab=operations"
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
                <span className="text-2xl" aria-hidden>
                  🔔
                </span>
              </div>
              <h4 className="font-black text-slate-900">{isRTL ? 'تنبيهات وتشغيل لحظي' : 'Alerts & live operations'}</h4>
              <p className="mt-2 text-sm text-slate-600">
                {isRTL ? 'تنبيهات توصّل الفريق على طول، وتحديثات حجوزات لحظية.' : 'Team notifications and booking updates in real time.'}
              </p>
            </Link>
            <Link
              to="/advantages?tab=products"
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
                <span className="text-2xl" aria-hidden>
                  📥
                </span>
              </div>
              <h4 className="font-black text-slate-900">{isRTL ? 'تصدير وتحليل أعمق' : 'Exports & deeper analysis'}</h4>
              <p className="mt-2 text-sm text-slate-600">
                {isRTL ? 'CSV وExcel وPDF عشان تشارك التقارير مع فريقك بسهولة.' : 'CSV, Excel, and PDF for your team workflows.'}
              </p>
            </Link>
          </div>
        </div>
      </section>

      <section id={IDS.faq} className={`scroll-mt-40 py-14 md:pb-24 md:pt-20 ${sectionShell('white')}`}>
        <div className="mx-auto max-w-7xl px-4">
          <header className="mb-10 text-center">
            <p className="text-sm font-semibold text-blue-700">{isRTL ? 'أسئلة متكررة' : 'FAQ'}</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900 md:text-4xl">{content.faqTitle}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600">{content.faqSubtitle}</p>
          </header>
          <div className="mx-auto grid max-w-5xl gap-3">
            {(content.faqItems || []).map((faq, idx) => (
              <details key={`${faq.q}-${idx}`} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <summary className="cursor-pointer list-none text-base font-black text-slate-900">
                  <span className="me-2 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-lg" aria-hidden>
                    ❓
                  </span>
                  {faq.q}
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 ps-10">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
