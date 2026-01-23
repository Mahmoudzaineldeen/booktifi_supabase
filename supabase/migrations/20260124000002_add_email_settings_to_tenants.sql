/*
  # Add Email Settings Column to Tenants Table
  
  This migration adds the `email_settings` column to the tenants table.
  This column stores email provider configuration (SendGrid API key, from_email, etc.)
  separate from SMTP settings.
  
  The column is a JSONB type to allow flexible email provider configuration.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'email_settings'
  ) THEN
    ALTER TABLE tenants ADD COLUMN email_settings jsonb DEFAULT NULL;
    
    COMMENT ON COLUMN tenants.email_settings IS 'Email provider configuration (SendGrid API key, from_email, etc.): {sendgrid_api_key, from_email}';
  END IF;
END $$;
