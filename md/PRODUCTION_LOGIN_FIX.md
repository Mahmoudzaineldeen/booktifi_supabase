# Production Login Fix Guide

## The Problem
The production deployment now uses Supabase Auth directly (no backend server needed). However, existing users in the database may not have passwords set in Supabase Auth.

## Solution Options

### Option 1: Reset Password for Existing Users (Recommended)

1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/pivmdulophbdciygvegx
2. Navigate to **Authentication > Users**
3. Find the user (e.g., `info@kingdomcentre.com.sa`)
4. Click the **...** menu next to the user
5. Select **Reset Password**
6. Set a new password for the user
7. Try logging in again on the production site

### Option 2: Create New Account Through Signup

The signup page at `bookati-2jy1.bolt.host/signup` should now work in production. If you get errors:

1. Check browser console for error details (F12 > Console)
2. Common issues:
   - **RLS Policy Error**: The user might not have permission to create tenants
   - **Email Already Exists**: Try a different email address
   - **Database Error**: Check Supabase dashboard for error logs

### Option 3: Run SQL to Create Auth User (Advanced)

If you have SQL access to Supabase, you can manually create auth users:

```sql
-- This needs to be run in Supabase SQL Editor with elevated permissions
-- Replace with actual user details
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  crypt('YOUR_PASSWORD_HERE', gen_salt('bf')), -- Replace with actual password
  NOW(),
  NOW(),
  NOW(),
  '',
  '',
  '',
  ''
FROM users u
WHERE u.email = 'info@kingdomcentre.com.sa'
AND NOT EXISTS (
  SELECT 1 FROM auth.users au WHERE au.id = u.id
);
```

## How to Check Browser Console Errors

1. Go to the production site
2. Press **F12** to open Developer Tools
3. Click the **Console** tab
4. Try to login or signup
5. Look for error messages in red
6. Share those errors if you need help

## What Changed

The app now has two modes:

1. **Development Mode** (with backend server):
   - Uses custom authentication through backend API
   - Requires backend server running

2. **Production Mode** (without backend server):
   - Uses Supabase Auth directly
   - No backend server needed
   - All database operations go through Supabase

## Verifying It's Working

When you try to login, open the browser console and look for:
```
[db] Backend not available, using Supabase Auth fallback
```

This confirms the fallback system is working.
