# Bookati Platform - Access Guide

## Overview

The Bookati platform now has the correct authentication flow:

1. **Public Website** (`/`) - Landing page for businesses
2. **Tenant Signup** (`/signup`) - For businesses to create an account
3. **Tenant Login** (`/login`) - For tenant users to access their dashboard
4. **Solution Owner Management** (`/management`) - Restricted access for platform administrators

---

## Solution Owner Access

### Access the Management Portal

**URL**: http://localhost:5173/management

**Credentials**:
- Username: `Bookatiadmin`
- Password: `Flipper@6722`

### First-Time Setup

Before you can login, you need to set up the Solution Owner account in Supabase:

#### Step 1: Create Database Schema

1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/0ec90b57d6e95fcbda19832f
2. Navigate to **SQL Editor**
3. Run the file `supabase/setup.sql` (copy and paste entire contents)
4. Run the file `supabase/rls-policies.sql`

#### Step 2: Create Solution Owner Auth User

1. In Supabase, go to **Authentication** > **Users**
2. Click **"Add User"**
3. Fill in:
   - Email: `bookatiadmin@bookati.local`
   - Password: `Flipper@6722`
   - Auto Confirm User: ✅ **CHECK THIS**
4. Click "Create User"

#### Step 3: Create User Profile

1. Go back to **SQL Editor**
2. Run this automated script:

```sql
DO $$
DECLARE
  auth_user_id uuid;
BEGIN
  SELECT id INTO auth_user_id
  FROM auth.users
  WHERE email = 'bookatiadmin@bookati.local';

  IF auth_user_id IS NOT NULL THEN
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
    SET role = 'solution_owner', is_active = true;

    RAISE NOTICE '✅ Solution Owner account created successfully!';
  ELSE
    RAISE NOTICE '⚠️  Auth user not found. Please create the auth user first.';
  END IF;
END $$;
```

#### Step 4: Login

1. **Refresh your browser** (important!)
2. Go to http://localhost:5173/management
3. Enter:
   - Username: `Bookatiadmin`
   - Password: `Flipper@6722`
4. Click "Access Platform"
5. You'll be redirected to `/admin` - the Solution Owner Dashboard

---

## What You Can Do as Solution Owner

Once logged in, you can:

- View platform statistics (total/active/inactive tenants)
- Create new tenants manually
- View all registered tenants
- Activate/deactivate tenant accounts
- Monitor subscription status
- See tenant details (name, industry, contact info)

---

## Tenant Signup Flow (For Testing)

To test the tenant signup process:

### Sign Up as a Tenant

1. Go to http://localhost:5173/signup
2. Fill in the form:
   - **Business Name**: "Test Salon"
   - **Industry**: Select (e.g., Salon & Beauty)
   - **Your Full Name**: "John Doe"
   - **Email**: john@testsalon.com
   - **Phone**: +966501234567
   - **Password**: Choose a password
3. Click "Start Free Trial"

When a tenant signs up:
- New auth user is created
- New tenant record created (30-day trial, active status)
- User profile created as `tenant_admin`
- User redirected to `/login`

---

## Routes Structure

| Route | Purpose | Access |
|-------|---------|--------|
| `/` | Public homepage | Everyone |
| `/signup` | Tenant registration | Businesses |
| `/login` | Tenant user login | Tenant users |
| `/management` | Solution Owner login | Platform admin only |
| `/admin` | Solution Owner dashboard | Solution Owner only |

---

## Troubleshooting

### "Invalid credentials. Access denied."
- Verify username is exactly: `Bookatiadmin` (case-sensitive)
- Verify password is exactly: `Flipper@6722`

### "System authentication failed"
- Auth user doesn't exist in Supabase
- Go to Authentication > Users and verify `bookatiadmin@bookati.local` exists
- Password must be `Flipper@6722`

### Blank page issues
- Hard refresh: Ctrl+Shift+R or Cmd+Shift+R
- Check browser console (F12) for errors
- Verify database schema is created

---

## Quick Reference

**Solution Owner**: http://localhost:5173/management
- Username: `Bookatiadmin` / Password: `Flipper@6722`

**Tenant Signup**: http://localhost:5173/signup

**Tenant Login**: http://localhost:5173/login

**Supabase**: https://supabase.com/dashboard/project/0ec90b57d6e95fcbda19832f
