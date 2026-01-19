# Local Testing with Railway Backend - Verification Guide

## Setup Complete ✅

Frontend is running locally but using **Railway backend** instead of local backend.

### Configuration:
```env
VITE_API_URL=https://booktifisupabase-production.up.railway.app/api
```

This means:
- ✅ Local frontend (http://localhost:5173)
- ✅ Railway backend (https://booktifisupabase-production.up.railway.app)
- ❌ Local backend (http://localhost:3001) - **NOT USED**

## How to Verify It's Using Railway Backend

### 1. Open the App in Browser

Go to: http://localhost:5173

### 2. Open Browser DevTools

Press `F12` or right-click → "Inspect"

### 3. Check Console Tab

Look for these messages:
```
[db] Bolt/WebContainer detected, using Railway backend: https://booktifisupabase-production.up.railway.app/api
```

OR

```
[SettingsPage] Not in Bolt/WebContainer, using configured API URL: https://booktifisupabase-production.up.railway.app/api
```

**If you see localhost:3001** → Configuration not loaded, refresh browser

### 4. Check Network Tab

1. Click **"Network"** tab in DevTools
2. Filter by **"Fetch/XHR"**
3. Interact with the app (login, view pages, etc.)
4. Look at API requests

**Expected URLs:**
```
✅ https://booktifisupabase-production.up.railway.app/api/auth/signin
✅ https://booktifisupabase-production.up.railway.app/api/tenants/smtp-settings
✅ https://booktifisupabase-production.up.railway.app/api/query
```

**NOT:**
```
❌ http://localhost:3001/api/...
```

### 5. Test Key Features

#### A. Login/Authentication
1. Try logging in
2. Check Network tab - should call Railway backend
3. No 401 errors should occur

#### B. Tenant Settings
1. Navigate to Settings page
2. Check SMTP/WhatsApp/Zoho settings load
3. All API calls should go to Railway

#### C. Database Queries
1. Navigate to any page with data (bookings, employees, etc.)
2. Data should load correctly
3. No 404 or 400 errors

## Verification Checklist

- [ ] Frontend running on http://localhost:5173
- [ ] Browser console shows Railway URL (not localhost:3001)
- [ ] Network tab shows requests to Railway backend
- [ ] No 404 errors (backend exists on Railway)
- [ ] No 401 errors (JWT verification works)
- [ ] No 400 errors (queries are valid)
- [ ] Data loads correctly
- [ ] Login works
- [ ] Settings pages work

## Expected Console Output

When you open the app, you should see:

```
[db] Not in Bolt/WebContainer, using configured API URL
VITE_API_URL: https://booktifisupabase-production.up.railway.app/api
```

OR if Vite dev server port is 5173:

```
[db] Bolt/WebContainer detected, using Railway backend: https://booktifisupabase-production.up.railway.app/api
```

## Common Issues

### Issue 1: Still Seeing localhost:3001

**Cause:** Browser cached old configuration

**Fix:**
1. Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. Clear browser cache
3. Close and reopen browser

### Issue 2: VITE_API_URL Not Loaded

**Cause:** Vite dev server needs restart after .env changes

**Fix:**
1. Stop frontend (Ctrl+C in terminal)
2. Restart: `npm run dev:frontend`
3. Wait for "ready in Xms"
4. Refresh browser

### Issue 3: CORS Errors

**Cause:** Railway backend not allowing requests

**Fix:**
- Railway backend CORS is already configured to allow all origins
- If errors persist, check Railway logs

### Issue 4: 401 Unauthorized

**Cause:** JWT_SECRET mismatch

**Fix:**
- Ensure JWT_SECRET matches between Railway and local
- Log out and log back in to get new token

## What Should NOT Happen

### ❌ Local Backend Should NOT Be Used

Even though local backend is running on port 3001, the frontend should **NOT** use it.

**How to confirm:**
- Check Network tab - no requests to `localhost:3001`
- All requests go to `booktifisupabase-production.up.railway.app`

### ❌ No Connection Refused Errors

If you see:
```
Failed to fetch
ERR_CONNECTION_REFUSED
localhost:3001
```

This means configuration didn't load. Restart frontend.

## Testing Workflow

### Test 1: Basic Navigation
1. Open http://localhost:5173
2. Navigate to different pages
3. Check all data loads

### Test 2: Authentication
1. Try logging in
2. Verify token is generated
3. Check protected pages work

### Test 3: Tenant Settings
1. Go to Settings page
2. Try loading SMTP/WhatsApp/Zoho settings
3. Try saving changes

### Test 4: Database Queries
1. Go to Bookings page
2. Verify bookings list loads
3. Try filtering/searching

### Test 5: Create Booking
1. Go to booking page
2. Try creating a test booking
3. Verify it calls Railway backend

## Success Criteria

✅ **All API calls go to Railway backend**
✅ **No localhost:3001 requests**
✅ **No 404/401/400 errors**
✅ **All features work correctly**
✅ **Data loads from Supabase via Railway backend**

## Additional Verification

### Check Vite Configuration

Vite proxy is configured but should be **bypassed** because VITE_API_URL is set:

```typescript
// vite.config.ts proxy (NOT used when VITE_API_URL is set)
proxy: {
  '/api': {
    target: 'http://localhost:3001'
  }
}
```

Since we set `VITE_API_URL`, frontend makes **direct requests** to Railway, not through Vite proxy.

## Stop Local Backend (Optional)

To prove we're not using local backend, you can stop it:

```powershell
# Stop local backend server if running
# Frontend should still work (using Railway)
```

If frontend still works after stopping local backend, this confirms Railway backend is being used! ✅

## Summary

**Frontend:** Running locally on http://localhost:5173
**Backend:** Running on Railway (https://booktifisupabase-production.up.railway.app)
**Database:** Supabase (https://pivmdulophbdciygvegx.supabase.co)

**Expected:** Frontend → Railway → Supabase (all working!)
