# How to Enable Login for Existing Users

## The Issue
Your production site (`bookati-2jy1.bolt.host`) now uses Supabase Auth directly. Users exist in Supabase Auth but may not have passwords set up yet.

## Fixed Issues
- ✅ Signup now works (fixed missing timezone fields)
- ✅ Supabase Auth fallback is now working in production
- ✅ Better error messages in console

## Quick Test: Create New Account
The easiest way to test is to create a completely new account:

1. Go to: https://bookati-2jy1.bolt.host/signup
2. Fill in the form with a NEW email address
3. Check browser console (F12 → Console) for any errors
4. You should see logs like:
   ```
   [db] Bolt production detected, backend not available
   [db] Backend not available, using Supabase Auth fallback
   ```

## For Existing Users: Reset Passwords

### Option 1: Reset Via Supabase Dashboard (Recommended)

1. Go to [Supabase Dashboard - Users](https://supabase.com/dashboard/project/pivmdulophbdciygvegx/auth/users)

2. For each user (hatem@kaptifi.com, info@kingdomcentre.com.sa, etc.):
   - Find the user in the list
   - Click the **...** menu (three dots) on the right
   - Select **"Send magic link"** or **"Send password recovery"**
   - The user will receive an email to set up their password

### Option 2: Set Password Directly (Fastest)

1. Go to [Supabase Dashboard - Users](https://supabase.com/dashboard/project/pivmdulophbdciygvegx/auth/users)

2. Find the user (e.g., `hatem@kaptifi.com`)

3. Click on the user to open their details

4. Look for the password field or actions

5. Set a new password directly

6. Try logging in with that password

### Option 3: Use SQL (Advanced)

Run this in [Supabase SQL Editor](https://supabase.com/dashboard/project/pivmdulophbdciygvegx/sql/new):

```sql
-- Update password for a specific user
-- Replace 'hatem@kaptifi.com' with the actual email
-- Replace 'NewPassword123!' with the desired password

UPDATE auth.users
SET encrypted_password = crypt('NewPassword123!', gen_salt('bf'))
WHERE email = 'hatem@kaptifi.com';
```

## Verifying It Works

After setting a password, try to login at: https://bookati-2jy1.bolt.host/login

Open browser console (F12) and you should see:
```
[db] Bolt production detected, backend not available
[db] Checking backend availability at: /api/health
[db] Backend availability check failed: ...
[db] Backend not available, using Supabase Auth fallback
```

If login fails, check the console for the specific error message.

## Common Issues

### "Invalid login credentials"
- The password is incorrect or not set in Supabase Auth
- Reset the password using one of the options above

### "User not found"
- The user doesn't exist in the `public.users` table
- Check that the user exists in both `auth.users` AND `public.users`

### "Role mismatch"
- A customer is trying to access the tenant/admin portal
- Customers should use `/customer/login` instead of `/login`

## Current Users in Supabase Auth

Based on your screenshot, these users exist:
1. hatem@kaptifi.com (Solution Owner)
2. mahmoudnzaineldee12n@gmail.com (Solution Owner)
3. bookatiadmin@bookati.local (Solution Owner)

For these users to login, set their passwords using one of the methods above.
