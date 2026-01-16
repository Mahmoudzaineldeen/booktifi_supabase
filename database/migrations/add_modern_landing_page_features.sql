-- ============================================================================
-- Modern Landing Page Features Migration
-- ============================================================================
-- Adds fields for modern landing page features:
-- - Service images (gallery)
-- - Service badges
-- - Discount pricing
-- - Enhanced landing page settings
-- ============================================================================

-- Note: gallery_urls already exists in services table, we'll use that for images
-- Ensure it has a default value
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'gallery_urls'
  ) THEN
    -- Update existing NULL values to empty array
    UPDATE services SET gallery_urls = '[]'::jsonb WHERE gallery_urls IS NULL;
    -- Set default if not already set
    ALTER TABLE services ALTER COLUMN gallery_urls SET DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Add badges field to services table (array of badge objects)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'badges'
  ) THEN
    ALTER TABLE services ADD COLUMN badges jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Add original_price field for discount pricing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'original_price'
  ) THEN
    ALTER TABLE services ADD COLUMN original_price numeric(10, 2);
  END IF;
END $$;

-- Add discount_percentage field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'discount_percentage'
  ) THEN
    ALTER TABLE services ADD COLUMN discount_percentage integer;
  END IF;
END $$;

-- Ensure average_rating and total_reviews exist (they should already exist, but check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'average_rating'
  ) THEN
    ALTER TABLE services ADD COLUMN average_rating numeric(3, 2) DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'total_reviews'
  ) THEN
    ALTER TABLE services ADD COLUMN total_reviews integer DEFAULT 0;
  END IF;
END $$;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_services_gallery_urls ON services USING gin (gallery_urls);
CREATE INDEX IF NOT EXISTS idx_services_badges ON services USING gin (badges);

-- Note: landing_page_settings is already a jsonb field in tenants table
-- We'll extend it with new fields in the application code

COMMENT ON COLUMN services.gallery_urls IS 'Array of image URLs for service gallery';
COMMENT ON COLUMN services.badges IS 'Array of badge objects with type and label';
COMMENT ON COLUMN services.original_price IS 'Original price before discount';
COMMENT ON COLUMN services.discount_percentage IS 'Discount percentage (0-100)';

