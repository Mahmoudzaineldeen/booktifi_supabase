-- Ensure default_country_code exists on tenants (fixes 42703 when column was never added)
-- Safe to run: ADD COLUMN IF NOT EXISTS

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS default_country_code TEXT DEFAULT '+966';

COMMENT ON COLUMN tenants.default_country_code IS 'Default country code for phone numbers (e.g., +966 for Saudi Arabia, +971 for UAE)';

UPDATE tenants
SET default_country_code = COALESCE(default_country_code, '+966')
WHERE default_country_code IS NULL;
