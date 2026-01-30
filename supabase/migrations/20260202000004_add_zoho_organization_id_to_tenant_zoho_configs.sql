-- Add Zoho Organization ID to tenant Zoho config.
-- Required for recording customer payments when GET /organizations returns 401 (scope).
-- Tenant can paste Organization ID from Zoho Invoice → Settings → Organization Profile.

ALTER TABLE tenant_zoho_configs
ADD COLUMN IF NOT EXISTS zoho_organization_id VARCHAR(100);

COMMENT ON COLUMN tenant_zoho_configs.zoho_organization_id IS 'Zoho Invoice Organization ID; required for recording payments if OAuth scope does not allow GET /organizations. Find in Zoho Invoice → Settings → Organization Profile.';
