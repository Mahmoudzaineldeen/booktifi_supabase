-- Add tickets_enabled field to tenants table
-- This allows tenants to globally enable/disable the ticket system

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS tickets_enabled BOOLEAN DEFAULT true NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN tenants.tickets_enabled IS 'Global setting to enable/disable ticket generation and functionality. When disabled, no tickets are created, sent, or displayed.';
