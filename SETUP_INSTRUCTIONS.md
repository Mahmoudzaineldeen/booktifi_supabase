# Solution Owner Setup Instructions

## Database Status: ✅ COMPLETE

The database schema has been automatically created with all tables and security policies!

## IMPORTANT: Disable Email Confirmation (REQUIRED!)

**You MUST disable email confirmation for tenant login to work:**

1. Open your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Click **"Authentication"** in the left sidebar
4. Click **"Settings"** (under Authentication)
5. Scroll to **"Email Auth"** section
6. **UNCHECK** the box that says **"Enable email confirmations"**
7. Click **"Save"**

This allows tenant admins to login immediately after account creation without needing to confirm their email.

## Create Solution Owner Account (Only 2 Steps!)

### Step 1: Create Auth User in Supabase

1. Open your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Click **"Authentication"** in the left sidebar
4. Click **"Users"** tab
5. Click **"Add User"** button (top right corner)
6. Fill in the form:
   - **Email**: `bookatiadmin@bookati.local`
   - **Password**: `Flipper@6722`
   - **Auto Confirm User**: ✅ **IMPORTANT: CHECK THIS BOX!**
7. Click **"Create User"**

### Step 2: Create User Profile

1. Go to **SQL Editor** in Supabase
2. Click **"New Query"**
3. Copy and paste this SQL:

```sql
DO $$
DECLARE
  auth_user_id uuid;
BEGIN
  -- Find the auth user we just created
  SELECT id INTO auth_user_id
  FROM auth.users
  WHERE email = 'bookatiadmin@bookati.local'
  LIMIT 1;

  -- Check if user exists
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Auth user not found! Please create auth user first in Authentication > Users';
  END IF;

  -- Create the user profile
  INSERT INTO users (id, email, full_name, role, is_active, tenant_id)
  VALUES (
    auth_user_id,
    'bookatiadmin@bookati.local',
    'Bookati Admin',
    'solution_owner',
    true,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET
    role = 'solution_owner',
    is_active = true,
    full_name = 'Bookati Admin';

  RAISE NOTICE '✅ Solution Owner account created successfully!';
  RAISE NOTICE 'Username: Bookatiadmin';
  RAISE NOTICE 'Password: Flipper@6722';
  RAISE NOTICE 'Login at: /management';
END $$;

-- Verify the account
SELECT
  u.id,
  u.email,
  u.full_name,
  u.role,
  u.is_active,
  au.email as auth_email,
  '✅ Account is ready!' as status
FROM users u
INNER JOIN auth.users au ON u.id = au.id
WHERE u.email = 'bookatiadmin@bookati.local';
```

4. Click **"Run"** or press Ctrl+Enter
5. You should see: "✅ Solution Owner account created successfully!"

### Step 3: Login

1. **Refresh your browser** (important!)
2. Go to: **http://localhost:5173/management**
3. Enter credentials:
   - **Username**: `Bookatiadmin`
   - **Password**: `Flipper@6722`
4. Click **"Access Platform"**
5. You'll be redirected to `/admin` - the Solution Owner Dashboard

**That's it! You're ready to use the platform.**

## Troubleshooting

### "System authentication failed" Error

This means either:
- The auth user doesn't exist in Supabase
- The user profile wasn't created

**Fix:**
1. Go to Supabase > Authentication > Users
2. Check if `bookatiadmin@bookati.local` exists
3. If not, complete Step 1 above
4. If yes, run the SQL from Step 2 again

### "Invalid credentials. Access denied."

This means the username or password is wrong.

**Fix:**
- Username must be exactly: `Bookatiadmin` (case-sensitive!)
- Password must be exactly: `Flipper@6722` (case-sensitive!)

### Still Can't Login?

Run this SQL to check account status:

```sql
-- Check if profile exists
SELECT
  u.id,
  u.email,
  u.role,
  u.is_active,
  au.email as auth_email,
  au.confirmed_at,
  CASE
    WHEN au.id IS NULL THEN '❌ Auth user missing'
    WHEN u.id IS NULL THEN '❌ Profile missing'
    WHEN u.role != 'solution_owner' THEN '❌ Wrong role'
    WHEN u.is_active = false THEN '❌ Account disabled'
    ELSE '✅ Account OK'
  END as status
FROM users u
FULL OUTER JOIN auth.users au ON u.id = au.id
WHERE au.email = 'bookatiadmin@bookati.local'
   OR u.email = 'bookatiadmin@bookati.local';
```

## What You Can Do After Login

Once logged in as Solution Owner:

✅ **View Platform Statistics**
- Total tenants
- Active/inactive counts

✅ **Manage Tenants**
- Create new tenants
- View tenant details
- Activate/deactivate tenants
- Monitor subscriptions

✅ **Platform Administration**
- Full access to all tenant data
- System-wide analytics
- Tenant lifecycle management

## Database Tables Created

✅ All tables have been created:
- `tenants` - Business accounts
- `users` - User profiles
- `services` - Services offered
- `service_categories` - Service groupings
- `shifts` - Operating schedules
- `time_slots` - Available booking slots
- `bookings` - Customer bookings
- `booking_locks` - Concurrent booking protection
- `audit_logs` - Activity tracking
- `payments` - Payment records
- And more...

✅ **Security**: Row-level security (RLS) policies active on all tables

## Need Help?

If you followed all steps and still can't login:
1. Check browser console (F12) for JavaScript errors
2. Check Supabase logs (Dashboard > Logs > API Logs)
3. Verify database migration ran successfully (check table list)
4. Try in incognito/private browser window
