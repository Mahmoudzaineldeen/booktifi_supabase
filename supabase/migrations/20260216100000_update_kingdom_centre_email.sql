-- Update email from info@kingdomcentre.com.sa to healingtouches_sa@hotmail.com
-- Applies to: auth.users, public.users, and tenants (contact_email / email_settings / smtp_settings)

-- 1. Auth users (Supabase Auth) – required for login with new email
UPDATE auth.users
SET email = 'healingtouches_sa@hotmail.com'
WHERE email = 'info@kingdomcentre.com.sa';

-- 2. Public users (application table)
UPDATE public.users
SET email = 'healingtouches_sa@hotmail.com'
WHERE email = 'info@kingdomcentre.com.sa';

-- 3. Tenants: contact_email (if set to old address)
UPDATE public.tenants
SET contact_email = 'healingtouches_sa@hotmail.com'
WHERE contact_email = 'info@kingdomcentre.com.sa';

-- 4. Tenants: email_settings.from_email (JSONB)
UPDATE public.tenants
SET email_settings = jsonb_set(
  COALESCE(email_settings, '{}'::jsonb),
  '{from_email}',
  '"healingtouches_sa@hotmail.com"'
)
WHERE email_settings->>'from_email' = 'info@kingdomcentre.com.sa';

-- 5. Tenants: smtp_settings.smtp_user (JSONB)
UPDATE public.tenants
SET smtp_settings = jsonb_set(
  COALESCE(smtp_settings, '{}'::jsonb),
  '{smtp_user}',
  '"healingtouches_sa@hotmail.com"'
)
WHERE smtp_settings->>'smtp_user' = 'info@kingdomcentre.com.sa';
