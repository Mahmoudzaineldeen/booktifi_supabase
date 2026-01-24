/*
  # Add Currency Support to Tenants
  
  1. Schema Changes
    - Add `currency_code` column to `tenants` table
    - Default to 'SAR' for backward compatibility
    - Add check constraint for valid currency codes
  
  2. Currency Support
    - Supports: SAR, USD, GBP, EUR
    - Each tenant can select one currency
    - Currency is used across all financial displays
*/

-- Add currency_code column to tenants table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'currency_code'
  ) THEN
    ALTER TABLE tenants 
    ADD COLUMN currency_code VARCHAR(3) DEFAULT 'SAR' NOT NULL;
    
    -- Add check constraint for valid currency codes
    ALTER TABLE tenants
    ADD CONSTRAINT tenants_currency_code_check 
    CHECK (currency_code IN ('SAR', 'USD', 'GBP', 'EUR'));
    
    -- Add comment
    COMMENT ON COLUMN tenants.currency_code IS 'ISO 4217 currency code for the tenant. Used for all financial displays, invoices, and tickets.';
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tenants_currency_code ON tenants(currency_code);
