import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Clock, CreditCard, Package, Star } from 'lucide-react';
import { FAQ } from '../ui/FAQ';
import { ImageCarousel } from '../ui/ImageCarousel';
import { SearchInput } from '../ui/SearchInput';
import type { LandingSection } from '../../lib/landingSections';

const TICKET_PERFORATIONS = 11;

type PublicService = {
  id: string;
  name: string;
  name_ar?: string;
  description?: string;
  description_ar?: string;
  base_price?: number;
  duration_minutes?: number;
  image_url?: string;
  gallery_urls?: string[];
  is_offer?: boolean;
  service_id?: string;
  offer_id?: string;
  average_rating?: number;
  total_reviews?: number;
  badges?: Array<{ type?: string; label?: string }>;
};

/** Package row shape matches `service_packages` + joined services (public booking page). */
export type PublicPackageCard = {
  id: string;
  name: string;
  name_ar?: string;
  description?: string;
  description_ar?: string;
  total_price: number;
  original_price?: number | null;
  discount_percentage?: number | null;
  image_url?: string;
  gallery_urls?: string[];
  services?: Array<{ service_id: string; service_name: string; service_name_ar: string; quantity: number }>;
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
  /** Live tenant packages (ignored when section not present). */
  packages?: PublicPackageCard[];
  packagesEnabled?: boolean;
  formatPackageDisplayName?: (pkg: PublicPackageCard, language: string) => string;
  onSelectPackage?: (pkg: PublicPackageCard) => void;
  /** Optional review rows keyed by service id (e.g. loaded on public booking page). */
  serviceReviewsByServiceId?: Record<string, Array<{ rating?: number }>>;
  onShowMoreService?: (service: PublicService) => void;
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
  packages = [],
  packagesEnabled = true,
  formatPackageDisplayName,
  onSelectPackage,
  serviceReviewsByServiceId,
  onShowMoreService,
}: Props) {
  const { t } = useTranslation();
  const visibleSections = React.useMemo(
    () =>
      sections
        .filter((section) => section.is_visible !== false)
        .sort((a, b) => a.order_index - b.order_index),
    [sections]
  );
  const themeColors = React.useMemo(() => {
    const hero = sections.find((section) => section.type === 'hero');
    const content = hero?.content || {};
    return {
      primary: String((content as Record<string, unknown>).primary_color || '#2563eb'),
      secondary: String((content as Record<string, unknown>).secondary_color || '#3b82f6'),
    };
  }, [sections]);
  const [serviceSearchQuery, setServiceSearchQuery] = React.useState('');
  const [servicePage, setServicePage] = React.useState(1);
  const servicesPerPage = 6;
  const filteredServices = React.useMemo(() => {
    const query = serviceSearchQuery.trim().toLowerCase();
    if (!query) return services;
    return services.filter((service) => {
      const name = String(service.name || '').toLowerCase();
      const nameAr = String(service.name_ar || '').toLowerCase();
      const description = String(service.description || '').toLowerCase();
      const descriptionAr = String(service.description_ar || '').toLowerCase();
      return (
        name.includes(query) ||
        nameAr.includes(query) ||
        description.includes(query) ||
        descriptionAr.includes(query)
      );
    });
  }, [services, serviceSearchQuery]);
  const totalServicePages = Math.max(1, Math.ceil(filteredServices.length / servicesPerPage));
  const paginatedServices = React.useMemo(() => {
    if (previewMode) return filteredServices.slice(0, 3);
    const start = (servicePage - 1) * servicesPerPage;
    return filteredServices.slice(start, start + servicesPerPage);
  }, [filteredServices, previewMode, servicePage]);

  React.useEffect(() => {
    setServicePage(1);
  }, [serviceSearchQuery]);

  React.useEffect(() => {
    if (servicePage > totalServicePages) {
      setServicePage(totalServicePages);
    }
  }, [servicePage, totalServicePages]);

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
          const bookNowPayLaterText = pickText(
            language,
            content.book_now_pay_later_text_ar,
            content.book_now_pay_later_text,
            language === 'ar' ? 'احجز الآن وادفع لاحقاً' : 'Book now, pay later'
          );
          const flexibleDurationText = pickText(
            language,
            content.flexible_duration_text_ar,
            content.flexible_duration_text,
            language === 'ar' ? 'مدة مرنة' : 'Flexible duration'
          );
          return (
            <SectionWrapper id="services" key={section.id || `${section.type}-${section.order_index}`} className="bg-white">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
                {subtitle ? <p className="mt-2 text-gray-600">{subtitle}</p> : null}
              </div>
              {!previewMode && (
                <div className="mb-8 max-w-2xl mx-auto">
                  <SearchInput
                    placeholder={t('booking.searchServices')}
                    value={serviceSearchQuery}
                    onChange={(e) => setServiceSearchQuery(e.target.value)}
                    onClear={() => setServiceSearchQuery('')}
                    inputClassName="text-base sm:text-lg"
                  />
                </div>
              )}
              {services.length === 0 ? (
                <div className="text-center text-gray-500 py-8">{language === 'ar' ? 'لا توجد خدمات' : 'No services available'}</div>
              ) : filteredServices.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  {language === 'ar' ? 'لا توجد نتائج مطابقة' : 'No matching services found'}
                </div>
              ) : (
                <>
                <div className="space-y-4 w-full max-w-6xl mx-auto">
                  {paginatedServices.map((service) => {
                    const serviceImages = Array.isArray(service.gallery_urls) && service.gallery_urls.length > 0
                      ? service.gallery_urls.filter((img): img is string => typeof img === 'string' && !!img.trim())
                      : (service.image_url ? [service.image_url] : []);
                    const serviceName = language === 'ar' ? service.name_ar || service.name : service.name || service.name_ar || '';
                    const serviceDescription = language === 'ar'
                      ? service.description_ar || service.description || ''
                      : service.description || service.description_ar || '';
                    const reviewsLookupId =
                      service.is_offer && service.service_id ? String(service.service_id) : service.id;
                    const reviewsList = serviceReviewsByServiceId?.[reviewsLookupId] ?? [];
                    const calculatedRating =
                      reviewsList.length > 0
                        ? reviewsList.reduce((sum, r) => sum + (r.rating || 0), 0) / reviewsList.length
                        : service.average_rating || 0;
                    const displayRating = calculatedRating > 0 ? Math.round(calculatedRating * 10) / 10 : 0;
                    const displayReviewCount =
                      reviewsList.length > 0 ? reviewsList.length : (service.total_reviews || 0);
                    const isOffer = Boolean(service.is_offer);
                    const normalizedBadges = Array.isArray(service.badges)
                      ? service.badges.filter((badge) => badge && typeof badge.type === 'string')
                      : [];
                    const showBookNowPayLater =
                      normalizedBadges.length === 0 ||
                      normalizedBadges.some((badge) => badge.type === 'book-now-pay-later');
                    const showFlexibleDuration =
                      normalizedBadges.length === 0 ||
                      normalizedBadges.some((badge) => badge.type === 'flexible-duration');
                    return (
                      <div
                        key={service.id}
                        className={`w-full text-start rounded-2xl bg-white shadow-sm overflow-hidden transition-shadow hover:shadow-md border ${
                          isOffer ? 'border-amber-200' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex flex-col md:flex-row items-stretch min-h-[180px]">
                          {/* Ticket media (~left quarter): image with ticket perforations */}
                          <div className="relative shrink-0 w-full md:w-[250px] h-[180px] md:h-auto bg-gradient-to-br from-indigo-100 via-violet-50 to-purple-100 flex items-center justify-center overflow-hidden">
                            {serviceImages.length > 1 ? (
                              <ImageCarousel
                                images={serviceImages}
                                className="h-full w-full min-h-[180px]"
                                aspectRatio="auto"
                                showDots
                                showArrows
                              />
                            ) : serviceImages.length === 1 ? (
                              <img
                                src={serviceImages[0]}
                                alt={serviceName}
                                className="absolute inset-0 w-full h-full object-cover"
                              />
                            ) : (
                              <Package className="w-12 h-12 sm:w-14 sm:h-14 text-gray-400" strokeWidth={1.25} />
                            )}
                            <div
                              className="absolute right-0 top-0 bottom-0 w-3 flex flex-col justify-between py-2 items-end pointer-events-none z-10"
                              aria-hidden
                            >
                              {Array.from({ length: TICKET_PERFORATIONS }).map((_, i) => (
                                <div
                                  key={i}
                                  className="w-2.5 h-2.5 rounded-full bg-gray-50 ring-1 ring-slate-200/80 translate-x-1/2"
                                />
                              ))}
                            </div>
                          </div>

                          <div className="flex-1 min-w-0 bg-white p-4 md:px-5 md:py-4 border-t md:border-t-0 md:border-r border-slate-100">
                            <div className="min-w-0 h-full flex flex-col">
                              <div className="flex items-center gap-1.5 mb-2 text-[13px]">
                                {displayRating > 0 ? (
                                  <>
                                    <Star className="w-3.5 h-3.5 text-fuchsia-600 fill-current" />
                                    <span className="font-semibold text-fuchsia-600">
                                      {displayRating}
                                    </span>
                                    <span className="text-fuchsia-600 underline">
                                      ({displayReviewCount.toLocaleString(language === 'ar' ? 'ar' : undefined)})
                                    </span>
                                    <span className="text-gray-500">{language === 'ar' ? 'تذاكر' : 'Tickets'}</span>
                                  </>
                                ) : (
                                  <span className="text-xs text-gray-400">{t('reviews.noReviewsYet')}</span>
                                )}
                              </div>
                              <h3 className="font-bold text-gray-900 text-2xl leading-tight line-clamp-2">
                                {serviceName}
                              </h3>
                              {serviceDescription ? (
                                <p className="text-sm text-gray-700 mt-3 leading-relaxed line-clamp-4">
                                  {serviceDescription}
                                </p>
                              ) : null}
                              {service.duration_minutes ? (
                                <div className="flex items-center gap-1.5 mt-3 text-base text-gray-700">
                                  <Clock className="w-4 h-4 shrink-0" />
                                  <span>
                                    {service.duration_minutes}{' '}
                                    {language === 'ar' ? t('booking.minutes') : 'min'}
                                  </span>
                                </div>
                              ) : null}
                              <button
                                type="button"
                                disabled={previewMode}
                                onClick={() => !previewMode && onShowMoreService?.(service)}
                                className="mt-auto pt-4 inline-flex items-center gap-1.5 text-base font-semibold text-fuchsia-600 hover:text-fuchsia-700 transition-colors disabled:opacity-50"
                              >
                                {t('booking.showMore')}
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="w-full md:w-[250px] p-4 md:px-6 md:py-5 border-t md:border-t-0 md:border-l border-dashed border-slate-200 flex flex-col gap-4 justify-between bg-white">
                            <div>
                              <p className="text-sm text-gray-500">{language === 'ar' ? 'من' : 'from'}</p>
                              <p className="font-bold text-4xl leading-none mt-1" style={{ color: '#111827' }}>
                                {formatPrice(Number(service.base_price || 0))}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={previewMode}
                              onClick={() => !previewMode && onSelectService?.(service)}
                              className="w-full px-4 py-3 text-base font-semibold text-white rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50"
                              style={{ backgroundColor: themeColors.primary }}
                            >
                              {t('booking.checkAvailability')}
                            </button>
                            <div className="space-y-1.5 text-sm text-gray-700">
                              {showBookNowPayLater ? (
                                <div className="flex items-center gap-2">
                                  <CreditCard className="w-4 h-4 text-gray-500" />
                                  <span>{bookNowPayLaterText}</span>
                                </div>
                              ) : null}
                              {showFlexibleDuration ? (
                                <div className="flex items-center gap-2">
                                  <Clock className="w-4 h-4 text-gray-500" />
                                  <span>{flexibleDurationText}</span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!previewMode && totalServicePages > 1 && (
                  <div className="mt-8 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={servicePage <= 1}
                      onClick={() => setServicePage((prev) => Math.max(1, prev - 1))}
                      className="px-3 py-2 rounded-lg border border-gray-300 disabled:opacity-50"
                    >
                      {language === 'ar' ? 'السابق' : 'Prev'}
                    </button>
                    <span className="text-sm text-gray-600 px-2">
                      {language === 'ar'
                        ? `صفحة ${servicePage} من ${totalServicePages}`
                        : `Page ${servicePage} of ${totalServicePages}`}
                    </span>
                    <button
                      type="button"
                      disabled={servicePage >= totalServicePages}
                      onClick={() => setServicePage((prev) => Math.min(totalServicePages, prev + 1))}
                      className="px-3 py-2 rounded-lg border border-gray-300 disabled:opacity-50"
                    >
                      {language === 'ar' ? 'التالي' : 'Next'}
                    </button>
                  </div>
                )}
                </>
              )}
            </SectionWrapper>
          );
        }

        if (section.type === 'packages') {
          const title = pickText(language, content.title_ar, content.title, language === 'ar' ? 'باقاتنا' : 'Our Packages');
          const subtitle = pickText(language, content.subtitle_ar, content.subtitle, '');
          if (!packagesEnabled) {
            return previewMode ? (
              <SectionWrapper id="packages" key={section.id || `${section.type}-${section.order_index}`} className="bg-gray-50">
                <div className="text-center text-gray-500 py-8 text-sm">
                  {language === 'ar' ? 'الباقات معطّلة لهذا المزوّد' : 'Packages are disabled for this tenant'}
                </div>
              </SectionWrapper>
            ) : null;
          }
          return (
            <SectionWrapper id="packages" key={section.id || `${section.type}-${section.order_index}`} className="bg-gray-50">
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
                {subtitle ? <p className="mt-2 text-lg text-gray-600">{subtitle}</p> : null}
              </div>
              {packages.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  {language === 'ar' ? 'لا توجد باقات' : 'No packages available'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                  {packages.map((pkg) => {
                    const displayName = formatPackageDisplayName
                      ? formatPackageDisplayName(pkg, language)
                      : language === 'ar'
                        ? pkg.name_ar || pkg.name
                        : pkg.name || pkg.name_ar || '';
                    let savePct = 0;
                    if (pkg.original_price != null && pkg.original_price > pkg.total_price) {
                      savePct = Math.round(((pkg.original_price - pkg.total_price) / pkg.original_price) * 100);
                    } else if (pkg.discount_percentage) {
                      savePct = pkg.discount_percentage;
                    }
                    const imgs =
                      Array.isArray(pkg.gallery_urls) && pkg.gallery_urls.length > 0
                        ? pkg.gallery_urls.filter((u): u is string => typeof u === 'string' && !!u.trim())
                        : pkg.image_url
                          ? [pkg.image_url]
                          : [];
                    return (
                      <div
                        key={pkg.id}
                        role={previewMode ? undefined : 'button'}
                        tabIndex={previewMode ? undefined : 0}
                        onClick={() => !previewMode && onSelectPackage?.(pkg)}
                        onKeyDown={(e) => {
                          if (previewMode) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectPackage?.(pkg);
                          }
                        }}
                        className={`bg-white rounded-lg shadow-lg overflow-hidden border-2 border-gray-200 transition-all duration-300 ${
                          previewMode ? 'opacity-90' : 'hover:border-blue-400 cursor-pointer'
                        }`}
                      >
                        <div className="relative h-48 overflow-hidden bg-gradient-to-br from-blue-50 to-purple-50">
                          {imgs.length > 1 ? (
                            <ImageCarousel images={imgs} className="h-full w-full" aspectRatio="auto" showDots showArrows />
                          ) : imgs.length === 1 ? (
                            <img src={imgs[0]} alt={displayName} className="w-full h-full object-cover" loading="lazy" />
                          ) : null}
                          {savePct > 0 && (
                            <div className="absolute top-4 right-4">
                              <span className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-bold shadow-md">
                                {language === 'ar' ? `وفر ${savePct}%` : `Save ${savePct}%`}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="p-6">
                          <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">{displayName}</h3>
                          {pkg.description ? (
                            <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                              {language === 'ar' ? pkg.description_ar || pkg.description : pkg.description || pkg.description_ar}
                            </p>
                          ) : null}
                          <div className="flex items-center gap-2 mb-1">
                            {pkg.original_price != null && pkg.original_price > pkg.total_price && (
                              <span className="text-sm text-gray-400 line-through">{formatPrice(Number(pkg.original_price))}</span>
                            )}
                            <span className="text-xl font-bold" style={{ color: themeColors.primary }}>
                              {formatPrice(Number(pkg.total_price))}
                            </span>
                          </div>
                          {pkg.services && pkg.services.length > 0 && (
                            <p className="text-xs text-gray-500">
                              {language === 'ar'
                                ? `${pkg.services.length} خدمة متضمنة`
                                : `${pkg.services.length} services included`}
                            </p>
                          )}
                        </div>
                      </div>
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
                      {value ? (
                        <div className="text-3xl font-bold" style={{ color: themeColors.primary }}>
                          {value}
                        </div>
                      ) : null}
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
          const cardBackground = `${themeColors.primary}12`;
          return (
            <SectionWrapper key={section.id || `${section.type}-${section.order_index}`} className="bg-white">
              <div
                className="rounded-2xl p-8 text-center"
                style={{ border: `1px solid ${themeColors.primary}25`, backgroundColor: cardBackground }}
              >
                <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
                {subtitle ? <p className="mt-2 text-gray-700">{subtitle}</p> : null}
                {!previewMode && (
                  <a
                    href={buttonTarget}
                    className="inline-flex mt-5 rounded-lg text-white px-5 py-3 font-semibold"
                    style={{ backgroundColor: themeColors.primary }}
                  >
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
