/*
  # Ensure currency_code column exists in tenants table
  
  This migration ensures the currency_code column exists in the tenants table.
  If it doesn't exist, it will be added with default value 'SAR'.
  
  This fixes the warning: "[Currency] currency_code column does not exist yet, using default SAR"
*/

-- Add currency_code column if it doesn't exist
DO $$
BEGIN
  -- Check if column exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'tenants' 
      AND column_name = 'currency_code'
  ) THEN
    -- Add the column
    ALTER TABLE public.tenants 
    ADD COLUMN currency_code VARCHAR(3) DEFAULT 'SAR' NOT NULL;
    
    -- Add check constraint for valid currency codes
    ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_currency_code_check 
    CHECK (currency_code IN ('SAR', 'USD', 'GBP', 'EUR'));
    
    -- Add comment
    COMMENT ON COLUMN public.tenants.currency_code IS 'ISO 4217 currency code for the tenant. Used for all financial displays, invoices, and tickets.';
    
    RAISE NOTICE 'Added currency_code column to tenants table';
  ELSE
    RAISE NOTICE 'currency_code column already exists in tenants table';
  END IF;
END $$;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_tenants_currency_code ON public.tenants(currency_code);

-- Update any NULL values to 'SAR' (shouldn't happen with NOT NULL, but just in case)
UPDATE public.tenants 
SET currency_code = 'SAR' 
WHERE currency_code IS NULL;
