/*
  # Add Invoice Fields to Package Subscriptions
  
  ## Overview
  Adds fields to track Zoho invoice creation when a package is purchased.
  Packages are prepaid, so invoices must be created at purchase time, not during bookings.
  
  ## Changes
  1. Add `zoho_invoice_id` column to store the Zoho invoice ID
  2. Add `payment_status` column to track if package is paid
  3. Add index for invoice lookups
*/

-- Add zoho_invoice_id column
ALTER TABLE package_subscriptions 
  ADD COLUMN IF NOT EXISTS zoho_invoice_id text;

-- Add payment_status column (defaults to 'paid' since packages are prepaid)
ALTER TABLE package_subscriptions 
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'paid' NOT NULL 
  CHECK (payment_status IN ('paid', 'pending', 'failed'));

-- Add comment explaining the columns
COMMENT ON COLUMN package_subscriptions.zoho_invoice_id IS 
  'Zoho invoice ID created when package was purchased. Packages are prepaid, so invoice is created at purchase time.';

COMMENT ON COLUMN package_subscriptions.payment_status IS 
  'Payment status of the package subscription. Packages are prepaid, so this should be "paid" after invoice creation.';

-- Create index for invoice lookups
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_zoho_invoice 
  ON package_subscriptions(zoho_invoice_id) 
  WHERE zoho_invoice_id IS NOT NULL;

-- Create index for payment status queries
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_payment_status 
  ON package_subscriptions(payment_status);
