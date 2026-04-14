export const LANDING_SECTION_TYPES = [
  'hero',
  'features',
  'advantages',
  'stats',
  'faq',
  'services',
  'packages',
  'partners',
  'cta',
  'footer',
] as const;

export type LandingSectionType = (typeof LANDING_SECTION_TYPES)[number];
export const LANDING_TEMPLATE_IDS = ['default', 'conversion', 'minimal'] as const;
export type LandingTemplateId = (typeof LANDING_TEMPLATE_IDS)[number];

export interface LandingSection {
  id?: string;
  type: LandingSectionType;
  order_index: number;
  is_visible: boolean;
  content: Record<string, unknown>;
}

export interface LandingPageData {
  id: string;
  tenant_id: string;
  name: string;
  is_active?: boolean;
  sections: LandingSection[];
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

export function defaultSectionContent(type: LandingSectionType): Record<string, unknown> {
  switch (type) {
    case 'hero':
      return {
        title: 'Experience Luxury Like Never Before',
        title_ar: 'اختبر الفخامة كما لم تختبرها من قبل',
        subtitle: 'Book your exclusive appointment today.',
        subtitle_ar: 'احجز موعدك الحصري اليوم.',
        hero_image_url: '',
        hero_video_url: '',
        hero_images: [],
        primary_color: '#2563eb',
        secondary_color: '#3b82f6',
      };
    case 'features':
      return { title: 'Why Choose Us', title_ar: 'لماذا تختارنا', items: [] };
    case 'advantages':
      return { title: 'Our Advantages', title_ar: 'مميزاتنا', items: [] };
    case 'stats':
      return { title: 'Trusted by customers', title_ar: 'موثوق من العملاء', items: [] };
    case 'faq':
      return { title: 'Frequently Asked Questions', title_ar: 'الأسئلة الشائعة', faq_items: [] };
    case 'services':
      return {
        title: 'Our Services',
        title_ar: 'خدماتنا',
        subtitle: 'Choose the right service for your needs',
        subtitle_ar: 'اختر الخدمة المناسبة لاحتياجك',
        book_now_pay_later_text: 'Book now, pay later',
        book_now_pay_later_text_ar: 'احجز الآن وادفع لاحقاً',
        flexible_duration_text: 'Flexible duration',
        flexible_duration_text_ar: 'مدة مرنة',
        enable_search: true,
      };
    case 'packages':
      return {
        title: 'Our Packages',
        title_ar: 'باقاتنا',
        subtitle: 'Save more when you bundle services',
        subtitle_ar: 'وفّر أكثر عند دمج الخدمات',
      };
    case 'partners':
      return { title: 'Our Partners', title_ar: 'شركاؤنا', logos: [] };
    case 'cta':
      return {
        title: 'Ready to Book?',
        title_ar: 'جاهز للحجز؟',
        subtitle: 'Choose your preferred service and reserve now.',
        subtitle_ar: 'اختر خدمتك المفضلة واحجز الآن.',
        button_label: 'Book Now',
        button_label_ar: 'احجز الآن',
        button_target: '#services',
      };
    case 'footer':
      return {
        about_title: 'About Us',
        about_title_ar: 'معلومات عنا',
        about_description: '',
        about_description_ar: '',
        contact_email: '',
        contact_phone: '',
        social_facebook: '',
        social_twitter: '',
        social_instagram: '',
      };
    default:
      return {};
  }
}

export function createDefaultSections(): LandingSection[] {
  return LANDING_SECTION_TYPES.map((type, index) => ({
    type,
    order_index: index,
    is_visible: true,
    content: defaultSectionContent(type),
  }));
}

export function createSectionsFromTemplate(templateId: LandingTemplateId): LandingSection[] {
  if (templateId === 'minimal') {
    const minimalOrder: LandingSectionType[] = ['hero', 'services', 'packages', 'cta', 'footer'];
    return minimalOrder.map((type, index) => ({
      type,
      order_index: index,
      is_visible: true,
      content: defaultSectionContent(type),
    }));
  }

  if (templateId === 'conversion') {
    const conversionOrder: LandingSectionType[] = ['hero', 'stats', 'features', 'services', 'packages', 'faq', 'cta', 'footer'];
    return conversionOrder.map((type, index) => {
      const base = defaultSectionContent(type);
      if (type === 'hero') {
        return {
          type,
          order_index: index,
          is_visible: true,
          content: {
            ...base,
            title: 'Book Your Appointment in 60 Seconds',
            title_ar: 'احجز موعدك خلال 60 ثانية',
            subtitle: 'Fast booking, trusted service, and instant confirmation.',
            subtitle_ar: 'حجز سريع، خدمة موثوقة، وتأكيد فوري.',
          },
        };
      }
      if (type === 'cta') {
        return {
          type,
          order_index: index,
          is_visible: true,
          content: {
            ...base,
            title: 'Limited Slots Available Today',
            title_ar: 'مقاعد محدودة متاحة اليوم',
            button_label: 'Reserve My Slot',
            button_label_ar: 'احجز مقعدي الآن',
          },
        };
      }
      return {
        type,
        order_index: index,
        is_visible: true,
        content: base,
      };
    });
  }

  return createDefaultSections();
}

function normalizeCards(value: unknown): Array<Record<string, unknown>> {
  return asArray(value)
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => !!row)
    .map((row) => ({
      icon: asString(row.icon),
      title: asString(row.title),
      title_ar: asString(row.title_ar),
      description: asString(row.description),
      description_ar: asString(row.description_ar),
    }))
    .filter((row) => row.title.trim() && row.description.trim());
}

