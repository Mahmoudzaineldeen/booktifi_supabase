# Email OTP Troubleshooting Guide

## Error: 500 Internal Server Error on `/api/auth/forgot-password`

### Possible Causes:

1. **Database Migration Not Applied**
   - The `email` column may not exist in `otp_requests` table
   - Solution: Run the migration manually

2. **SMTP Credentials Missing**
   - `SMTP_USER` and `SMTP_PASSWORD` not set in `.env`
   - Solution: Add SMTP credentials

3. **Database Connection Issue**
   - Database may be down or unreachable
   - Solution: Check database connection

## Quick Fix Steps

### Step 1: Apply Database Migration

Run this SQL manually in your database:

```sql
-- Add email column to otp_requests (if not exists)
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS purpose text DEFAULT 'password_reset';

-- Update constraint: either phone or email must be provided
ALTER TABLE otp_requests DROP CONSTRAINT IF EXISTS otp_requests_phone_or_email_check;
ALTER TABLE otp_requests ADD CONSTRAINT otp_requests_phone_or_email_check 
  CHECK ((phone IS NOT NULL) OR (email IS NOT NULL));

-- Add index for email lookups
CREATE INDEX IF NOT EXISTS idx_otp_requests_email ON otp_requests(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_requests_email_purpose ON otp_requests(email, purpose, verified, expires_at) 
  WHERE email IS NOT NULL;
```

Or use psql:
```bash
psql -U postgres -d saudi_towerdb -f project/supabase/migrations/20251203000000_add_email_otp_support.sql
```

### Step 2: Add SMTP Credentials

Add to `project/server/.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

**For Gmail:**
1. Enable 2-Step Verification
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use the generated password in `SMTP_PASSWORD`

### Step 3: Restart Server

After adding SMTP credentials, restart the server:

```bash
cd project/server
npm run dev
```

## Testing Without Email (Development)

The system will still work without SMTP credentials:
- OTP will be stored in database
- Email won't be sent (warning will be logged)
- You can manually check the OTP in the database for testing

To get OTP from database:
```sql
SELECT email, otp_code, expires_at, created_at 
FROM otp_requests 
WHERE email = 'your-email@example.com' 
ORDER BY created_at DESC 
LIMIT 1;
```

## Check Server Logs

Check server console for detailed error messages:
- Database errors
- SMTP configuration warnings
- Email sending errors

## Common Errors

### "column email does not exist"
- **Fix**: Run the migration SQL above

### "Email service not configured"
- **Fix**: Add SMTP credentials to `.env`

### "Invalid login: 535-5.7.8 Username and Password not accepted"
- **Fix**: Use App Password for Gmail, not regular password

### "Connection timeout"
- **Fix**: Check SMTP_HOST and SMTP_PORT are correct
- **Fix**: Check firewall/network allows SMTP connections

---

**Note**: The system now handles missing SMTP credentials gracefully - the API will still return success and store the OTP, but email won't be sent.

