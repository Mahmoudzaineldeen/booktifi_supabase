-- ============================================================================
-- Flatten landing_page_settings (optional migration)
-- ============================================================================
-- Landing page data is stored as a flat object. If you previously had
-- nested format { "landingPage": { "title": "...", "subtitle": "..." } },
-- this migration flattens it to { "title": "...", "subtitle": "..." }.
--
-- Application code already normalizes on read (see normalizeLandingPageSettings
-- in src/lib/landingPageSettings.ts and server pdfService), so old data
-- continues to work without this migration. Run this only if you want to
-- normalize stored JSON for consistency.
-- ============================================================================

-- Flatten tenants.landing_page_settings where it has nested "landingPage" key
UPDATE tenants
SET landing_page_settings = landing_page_settings->'landingPage'
WHERE landing_page_settings IS NOT NULL
  AND jsonb_typeof(landing_page_settings) = 'object'
  AND landing_page_settings ? 'landingPage';
