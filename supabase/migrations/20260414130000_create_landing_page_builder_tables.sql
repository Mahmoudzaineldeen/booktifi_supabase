-- Landing Page Builder (normalized section model)
-- Source of truth: landing_pages + landing_page_sections
-- Legacy JSON (tenants.landing_page_settings) is preserved for fallback compatibility.

CREATE TABLE IF NOT EXISTS landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Main Landing Page',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_pages_active_per_tenant
  ON landing_pages (tenant_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_landing_pages_tenant_active
  ON landing_pages (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS landing_page_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT landing_page_sections_type_check CHECK (
    type IN ('hero', 'features', 'advantages', 'stats', 'faq', 'services', 'partners', 'cta', 'footer')
  ),
  CONSTRAINT landing_page_sections_order_positive CHECK (order_index >= 0),
  CONSTRAINT landing_page_sections_unique_order UNIQUE (page_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_landing_page_sections_page_order
  ON landing_page_sections (page_id, order_index);

CREATE INDEX IF NOT EXISTS idx_landing_page_sections_page_visible
  ON landing_page_sections (page_id, is_visible);

CREATE OR REPLACE FUNCTION set_landing_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_landing_pages_updated_at ON landing_pages;
CREATE TRIGGER trg_landing_pages_updated_at
BEFORE UPDATE ON landing_pages
FOR EACH ROW
EXECUTE FUNCTION set_landing_pages_updated_at();

CREATE OR REPLACE FUNCTION set_landing_page_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_landing_page_sections_updated_at ON landing_page_sections;
CREATE TRIGGER trg_landing_page_sections_updated_at
BEFORE UPDATE ON landing_page_sections
FOR EACH ROW
EXECUTE FUNCTION set_landing_page_sections_updated_at();

-- Backfill: one active landing page per tenant.
INSERT INTO landing_pages (tenant_id, name, is_active)
SELECT t.id, 'Main Landing Page', TRUE
FROM tenants t
LEFT JOIN landing_pages lp
  ON lp.tenant_id = t.id
  AND lp.is_active = TRUE
WHERE lp.id IS NULL
ON CONFLICT DO NOTHING;

-- Backfill sections from legacy landing_page_settings JSON.
WITH tenant_settings AS (
  SELECT
    t.id AS tenant_id,
    CASE
      WHEN jsonb_typeof(t.landing_page_settings) = 'object'
           AND jsonb_typeof(t.landing_page_settings->'landingPage') = 'object'
      THEN t.landing_page_settings->'landingPage'
      WHEN jsonb_typeof(t.landing_page_settings) = 'object'
      THEN t.landing_page_settings
      ELSE '{}'::jsonb
    END AS settings
  FROM tenants t
),
active_pages AS (
  SELECT id, tenant_id
  FROM landing_pages
  WHERE is_active = TRUE
),
source_rows AS (
  SELECT
    p.id AS page_id,
    s.settings
  FROM active_pages p
  JOIN tenant_settings s ON s.tenant_id = p.tenant_id
)
INSERT INTO landing_page_sections (page_id, type, order_index, is_visible, content)
SELECT page_id, type, order_index, is_visible, content
FROM (
  -- 0) HERO
  SELECT
    page_id,
    'hero'::text AS type,
    0 AS order_index,
    TRUE AS is_visible,
    jsonb_build_object(
      'title', COALESCE(settings->>'hero_title', 'Experience Luxury Like Never Before'),
      'title_ar', COALESCE(settings->>'hero_title_ar', 'اختبر الفخامة كما لم تختبرها من قبل'),
      'subtitle', COALESCE(settings->>'hero_subtitle', 'Book your exclusive appointment today and discover world-class services'),
      'subtitle_ar', COALESCE(settings->>'hero_subtitle_ar', 'احجز موعدك الحصري اليوم واكتشف خدمات عالمية المستوى'),
      'primary_color', COALESCE(settings->>'primary_color', '#2563eb'),
      'secondary_color', COALESCE(settings->>'secondary_color', '#3b82f6'),
      'hero_image_url', settings->>'hero_image_url',
      'hero_video_url', settings->>'hero_video_url',
      'hero_images', COALESCE(
        CASE WHEN jsonb_typeof(settings->'hero_images') = 'array' THEN settings->'hero_images' END,
        '[]'::jsonb
      )
    ) AS content
  FROM source_rows

  UNION ALL
  -- 1) SERVICES
  SELECT
    page_id,
    'services'::text,
    1,
    COALESCE((settings->>'show_services')::boolean, TRUE),
    jsonb_build_object(
      'title', 'Our Services',
      'title_ar', 'خدماتنا',
      'subtitle', 'Choose the right service for your needs',
      'subtitle_ar', 'اختر الخدمة المناسبة لاحتياجك',
      'enable_search', TRUE
    )
  FROM source_rows

  UNION ALL
  -- 2) FEATURES (dynamic cards)
  SELECT
    page_id,
    'features'::text,
    2,
    TRUE,
    jsonb_build_object(
      'title', 'Why Choose Us',
      'title_ar', 'لماذا تختارنا',
      'items', jsonb_build_array(
        jsonb_build_object('icon', 'sparkles', 'title', 'Premium Quality', 'title_ar', 'جودة عالية', 'description', 'Exceptional service quality and customer care', 'description_ar', 'خدمة مميزة وعناية بالعميل'),
        jsonb_build_object('icon', 'clock', 'title', 'Fast Booking', 'title_ar', 'حجز سريع', 'description', 'Easy and quick online booking experience', 'description_ar', 'تجربة حجز سهلة وسريعة'),
        jsonb_build_object('icon', 'shield', 'title', 'Trusted Team', 'title_ar', 'فريق موثوق', 'description', 'Professional team with proven expertise', 'description_ar', 'فريق محترف بخبرة موثوقة')
      )
    )
  FROM source_rows

  UNION ALL
  -- 3) ADVANTAGES
  SELECT
    page_id,
    'advantages'::text,
    3,
    TRUE,
    jsonb_build_object(
      'title', 'Our Advantages',
      'title_ar', 'مميزاتنا',
      'items', jsonb_build_array(
        jsonb_build_object('text', 'Professional specialists', 'text_ar', 'متخصصون محترفون'),
        jsonb_build_object('text', 'Modern facilities', 'text_ar', 'مرافق حديثة'),
        jsonb_build_object('text', 'Flexible schedules', 'text_ar', 'مواعيد مرنة')
      )
    )
  FROM source_rows

  UNION ALL
  -- 4) STATS
  SELECT
    page_id,
    'stats'::text,
    4,
    TRUE,
    jsonb_build_object(
      'title', 'Trusted by customers',
      'title_ar', 'موثوق من العملاء',
      'items', jsonb_build_array(
        jsonb_build_object('label', 'Happy Customers', 'label_ar', 'عملاء سعداء', 'value', '1000+'),
        jsonb_build_object('label', 'Completed Bookings', 'label_ar', 'حجوزات مكتملة', 'value', '5000+'),
        jsonb_build_object('label', 'Years of Experience', 'label_ar', 'سنوات الخبرة', 'value', '10+')
      )
    )
  FROM source_rows

  UNION ALL
  -- 5) FAQ
  SELECT
    page_id,
    'faq'::text,
    5,
    TRUE,
    jsonb_build_object(
      'title', 'Frequently Asked Questions',
      'title_ar', 'الأسئلة الشائعة',
      'faq_items',
      COALESCE(
        CASE WHEN jsonb_typeof(settings->'faq_items') = 'array' THEN settings->'faq_items' END,
        '[]'::jsonb
      )
    )
  FROM source_rows

  UNION ALL
  -- 6) PARTNERS
  SELECT
    page_id,
    'partners'::text,
    6,
    TRUE,
    jsonb_build_object(
      'title', 'Our Partners',
      'title_ar', 'شركاؤنا',
      'logos', '[]'::jsonb
    )
  FROM source_rows

  UNION ALL
  -- 7) CTA
  SELECT
    page_id,
    'cta'::text,
    7,
    TRUE,
    jsonb_build_object(
      'title', 'Ready to Book?',
      'title_ar', 'جاهز للحجز؟',
      'subtitle', 'Choose your preferred service and reserve your slot now.',
      'subtitle_ar', 'اختر خدمتك المفضلة واحجز موعدك الآن.',
      'button_label', 'Book Now',
      'button_label_ar', 'احجز الآن',
      'button_target', '#services'
    )
  FROM source_rows

  UNION ALL
  -- 8) FOOTER
  SELECT
    page_id,
    'footer'::text,
    8,
    TRUE,
    jsonb_build_object(
      'about_title', COALESCE(settings->>'about_title', 'About Us'),
      'about_title_ar', COALESCE(settings->>'about_title_ar', 'معلومات عنا'),
      'about_description', COALESCE(settings->>'about_description', 'We provide quality services with professional staff'),
      'about_description_ar', COALESCE(settings->>'about_description_ar', 'نقدم خدمات عالية الجودة مع فريق محترف'),
      'contact_email', settings->>'contact_email',
      'contact_phone', settings->>'contact_phone',
      'social_facebook', settings->>'social_facebook',
      'social_twitter', settings->>'social_twitter',
      'social_instagram', settings->>'social_instagram'
    )
  FROM source_rows
) seeded
ON CONFLICT (page_id, order_index) DO NOTHING;
