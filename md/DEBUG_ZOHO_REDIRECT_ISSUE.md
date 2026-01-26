# Debug: Zoho Redirects to localhost:3001 Instead of Bolt URL

## Problem
When you close the local server, Zoho still redirects to `localhost:3001` instead of your Bolt URL, causing `ERR_CONNECTION_REFUSED`.

## Root Cause Analysis

This happens when:
1. **The redirect URI sent to Zoho during authorization was `localhost:3001`**
2. Zoho uses that exact redirect URI for the callback
3. Even if you add the Bolt URL to Zoho Developer Console, Zoho will use the redirect URI from the authorization request

## Debugging Steps

### Step 1: Check Server Logs When Clicking "Connect to Zoho"

In your **Bolt server terminal**, look for these logs:

```
[Zoho Routes] ========================================
[Zoho Routes] DEBUG: Origin Detection
[Zoho Routes] Query params: { tenant_id: '...', origin: '...' }
[Zoho Routes] Origin from query: <should be your Bolt URL>
[Zoho Routes] ========================================
[Zoho Routes] Detected Origin: <should be your Bolt URL>
[Zoho Routes] Origin Source: Frontend
[Zoho Routes] Using Redirect URI: <should be Bolt URL>/api/zoho/callback
[Zoho Routes] ⚠️  CRITICAL: Redirect URI being sent to Zoho: <check this>
```

**What to check:**
- ✅ `Origin from query` should be your Bolt URL
- ✅ `Detected Origin` should be your Bolt URL (not localhost:3001)
- ✅ `Using Redirect URI` should be `https://...bolt.../api/zoho/callback`

**If you see `localhost:3001`:**
- The origin parameter isn't being passed correctly
- Check browser console logs (see Step 2)

### Step 2: Check Browser Console

In your **browser console** (F12), look for:

```
[Zoho Connect] ========================================
[Zoho Connect] Environment Detection:
[Zoho Connect] Current Origin: <should be your Bolt URL>
[Zoho Connect] Is Bolt: true
[Zoho Connect] API URL: /api
[Zoho Connect] Auth URL: /api/zoho/auth?tenant_id=...&origin=...
[Zoho Connect] Passing origin to backend: <should be your Bolt URL>
[Zoho Connect] ⚠️  Expected redirect URI: <Bolt URL>/api/zoho/callback
[Zoho Connect] ========================================
```

**What to check:**
- ✅ `Current Origin` should be your Bolt URL
- ✅ `Is Bolt` should be `true`
- ✅ `API URL` should be `/api` (relative, not localhost:3001)
- ✅ `Passing origin to backend` should be your Bolt URL

**If you see `localhost:5173` or `localhost:3001`:**
- The origin detection isn't working
- `window.location.origin` might not be correct in Bolt

### Step 3: Verify Zoho Developer Console

1. Go to: https://api-console.zoho.com/
2. Find your application
3. Check "Authorized Redirect URIs"
4. **Verify these URIs are listed:**
   ```
   http://localhost:5173/api/zoho/callback
   http://localhost:3001/api/zoho/callback
   https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
   ```

### Step 4: Check What Zoho Actually Receives

When you click "Connect to Zoho", check the server logs for:

```
[Zoho Routes] ⚠️  CRITICAL: Redirect URI being sent to Zoho: <this is what Zoho will use>
```

**This is the redirect URI that Zoho will use for the callback.**

## Common Issues & Solutions

### Issue 1: Origin Parameter Not Passed

**Symptoms:**
- Server logs show: `Origin from query: undefined`
- Server logs show: `Origin Source: Default` or `Origin Source: Host Header`
- Redirect URI is `localhost:3001`

**Solution:**
- Check browser console - is `Current Origin` correct?
- Check if the auth URL includes `&origin=...` parameter
- Verify the popup window is opening the correct URL

### Issue 2: Zoho Using Cached Redirect URI

**Symptoms:**
- Server logs show correct Bolt URL
- But Zoho still redirects to localhost:3001

**Solution:**
- Clear browser cache
- Try in incognito/private mode
- Wait 30-60 seconds after updating Zoho Developer Console
- Make sure the redirect URI in Zoho Developer Console matches EXACTLY what's in server logs

### Issue 3: Popup Window Issue

**Symptoms:**
- Browser console shows correct origin
- But server logs show localhost:3001

**Solution:**
- The popup window might be using a different origin
- Check if the popup URL is correct
- Try opening the auth URL directly in a new tab instead of popup

## Quick Fix: Force Bolt URL

If the origin detection isn't working, you can temporarily set an environment variable:

1. In Bolt terminal, set:
   ```bash
   export APP_URL=https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io
   ```

2. Restart the server

3. The backend will use this as Priority 3 fallback

## Next Steps

1. **Run the OAuth flow in Bolt**
2. **Check server logs** - copy the complete log output
3. **Check browser console** - copy the complete log output
4. **Share both logs** so we can identify the exact issue

The logs will show us:
- What origin is being detected
- What redirect URI is being sent to Zoho
- Why it might be using localhost:3001 instead of Bolt URL
