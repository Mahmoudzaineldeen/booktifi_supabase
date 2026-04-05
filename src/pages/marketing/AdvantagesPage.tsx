import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { LandingPageLayout } from './LandingPageLayout';

export function AdvantagesPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const isRTL = i18n.language === 'ar';
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'products' | 'advantages' | 'operations'>('products');

  useEffect(() => {
    if (tabFromUrl === 'products' || tabFromUrl === 'advantages' || tabFromUrl === 'operations') {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    document.title = isRTL ? 'مميزاتنا | Bookati' : 'Advantages | Bookati';
  }, [isRTL]);

  const tabs = isRTL
    ? [
        { id: 'products' as const, label: 'المنظومة الكاملة' },
        { id: 'advantages' as const, label: 'مميزاتنا التنافسية' },
        { id: 'operations' as const, label: 'التشغيل الذكي' },
      ]
    : [
        { id: 'products' as const, label: 'Complete Suite' },
        { id: 'advantages' as const, label: 'Competitive Edge' },
        { id: 'operations' as const, label: 'Smart Operations' },
      ];

  const tabContent = useMemo(() => {
    if (isRTL) {
      return {
        products: {
          title: '11 وحدة تشغيل. منصة واحدة.',
          subtitle: 'ما هو متاح اليوم في لوحة الإدارة، الاستقبال/الكاشير، وبوابة العميل.',
          cards: [
            { no: '01', title: 'نظام الحجوزات', desc: 'لوحة حجوزات كاملة مع تدفق حجز للعملاء.', emoji: '📅', tone: 'bg-blue-50' },
            { no: '02', title: 'صفحة الحجز والموقع', desc: 'محرر الصفحة العامة ورابط حجز باسم نشاطك.', emoji: '🌐', tone: 'bg-emerald-50' },
            { no: '03', title: 'الاستقبال والكاشير', desc: 'استقبال للزيارات والبيع؛ كاشير للمعاملات.', emoji: '🧾', tone: 'bg-violet-50' },
            { no: '04', title: 'الباقات والمشتركين', desc: 'باقات، تجديدات، ومتابعة المشتركين.', emoji: '🔁', tone: 'bg-sky-50' },
            { no: '05', title: 'العروض والترويج', desc: 'عروض وخصومات لتنشيط المبيعات.', emoji: '🎁', tone: 'bg-rose-50' },
            { no: '06', title: 'إدارة الفروع', desc: 'فروع متعددة من حساب واحد.', emoji: '🏢', tone: 'bg-amber-50' },
            { no: '07', title: 'الخدمات والوسوم', desc: 'خدمات وتسعير مرن بالوسوم والمدة.', emoji: '🏷️', tone: 'bg-orange-50' },
            { no: '08', title: 'الموظفين والورديات', desc: 'فريق وورديات حسب نموذج التشغيل.', emoji: '👥', tone: 'bg-cyan-50' },
            { no: '09', title: 'التقارير والتصدير', desc: 'زيارات، حجوزات، معاملات، وملفات جاهزة للتصدير.', emoji: '📊', tone: 'bg-indigo-50' },
            { no: '10', title: 'بوابة العميل', desc: 'دخول العميل، لوحة، وفوترة.', emoji: '🙋', tone: 'bg-pink-50' },
            { no: '11', title: 'الأدوار واللوحة', desc: 'صلاحيات مخصصة وتخصيص لوحة التحكم.', emoji: '🛡️', tone: 'bg-slate-100' },
          ],
        },
        advantages: {
          title: 'لماذا نحن مختلفون في السوق السعودي؟',
          subtitle: 'مزايا عملية تركّز على النتائج اليومية لنشاطك.',
          cards: [
            { no: '01', title: 'مبني للسعودية من الصفر', desc: 'واجهة عربية RTL وسيناريوهات تشغيل محلية.', emoji: '🇸🇦', tone: 'bg-emerald-50' },
            { no: '02', title: 'تجارة موحدة', desc: 'خدمات ومنتجات وباقات واشتراكات وتذاكر.', emoji: '🧩', tone: 'bg-blue-50' },
            { no: '03', title: 'تكاملات جاهزة', desc: 'Zoho وDaftra ضمن منظومة التشغيل.', emoji: '🔌', tone: 'bg-indigo-50' },
            { no: '04', title: 'تقارير تنفيذية', desc: 'لوحات واضحة لدعم القرار السريع.', emoji: '📊', tone: 'bg-cyan-50' },
            { no: '05', title: 'توسع مرن', desc: 'تشغيل فروع متعددة من لوحة واحدة.', emoji: '🏢', tone: 'bg-violet-50' },
          ],
        },
        operations: {
          title: 'تشغيل أذكى، أخطاء أقل',
          subtitle: 'أتمتة عملية تجعل الفريق أسرع وأكثر دقة.',
          cards: [
            { no: '01', title: 'توزيع موظفين تلقائي', desc: 'تعيين حسب التوفر لتقليل التعارض.', emoji: '🤖', tone: 'bg-sky-50' },
            { no: '02', title: 'تنبيهات فورية', desc: 'تحديثات لحظية للحجوزات والمهام.', emoji: '🔔', tone: 'bg-yellow-50' },
            { no: '03', title: 'تسعير بالوسوم', desc: 'تغيير المدة والسعر حسب سيناريو الخدمة.', emoji: '🏷️', tone: 'bg-orange-50' },
            { no: '04', title: 'صلاحيات دقيقة', desc: 'كل مستخدم يرى ما يلزمه فقط.', emoji: '🔐', tone: 'bg-slate-100' },
            { no: '05', title: 'فوترة منظمة', desc: 'تدفق فوترة أوضح وتقليل الإدخال اليدوي.', emoji: '🧾', tone: 'bg-emerald-50' },
            { no: '06', title: 'تطبيق موظفين متعدد اللغات', desc: 'كل موظف يشتغل بلغته المفضلة.', emoji: '🌍', tone: 'bg-indigo-50' },
          ],
        },
      };
    }
    return {
      products: {
        title: '11 modules. One platform.',
        subtitle: 'What ships today across admin, reception/cashier, and the customer portal.',
        cards: [
          { no: '01', title: 'Bookings', desc: 'Full admin booking tools plus the public booking journey.', emoji: '📅', tone: 'bg-blue-50' },
          { no: '02', title: 'Landing & booking link', desc: 'Public landing editor and your branded booking URL.', emoji: '🌐', tone: 'bg-emerald-50' },
          { no: '03', title: 'Reception & cashier', desc: 'Front-desk visits and sales; cashier checkout flows.', emoji: '🧾', tone: 'bg-violet-50' },
          { no: '04', title: 'Packages & subscribers', desc: 'Plans, renewals, and subscriber lifecycle.', emoji: '🔁', tone: 'bg-sky-50' },
          { no: '05', title: 'Offers & promotions', desc: 'Discounts and promos to lift conversions.', emoji: '🎁', tone: 'bg-rose-50' },
          { no: '06', title: 'Branches', desc: 'Multi-location control from one account.', emoji: '🏢', tone: 'bg-amber-50' },
          { no: '07', title: 'Services & pricing tags', desc: 'Catalog with tag-based duration and pricing rules.', emoji: '🏷️', tone: 'bg-orange-50' },
          { no: '08', title: 'Staff & shifts', desc: 'Roster and shift scheduling when your plan enables it.', emoji: '👥', tone: 'bg-cyan-50' },
          { no: '09', title: 'Reports & exports', desc: 'Visitors, bookings, transactions, CSV/Excel/PDF.', emoji: '📊', tone: 'bg-indigo-50' },
          { no: '10', title: 'Customer portal', desc: 'Customer login, dashboard, and billing.', emoji: '🙋', tone: 'bg-pink-50' },
          { no: '11', title: 'Roles & dashboard', desc: 'Custom permissions and drag-and-drop dashboard widgets.', emoji: '🛡️', tone: 'bg-slate-100' },
        ],
      },
      advantages: {
        title: 'Why we stand out',
        subtitle: 'Practical strengths focused on daily business results.',
        cards: [
          { no: '01', title: 'Saudi-first by design', desc: 'RTL-first Arabic UX and local workflows.', emoji: '🇸🇦', tone: 'bg-emerald-50' },
          { no: '02', title: 'Unified commerce', desc: 'Services, products, packages, subscriptions, and tickets.', emoji: '🧩', tone: 'bg-blue-50' },
          { no: '03', title: 'Ready integrations', desc: 'Zoho and Daftra as part of your operations.', emoji: '🔌', tone: 'bg-indigo-50' },
          { no: '04', title: 'Executive analytics', desc: 'Clear dashboard visibility for quick decisions.', emoji: '📊', tone: 'bg-cyan-50' },
          { no: '05', title: 'Scalable structure', desc: 'Multi-branch control from one platform.', emoji: '🏢', tone: 'bg-violet-50' },
        ],
      },
      operations: {
        title: 'Smarter operations, fewer errors',
        subtitle: 'Automation that keeps teams faster and more consistent.',
        cards: [
          { no: '01', title: 'Auto assignment', desc: 'Distribute staff by availability.', emoji: '🤖', tone: 'bg-sky-50' },
          { no: '02', title: 'Real-time alerts', desc: 'Instant updates for bookings and task flow.', emoji: '🔔', tone: 'bg-yellow-50' },
          { no: '03', title: 'Tag-based pricing', desc: 'Control time and fee behavior by service context.', emoji: '🏷️', tone: 'bg-orange-50' },
          { no: '04', title: 'Permission control', desc: 'Each user sees only what they need.', emoji: '🔐', tone: 'bg-slate-100' },
          { no: '05', title: 'Organized invoicing', desc: 'Cleaner billing with less manual friction.', emoji: '🧾', tone: 'bg-emerald-50' },
          { no: '06', title: 'Multi-language staff app', desc: 'Every employee can work in preferred language.', emoji: '🌍', tone: 'bg-indigo-50' },
        ],
      },
    };
  }, [isRTL]);

  const current = tabContent[activeTab];

  return (
    <LandingPageLayout>
      <main className="mx-auto max-w-7xl px-4 py-12">
        <div className="mb-8 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                activeTab === tab.id
                  ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mb-8 text-center">
          <p className="text-sm font-semibold text-blue-700">{tabs.find((t) => t.id === activeTab)?.label}</p>
          <h1 className="mt-2 text-4xl font-black text-slate-900 md:text-5xl">{current.title}</h1>
          <p className="mt-3 text-lg text-slate-600">{current.subtitle}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {current.cards.map((card) => (
            <article key={`${activeTab}-${card.no}-${card.title}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl ${card.tone}`}>
                <span className="text-2xl">{card.emoji}</span>
              </div>
              <h2 className="text-2xl font-black text-slate-900">{card.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{card.desc}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 rounded-2xl bg-blue-700 p-8 text-white">
          <h3 className="text-2xl font-black">{isRTL ? 'ابدأ الآن' : 'Start now'}</h3>
          <p className="mt-2 text-blue-100">{isRTL ? 'جرب النظام بنفسك وشوف الفرق في تشغيل نشاطك.' : 'Experience the platform and measure the impact.'}</p>
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

