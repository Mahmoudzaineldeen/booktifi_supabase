import React from 'react';
import { FAQ } from '../ui/FAQ';
import { ImageCarousel } from '../ui/ImageCarousel';
import type { LandingSection } from '../../lib/landingSections';

type PublicService = {
  id: string;
  name: string;
  name_ar?: string;
  description?: string;
  description_ar?: string;
  base_price?: number;
  image_url?: string;
  gallery_urls?: string[];
  is_offer?: boolean;
  service_id?: string;
  offer_id?: string;
};

type Props = {
  sections: LandingSection[];
  language: string;
  tenantName: string;
  tenantNameAr?: string;
  services?: PublicService[];
  onSelectService?: (service: PublicService) => void;
  formatPrice?: (value: number) => string;
  previewMode?: boolean;
};

const pickText = (language: string, arValue: unknown, enValue: unknown, fallback = '') =>
  language === 'ar' ? String(arValue || enValue || fallback) : String(enValue || arValue || fallback);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function SectionWrapper({
  id,
  children,
  className = '',
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`py-14 px-4 ${className}`}>
      <div className="max-w-7xl mx-auto">{children}</div>
    </section>
  );
}

export function LandingSectionsRenderer({
  sections,
  language,
  tenantName,
  tenantNameAr,
  services = [],
  onSelectService,
  formatPrice = (v) => String(v ?? 0),
  previewMode = false,
}: Props) {
  const visibleSections = React.useMemo(
    () =>
      sections
        .filter((section) => section.is_visible !== false)
        .sort((a, b) => a.order_index - b.order_index),
    [sections]
  );

  return (
    <div className="bg-gray-50">
      {visibleSections.map((section) => {
        const content = section.content || {};
        if (section.type === 'hero') {
          const images = asArray(content.hero_images).filter((v): v is string => typeof v === 'string' && !!v.trim());
          const fallbackImage = typeof content.hero_image_url === 'string' ? content.hero_image_url : '';
          const heroImages = images.length > 0 ? images : (fallbackImage ? [fallbackImage] : []);
          const title = pickText(language, content.title_ar, content.title, language === 'ar' ? 'احجز خدمتك الآن' : 'Book your service now');
          const subtitle = pickText(language, content.subtitle_ar, content.subtitle, '');
          const primaryColor = String(content.primary_color || '#2563eb');

          return (
            <SectionWrapper key={section.id || `${section.type}-${section.order_index}`} className="pt-12">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-10">
                <div>
                  <h1 className="text-3xl md:text-5xl font-bold text-gray-900 leading-tight">{title}</h1>
                  {subtitle ? <p className="mt-4 text-lg text-gray-600">{subtitle}</p> : null}
                  {!previewMode && (
                    <a
                      href="#services"
                      className="inline-flex mt-6 rounded-lg px-5 py-3 text-white font-semibold"
                      style={{ backgroundColor: primaryColor }}
                    >
                      {language === 'ar' ? 'ابدأ الحجز' : 'Start Booking'}
                    </a>
                  )}
                </div>
                <div className="rounded-xl overflow-hidden bg-gray-100 min-h-[220px]">
                  {heroImages.length > 1 ? (
                    <ImageCarousel images={heroImages} className="h-[320px]" aspectRatio="auto" />
                  ) : heroImages.length === 1 ? (
                    <img src={heroImages[0]} alt={title} className="w-full h-[320px] object-cover" />
                  ) : (
                    <div className="w-full h-[320px] flex items-center justify-center text-gray-400">
                      {language === 'ar' ? 'لا توجد صورة' : 'No hero image'}
                    </div>
                  )}
                </div>
              </div>
            </SectionWrapper>
          );
        }

        if (section.type === 'services') {
          const title = pickText(language, content.title_ar, content.title, language === 'ar' ? 'الخدمات' : 'Services');
          const subtitle = pickText(language, content.subtitle_ar, content.subtitle, '');
          return (
            <SectionWrapper id="services" key={section.id || `${section.type}-${section.order_index}`} className="bg-white">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
                {subtitle ? <p className="mt-2 text-gray-600">{subtitle}</p> : null}
              </div>
              {services.length === 0 ? (
                <div className="text-center text-gray-500 py-8">{language === 'ar' ? 'لا توجد خدمات' : 'No services available'}</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {services.map((service) => {
                    const image = service.image_url || (service.gallery_urls && service.gallery_urls[0]) || '';
                    const serviceName = language === 'ar' ? service.name_ar || service.name : service.name || service.name_ar || '';
                    const serviceDescription = language === 'ar'
                      ? service.description_ar || service.description || ''
                      : service.description || service.description_ar || '';
                    return (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => onSelectService?.(service)}
                        className="text-start rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition overflow-hidden"
                        disabled={previewMode}
                      >
                        {image ? <img src={image} alt={serviceName} className="w-full h-40 object-cover" /> : null}
                        <div className="p-4">
                          <h3 className="font-semibold text-gray-900 text-lg">{serviceName}</h3>
                          {serviceDescription ? (
                            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{serviceDescription}</p>
                          ) : null}
                          <p className="mt-3 font-bold text-blue-600">{formatPrice(Number(service.base_price || 0))}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </SectionWrapper>
          );
        }

        if (section.type === 'features' || section.type === 'advantages' || section.type === 'stats') {
          const title = pickText(language, content.title_ar, content.title, section.type);
          const items = asArray(content.items).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
          return (
            <SectionWrapper key={section.id || `${section.type}-${section.order_index}`}>
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((item, idx) => {
                  const itemTitle = pickText(language, item.title_ar, item.title, '');
                  const itemDescription = pickText(language, item.description_ar, item.description, '');
                  const value = String(item.value || '').trim();
                  return (
                    <div key={`${section.type}-${idx}`} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                      {value ? <div className="text-3xl font-bold text-blue-600">{value}</div> : null}
                      {itemTitle ? <h3 className="mt-2 font-semibold text-gray-900">{itemTitle}</h3> : null}
                      {itemDescription ? <p className="mt-1 text-sm text-gray-600">{itemDescription}</p> : null}
                    </div>
                  );
                })}
              </div>
            </SectionWrapper>
          );
        }

        if (section.type === 'faq') {
          const title = pickText(language, content.title_ar, content.title, language === 'ar' ? 'الأسئلة الشائعة' : 'FAQ');
          const faqItems = asArray(content.faq_items)
            .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
            .filter((row): row is Record<string, unknown> => !!row)
            .map((row) => ({
              question: String(row.question || ''),
              question_ar: String(row.question_ar || ''),
              answer: String(row.answer || ''),
              answer_ar: String(row.answer_ar || ''),
            }))
            .filter((row) => row.question && row.answer);
          return (
            <SectionWrapper key={section.id || `${section.type}-${section.order_index}`} className="bg-white">
              <div className="max-w-4xl mx-auto">
                <h2 className="text-3xl font-bold text-center text-gray-900 mb-8">{title}</h2>
                <FAQ items={faqItems} language={language as 'en' | 'ar'} allowMultipleOpen={false} />
              </div>
            </SectionWrapper>
          );
        }

        if (section.type === 'partners') {
          const title = pickText(language, content.title_ar, content.title, language === 'ar' ? 'شركاؤنا' : 'Our Partners');
          const logos = asArray(content.logos).filter((v): v is string => typeof v === 'string' && !!v.trim());
          return (
            <SectionWrapper key={section.id || `${section.type}-${section.order_index}`}>
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {logos.length > 0 ? logos.map((logo, idx) => (
                  <div key={`logo-${idx}`} className="h-20 rounded-lg border border-gray-200 bg-white p-2 flex items-center justify-center">
                    <img src={logo} alt={`partner-${idx}`} className="max-h-full object-contain" />
                  </div>
                )) : (
                  <div className="col-span-full text-center text-gray-500 py-6">
                    {language === 'ar' ? 'لم تتم إضافة شركاء بعد' : 'No partners added yet'}
                  </div>
                )}
              </div>
            </SectionWrapper>
          );
        }

        if (section.type === 'cta') {
          const title = pickText(language, content.title_ar, content.title, language === 'ar' ? 'ابدأ الآن' : 'Get Started');
          const subtitle = pickText(language, content.subtitle_ar, content.subtitle, '');
          const buttonLabel = pickText(language, content.button_label_ar, content.button_label, language === 'ar' ? 'احجز الآن' : 'Book Now');
          const buttonTarget = String(content.button_target || '#services');
          return (
            <SectionWrapper key={section.id || `${section.type}-${section.order_index}`} className="bg-white">
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-8 text-center">
                <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
                {subtitle ? <p className="mt-2 text-gray-700">{subtitle}</p> : null}
                {!previewMode && (
                  <a href={buttonTarget} className="inline-flex mt-5 rounded-lg bg-blue-600 text-white px-5 py-3 font-semibold">
                    {buttonLabel}
                  </a>
                )}
              </div>
            </SectionWrapper>
          );
        }

        if (section.type === 'footer') {
          const businessName = language === 'ar' ? tenantNameAr || tenantName : tenantName || tenantNameAr || '';
          const aboutTitle = pickText(language, content.about_title_ar, content.about_title, language === 'ar' ? 'معلومات عنا' : 'About Us');
          const aboutDescription = pickText(language, content.about_description_ar, content.about_description, '');
          const email = String(content.contact_email || '');
          const phone = String(content.contact_phone || '');
          return (
            <footer key={section.id || `${section.type}-${section.order_index}`} className="bg-gray-900 text-white py-12 px-4">
              <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
                <div>
                  <h3 className="text-2xl font-bold">{businessName}</h3>
                  <p className="text-gray-300 mt-2">{aboutDescription}</p>
                </div>
                <div>
                  <h4 className="font-semibold">{aboutTitle}</h4>
                  <p className="text-gray-300 mt-2">{aboutDescription}</p>
                </div>
                <div>
                  <h4 className="font-semibold">{language === 'ar' ? 'تواصل معنا' : 'Contact'}</h4>
                  {email ? <p className="text-gray-300 mt-2">{email}</p> : null}
                  {phone ? <p className="text-gray-300 mt-1">{phone}</p> : null}
                </div>
              </div>
            </footer>
          );
        }

        return null;
      })}
    </div>
  );
}
