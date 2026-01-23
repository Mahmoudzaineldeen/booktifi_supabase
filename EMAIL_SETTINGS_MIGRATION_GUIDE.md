# Email Settings Migration Guide

## Problem Solved

The SMTP test was failing with a 500 Internal Server Error because the `email_settings` column doesn't exist in your production database yet.

## Solution Implemented

I've made the backend code **defensive** so it gracefully handles the missing column and continues to work without errors. The code now:

1. ✅ Tries to use `email_settings` if it exists
2. ✅ Falls back to `smtp_settings` if `email_settings` doesn't exist
3. ✅ Provides helpful error messages
4. ✅ Doesn't crash when the column is missing

## Files Updated

### 1. `server/src/routes/tenants.ts`
- Made SendGrid API key storage defensive (lines 511-557)
- Made tenant data fetching defensive when sending test email (lines 646-688)

### 2. `server/src/services/emailApiService.ts`
- Made `getEmailConfig()` function defensive (lines 62-102)
- Now tries without `email_settings` column if it doesn't exist

### 3. `server/src/services/emailService.ts`
- Made `getSenderEmail()` function defensive (lines 22-50)
- Falls back gracefully if column doesn't exist

## Testing the Fix

### Option 1: Test Now (Without Migration)
The code should now work without the migration! Try the SMTP test again:

1. Navigate to Settings → Email Settings
2. Enter your SMTP credentials
3. Click "Test Connection"
4. The test should now work (or give a proper error message if SMTP settings are wrong)

### Option 2: Apply the Migration (Recommended for Long-term)

To add the `email_settings` column to your production database, you need to run the migration on your Supabase instance.

#### Steps to Apply Migration:

**Method 1: Using Supabase Dashboard (Easiest)**

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Navigate to **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy and paste this SQL:

```sql
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
```

6. Click **Run**
7. You should see "Success. No rows returned"

**Method 2: Using Supabase CLI**

If you have Supabase CLI installed:

```bash
# Make sure you're logged in
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Apply pending migrations
supabase db push
```

**Method 3: Via Railway (if backend has migration runner)**

If your Railway backend has a migration runner, you can deploy the code and it should auto-apply the migration.

## Benefits of Applying the Migration

While the code works without the migration, applying it provides:

1. ✅ **Separation of Concerns**: SendGrid API settings are separate from SMTP settings
2. ✅ **Better Organization**: `email_settings` for API-based providers, `smtp_settings` for SMTP
3. ✅ **Future-Proof**: Ready for additional email providers (Mailgun, AWS SES, etc.)
4. ✅ **Cleaner Schema**: Proper column for email configuration

## What Changed

### Before (Without Migration)
- Backend would crash with 500 error when trying to access `email_settings`
- SMTP test would fail
- No way to store SendGrid API key separately

### After (With Code Fix)
- Backend gracefully handles missing column
- SMTP test works
- Falls back to `smtp_settings` for all email operations
- Provides helpful error messages

### After (With Code Fix + Migration)
- Full support for both SendGrid API and SMTP
- Proper separation of email provider settings
- Ready for future email providers

## Testing Checklist

After deploying the fix:

- [ ] SMTP test works without 500 error
- [ ] Can save SMTP settings
- [ ] Test email is sent successfully
- [ ] No errors in browser console
- [ ] No errors in Railway logs

## Migration File Location

The migration file is already in your repository:
- Path: `supabase/migrations/20260124000002_add_email_settings_to_tenants.sql`
- Status: ✅ Safe to run (has IF NOT EXISTS check)
- Impact: Adds one new JSONB column to `tenants` table

## Need Help?

If you encounter any issues:

1. Check Railway logs for error messages
2. Check browser console for frontend errors
3. Verify your SMTP credentials are correct
4. Try using SendGrid API instead (more reliable in cloud environments)

## Recommended Setup

For production, we recommend using **SendGrid API** instead of SMTP:

1. Sign up for SendGrid (free tier available): https://sendgrid.com/
2. Get your API key from SendGrid dashboard
3. Add it to your Settings → Email Settings → SendGrid API Key
4. Test the connection

**Why SendGrid API over SMTP?**
- ✅ No port blocking issues in cloud environments
- ✅ More reliable delivery
- ✅ Better error messages
- ✅ Email analytics and tracking
- ✅ No timeout issues
