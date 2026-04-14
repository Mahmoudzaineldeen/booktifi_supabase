-- Allow "packages" section type in landing page builder (was missing from initial CHECK constraint).

ALTER TABLE landing_page_sections
  DROP CONSTRAINT IF EXISTS landing_page_sections_type_check;

ALTER TABLE landing_page_sections
  ADD CONSTRAINT landing_page_sections_type_check CHECK (
    type IN (
      'hero',
      'features',
      'advantages',
      'stats',
      'faq',
      'services',
      'packages',
      'partners',
      'cta',
      'footer'
    )
  );
