# Supabase Database Setup Guide

## Your Supabase Project

- **Project URL**: https://pivmdulophbdciygvegx.supabase.co
- **Project Reference**: `pivmdulophbdciygvegx`

## Quick Start: Apply Schema via Supabase SQL Editor (Recommended)

This is the easiest method and doesn't require a database password:

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Run the Migration**
   - Open `database/apply_new_schema.sql` in your editor
   - Copy the entire contents (all 1609 lines)
   - Paste into the Supabase SQL Editor
   - Click "Run" (or press Ctrl+Enter)
   - Wait for completion (may take a few minutes)

4. **Verify Success**
   - You should see "Success. No rows returned"
   - Check the tables in the "Table Editor" to confirm they were created

## Method 2: Using Command Line (Requires Database Password)

If you prefer using the command line:

### Step 1: Get Your Database Password

1. Go to Supabase Dashboard → Settings → Database
2. Find the "Connection string" section
3. Look for the connection string that includes a password
4. Copy the password (it's the part after `postgres:` and before `@`)

### Step 2: Set Environment Variables

**Windows (PowerShell):**
```powershell
$env:SUPABASE_DB_PASSWORD="your-database-password-here"
$env:SUPABASE_URL="https://pivmdulophbdciygvegx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdm1kdWxvcGhiZGNpeWd2ZWd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODUxMDgzMiwiZXhwIjoyMDg0MDg2ODMyfQ.HHoaJESYPmbbfA_g95WxcBkSzPzL9RG7Jp7CyNlmoZY"
```

**Windows (CMD):**
```cmd
set SUPABASE_DB_PASSWORD=your-database-password-here
set SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdm1kdWxvcGhiZGNpeWd2ZWd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODUxMDgzMiwiZXhwIjoyMDg0MDg2ODMyfQ.HHoaJESYPmbbfA_g95WxcBkSzPzL9RG7Jp7CyNlmoZY
```

**Linux/Mac:**
```bash
export SUPABASE_DB_PASSWORD="your-database-password-here"
export SUPABASE_URL="https://pivmdulophbdciygvegx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdm1kdWxvcGhiZGNpeWd2ZWd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODUxMDgzMiwiZXhwIjoyMDg0MDg2ODMyfQ.HHoaJESYPmbbfA_g95WxcBkSzPzL9RG7Jp7CyNlmoZY"
```

### Step 3: Run the Migration Script

```bash
node database/run_migration_with_supabase.js
```

## Method 3: Using psql Directly

If you have `psql` installed:

1. Get your connection string from Supabase Dashboard → Settings → Database
2. It will look like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

3. Run:
   ```bash
   psql "your-connection-string-here" -f database/apply_new_schema.sql
   ```

## Update Your Application Configuration

After the migration, update your application's environment variables:

### Frontend (.env or .env.local)
```env
VITE_SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdm1kdWxvcGhiZGNpeWd2ZWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MTA4MzIsImV4cCI6MjA4NDA4NjgzMn0.M-WftT2tjG0cWYSMWgvbJGV9UWKc889kUJPm77PFjA0
```

### Backend (server/.env)
```env
SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdm1kdWxvcGhiZGNpeWd2ZWd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODUxMDgzMiwiZXhwIjoyMDg0MDg2ODMyfQ.HHoaJESYPmbbfA_g95WxcBkSzPzL9RG7Jp7CyNlmoZY
```

## Security Notes

⚠️ **IMPORTANT**: 
- Never commit your `.env` files to git
- The service role key has full database access - keep it secret
- The anon key is safe for client-side use
- Add `.env` to your `.gitignore` file

## Troubleshooting

### "must be owner of schema auth"
- This is normal - the `auth` schema is managed by Supabase
- The script now skips operations on the `auth` schema

### "function uuid_generate_v4() does not exist"
- The script should handle this automatically
- If it persists, Supabase might need the extension enabled
- Check Supabase Dashboard → Database → Extensions

### Connection refused
- Check your database password is correct
- Verify the connection string format
- Try using the Supabase SQL Editor instead

## Next Steps After Migration

1. **Create Initial Data**
   - Create a tenant
   - Create admin users
   - Set up initial services

2. **Test Your Application**
   - Verify API endpoints work
   - Test booking creation
   - Test user authentication

3. **Monitor**
   - Check application logs
   - Verify RLS policies are working
   - Test all features
