-- Add default_country_code to tenants table
-- This allows each tenant to configure their default country code instead of hardcoding +966

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS default_country_code TEXT DEFAULT '+966';

COMMENT ON COLUMN tenants.default_country_code IS 'Default country code for phone numbers (e.g., +966 for Saudi Arabia, +971 for UAE)';

-- Update existing tenants to have +966 as default (backward compatibility)
UPDATE tenants 
SET default_country_code = '+966' 
WHERE default_country_code IS NULL;
