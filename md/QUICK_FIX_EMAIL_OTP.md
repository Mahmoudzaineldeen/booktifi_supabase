# Quick Fix for Email OTP 500 Error

## The Problem
Getting `500 Internal Server Error` when trying to request OTP.

## Most Likely Cause
The database migration hasn't been applied - the `email` column doesn't exist in `otp_requests` table.

## Quick Fix (2 Steps)

### Step 1: Apply Migration

**Option A: Using psql (Recommended)**
```bash
psql -U postgres -d saudi_towerdb -f project/supabase/migrations/20251203000000_add_email_otp_support.sql
```

**Option B: Using Supabase Dashboard**
1. Go to SQL Editor
2. Copy and paste the contents of `project/supabase/migrations/20251203000000_add_email_otp_support.sql`
3. Run the SQL

**Option C: Manual SQL**
```sql
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS purpose text DEFAULT 'password_reset';
ALTER TABLE otp_requests DROP CONSTRAINT IF EXISTS otp_requests_phone_or_email_check;
ALTER TABLE otp_requests ADD CONSTRAINT otp_requests_phone_or_email_check 
  CHECK ((phone IS NOT NULL) OR (email IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_otp_requests_email ON otp_requests(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_requests_email_purpose ON otp_requests(email, purpose, verified, expires_at) 
  WHERE email IS NOT NULL;
```

### Step 2: Add SMTP Credentials (Optional for Testing)

Add to `project/server/.env`:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

**Note**: The system will work without SMTP (OTP will be stored but email won't be sent). You can check the OTP in the database for testing.

### Step 3: Restart Server
```bash
cd project/server
npm run dev
```

## Testing Without Email

If you don't have SMTP configured, you can still test by:
1. Request OTP (it will be stored in database)
2. Check the OTP in database:
```sql
SELECT email, otp_code, expires_at 
FROM otp_requests 
WHERE email = 'your-email@example.com' 
ORDER BY created_at DESC 
LIMIT 1;
```
3. Use the OTP code to verify

## Check Server Logs

After applying migration, check server console for:
- ✅ "OTP sent to email" - Success
- ⚠️ "SMTP credentials not configured" - Email won't send but OTP is stored
- ❌ "column email does not exist" - Migration not applied

---

**After applying migration, the 500 error should be fixed!**