function normalizeFaq(value: unknown): Array<Record<string, unknown>> {
  return asArray(value)
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => !!row)
    .map((row) => ({
      question: asString(row.question),
      question_ar: asString(row.question_ar),
      answer: asString(row.answer),
      answer_ar: asString(row.answer_ar),
    }))
    .filter((row) => row.question.trim() && row.answer.trim());
}

export function sanitizeSection(section: LandingSection): LandingSection {
  const base = defaultSectionContent(section.type);
  const content = section.content && typeof section.content === 'object' ? section.content : {};
  if (section.type === 'faq') {
    return { ...section, content: { ...base, ...content, faq_items: normalizeFaq((content as any).faq_items) } };
  }
  if (section.type === 'features' || section.type === 'advantages' || section.type === 'stats') {
    return { ...section, content: { ...base, ...content, items: normalizeCards((content as any).items) } };
  }
  if (section.type === 'partners') {
    return { ...section, content: { ...base, ...content, logos: asArray((content as any).logos) } };
  }
  return { ...section, content: { ...base, ...content } };
}

export function normalizeSections(input: unknown): LandingSection[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row, index) => {
      if (!row || typeof row !== 'object') return null;
      const section = row as Record<string, unknown>;
      const type = String(section.type || '').trim() as LandingSectionType;
      if (!LANDING_SECTION_TYPES.includes(type)) return null;
      return sanitizeSection({
        id: typeof section.id === 'string' ? section.id : undefined,
        type,
        order_index: Number.isFinite(section.order_index) ? Number(section.order_index) : index,
        is_visible: section.is_visible !== false,
        content: section.content && typeof section.content === 'object' ? (section.content as Record<string, unknown>) : {},
      });
    })
    .filter((row): row is LandingSection => !!row)
    .sort((a, b) => a.order_index - b.order_index)
    .map((row, index) => ({ ...row, order_index: index }));
}

export function validateSection(section: LandingSection): string[] {
  const errors: string[] = [];
  const content = section.content || {};
  if (section.type === 'hero' && !asString(content.title).trim() && !asString(content.title_ar).trim()) {
    errors.push('Hero section requires a title.');
  }
  if (section.type === 'faq' && normalizeFaq((content as any).faq_items).length === 0) {
    errors.push('FAQ section requires at least one FAQ item.');
  }
  if ((section.type === 'features' || section.type === 'advantages') && normalizeCards((content as any).items).length === 0) {
    errors.push(`${section.type} section requires at least one item.`);
  }
  if (section.type === 'cta' && !asString(content.button_label).trim() && !asString(content.button_label_ar).trim()) {
    errors.push('CTA section requires button label.');
  }
  return errors;
}

export function validateSections(sections: LandingSection[]): string[] {
  return sections.flatMap((section) => validateSection(section).map((msg) => `${section.type}: ${msg}`));
}

export function duplicateSectionInList(sections: LandingSection[], sectionId: string): LandingSection[] {
  const index = sections.findIndex((section) => (section.id || `${section.type}-${section.order_index}`) === sectionId);
  if (index < 0) return normalizeOrderSafe(sections);
  const source = sections[index];
  const clone: LandingSection = {
    ...source,
    id: undefined,
    content: JSON.parse(JSON.stringify(source.content || {})),
  };
  const next = [...sections];
  next.splice(index + 1, 0, clone);
  return normalizeOrderSafe(next);
}

function normalizeOrderSafe(sections: LandingSection[]): LandingSection[] {
  return sections.map((section, index) => ({ ...section, order_index: index }));
}
