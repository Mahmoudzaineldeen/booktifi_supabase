# Employee & Reception Login Setup Guide

## Current Issue

The employee and reception pages are not displaying because the existing employees in your database don't have Supabase Auth accounts. They were created directly in the database before the authentication system was implemented.

**Current employees without Auth:**
- Username: `Hatem` (Role: employee) - No email/password
- Username: `Cashier` (Role: receptionist) - No email/password

## The Solution

You need to **create new employees through the Admin Panel**. The system will automatically create proper Auth accounts for them.

## Step-by-Step Instructions

### 1. Login as Tenant Admin

1. Go to: `http://localhost:5173/login`
2. Login with your admin credentials:
   - Email: `hatem@techflipp.com`
   - Password: (your password)

### 2. Create a New Employee (with Auth)

1. Navigate to: `http://localhost:5173/techflipp/admin/employees`
2. Click the **"Add Employee"** button
3. Fill in the form:
   ```
   Username: employee1
   Password: 123456
   Full Name: Test Employee
   Full Name (Arabic): موظف اختبار
   Email: (leave blank or add real email)
   Phone: +966501234567
   Role: Employee
   ```
4. Assign the employee to services/shifts
5. Click **Save**

The system will:
- Create a Supabase Auth account with email: `employee1@bookati.local`
- Create the user in the database
- Allow login with username `employee1` and password `123456`

### 3. Test Employee Login

1. **Logout** from the admin account
2. Go to: `http://localhost:5173/login`
3. Enter credentials:
   ```
   Email or Username: employee1
   Password: 123456
   ```
4. Click Login
5. You should be automatically redirected to: `http://localhost:5173/techflipp/employee`

### 4. Create a Receptionist (with Auth)

1. **Logout** and login as admin again
2. Go to Employees page
3. Click **"Add Employee"**
4. Fill in the form:
   ```
   Username: reception1
   Password: 123456
   Full Name: Test Reception
   Full Name (Arabic): موظف استقبال
   Role: Receptionist (important!)
   ```
5. Click **Save**

### 5. Test Receptionist Login

1. **Logout** from admin
2. Go to: `http://localhost:5173/login`
3. Enter credentials:
   ```
   Email or Username: reception1
   Password: 123456
   ```
4. Click Login
5. You should be automatically redirected to: `http://localhost:5173/techflipp/reception`

## How the Login System Works

### For Admins (Tenant Owners)
- Login with **full email address**: `hatem@techflipp.com`
- Redirected to: `/{slug}/admin`

### For Employees & Receptionists
- Login with **username only**: `employee1` (no @ symbol)
- System automatically converts to: `employee1@bookati.local`
- Employees redirected to: `/{slug}/employee`
- Receptionists redirected to: `/{slug}/reception`

## What Each Page Shows

### Reception Page (`/{slug}/reception`)
- View today's bookings
- View all bookings
- Create new walk-in bookings
- Change booking status (confirm, complete, cancel)
- Customer contact information

### Employee Page (`/{slug}/employee`)
- View today's assigned bookings
- View upcoming bookings
- View all assigned bookings
- Mark bookings as completed
- Customer contact details

## Troubleshooting

### "Still redirecting to homepage"
**Cause:** You're trying to login with old employees (Hatem, Cashier) who don't have Auth accounts.

**Solution:** Create NEW employees through the admin panel as described above.

### "Can't access employees page in admin"
**Cause:** Make sure you're logged in as `tenant_admin` role.

**Solution:** Login with `hatem@techflipp.com`

### "Invalid credentials error"
**Check:**
1. Username is spelled correctly (case-sensitive)
2. Password is correct
3. User was created through the admin panel (not directly in database)

## Direct URL Access

Once logged in with the correct role:

**As Employee:**
- Direct access: `http://localhost:5173/techflipp/employee`

**As Receptionist:**
- Direct access: `http://localhost:5173/techflipp/reception`

**As Admin:**
- Direct access: `http://localhost:5173/techflipp/admin`

If you try to access a page without the correct role, you'll be redirected to the login page.

## Quick Test Checklist

- [ ] Login as admin works
- [ ] Can access `/{slug}/admin/employees` page
- [ ] Create new employee with username/password
- [ ] Logout from admin
- [ ] Login with employee username (no @)
- [ ] Automatically redirected to `/{slug}/employee` page
- [ ] Can see assigned bookings
- [ ] Create new receptionist with username/password
- [ ] Login with receptionist username
- [ ] Automatically redirected to `/{slug}/reception` page
- [ ] Can create new bookings

## Notes

- Always create employees through the Admin Panel
- Never create users directly in the database
- Usernames are converted to `username@bookati.local` for Auth
- The system handles this conversion automatically during login
