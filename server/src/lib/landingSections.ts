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

export type LandingSectionInput = {
  id?: string;
  type: LandingSectionType;
  order_index: number;
  is_visible?: boolean;
  content?: Record<string, unknown>;
};

export type LandingSectionRecord = {
  id: string;
  page_id: string;
  type: LandingSectionType;
  order_index: number;
  is_visible: boolean;
  content: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asBoolean(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  return fallback;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeFaqItems(v: unknown): Array<{ question: string; answer: string; question_ar?: string; answer_ar?: string }> {
  return asArray(v)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      return {
        question: asString(row.question).trim(),
        answer: asString(row.answer).trim(),
        question_ar: asString(row.question_ar).trim() || undefined,
        answer_ar: asString(row.answer_ar).trim() || undefined,
      };
    })
    .filter((item): item is { question: string; answer: string; question_ar?: string; answer_ar?: string } => !!item && !!item.question && !!item.answer);
}

function normalizeCards(v: unknown): Array<{ icon?: string; title: string; title_ar?: string; description: string; description_ar?: string }> {
  return asArray(v)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      return {
        icon: asString(row.icon).trim() || undefined,
        title: asString(row.title).trim(),
        title_ar: asString(row.title_ar).trim() || undefined,
        description: asString(row.description).trim(),
        description_ar: asString(row.description_ar).trim() || undefined,
      };
    })
    .filter((item): item is { icon?: string; title: string; title_ar?: string; description: string; description_ar?: string } => !!item && !!item.title && !!item.description);
}

export function defaultSectionContent(type: LandingSectionType): Record<string, unknown> {
  switch (type) {
    case 'hero':
      return {
        title: 'Experience Luxury Like Never Before',
        title_ar: 'اختبر الفخامة كما لم تختبرها من قبل',
        subtitle: 'Book your exclusive appointment today.',
        subtitle_ar: 'احجز موعدك الحصري اليوم.',
        hero_images: [],
        hero_video_url: '',
        primary_color: '#2563eb',
        secondary_color: '#3b82f6',
      };
    case 'features':
      return {
        title: 'Why Choose Us',
        title_ar: 'لماذا تختارنا',
        items: [],
      };
    case 'advantages':
      return {
        title: 'Our Advantages',
        title_ar: 'مميزاتنا',
        items: [],
      };
    case 'stats':
      return {
        title: 'Trusted by customers',
        title_ar: 'موثوق من العملاء',
        items: [],
      };
    case 'faq':
      return {
        title: 'Frequently Asked Questions',
        title_ar: 'الأسئلة الشائعة',
        faq_items: [],
      };
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
      return {
        title: 'Our Partners',
        title_ar: 'شركاؤنا',
        logos: [],
      };
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

export function sanitizeSection(type: LandingSectionType, rawContent: unknown): Record<string, unknown> {
  const base = defaultSectionContent(type);
  const content = rawContent && typeof rawContent === 'object' ? (rawContent as Record<string, unknown>) : {};

  if (type === 'faq') {
    return {
      ...base,
      ...content,
      faq_items: normalizeFaqItems(content.faq_items),
    };
  }
  if (type === 'features' || type === 'advantages' || type === 'stats') {
    return {
      ...base,
      ...content,
      items: normalizeCards(content.items),
    };
  }
  if (type === 'partners') {
    return {
      ...base,
      ...content,
      logos: asArray(content.logos),
    };
  }
  if (type === 'services') {
    return {
      ...base,
      ...content,
      enable_search: asBoolean(content.enable_search, true),
    };
  }
  return { ...base, ...content };
}

export function validateSection(type: LandingSectionType, content: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (type === 'hero' && !asString(content.title).trim() && !asString(content.title_ar).trim()) {
    errors.push('Hero section requires title or Arabic title.');
  }
  if (type === 'faq' && normalizeFaqItems(content.faq_items).length === 0) {
    errors.push('FAQ section requires at least one FAQ item.');
  }
  if ((type === 'features' || type === 'advantages') && normalizeCards(content.items).length === 0) {
    errors.push(`${type} section requires at least one item.`);
  }
  if (type === 'cta' && !asString(content.button_label).trim() && !asString(content.button_label_ar).trim()) {
    errors.push('CTA section requires button label.');
  }
  return errors;
}

export function normalizeSections(sections: unknown): LandingSectionInput[] {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const type = String(row.type || '').trim() as LandingSectionType;
      if (!LANDING_SECTION_TYPES.includes(type)) return null;
      const order = Number.isFinite(row.order_index) ? Number(row.order_index) : idx;
      return {
        id: typeof row.id === 'string' ? row.id : undefined,
        type,
        order_index: Math.max(0, order),
        is_visible: row.is_visible !== false,
        content: sanitizeSection(type, row.content),
      } satisfies LandingSectionInput;
    })
    .filter((row): row is LandingSectionInput => !!row)
    .sort((a, b) => a.order_index - b.order_index)
    .map((row, idx) => ({ ...row, order_index: idx }));
}
