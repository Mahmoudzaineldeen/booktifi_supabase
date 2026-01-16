-- ============================================================================
-- Add Image Field to Reviews/Testimonials Table
-- ============================================================================
-- This migration adds an image_url field to the reviews table
-- to support optional image uploads in testimonials
-- ============================================================================

-- Add image_url column to reviews table (optional)
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS image_url text;

-- Note: We do NOT create an index on image_url because:
-- 1. Image URLs (base64 data URLs) can be very large (several MB)
-- 2. PostgreSQL has a limit of 8191 bytes for index entries
-- 3. We don't need to search by image URL
-- If you need to query by image_url, use a hash or partial index on a smaller field

-- ============================================================================
-- Note: Location field is not added as per requirements
-- If location field exists, it can be removed or kept optional
-- ============================================================================

